import '../../src/renderer/src/styles.css'
import './site.css'
import { createEditor } from '../../src/renderer/src/editor/editor'

/** The demo file: it explains the app by being an example of it. */
const WELCOME = `# Start here
- [ ] Click a checkbox to complete a task
- [x] Completed tasks hide themselves
- [ ] Click the ✓ badge next to a group to see them again
- [ ] Press Enter at the end of this line to add a task

# Write
- [ ] Type # at the start of a line for a new group
- [ ] Type [] to start a new task
- [ ] Shift + Enter adds a second line
  to the same task, like this one
- [ ] Type -> and it turns into an arrow
- [ ] Select a word and paste a URL to make a [link](https://github.com/cark1/justatxt)

# Organize
- [ ] Drag the handle on the right of a line to reorder
- [ ] ⌘↑ and ⌘↓ move a task, or a whole group from its title
- [ ] ⌘↵ checks the task under the cursor

# It's just a txt
- [ ] Every file is plain Markdown saved as .txt
- [ ] Open it anywhere: TextEdit, Obsidian, VS Code
- [ ] Lives in the menu bar and opens instantly
- [ ] Download it for your Mac → [Just a txt](https://github.com/cark1/justatxt/releases/latest/download/Just-a-txt-mac.dmg)
`

/** The app's own todo list: what's done (hidden until you show completed) and what's next. */
const ROADMAP = `# Todo
- [x] Groups with # and tasks with []
- [x] Check a task and it hides itself
- [x] Show / hide completed tasks
- [x] Drag and drop tasks and groups
- [x] Move tasks and groups with ⌘↑ / ⌘↓
- [x] Multi-line tasks with Shift + Enter
- [x] Paste a URL on a word to make a link
- [x] -> turns into →
- [x] Autosave to plain .txt files
- [x] Lives in the menu bar, opens instantly
- [x] Rename a file from its title
- [x] Keep a window on top
- [x] Move to Trash
- [x] Choose the folder
- [x] Open at login
- [x] Dark mode
- [ ] Allow nested tasks?
- [ ] Templates → create + use
- [ ] Font size → 3 steps
`

/** The website's own list. */
const WEBSITE = `# Website
- [ ] Easter eggs in the menu bar and in the site menu
- [ ] Align the files
- [ ] Test on mobile
- [ ] Optimize for SEO / GEO
`

interface DemoFile {
  id: string
  name: string
  content: string
  /** Set when the file was dragged out of the folder onto the desktop. */
  desk?: { x: number; y: number }
  /** Per-file "Show completed", remembered. */
  showDone?: boolean
}

const inFolder = (f: DemoFile) => !f.desk

const defaults = (): DemoFile[] => [
  { id: 'welcome', name: 'Welcome', content: WELCOME },
  // opens with completed tasks visible: the done list is the point of this file
  { id: 'justatxt', name: 'Just a txt', content: ROADMAP, showDone: true },
  { id: 'website', name: 'Website', content: WEBSITE }
]

const FILES_STORE = 'justatxt-demo-files-v4' // bump when the default files change
const TRASH_STORE = 'justatxt-demo-trash-v4'
const SHOW_STORE = 'justatxt-demo-show-done'

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {}
}

let files: DemoFile[] = (() => {
  try {
    const saved = JSON.parse(read(FILES_STORE) ?? 'null')
    if (Array.isArray(saved) && saved.length) return saved
  } catch {}
  return defaults()
})()
let trash: DemoFile[] = (() => {
  try {
    const saved = JSON.parse(read(TRASH_STORE) ?? 'null')
    if (Array.isArray(saved)) return saved
  } catch {}
  return []
})()
const saveFiles = () => {
  write(FILES_STORE, JSON.stringify(files))
  write(TRASH_STORE, JSON.stringify(trash))
}

const desktop = document.getElementById('desktop')!
const isWide = () => matchMedia('(min-width: 900px)').matches

// ---------- press-and-drag: a press that moves becomes a drag, otherwise it's a click ----------

