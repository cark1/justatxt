import { app, dialog, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import os from 'os'
import path from 'path'
import { dataDir, dataDirFor, listFiles } from './files'
import { changeDataDir, newFile, openFile, openPaths } from './windows'

let tray: Tray | null = null

/**
 * Menu bar icon: "[✓]", the markdown task syntax. 18pt template image (36px PNG @2x,
 * rendered from an SVG) so macOS tints it for light/dark menu bars.
 */
const TRAY_PNG_2X =
  'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAABu0lEQVR4AezXAU7DMAyFYcTFgJMBJwNOBvkkPDXGa9OuG0wMxUrtOM9/0ibA/d0f+7kBLb2Qq9iht7aKyl5afEt7bJMqPbEfmnmHJBCo7PlbuHWrmnmVnpgxNQ+CGejhMFI/fNThk6JdzQyUld9bIOy1PXeraf5Ie2pJ5oaOvoXqNgdkIrGwLTBR1dzQ0dOOsa6fA+oSL+X8OyCvKo63U7W40efcITCONRA9+zWggJkCDF0Z59ihCgaYuH7W9gaK15OLOuo5VvprgBSbW6VxH3AuBObovZOTR4GAKObD/Gwiireua8a7QHPihm6PY20UKKspPoXi5xwwFpLjs/4oULXlIEBFPy20CYbAGiBFzJnarjCER4Hk2v4KyliYcXnhr+7XABFXTFHP2cSN5/gqfy0QcUUV9xzmGxMPf3O/BUgxxUGFuWvET7atQAqDCuPvYqcA7QKQRa4KKC49dw3zevKCRn1zaYTRLucu7ZCJYX6PESyFZoJgzA0d/dH0DDT0R9RRtXqg+7+rSOlqZiCrcZTdK5UZKzRnQ64E8yo9MTUPAhnIgAQilRGQs9bmNDutCqhLuLRzA1ra8S8AAAD//wsF2eMAAAAGSURBVAMA3zNcSfd2cgQAAAAASUVORK5CYII='

function icon(): Electron.NativeImage {
  const img = nativeImage.createFromBuffer(Buffer.from(TRAY_PNG_2X, 'base64'), { scaleFactor: 2 })
  img.setTemplateImage(true)
  return img
}

function loginEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin
}

const pretty = (p: string) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p)

async function chooseFolder(): Promise<void> {
  app.focus({ steal: true })
  const r = await dialog.showOpenDialog({
    title: 'Where should the justatxt folder go?',
    message: 'Choose where to create the justatxt folder',
    buttonLabel: 'Use this folder',
    defaultPath: path.dirname(dataDir()),
    properties: ['openDirectory', 'createDirectory']
  })
  if (r.canceled || !r.filePaths[0]) return
  const target = dataDirFor(r.filePaths[0])
  if (target === dataDir()) return
  const count = (await listFiles().catch(() => [])).length
  let move = false
  if (count) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: `Move ${count === 1 ? 'the existing file' : `the ${count} existing files`} to the new folder?`,
      detail: `From ${pretty(dataDir())}\nto ${pretty(target)}`,
      buttons: ['Move files', 'Leave them', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    if (response === 2) return
    move = response === 0
  }
  try {
    await changeDataDir(target, move)
  } catch (e: any) {
    dialog.showErrorBox('Could not change folder', e?.message ?? String(e))
  }
}

async function buildMenu(): Promise<Menu> {
  const files = await listFiles().catch(() => [])
  const open = openPaths()
  const item = (f: { path: string; name: string }): MenuItemConstructorOptions => ({
    label: f.name,
    type: 'checkbox',
    checked: open.has(f.path),
    click: () => void openFile(f.path)
  })
  const head = files.slice(0, 15).map(item)
  const rest = files.slice(15, 200).map(item)
  const template: MenuItemConstructorOptions[] = [
    { label: 'New file', accelerator: 'CmdOrCtrl+N', click: () => void newFile() },
    { type: 'separator' },
    ...(head.length ? head : [{ label: 'No files', enabled: false } as MenuItemConstructorOptions]),
    ...(rest.length ? [{ label: 'More files', submenu: rest } as MenuItemConstructorOptions] : []),
    { type: 'separator' },
    {
      label: 'Folder',
      submenu: [
        { label: pretty(dataDir()), enabled: false },
        { type: 'separator' },
        { label: 'Show in Finder', click: () => void shell.openPath(dataDir()) },
        { label: 'Change folder…', click: () => void chooseFolder() }
      ]
    },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: loginEnabled(),
      enabled: app.isPackaged,
      click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked })
    },
    { type: 'separator' },
    { label: 'Quit Just a txt', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
  ]
  return Menu.buildFromTemplate(template)
}

export function createTray(): void {
  tray = new Tray(icon())
  tray.setToolTip('Just a txt')
  const pop = async () => tray?.popUpContextMenu(await buildMenu())
  tray.on('click', () => void pop())
  tray.on('right-click', () => void pop())
}
