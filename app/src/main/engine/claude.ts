import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, Engine, Session, StartOpts } from './types'
import { formatToolFinal, formatToolStream, type ToolPresentation } from './toolFormat'

// The subset of Claude Code's stream-json output we read. The CLI emits one of
// these JSON objects per line; we only pick out the fields we care about.
interface ClaudeLine {
  type?: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: unknown
  event?: ClaudeStreamEvent
  message?: {
    content?: Array<{
      type?: string
      text?: string
      thinking?: string
      name?: string
      id?: string
      input?: Record<string, unknown>
    }>
  }
}

interface ClaudeStreamEvent {
  type?: string
  index?: number
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
  content_block?: { type?: string; name?: string; id?: string; input?: Record<string, unknown> }
}

interface ToolBlock {
  id?: string
  name: string
  json: string
}

// Drives the official `claude` CLI in non-interactive streaming mode. Each turn
// is ONE short-lived process; we remember the engine's session id so the next
// turn continues the same conversation via --resume.
class ClaudeSession implements Session {
  readonly id = randomUUID() // OUR id — routes IPC events back to this chat
  private claudeSessionId: string | null = null // claude's id — for --resume
  private child: ChildProcess | null = null
  private streamedText = false // did we already stream deltas this turn?
  private blocks = new Map<number, ToolBlock>() // in-flight tool_use blocks by index

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
    this.blocks.clear()

    // Read mode (the normal chat): explore only. Write mode (the Modify chat):
    // also allow Edit/Write so the agent can change Userland. --tools limits which
    // built-ins exist; --allowedTools auto-approves them so headless mode (no
    // permission prompts) doesn't silently block them.
    const tools = this.opts.mode === 'write' ? 'Read,Glob,Grep,Edit,Write' : 'Read,Glob,Grep'
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages', // token-by-token streaming
      '--verbose', // required alongside stream-json with -p
      '--tools',
      tools,
      '--allowedTools',
      tools
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
      this.blocks.clear()
      if (code !== 0 && code !== null) {
        this.emit({ kind: 'error', message: stderr.trim() || `claude exited with code ${code}` })
      }
    })
  }

  cancel(): void {
    this.child?.kill('SIGTERM')
    this.child = null
    this.blocks.clear()
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
        // Always surface tool_use from the full assistant message — it has the
        // complete input even when stream-json redacts thinking or we miss deltas.
        this.emitAssistantTools(obj.message)
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
    const idx = ev.index
    if (ev.type === 'content_block_delta') {
      const d = ev.delta
      if (d?.type === 'text_delta' && typeof d.text === 'string') {
        this.streamedText = true
        this.emit({ kind: 'text', text: d.text })
      } else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string' && d.thinking) {
        // Claude Code redacts extended thinking in stream-json — skip empty deltas.
        this.emit({ kind: 'thinking', text: d.thinking })
      } else if (
        d?.type === 'input_json_delta' &&
        typeof d.partial_json === 'string' &&
        typeof idx === 'number'
      ) {
        this.updateToolInput(idx, d.partial_json, 'update')
      }
    } else if (ev.type === 'content_block_start') {
      const block = ev.content_block
      if (block?.type === 'tool_use' && typeof block.name === 'string' && typeof idx === 'number') {
        const seed =
          block.input && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : ''
        this.blocks.set(idx, { id: block.id, name: block.name, json: seed })
        this.emitTool(block.name, block.id, 'start', formatToolStream(block.name, seed))
      } else if (block?.type === 'text' && this.streamedText) {
        // Claude sends its between-tool narration as separate text blocks. Insert a
        // paragraph break so they don't render as one run-on line in the chat.
        this.emit({ kind: 'text', text: '\n\n' })
      }
    } else if (ev.type === 'content_block_stop' && typeof idx === 'number') {
      this.finishToolBlock(idx)
    }
  }

  private emitTool(
    name: string,
    id: string | undefined,
    phase: 'start' | 'update' | 'end',
    presentation: ToolPresentation
  ): void {
    this.emit({ kind: 'tool', name, id, phase, ...presentation })
  }

  private updateToolInput(index: number, chunk: string, phase: 'update' | 'end'): void {
    const block = this.blocks.get(index)
    if (!block) return
    block.json += chunk
    const presentation =
      phase === 'end' ? formatToolFinal(block.name, block.json) : formatToolStream(block.name, block.json)
    this.emitTool(block.name, block.id, phase, presentation)
  }

  private finishToolBlock(index: number): void {
    if (!this.blocks.has(index)) return
    this.updateToolInput(index, '', 'end')
    this.blocks.delete(index)
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

  private emitAssistantTools(message: ClaudeLine['message']): void {
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue
      const json = block.input ? JSON.stringify(block.input) : ''
      this.emitTool(block.name, block.id, 'end', formatToolFinal(block.name, json))
    }
  }
}

export const claudeEngine: Engine = {
  id: 'claude-code',
  startSession(opts, onEvent) {
    return new ClaudeSession(opts, onEvent)
  }
}
