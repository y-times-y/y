import * as React from 'react'
import { latestVerdict, decideVerify } from './userlandStatus'
import { MarkdownBody } from './markdown'
import { defaultRunOptions } from './EngineOptionsPicker'
import { ModifyMark, ModifySendIcon, ModifyStopIcon } from './ModifyIcons'
import { ToolActivity, settleTools, toolVerbFromName } from './ToolActivity'
import type { Msg } from './modifyTypes'
import { ModifyGate } from './ModifyGate'

const MAX_AUTO_RETRIES = 3
const VERIFY_DELAY_MS = 1200

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

function thinkingId(): string {
  return `think-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sealAllThinking(list: Msg[]): Msg[] {
  let touched = false
  const out = list.map((m) => {
    if (m.role === 'thinking' && m.streaming) {
      touched = true
      return { ...m, streaming: false }
    }
    return m
  })
  return touched ? out : list
}

function append(list: Msg[], chunk: string): Msg[] {
  const sealed = sealAllThinking(list)
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
  if (last?.role === 'thinking' && last.streaming) {
    return base.slice(0, -1).concat([{ ...last, text: last.text + chunk, streaming: true }])
  }
  return base.concat([{ role: 'thinking', id: thinkingId(), text: chunk, streaming: true }])
}

function normalizeToolTarget(target?: string): string {
  if (!target) return ''
  const p = target.replace(/\\/g, '/')
  return p.split('/').pop() || p
}

function parseModelId(id: string): { base: string; effort: string } {
  const i = id.indexOf('#effort=')
  return i === -1 ? { base: id, effort: 'medium' } : { base: id.slice(0, i), effort: id.slice(i + 8) }
}

function buildModelId(base: string, effort: string): string {
  return `${base}#effort=${effort}`
}

const SLASH_HELP = 'Commands: /effort <low|medium|high|xhigh|max>, /reasoning <level>, /goal <text>, /goal clear, /clear, /help.'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

function catalogEfforts(catalog: EngineModelCatalog[], engineId: string, base: string): Array<{ id: string; label: string }> {
  return (catalog.find((c) => c.engine === engineId)?.models ?? [])
    .filter((m) => m.id.startsWith(base + '#effort='))
    .map((m) => ({ id: m.id.slice(m.id.indexOf('#effort=') + 8), label: m.label.split(' · ')[1] ?? m.id }))
}

function langFromTarget(target?: string): string {
  const ext = target?.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python', sh: 'shell', bash: 'shell',
    json: 'json', yaml: 'yaml', yml: 'yaml'
  }
  return map[ext] || 'typescript'
}

function activeChatConfig(state: AppState, catalog: EngineModelCatalog[]): {
  engineId: string
  modelId: string
  runOptions: EngineRunOptions
  goal: string
} {
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0]
  const chat = project?.chats.find((c) => c.id === state.activeChatId) ?? project?.chats[0]
  const engineId = chat?.engineId || 'claude-code'
  const modelId =
    chat?.modelId ||
    catalog.find((c) => c.engine === engineId)?.defaultModel ||
    'claude-sonnet-4-6#effort=medium'
  return {
    engineId,
    modelId,
    runOptions: chat?.runOptions || defaultRunOptions(),
    goal: chat?.goal || ''
  }
}

function isEditTool(m: Msg): boolean {
  if (m.role !== 'tool' || m.system) return false
  const verb = m.verb || toolVerbFromName(m.name)
  return verb === 'Edit' || verb === 'Write'
}

function isRequestTool(m: Msg): boolean {
  if (m.role !== 'tool' || m.system) return false
  const label = `${m.verb || ''} ${m.name || ''}`.toLowerCase()
  return label.includes('request')
}

function mergeBody(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return a + '\n' + b
}

