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
    onChanged: (cb: () => void) => () => void
  }
  engine: {
    start: (args: StartEngineArgs) => Promise<StartResult>
    send: (sessionId: string, prompt: string) => Promise<{ ok: boolean; error?: string }>
    cancel: (sessionId: string) => Promise<{ ok: boolean }>
    onEvent: (cb: (payload: EngineEventPayload) => void) => () => void
  }
}

declare global {
  // The normalized event stream the UI renders — mirror of main's engine/types.ts.
  type AgentEvent =
    | { kind: 'session'; sessionId: string }
    | { kind: 'text'; text: string }
    | { kind: 'thinking'; text: string }
    | { kind: 'tool'; name: string; phase: 'start' | 'end' }
    | { kind: 'result'; ok: boolean; summary?: string }
    | { kind: 'error'; message: string }

  interface EngineEventPayload {
    sessionId: string
    event: AgentEvent
  }

  interface StartEngineArgs {
    engine: string
    model?: string
    cwd?: string
  }

  interface StartResult {
    ok: boolean
    sessionId?: string
    error?: string
  }

  interface Window {
    electron: ElectronAPI
    api: unknown
    y: YApi
  }
}
