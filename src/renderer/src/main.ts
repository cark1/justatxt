import type { Api, Cmd } from '../../preload'
import { createEditor } from './editor/editor'

declare global {
  interface Window {
    api: Api
  }
}

if (!window.api && import.meta.env.DEV) window.api = (await import('./devApi')).devApi()
const api = window.api
const SHOW_DONE_KEY = 'showDone'

const readShowDone = () => {
  try {
    return localStorage.getItem(SHOW_DONE_KEY) === '1'
  } catch {
    return false
  }
}
const writeShowDone = (v: boolean) => {
  try {
    localStorage.setItem(SHOW_DONE_KEY, v ? '1' : '0')
  } catch {}
}

// ---------- autosave ----------

let dirty = false
let loaded = false
let timer: number | undefined
let saving: Promise<void> = Promise.resolve()

function scheduleSave() {
  dirty = true
  clearTimeout(timer)
  timer = window.setTimeout(() => void flush(), 400)
}

async function flush(): Promise<string> {
  clearTimeout(timer)
  const content = editor.text()
  if (dirty) {
    dirty = false
    saving = saving.then(() => api.save(content)).catch(() => {
      dirty = true
    })
  }
  await saving
  return content
}

window.addEventListener('blur', () => loaded && void flush())

// ---------- editor ----------

const editor = createEditor(document.getElementById('editor')!, {
  onChange: scheduleSave,
  onShowDoneChange: writeShowDone,
  newFile: () => api.newFile(),
  openLink: (url) => api.openLink(url)
})

if (import.meta.env.DEV) (window as any).__editor = editor

// "⋯" opens the native window menu (Rename, Show completed, Keep on top, Finder, Trash)
document.getElementById('more')!.addEventListener('click', () => api.titleMenu({ showDone: editor.getShowDone() }))

// ---------- title / rename ----------
// The title is plain text you can drag the window by; rename with a double-click or ⋯ → Rename.

const titleWrap = document.querySelector('.title-wrap') as HTMLElement
const titleText = document.getElementById('title-text') as HTMLSpanElement
const title = document.getElementById('title') as HTMLInputElement
let currentName = ''

function showName(name: string) {
  currentName = name
  titleText.textContent = name
  title.value = name
  document.title = name
}

function startRename() {
  titleWrap.classList.add('editing')
  titleText.hidden = true
  title.hidden = false
  title.value = currentName
  title.focus()
  title.select()
}

function endRename() {
  titleWrap.classList.remove('editing')
  title.hidden = true
  titleText.hidden = false
}

titleText.addEventListener('dblclick', startRename)

/**
 * Drag the window from the title and the titlebar buttons too: these can't be native drag
 * regions (they need clicks/double-clicks), so they move the window themselves. A press that
 * turns into a drag doesn't count as a click.
 */
function dragsWindow(el: HTMLElement) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const sx = e.screenX
    const sy = e.screenY
    let dragging = false
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.screenX - sx, ev.screenY - sy) < 4) return
      if (!dragging) {
        dragging = true
        api.dragStart()
      }
      api.dragMove()
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (dragging) {
        const swallow = (ce: Event) => {
          ce.preventDefault()
          ce.stopImmediatePropagation()
        }
        el.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0)
      }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  })
}

for (const el of [titleText, ...document.querySelectorAll<HTMLElement>('#titlebar .icon-btn')]) dragsWindow(el)

title.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    editor.view.focus()
  } else if (e.key === 'Escape') {
    title.value = currentName
    editor.view.focus()
  }
})
title.addEventListener('blur', async () => {
  const next = title.value.trim()
  endRename()
  if (!next || next === currentName) return
  await flush()
  const res = await api.rename(next)
  if (res.error || !res.name) {
    titleText.classList.add('error')
    titleText.title = res.error ?? ''
    setTimeout(() => {
      titleText.classList.remove('error')
      titleText.title = 'Double-click to rename'
    }, 1600)
    return
  }
  showName(res.name)
})

// ---------- commands from main ----------

api.onCmd(async (cmd: Cmd) => {
  switch (cmd.type) {
    case 'load': {
      const { name, content } = cmd.payload as { name: string; content: string }
      clearTimeout(timer)
      dirty = false
      showName(name)
      endRename()
      const show = readShowDone()
      editor.load(content, show)
      loaded = true
      return true
    }
    case 'flush':
      return loaded ? flush() : null
    case 'external':
      editor.replaceExternal((cmd.payload as { content: string }).content)
      return true
    case 'rename':
      startRename()
      return true
    case 'set-show-done':
      editor.setShowDone(!!cmd.payload)
      editor.view.focus()
      return true
  }
})

api.ready()
