import * as React from 'react'
import { latestVerdict, decideVerify } from './userlandStatus'
import { MarkdownBody } from './markdown'
import { defaultRunOptions } from './EngineOptionsPicker'
import { ModifyChevronIcon, ModifyCopyIcon, ModifyMark, ModifyMenuIcon, ModifyResetIcon, ModifySendIcon, ModifyStopIcon } from './ModifyIcons'
import { ToolActivity, diffStat, settleTools, toolVerbFromName } from './ToolActivity'
import type { Msg } from './modifyTypes'

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

const SLASH_HELP = 'Commands: /fast, /effort <low|medium|high|xhigh|max>, /reasoning <level>, /goal <text>, /goal clear, /clear, /help.'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MODIFY_SLASH_COMMANDS = [
  { name: '/fast', detail: 'switch to low reasoning effort' },
  { name: '/effort', detail: 'set reasoning effort' },
  { name: '/reasoning', detail: 'set reasoning level' },
  { name: '/goal', detail: 'set or clear the Modify goal' },
  { name: '/clear', detail: 'restart the Modify session' },
  { name: '/help', detail: 'show Modify commands' }
]

type QueuedFollowUp = {
  id: string
  text: string
  steer: boolean
}

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

function retainedContext(list: Msg[]): string {
  return list
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'user' ? '[user]' : '[assistant]'}\n${message.text}`)
    .join('\n\n---\n\n')
}

function formatDuration(durationMs?: number): string {
  const totalSeconds = Math.max(1, Math.round((durationMs ?? 0) / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function formatLiveDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function isEditableToolMessage(message: Msg): message is Extract<Msg, { role: 'tool' }> {
  if (message.role !== 'tool' || message.system) return false
  const verb = (message.verb || toolVerbFromName(message.name || 'tool')).toLowerCase()
  return verb === 'edit' || verb === 'write'
}

function hasCollapsibleWork(work: Array<{ message: Msg; index: number }>): boolean {
  return work.some(({ message }) => message.role === 'tool' && !message.system)
}

function ModifyToolActivity({ message }: { message: Extract<Msg, { role: 'tool' }> }): React.JSX.Element {
  const verb = message.verb || toolVerbFromName(message.name)
  return (
    <ToolActivity
      verb={verb}
      target={message.target}
      body={message.body}
      live={message.streaming}
      lang={langFromTarget(message.target)}
    />
  )
}

function ModifyThinkingBlock({ message }: { message: Extract<Msg, { role: 'thinking' }> }): React.JSX.Element {
  return (
    <details className="modify-thinking" open={message.streaming ? true : undefined} data-testid="thinking-block">
      <summary>
        <span>Thinking</span>
        <ModifyChevronIcon size={12} />
      </summary>
      <div className="modify-thinking-body">{message.text}</div>
    </details>
  )
}

function ModifyWorkSummary({ work, durationMs, interrupted }: { work: Array<{ message: Msg; index: number }>; durationMs?: number; interrupted?: boolean }): React.JSX.Element {
  return (
    <details className="modify-work-log" data-testid="modify-work-log">
      <summary><span>{interrupted ? 'Interrupted after' : 'Worked for'} {formatDuration(durationMs)}</span><ModifyChevronIcon size={12} /></summary>
      <div className="modify-work-body">
        {work.map(({ message, index }) => {
          if (message.role === 'assistant') return <div key={index} className="modify-work-narration"><MarkdownBody text={message.text ?? ''} /></div>
          if (message.role === 'thinking') return <ModifyThinkingBlock key={index} message={message} />
          if (message.role === 'tool') return message.system ? <div key={index} className="modify-tool-note">{message.name}</div> : <ModifyToolActivity key={index} message={message} />
          return null
        })}
      </div>
    </details>
  )
}

function ModifyEditedFilesSummary({ work }: { work: Array<{ message: Msg; index: number }> }): React.JSX.Element | null {
  const edited = new Map<string, { added: number; removed: number }>()
  for (const entry of work) {
    if (!isEditableToolMessage(entry.message) || !entry.message.target) continue
    const stat = diffStat(entry.message.body) ?? { added: 0, removed: 0 }
    const current = edited.get(entry.message.target) ?? { added: 0, removed: 0 }
    edited.set(entry.message.target, { added: current.added + stat.added, removed: current.removed + stat.removed })
  }
  if (!edited.size) return null
  const totals = Array.from(edited.values()).reduce(
    (sum, stat) => ({ added: sum.added + stat.added, removed: sum.removed + stat.removed }),
    { added: 0, removed: 0 }
  )
  return (
    <div className="modify-edited-files" data-testid="modify-edited-files">
      <div className="modify-edited-files-head">
        <strong>Edited {edited.size} {edited.size === 1 ? 'file' : 'files'}</strong>
        <span><b>+{totals.added}</b> <i>-{totals.removed}</i></span>
      </div>
      {Array.from(edited).map(([file, stat]) => (
        <div key={file} className="modify-edited-file">
          <span>{file}</span>
          <span><b>+{stat.added}</b> <i>-{stat.removed}</i></span>
        </div>
      ))}
    </div>
  )
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
  const [inputValue, setInputValue] = React.useState('')
  const [hasComposerInput, setHasComposerInput] = React.useState(false)
  const [queuedFollowUps, setQueuedFollowUps] = React.useState<QueuedFollowUp[]>([])
  const [busy, setBusy] = React.useState(false)
  const [elapsedTick, setElapsedTick] = React.useState(() => Date.now())
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')
  const [editingMessage, setEditingMessage] = React.useState<{ index: number; text: string } | null>(null)
  const sidRef = React.useRef<string | null>(null)
  const messagesRef = React.useRef<Msg[]>([])
  const queuedFollowUpsRef = React.useRef<QueuedFollowUp[]>([])
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const inputValueRef = React.useRef('')
  const hasComposerInputRef = React.useRef(false)
  const appStateRef = React.useRef<AppState | null>(null)
  const activeConfigKeyRef = React.useRef('')
  const firstTurnRef = React.useRef(true)
  const turnStartAtRef = React.useRef(0)
  const lastTurnDurationRef = React.useRef<number | undefined>(undefined)
  const retriesRef = React.useRef(0)
  const verifyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const logRef = React.useRef<HTMLDivElement | null>(null)
  const streamQueueRef = React.useRef<
    Array<
      | { kind: 'thinking'; text: string }
      | { kind: 'tool'; event: Extract<AgentEvent, { kind: 'tool' }> }
    >
  >([])
  const streamRafRef = React.useRef<number | null>(null)
  const pendingAssistantTextRef = React.useRef('')

  messagesRef.current = messages
  queuedFollowUpsRef.current = queuedFollowUps

  React.useEffect(() => {
    if (!busy) return
    setElapsedTick(Date.now())
    const id = window.setInterval(() => setElapsedTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy])

  const composerValue = (): string => inputRef.current?.value ?? inputValueRef.current

  const resizeComposer = React.useCallback((element = inputRef.current): void => {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`
  }, [])

  const setComposerValue = React.useCallback(
    (value: string): void => {
      inputValueRef.current = value
      if (inputRef.current && inputRef.current.value !== value) inputRef.current.value = value
      const hasValue = Boolean(value.trim())
      hasComposerInputRef.current = hasValue
      setHasComposerInput(hasValue)
      setInputValue(value.trimStart().startsWith('/') ? value : '')
      requestAnimationFrame(() => resizeComposer())
    },
    [resizeComposer]
  )

  const handleComposerInput = React.useCallback(
    (value: string): void => {
      inputValueRef.current = value
      resizeComposer()
      const hasValue = Boolean(value.trim())
      if (hasComposerInputRef.current !== hasValue) {
        hasComposerInputRef.current = hasValue
        setHasComposerInput(hasValue)
      }
      const suggestionValue = value.trimStart().startsWith('/') ? value : ''
      setInputValue((current) => (current === suggestionValue ? current : suggestionValue))
    },
    [resizeComposer]
  )

  const flushStreamQueue = React.useCallback((): void => {
    streamRafRef.current = null
    const batch = streamQueueRef.current
    if (!batch.length) return
    streamQueueRef.current = []
    setMessages((m) => {
      let next = m
      for (const item of batch) {
        if (item.kind === 'thinking') next = appendThinking(next, item.text)
        else next = upsertTool(next, item.event)
      }
      messagesRef.current = next
      return next
    })
  }, [])

  const enqueueStream = React.useCallback(
    (
      item:
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

  const flushAssistantText = React.useCallback((): void => {
    const text = pendingAssistantTextRef.current
    if (!text) return
    pendingAssistantTextRef.current = ''
    setMessages((m) => {
      const next = append(m, text)
      messagesRef.current = next
      return next
    })
  }, [])

  const catalogRef = React.useRef(catalog)
  catalogRef.current = catalog
  const runOptionsRef = React.useRef(runOptions)
  runOptionsRef.current = runOptions

  function configKey(config: { engineId: string; modelId: string; runOptions: EngineRunOptions; goal: string }): string {
    return JSON.stringify({
      engineId: config.engineId,
      modelId: config.modelId,
      runOptions: config.runOptions,
      goal: config.goal
    })
  }

  function persistActiveChatPatch(patch: { modelId?: string; goal?: string }): void {
    const state = appStateRef.current
    const projectId = state?.activeProjectId
    const chatId = state?.activeChatId
    if (!projectId || !chatId) return
    void window.y.app.updateChat(projectId, chatId, patch)
  }

  function syncFromMainChat(state: AppState, cat = catalogRef.current, keepMessages = true): void {
    appStateRef.current = state
    const config = activeChatConfig(state, cat)
    const nextKey = configKey(config)
    if (nextKey === activeConfigKeyRef.current) return
    activeConfigKeyRef.current = nextKey
    setGoal(config.goal)
    void start(config.engineId, config.modelId, config.runOptions, keepMessages)
  }

  function updateQueuedFollowUps(updater: (items: QueuedFollowUp[]) => QueuedFollowUp[]): void {
    setQueuedFollowUps((items) => {
      const next = updater(items)
      queuedFollowUpsRef.current = next
      return next
    })
  }

  function addQueuedFollowUp(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    updateQueuedFollowUps((items) =>
      items.concat([{ id: `${Date.now()}-${items.length}`, text: trimmed, steer: false }])
    )
    setComposerValue('')
  }

  function removeQueuedFollowUp(id: string): void {
    updateQueuedFollowUps((items) => items.filter((item) => item.id !== id))
  }

  function drainQueuedFollowUp(): void {
    const item = queuedFollowUpsRef.current[0]
    const sid = sidRef.current
    if (!item || !sid) return
    updateQueuedFollowUps((items) => items.slice(1))
    void sendText(item.text, sid, messagesRef.current)
  }

  function buildSteeringText(text: string): string {
    return [
      'The user is steering the current Modify turn. Treat this as an immediate correction or extra instruction.',
      '',
      text.trim()
    ].join('\n')
  }

  async function requestQueuedSteer(itemId: string): Promise<void> {
    const sid = sidRef.current
    const item = queuedFollowUpsRef.current.find((queued) => queued.id === itemId)
    if (!sid || !item) return
    updateQueuedFollowUps((items) => items.map((queued) => (queued.id === itemId ? { ...queued, steer: true } : queued)))
    const checkpoint = await window.y.userland.checkpoint()
    if (!checkpoint.ok || !checkpoint.checkpointId) {
      addSystemNote(checkpoint.error || 'Could not checkpoint before steering.')
      updateQueuedFollowUps((items) => items.map((queued) => (queued.id === itemId ? { ...queued, steer: false } : queued)))
      return
    }
    const res = await window.y.engine.command(sid, { name: 'steer', value: buildSteeringText(item.text) })
    if (!res.ok) {
      addSystemNote(res.error || 'The engine could not steer this Modify turn; the message remains queued.')
      updateQueuedFollowUps((items) => items.map((queued) => (queued.id === itemId ? { ...queued, steer: false } : queued)))
      return
    }
    addSystemNote(res.message || 'Steered current Modify turn.')
    removeQueuedFollowUp(itemId)
  }

  const start = React.useCallback(async (id: string, model?: string, options = runOptionsRef.current, keepMessages = false): Promise<string | null> => {
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
    if (!keepMessages) {
      setMessages([])
      messagesRef.current = []
      updateQueuedFollowUps(() => [])
    }
    setStatus('')
    setError('')
    setBusy(false)
    const res = await window.y.engine.startModify({ engine: id, model: resolved, options })
    if (!res.ok || !res.sessionId) {
      setError(res.error || 'Failed to start the Modify engine')
      return null
    }
    sidRef.current = res.sessionId
    setSessionId(res.sessionId)
    return res.sessionId
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
          void window.y.userland.checkpoint().then((checkpoint) => {
            if (!checkpoint.ok || !checkpoint.checkpointId) return
            setMessages((list) => {
              const index = list.findLastIndex((message) => message.role === 'assistant')
              if (index === -1) return list
              const message = list[index]
              if (message.role !== 'assistant') return list
              const next = list.slice()
              next[index] = { ...message, checkpointId: checkpoint.checkpointId, durationMs: lastTurnDurationRef.current, interrupted: false }
              messagesRef.current = next
              return next
            })
          }).finally(() => {
            drainQueuedFollowUp()
          })
          return
        }
        if (action.kind === 'verified') {
          retriesRef.current = 0
          void window.y.userland.snapshot().then(() => window.y.userland.checkpoint()).then((checkpoint) => {
            setMessages((list) => {
              const next = list.concat([{ role: 'tool' as const, name: action.note, system: true }])
              if (!checkpoint.ok || !checkpoint.checkpointId) {
                messagesRef.current = next
                return next
              }
              const index = next.findLastIndex((message) => message.role === 'assistant')
              const message = next[index]
              if (message?.role === 'assistant') next[index] = { ...message, checkpointId: checkpoint.checkpointId, durationMs: lastTurnDurationRef.current, interrupted: false }
              messagesRef.current = next
              return next
            })
          }).finally(() => {
            drainQueuedFollowUp()
          })
          return
        }
        if (action.kind === 'giveup') {
          retriesRef.current = 0
          setError(action.message)
          return
        }
        const sid = sidRef.current
        if (!sid) {
          retriesRef.current = 0
          return
        }
        retriesRef.current = action.attempt
        setMessages((m) => {
          const next = m.concat([{ role: 'tool' as const, name: action.note, system: true }])
          messagesRef.current = next
          return next
        })
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
        pendingAssistantTextRef.current += e.text
      } else if (e.kind === 'thinking') {
        setStatus('')
        enqueueStream({ kind: 'thinking', text: e.text })
      } else if (e.kind === 'tool') {
        setStatus('')
        enqueueStream({ kind: 'tool', event: e })
      } else if (e.kind === 'suggestion') {
        setStatus('')
        setMessages((m) => {
          const next = m.concat([{ role: 'tool' as const, name: `Suggested next: ${e.text}`, system: true }])
          messagesRef.current = next
          return next
        })
      } else if (e.kind === 'result') {
        lastTurnDurationRef.current = turnStartAtRef.current ? Date.now() - turnStartAtRef.current : undefined
        setBusy(false)
        setStatus('')
        if (streamRafRef.current != null) {
          cancelAnimationFrame(streamRafRef.current)
          flushStreamQueue()
        }
        flushAssistantText()
        setMessages((m) => {
          const next = finishStreaming(m)
          messagesRef.current = next
          return next
        })
        if (!e.ok) {
          setError(e.summary || 'The engine reported an error.')
          retriesRef.current = 0
        } else {
          scheduleVerify()
        }
      } else if (e.kind === 'error') {
        setBusy(false)
        setStatus('')
        if (streamRafRef.current != null) {
          cancelAnimationFrame(streamRafRef.current)
          flushStreamQueue()
        }
        flushAssistantText()
        setMessages((m) => {
          const next = finishStreaming(m)
          messagesRef.current = next
          return next
        })
        setError(e.message)
      }
    })
    return () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
      if (streamRafRef.current != null) cancelAnimationFrame(streamRafRef.current)
      off()
    }
  }, [enqueueStream, flushAssistantText, flushStreamQueue])

  React.useEffect(() => {
    let cancelled = false
    void Promise.all([window.y.engine.list(), window.y.engine.models(), window.y.app.getState()]).then(([ids, cat, state]) => {
      if (cancelled) return
      if (ids.length) setEngines(ids)
      setCatalog(cat)
      syncFromMainChat(state, cat, false)
    })
    const off = window.y.app.onStateChanged((state) => {
      syncFromMainChat(state, catalogRef.current, true)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [start])

  const engineLabel = LABELS[engineId] || engineId
  const pickerCatalog: EngineModelCatalog[] = catalog.length > 0 ? catalog : engines.map((id) => ({
    engine: id,
    label: LABELS[id] || id,
    defaultModel: modelId,
    models: [{ id: modelId, label: modelId }]
  }))
  const slashSuggestions = inputValue.trimStart().startsWith('/')
    ? MODIFY_SLASH_COMMANDS.filter((item) => item.name.startsWith(inputValue.trim().split(/\s+/)[0] || '/'))
    : []

  const addSystemNote = (text: string): void => {
    setMessages((m) => {
      const next = finishStreaming(m).concat([{ role: 'tool' as const, name: text, system: true }])
      messagesRef.current = next
      return next
    })
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
    persistActiveChatPatch({ modelId: nextModel })
    addSystemNote(`${label}: reasoning effort set to ${effort}.`)
    return true
  }

  const clearChat = (): void => {
    if (sidRef.current) window.y.engine.cancel(sidRef.current)
    sidRef.current = null
    firstTurnRef.current = true
    retriesRef.current = 0
    setMessages([])
    messagesRef.current = []
    updateQueuedFollowUps(() => [])
    setError('')
    setStatus('')
    setBusy(false)
    void start(engineId, modelId, runOptions)
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
        persistActiveChatPatch({ goal: '' })
        addSystemNote('Goal cleared.')
        return true
      }
      setGoal(arg)
      persistActiveChatPatch({ goal: arg })
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

  const sendText = async (text: string, targetSession = sessionId, history = messagesRef.current): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || !targetSession) return
    const checkpoint = await window.y.userland.checkpoint()
    if (!checkpoint.ok || !checkpoint.checkpointId) {
      setError(checkpoint.error || 'Native Git checkpoint failed. Install Git to use Modify.')
      return
    }
    setError('')
    const nextMessages = sealAllThinking(settleTools(messagesRef.current)).concat([
      { role: 'user' as const, text: trimmed, checkpointId: checkpoint.checkpointId }
    ])
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    const request = goal ? `Current goal:\n${goal}\n\nUser request:\n${trimmed}` : trimmed
    const context = retainedContext(history)
    const toSend = firstTurnRef.current
      ? PREAMBLE + (context ? `Retained Modify transcript:\n\n${context}\n\n---\n\n` : '') + request
      : request
    firstTurnRef.current = false
    setComposerValue('')
    pendingAssistantTextRef.current = ''
    retriesRef.current = 0
    turnStartAtRef.current = Date.now()
    lastTurnDurationRef.current = undefined
    setBusy(true)
    setStatus('...')
    scrollLogToEnd()
    void window.y.engine.send(targetSession, toSend)
  }

  const send = (): void => {
    const text = composerValue().trim()
    if (!text) return
    if (busy) {
      addQueuedFollowUp(text)
      return
    }
    if (handleSlashCommand(text)) {
      setComposerValue('')
      return
    }
    void sendText(text)
  }

  const editUserMessage = async (index: number, text: string): Promise<void> => {
    const message = messages[index]
    const checkpointId = message?.role === 'user' ? message.checkpointId : undefined
    if (!checkpointId) return setError('This older message has no code checkpoint.')
    const restored = await window.y.userland.restoreCheckpoint(checkpointId)
    if (!restored.ok) return setError(restored.error || 'Could not restore the code checkpoint.')
    const retained = messages.slice(0, index)
    setMessages(retained)
    messagesRef.current = retained
    setEditingMessage(null)
    const sid = await start(engineId, modelId, runOptions, true)
    if (sid) await sendText(text, sid, retained)
  }

  const resetToMessage = async (index: number): Promise<void> => {
    const message = messages[index]
    const checkpointId = message?.role === 'assistant' ? message.checkpointId : undefined
    if (!checkpointId) return setError('This older message has no code checkpoint.')
    const restored = await window.y.userland.restoreCheckpoint(checkpointId)
    if (!restored.ok) return setError(restored.error || 'Could not restore the code checkpoint.')
    const retained = messages.slice(0, index + 1)
    setMessages(retained)
    messagesRef.current = retained
    setEditingMessage(null)
    await start(engineId, modelId, runOptions, true)
  }

  const copyMessage = (text: string): void => {
    void navigator.clipboard.writeText(text)
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
    if (busy && !composerValue().trim()) {
      interrupt()
      return
    }
    send()
  }

  const collapsedTurns = new Map<number, Array<{ message: Msg; index: number }>>()
  const hiddenWork = new Set<number>()
  let turnStart = -1
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'user') {
      turnStart = index + 1
      continue
    }
    if (turnStart === -1 || message.role !== 'assistant' || !message.checkpointId || (message.durationMs === undefined && !message.interrupted)) continue
    const work = messages.slice(turnStart, index).map((item, offset) => ({ message: item, index: turnStart + offset }))
    if (hasCollapsibleWork(work)) {
      collapsedTurns.set(index, work)
      for (const entry of work) hiddenWork.add(entry.index)
    }
    turnStart = -1
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
          if (hiddenWork.has(i)) return null
          if (m.role === 'thinking') {
            return <ModifyThinkingBlock key={key} message={m} />
          }
          if (m.role === 'tool') {
            if (m.system) {
              return (
                <div key={key} className="modify-tool-note">
                  {m.name}
                </div>
              )
            }
            return <ModifyToolActivity key={key} message={m} />
          }
          if (m.role === 'user') {
            const editing = editingMessage?.index === i
            return (
              <div key={key} className="modify-msg modify-user">
                <span className="modify-role">you</span>
                {editing ? (
                  <textarea
                    className="modify-inline-edit"
                    value={editingMessage.text}
                    autoFocus
                    onChange={(event) => setEditingMessage({ index: i, text: event.currentTarget.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setEditingMessage(null)
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void editUserMessage(i, editingMessage.text)
                    }}
                  />
                ) : <div className="modify-text modify-user-bubble">{m.text}</div>}
                <div className="modify-message-actions">
                  <button type="button" aria-label="Copy Modify message" onClick={() => copyMessage(m.text)}>
                    <ModifyCopyIcon />
                  </button>
                  {editing ? (
                    <>
                      <button type="button" onClick={() => void editUserMessage(i, editingMessage.text)}>Save</button>
                      <button type="button" onClick={() => setEditingMessage(null)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" aria-label="Edit Modify message" onClick={() => setEditingMessage({ index: i, text: m.text })}>Edit</button>
                  )}
                </div>
              </div>
            )
          }
          const assistantMessage = (
            <div key={key} className="modify-msg modify-assistant">
              <MarkdownBody text={m.text ?? ''} />
              {m.checkpointId ? (
                <div className="modify-assistant-footer">
                  <button type="button" className="modify-message-action" aria-label="Copy message" title="Copy message" onClick={() => copyMessage(m.text ?? '')}>
                    <ModifyCopyIcon size={18} />
                  </button>
                  <details className="modify-message-menu">
                    <summary className="modify-message-action" aria-label="More message actions" title="More"><ModifyMenuIcon size={18} /></summary>
                    <div className="modify-message-menu-popover">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open')
                          void resetToMessage(i)
                        }}
                      >
                        <ModifyResetIcon size={15} /> Reset to this point
                      </button>
                    </div>
                  </details>
                </div>
              ) : null}
            </div>
          )
          const work = collapsedTurns.get(i)
          if (!work) return assistantMessage
          return (
            <div key={`completed-${key}`} className="modify-completed-turn">
              <ModifyWorkSummary work={work} durationMs={m.durationMs} interrupted={m.interrupted} />
              {assistantMessage}
              <ModifyEditedFilesSummary work={work} />
            </div>
          )
        })}
        {busy ? <div className="modify-live-work">Working for {formatLiveDuration(Math.max(0, elapsedTick - turnStartAtRef.current))}</div> : null}
        {status ? <div className="modify-status">{status}</div> : null}
        {error ? <div className="modify-error">{error}</div> : null}
      </div>

      <div className="modify-composer-wrap">
        {queuedFollowUps.length ? (
          <div className="modify-queued-stack" data-testid="modify-queued-follow-ups">
            {queuedFollowUps.map((item, index) => (
              <div key={item.id} className="modify-queued" data-testid="modify-queued-follow-up">
                <span className="modify-queued-label">Queued {index + 1}</span>
                <span className="modify-queued-text">{item.text}</span>
                <button type="button" disabled={item.steer || !busy} onClick={() => void requestQueuedSteer(item.id)}>
                  {item.steer ? 'Steering...' : 'Steer'}
                </button>
                <button type="button" aria-label={'Remove queued Modify follow-up ' + (index + 1)} onClick={() => removeQueuedFollowUp(item.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="modify-composer" data-testid="modify-composer">
          {slashSuggestions.length ? (
            <div className="modify-suggest" data-testid="modify-slash-suggestions">
              {slashSuggestions.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className="modify-suggest-item"
                  onClick={() => {
                    setComposerValue(item.name + (item.name === '/clear' || item.name === '/help' ? '' : ' '))
                    inputRef.current?.focus()
                  }}
                >
                  <span className="modify-suggest-main">
                    <span className="modify-suggest-title">{item.name}</span>
                    <span className="modify-suggest-sub">{item.detail}</span>
                  </span>
                  <span className="modify-suggest-source">Modify</span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            defaultValue=""
            rows={1}
            data-native-input="true"
            onChange={(e) => {
              handleComposerInput(e.currentTarget.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={sessionId ? 'Describe a change to the app…' : 'Starting Modify engine…'}
          />
          <div className="modify-composer-row">
            <button
              type="button"
              className="modify-send"
              onClick={sendOrInterrupt}
              disabled={!sessionId}
              aria-label={busy && !hasComposerInput ? 'Interrupt' : busy ? 'Queue follow-up' : 'Send'}
            >
              {busy && !hasComposerInput ? <ModifyStopIcon size={16} /> : <ModifySendIcon size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModifyChat
