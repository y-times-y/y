import { BrowserWindow } from 'electron'
import type {
  AgentEvent,
  Engine,
  EngineCommand,
  EngineCommandResult,
  EngineRunOptions,
  Session,
  StartOpts
} from './types'
import { claudeEngine } from './claude'
import { codexEngine } from './codex'
import { listEngineModels, type EngineModelCatalog } from './models'

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
  options?: EngineRunOptions
  cwd?: string
  mode?: StartOpts['mode']
}

function parseModelChoice(model?: string): Pick<StartOpts, 'model' | 'effort'> {
  if (!model) return {}
  const marker = '#effort='
  const i = model.indexOf(marker)
  if (i === -1) return { model }
  const effort = model.slice(i + marker.length)
  return {
    model: model.slice(0, i),
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)
      ? (effort as StartOpts['effort'])
      : undefined
  }
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
  const cwd = args.options?.workingDirectory?.trim() || args.cwd

  // The session owns its id (created in its constructor). The emit callback
  // needs that id; it only fires after send(), by which point `id` is set.
  let id = ''
  const modelChoice = parseModelChoice(args.model)
  const session = engine.startSession(
    { ...modelChoice, options: args.options, cwd, mode: args.mode },
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

export async function commandSession(
  sessionId: string,
  command: EngineCommand
): Promise<EngineCommandResult> {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, error: 'No such session' }
  if (!session.command) return { ok: false, error: 'This engine does not expose native commands.' }
  return session.command(command)
}

export function cancelSession(sessionId: string): { ok: boolean } {
  sessions.get(sessionId)?.cancel()
  return { ok: true }
}

// The ids the UI can offer in its engine picker — Kernel is the source of truth.
export function listEngines(): string[] {
  return Object.keys(engines)
}

export function listModels(): EngineModelCatalog[] {
  return listEngineModels(listEngines())
}
