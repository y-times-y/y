import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// y's brick-box: the ONLY powers Userland (the renderer) can reach.
// Each brick is a thin wrapper over an IPC call to the Kernel (main process),
// so the Kernel stays the gatekeeper for everything privileged.
const y = {
  userland: {
    read: (): Promise<string> => ipcRenderer.invoke('userland:read'),
    getPath: (): Promise<string> => ipcRenderer.invoke('userland:path'),
    compile: (): Promise<{ ok: boolean; code?: string; error?: string }> =>
      ipcRenderer.invoke('userland:compile'),
    snapshot: (): Promise<{ ok: boolean; hash?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('userland:snapshot'),
    revert: (): Promise<{ ok: boolean; hash?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('userland:revert'),
    // Subscribe to live disk changes; returns an unsubscribe function.
    onChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('userland:changed', listener)
      return () => ipcRenderer.removeListener('userland:changed', listener)
    }
  }
}

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('y', y)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.y = y
}
