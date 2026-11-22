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

const toggleBtn = document.getElementById('toggle-done') as HTMLButtonElement
const syncToggle = (show: boolean) => {
  toggleBtn.setAttribute('aria-pressed', String(show))
  toggleBtn.title = show ? 'Hide completed' : 'Show completed'
}

const editor = createEditor(document.getElementById('editor')!, {
  onChange: scheduleSave,
  onShowDoneChange: (show) => {
    syncToggle(show)
    writeShowDone(show)
  },
  newFile: () => api.newFile(),
  openLink: (url) => api.openLink(url)
})

if (import.meta.env.DEV) (window as any).__editor = editor

toggleBtn.addEventListener('click', () => {
  editor.setShowDone(!editor.getShowDone())
  editor.view.focus()
})

document.getElementById('more')!.addEventListener('click', () => api.titleMenu())

// ---------- title / rename ----------

const title = document.getElementById('title') as HTMLInputElement
let currentName = ''

title.addEventListener('focus', () => title.select())
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
  if (!next || next === currentName) {
    title.value = currentName
    return
  }
  await flush()
  const res = await api.rename(next)
  if (res.error || !res.name) {
    title.value = currentName
    title.classList.add('error')
    title.title = res.error ?? ''
    setTimeout(() => title.classList.remove('error'), 900)
    return
  }
  currentName = res.name
  title.value = res.name
  title.title = ''
  document.title = res.name
})

// ---------- commands from main ----------

api.onCmd(async (cmd: Cmd) => {
  switch (cmd.type) {
    case 'load': {
      const { name, content } = cmd.payload as { name: string; content: string }
      clearTimeout(timer)
      dirty = false
      currentName = name
      title.value = name
      document.title = name
      const show = readShowDone()
      editor.load(content, show)
      loaded = true
      syncToggle(show)
      return true
    }
    case 'flush':
      return loaded ? flush() : null
    case 'external':
      editor.replaceExternal((cmd.payload as { content: string }).content)
      return true
  }
})

api.ready()
