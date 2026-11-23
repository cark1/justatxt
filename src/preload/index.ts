import { contextBridge, ipcRenderer } from 'electron'

export interface Cmd {
  rid: number
  type: 'load' | 'flush' | 'external' | 'rename' | 'set-show-done'
  payload: any
}

const api = {
  ready: () => ipcRenderer.send('ready'),
  onCmd: (fn: (cmd: Cmd) => Promise<unknown> | unknown) => {
    ipcRenderer.on('cmd', async (_e, cmd: Cmd) => {
      const result = await fn(cmd)
      if (cmd.rid) ipcRenderer.send('reply', { rid: cmd.rid, result })
    })
  },
  save: (content: string): Promise<void> => ipcRenderer.invoke('save', content),
  rename: (name: string): Promise<{ name?: string; error?: string }> => ipcRenderer.invoke('rename', name),
  newFile: () => ipcRenderer.send('new-file'),
  closeWindow: () => ipcRenderer.send('close-window'),
  openLink: (url: string) => ipcRenderer.send('open-link', url),
  titleMenu: (state: { showDone: boolean }) => ipcRenderer.send('title-menu', state),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