interface DragHandlers {
  /** Called with the original pointerdown, once the press turns into a drag. */
  start?: (down: PointerEvent) => void
  move: (e: PointerEvent) => void
  end: (e: PointerEvent) => void
}

// The click that the browser fires right after a drag's release must not count as a click.
let lastDragEnd = -Infinity
window.addEventListener(
  'click',
  (e) => {
    if (performance.now() - lastDragEnd < 120) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  },
  true
)

function pressDrag(el: HTMLElement, h: DragHandlers) {
  // the browser's own image/text drag would cancel our pointer stream halfway
  el.addEventListener('dragstart', (e) => e.preventDefault())
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let dragging = false
    // listen on window: fast moves leave the element before a drag is even recognised
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        dragging = true
        document.body.classList.add('is-dragging')
        h.start?.(e) // the press point: where the user grabbed the element
      }
      h.move(ev)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!dragging) return
      document.body.classList.remove('is-dragging')
      h.move(ev) // the release point is the final position
      h.end(ev)
      lastDragEnd = performance.now()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  })
}

const hit = (el: HTMLElement, e: PointerEvent) => {
  if (el.hidden) return false
  const r = el.getBoundingClientRect()
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
}

/** Drag a file icon with a ghost; `targets` light up when hovered and receive the drop. */
function dragFile(
  b: HTMLElement,
  f: DemoFile,
  targets: () => { el: HTMLElement; drop: (f: DemoFile) => void }[],
  elsewhere?: (f: DemoFile, e: PointerEvent) => void
) {
  let ghost: HTMLElement | null = null
  let over: HTMLElement | null = null
  pressDrag(b, {
    start: () => {
      ghost = b.cloneNode(true) as HTMLElement
      ghost.classList.add('file-ghost')
      document.body.append(ghost)
      b.classList.add('is-dragged')
    },
    move: (e) => {
      ghost!.style.translate = `${e.clientX - 48}px ${e.clientY - 36}px`
      const t = targets().find((t) => hit(t.el, e))?.el ?? null
      if (t !== over) {
        over?.classList.remove('drop-target')
        t?.classList.add('drop-target')
        over = t
      }
    },
    end: (e) => {
      ghost?.remove()
      ghost = null
      b.classList.remove('is-dragged')
      over?.classList.remove('drop-target')
      over = null
      const t = targets().find((t) => hit(t.el, e))
      if (t) t.drop(f)
      else elsewhere?.(f, e)
    }
  })
}

// ---------- desktop windows: click to bring to front, drag by the title bar ----------

// "Keep on top" windows live in a higher band, so ordinary windows never cover them
let zTop = 10
let zPinned = 5000
const raise = (el: HTMLElement) => (el.style.zIndex = String(el.dataset.pinned ? ++zPinned : ++zTop))

/**
 * Drag a window by its bar, keeping it reachable: the title bar can never go above the
 * desktop (under the menu bar) or off-screen, so the window can always be grabbed again.
 */
function desktopWindow(win: HTMLElement, bar: HTMLElement) {
  let offset = { x: 0, y: 0 }
  win.addEventListener('pointerdown', () => raise(win), true)
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, .menu')) return
    if (!isWide()) return
    const r = win.getBoundingClientRect()
    const base = { left: r.left - offset.x, top: r.top - offset.y }
    const area = desktop.getBoundingClientRect()
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y }
    bar.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      let x = ev.clientX - start.x
      let y = ev.clientY - start.y
      const keep = 90 // px of the window that must stay on screen sideways
      x = Math.min(Math.max(x, area.left - base.left - r.width + keep), area.right - base.left - keep)
      y = Math.min(Math.max(y, area.top - base.top), area.bottom - base.top - 40)
      offset = { x, y }
      win.style.translate = `${x}px ${y}px`
    }
    const up = () => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', up)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', up)
  })
}

// ---------- app windows: one per document, like the real app ----------

interface AppWin {
  file: DemoFile
  el: HTMLElement
  editor: ReturnType<typeof createEditor>
}

