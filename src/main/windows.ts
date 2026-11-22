import { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, shell, type Rectangle } from 'electron'
import { promises as fs, watch, type FSWatcher } from 'fs'
import path from 'path'
import {
  createFile,
  dataDir,
  deleteFile,
  displayName,
  ensureDir,
  listFiles,
  moveFile,
  readFile,
  setDataDir,
  renameFile,
  trashFile,
  writeFileAtomic
} from './files'

/**
 * One BrowserWindow per open file. To make opening feel instant we always keep a
 * hidden, fully booted "spare" window: opening a file just hands it the content
 * and shows it, then a new spare is prepared in the background.
 */
interface Doc {
  id: number
  win: BrowserWindow
  path: string | null
  ready: Promise<void>
  closing: boolean
  lastContent: string
}

const docs = new Map<number, Doc>()
const readyResolvers = new Map<number, () => void>()
const pending = new Map<number, (value: any) => void>()
/** What we believe is on disk, per path: lets us tell our own writes from external edits. */
const lastWritten = new Map<string, string>()

/** Documents open at the narrowest usable width; the user can widen them (size is remembered per session). */
const MIN_WIDTH = 320

let spare: Doc | null = null
let quitting = false
let quitReady = false
let rpcSeq = 0

const sessionFile = () => path.join(app.getPath('userData'), 'session.json')

function background(): string {
  return nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'
}

function createDoc(): Doc {
  const win = new BrowserWindow({
    show: false,
    width: MIN_WIDTH,
    height: 680,
    minWidth: MIN_WIDTH,
    minHeight: 220,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: background(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: true,
      // The spare window is hidden; keep it responsive so it can be shown instantly.
      backgroundThrottling: false
    }
  })
  const id = win.webContents.id
  const doc: Doc = {
    id,
    win,
    path: null,
    closing: false,
    lastContent: '',
    ready: new Promise<void>((resolve) => readyResolvers.set(id, resolve))
  }
  docs.set(id, doc)

  win.on('close', (e) => {
    if (doc.closing || quitReady) return
    e.preventDefault()
    void closeDoc(doc)
  })
  win.on('closed', () => {
    docs.delete(id)
    if (spare === doc) spare = null
  })
  let boundsTimer: NodeJS.Timeout | undefined
  const onBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(saveSession, 500)
  }
  win.on('move', onBounds)
  win.on('resize', onBounds)

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return doc
}

function ensureSpare(): void {
  if (!spare && !quitting) spare = createDoc()
}

function takeSpare(): Doc {
  const d = spare ?? createDoc()
  spare = null
  return d
}

/** Ask the renderer something and wait for its reply. */
function ask<T>(doc: Doc, type: string, payload: unknown, timeoutMs = 2000): Promise<T | undefined> {
  if (doc.win.isDestroyed()) return Promise.resolve(undefined)
  const rid = ++rpcSeq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(rid)
      resolve(undefined)
    }, timeoutMs)
    pending.set(rid, (v) => {
      clearTimeout(timer)
      resolve(v)
    })
    doc.win.webContents.send('cmd', { rid, type, payload })
  })
}

const openDocs = () => [...docs.values()].filter((d) => d.path && !d.closing && !d.win.isDestroyed())
const findByPath = (p: string) => openDocs().find((d) => d.path === p)

function show(doc: Doc): void {
  if (doc.win.isMinimized()) doc.win.restore()
  doc.win.show()
  doc.win.focus()
  app.focus({ steal: true })
}

function onScreen(b: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40
  })
}

function place(doc: Doc, bounds?: Rectangle): void {
  if (bounds && onScreen(bounds)) {
    // keep the remembered position and height, but always reopen at the minimum width
    doc.win.setBounds({ ...bounds, width: MIN_WIDTH })
    return
  }
  const ref = BrowserWindow.getFocusedWindow() ?? openDocs().find((d) => d !== doc && d.win.isVisible())?.win
  if (ref && ref !== doc.win) {
    const [x, y] = ref.getPosition()
    doc.win.setPosition(x + 26, y + 26)
  } else {
    doc.win.center()
  }
}

export async function openFile(p: string, bounds?: Rectangle): Promise<void> {
  const existing = findByPath(p)
  if (existing) return show(existing)
  const doc = takeSpare()
  doc.path = p
  const content = await readFile(p)
  lastWritten.set(p, content)
  doc.lastContent = content
  await doc.ready
  await ask(doc, 'load', { path: p, name: displayName(p), content })
  place(doc, bounds)
  show(doc)
  saveSession()
  setTimeout(ensureSpare, 150)
}

export async function newFile(): Promise<void> {
  await openFile(await createFile())
}

async function flush(doc: Doc): Promise<string> {
  // null = the renderer has no file loaded (e.g. mid-reload): trust what we last saved.
  const content = await ask<string | null>(doc, 'flush', null)
  return typeof content === 'string' ? content : doc.lastContent
}

async function closeDoc(doc: Doc): Promise<void> {
  if (doc.closing) return
  const content = doc.path ? await flush(doc) : ''
  doc.closing = true
  if (doc.path && content.trim() === '') await deleteFile(doc.path)
  if (!quitting) saveSession()
  if (!doc.win.isDestroyed()) doc.win.destroy()
}

// ---------- session ----------

interface Session {
  windows: { path: string; bounds: Rectangle }[]
}

