import { EditorSelection, EditorState, type Text } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { EditorView, type KeyBinding } from '@codemirror/view'
import { showDoneField, toggleAt } from './decorations'
import {
  classify,
  continuationIndent,
  findLinks,
  isUrl,
  moveGroup,
  moveItem,
  normalizeUrl,
  owners,
  taskPrefix,
  unitRange,
  type MoveResult
} from './model'

/** Replace the document with `lines` via a minimal diff and put the cursor on line `index`. */
export function applyLines(view: EditorView, r: MoveResult, col: number | 'end', userEvent = 'move.line'): void {
  const oldText = view.state.doc.toString()
  const newText = r.lines.join('\n')
  let start = 0
  const max = Math.min(oldText.length, newText.length)
  while (start < max && oldText[start] === newText[start]) start++
  let endOld = oldText.length
  let endNew = newText.length
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--
    endNew--
  }
  let lineStart = 0
  for (let j = 0; j < r.index; j++) lineStart += r.lines[j].length + 1
  const len = r.lines[r.index].length
  const head = lineStart + (col === 'end' ? len : Math.min(col, len))
  view.dispatch({
    changes: { from: start, to: endOld, insert: newText.slice(start, endNew) },
    selection: EditorSelection.cursor(head),
    scrollIntoView: true,
    userEvent
  })
}

function move(dir: -1 | 1) {
  return (view: EditorView): boolean => {
    const { state } = view
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    const lines = state.doc.toJSON()
    const i = line.number - 1
    const own = owners(lines)
    const showDone = state.field(showDoneField)
    const hidden = (j: number) => !showDone && classify(lines[own[j] >= 0 ? own[j] : j]).done
    const r = classify(line.text).kind === 'group' ? moveGroup(lines, i, dir) : moveItem(lines, i, dir, hidden)
    if (r) applyLines(view, r, head - line.from)
    return true
  }
}

/** Line under the cursor plus, for continuation lines, the task they belong to. */
function context(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos)
  const info = classify(line.text)
  const lines = state.doc.toJSON()
  const own = owners(lines)
  const i = line.number - 1
  const ownerIndex = own[i]
  const ownerInfo = ownerIndex >= 0 ? classify(lines[ownerIndex]) : null
  const [, unitEnd] = unitRange(lines, i, own)
  return { line, info, ownerIndex, ownerInfo, unitEndLine: state.doc.line(unitEnd + 1) }
}

const newItemAt = (view: EditorView, at: number, indent = '') => {
  const insert = '\n' + taskPrefix(indent)
  view.dispatch({
    changes: { from: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    scrollIntoView: true,
    userEvent: 'input'
  })
  return true
}

/** Enter on an item starts a new item (Shift+Enter continues the current one on a new line). */
function enter(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const { line, info, ownerInfo, unitEndLine } = context(state, sel.head)
  const atEnd = sel.head === line.to

  if (ownerInfo) {
    // On a continuation line: at its end, the new item goes after the whole item.
    return newItemAt(view, atEnd ? unitEndLine.to : sel.head, ownerInfo.indent)
  }

  if (info.kind === 'task') {
    const content = line.text.slice(info.prefixLen)
    const prefixEnd = line.from + info.prefixLen
    if (content.trim() === '' && unitEndLine.number === line.number) {
      // Empty item: leave the list (gives a blank line, e.g. before a new "# group").
      view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, userEvent: 'input' })
      return true
    }
    if (sel.head <= prefixEnd && content !== '') {
      // At the start of a non-empty item: open an empty item above, keep the cursor with the text.
      const prefix = taskPrefix(info.indent)
      view.dispatch({
        changes: { from: line.from, insert: prefix + '\n' },
        selection: EditorSelection.cursor(sel.head + prefix.length + 1),
        scrollIntoView: true,
        userEvent: 'input'
      })
      return true
    }
    return newItemAt(view, atEnd ? unitEndLine.to : sel.head, info.indent)
  }

  if (info.kind === 'group' && line.text.slice(info.prefixLen).trim() === '') {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, userEvent: 'input' })
    return true
  }

  // On a group title: start its first item; at the very start, open a blank line above.
  if (info.kind === 'group') {
    if (sel.head <= line.from + info.prefixLen) {
      view.dispatch({
        changes: { from: line.from, insert: '\n' },
        selection: EditorSelection.cursor(sel.head + 1),
        scrollIntoView: true,
        userEvent: 'input'
      })
      return true
    }
    return newItemAt(view, sel.head)
  }

  // Not on an item (text, blank line): plain new line, like a text editor.
  view.dispatch(state.replaceSelection('\n'), { scrollIntoView: true, userEvent: 'input' })
  return true
}

