import * as React from 'react'
import { latestVerdict, decideVerify } from './userlandStatus'
import { MarkdownBody } from './markdown'
import { Picker } from './Picker'
import { ModifyMark, ModifySendIcon } from './ModifyIcons'
import { ToolActivity, settleTools, toolVerbFromName } from './ToolActivity'
import { ModifyGate } from './ModifyGate'

const MAX_AUTO_RETRIES = 3
const VERIFY_DELAY_MS = 1200

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'thinking'; text: string; streaming?: boolean }
  | {
      role: 'tool'
      name: string
      id?: string
      verb?: string
      target?: string
      body?: string
      streaming?: boolean
      system?: boolean
    }

const LABELS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

const PREAMBLE =
  'You are the Modify agent for an app called y. Your working directory contains ' +
  'panel.tsx — a single default-exported React component that y renders live as the ' +
  "app's main UI. When I ask for a change, EDIT panel.tsx to make it. Keep it a valid " +
  'TSX file with exactly one default export. The app hot-reloads on save, so just edit ' +
  'the file — do not run build commands. Only `react` can be imported; everything else ' +
  'is on the global `window.y`. Available capability bricks (each prompts the user for ' +
  'consent the first time): window.y.net.request({url,method,headers,body}) -> ' +
  '{ok,status,body} for network/APIs; window.y.files.{list,read,write,mkdir,remove}(path) ' +
  'for a private workspace folder; and the <webview src=…> tag is enabled for embedding ' +
  'web pages (e.g. to build a browser). Prefer small, focused edits. Request:\n\n'

function append(list: Msg[], chunk: string): Msg[] {
  const sealed = sealThinking(list)
  const last = sealed[sealed.length - 1]
  // Claude inserts a paragraph break before each post-tool narration block. If the
  // last message is a tool card, skip it — the next text chunk starts a fresh bubble.
  if (chunk === '\n\n' && last?.role === 'tool') return sealed
  const base = settleTools(sealed)
  const prev = base[base.length - 1]
  if (prev && prev.role === 'assistant') {
    return base.slice(0, -1).concat([{ role: 'assistant', text: prev.text + chunk }])
  }
  return base.concat([{ role: 'assistant', text: chunk }])
}

function appendThinking(list: Msg[], chunk: string): Msg[] {
  if (!chunk) return list
  const base = settleTools(list)
  const last = base[base.length - 1]
  if (last && last.role === 'thinking' && last.streaming) {
    return base.slice(0, -1).concat([{ role: 'thinking', text: last.text + chunk, streaming: true }])
  }
  return base.concat([{ role: 'thinking', text: chunk, streaming: true }])
}

function upsertTool(list: Msg[], e: Extract<AgentEvent, { kind: 'tool' }>): Msg[] {
  const sealed = sealThinking(list)
  const last = sealed[sealed.length - 1]
  const sameTool =
    last?.role === 'tool' &&
    !last.system &&
    ((e.id && last.id === e.id) || (!e.id && last.name === e.name && last.streaming))
  const base = sameTool ? sealed : settleTools(sealed)
  const prev = base[base.length - 1]
  const next = {
    role: 'tool' as const,
    name: e.name,
    id: e.id,
    verb: e.verb || toolVerbFromName(e.name),
    target: e.target,
    body: e.body,
    // Stay live after input finishes — Claude is still executing the tool / thinking.
    streaming: true
  }
  const merge =
    prev?.role === 'tool' &&
    !prev.system &&
    ((e.id && prev.id === e.id) || (!e.id && prev.name === e.name && prev.streaming))
  if (merge) {
    return base.slice(0, -1).concat([
      {
        ...prev,
        ...next,
        target: e.target ?? prev.target,
        body: e.body ?? prev.body
      }
    ])
  }
  return base.concat([next])
}

function sealThinking(list: Msg[]): Msg[] {
  const last = list[list.length - 1]
  if (last?.role === 'thinking' && last.streaming) {
    return list.slice(0, -1).concat([{ role: 'thinking', text: last.text, streaming: false }])
  }
  return list
}

function finishStreaming(list: Msg[]): Msg[] {
  return settleTools(sealThinking(list))
}