const openWins = new Map<string, AppWin>()
const slot = document.getElementById('win-slot')!
const tpl = document.getElementById('app-window') as HTMLTemplateElement
let cascade = 0

function setWinTitle(w: AppWin) {
  w.el.querySelector('.title-text')!.textContent = w.file.name
}

function focusWin(w: AppWin) {
  raise(w.el)
  document.title = `${w.file.name} — Just a txt`
}

function openAppWindow(file: DemoFile): AppWin {
  const existing = openWins.get(file.id)
  if (existing) {
    focusWin(existing)
    return existing
  }
  const el = tpl.content.firstElementChild!.cloneNode(true) as HTMLElement
  // windows cascade from the slot's corner, as macOS does for new windows
  const step = openWins.size === 0 ? 0 : (cascade = (cascade % 6) + 1)
  if (openWins.size === 0) cascade = 0
  el.style.left = `${step * 26}px`
  el.style.top = `${step * 26}px`
  slot.append(el)

  const showToggle = el.querySelector<HTMLButtonElement>('[data-action="show-done"]')!
  const w: AppWin = {
    file,
    el,
    editor: createEditor(el.querySelector<HTMLElement>('.editor')!, {
      onChange: () => {
        file.content = w.editor.text()
        saveFiles()
        if (rawFile === file && document.activeElement !== rawBody) rawBody.value = file.content
      },
      onShowDoneChange: (show) => {
        showToggle.setAttribute('aria-checked', String(show))
        file.showDone = show
        saveFiles()
      },
      newFile: () => newDemoFile(),
      openLink: (url) => window.open(url, '_blank', 'noopener')
    })
  }
  const show = !!file.showDone
  w.editor.load(file.content, show)
  w.editor.view.contentDOM.blur()
  showToggle.setAttribute('aria-checked', String(show))
  setWinTitle(w)
  openWins.set(file.id, w)

  // title: double-click to rename
  const titleText = el.querySelector<HTMLElement>('.title-text')!
  const titleInput = el.querySelector<HTMLInputElement>('.title-input')!
  const startRename = () => {
    titleInput.value = file.name
    titleText.hidden = true
    titleInput.hidden = false
    titleInput.focus()
    titleInput.select()
  }
  titleText.addEventListener('dblclick', startRename)
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleInput.blur()
    if (e.key === 'Escape') {
      titleInput.value = file.name
      titleInput.blur()
    }
  })
  titleInput.addEventListener('blur', () => {
    const v = titleInput.value.trim()
    if (v && v !== file.name) {
      file.name = v
      saveFiles()
      setWinTitle(w)
      if (rawFile === file) rawTitle.textContent = `${v}.txt`
      renderFileLists()
      focusWin(w)
    }
    titleInput.hidden = true
    titleText.hidden = false
  })

  // ⋯ menu
  const moreBtn = el.querySelector<HTMLElement>('.more')!
  const moreMenu = el.querySelector<HTMLElement>('.more-menu')!
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = moreMenu.hidden
    closeMenus()
    moreMenu.hidden = !open
  })
  moreMenu.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
    if (action === 'rename') startRename()
    if (action === 'show-done') w.editor.setShowDone(!w.editor.getShowDone())
    if (action === 'pin') {
      const on = !el.dataset.pinned
      if (on) el.dataset.pinned = '1'
      else delete el.dataset.pinned
      moreMenu.querySelector('[data-action="pin"]')!.setAttribute('aria-checked', String(on))
      raise(el)
    }
    if (action === 'finder') {
      showFolder()
      openRaw(file)
    }
    if (action === 'trash') moveToTrash(file)
    if (action === 'close') closeAppWindow(w)
  })
  el.querySelector('.close')!.addEventListener('click', () => closeAppWindow(w))

  desktopWindow(el, el.querySelector<HTMLElement>('.titlebar')!)
  focusWin(w)
  renderFileLists()
  return w
}

