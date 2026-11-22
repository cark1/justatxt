import { EditorState, Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { classify, findLinks, owners } from './model'

// ---------- state: show/hide completed + items currently fading out ----------

export const setShowDone = StateEffect.define<boolean>()

export const showDoneField = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setShowDone)) v = e.value
    return v
  }
})

interface Fading {
  id: number
  pos: number
}
const addFading = StateEffect.define<Fading>()
const clearFading = StateEffect.define<number>()

const fadingField = StateField.define<Fading[]>({
  create: () => [],
  update(v, tr) {
    let out = tr.docChanged ? v.map((f) => ({ ...f, pos: tr.changes.mapPos(f.pos) })) : v
    for (const e of tr.effects) {
      if (e.is(addFading)) out = [...out, e.value]
      if (e.is(clearFading)) out = out.filter((f) => f.id !== e.value)
    }
    return out
  }
})

let fadeSeq = 0
const FADE_MS = 650

/** Toggle the checkbox of the task on the line containing `pos`. */
export function toggleAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos)
  const info = classify(line.text)
  if (info.kind !== 'task') return false
  const close = line.text.indexOf(']', info.box)
  const checking = !info.done
  const id = ++fadeSeq
  view.dispatch({
    changes: { from: line.from + info.box + 1, to: line.from + close, insert: checking ? 'x' : ' ' },
    effects: checking && !view.state.field(showDoneField) ? addFading.of({ id, pos: line.from }) : [],
    userEvent: 'input.toggle'
  })
  if (checking)
    setTimeout(() => {
      view.dispatch({ effects: clearFading.of(id) })
      keepCaretVisible(view)
    }, FADE_MS)
  return true
}

// ---------- widgets ----------

class CheckboxWidget extends WidgetType {
  constructor(
    readonly done: boolean,
    readonly indent: number
  ) {
    super()
  }
  eq(o: CheckboxWidget) {
    return o.done === this.done && o.indent === this.indent
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'cm-checkbox' + (this.done ? ' is-done' : '')
    if (this.indent) el.style.marginLeft = `${this.indent * 0.6}em`
    el.setAttribute('role', 'checkbox')
    el.setAttribute('aria-checked', String(this.done))
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggleAt(view, view.posAtDOM(el))
    })
    return el
  }
  ignoreEvent() {
    return true
  }
}

class DoneCountWidget extends WidgetType {
  constructor(readonly count: number) {
    super()
  }
  eq(o: DoneCountWidget) {
    return o.count === this.count
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'cm-done-count'
    el.textContent = `✓ ${this.count}`
    el.title = `${this.count} completed — click to show`
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      view.dispatch({ effects: setShowDone.of(true) })
    })
    return el
  }
  ignoreEvent() {
    return true
  }
}

export type DragStart = (view: EditorView, pos: number, e: MouseEvent) => void
let onDragStart: DragStart = () => {}
export const setDragStart = (fn: DragStart) => (onDragStart = fn)

/**
 * Shown in an empty group title. Besides hinting, it gives the caret a text node to sit
 * next to: with the "# " hidden and nothing else on the line, the caret would otherwise
 * stretch to the full height of the (padded) line.
 */
class PlaceholderWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(o: PlaceholderWidget) {
    return o.text === this.text
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-placeholder-text'
    el.textContent = this.text
    return el
  }
  ignoreEvent() {
    return false
  }
}

class HandleWidget extends WidgetType {
  constructor(readonly group: boolean) {
    super()
  }
  eq(o: HandleWidget) {
    return o.group === this.group
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'cm-handle' + (this.group ? ' is-group' : '')
    el.setAttribute('aria-hidden', 'true')
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      onDragStart(view, view.posAtDOM(el), e)
    })
    return el
  }
  ignoreEvent() {
    return true
  }
}

// ---------- building decorations ----------

const hide = Decoration.replace({})
const groupLine = Decoration.line({ class: 'cm-group' })
const linkMark = Decoration.mark({ class: 'cm-link', attributes: { title: '⌘-click to open' } })
const rawLinkMark = Decoration.mark({ class: 'cm-link-raw' })

export const isHiddenLine = (state: EditorState, text: string) =>
  !state.field(showDoneField) && classify(text).done

interface Built {
  deco: DecorationSet
  atomic: DecorationSet
}

