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
  },
  // Engine bricks: drive a coding-agent CLI and receive its streamed output.
  engine: {
    list: (): Promise<string[]> => ipcRenderer.invoke('engine:list'),
    start: (args: { engine: string; model?: string; cwd?: string }) =>
      ipcRenderer.invoke('engine:start', args),
    // Modify session: write access pinned to the Userland dir (Kernel-controlled).
    startModify: (args: { engine: string; model?: string }) =>
      ipcRenderer.invoke('engine:startModify', args),
    send: (sessionId: string, prompt: string) =>
      ipcRenderer.invoke('engine:send', sessionId, prompt),
    cancel: (sessionId: string) => ipcRenderer.invoke('engine:cancel', sessionId),
    // The streaming side: fires for every event the engine emits. The callback
    // gets { sessionId, event } so a chat can ignore events from other sessions.
    onEvent: (cb: (payload: { sessionId: string; event: unknown }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { sessionId: string; event: unknown }): void =>
        cb(payload)
      ipcRenderer.on('engine:event', listener)
      return () => ipcRenderer.removeListener('engine:event', listener)
    }
  },
  // ---- Capability bricks (Phase 6): general powers Userland composes into ----
  // features. Each is consent-gated in main; Userland can't bypass the prompt.
  // Network: a fetch proxied through main (no renderer CSP limits).
  net: {
    request: (req: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
    }) => ipcRenderer.invoke('net:request', req)
  },
  // Files: read/write a private workspace folder (paths are locked inside it).
  files: {
    root: (): Promise<string> => ipcRenderer.invoke('files:root'),
    list: (path?: string) => ipcRenderer.invoke('files:list', path ?? '.'),
    read: (path: string) => ipcRenderer.invoke('files:read', path),
    write: (path: string, contents: string) => ipcRenderer.invoke('files:write', path, contents),
    mkdir: (path: string) => ipcRenderer.invoke('files:mkdir', path),
    remove: (path: string) => ipcRenderer.invoke('files:remove', path)
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
