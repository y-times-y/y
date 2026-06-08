import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, Engine, Session, StartOpts } from './types'

// The subset of Claude Code's stream-json output we read. The CLI emits one of
// these JSON objects per line; we only pick out the fields we care about.
interface ClaudeLine {
  type?: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: unknown
  event?: ClaudeStreamEvent
  message?: { content?: Array<{ type?: string; text?: string; name?: string }> }
}

interface ClaudeStreamEvent {
  type?: string
  delta?: { type?: string; text?: string; thinking?: string }
  content_block?: { type?: string; name?: string }
}

// Drives the official `claude` CLI in non-interactive streaming mode. Each turn
// is ONE short-lived process; we remember the engine's session id so the next
// turn continues the same conversation via --resume.
class ClaudeSession implements Session {
  readonly id = randomUUID() // OUR id — routes IPC events back to this chat
  private claudeSessionId: string | null = null // claude's id — for --resume
  private child: ChildProcess | null = null
  private streamedText = false // did we already stream deltas this turn?

  constructor(
    private opts: StartOpts,
    private emit: (event: AgentEvent) => void
  ) {}

  send(prompt: string): void {
    // One turn at a time keeps the model simple for now.
    if (this.child) {
      this.emit({ kind: 'error', message: 'A turn is already running.' })
      return
    }
    this.streamedText = false

    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages', // token-by-token streaming
      '--verbose', // required alongside stream-json with -p
      // Read-only toolset so the agent can explore the codebase but never modify
      // it. --tools limits which built-ins exist; --allowedTools auto-approves
      // them so headless mode (no permission prompts) doesn't silently block them.
      '--tools',
      'Read,Glob,Grep',
      '--allowedTools',
      'Read,Glob,Grep'
    ]
    if (this.opts.model) args.push('--model', this.opts.model)
    if (this.claudeSessionId) args.push('--resume', this.claudeSessionId)

    const child = spawn('claude', args, {
      cwd: this.opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

    // stream-json is newline-delimited JSON. A single read can contain partial
    // lines, so buffer and split on '\n'.
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
      this.emit({ kind: 'error', message: `Failed to start claude: ${err.message}` })
    })

    child.on('close', (code) => {
      this.child = null
      if (code !== 0 && code !== null) {
        this.emit({ kind: 'error', message: stderr.trim() || `claude exited with code ${code}` })
      }
    })
  }

  cancel(): void {
    this.child?.kill('SIGTERM')
    this.child = null
  }

  private handleLine(line: string): void {
    let obj: ClaudeLine
    try {
      obj = JSON.parse(line) as ClaudeLine
    } catch {
      return // ignore any non-JSON noise
    }

    if (typeof obj.session_id === 'string') this.claudeSessionId = obj.session_id

    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init' && obj.session_id) {
          this.emit({ kind: 'session', sessionId: obj.session_id })
        }
        break
      case 'stream_event':
        if (obj.event) this.handleStreamEvent(obj.event)
        break
      case 'assistant':
        // Fallback: if we never saw partial deltas, surface the full text block.
        if (!this.streamedText) this.emitAssistantText(obj.message)
        break
      case 'result':
        this.emit({
          kind: 'result',
          ok: obj.is_error !== true,
          summary: typeof obj.result === 'string' ? obj.result : undefined
        })
        break
    }
  }

  private handleStreamEvent(ev: ClaudeStreamEvent): void {
    if (ev.type === 'content_block_delta') {
      const d = ev.delta
      if (d?.type === 'text_delta' && typeof d.text === 'string') {
        this.streamedText = true
        this.emit({ kind: 'text', text: d.text })
      } else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string') {
        this.emit({ kind: 'thinking', text: d.thinking })
      }
    } else if (ev.type === 'content_block_start') {
      const block = ev.content_block
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        this.emit({ kind: 'tool', name: block.name, phase: 'start' })
      } else if (block?.type === 'text' && this.streamedText) {
        // Claude sends its between-tool narration as separate text blocks. Insert a
        // paragraph break so they don't render as one run-on line in the chat.
        this.emit({ kind: 'text', text: '\n\n' })
      }
    }
  }

  private emitAssistantText(message: ClaudeLine['message']): void {
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        this.emit({ kind: 'text', text: block.text })
      }
    }
  }
}

export const claudeEngine: Engine = {
  id: 'claude-code',
  startSession(opts, onEvent) {
    return new ClaudeSession(opts, onEvent)
  }
}