function ModifyChat({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [engines, setEngines] = React.useState<string[]>([])
  const [engineId, setEngineId] = React.useState('claude-code')
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')
  const [pendingDiff, setPendingDiff] = React.useState<string | null>(null)
  const sidRef = React.useRef<string | null>(null)
  const firstTurnRef = React.useRef(true)
  const turnStartAtRef = React.useRef(0)
  const retriesRef = React.useRef(0)
  const verifyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const logRef = React.useRef<HTMLDivElement | null>(null)

  const refreshPendingGate = React.useCallback(async (): Promise<void> => {
    const d = await window.y.userland.diff()
    if (d.ok && d.dirty && d.diff) setPendingDiff(d.diff)
    else setPendingDiff(null)
  }, [])

  const keepPending = React.useCallback(async (): Promise<void> => {
    await window.y.userland.snapshot()
    setPendingDiff(null)
  }, [])

  const discardPending = React.useCallback(async (): Promise<void> => {
    await window.y.userland.revert()
    setPendingDiff(null)
  }, [])

  const start = React.useCallback((id: string): void => {
    if (sidRef.current) window.y.engine.cancel(sidRef.current)
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
    sidRef.current = null
    firstTurnRef.current = true
    turnStartAtRef.current = 0
    retriesRef.current = 0
    setSessionId(null)
    setMessages([])
    setStatus('')
    setError('')
    setBusy(false)
    setPendingDiff(null)
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
    const scheduleVerify = (): void => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
      verifyTimerRef.current = setTimeout(() => {
        const action = decideVerify(
          latestVerdict(),
          turnStartAtRef.current,
          retriesRef.current,
          MAX_AUTO_RETRIES
        )
        if (action.kind === 'ignore') {
          retriesRef.current = 0
          return
        }
        if (action.kind === 'verified') {
          retriesRef.current = 0
          setMessages((m) => m.concat([{ role: 'tool', name: action.note, system: true }]))
          void refreshPendingGate()
          return
        }
        if (action.kind === 'giveup') {
          retriesRef.current = 0
          setError(action.message)
          void refreshPendingGate()
          return
        }
        const sid = sidRef.current
        if (!sid) {
          retriesRef.current = 0
          return
        }
        retriesRef.current = action.attempt
        setMessages((m) => m.concat([{ role: 'tool', name: action.note, system: true }]))
        turnStartAtRef.current = Date.now()
        setBusy(true)
        setStatus('fixing…')
        void window.y.engine.send(sid, action.prompt)
      }, VERIFY_DELAY_MS)
    }

    const off = window.y.engine.onEvent(({ sessionId: sid, event }) => {
      if (sid !== sidRef.current) return
      const e = event
      if (e.kind === 'text') {
        setStatus('')
        setMessages((m) => append(m, e.text))
      } else if (e.kind === 'thinking') {
        setStatus('')
        setMessages((m) => appendThinking(m, e.text))
      } else if (e.kind === 'tool') {
        setStatus('')
        setMessages((m) => upsertTool(m, e))
      } else if (e.kind === 'result') {
        setBusy(false)
        setStatus('')
        setMessages((m) => finishStreaming(m))
        if (!e.ok) {
          setError(e.summary || 'The engine reported an error.')
          retriesRef.current = 0
          void refreshPendingGate()
        } else {
          scheduleVerify()
        }
      } else if (e.kind === 'error') {
        setBusy(false)
        setStatus('')
        setMessages((m) => finishStreaming(m))
        setError(e.message)
        void refreshPendingGate()
      }
    })
    void window.y.engine.list().then((ids) => {
      if (ids.length) setEngines(ids)
    })
    start('claude-code')
    return () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
      off()
    }
  }, [start, refreshPendingGate])

  React.useEffect(() => {
    void refreshPendingGate()
  }, [refreshPendingGate])

  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages, status])

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
    retriesRef.current = 0
    setPendingDiff(null)
    turnStartAtRef.current = Date.now()
    setBusy(true)
    setStatus('…')
    void window.y.engine.send(sessionId, toSend)
  }

  const engineLabel = LABELS[engineId] || engineId
  const engineOptions = engines.map((id) => ({ id, label: LABELS[id] || id }))

  return (
    <div className="modify">
      <div className="modify-head">
        <div className="modify-title-wrap">
          <span className="modify-mark">
            <ModifyMark size={16} />
          </span>
          <span className="modify-title">Modify</span>
        </div>
        <div className="modify-head-actions">
          <Picker
            value={engineId}
            options={engineOptions}
            onChange={onEngineChange}
            disabled={busy}
            testId="modify-engine-picker"
            className="modify-picker"
          />
          <button type="button" className="modify-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="modify-log" ref={logRef}>
        {messages.length === 0 && !error ? (
          <div className="modify-empty">
            <span className="modify-empty-icon">
              <ModifyMark size={28} />
            </span>
            <p>Describe a UI or behavior change. The agent edits <code>panel.tsx</code> live.</p>
          </div>
        ) : null}
        {messages.map((m, i) => {
          if (m.role === 'thinking') {
            if (!m.text.trim()) return null
            return (
              <div key={i} className={'modify-thinking' + (m.streaming ? ' is-streaming' : '')}>
                <div className="modify-thinking-head">
                  <span className="modify-thinking-label">Reasoning</span>
                  {m.streaming ? <span className="modify-thinking-live">live</span> : null}
                </div>
                <div className="modify-thinking-body">
                  {m.text}
                  {m.streaming ? <span className="modify-stream-cursor" aria-hidden /> : null}
                </div>
              </div>
            )
          }
          if (m.role === 'tool') {
            if (m.system) {
              return (
                <div key={i} className="modify-tool-note">
                  {m.name}
                </div>
              )
            }
            return (
              <ToolActivity
                key={i}
                verb={m.verb || toolVerbFromName(m.name)}
                target={m.target}
                body={m.body}
                live={m.streaming}
                lang="typescript"
              />
            )
          }
          if (m.role === 'user') {
            return (
              <div key={i} className="modify-msg modify-user">
                <span className="modify-role">you</span>
                <div className="modify-text modify-user-bubble">{m.text}</div>
              </div>
            )
          }
          return (
            <div key={i} className="modify-msg modify-assistant">
              <span className="modify-engine-badge">{engineLabel}</span>
              <MarkdownBody text={m.text ?? ''} />
            </div>
          )
        })}
        {status ? <div className="modify-status">{status}</div> : null}
        {error ? <div className="modify-error">{error}</div> : null}
      </div>

      {pendingDiff && !busy ? (
        <ModifyGate
          diff={pendingDiff}
          onKeep={() => void keepPending()}
          onDiscard={() => void discardPending()}
        />
      ) : null}

      <div className="modify-input">
        <div className="modify-input-bar">
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
            placeholder={sessionId ? 'Describe a change to the app…' : 'Starting Modify engine…'}
          />
          <div className="modify-input-row">
            <button
              type="button"
              className="modify-send"
              onClick={send}
              disabled={!sessionId || busy}
              aria-label="Send"
            >
              <ModifySendIcon size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModifyChat
