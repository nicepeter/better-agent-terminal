import { contextBridge, ipcRenderer } from 'electron'
import type { CreatePtyOptions } from '../src/types'

// Increase max listeners to support many terminals (default is 10)
ipcRenderer.setMaxListeners(50)

const electronAPI = {
  pty: {
    create: (options: CreatePtyOptions) => ipcRenderer.invoke('pty:create', options),
    write: (id: string, data: string) => ipcRenderer.invoke('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('pty:kill', id),
    restart: (id: string, cwd: string, shell?: string, workspacePath?: string) => ipcRenderer.invoke('pty:restart', id, cwd, shell, workspacePath),
    getCwd: (id: string) => ipcRenderer.invoke('pty:get-cwd', id),
    getBuffer: (id: string): Promise<string> => ipcRenderer.invoke('pty:get-buffer', id),
    getBufferTail: (id: string, maxBytes: number): Promise<string> =>
      ipcRenderer.invoke('pty:get-buffer-tail', id, maxBytes),
    onOutput: (callback: (id: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data)
      ipcRenderer.on('pty:output', handler)
      return () => ipcRenderer.removeListener('pty:output', handler)
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string, exitCode: number) => callback(id, exitCode)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    }
  },
  workspace: {
    save: (data: string) => ipcRenderer.invoke('workspace:save', data),
    load: () => ipcRenderer.invoke('workspace:load')
  },
  settings: {
    save: (data: string) => ipcRenderer.invoke('settings:save', data),
    load: () => ipcRenderer.invoke('settings:load'),
    getShellPath: (shell: string) => ipcRenderer.invoke('settings:get-shell-path', shell)
  },
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder')
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
  },
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
    writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
    onCopy: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('clipboard:copy', handler)
      return () => ipcRenderer.removeListener('clipboard:copy', handler)
    },
    onPaste: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('clipboard:paste', handler)
      return () => ipcRenderer.removeListener('clipboard:paste', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
