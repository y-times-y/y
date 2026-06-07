import { ElectronAPI } from '@electron-toolkit/preload'

// The shape of y's brick-box, visible to BOTH preload and renderer
// (renderer's tsconfig.web.json includes src/preload/*.d.ts).
interface CompileResult {
  ok: boolean
  code?: string
  error?: string
}

interface YApi {
  userland: {
    read: () => Promise<string>
    getPath: () => Promise<string>
    compile: () => Promise<CompileResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    y: YApi
  }
}
