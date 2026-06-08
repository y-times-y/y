import * as React from 'react'

interface Msg {
  role: 'user' | 'assistant'
  text: string
}

// Kernel-side chat (Phase 4a). It talks to the engine purely through the
// window.y.engine bricks — start a session, send prompts, and append the
// streamed text events as they arrive.
function Chat(): React.JSX.Element {
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

  // Start one engine session on mount; subscribe to its event stream.
  React.useEffect(() => {
    void window.y.engine.start({ engine: 'claude-code', model: 'sonnet' }).then((res) => {
      if (!res.ok || !res.sessionId) {
        setError(res.error || 'Failed to start engine')
        return
      }
      sessionIdRef.current = res.sessionId
      setSessionId(res.sessionId)
    })

    const off = window.y.engine.onEvent(({ sessionId: sid, event }) => {
      if (sid !== sessionIdRef.current) return // ignore other sessions
      handleEvent(event)
    })
    return off
  }, [handleEvent])

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
