import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, Engine, Session, StartOpts } from './types'

// The subset of `codex exec --json` output we read. Codex uses a thread/turn/item
// model: a thread.started gives the session id, agent_message items carry the
// reply (as one full block, not token deltas), and turn.completed ends the turn.
interface CodexLine {
  type?: string
  thread_id?: string
  item?: { id?: string; type?: string; text?: string; command?: string }
  error?: { message?: string }
  message?: string
}

// Drives the official `codex` CLI non-interactively. Like the Claude adapter,
// each turn is one short-lived process; we remember codex's thread id and use
// `codex exec resume <id>` to continue the conversation on later turns.
class CodexSession implements Session {
  readonly id = randomUUID() // OUR id — routes IPC events back to this chat
  private threadId: string | null = null // codex's id — for resume
  private child: ChildProcess | null = null
  private sawResult = false // did we already emit a result this turn?

  constructor(
    private opts: StartOpts,
    private emit: (event: AgentEvent) => void
  ) {}

  send(prompt: string): void {
    if (this.child) {
      this.emit({ kind: 'error', message: 'A turn is already running.' })
      return
    }
    this.sawResult = false

    // First turn: `codex exec <prompt>`. Later turns: `codex exec resume <id> <prompt>`.
    const resuming = this.threadId !== null
    const base = resuming
      ? ['exec', 'resume', this.threadId as string, prompt]
      : ['exec', prompt]
    const args = [
      ...base,
      '--json', // JSONL events on stdout
      '--skip-git-repo-check' // the chat's cwd may not be a git repo
    ]
    // --sandbox is only valid on the initial `exec`; `resume` rejects the flag,
    // so we pin read-only there via a -c config override instead (verified flow).
    if (resuming) {
      args.push('-c', 'sandbox_mode=read-only') // Phase 4b: no writes on resume
    } else {
      args.push('--sandbox', 'read-only') // Phase 4b: no writes
    }
    if (this.opts.model) args.push('-m', this.opts.model)

    const child = spawn('codex', args, {
      cwd: this.opts.cwd,
      // stdin 'ignore' = immediate EOF, so codex doesn't block "reading from stdin".
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

    let buf = ''
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) this.handleLine(line)
      }
    })

    let stderr = ''
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => (stderr += chunk))

    child.on('error', (err) => {
      this.child = null
      this.emit({ kind: 'error', message: `Failed to start codex: ${err.message}` })
    })

    child.on('close', (code) => {
      this.child = null
      // codex can exit non-zero on a benign memories/db warning even after a
      // successful turn, so only surface an error if we never saw a result.
      if (!this.sawResult && code !== 0 && code !== null) {
        this.emit({ kind: 'error', message: stderr.trim() || `codex exited with code ${code}` })
      }
    })
  }

  cancel(): void {
    this.child?.kill('SIGTERM')
    this.child = null
  }

  private handleLine(line: string): void {
    let obj: CodexLine
    try {
      obj = JSON.parse(line) as CodexLine
    } catch {
      return
    }

    switch (obj.type) {
      case 'thread.started':
        if (obj.thread_id) {
          this.threadId = obj.thread_id
          this.emit({ kind: 'session', sessionId: obj.thread_id })
        }
        break
      case 'item.completed':
        this.handleItem(obj.item)
        break
      case 'turn.completed':
        this.sawResult = true
        this.emit({ kind: 'result', ok: true })
        break
      case 'turn.failed':
        this.sawResult = true
        this.emit({ kind: 'result', ok: false, summary: obj.error?.message })
        break
      case 'error':
        this.emit({ kind: 'error', message: obj.message || obj.error?.message || 'codex error' })
        break
    }
  }

  private handleItem(item: CodexLine['item']): void {
    if (!item) return
    switch (item.type) {
      case 'agent_message':
        if (typeof item.text === 'string') this.emit({ kind: 'text', text: item.text })
        break
      case 'reasoning':
        if (typeof item.text === 'string') this.emit({ kind: 'thinking', text: item.text })
        break
      case 'command_execution':
        this.emit({ kind: 'tool', name: item.command || 'shell', phase: 'end' })
        break
    }
  }
}

export const codexEngine: Engine = {
  id: 'codex',
  startSession(opts, onEvent) {
    return new CodexSession(opts, onEvent)
  }
}