function closeAppWindow(w: AppWin) {
  w.editor.view.destroy()
  w.el.remove()
  openWins.delete(w.file.id)
  // like the app: closing an empty file deletes it
  if (!w.file.content.trim() && files.includes(w.file)) {
    files = files.filter((f) => f !== w.file)
    saveFiles()
  }
  const front = [...openWins.values()].sort((x, y) => +y.el.style.zIndex - +x.el.style.zIndex)[0]
  document.title = front ? `${front.file.name} — Just a txt` : 'Just a txt — todo lists in plain text'
  renderFileLists()
}

// ---------- the justatxt folder: desktop icon, Finder-style window, menu bar list ----------

const finder = document.getElementById('finder')!
const finderGrid = document.getElementById('finder-grid')!
const trayFiles = document.getElementById('tray-files')!
const docIcon = `<svg viewBox="0 0 40 48" width="44" height="52" aria-hidden="true"><path d="M4 3h22l10 10v32H4z" fill="var(--doc-bg)" stroke="var(--doc-line)" stroke-width="1.2"/><path d="M26 3v10h10" fill="var(--doc-fold)" stroke="var(--doc-line)" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 22h20M10 28h20M10 34h13" stroke="var(--doc-text)" stroke-width="1.6" stroke-linecap="round"/></svg>`

function renderFileLists() {
  finderGrid.replaceChildren(
    ...files.filter(inFolder).map((f) => {
      const b = document.createElement('button')
      b.className = 'file' + (f === rawFile ? ' is-open' : '')
      b.innerHTML = `${docIcon}<span></span>`
      b.querySelector('span')!.textContent = `${f.name}.txt`
      b.addEventListener('click', () => openRaw(f))
      dragFile(
        b,
        f,
        () => [
          { el: trashIcon, drop: moveToTrash },
          { el: trashWin, drop: moveToTrash },
          { el: finder, drop: () => {} } // dropped back where it was
        ],
        dropOnDesktop
      )
      return b
    })
  )
  renderDesktopFiles()
  // like the real menu bar menu: the files in the justatxt folder, checked when open
  trayFiles.replaceChildren(
    ...files.filter(inFolder).map((f) => {
      const b = document.createElement('button')
      b.setAttribute('role', 'menuitemcheckbox')
      b.setAttribute('aria-checked', String(openWins.has(f.id)))
      b.innerHTML = '<span class="check">✓</span><span></span>'
      b.lastElementChild!.textContent = f.name
      b.addEventListener('click', () => openAppWindow(f))
      return b
    })
  )
}

// ---------- TextEdit-style window: the same file, as the plain text it really is ----------

const rawWin = document.getElementById('textedit')!
const rawTitle = document.getElementById('textedit-title')!
const rawBody = document.getElementById('textedit-body') as HTMLTextAreaElement
let rawFile: DemoFile | null = null

function openRaw(f: DemoFile) {
  rawFile = f
  rawTitle.textContent = `${f.name}.txt`
  rawBody.value = f.content
  rawWin.hidden = false
  raise(rawWin)
  renderFileLists()
}

// typing here is an "external" edit: an open app window picks it up, like the real app does
rawBody.addEventListener('input', () => {
  if (!rawFile) return
  rawFile.content = rawBody.value
  saveFiles()
  openWins.get(rawFile.id)?.editor.replaceExternal(rawBody.value)
})

document.getElementById('textedit-close')!.addEventListener('click', () => {
  rawWin.hidden = true
  rawFile = null
  renderFileLists()
})

const folderIcon = document.getElementById('folder')!
const showFolder = () => {
  folderIcon.classList.add('is-selected')
  finder.hidden = false
  raise(finder)
}
folderIcon.addEventListener('click', (e) => {
  e.stopPropagation()
  showFolder()
})
document.getElementById('finder-close')!.addEventListener('click', () => {
  finder.hidden = true
  folderIcon.classList.remove('is-selected')
})

// ---------- files on the desktop (dragged out of the folder) ----------

const deskFiles = document.getElementById('desk-files')!

