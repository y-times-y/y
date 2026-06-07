import { ElectronAPI } from '@electron-toolkit/preload'

// The shape of y's brick-box, visible to BOTH preload and renderer
// (renderer's tsconfig.web.json includes src/preload/*.d.ts).
interface CompileResult {
  ok: boolean
  code?: string
  error?: string
}

interface SnapshotResult {
  ok: boolean
  hash?: string
  count?: number
  error?: string
}

interface YApi {
  userland: {
    read: () => Promise<string>
    getPath: () => Promise<string>
    compile: () => Promise<CompileResult>
    snapshot: () => Promise<SnapshotResult>
    revert: () => Promise<SnapshotResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    y: YApi
  }
}
