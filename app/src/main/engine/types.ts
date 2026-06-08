// The pluggable engine layer (ARCHITECTURE §6). One interface, thin adapters;
// the UI never knows which CLI runs underneath.

// The ONE normalized shape the UI renders, no matter which engine produced it.
// Each adapter's job is to translate its CLI's native output into these events.
export type AgentEvent =
  | { kind: 'session'; sessionId: string } // engine reported its conversation id
  | { kind: 'text'; text: string } // a chunk of assistant reply
  | { kind: 'thinking'; text: string } // a chunk of reasoning (optional)
  | { kind: 'tool'; name: string; phase: 'start' | 'end' } // tool activity
  | { kind: 'result'; ok: boolean; summary?: string } // the turn finished
  | { kind: 'error'; message: string } // something went wrong

export interface StartOpts {
  model?: string
  cwd?: string
}

// A live conversation with one engine. send() runs one turn; the engine streams
// AgentEvents back through the onEvent callback the manager wires up at start.
export interface Session {
  readonly id: string
  send(prompt: string): void
  cancel(): void
}

export interface Engine {
  readonly id: string // "claude-code" | "codex" | ...
  startSession(opts: StartOpts, onEvent: (event: AgentEvent) => void): Session
}