/** Shift+Enter: new line inside the same item (an indented continuation line). */
function shiftEnter(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  const { info, ownerInfo } = context(state, sel.head)
  const task = ownerInfo ?? (info.kind === 'task' ? info : null)
  const insert = task ? '\n' + continuationIndent(task.indent) : '\n'
  view.dispatch(state.replaceSelection(insert), { scrollIntoView: true, userEvent: 'input' })
  return true
}

/**
 * Backspace right after a checkbox / "# " removes the syntax, turning the line into plain
 * text; at the start of a continuation line it joins it to the line above.
 */
function backspace(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const { line, info, ownerInfo } = context(state, sel.head)
  if (ownerInfo && sel.head === line.from + info.indent.length) {
    view.dispatch({ changes: { from: line.from - 1, to: sel.head }, userEvent: 'delete' })
    return true
  }
  if ((info.kind !== 'task' && info.kind !== 'group') || sel.head !== line.from + info.prefixLen) return false
  view.dispatch({
    changes: { from: line.from + info.indent.length, to: line.from + info.prefixLen, insert: '' },
    userEvent: 'delete'
  })
  return true
}

/** ⌘↵: toggle the task on this line, or turn a plain line into a task. */
function toggleLine(view: EditorView): boolean {
  const { state } = view
  const { line, info, ownerIndex } = context(state, state.selection.main.head)
  if (ownerIndex >= 0) return toggleAt(view, state.doc.line(ownerIndex + 1).from)
  if (info.kind === 'task') return toggleAt(view, line.from)
  if (info.kind === 'group') return true
  view.dispatch({
    changes: { from: line.from + info.indent.length, insert: '- [ ] ' },
    userEvent: 'input'
  })
  return true
}

export function editorKeymap(actions: { newFile: () => void }): KeyBinding[] {
  return [
    { key: 'Alt-ArrowUp', run: move(-1), preventDefault: true },
    { key: 'Alt-ArrowDown', run: move(1), preventDefault: true },
    // ⌘↑/⌘↓ too (replaces "go to start/end of document", still reachable with ⌘⇧ or scrolling)
    { key: 'Mod-ArrowUp', run: move(-1), preventDefault: true },
    { key: 'Mod-ArrowDown', run: move(1), preventDefault: true },
    { key: 'Enter', run: enter },
    { key: 'Shift-Enter', run: shiftEnter },
    { key: 'Backspace', run: backspace },
    { key: 'Mod-Enter', run: toggleLine, preventDefault: true },
    { key: 'Mod-n', run: () => (actions.newFile(), true), preventDefault: true }
  ]
}

/**
 * Typing "[] " (or "[ ] ", "- [] ") at the start of a line creates a task in the canonical
 * "- [ ] " form. Implemented as a transaction filter so it also works when the text
 * arrives in one chunk (autocorrect, IME, automation), not only key by key.
 */
// "[] " or "[]" directly followed by text (not "(" — that would be a markdown link).
const TRIGGER_AT_START = /^([ \t]*)(?:[-*+][ \t]*)?\[ ?\](?:[ \t]|(?=[^\s(]))/
export const taskTrigger = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type')) return tr
  const doc = tr.newDoc
  const head = tr.newSelection.main.head
  const line = doc.lineAt(head)
  const m = TRIGGER_AT_START.exec(line.text)
  if (!m) return tr
  const prefixEnd = line.from + m[0].length
  const canonical = taskPrefix(m[1])
  if (m[0] === canonical || head < prefixEnd) return tr
  let touched = false
  tr.changes.iterChangedRanges((_fa, _ta, fb, tb) => {
    if (fb <= prefixEnd && tb >= line.from) touched = true
  })
  if (!touched) return tr
  return [
    tr,
    {
      changes: { from: line.from, to: prefixEnd, insert: canonical },
      selection: EditorSelection.cursor(head + canonical.length - m[0].length),
      sequential: true
    }
  ]
})

/**
 * Keep the caret out of the hidden syntax ("# ", "- [ ] ", continuation indent): at the
 * very start of such a line it would sit before the "#" and typing there would break the
 * title/item. The caret is moved right after the hidden part instead; moving left from
 * there jumps to the end of the previous line.
 */
