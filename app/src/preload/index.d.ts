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

interface DiffResult {
  ok: boolean
  dirty?: boolean
  diff?: string
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
    diff: () => Promise<DiffResult>
    onChanged: (cb: () => void) => () => void
  }
  engine: {
    list: () => Promise<string[]>
    start: (args: StartEngineArgs) => Promise<StartResult>
    startModify: (args: { engine: string; model?: string }) => Promise<StartResult>
    send: (sessionId: string, prompt: string) => Promise<{ ok: boolean; error?: string }>
    cancel: (sessionId: string) => Promise<{ ok: boolean }>
    onEvent: (cb: (payload: EngineEventPayload) => void) => () => void
  }
  net: {
    request: (req: NetRequest) => Promise<NetResult>
  }
  files: {
    root: () => Promise<string>
    list: (path?: string) => Promise<FilesListResult>
    read: (path: string) => Promise<FilesReadResult>
    write: (path: string, contents: string) => Promise<FilesResult>
    mkdir: (path: string) => Promise<FilesResult>
    remove: (path: string) => Promise<FilesResult>
  }
  modify: {
    open: () => void
    close: () => void
    toggle: () => void
    onChange: (cb: (open: boolean) => void) => () => void
  }
}

declare global {
  // The normalized event stream the UI renders — mirror of main's engine/types.ts.
  type AgentEvent =
    | { kind: 'session'; sessionId: string }
    | { kind: 'text'; text: string }
    | { kind: 'thinking'; text: string }
    | {
        kind: 'tool'
        name: string
        phase: 'start' | 'update' | 'end'
        id?: string
        verb?: string
        target?: string
        body?: string
      }
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

  interface NetRequest {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }

  interface NetResult {
    ok: boolean
    status?: number
    headers?: Record<string, string>
    body?: string
    error?: string
  }

  interface FilesResult {
    ok: boolean
    error?: string
  }

  interface FilesListResult extends FilesResult {
    entries?: { name: string; dir: boolean }[]
  }

  interface FilesReadResult extends FilesResult {
    contents?: string
  }

  interface Window {
    electron: ElectronAPI
    api: unknown
    y: YApi
  }
}
