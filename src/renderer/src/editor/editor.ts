import { EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { decorations, keepCaretVisible, setShowDone, showDoneField } from './decorations'
import { arrowReplace, caretGuard, domHandlers, headingSpace, editorKeymap, groupTrigger, taskTrigger } from './commands'
import { installDragDrop } from './dragdrop'

export interface EditorHooks {
  onChange: () => void
  onShowDoneChange: (show: boolean) => void
  newFile: () => void
  openLink: (url: string) => void
}

const external = Transaction.userEvent

/** Overrides CodeMirror's base theme (monospace, tight padding) for a TextEdit-like look. */
const theme = EditorView.theme({
  '&': { height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
  // narrow left margin; the drag handle lives in the right margin
  '.cm-content': { padding: '14px 40px 24px 16px' },
  '.cm-line': { padding: '1px 0' }
})

export function createEditor(parent: HTMLElement, hooks: EditorHooks) {
  installDragDrop()

  const extensions = () => [
    history(),
    EditorView.lineWrapping,
    theme,
    EditorView.contentAttributes.of({ 'aria-label': 'Text' }),
    Prec.high(keymap.of(editorKeymap({ newFile: hooks.newFile }))),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    taskTrigger,
    groupTrigger,
    caretGuard,
    arrowReplace,
    headingSpace,
    domHandlers({ openLink: hooks.openLink }),
    decorations,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.every((t) => t.annotation(external) === 'external')) hooks.onChange()
      const before = u.startState.field(showDoneField)
      const after = u.state.field(showDoneField)
      if (before !== after) hooks.onShowDoneChange(after)
    })
  ]

  const makeState = (doc: string, showDone: boolean) =>
    EditorState.create({ doc, extensions: [...extensions(), showDoneField.init(() => showDone)] })

  const view = new EditorView({ parent, state: makeState('', false) })

  return {
    view,
    load(doc: string, showDone: boolean) {
      view.setState(makeState(doc, showDone))
      view.focus()
    },
    /** Apply a change made outside the app, preserving the cursor as best we can. */
    replaceExternal(doc: string) {
      const old = view.state.doc.toString()
      if (old === doc) return
      let start = 0
      const max = Math.min(old.length, doc.length)
      while (start < max && old[start] === doc[start]) start++
      let eo = old.length
      let en = doc.length
      while (eo > start && en > start && old[eo - 1] === doc[en - 1]) {
        eo--
        en--
      }
      view.dispatch({
        changes: { from: start, to: eo, insert: doc.slice(start, en) },
        annotations: [external.of('external'), Transaction.addToHistory.of(false)]
      })
    },
    setShowDone(show: boolean) {
      view.dispatch({ effects: setShowDone.of(show) })
      keepCaretVisible(view)
    },
    getShowDone: () => view.state.field(showDoneField),
    text: () => view.state.doc.toString()
  }
}