function mergeAdjacentSameFileEdit(list: Msg[]): Msg[] {
  if (list.length < 2) return list
  const last = list[list.length - 1]
  const prev = list[list.length - 2]
  if (
    last.role !== 'tool' ||
    prev.role !== 'tool' ||
    last.streaming ||
    prev.streaming ||
    !isEditTool(last) ||
    !isEditTool(prev) ||
    normalizeToolTarget(last.target) !== normalizeToolTarget(prev.target)
  ) {
    return list
  }
  return list.slice(0, -2).concat([
    {
      ...prev,
      id: last.id ?? prev.id,
      name: last.name,
      verb: last.verb ?? prev.verb,
      target: last.target ?? prev.target,
      body: mergeBody(prev.body, last.body),
      streaming: false
    }
  ])
}

function upsertTool(list: Msg[], e: Extract<AgentEvent, { kind: 'tool' }>): Msg[] {
  const sealed = sealAllThinking(list)
  const verb = e.verb || toolVerbFromName(e.name)
  if (e.name === 'hook' || verb.toLowerCase().includes('hook')) return settleTools(sealed)
  const isLive = e.phase !== 'end'
  const last = sealed[sealed.length - 1]
  const sameTool =
    last?.role === 'tool' &&
    !last.system &&
    Boolean(e.id && last.id === e.id)

  const base = sameTool ? sealed : settleTools(sealed)
  const prev = base[base.length - 1]
  const next = {
    role: 'tool' as const,
    name: e.name,
    id: e.id ?? `${e.name}-${e.target ?? e.verb ?? 'tool'}-${base.length}`,
    verb,
    target: e.target,
    body: e.body,
    streaming: isLive
  }
  const merge =
    prev?.role === 'tool' &&
    !prev.system &&
    Boolean(e.id && prev.id === e.id)
  if (merge) {
    const merged = base.slice(0, -1).concat([
      {
        ...prev,
        ...next,
        target: e.target ?? prev.target,
        body: e.body ?? prev.body
      }
    ])
    return isLive ? merged : mergeAdjacentSameFileEdit(merged)
  }
  if (prev?.role === 'tool' && isRequestTool(prev) && isEditTool(next)) {
    const replaced = base.slice(0, -1).concat([{ ...next, id: next.id ?? prev.id }])
    return isLive ? replaced : mergeAdjacentSameFileEdit(replaced)
  }
  const appended = base.concat([next])
  return isLive ? appended : mergeAdjacentSameFileEdit(appended)
}

function finishStreaming(list: Msg[]): Msg[] {
  return settleTools(sealAllThinking(list))
}