function clampToDesktop(x: number, y: number, w = 96, h = 86) {
  const d = desktop.getBoundingClientRect()
  return { x: Math.min(Math.max(x, 0), d.width - w), y: Math.min(Math.max(y, 0), d.height - h) }
}

function dropOnDesktop(f: DemoFile, e: PointerEvent) {
  if (!isWide()) return
  const d = desktop.getBoundingClientRect()
  if (!hit(desktop, e)) return
  f.desk = clampToDesktop(e.clientX - d.left - 48, e.clientY - d.top - 30)
  closeFileWindows(f)
  saveFiles()
  renderFileLists()
}

function renderDesktopFiles() {
  deskFiles.replaceChildren(
    ...files
      .filter((f) => f.desk)
      .map((f) => {
        const b = document.createElement('button')
        b.className = 'desk-icon desk-file' + (f === rawFile ? ' is-selected' : '')
        b.innerHTML = `${docIcon}<span></span>`
        b.querySelector('span')!.textContent = `${f.name}.txt`
        b.style.left = `${f.desk!.x}px`
        b.style.top = `${f.desk!.y}px`
        b.addEventListener('click', () => openRaw(f))
        let grab = { x: 0, y: 0 }
        let over: HTMLElement | null = null
        const targets = () => [
          { el: trashIcon, drop: moveToTrash },
          { el: trashWin, drop: moveToTrash },
          { el: folderIcon, drop: (f: DemoFile) => delete f.desk },
          { el: finder, drop: (f: DemoFile) => delete f.desk }
        ]
        pressDrag(b, {
          start: (down) => {
            const r = b.getBoundingClientRect()
            grab = { x: down.clientX - r.left, y: down.clientY - r.top }
            b.classList.add('is-moving')
          },
          move: (e) => {
            const d = desktop.getBoundingClientRect()
            const p = clampToDesktop(e.clientX - d.left - grab.x, e.clientY - d.top - grab.y, b.offsetWidth, b.offsetHeight)
            b.style.left = `${p.x}px`
            b.style.top = `${p.y}px`
            const t = targets().find((t) => hit(t.el, e))?.el ?? null
            if (t !== over) {
              over?.classList.remove('drop-target')
              t?.classList.add('drop-target')
              over = t
            }
          },
          end: (e) => {
            over?.classList.remove('drop-target')
            over = null
            b.classList.remove('is-moving')
            const t = targets().find((t) => hit(t.el, e))
            if (t) t.drop(f)
            else f.desk = { x: parseFloat(b.style.left), y: parseFloat(b.style.top) }
            saveFiles()
            renderFileLists()
          }
        })
        return b
      })
  )
}

// ---------- Trash: Move to Trash really moves the file here; click a file to put it back ----------

const trashIcon = document.getElementById('trash')!
const trashWin = document.getElementById('trash-win')!
const trashGrid = document.getElementById('trash-grid')!
const trashHint = document.getElementById('trash-hint')!

/** A file leaving the justatxt folder (to the Trash or the desktop) closes its windows. */
function closeFileWindows(f: DemoFile) {
  const w = openWins.get(f.id)
  if (w) closeAppWindow(w)
  if (rawFile === f) {
    rawWin.hidden = true
    rawFile = null
  }
}

function moveToTrash(f: DemoFile) {
  closeFileWindows(f)
  files = files.filter((x) => x !== f)
  delete f.desk
  trash.push(f)
  saveFiles()
  renderFileLists()
  renderTrash()
  trashIcon.classList.remove('bump')
  void trashIcon.offsetWidth // restart the little "dropped in" animation
  trashIcon.classList.add('bump')
}

function putBack(f: DemoFile) {
  trash = trash.filter((x) => x !== f)
  delete f.desk
  files.push(f)
  saveFiles()
  renderFileLists()
  renderTrash()
}

