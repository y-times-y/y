import * as React from 'react'

// The MODIFY chat is KERNEL code — protected, and the one surface allowed to
// change the app. Its engine session runs in WRITE mode pinned to the Userland
// dir (see main: engine:startModify), so the agent can edit panel.tsx and the
// existing watcher → esbuild → hot-swap → auto-rollback runway shows the change
// live. The normal Userland chat, by contrast, can never modify the app.

type Msg = { role: 'user' | 'assistant' | 'tool'; text?: string; name?: string }

const LABELS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

// Prepended once, on the first turn, so the agent knows the environment and rules.
const PREAMBLE =
  'You are the Modify agent for an app called y. Your working directory contains ' +
  'panel.tsx — a single default-exported React component that y renders live as the ' +
  "app's main UI. When I ask for a change, EDIT panel.tsx to make it. Keep it a valid " +
  'TSX file with exactly one default export. The app hot-reloads on save, so just edit ' +
  'the file — do not run build commands. Prefer small, focused edits. Request:\n\n'

function append(list: Msg[], chunk: string): Msg[] {
  const last = list[list.length - 1]
  if (last && last.role === 'assistant') {
    return list.slice(0, -1).concat([{ role: 'assistant', text: (last.text ?? '') + chunk }])
  }
  return list.concat([{ role: 'assistant', text: chunk }])
}

function ModifyChat(): React.JSX.Element {
  const [engines, setEngines] = React.useState<string[]>([])
  const [engineId, setEngineId] = React.useState('claude-code')
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')
  const sidRef = React.useRef<string | null>(null)
  const firstTurnRef = React.useRef(true)

  const start = React.useCallback((id: string): void => {
    if (sidRef.current) window.y.engine.cancel(sidRef.current)
    sidRef.current = null
    firstTurnRef.current = true
    setSessionId(null)
    setMessages([])
    setStatus('')
    setError('')
    setBusy(false)
    void window.y.engine.startModify({ engine: id }).then((res) => {
      if (!res.ok || !res.sessionId) {
        setError(res.error || 'Failed to start the Modify engine')
        return
      }
      sidRef.current = res.sessionId
      setSessionId(res.sessionId)
    })
  }, [])

  React.useEffect(() => {
    const off = window.y.engine.onEvent(({ sessionId: sid, event }) => {
      if (sid !== sidRef.current) return
      const e = event
      if (e.kind === 'text') {
        setStatus('')
        setMessages((m) => append(m, e.text))
      } else if (e.kind === 'thinking') {
        setStatus('thinking…')
      } else if (e.kind === 'tool') {
        setStatus('')
        setMessages((m) => m.concat([{ role: 'tool', name: e.name }]))
      } else if (e.kind === 'result') {
        setBusy(false)
        setStatus('')
        if (!e.ok) setError(e.summary || 'The engine reported an error.')
      } else if (e.kind === 'error') {
        setBusy(false)
        setStatus('')
        setError(e.message)
      }
    })
    void window.y.engine.list().then((ids) => {
      if (ids.length) setEngines(ids)
    })
    start('claude-code')
    return off
  }, [start])

  const onEngineChange = (id: string): void => {
    setEngineId(id)
    start(id)
  }

  const send = (): void => {
    const text = input.trim()
    if (!text || !sessionId || busy) return
    setError('')
    setMessages((m) => m.concat([{ role: 'user', text }]))
    const toSend = firstTurnRef.current ? PREAMBLE + text : text
    firstTurnRef.current = false
    setInput('')
    setBusy(true)
    setStatus('…')
    void window.y.engine.send(sessionId, toSend)
  }

  return (
    <div className="modify">
      <div className="modify-head">
        <span className="modify-title">Modify</span>
        <select
          className="modify-engine"
          value={engineId}
          disabled={busy}
          onChange={(e) => onEngineChange(e.target.value)}
        >
          {engines.map((id) => (
            <option key={id} value={id}>
              {LABELS[id] || id}
            </option>
          ))}
        </select>
      </div>

      <div className="modify-log">
        {messages.length === 0 && !error ? (
          <div className="modify-empty">
            Describe a change to the app. The agent edits Userland and it updates live.
          </div>
        ) : null}
        {messages.map((m, i) => {
          if (m.role === 'tool') {
            const label = m.name || 'tool'
            const shown = label.length > 64 ? label.slice(0, 64) + '…' : label
            return (
              <div key={i} className="modify-tool">
                {'→ ' + shown}
              </div>
            )
          }
          return (
            <div key={i} className={'modify-msg' + (m.role === 'user' ? ' modify-user' : '')}>
              <span className="modify-role">{m.role === 'user' ? 'you' : 'y'}</span>
              <div className="modify-text">{m.text}</div>
            </div>
          )
        })}
        {status ? <div className="modify-status">{status}</div> : null}
        {error ? <div className="modify-error">{error}</div> : null}
      </div>

      <div className="modify-input">
        <textarea
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={sessionId ? 'Describe a change…' : 'Starting Modify engine…'}
        />
        <button className="btn" onClick={send} disabled={!sessionId || busy}>
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}

export default ModifyChat