function build(state: EditorState): Built {
  const ranges: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []
  const showDone = state.field(showDoneField)
  const fading = new Set(state.field(fadingField).map((f) => state.doc.lineAt(f.pos).from))
  const sel = state.selection.main
  const doc = state.doc

  // completed count per group header, computed up-front
  const counts = new Map<number, number>()
  let header = -1
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n)
    const info = classify(l.text)
    if (info.kind === 'group') header = l.from
    else if (info.kind === 'task' && info.done && header >= 0 && !fading.has(l.from))
      counts.set(header, (counts.get(header) ?? 0) + 1)
  }

  let hideFrom = -1
  let hideTo = -1
  const flushHidden = () => {
    if (hideFrom >= 0) ranges.push(Decoration.replace({ block: true }).range(hideFrom, hideTo))
    hideFrom = -1
  }

  const own = owners(doc.toJSON())

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const info = classify(line.text)
    const ownerIdx = own[n - 1]
    // a continuation line looks like its task: hidden, struck or fading together with it
    const task = ownerIdx >= 0 ? doc.line(ownerIdx + 1) : info.kind === 'task' ? line : null
    const taskInfo = task === line ? info : task ? classify(task.text) : null
    const taskFading = !!task && fading.has(task.from)

    if (taskInfo?.done && !showDone && !taskFading) {
      if (hideFrom < 0) hideFrom = line.from
      hideTo = line.to
      continue
    }
    flushHidden()

    if (ownerIdx >= 0 && taskInfo) {
      const last = own[n] !== ownerIdx // next line is not part of the same item
      const cls =
        'cm-task-cont' + (last ? ' is-last' : '') + (taskInfo.done ? ' cm-done' : '') + (taskFading ? ' cm-fading' : '')
      ranges.push(
        Decoration.line({
          class: cls,
          attributes: { style: `padding-left: calc(23px + ${taskInfo.indent.length * 0.6}em)` }
        }).range(line.from)
      )
      if (info.indent.length) {
        const indent = hide.range(line.from, line.from + info.indent.length)
        ranges.push(indent)
        atomic.push(indent)
      }
    } else if (info.kind !== 'blank') {
      ranges.push(Decoration.widget({ widget: new HandleWidget(info.kind === 'group'), side: -1 }).range(line.from))
    }

    if (info.kind === 'group') {
      ranges.push(groupLine.range(line.from))
      const prefix = hide.range(line.from, line.from + info.prefixLen)
      ranges.push(prefix)
      atomic.push(prefix)
      const c = counts.get(line.from)
      if (line.to === line.from + info.prefixLen)
        ranges.push(Decoration.widget({ widget: new PlaceholderWidget('Group name'), side: 1 }).range(line.to))
      if (!showDone && c) ranges.push(Decoration.widget({ widget: new DoneCountWidget(c), side: 1 }).range(line.to))
    } else if (info.kind === 'task') {
      const multi = own[n] === n - 1 // followed by continuation lines
      const cls =
        'cm-task' + (multi ? ' has-cont' : '') + (info.done ? ' cm-done' : '') + (fading.has(line.from) ? ' cm-fading' : '')
      // hanging indent: wrapped lines align with the text after the checkbox, like ⇧↵ lines
      const hang = `calc(23px + ${info.indent.length * 0.6}em)`
      ranges.push(
        Decoration.line({ class: cls, attributes: { style: `padding-left: ${hang}; text-indent: calc(-1 * ${hang})` } }).range(
          line.from
        )
      )
      const box = Decoration.replace({ widget: new CheckboxWidget(info.done, info.indent.length) }).range(
        line.from,
        line.from + info.prefixLen
      )
      ranges.push(box)
      atomic.push(box)
    }

    for (const link of findLinks(line.text)) {
      if (link.from < info.prefixLen) continue
      const from = line.from + link.from
      const to = line.from + link.to
      if (!link.markdown) {
        ranges.push(linkMark.range(from, to))
        continue
      }
      const editing = sel.from <= to && sel.to >= from
      if (editing) {
        ranges.push(rawLinkMark.range(from, to))
      } else {
        ranges.push(hide.range(from, line.from + link.labelFrom))
        ranges.push(linkMark.range(line.from + link.labelFrom, line.from + link.labelTo))
        ranges.push(hide.range(line.from + link.labelTo, to))
      }
    }
  }
  flushHidden()

  return { deco: Decoration.set(ranges, true), atomic: Decoration.set(atomic, true) }
}

const decoField = StateField.define<Built>({
  create: build,
  update(value, tr) {
    const relevant =
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setShowDone) || e.is(addFading) || e.is(clearFading))
    return relevant ? build(tr.state) : value
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic)
  ]
})

/**
 * If the caret ended up on a line that just got hidden (completed item, hide-completed on),
 * move it to the end of the closest visible line above (or the start of the one below);
 * otherwise the browser draws it in a meaningless spot.
 */
export function keepCaretVisible(view: EditorView): void {
  const { state } = view
  if (state.field(showDoneField)) return
  const doc = state.doc
  const lines = doc.toJSON()
  const own = owners(lines)
  const fading = new Set(state.field(fadingField).map((f) => doc.lineAt(f.pos).number - 1))
  const hidden = (i: number) => {
    const t = own[i] >= 0 ? own[i] : i
    return classify(lines[t]).done && !fading.has(t)
  }
  const cur = doc.lineAt(state.selection.main.head).number - 1
  if (!hidden(cur)) return
  for (let i = cur - 1; i >= 0; i--) {
    if (!hidden(i)) return view.dispatch({ selection: { anchor: doc.line(i + 1).to } })
  }
  for (let i = cur + 1; i < lines.length; i++) {
    if (!hidden(i)) {
      const l = doc.line(i + 1)
      return view.dispatch({ selection: { anchor: l.from + classify(l.text).prefixLen } })
    }
  }
}

/**
 * Deleting into completed items that are hidden would remove tasks you can't see.
 * Instead, the first delete that would touch them just reveals completed items;
 * the next one deletes, now visibly.
 */
const revealBeforeDelete = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('delete')) return tr
  const state = tr.startState
  if (state.field(showDoneField)) return tr
  const doc = state.doc
  const lines = doc.toJSON()
  const own = owners(lines)
  const fading = new Set(state.field(fadingField).map((f) => doc.lineAt(f.pos).number - 1))
  let touchesHidden = false
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (touchesHidden) return
    const first = doc.lineAt(Math.max(0, fromA - 1)).number - 1
    const last = doc.lineAt(Math.min(doc.length, toA + 1)).number - 1
    for (let i = first; i <= last; i++) {
      const t = own[i] >= 0 ? own[i] : i
      if (!classify(lines[t]).done || fading.has(t)) continue
      const l = doc.line(i + 1)
      if (fromA <= l.to && toA >= l.from) touchesHidden = true
    }
  })
  return touchesHidden ? { effects: setShowDone.of(true) } : tr
})

export const decorations = [showDoneField, fadingField, decoField, revealBeforeDelete]