function hiddenLen(doc: Text, line: { from: number; text: string; number: number }): number {
  const info = classify(line.text)
  if (info.kind === 'group' || info.kind === 'task') return info.prefixLen
  if ((info.kind === 'text' || info.kind === 'blank') && info.indent.length >= 2) {
    const i = line.number - 1
    if (owners(doc.toJSON().slice(0, i + 1))[i] >= 0) return info.indent.length
  }
  return 0
}

export const caretGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr
  const sel = tr.newSelection.main
  if (!sel.empty || tr.newSelection.ranges.length > 1) return tr
  const line = tr.newDoc.lineAt(sel.head)
  const len = hiddenLen(tr.newDoc, line)
  if (!len || sel.head >= line.from + len) return tr
  const prev = tr.startState.selection.main.head
  const goingLeft = !tr.docChanged && tr.isUserEvent('select') && prev > sel.head && prev <= line.to && prev >= line.from
  const target = goingLeft && line.number > 1 ? line.from - 1 : line.from + len
  return [tr, { selection: EditorSelection.cursor(target), sequential: true }]
})

/**
 * Typing "->" becomes "→". The arrow is a separate history step, so ⌘Z right after
 * gives back the literal "->".
 */
export const arrowReplace = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '>' || from !== to || view.state.sliceDoc(from - 1, from) !== '-') return false
  view.dispatch({ changes: { from, insert: '>' }, selection: EditorSelection.cursor(from + 1), userEvent: 'input.type' })
  view.dispatch({
    changes: { from: from - 1, to: from + 1, insert: '→' },
    selection: EditorSelection.cursor(from),
    annotations: isolateHistory.of('before'),
    userEvent: 'input.autocorrect'
  })
  return true
})

/** "#Titolo" typed at line start gets the space Markdown needs: "# Titolo". */
export const headingSpace = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type')) return tr
  const head = tr.newSelection.main.head
  const line = tr.newDoc.lineAt(head)
  const m = /^(#{1,6})(?=[^#\s])/.exec(line.text)
  if (!m) return tr
  const at = line.from + m[1].length
  let touched = false
  tr.changes.iterChangedRanges((_fa, _ta, fb, tb) => {
    if (fb <= at + 1 && tb >= line.from) touched = true
  })
  if (!touched) return tr
  return [
    tr,
    {
      changes: { from: at, insert: ' ' },
      selection: EditorSelection.cursor(head >= at ? head + 1 : head),
      sequential: true
    }
  ]
})

/** Typing "# " on an empty item turns it into a group title (Enter always creates items). */
export const groupTrigger = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.type')) return tr
  const head = tr.newSelection.main.head
  const line = tr.newDoc.lineAt(head)
  const m = /^[ \t]*[-*+] \[[ xX]?\] (#{1,6} )$/.exec(line.text)
  if (!m || head !== line.to) return tr
  return [
    tr,
    {
      changes: { from: line.from, to: line.to, insert: m[1] },
      selection: EditorSelection.cursor(line.from + m[1].length),
      sequential: true
    }
  ]
})

export function domHandlers(actions: { openLink: (url: string) => void }) {
  return EditorView.domEventHandlers({
    /** Pasting a URL over a selected word turns it into a markdown link. */
    paste(e, view) {
      const text = e.clipboardData?.getData('text/plain')?.trim() ?? ''
      const sel = view.state.selection.main
      if (sel.empty || !isUrl(text)) return false
      const selected = view.state.sliceDoc(sel.from, sel.to)
      if (selected.includes('\n') || isUrl(selected.trim())) return false
      e.preventDefault()
      const insert = `[${selected}](${normalizeUrl(text)})`
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: EditorSelection.cursor(sel.from + insert.length),
        userEvent: 'input.paste'
      })
      return true
    },
    /** ⌘-click opens links. */
    mousedown(e, view) {
      if (!e.metaKey || e.button !== 0) return false
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
      if (pos === null) return false
      const line = view.state.doc.lineAt(pos)
      const off = pos - line.from
      const hit = findLinkAt(line.text, off)
      if (!hit) return false
      e.preventDefault()
      actions.openLink(hit)
      return true
    },
    keydown(e, view) {
      if (e.key === 'Meta') view.dom.classList.add('meta-down')
      return false
    },
    keyup(e, view) {
      if (e.key === 'Meta') view.dom.classList.remove('meta-down')
      return false
    },
    blur(_e, view) {
      view.dom.classList.remove('meta-down')
      return false
    }
  })
}

function findLinkAt(text: string, off: number): string | null {
  const l = findLinks(text).find((x) => off >= x.from && off <= x.to)
  return l ? l.url : null
}

export const showDoneOf = (view: EditorView) => view.state.field(showDoneField)
