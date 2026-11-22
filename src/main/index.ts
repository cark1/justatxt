import { app, Menu } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { ensureDir, loadSettings } from './files'
import { createTray } from './tray'
import {
  hasVisibleWindows,
  initWindows,
  newFile,
  restoreSession,
  setupIpc,
  setupQuit,
  startWatcher
} from './windows'

// The visible name is "Just a txt", but keep settings/session where they have always been.
app.setPath('userData', path.join(app.getPath('appData'), 'justatxt'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function appMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Just a txt',
        submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { type: 'separator' }, { role: 'quit' }]
      },
      {
        label: 'File',
        submenu: [
          { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => void newFile() },
          { role: 'close', accelerator: 'CmdOrCtrl+W' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          // Undo/redo are handled by the editor's own history; listed only for discoverability.
          { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, enabled: false },
          { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', registerAccelerator: false, enabled: false },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      { role: 'windowMenu' }
    ])
  )
}

/** Turn on "open at login" the first time the packaged app runs. */
async function initLoginItem(): Promise<void> {
  if (!app.isPackaged) return
  const flag = path.join(app.getPath('userData'), 'login-initialized')
  const done = await fs.stat(flag).then(() => true, () => false)
  if (done) return
  app.setLoginItemSettings({ openAtLogin: true })
  await fs.writeFile(flag, '1')
}

app.on('window-all-closed', () => {
  // Menu bar app: stay alive.
})

app.on('second-instance', () => {
  if (!hasVisibleWindows()) void newFile()
})

app.on('activate', () => {
  if (!hasVisibleWindows()) void newFile()
})

app.whenReady().then(async () => {
  app.dock?.hide()
  await loadSettings()
  await ensureDir()
  appMenu()
  setupIpc()
  setupQuit()
  initWindows()
  createTray()
  await startWatcher()
  await restoreSession()
  void initLoginItem()
})
