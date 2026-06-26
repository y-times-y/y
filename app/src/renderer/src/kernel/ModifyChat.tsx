import * as React from 'react'
import { latestVerdict, decideVerify, publishAgentWorking } from './userlandStatus'
import { defaultRunOptions } from './EngineOptionsPicker'
import {
  CHAT_SURFACE_CLASSES,
  ChatAssistantMessage,
  ChatComposerShell,
  ChatEditedFilesSummary,
  ChatThinkingBlock,
  ChatToolMessage,
  ChatUserMessage,
  ChatWorkSummary,
  chatWorkHasCollapsibleTool,
  type ChatWorkEntry
} from './ChatPrimitives'
import {
  ModifyHistoryIcon,
  ModifyMark,
  ModifyNewIcon,
  ModifyResetIcon,
  ModifySendIcon,
  ModifyStopIcon,
  ModifyXIcon
} from './ModifyIcons'
import { settleTools, toolVerbFromName } from './ToolActivity'
import type { Msg } from './modifyTypes'

const MAX_AUTO_RETRIES = 3
const VERIFY_DELAY_MS = 1200
const STREAM_MIN_CHARS = 360
const STREAM_MAX_CHARS = 1400
const STREAM_MAX_HOLD_MS = 1400
const STREAM_FLUSH_MS = 180
const MODIFY_BINARY_SPINNER_DIGITS = ['1', '0', '1', '0', '1', '0', '1', '0', '1']
const MODIFY_BINARY_SPINNER_POSITIONS = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 16, y: 0 },
  { x: 0, y: 8 },
  { x: 8, y: 8 },
  { x: 16, y: 8 },
  { x: 0, y: 16 },
  { x: 8, y: 16 },
  { x: 16, y: 16 }
]
const MODIFY_BINARY_SPINNER_ROUTES = [
  [0, 1, 2, 5, 8, 7, 6, 3, 4],
  [2, 5, 8, 7, 6, 3, 0, 1, 4],
  [8, 7, 6, 3, 0, 1, 2, 5, 4],
  [6, 3, 0, 1, 2, 5, 8, 7, 4]
]
const MODIFY_BINARY_ROUTE_LENGTH = MODIFY_BINARY_SPINNER_ROUTES[0].length
const MODIFY_BINARY_RESET_STEPS = 4
const MODIFY_BINARY_CYCLE_LENGTH = MODIFY_BINARY_ROUTE_LENGTH + MODIFY_BINARY_RESET_STEPS
const MODIFY_BINARY_TOTAL_STEPS = MODIFY_BINARY_SPINNER_ROUTES.length * MODIFY_BINARY_CYCLE_LENGTH
const MODIFY_BINARY_STEP_MS = 125

function currentModifyBinaryTick(): number {
  return Math.floor(Date.now() / MODIFY_BINARY_STEP_MS) % MODIFY_BINARY_TOTAL_STEPS
}

function ModifyBinarySpinner() {
  const [tick, setTick] = React.useState(currentModifyBinaryTick)
  React.useEffect(() => {
    const id = window.setInterval(() => setTick(currentModifyBinaryTick()), MODIFY_BINARY_STEP_MS)
    return () => window.clearInterval(id)
  }, [])
  const phase = tick % MODIFY_BINARY_CYCLE_LENGTH
  const routeIndex = Math.floor(tick / MODIFY_BINARY_CYCLE_LENGTH) % MODIFY_BINARY_SPINNER_ROUTES.length
  const route = MODIFY_BINARY_SPINNER_ROUTES[routeIndex]
  const resetting = phase >= MODIFY_BINARY_ROUTE_LENGTH
  const activeIndex = route[Math.min(phase, MODIFY_BINARY_ROUTE_LENGTH - 1)]
  const activePosition = MODIFY_BINARY_SPINNER_POSITIONS[activeIndex]
  return (
    <span className={'modify-binary-spinner' + (resetting ? ' is-resetting' : '')} aria-label="Streaming">
      <span
        className="modify-binary-glow"
        aria-hidden
        style={{ transform: `translate(${activePosition.x}px, ${activePosition.y}px)` }}
      />
      {MODIFY_BINARY_SPINNER_DIGITS.map((digit, index) => (
        <span key={index} className={'modify-binary-cell cell-' + (index + 1) + (index === activeIndex ? ' active' : '')}>{digit}</span>
      ))}
    </span>
  )
}

type KernelEngineApi = Window['y']['engine'] & {
  startModify: (args: { engine: string; model?: string; options?: EngineRunOptions }) => Promise<StartResult>
}

type RevertGraphState = {
  open: boolean
  loading: boolean
  error: string
  entries: SnapshotEntry[]
}

const PREAMBLE =
  'You are the Modify agent for an app called y. Your working directory contains ' +
  'panel.tsx — a single default-exported React component that y renders live as the ' +
  "app's main UI. When I ask for a change, EDIT panel.tsx to make it. Keep it a valid " +
  'TSX file with exactly one default export. The app hot-reloads on save, so just edit ' +
  'the file — do not run build commands. Only `react` can be imported; everything else ' +
  'is on the global `window.y`. Available capability bricks (each prompts the user for ' +
  'consent the first time): window.y.net.request({url,method,headers,body}) -> ' +
  '{ok,status,body} for network/APIs; window.y.files.{list,read,write,mkdir,remove}(path) ' +
  'for a private workspace folder; window.y.terminal.{start,write,resize,kill,onEvent} for ' +
  'building real PTY-backed terminal UI; and the <webview src=…> tag is enabled for embedding ' +
  'web pages (e.g. to build a browser). Terminal safety skill: use terminal commands only when ' +
  'they are needed for the requested customization or for inspecting behavior. Do not use the ' +
  'terminal to edit y Kernel, Modify, auth, analytics, preload, main-process, or app source files ' +
  'unless the user explicitly asks for that protected-code change. Destructive commands such as ' +
  'rm, mv, chmod, git reset, or shell redirection are allowed only when the target is clearly inside ' +
  'the private workspace or another user-approved non-Kernel project path. If a requested product brick is missing, ' +
  'use curl or another shell HTTP client to POST only enum JSON to https://ytimesy.com/api/brick-requests with brick, reason, surface, confidence, and engineId. ' +
  'Allowed brick values: browser, file_editor, terminal, database, github, figma, web_search, auth, analytics, deployment, unknown. ' +
  'Allowed reason values: needs_external_page_interaction, needs_project_file_access, needs_shell_execution, needs_remote_repo_context, needs_design_asset_access, needs_live_web_lookup, needs_user_identity, needs_product_event_tracking, needs_hosting_or_release, other. ' +
  'Allowed surface values: modify. Allowed confidence values: low, medium, high. Allowed engineId values: claude-code, codex. For Figma file/design inspection use brick=figma and reason=needs_design_asset_access. ' +
  'Never include prompts, code, paths, URLs, screenshots, terminal output, or free-form user content in the report. ' +
  'Prefer small, focused edits. Request:\n\n'

type StreamBuffer = {
  text: string
  firstAt: number
}

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
    return base.slice(0, -1).concat([{ ...prev, text: prev.text + chunk, streaming: true }])
  }
  return base.concat([{ role: 'assistant', text: chunk, streaming: true }])
}

function unstableMarkdownTailStart(text: string): number {
  let start = text.length
  const checks = [
    /```[^`\n]*$/u,
    /!?\[[^\]\n]*$/u,
    /\]\([^\)\n]*$/u,
    /`[^`\n]*$/u,
    /\*\*[^*\n]*$/u
  ]
  for (const pattern of checks) {
    const match = pattern.exec(text)
    if (match && match.index < start) start = match.index
  }
  return start
}

function streamBoundary(text: string, minIndex: number, maxIndex: number): number {
  const limited = text.slice(0, maxIndex)
  const preferred = ['\n\n', '\n', '. ', '! ', '? ', '; ']
  for (const token of preferred) {
    const index = limited.lastIndexOf(token)
    if (index >= minIndex) return index + token.length
  }
  return maxIndex
}

function splitVisibleStreamText(buffer: StreamBuffer, force = false): { visible: string; rest: string } {
  if (force) return { visible: buffer.text, rest: '' }
  const stableEnd = unstableMarkdownTailStart(buffer.text)
  const stable = buffer.text.slice(0, stableEnd)
  if (!stable) return { visible: '', rest: buffer.text }
  const age = Date.now() - buffer.firstAt
  const canShowShort = age >= STREAM_MAX_HOLD_MS || /[.!?]\s$|\n$/u.test(stable)
  if (stable.length < STREAM_MIN_CHARS && !canShowShort) return { visible: '', rest: buffer.text }
  const maxIndex = Math.min(stable.length, STREAM_MAX_CHARS)
  const minIndex = canShowShort ? 1 : STREAM_MIN_CHARS
  const boundary = streamBoundary(stable, minIndex, maxIndex)
  return { visible: buffer.text.slice(0, boundary), rest: buffer.text.slice(boundary) }
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

type QueuedFollowUp = {
  id: string
  text: string
  steer: boolean
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
  const lastUserIndex = sealed.findLastIndex((message) => message.role === 'user')
  const existingIndex = e.id
    ? sealed.findIndex(
        (message, index) =>
          index > lastUserIndex &&
          message.role === 'tool' &&
          !message.system &&
          message.id === e.id
      )
    : -1
  const base = existingIndex === -1 ? settleTools(sealed) : sealed
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
  if (existingIndex !== -1) {
    const existing = base[existingIndex]
    if (existing.role !== 'tool') return base
    const updated = base.slice()
    updated[existingIndex] = {
      ...existing,
      ...next,
      target: e.target ?? existing.target,
      body: e.body ?? existing.body
    }
    return isLive ? updated : mergeAdjacentSameFileEdit(settleTools(updated))
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

function finishInterrupted(list: Msg[], durationMs?: number, checkpointId?: string): Msg[] {
  const base = finishStreaming(list)
  const lastAssistantIndex = base.findLastIndex((message) => message.role === 'assistant')
  if (lastAssistantIndex !== -1) {
    const next = base.slice()
    const message = next[lastAssistantIndex]
    if (message.role === 'assistant') next[lastAssistantIndex] = { ...message, checkpointId: checkpointId ?? message.checkpointId, durationMs, interrupted: true }
    return next
  }
  return base.concat([{ role: 'assistant', text: 'Interrupted.', checkpointId, durationMs, interrupted: true }])
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

function modifyTitleFromMessages(messages: Msg[]): string {
  const firstUser = messages.find(
    (message): message is Extract<Msg, { role: 'user' }> =>
      message.role === 'user' && Boolean(message.text?.trim())
  )
  const text = firstUser?.text?.trim().replace(/\s+/g, ' ') ?? ''
  if (!text) return 'New Modify chat'
  return text.length > 44 ? `${text.slice(0, 44)}...` : text
}

function formatModifyChatAge(value: string): string {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Math.max(0, Date.now() - time)
  const minute = 60_000
  const hour = minute * 60
  const day = hour * 24
  if (diff < minute) return 'now'
  if (diff < hour) return `${Math.floor(diff / minute)}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  return `${Math.floor(diff / day)}d`
}

function trackModifyEvent(event: string, props?: Record<string, unknown>): void {
  void window.y.analytics.track(event, props)
}

function isNoisyModifyStatus(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    !normalized ||
    normalized === '...' ||
    normalized === 'requesting' ||
    normalized === 'requesting...' ||
    normalized === 'reasoning' ||
    normalized === 'codex turn started'
  )
}

function ModifyChat({
  onClose,
  promptRequest
}: {
  onClose: () => void
  promptRequest?: { id: string; text: string; autoSubmit?: boolean }
}): React.JSX.Element {
  const [catalog, setCatalog] = React.useState<EngineModelCatalog[]>([])
  const [engineId, setEngineId] = React.useState('claude-code')
  const [modelId, setModelId] = React.useState('claude-sonnet-4-6#effort=medium')
  const [runOptions, setRunOptions] = React.useState<EngineRunOptions>(() => defaultRunOptions())
  const [goal, setGoal] = React.useState('')
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [modifyChats, setModifyChats] = React.useState<ModifyChatRecord[]>([])
  const [activeModifyChatId, setActiveModifyChatId] = React.useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [modifyReady, setModifyReady] = React.useState(false)
  const [hasComposerInput, setHasComposerInput] = React.useState(false)
  const [queuedFollowUps, setQueuedFollowUps] = React.useState<QueuedFollowUp[]>([])
  const [busy, setBusy] = React.useState(false)
  const [elapsedTick, setElapsedTick] = React.useState(() => Date.now())
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')
  const [editingMessage, setEditingMessage] = React.useState<{ index: number; text: string } | null>(null)
  const [revertGraph, setRevertGraph] = React.useState<RevertGraphState>({
    open: false,
    loading: false,
    error: '',
    entries: []
  })
  const sidRef = React.useRef<string | null>(null)
  const messagesRef = React.useRef<Msg[]>([])
  const activeModifyChatIdRef = React.useRef<string | null>(null)
  const modifyPersistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedFollowUpsRef = React.useRef<QueuedFollowUp[]>([])
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const inputValueRef = React.useRef('')
  const hasComposerInputRef = React.useRef(false)
  const appStateRef = React.useRef<AppState | null>(null)
  const activeConfigKeyRef = React.useRef('')
  const pendingMainConfigRef = React.useRef<{
    config: { engineId: string; modelId: string; runOptions: EngineRunOptions; goal: string }
    keepMessages: boolean
  } | null>(null)
  const firstTurnRef = React.useRef(true)
  const turnStartAtRef = React.useRef(0)
  const activeRequestRef = React.useRef('')
  const handledPromptRequestIdRef = React.useRef('')
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
  const streamTimerRef = React.useRef<number | null>(null)
  const streamBufferRef = React.useRef<StreamBuffer | null>(null)

  messagesRef.current = messages
  activeModifyChatIdRef.current = activeModifyChatId
  queuedFollowUpsRef.current = queuedFollowUps
  const busyRef = React.useRef(busy)
  busyRef.current = busy

  React.useEffect(() => {
    if (!busy) return
    setElapsedTick(Date.now())
    const id = window.setInterval(() => setElapsedTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy])

  React.useEffect(() => {
    publishAgentWorking(busy)
    return () => publishAgentWorking(false)
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
      requestAnimationFrame(() => resizeComposer())
    },
    [resizeComposer]
  )

  React.useEffect(() => {
    if (!promptRequest?.text || promptRequest.autoSubmit) return
    if (busyRef.current) return
    if (composerValue().trim()) return
    setComposerValue(promptRequest.text)
  }, [promptRequest?.autoSubmit, promptRequest?.id, promptRequest?.text, setComposerValue])

  const handleComposerInput = React.useCallback(
    (value: string): void => {
      inputValueRef.current = value
      resizeComposer()
      const hasValue = Boolean(value.trim())
      if (hasComposerInputRef.current !== hasValue) {
        hasComposerInputRef.current = hasValue
        setHasComposerInput(hasValue)
      }
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
      requestAnimationFrame(() => {
        const el = logRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    })
  }, [])

  React.useEffect(() => {
    scrollLogToEnd()
  }, [busy, error, messages, scrollLogToEnd, status])

  const flushStreamBuffer = React.useCallback((force = false): void => {
    if (streamTimerRef.current != null) {
      window.clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
    }
    const buffered = streamBufferRef.current
    if (!buffered) return
    streamBufferRef.current = null
    const nextText = splitVisibleStreamText(buffered, force)
    if (!nextText.visible && !nextText.rest) return
    setMessages((m) => {
      const next = nextText.visible ? append(m, nextText.visible) : m
      messagesRef.current = next
      return next
    })
    if (nextText.rest) {
      streamBufferRef.current = {
        text: nextText.rest,
        firstAt: nextText.visible ? Date.now() : buffered.firstAt
      }
      streamTimerRef.current = window.setTimeout(() => flushStreamBuffer(false), STREAM_FLUSH_MS)
    }
  }, [])

  const queueStreamText = React.useCallback((text: string): void => {
    if (streamTimerRef.current != null) window.clearTimeout(streamTimerRef.current)
    const buffered = streamBufferRef.current
    streamBufferRef.current = {
      text: (buffered?.text ?? '') + text,
      firstAt: buffered?.firstAt ?? Date.now()
    }
    streamTimerRef.current = window.setTimeout(() => flushStreamBuffer(false), STREAM_FLUSH_MS)
  }, [flushStreamBuffer])

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

  function resetTransientTurnState(nextMessages?: Msg[], clearQueued = true): void {
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current)
      verifyTimerRef.current = null
    }
    if (streamRafRef.current != null) {
      cancelAnimationFrame(streamRafRef.current)
      streamRafRef.current = null
    }
    if (streamTimerRef.current != null) {
      window.clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
    }
    streamQueueRef.current = []
    streamBufferRef.current = null
    retriesRef.current = 0
    turnStartAtRef.current = 0
    activeRequestRef.current = ''
    lastTurnDurationRef.current = undefined
    setStatus('')
    setError('')
    setBusy(false)
    setEditingMessage(null)
    if (clearQueued) {
      queuedFollowUpsRef.current = []
      setQueuedFollowUps([])
    }
    if (nextMessages) {
      messagesRef.current = nextMessages
      setMessages(nextMessages)
    }
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
      resetTransientTurnState([])
    } else {
      resetTransientTurnState()
    }
    const res = await (window.y.engine as KernelEngineApi).startModify({ engine: id, model: resolved, options })
    if (!res.ok || !res.sessionId) {
      setError(res.error || 'Failed to start the Modify engine')
      return null
    }
    sidRef.current = res.sessionId
    setSessionId(res.sessionId)
    return res.sessionId
  }, [])

  function syncFromMainChat(state: AppState, cat = catalogRef.current, keepMessages = true): void {
    appStateRef.current = state
    const config = activeChatConfig(state, cat)
    const nextKey = configKey(config)
    if (nextKey === activeConfigKeyRef.current) return
    if (busyRef.current) {
      pendingMainConfigRef.current = { config, keepMessages }
      return
    }
    pendingMainConfigRef.current = null
    activeConfigKeyRef.current = nextKey
    setGoal(config.goal)
    void start(config.engineId, config.modelId, config.runOptions, keepMessages)
  }

  React.useEffect(() => {
    if (busy) return
    const pending = pendingMainConfigRef.current
    if (!pending) return
    pendingMainConfigRef.current = null
    activeConfigKeyRef.current = configKey(pending.config)
    setGoal(pending.config.goal)
    void start(pending.config.engineId, pending.config.modelId, pending.config.runOptions, pending.keepMessages)
  }, [busy, start])

  function configForModifyChat(chat: ModifyChatRecord, cat = catalogRef.current): {
    engineId: string
    modelId: string
    runOptions: EngineRunOptions
  } {
    const fallback = appStateRef.current
      ? activeChatConfig(appStateRef.current, cat)
      : { engineId, modelId, runOptions, goal }
    return {
      engineId: chat.engineId || fallback.engineId,
      modelId: chat.modelId || fallback.modelId,
      runOptions: chat.runOptions || fallback.runOptions
    }
  }

  function applyModifyChat(chat: ModifyChatRecord, cat = catalogRef.current): void {
    const config = configForModifyChat(chat, cat)
    const nextGoal = appStateRef.current ? activeChatConfig(appStateRef.current, cat).goal : goal
    const nextMessages = (chat.messages ?? []) as Msg[]
    setActiveModifyChatId(chat.id)
    activeModifyChatIdRef.current = chat.id
    resetTransientTurnState(nextMessages)
    setHistoryOpen(false)
    setGoal(nextGoal)
    activeConfigKeyRef.current = configKey({ ...config, goal: nextGoal })
    void start(config.engineId, config.modelId, config.runOptions, true)
    setModifyReady(true)
  }

  async function persistActiveModifyChatNow(): Promise<void> {
    const chatId = activeModifyChatIdRef.current
    if (!chatId) return
    const currentMessages = finishStreaming(messagesRef.current)
    const title = modifyTitleFromMessages(currentMessages)
    const patch = { title, messages: currentMessages, engineId, modelId, runOptions }
    setModifyChats((items) =>
      items.map((item) =>
        item.id === chatId
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item
      )
    )
    const result = await window.y.app.updateModifyChat(chatId, patch)
    if (result.ok && result.chats) setModifyChats(result.chats)
  }

  async function createModifyChat(): Promise<void> {
    if (busy) return setError('Wait until the current Modify turn finishes before opening a new Modify chat.')
    await persistActiveModifyChatNow()
    const fallback = appStateRef.current ? activeChatConfig(appStateRef.current, catalogRef.current) : { engineId, modelId, runOptions, goal }
    const result = await window.y.app.createModifyChat({
      engineId: fallback.engineId,
      modelId: fallback.modelId,
      runOptions: fallback.runOptions
    })
    if (!result.ok || !result.chat) {
      setError(result.error || 'Could not create a new Modify chat.')
      return
    }
    trackModifyEvent('modify_new_chat_created', { engineId: fallback.engineId })
    if (result.chats) setModifyChats(result.chats)
    applyModifyChat(result.chat, catalogRef.current)
  }

  async function selectModifyChat(chatId: string): Promise<void> {
    if (chatId === activeModifyChatIdRef.current) {
      setHistoryOpen(false)
      return
    }
    if (busy) return setError('Wait until the current Modify turn finishes before switching Modify chats.')
    await persistActiveModifyChatNow()
    const result = await window.y.app.setActiveModifyChat(chatId)
    if (!result.ok || !result.chats) {
      setError(result.error || 'Could not switch Modify chats.')
      return
    }
    trackModifyEvent('modify_history_chat_selected')
    setModifyChats(result.chats)
    const chat = result.chats.find((item) => item.id === result.activeChatId) ?? result.chats.find((item) => item.id === chatId)
    if (chat) applyModifyChat(chat, catalogRef.current)
  }

  const openRevertGraph = React.useCallback((): void => {
    trackModifyEvent('modify_revert_graph_opened')
    setRevertGraph((current) => ({ ...current, open: true, loading: true, error: '' }))
    void window.y.userland.history().then((result) => {
      setRevertGraph((current) => ({
        ...current,
        loading: false,
        error: result.ok ? '' : result.error || 'Could not load app history.',
        entries: result.entries ?? []
      }))
    })
  }, [])

  const closeRevertGraph = React.useCallback((): void => {
    setRevertGraph((current) => ({ ...current, open: false, error: '' }))
  }, [])

  const restoreUserlandSnapshot = React.useCallback(
    async (hash: string): Promise<void> => {
      if (busy) return
      const result = await window.y.userland.restoreSnapshot(hash)
      if (!result.ok) {
        setRevertGraph((current) => ({ ...current, error: result.error || 'Could not restore that snapshot.' }))
        return
      }
      trackModifyEvent('modify_snapshot_restored', { hash: hash.slice(0, 12) })
      addSystemNote(`Restored app snapshot ${result.hash || hash.slice(0, 7)}.`)
      closeRevertGraph()
      await start(engineId, modelId, runOptions, true)
    },
    [busy, closeRevertGraph, engineId, modelId, runOptions, start]
  )

  const resetUserlandToOriginal = React.useCallback(async (): Promise<void> => {
    if (busy) return
    if (!window.confirm('Reset y to the original app? This replaces your current customized app.')) return
    const result = await window.y.userland.resetToSeed()
    if (!result.ok) {
      setRevertGraph((current) => ({ ...current, error: result.error || 'Could not reset to the original app.' }))
      return
    }
    trackModifyEvent('modify_reset_original')
    addSystemNote('Reset y to the original app.')
    closeRevertGraph()
    await start(engineId, modelId, runOptions, true)
  }, [busy, closeRevertGraph, engineId, modelId, runOptions, start])

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
          trackModifyEvent('modify_verified', { durationMs: lastTurnDurationRef.current })
          const snapshotLabel = `after: ${activeRequestRef.current || 'Modify change'}`
          void window.y.userland.snapshot(snapshotLabel).then(() => window.y.userland.checkpoint()).then((checkpoint) => {
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
        trackModifyEvent('modify_auto_retry', { attempt: action.attempt })
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
        setStatus(isNoisyModifyStatus(e.status) ? '' : e.status)
      } else if (e.kind === 'text') {
        setStatus('')
        queueStreamText(e.text)
      } else if (e.kind === 'thinking') {
        setStatus('')
        flushStreamBuffer(true)
        enqueueStream({ kind: 'thinking', text: e.text })
      } else if (e.kind === 'tool') {
        setStatus('')
        flushStreamBuffer(true)
        if (e.phase === 'start' || e.phase === 'end') {
          trackModifyEvent('modify_tool_call', {
            engineId,
            name: e.name,
            verb: e.verb,
            phase: e.phase,
            hasTarget: Boolean(e.target)
          })
        }
        enqueueStream({ kind: 'tool', event: e })
      } else if (e.kind === 'suggestion') {
        setStatus('')
        flushStreamBuffer(true)
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
        flushStreamBuffer(true)
        setMessages((m) => {
          const next = finishStreaming(m)
          messagesRef.current = next
          return next
        })
        if (!e.ok) {
          setError(e.summary || 'The engine reported an error.')
          retriesRef.current = 0
          trackModifyEvent('modify_turn_completed', { engineId, ok: false, durationMs: lastTurnDurationRef.current })
        } else {
          trackModifyEvent('modify_turn_completed', { engineId, ok: true, durationMs: lastTurnDurationRef.current })
          scheduleVerify()
        }
      } else if (e.kind === 'error') {
        setBusy(false)
        setStatus('')
        if (streamRafRef.current != null) {
          cancelAnimationFrame(streamRafRef.current)
          flushStreamQueue()
        }
        flushStreamBuffer(true)
        setMessages((m) => {
          const next = finishStreaming(m)
          messagesRef.current = next
          return next
        })
        setError(e.message)
        trackModifyEvent('modify_turn_error', { engineId })
      }
    })
    return () => {
      if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current)
      if (streamRafRef.current != null) cancelAnimationFrame(streamRafRef.current)
      if (streamTimerRef.current != null) window.clearTimeout(streamTimerRef.current)
      off()
    }
  }, [enqueueStream, flushStreamBuffer, flushStreamQueue, queueStreamText])

  React.useEffect(() => {
    let cancelled = false
    void Promise.all([window.y.engine.models(), window.y.app.getState(), window.y.app.listModifyChats()]).then(([cat, state, modifyState]) => {
      if (cancelled) return
      setCatalog(cat)
      appStateRef.current = state
      if (!modifyState.ok) {
        setError(modifyState.error || 'Could not load Modify history.')
        syncFromMainChat(state, cat, false)
        return
      }
      const chats = modifyState.chats ?? []
      setModifyChats(chats)
      const active = chats.find((chat) => chat.id === modifyState.activeChatId) ?? chats[0]
      if (active) {
        applyModifyChat(active, cat)
      } else {
        syncFromMainChat(state, cat, false)
      }
    })
    const off = window.y.app.onStateChanged((state) => {
      syncFromMainChat(state, catalogRef.current, true)
    })
    return () => {
      cancelled = true
      if (modifyPersistTimerRef.current) clearTimeout(modifyPersistTimerRef.current)
      off()
    }
  }, [start])

  React.useEffect(() => {
    if (!modifyReady || !activeModifyChatId) return
    if (modifyPersistTimerRef.current) clearTimeout(modifyPersistTimerRef.current)
    const currentMessages = finishStreaming(messages)
    const title = modifyTitleFromMessages(currentMessages)
    setModifyChats((items) =>
      items.map((item) =>
        item.id === activeModifyChatId
          ? { ...item, title, messages: currentMessages, engineId, modelId, runOptions, updatedAt: new Date().toISOString() }
          : item
      )
    )
    modifyPersistTimerRef.current = setTimeout(() => {
      void window.y.app.updateModifyChat(activeModifyChatId, {
        title,
        messages: currentMessages,
        engineId,
        modelId,
        runOptions
      }).then((result) => {
        if (result.ok && result.chats) setModifyChats(result.chats)
      })
    }, 450)
    return () => {
      if (modifyPersistTimerRef.current) clearTimeout(modifyPersistTimerRef.current)
    }
  }, [activeModifyChatId, engineId, messages, modelId, modifyReady, runOptions])

  const addSystemNote = (text: string): void => {
    setMessages((m) => {
      const next = finishStreaming(m).concat([{ role: 'tool' as const, name: text, system: true }])
      messagesRef.current = next
      return next
    })
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
    if (streamTimerRef.current != null) window.clearTimeout(streamTimerRef.current)
    streamBufferRef.current = null
    retriesRef.current = 0
    turnStartAtRef.current = Date.now()
    activeRequestRef.current = trimmed.slice(0, 120)
    lastTurnDurationRef.current = undefined
    trackModifyEvent('modify_message_sent', {
      engineId,
      modelId,
      promptLength: trimmed.length,
      hasGoal: Boolean(goal)
    })
    trackModifyEvent('user_active', {
      surface: 'modify',
      engineId,
      hasGoal: Boolean(goal)
    })
    setBusy(true)
    setStatus('')
    scrollLogToEnd()
    void window.y.engine.send(targetSession, toSend)
  }

  React.useEffect(() => {
    if (!promptRequest?.autoSubmit || !promptRequest.text || !sessionId || busy) return
    if (handledPromptRequestIdRef.current === promptRequest.id) return
    handledPromptRequestIdRef.current = promptRequest.id
    void sendText(promptRequest.text)
  }, [busy, promptRequest?.autoSubmit, promptRequest?.id, promptRequest?.text, sessionId])

  const send = (): void => {
    const text = composerValue().trim()
    if (!text) return
    if (busy) {
      addQueuedFollowUp(text)
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

  const undoTurnEdits = async (assistantIndex: number): Promise<void> => {
    const userIndex = messages.slice(0, assistantIndex).findLastIndex((message) => message.role === 'user')
    if (userIndex === -1) return setError('Could not find the message checkpoint before those edits.')
    const message = messages[userIndex]
    const checkpointId = message?.role === 'user' ? message.checkpointId : undefined
    if (!checkpointId) return setError('This turn has no starting code checkpoint, so it cannot undo code safely.')
    const restored = await window.y.userland.restoreCheckpoint(checkpointId)
    if (!restored.ok) return setError(restored.error || 'Could not restore the code checkpoint.')
    const retained = messages.slice(0, userIndex)
    setMessages(retained)
    messagesRef.current = retained
    setEditingMessage(null)
    await start(engineId, modelId, runOptions, true)
  }

  const copyMessage = (text: string): void => {
    const write = window.y?.clipboard?.writeText
      ? window.y.clipboard.writeText(text).then((result) => {
          if (!result.ok) throw new Error(result.error || 'Could not copy message')
        })
      : navigator.clipboard.writeText(text)
    void write
  }

  const interrupt = (): void => {
    if (!sessionId) return
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current)
      verifyTimerRef.current = null
    }
    lastTurnDurationRef.current = turnStartAtRef.current ? Date.now() - turnStartAtRef.current : undefined
    if (streamRafRef.current != null) {
      cancelAnimationFrame(streamRafRef.current)
      flushStreamQueue()
    }
    flushStreamBuffer(true)
    void window.y.engine.cancel(sessionId)
    setMessages((list) => {
      const next = finishInterrupted(list, lastTurnDurationRef.current)
      messagesRef.current = next
      return next
    })
    void window.y.userland.checkpoint().then((checkpoint) => {
      if (!checkpoint.ok || !checkpoint.checkpointId) return
      setMessages((list) => {
        const next = finishInterrupted(list, lastTurnDurationRef.current, checkpoint.checkpointId)
        messagesRef.current = next
        return next
      })
    })
    setBusy(false)
    setStatus('Interrupted.')
    setError('')
    trackModifyEvent('modify_interrupted', { durationMs: lastTurnDurationRef.current })
    retriesRef.current = 0
  }

  const sendOrInterrupt = (): void => {
    if (busy && !composerValue().trim()) {
      interrupt()
      return
    }
    send()
  }

  const collapsedTurns = new Map<number, ChatWorkEntry[]>()
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
    if (chatWorkHasCollapsibleTool(work)) {
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
              <ModifyMark size={14} />
            </span>
            <span className="modify-title">Modify</span>
          </div>
          <div className="modify-head-actions">
            <button
              type="button"
              className="modify-icon-button"
              disabled={busy}
              onClick={() => void createModifyChat()}
              aria-label="New Modify chat"
              title="New Modify chat"
            >
              <ModifyNewIcon size={16} />
            </button>
            <div className="modify-history-wrap">
              <button
                type="button"
                className={'modify-icon-button' + (historyOpen ? ' active' : '')}
                onClick={() => setHistoryOpen((open) => {
                  if (!open) trackModifyEvent('modify_history_opened')
                  return !open
                })}
                aria-label="Modify history"
                title="Modify history"
              >
                <ModifyHistoryIcon size={16} />
              </button>
              {historyOpen ? (
                <div className="modify-history-menu">
                  {modifyChats.length ? (
                    modifyChats.map((chat) => (
                      <button
                        type="button"
                        key={chat.id}
                        className={'modify-history-item' + (chat.id === activeModifyChatId ? ' active' : '')}
                        disabled={busy && chat.id !== activeModifyChatId}
                        onClick={() => void selectModifyChat(chat.id)}
                      >
                        <span className="modify-history-main">
                          <span className="modify-history-title">{chat.title || 'New Modify chat'}</span>
                          <span className="modify-history-count">{chat.messages.length} messages</span>
                        </span>
                        <span className="modify-history-age">{formatModifyChatAge(chat.updatedAt)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="modify-history-empty">No Modify chats yet.</div>
                  )}
                </div>
              ) : null}
            </div>
            <button type="button" className="modify-icon-button" onClick={openRevertGraph} aria-label="Revert app" title="Revert app">
              <ModifyResetIcon size={16} />
            </button>
            <button type="button" className="modify-icon-button accent" onClick={onClose} aria-label="Close Modify" title="Close Modify">
              <ModifyXIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      {revertGraph.open ? (
        <div className="modify-revert-overlay" role="dialog" aria-modal="true" aria-label="Revert app">
          <div className="modify-revert-panel">
            <div className="modify-revert-head">
              <div>
                <strong>Revert app</strong>
                <p>Pick a saved point in the app graph, or reset back to the original app.</p>
              </div>
              <button type="button" className="modify-message-action" aria-label="Close revert graph" onClick={closeRevertGraph}>
                ×
              </button>
            </div>
            {busy ? <div className="modify-revert-note">Wait until the coding agent finishes before reverting.</div> : null}
            <button type="button" className="modify-reset-original" disabled={busy} onClick={() => void resetUserlandToOriginal()}>
              Reset to original app
            </button>
            <div className="modify-revert-graph" data-testid="modify-revert-graph">
              {revertGraph.entries.length ? (
                revertGraph.entries.map((entry) => (
                  <button
                    type="button"
                    key={entry.hash}
                    className={'modify-revert-node' + (entry.current ? ' is-current' : '')}
                    disabled={busy || entry.current}
                    onClick={() => void restoreUserlandSnapshot(entry.hash)}
                  >
                    <span className="modify-revert-line" aria-hidden="true" />
                    <span className="modify-revert-dot" aria-hidden="true" />
                    <span className="modify-revert-node-main">
                      <span>{entry.label}</span>
                      <code>{entry.current ? 'Current app' : entry.kind === 'original' ? 'Starting point' : entry.shortHash}</code>
                    </span>
                    <span className="modify-revert-node-meta">
                      {new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </button>
                ))
              ) : !revertGraph.loading ? (
                <div className="modify-revert-empty">No saved app graph yet. You can still reset to the original app.</div>
              ) : null}
            </div>
            {revertGraph.error ? <div className="modify-error">{revertGraph.error}</div> : null}
          </div>
        </div>
      ) : null}

      <div className="modify-log" ref={logRef}>
        <div className="modify-log-inner">
          {messages.length === 0 && !error ? (
            <div className="modify-empty">
              <span className="modify-empty-icon">
                <ModifyMark size={28} />
              </span>
              <p>Describe a UI or behavior change. The agent edits it live.</p>
            </div>
          ) : null}
          {messages.map((m, i) => {
            const key = `${m.role}-${'id' in m && m.id ? m.id : i}`
            if (hiddenWork.has(i)) return null
            if (m.role === 'thinking') return <ChatThinkingBlock key={key} message={m} classes={CHAT_SURFACE_CLASSES.modify} />
            if (m.role === 'tool') {
              if (m.system) return <div key={key} className={CHAT_SURFACE_CLASSES.modify.toolNote}>{m.name}</div>
              return <ChatToolMessage key={key} message={m} langFromTarget={langFromTarget} />
            }
            if (m.role === 'user') {
              return (
                <ChatUserMessage
                  key={key}
                  text={m.text ?? ''}
                  editingText={editingMessage?.index === i ? editingMessage.text : undefined}
                  classes={CHAT_SURFACE_CLASSES.modify}
                  testId="modify-user-message"
                  onCopy={() => copyMessage(m.text)}
                  onStartEdit={() => setEditingMessage({ index: i, text: m.text })}
                  onEditChange={(text) => setEditingMessage({ index: i, text })}
                  onSubmitEdit={() => {
                    if (editingMessage?.index === i) void editUserMessage(i, editingMessage.text)
                  }}
                  onCancelEdit={() => setEditingMessage(null)}
                />
              )
            }
            const assistantMessage = (
              <ChatAssistantMessage
                key={key}
                text={m.text ?? ''}
                checkpointId={m.checkpointId}
                classes={CHAT_SURFACE_CLASSES.modify}
                onCopy={() => copyMessage(m.text ?? '')}
                onReset={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  void resetToMessage(i)
                }}
              />
            )
            const work = collapsedTurns.get(i)
            if (!work) return assistantMessage
            return (
              <div key={`completed-${key}`} className={CHAT_SURFACE_CLASSES.modify.completedTurn}>
                <ChatWorkSummary
                  work={work}
                  durationMs={m.durationMs}
                  interrupted={m.interrupted}
                  classes={CHAT_SURFACE_CLASSES.modify}
                  testId="modify-work-log"
                  formatDuration={formatDuration}
                  langFromTarget={langFromTarget}
                />
                {assistantMessage}
                <ChatEditedFilesSummary
                  work={work}
                  classes={CHAT_SURFACE_CLASSES.modify}
                  testId="modify-edited-files"
                  onUndo={() => void undoTurnEdits(i)}
                />
              </div>
            )
          })}
          {busy ? (
            <div className="modify-live-work">
              <ModifyBinarySpinner />
              <span>Working for {formatLiveDuration(Math.max(0, elapsedTick - turnStartAtRef.current))}</span>
            </div>
          ) : null}
          {status ? <div className="modify-status">{status}</div> : null}
          {error ? <div className="modify-error">{error}</div> : null}
        </div>
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
        <ChatComposerShell
          classes={CHAT_SURFACE_CLASSES.modify}
          testId="modify-composer"
          inputRef={inputRef}
          placeholder={sessionId ? 'Describe a change to the app…' : 'Starting Modify engine…'}
          onInput={handleComposerInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        >
          <div className={CHAT_SURFACE_CLASSES.modify.composerRow}>
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
        </ChatComposerShell>
      </div>
    </div>
  )
}

export default ModifyChat