function renderTrash() {
  trashIcon.classList.toggle('is-full', trash.length > 0)
  trashGrid.replaceChildren(
    ...trash.map((f) => {
      const b = document.createElement('button')
      b.className = 'file'
      b.title = 'Put back'
      b.innerHTML = `${docIcon}<span></span>`
      b.querySelector('span')!.textContent = `${f.name}.txt`
      b.addEventListener('click', () => putBack(f))
      dragFile(
        b,
        f,
        () => [
          { el: folderIcon, drop: putBack },
          { el: finder, drop: putBack },
          { el: trashWin, drop: () => {} }
        ],
        (f, e) => {
          putBack(f)
          dropOnDesktop(f, e)
        }
      )
      return b
    })
  )
  trashHint.textContent = trash.length ? 'Click a file to put it back.' : 'The Trash is empty.'
  ;(document.getElementById('trash-empty') as HTMLButtonElement).disabled = !trash.length
}

trashIcon.addEventListener('click', (e) => {
  e.stopPropagation()
  trashWin.hidden = false
  raise(trashWin)
})
document.getElementById('trash-close')!.addEventListener('click', () => (trashWin.hidden = true))
document.getElementById('trash-empty')!.addEventListener('click', () => {
  trash = []
  saveFiles()
  renderTrash()
})

// ---------- desktop icons: drag them anywhere on the desktop (positions are remembered) ----------

const ICONS_STORE = 'justatxt-demo-icons'
const iconPos: Record<string, { x: number; y: number }> = (() => {
  try {
    return JSON.parse(read(ICONS_STORE) ?? '{}') ?? {}
  } catch {
    return {}
  }
})()

function placeIcon(icon: HTMLElement, x: number, y: number) {
  const d = desktop.getBoundingClientRect()
  const w = icon.offsetWidth
  const h = icon.offsetHeight
  x = Math.min(Math.max(x, 0), d.width - w)
  y = Math.min(Math.max(y, 0), d.height - h)
  icon.style.left = `${x}px`
  icon.style.top = `${y}px`
  icon.style.right = 'auto'
  icon.style.bottom = 'auto'
  return { x, y }
}

for (const icon of [folderIcon, trashIcon]) {
  const saved = iconPos[icon.id]
  if (saved && isWide()) placeIcon(icon, saved.x, saved.y)
  let grab = { x: 0, y: 0 }
  pressDrag(icon, {
    start: (e) => {
      const r = icon.getBoundingClientRect()
      grab = { x: e.clientX - r.left, y: e.clientY - r.top }
      icon.classList.add('is-selected')
    },
    move: (e) => {
      if (!isWide()) return
      const d = desktop.getBoundingClientRect()
      placeIcon(icon, e.clientX - d.left - grab.x, e.clientY - d.top - grab.y)
    },
    end: () => {
      if (!isWide()) return
      iconPos[icon.id] = { x: parseFloat(icon.style.left), y: parseFloat(icon.style.top) }
      write(ICONS_STORE, JSON.stringify(iconPos))
    }
  })
}

desktopWindow(finder, finder.querySelector('.finder-bar')!)
desktopWindow(trashWin, trashWin.querySelector('.finder-bar')!)
desktopWindow(rawWin, rawWin.querySelector('.finder-bar')!)

// ---------- New file (works in the demo too) and the "it's a demo" notice ----------

function newDemoFile() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
  let name = base
  for (let i = 2; files.some((f) => f.name === name); i++) name = `${base}-${i}`
  const f: DemoFile = { id: `f${Date.now()}`, name, content: '' }
  files.push(f)
  saveFiles()
  openAppWindow(f).editor.view.focus()
}

const toast = document.getElementById('toast')!
let toastTimer: number | undefined
/** For what a website can't really do (change folder, open at login, quit…). */
function showDemoNotice() {
  toast.hidden = false
  toast.classList.remove('show')
  void toast.offsetWidth
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4500)
}
toast.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('a')) toast.hidden = true
})

// ---------- menus ----------

const trayBtn = document.getElementById('tray')!
const trayMenu = document.getElementById('tray-menu')!
function closeMenus() {
  trayMenu.hidden = true
  trayMenu.querySelectorAll('.has-sub').forEach((x) => x.classList.remove('open'))
  document.querySelectorAll<HTMLElement>('.more-menu').forEach((m) => (m.hidden = true))
}
trayBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  const open = trayMenu.hidden
  closeMenus()
  trayMenu.hidden = !open
})
document.addEventListener('click', closeMenus)
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenus())

// submenus open on hover; a click (or tap) toggles them and keeps the menu open
trayMenu.querySelectorAll<HTMLElement>('.sub-trigger').forEach((t) =>
  t.addEventListener('click', (e) => {
    e.stopPropagation()
    const sub = t.parentElement!
    const open = !sub.classList.contains('open')
    trayMenu.querySelectorAll('.has-sub').forEach((x) => x.classList.remove('open'))
    sub.classList.toggle('open', open)
  })
)
// informational rows (shortcuts, labels) don't close the menu
trayMenu.querySelectorAll<HTMLElement>('.menu-info, .menu-label').forEach((el) =>
  el.addEventListener('click', (e) => e.stopPropagation())
)

trayMenu.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'new-file') newDemoFile()
  if (action === 'demo') showDemoNotice()
  if (action === 'open-folder') showFolder()
  if (action === 'reset') {
    write(FILES_STORE, null)
    write(TRASH_STORE, null)
    write(SHOW_STORE, null)
    write(ICONS_STORE, null)
    write(HINT_STORE, null)
    hint.hidden = false
    hint.classList.remove('is-gone')
    for (const icon of [folderIcon, trashIcon]) {
      icon.style.left = icon.style.top = icon.style.right = icon.style.bottom = ''
      delete iconPos[icon.id]
    }
    trash = []
    renderTrash()
    ;[...openWins.values()].forEach(closeAppWindow)
    rawWin.hidden = true
    rawFile = null
    files = defaults()
    openAppWindow(files[0])
  }
})

// ---------- appearance: light / dark toggle in the menu bar ----------

const THEME_STORE = 'justatxt-demo-theme'
const appearanceBtn = document.getElementById('appearance')!
const systemDark = matchMedia('(prefers-color-scheme: dark)')
const isDark = () => (document.documentElement.dataset.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark'

function syncAppearance() {
  const dark = isDark()
  document.documentElement.classList.toggle('is-dark', dark)
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  appearanceBtn.setAttribute('aria-label', label)
  appearanceBtn.title = label
}

appearanceBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  write(THEME_STORE, next)
  syncAppearance()
})
systemDark.addEventListener('change', syncAppearance)
syncAppearance()

// ---------- make the [✓] icon discoverable ----------

const HINT_STORE = 'justatxt-demo-tray-seen'
const hint = document.getElementById('hint-arrow')!

/** Keep the drawn arrow's tip right under the icon, whatever the layout. */
function placeHint() {
  const r = trayBtn.getBoundingClientRect()
  hint.style.left = `${r.left + r.width / 2 - hint.offsetWidth + 10}px`
  hint.style.top = `${r.bottom + 2}px`
}
if (read(HINT_STORE)) hint.hidden = true
placeHint()
addEventListener('resize', placeHint)
document.fonts?.ready.then(placeHint)

// once the menu has been opened, the hint has done its job
trayBtn.addEventListener('click', () => {
  hint.classList.add('is-gone')
  write(HINT_STORE, '1')
})

// clicking anything else in the menu bar makes the icon wiggle: "it's me you want"
document.getElementById('menubar')!.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('#tray, #tray-menu, #appearance')) return
  trayBtn.classList.remove('wiggle')
  void trayBtn.offsetWidth
  trayBtn.classList.add('wiggle')
  if (!hint.hidden) {
    hint.classList.remove('wiggle')
    void hint.offsetWidth
    hint.classList.add('wiggle')
  }
})

// ---------- menu bar clock ----------

const clock = document.getElementById('clock')!
const tick = () => {
  clock.textContent = new Date().toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
tick()
setInterval(tick, 20_000)

// start like the app after install: the welcome file is open
renderTrash()
if (files[0]) openAppWindow(files[0])

// everything is styled and placed: show the page
document.body.classList.add('ready')
