import * as React from 'react'

interface Msg {
  role: 'user' | 'assistant'
  text: string
}

// Friendly names for the engine ids the Kernel reports.
const ENGINE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

// Kernel-side chat (Phase 4a/4b). It talks to the engine purely through the
// window.y.engine bricks — start a session, send prompts, and append the
// streamed text events as they arrive. The same code drives any engine.
function Chat(): React.JSX.Element {
  const [engines, setEngines] = React.useState<string[]>([])
  const [engineId, setEngineId] = React.useState('claude-code')
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')

  // The subscription fires from outside React's render, so read the live id
  // from a ref (state would be stale inside the long-lived listener closure).
  const sessionIdRef = React.useRef<string | null>(null)
  const logRef = React.useRef<HTMLDivElement>(null)

  const handleEvent = React.useCallback((event: AgentEvent): void => {
    switch (event.kind) {
      case 'text':
        setStatus('')
        setMessages((prev) => appendAssistant(prev, event.text))
        break
      case 'thinking':
        setStatus('thinking…')
        break
      case 'tool':
        setStatus(`using ${event.name}…`)
        break
      case 'result':
        setBusy(false)
        setStatus('')
        if (!event.ok) setError(event.summary || 'The engine reported an error.')
        break
      case 'error':
        setBusy(false)
        setStatus('')
        setError(event.message)
        break
    }
  }, [])

  // Start (or restart) a session for a given engine, resetting the transcript.
  const startEngine = React.useCallback((id: string) => {
    if (sessionIdRef.current) void window.y.engine.cancel(sessionIdRef.current)
    sessionIdRef.current = null
    setSessionId(null)
    setMessages([])
    setStatus('')
    setError('')
    setBusy(false)
    void window.y.engine.start({ engine: id }).then((res) => {
      if (!res.ok || !res.sessionId) {
        setError(res.error || 'Failed to start engine')
        return
      }
      sessionIdRef.current = res.sessionId
      setSessionId(res.sessionId)
    })
  }, [])

  // Subscribe to the event stream once for the component's lifetime. It always
  // reads the LIVE session id from the ref, so it keeps working after a switch.
  React.useEffect(() => {
    const off = window.y.engine.onEvent(({ sessionId: sid, event }) => {
      if (sid !== sessionIdRef.current) return // ignore other / old sessions
      handleEvent(event)
    })
    return off
  }, [handleEvent])

  // Load the available engines from the Kernel, then start the default one.
  React.useEffect(() => {
    void window.y.engine.list().then((ids) => {
      if (ids.length) setEngines(ids)
    })
    startEngine('claude-code')
  }, [startEngine])

  const onEngineChange = (id: string): void => {
    setEngineId(id)
    startEngine(id)
  }

  // Keep the newest message in view.
  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, status])

  const send = (): void => {
    const text = input.trim()
    if (!text || !sessionId || busy) return
    setError('')
    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setBusy(true)
    setStatus('…')
    void window.y.engine.send(sessionId, text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <label className="chat-engine">
          engine
          <select
            value={engineId}
            onChange={(e) => onEngineChange(e.target.value)}
            disabled={busy}
          >
            {engines.map((id) => (
              <option key={id} value={id}>
                {ENGINE_LABELS[id] ?? id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !error && (
          <div className="chat-empty">Ask the engine something to start.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            <span className="chat-role">{m.role === 'user' ? 'you' : 'y'}</span>
            <div className="chat-text">{m.text}</div>
          </div>
        ))}
        {status && <div className="chat-status">{status}</div>}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={sessionId ? 'Message the engine…  (Enter to send)' : 'Starting engine…'}
          rows={2}
        />
        <button className="btn" onClick={send} disabled={!sessionId || busy}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

// Stream text into the current assistant message, or start a new one.
function appendAssistant(prev: Msg[], chunk: string): Msg[] {
  const last = prev[prev.length - 1]
  if (last && last.role === 'assistant') {
    return [...prev.slice(0, -1), { ...last, text: last.text + chunk }]
  }
  return [...prev, { role: 'assistant', text: chunk }]
}

export default Chat