function saveSession(): void {
  if (quitReady) return
  const s: Session = {
    windows: openDocs()
      .filter((d) => d.win.isVisible())
      .map((d) => ({ path: d.path!, bounds: d.win.getBounds() }))
  }
  void fs.writeFile(sessionFile(), JSON.stringify(s)).catch(() => {})
}

export async function restoreSession(): Promise<void> {
  let s: Session = { windows: [] }
  try {
    s = JSON.parse(await fs.readFile(sessionFile(), 'utf8'))
  } catch {}
  for (const w of s.windows ?? []) {
    const exists = await fs.stat(w.path).then(() => true, () => false)
    if (exists) await openFile(w.path, w.bounds)
  }
}

// ---------- external changes ----------

let watcher: FSWatcher | null = null
const fsTimers = new Map<string, NodeJS.Timeout>()

export async function startWatcher(): Promise<void> {
  await ensureDir()
  watcher?.close()
  watcher = watch(dataDir(), (_evt, filename) => {
    if (!filename || filename.startsWith('.')) return
    const p = path.join(dataDir(), filename.toString())
    clearTimeout(fsTimers.get(p))
    fsTimers.set(p, setTimeout(() => void onFsChange(p), 80))
  })
}

async function onFsChange(p: string): Promise<void> {
  const doc = findByPath(p)
  if (!doc) return
  const exists = await fs.stat(p).then(() => true, () => false)
  if (!exists) return
  const content = await readFile(p)
  if (content === lastWritten.get(p)) return
  lastWritten.set(p, content)
  doc.lastContent = content
  doc.win.webContents.send('cmd', { rid: 0, type: 'external', payload: { content } })
}

// ---------- quitting ----------

export function setupQuit(): void {
  app.on('before-quit', (e) => {
    if (quitReady) return
    e.preventDefault()
    if (quitting) return
    saveSession()
    quitting = true
    const all = openDocs().map(async (d) => {
      const c = await flush(d)
      if (c.trim() === '') await deleteFile(d.path!)
    })
    void Promise.allSettled(all).then(() => {
      quitReady = true
      app.quit()
    })
  })
}

// ---------- IPC ----------

function docOf(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): Doc | undefined {
  return docs.get(e.sender.id)
}

export function setupIpc(): void {
  ipcMain.on('ready', async (e) => {
    const doc = docOf(e)
    readyResolvers.get(e.sender.id)?.()
    // The renderer reloaded (dev hot reload, crash recovery) while showing a file: give it the file back.
    if (doc?.path && !doc.closing) {
      const content = await readFile(doc.path)
      lastWritten.set(doc.path, content)
      doc.lastContent = content
      await ask(doc, 'load', { path: doc.path, name: displayName(doc.path), content })
    }
  })
  ipcMain.on('reply', (_e, { rid, result }) => {
    pending.get(rid)?.(result)
    pending.delete(rid)
  })

  ipcMain.handle('save', async (e, content: string) => {
    const doc = docOf(e)
    if (!doc?.path) return
    doc.lastContent = content
    lastWritten.set(doc.path, content)
    await writeFileAtomic(doc.path, content)
  })

  ipcMain.handle('rename', async (e, name: string) => {
    const doc = docOf(e)
    if (!doc?.path) return { error: 'No file' }
    try {
      const old = doc.path
      const next = await renameFile(old, name)
      doc.path = next
      lastWritten.set(next, lastWritten.get(old) ?? doc.lastContent)
      if (next !== old) lastWritten.delete(old)
      saveSession()
      return { name: displayName(next) }
    } catch (err: any) {
      return { error: err?.message ?? 'Could not rename' }
    }
  })

  ipcMain.on('new-file', () => void newFile())
  ipcMain.on('close-window', (e) => docOf(e)?.win.close())

  ipcMain.on('open-link', (_e, url: string) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
  })

  ipcMain.on('title-menu', (e) => {
    const doc = docOf(e)
    if (!doc?.path) return
    Menu.buildFromTemplate([
      { label: 'Show in Finder', click: () => shell.showItemInFolder(doc.path!) },
      { type: 'separator' },
      {
        label: 'Move to Trash',
        click: async () => {
          doc.closing = true
          await trashFile(doc.path!)
          saveSession()
          doc.win.destroy()
        }
      }
    ]).popup({ window: doc.win })
  })
}

export function initWindows(): void {
  ensureSpare()
}

export function hasVisibleWindows(): boolean {
  return openDocs().some((d) => d.win.isVisible())
}

export function openPaths(): Set<string> {
  return new Set(openDocs().map((d) => d.path!))
}

/** Switch the data folder, optionally moving the existing files (open windows follow their file). */
export async function changeDataDir(next: string, moveExisting: boolean): Promise<void> {
  if (next === dataDir()) return
  const docsNow = openDocs()
  await Promise.all(docsNow.map((d) => flush(d)))
  const old = moveExisting ? await listFiles() : []
  watcher?.close()
  watcher = null
  await setDataDir(next)
  for (const f of old) {
    const dest = await moveFile(f.path, next)
    const d = docsNow.find((x) => x.path === f.path)
    if (d) d.path = dest
    const known = lastWritten.get(f.path)
    if (known !== undefined) lastWritten.set(dest, known)
    lastWritten.delete(f.path)
  }
  await startWatcher()
  saveSession()
}

// Dev-only hook so the main process can be exercised from an inspector session.
if (!app.isPackaged) (globalThis as any).__justatxt = { changeDataDir, dataDir }