function ModifyChat({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [engines, setEngines] = React.useState<string[]>([])
  const [catalog, setCatalog] = React.useState<EngineModelCatalog[]>([])
  const [engineId, setEngineId] = React.useState('claude-code')
  const [modelId, setModelId] = React.useState('claude-sonnet-4-6#effort=medium')
  const [runOptions, setRunOptions] = React.useState<EngineRunOptions>(() => defaultRunOptions())
  const [goal, setGoal] = React.useState('')
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
  const streamQueueRef = React.useRef<
    Array<
      | { kind: 'text'; text: string }
      | { kind: 'thinking'; text: string }
      | { kind: 'tool'; event: Extract<AgentEvent, { kind: 'tool' }> }
    >
  >([])
  const streamRafRef = React.useRef<number | null>(null)

  const flushStreamQueue = React.useCallback((): void => {
    streamRafRef.current = null
    const batch = streamQueueRef.current
    if (!batch.length) return
    streamQueueRef.current = []
    setMessages((m) => {
      let next = m
      for (const item of batch) {
        if (item.kind === 'text') next = append(next, item.text)
        else if (item.kind === 'thinking') next = appendThinking(next, item.text)
        else next = upsertTool(next, item.event)
      }
      return next
    })
  }, [])

  const enqueueStream = React.useCallback(
    (
      item:
        | { kind: 'text'; text: string }
        | { kind: 'thinking'; text: string }
        | { kind: 'tool'; event: Extract<AgentEvent, { kind: 'tool' }> }
    ): void => {
      streamQueueRef.current.push(item)
      if (streamRafRef.current != null) return
      streamRafRef.current = requestAnimationFrame(flushStreamQueue)
    },
    [flushStreamQueue]
  )

  const scrollLogToEnd = React.useCallback((): void => {
    requestAnimationFrame(() => {
      const el = logRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

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

  const catalogRef = React.useRef(catalog)
  catalogRef.current = catalog
  const runOptionsRef = React.useRef(runOptions)
  runOptionsRef.current = runOptions

  const start = React.useCallback((id: string, model?: string, options = runOptionsRef.current, keepMessages = false): void => {
    const resolved =
      model ??
      catalogRef.current.find((c) => c.engine === id)?.defaultModel ??
      'claude-sonnet-4-6#effort=medium'
    if (sidRef.current) window.y.engine.cancel(sidRef.current)
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
    sidRef.current = null
    firstTurnRef.current = true
    turnStartAtRef.current = 0
    retriesRef.current = 0
    setEngineId(id)
    setModelId(resolved)
    setRunOptions(options)
    setSessionId(null)
    if (!keepMessages) setMessages([])
    setStatus('')
    setError('')
    setBusy(false)
    setPendingDiff(null)
    void window.y.engine.startModify({ engine: id, model: resolved, options }).then((res) => {
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
      if (e.kind === 'status') {
        setStatus(e.status)
      } else if (e.kind === 'text') {
        setStatus('')
        enqueueStream({ kind: 'text', text: e.text })
      } else if (e.kind === 'thinking') {
        setStatus('')
        enqueueStream({ kind: 'thinking', text: e.text })
      } else if (e.kind === 'tool') {
        setStatus('')
        enqueueStream({ kind: 'tool', event: e })
      } else if (e.kind === 'suggestion') {
        setStatus('')
        setMessages((m) => m.concat([{ role: 'tool', name: `Suggested next: ${e.text}`, system: true }]))
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
    return () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
      if (streamRafRef.current != null) cancelAnimationFrame(streamRafRef.current)
      off()
    }
  }, [refreshPendingGate, enqueueStream])

  React.useEffect(() => {
    let cancelled = false
    void Promise.all([window.y.engine.list(), window.y.engine.models(), window.y.app.getState()]).then(([ids, cat, state]) => {
      if (cancelled) return
      if (ids.length) setEngines(ids)
      setCatalog(cat)
      const config = activeChatConfig(state, cat)
      setGoal(config.goal)
      start(config.engineId, config.modelId, config.runOptions)
    })
    return () => {
      cancelled = true
    }
  }, [start])

  React.useEffect(() => {
    void refreshPendingGate()
  }, [refreshPendingGate])

  const engineLabel = LABELS[engineId] || engineId
  const pickerCatalog: EngineModelCatalog[] = catalog.length > 0 ? catalog : engines.map((id) => ({
    engine: id,
    label: LABELS[id] || id,
    defaultModel: modelId,
    models: [{ id: modelId, label: modelId }]
  }))

  const addSystemNote = (text: string): void => {
    setMessages((m) => finishStreaming(m).concat([{ role: 'tool', name: text, system: true }]))
  }

  const modelWithEffort = (effort: string): string | null => {
    const { base } = parseModelId(modelId)
    const efforts = catalogEfforts(pickerCatalog, engineId, base)
    if (!efforts.some((item) => item.id === effort)) return null
    return buildModelId(base, effort)
  }

  const applyEffortCommand = (effort: string, label: string): boolean => {
    if (!EFFORTS.includes(effort)) {
      addSystemNote('Unknown reasoning effort. Use low, medium, high, xhigh, or max.')
      return true
    }
    const nextModel = modelWithEffort(effort)
    if (!nextModel) {
      addSystemNote(`${engineLabel} does not expose ${effort} effort for the selected model.`)
      return true
    }
    start(engineId, nextModel, runOptions, true)
    addSystemNote(`${label}: reasoning effort set to ${effort}.`)
    return true
  }

  const clearChat = (): void => {
    if (sidRef.current) window.y.engine.cancel(sidRef.current)
    sidRef.current = null
    firstTurnRef.current = true
    retriesRef.current = 0
    setMessages([])
    setError('')
    setStatus('')
    setBusy(false)
    setPendingDiff(null)
    start(engineId, modelId, runOptions)
  }

  const handleSlashCommand = (text: string): boolean => {
    if (!text.startsWith('/')) return false
    const [raw, ...rest] = text.slice(1).trim().split(/\s+/)
    const cmd = raw.toLowerCase()
    const arg = rest.join(' ').trim()
    if (!cmd || cmd === 'help') {
      addSystemNote(SLASH_HELP)
      return true
    }
    if (cmd === 'fast') return applyEffortCommand('low', 'Fast mode')
    if (cmd === 'effort' || cmd === 'reasoning') return applyEffortCommand(arg.toLowerCase(), 'Reasoning')
    if (cmd === 'goal') {
      if (!arg) {
        addSystemNote(goal ? `Current goal: ${goal}` : 'No goal is set.')
        return true
      }
      if (['clear', 'off', 'reset'].includes(arg.toLowerCase())) {
        setGoal('')
        addSystemNote('Goal cleared.')
        return true
      }
      setGoal(arg)
      addSystemNote(`Goal set: ${arg}`)
      return true
    }
    if (cmd === 'clear') {
      clearChat()
      return true
    }
    addSystemNote(`Unknown command /${cmd}. ${SLASH_HELP}`)
    return true
  }

  const send = (): void => {
    const text = input.trim()
    if (!text || busy) return
    if (handleSlashCommand(text)) {
      setInput('')
      return
    }
    if (!sessionId) return
    setError('')
    setMessages((m) => sealAllThinking(settleTools(m)).concat([{ role: 'user', text }]))
    const request = goal ? `Current goal:\n${goal}\n\nUser request:\n${text}` : text
    const toSend = firstTurnRef.current ? PREAMBLE + request : request
    firstTurnRef.current = false
    setInput('')
    retriesRef.current = 0
    setPendingDiff(null)
    turnStartAtRef.current = Date.now()
    setBusy(true)
    setStatus('...')
    scrollLogToEnd()
    void window.y.engine.send(sessionId, toSend)
  }

  const interrupt = (): void => {
    if (!sessionId) return
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current)
      verifyTimerRef.current = null
    }
    void window.y.engine.cancel(sessionId)
    setBusy(false)
    setStatus('Interrupted.')
    setError('')
    retriesRef.current = 0
  }

  const sendOrInterrupt = (): void => {
    if (busy) {
      interrupt()
      return
    }
    send()
  }

  return (
    <div className="modify">
      <div className="modify-head">
        <div className="modify-head-row">
          <div className="modify-title-wrap">
            <span className="modify-mark">
              <ModifyMark size={16} />
            </span>
            <span className="modify-title">Modify</span>
          </div>
          <button type="button" className="modify-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modify-head-pickers">
          <div className="modify-current-model">
            Using {engineLabel} · {modelId.split('#effort=')[0]}
          </div>
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
          const key = `${m.role}-${'id' in m && m.id ? m.id : i}`
          if (m.role === 'thinking') {
            return null
          }
          if (m.role === 'tool') {
            if (m.system) {
              return (
                <div key={key} className="modify-tool-note">
                  {m.name}
                </div>
              )
            }
            const verb = m.verb || toolVerbFromName(m.name)
            return (
              <ToolActivity
                key={key}
                verb={verb}
                target={m.target}
                body={m.body}
                live={m.streaming}
                lang={langFromTarget(m.target)}
              />
            )
          }
          if (m.role === 'user') {
            return (
              <div key={key} className="modify-msg modify-user">
                <span className="modify-role">you</span>
                <div className="modify-text modify-user-bubble">{m.text}</div>
              </div>
            )
          }
          return (
            <div key={key} className="modify-msg modify-assistant">
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
              onClick={sendOrInterrupt}
              disabled={!sessionId}
              aria-label={busy ? 'Interrupt' : 'Send'}
            >
              {busy ? <ModifyStopIcon size={16} /> : <ModifySendIcon size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModifyChat
