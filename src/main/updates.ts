import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { prepareForQuit } from './windows'

/**
 * Auto-updates from GitHub Releases (cark1/justatxt). The app checks at launch and every
 * few hours, downloads new versions in the background and installs them on the next quit,
 * or right away from the menu bar ("Restart to update"). Requires a signed build.
 */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error' }

let status: UpdateStatus = { kind: 'idle' }
let manualCheck = false
let onChange: () => void = () => {}

export const updateStatus = () => status

function set(s: UpdateStatus) {
  status = s
  onChange()
}

export function initUpdates(changed: () => void): void {
  onChange = changed
  if (!app.isPackaged) return // dev builds are not updatable
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ kind: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ kind: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => {
    if (status.kind === 'downloading') set({ ...status, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ kind: 'ready', version: info.version }))
  autoUpdater.on('update-not-available', () => {
    set({ kind: 'idle' })
    if (manualCheck) void dialog.showMessageBox({ message: "You're up to date", detail: `Just a txt ${app.getVersion()} is the latest version.` })
    manualCheck = false
  })
  autoUpdater.on('error', (err) => {
    set({ kind: 'error' })
    if (manualCheck) void dialog.showMessageBox({ type: 'warning', message: "Couldn't check for updates", detail: String(err?.message ?? err) })
    manualCheck = false
  })
  void autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

export function checkForUpdatesNow(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({ message: 'Updates work in the installed app', detail: 'This is a development build.' })
    return
  }
  manualCheck = true
  app.focus({ steal: true })
  void autoUpdater.checkForUpdates().catch(() => {})
}

/** Save everything, then quit and install the downloaded version. */
export async function restartToUpdate(): Promise<void> {
  await prepareForQuit()
  autoUpdater.quitAndInstall()
}
