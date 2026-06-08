import { BrowserWindow } from 'electron'
import type { AgentEvent, Engine, Session } from './types'
import { claudeEngine } from './claude'
import { codexEngine } from './codex'

// The engines y knows about. Adding a new engine is just one more entry here —
// the IPC, the streaming, and the entire chat UI stay exactly the same.
const engines: Record<string, Engine> = {
  [claudeEngine.id]: claudeEngine,
  [codexEngine.id]: codexEngine
}

// Live conversations, keyed by our session id.
const sessions = new Map<string, Session>()

interface StartArgs {
  engine: string
  model?: string
  cwd?: string
  mode?: 'read' | 'write'
}

// The "streaming IPC": fire one push per event, tagged with the session id so
// the right chat in the renderer can pick it up. Unlike invoke/handle (one
// answer), this fires many times across a single turn.
function broadcast(sessionId: string, event: AgentEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('engine:event', { sessionId, event })
  }
}

export function startSession(args: StartArgs): { ok: boolean; sessionId?: string; error?: string } {
  const engine = engines[args.engine]
  if (!engine) return { ok: false, error: `Unknown engine: ${args.engine}` }

  // The session owns its id (created in its constructor). The emit callback
  // needs that id; it only fires after send(), by which point `id` is set.
  let id = ''
  const session = engine.startSession(
    { model: args.model, cwd: args.cwd, mode: args.mode },
    (event) => broadcast(id, event)
  )
  id = session.id
  sessions.set(id, session)
  return { ok: true, sessionId: id }
}

export function sendToSession(sessionId: string, prompt: string): { ok: boolean; error?: string } {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'No such session' }
  session.send(prompt)
  return { ok: true }
}

export function cancelSession(sessionId: string): { ok: boolean } {
  sessions.get(sessionId)?.cancel()
  return { ok: true }
}

// The ids the UI can offer in its engine picker — Kernel is the source of truth.
export function listEngines(): string[] {
  return Object.keys(engines)
}
