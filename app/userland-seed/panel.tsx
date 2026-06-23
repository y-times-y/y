import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import XtermTerminal from '@renderer/kernel/XtermTerminal'
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
} from '@renderer/kernel/ChatPrimitives'
import hljs from 'highlight.js/lib/common'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

// Default chat UI — lives in USERLAND (fully moddable). Uses window.y.engine bricks.
const LABELS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

function clampPanelSize(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function storedBoolean(key: string, fallback: boolean): boolean {
  const value = window.localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}

const PREVIEW_CATALOG: EngineModelCatalog[] = [
  {
    engine: 'claude-code',
    label: 'Claude Code',
    defaultModel: 'claude-sonnet-4-6#effort=medium',
    models: [
      { id: 'claude-sonnet-4-6#effort=low', label: 'Sonnet 4.6 · Low', contextWindow: 200_000 },
      { id: 'claude-sonnet-4-6#effort=medium', label: 'Sonnet 4.6 · Medium', contextWindow: 200_000 },
      { id: 'claude-sonnet-4-6#effort=high', label: 'Sonnet 4.6 · High', contextWindow: 200_000 },
      { id: 'claude-sonnet-4-6#effort=max', label: 'Sonnet 4.6 · Max', contextWindow: 200_000 },
      { id: 'claude-sonnet-4-6[1m]#effort=low', label: 'Sonnet 4.6 · Low', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6[1m]#effort=medium', label: 'Sonnet 4.6 · Medium', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6[1m]#effort=high', label: 'Sonnet 4.6 · High', contextWindow: 1_000_000 },
      { id: 'claude-sonnet-4-6[1m]#effort=max', label: 'Sonnet 4.6 · Max', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-8#effort=medium', label: 'Opus 4.8 · Medium', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-8#effort=max', label: 'Opus 4.8 · Max', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-8[1m]#effort=medium', label: 'Opus 4.8 · Medium', contextWindow: 1_000_000 },
      { id: 'claude-opus-4-8[1m]#effort=max', label: 'Opus 4.8 · Max', contextWindow: 1_000_000 },
      { id: 'claude-haiku-4-5-20251001#effort=medium', label: 'Haiku 4.5 · Medium', contextWindow: 200_000 },
      { id: 'claude-haiku-4-5-20251001#effort=max', label: 'Haiku 4.5 · Max', contextWindow: 200_000 }
    ]
  },
  {
    engine: 'codex',
    label: 'Codex',
    defaultModel: 'gpt-5.5#effort=medium',
    models: [
      { id: 'gpt-5.5#effort=low', label: 'GPT-5.5 · Low' },
      { id: 'gpt-5.5#effort=medium', label: 'GPT-5.5 · Medium' },
      { id: 'gpt-5.5#effort=high', label: 'GPT-5.5 · High' },
      { id: 'gpt-5.4-mini#effort=medium', label: 'GPT-5.4 Mini · Medium' }
    ]
  }
]

const PREVIEW =
  typeof window !== 'undefined' &&
  (!!(window as Window & { __Y_PREVIEW__?: boolean }).__Y_PREVIEW__ ||
    window.location.pathname.endsWith('/preview.html'))
type Msg = AppMsg
type Project = AppProject

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybeHuman = Reflect.get(error, 'humanReadableMessage')
    if (typeof maybeHuman === 'string' && maybeHuman.trim()) return maybeHuman
    const maybeMessage = Reflect.get(error, 'message')
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage
  }
  return error instanceof Error ? error.message : String(error)
}

type QueuedFollowUp = {
  id: string
  text: string
  steer: boolean
  goal?: boolean
}

type ChatRuntime = {
  sessionId?: string
  engineId?: string
  busy?: boolean
  startedAt?: number
  status?: string
  error?: string
  goalBacked?: boolean
}

type CompletionAudioContext = AudioContext & { webkitAudioContext?: never }

type ComposerTerminal = {
  id: string
  title: string
  command?: string
  body: string
  running: boolean
  transient?: boolean
}

type StreamBuffer = {
  text: string
  engineId: string
  firstAt: number
}

type PastedTextAttachment = {
  id: string
  name: string
  text: string
  size: number
}

type OnboardingCliToolStatus = {
  id: 'claude-code' | 'codex'
  label: string
  command: string
  installed: boolean
  version?: string
  authenticated: boolean
  installCommand: string
  authCommand: string
  docsUrl: string
  error?: string
}

type OnboardingCliCheckResult = {
  ok: boolean
  checkedAt: string
  tools: OnboardingCliToolStatus[]
}

type KernelAuthUser = {
  id: string
  email?: string
  displayName?: string
  profileImageUrl?: string
  connectedAccounts?: KernelAuthConnectedAccount[]
}

type KernelAuthConnectedAccount = {
  provider: string
  providerAccountId: string
  profile?: {
    username?: string
    displayName?: string
    avatarUrl?: string
    profileUrl?: string
  }
}

type FileTreeNode =
  | { kind: 'file'; file: SelectedFile; name: string; depth: number }
  | { kind: 'folder'; folderPath: string; name: string; depth: number }

const STREAM_MIN_CHARS = 360
const STREAM_MAX_CHARS = 1400
const STREAM_MAX_HOLD_MS = 1400
const STREAM_FLUSH_MS = 180
const PASTE_ATTACHMENT_MIN_CHARS = 900
const PASTE_ATTACHMENT_MIN_LINES = 12
const MAX_FILE_ATTACHMENTS = 8
const MAX_FILE_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_PASTED_ATTACHMENTS = 3
const MAX_PASTED_ATTACHMENT_BYTES = 120 * 1024
const MAX_TOTAL_PASTED_ATTACHMENT_BYTES = 240 * 1024
const COMPOSER_MAX_HEIGHT = 164
const CHAT_LIST_COLLAPSED_LIMIT = 5
const ONBOARDING_DONE_KEY = 'y.onboarding.done'
const ONBOARDING_CLI_DONE_KEY = 'y.onboarding.cli.v2.done'

function trackEvent(name: string, props?: Record<string, unknown>): void {
  const analytics = (window.y as Window['y'] & { analytics?: { track: (name: string, props?: Record<string, unknown>) => Promise<unknown> } }).analytics
  if (PREVIEW || !analytics) return
  void analytics.track(name, props)
}

function isNoisyRuntimeStatus(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return !normalized || normalized === '...' || normalized === 'requesting' || normalized === 'requesting...' || normalized === 'reasoning' || normalized === 'codex turn started'
}

function isCompactionStatus(value: string): boolean {
  return /\bcompact(?:ing|ed)?\b/i.test(value)
}

function BinaryYMark() {
  // 24 rows = 12 visible + 12 duplicate — even count keeps alternating pattern aligned at loop boundary
  const rows = Array.from({ length: 24 }, function (_, index) {
    return index % 2 === 0 ? '01010101010101' : '10101010101010'
  })
  return (
    <svg className="y-mark" viewBox="0 0 84 92" role="img" aria-label="y" data-testid="binary-y">
      <defs>
        <clipPath id="binary-y-clip">
          <text x="42" y="68" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="90" fontWeight="700">y</text>
        </clipPath>
      </defs>
      <g clipPath="url(#binary-y-clip)">
        <g className="binary-y-digits">
          {rows.map(function (row, index) {
            return <text key={index} x="0" y={8 + index * 8} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="8" letterSpacing="0.15">{row}</text>
          })}
        </g>
      </g>
    </svg>
  )
}

const BINARY_SPINNER_DIGITS = ['1', '0', '1', '0', '1', '0', '1', '0', '1']
const BINARY_SPINNER_POSITIONS = [
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
const BINARY_SPINNER_ROUTES = [
  [0, 1, 2, 5, 8, 7, 6, 3, 4],
  [2, 5, 8, 7, 6, 3, 0, 1, 4],
  [8, 7, 6, 3, 0, 1, 2, 5, 4],
  [6, 3, 0, 1, 2, 5, 8, 7, 4]
]
const BINARY_SPINNER_ROUTE_LENGTH = BINARY_SPINNER_ROUTES[0].length
const BINARY_SPINNER_RESET_STEPS = 4
const BINARY_SPINNER_CYCLE_LENGTH = BINARY_SPINNER_ROUTE_LENGTH + BINARY_SPINNER_RESET_STEPS
const BINARY_SPINNER_TOTAL_STEPS = BINARY_SPINNER_ROUTES.length * BINARY_SPINNER_CYCLE_LENGTH
const BINARY_SPINNER_STEP_MS = 125

function currentBinarySpinnerTick(): number {
  return Math.floor(Date.now() / BINARY_SPINNER_STEP_MS) % BINARY_SPINNER_TOTAL_STEPS
}

function BinarySpinner() {
  const [tick, setTick] = useState(currentBinarySpinnerTick)
  useEffect(() => {
    const id = window.setInterval(() => setTick(currentBinarySpinnerTick()), BINARY_SPINNER_STEP_MS)
    return () => window.clearInterval(id)
  }, [])
  const phase = tick % BINARY_SPINNER_CYCLE_LENGTH
  const routeIndex = Math.floor(tick / BINARY_SPINNER_CYCLE_LENGTH) % BINARY_SPINNER_ROUTES.length
  const route = BINARY_SPINNER_ROUTES[routeIndex]
  const resetting = phase >= BINARY_SPINNER_ROUTE_LENGTH
  const activeIndex = route[Math.min(phase, BINARY_SPINNER_ROUTE_LENGTH - 1)]
  const activePosition = BINARY_SPINNER_POSITIONS[activeIndex]
  return (
    <span className={'y-binary-spinner' + (resetting ? ' is-resetting' : '')} data-testid="binary-stream-spinner" aria-label="Streaming">
      <span
        className="y-binary-glow"
        aria-hidden
        style={{ transform: `translate(${activePosition.x}px, ${activePosition.y}px)` }}
      />
      {BINARY_SPINNER_DIGITS.map((digit, index) => (
        <span key={index} className={'y-binary-cell cell-' + (index + 1) + (index === activeIndex ? ' active' : '')}>{digit}</span>
      ))}
    </span>
  )
}

function formatDuration(durationMs?: number): string {
  const totalSeconds = Math.max(1, Math.round((durationMs ?? 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function formatLiveDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function buildVisibleTree(
  directories: Record<string, ProjectDirectoryEntry[]>,
  expanded: Set<string>
): FileTreeNode[] {
  const nodes: FileTreeNode[] = []
  function addLevel(parentPath: string, depth: number): void {
    const entries = directories[parentPath] ?? []
    for (const entry of entries) {
      const relPath = (entry.relPath || entry.name).replace(/\\/g, '/')
      if (entry.kind === 'directory') {
        nodes.push({ kind: 'folder', folderPath: relPath, name: entry.name, depth })
        if (expanded.has(relPath)) addLevel(relPath, depth + 1)
      } else {
        nodes.push({ kind: 'file', file: entry, name: entry.name, depth })
      }
    }
  }
  addLevel('', 0)
  return nodes
}

type FileMode = 'preview' | 'edit' | 'diff'

function defaultRunOptions(): EngineRunOptions {
  return {}
}

function parseModelId(id: string): { base: string; effort: string } {
  const i = id.indexOf('#effort=')
  return i === -1 ? { base: id, effort: 'medium' } : { base: id.slice(0, i), effort: id.slice(i + 8) }
}

function buildModelId(base: string, effort: string): string {
  return `${base}#effort=${effort}`
}

const LONG_TASK_NOTIFY_MS = 25_000
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
type BuiltInCommand = { name: string; source?: string; detail?: string; engines?: string[] }

const BUILT_IN_COMMANDS: BuiltInCommand[] = [
  { name: '/effort', source: 'y', detail: 'set reasoning effort' },
  { name: '/goal', source: 'Codex', detail: 'show or set current goal', engines: ['codex'] },
  { name: '/compact', source: 'engine', detail: 'compact context' },
  { name: '/update', source: 'engine', detail: 'update current CLI' },
  { name: '/plugins', source: 'engine', detail: 'list installed plugins' },
  { name: '/plugin', source: 'engine', detail: 'run plugin subcommands' },
  { name: '/mcp', source: 'engine', detail: 'list configured MCP servers' },
  { name: '/doctor', source: 'engine', detail: 'check CLI health' },
  { name: '/auth', source: 'Claude', detail: 'Claude auth commands', engines: ['claude-code'] },
  { name: '/login', source: 'Codex', detail: 'Codex login commands', engines: ['codex'] },
  { name: '/logout', source: 'Codex', detail: 'Codex logout', engines: ['codex'] },
  { name: '/features', source: 'Codex', detail: 'Codex feature flags', engines: ['codex'] },
  { name: '/agents', source: 'Claude', detail: 'Claude background agents', engines: ['claude-code'] },
  { name: '/project', source: 'Claude', detail: 'Claude project commands', engines: ['claude-code'] },
  { name: '/auto-mode', source: 'Claude', detail: 'Claude auto-mode commands', engines: ['claude-code'] },
  { name: '/marketplaces', source: 'engine', detail: 'plugin marketplaces' },
  { name: '/terminal', source: 'y', detail: 'open an inline PTY terminal' },
  { name: '/term', source: 'y', detail: 'open an inline PTY terminal' },
  { name: '/clear', source: 'y', detail: 'clear visible chat' },
  { name: '/help', source: 'y', detail: 'show commands' }
]

function slashHelpForEngine(engineId: string): string {
  const common = 'Commands: /effort <low|medium|high|xhigh|max>, /reasoning <level>, /compact, /plugins [subcommand], /mcp [subcommand], /doctor, /update, /clear, /help'
  if (engineId === 'codex') return common + ', /goal <text>, /goal clear, /login [status], /logout, /features <list|enable|disable>.'
  return common + ', /auth <status|login|logout>, /agents, /project purge [path], /auto-mode <config|defaults|critique>.'
}

function builtInCommandsForEngine(engineId: string): BuiltInCommand[] {
  return BUILT_IN_COMMANDS
    .filter(function (item) { return !item.engines || item.engines.includes(engineId) })
    .map(function (item) {
      return item.source === 'engine' ? { ...item, source: LABELS[engineId] || engineId } : item
    })
}

function commandNameForLookup(command: string): string {
  const name = command.replace(/^\//, '').toLowerCase()
  if (name === 'reasoning') return '/effort'
  if (name === 'plugin') return '/plugins'
  if (name === 'marketplace') return '/marketplaces'
  if (name === 'term') return '/terminal'
  return '/' + name
}

function commandEntryFor(command: string): BuiltInCommand | undefined {
  const lookup = commandNameForLookup(command)
  return BUILT_IN_COMMANDS.find(function (item) { return item.name.toLowerCase() === lookup })
}

function isCommandAvailableForEngine(command: string, engineId: string): boolean {
  const entry = commandEntryFor(command)
  return !entry?.engines || entry.engines.includes(engineId)
}

function commandUnavailableMessage(command: string, engineId: string): string {
  const entry = commandEntryFor(command)
  const engines = entry?.engines?.map(function (id) { return LABELS[id] || id }).join(' or ')
  const label = LABELS[engineId] || engineId
  return engines ? `${entry?.name || command} is only available for ${engines}. Current engine: ${label}.` : `${command} is not available for ${label}.`
}

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

function modelDisplayLabel(engineId: string, modelId: string, label: string): string {
  return engineId === 'claude-code' && modelId.includes('[1m]') ? `${label} 1M` : label
}

function catalogBaseModels(cat: EngineModelCatalog[], engineId: string): Array<{ id: string; label: string }> {
  const seen = new Set<string>()
  return (cat.find(function (c) { return c.engine === engineId })?.models ?? []).reduce<Array<{ id: string; label: string }>>(function (acc, m) {
    const base = m.id.split('#')[0]
    const label = modelDisplayLabel(engineId, base, m.label.split(' · ')[0])
    if (!seen.has(base)) { seen.add(base); acc.push({ id: base, label }) }
    return acc
  }, [])
}

function catalogEfforts(cat: EngineModelCatalog[], engineId: string, base: string): Array<{ id: string; label: string }> {
  return (cat.find(function (c) { return c.engine === engineId })?.models ?? [])
    .filter(function (m) { return m.id.startsWith(base + '#effort=') })
    .map(function (m) { return { id: m.id.slice(m.id.indexOf('#effort=') + 8), label: m.label.split(' · ')[1] ?? m.id } })
}

function toolVerbFromName(name: string): string {
  const map: Record<string, string> = {
    Read: 'Read',
    Edit: 'Edit',
    Write: 'Write',
    Grep: 'Grep',
    Glob: 'Glob',
    shell: 'Run'
  }
  return map[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

function toolTargetFile(target?: string): string | undefined {
  if (!target) return undefined
  const clean = target.replace(/ · .*$/, '')
  const matches = clean.match(/[A-Za-z0-9_@.()\/-]+\.[A-Za-z0-9]+/g)
  return matches?.[matches.length - 1]
}

const NAV = [
  { id: 'new', label: 'New chat', icon: 'plus' },
  { id: 'open', label: 'Add folder', icon: 'folder' },
  { id: 'search', label: 'Search', icon: 'search' }
] as const

function chatTitleFromText(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\/\w+\s*/, '')
    .replace(/^(can you|could you|please|pls|hey|hi|alright|okay|ok)\b[\s,]*/i, '')
    .replace(/^(add|make|create|build|implement|fix|change|update)\s+(the\s+)?(ability\s+to\s+)?/i, '')
    .replace(/\b(actually|just|maybe|like|you know|also|itself|thing|stuff)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}@#/_ .-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const stop = new Set(['the', 'a', 'an', 'to', 'for', 'with', 'and', 'or', 'of', 'in', 'on', 'is', 'are', 'be'])
  const words = cleaned.split(' ').filter(Boolean)
  const meaningful = words.filter((word) => !stop.has(word.toLowerCase()))
  const picked = (meaningful.length >= 2 ? meaningful : words).slice(0, 5)
  const title = picked
    .map((word) => {
      if (/^[A-Z0-9_./-]+$/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
  return title || 'New chat'
}

function findActiveProject(projects: Project[], projectId?: string): Project | undefined {
  return projects.find((p) => p.id === projectId) ?? projects[0]
}

function findActiveChat(project?: Project, chatId?: string): AppChat | undefined {
  return project?.chats.find((c) => c.id === chatId && !c.archived) ?? project?.chats.find((c) => !c.archived)
}

function formatAge(value: string): string {
  const ts = new Date(value).getTime()
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))}h`
  return `${Math.max(1, Math.floor(diff / 86_400_000))}d`
}

function formatBytes(size?: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size)) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function fileExt(name: string): string {
  const base = name.split('/').pop() || name
  const i = base.lastIndexOf('.')
  return i === -1 ? '' : base.slice(i + 1).toLowerCase()
}

function fileIconMeta(name: string): { label: string; bg: string; fg?: string } {
  const ext = fileExt(name)
  const w = '#ffffff'
  const k = '#1a1a1a'
  const map: Record<string, { label: string; bg: string; fg?: string }> = {
    ts:      { label: 'TS',   bg: '#3178c6', fg: w },
    tsx:     { label: 'TSX',  bg: '#0ea5e9', fg: w },
    js:      { label: 'JS',   bg: '#ca8a04', fg: k },
    jsx:     { label: 'JSX',  bg: '#ca8a04', fg: k },
    mjs:     { label: 'MJS',  bg: '#ca8a04', fg: k },
    cjs:     { label: 'CJS',  bg: '#ca8a04', fg: k },
    py:      { label: 'PY',   bg: '#2563eb', fg: w },
    rb:      { label: 'RB',   bg: '#dc2626', fg: w },
    go:      { label: 'GO',   bg: '#0891b2', fg: w },
    rs:      { label: 'RS',   bg: '#c2410c', fg: w },
    java:    { label: 'JV',   bg: '#d97706', fg: w },
    kt:      { label: 'KT',   bg: '#7c3aed', fg: w },
    swift:   { label: 'SW',   bg: '#ea580c', fg: w },
    css:     { label: 'CSS',  bg: '#7c3aed', fg: w },
    scss:    { label: 'SCss', bg: '#db2777', fg: w },
    less:    { label: 'LES',  bg: '#1d4ed8', fg: w },
    html:    { label: 'HTM',  bg: '#ea580c', fg: w },
    json:    { label: '{ }',  bg: '#475569', fg: w },
    jsonc:   { label: '{ }',  bg: '#475569', fg: w },
    md:      { label: 'MD',   bg: '#4b5563', fg: w },
    mdx:     { label: 'MDX',  bg: '#4b5563', fg: w },
    yaml:    { label: 'YML',  bg: '#b91c1c', fg: w },
    yml:     { label: 'YML',  bg: '#b91c1c', fg: w },
    toml:    { label: 'TML',  bg: '#92400e', fg: w },
    sh:      { label: 'SH',   bg: '#059669', fg: w },
    bash:    { label: 'SH',   bg: '#059669', fg: w },
    zsh:     { label: 'ZSH',  bg: '#059669', fg: w },
    env:     { label: 'ENV',  bg: '#065f46', fg: w },
    png:     { label: 'PNG',  bg: '#6d28d9', fg: w },
    jpg:     { label: 'JPG',  bg: '#6d28d9', fg: w },
    jpeg:    { label: 'JPG',  bg: '#6d28d9', fg: w },
    gif:     { label: 'GIF',  bg: '#6d28d9', fg: w },
    svg:     { label: 'SVG',  bg: '#b45309', fg: w },
    pdf:     { label: 'PDF',  bg: '#dc2626', fg: w },
    sql:     { label: 'SQL',  bg: '#0e7490', fg: w },
    graphql: { label: 'GQL',  bg: '#9d174d', fg: w },
    gql:     { label: 'GQL',  bg: '#9d174d', fg: w },
    prisma:  { label: 'PRM',  bg: '#0369a1', fg: w },
    lock:    { label: 'LCK',  bg: '#374151', fg: w },
    xml:     { label: 'XML',  bg: '#b45309', fg: w },
    csv:     { label: 'CSV',  bg: '#047857', fg: w },
    txt:     { label: 'TXT',  bg: '#374151', fg: w },
  }
  return map[ext] || { label: ext ? ext.slice(0, 3).toUpperCase() : 'F', bg: '#374151', fg: w }
}

function fileDisplayPath(file: SelectedFile): string {
  return file.relPath || file.path
}

function isMarkdownFile(file?: SelectedFile | null): boolean {
  if (!file) return false
  const ext = fileExt(file.name)
  return ext === 'md' || ext === 'markdown' || ext === 'mdx'
}

function isCodeFile(file?: SelectedFile | null): boolean {
  if (!file) return false
  const ext = fileExt(file.name)
  return !['md', 'mdx', 'markdown', 'txt', 'text', 'csv', 'tsv', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', ''].includes(ext)
}

function isImageFile(file?: SelectedFile | null): boolean {
  if (!file) return false
  const ext = fileExt(file.name)
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)
}

function codeFileLang(name: string): string {
  const ext = fileExt(name)
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript',
    cjs: 'javascript', jsx: 'javascript', py: 'python', rb: 'ruby',
    go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss',
    less: 'less', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', graphql: 'graphql', gql: 'graphql', xml: 'xml',
    prisma: 'prisma', env: 'shell', csv: 'csv',
  }
  return map[ext] || ext
}

function FolderIcon({ open, size = 20 }: { open: boolean; size?: number }) {
  const s = { display: 'block', flexShrink: 0 } as CSSProperties
  const stroke = 'rgba(255,255,255,0.55)'
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={s}>
      {open ? (
        <>
          <path d="M4 8A1.5 1.5 0 015.5 6.5H8l1.5 1.5H14.5A1.5 1.5 0 0116 9.5v5A1.5 1.5 0 0114.5 16h-9A1.5 1.5 0 014 14.5V8z"
            stroke={stroke} strokeWidth="1.25" strokeLinejoin="round"/>
          <path d="M4 9.5h12" stroke={stroke} strokeWidth="1.1" strokeLinecap="round"/>
        </>
      ) : (
        <path d="M4 8A1.5 1.5 0 015.5 6.5H8l1.5 1.5H14.5A1.5 1.5 0 0116 9.5v5A1.5 1.5 0 0114.5 16h-9A1.5 1.5 0 014 14.5V8z"
          stroke={stroke} strokeWidth="1.25" strokeLinejoin="round"/>
      )}
    </svg>
  )
}

function FileIcon({ name, size = 22 }: { name: string; size?: number }) {
  const ext = fileExt(name)
  const s = { display: 'block', flexShrink: 0 } as CSSProperties
  const badge = (label: string, bg: string, fg = '#ffffff') => {
    const fs = label.length >= 4 ? 34 : label.length === 3 ? 40 : 48
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" style={s}>
        <rect width="100" height="100" rx="14" fill={bg}/>
        <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" fill={fg}
          fontFamily="system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif"
          fontWeight="700" fontSize={fs}>{label}</text>
      </svg>
    )
  }
  const base = name.split('/').pop() || name
  const isGit = base === '.git' || base.startsWith('.git') || ext === 'git' || base === '.gitignore' || base === '.gitattributes'
  const isNpm = base === 'package.json' || base === 'package-lock.json'

  if (isGit) return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#e64a19" d="M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0"/>
    </svg>
  )
  if (isNpm) return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#e53935" d="M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z"/>
    </svg>
  )
  if (ext === 'ts') return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={s}>
      <path fill="#0288d1" d="M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1"/>
    </svg>
  )
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={s}>
      <path fill="#ffca28" d="M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1"/>
    </svg>
  )
  if (ext === 'tsx' || ext === 'jsx') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#00bcd4" d="M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6"/>
      <path fill="#00bcd4" d="M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2"/>
      <path fill="#00bcd4" d="M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z"/>
      <path fill="#00bcd4" d="M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369"/>
    </svg>
  )
  if (ext === 'py') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#0288d1" d="M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711"/>
      <path fill="#fdd835" d="M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM14.86 18.61c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89"/>
    </svg>
  )
  if (ext === 'go') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#00acc1" d="M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5"/>
      <path fill="#00acc1" d="M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z"/>
    </svg>
  )
  if (ext === 'rs') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#ff7043" d="m30 12-4-2V6h-4l-2-4-4 2-4-2-2 4H6v4l-4 2 2 4-2 4 4 2v4h4l2 4 4-2 4 2 2-4h4v-4l4-2-2-4ZM6 16a9.9 9.9 0 0 1 .842-4H10v8H6.842A9.9 9.9 0 0 1 6 16m10 10a9.98 9.98 0 0 1-7.978-4H16v-2h-2v-2h4c.819.819.297 2.308 1.179 3.37a1.89 1.89 0 0 0 1.46.63h3.34A9.98 9.98 0 0 1 16 26m-2-12v-2h4a1 1 0 0 1 0 2Zm11.158 6H24a2.006 2.006 0 0 1-2-2 2 2 0 0 0-2-2 3 3 0 0 0 3-3q0-.08-.004-.161A3.115 3.115 0 0 0 19.83 10H8.022a9.986 9.986 0 0 1 17.136 10"/>
    </svg>
  )
  if (ext === 'rb') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#f44336" d="M18.041 3.177c2.24.382 2.879 1.919 2.843 3.527V6.67l-1.013 13.266-13.132.897h.008c-1.093-.044-3.518-.151-3.634-3.545l1.217-2.222 2.462 5.74 2.097-6.77-.045.009.018-.018 6.85 2.186L13.945 9.3l6.53-.409-5.144-4.212 2.71-1.51v.009M3.113 17.252v.017zM6.916 6.874c2.63-2.622 6.033-4.168 7.34-2.844 1.297 1.306-.072 4.523-2.702 7.135-2.666 2.613-6.015 4.248-7.322 2.933-1.306-1.324.036-4.612 2.675-7.224z"/>
    </svg>
  )
  if (ext === 'swift') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#ff6e40" d="M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.23-5.32c.67.55 1.46 1 2.3 1.4 3.37 1.57 6.73 1.46 9.1 0-3.37-2.59-6.24-5.96-8.37-8.71-.45-.45-.78-1.01-1.12-1.51 8.28 6.05 7.92 7.59 2.41-1.01 4.89 4.94 9.43 7.74 9.43 7.74.16.09.25.16.36.22.1-.25.19-.51.26-.78.79-2.85-.11-6.12-2.08-8.81 4.55 2.75 7.25 7.91 6.12 12.24-.03.11-.06.22-.05.39 2.24 2.83 1.64 5.78 1.35 5.22-1.21-2.39-3.48-1.65-4.62-1.17"/>
    </svg>
  )
  if (ext === 'html' || ext === 'htm') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#e65100" d="m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z"/>
    </svg>
  )
  if (ext === 'css') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#7e57c2" d="M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034"/>
      <path fill="#7e57c2" d="M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/>
    </svg>
  )
  if (ext === 'scss' || ext === 'sass') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#ec407a" d="M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754"/>
    </svg>
  )
  if (ext === 'json' || ext === 'jsonc') return (
    <svg width={size} height={size} viewBox="0 -960 960 960" style={s}>
      <path fill="#f9a825" d="M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z"/>
    </svg>
  )
  if (ext === 'md' || ext === 'mdx') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#42a5f5" d="m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z"/>
    </svg>
  )
  if (ext === 'yaml' || ext === 'yml') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#ff5252" d="M13 9h5.5L13 3.5zM6 2h8l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m12 16v-2H9v2zm-4-4v-2H6v2z"/>
    </svg>
  )
  if (ext === 'java') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#f44336" d="M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z"/>
    </svg>
  )
  if (ext === 'kt') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <defs>
        <linearGradient id="kt-g" x1="1.725" x2="22.185" y1="22.67" y2="1.982" gradientTransform="translate(1.306 1.129)scale(.89324)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c4dff"/>
          <stop offset=".5" stopColor="#d500f9"/>
          <stop offset="1" stopColor="#ef5350"/>
        </linearGradient>
      </defs>
      <path fill="url(#kt-g)" d="M2.975 2.976v18.048h18.05v-.03l-4.478-4.511-4.48-4.515 4.48-4.515 4.443-4.477z"/>
    </svg>
  )
  if (ext === 'less') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#0277bd" d="M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z"/>
    </svg>
  )
  if (ext === 'toml') return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={s}>
      <path fill="#cfd8dc" d="M4 6V4h8v2H9v7H7V6z"/>
      <path fill="#ef5350" d="M4 1v1H2v12h2v1H1V1zm8 0v1h2v12h-2v1h3V1z"/>
    </svg>
  )
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={s}>
      <path fill="#ff7043" d="M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z"/>
    </svg>
  )
  if (ext === 'env') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#ffd54f" d="M25 12h-3V8a6 6 0 0 0-12 0v4H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1M14 8a2 2 0 0 1 4 0v4h-4Zm2 17a4 4 0 1 1 4-4 4 4 0 0 1-4 4"/>
    </svg>
  )
  if (ext === 'sql') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#ffca28" d="M16 24c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-8c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-12C10.477 4 6 4.895 6 6v4c0 1.1 4.475 2 10 2s10-.9 10-2V6c0-1.105-4.477-2-10-2"/>
    </svg>
  )
  if (ext === 'graphql' || ext === 'gql') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#ec407a" d="M6 20h20v2H6z"/>
      <circle cx="7" cy="21" r="3" fill="#ec407a"/>
      <circle cx="16" cy="27" r="3" fill="#ec407a"/>
      <circle cx="25" cy="21" r="3" fill="#ec407a"/>
      <path fill="#ec407a" d="M6 10h20v2H6z"/>
      <circle cx="7" cy="11" r="3" fill="#ec407a"/>
      <circle cx="16" cy="5" r="3" fill="#ec407a"/>
      <circle cx="25" cy="11" r="3" fill="#ec407a"/>
      <path fill="#ec407a" d="M6 12h2v10H6zm18-2h2v12h-2z"/>
      <path fill="#ec407a" d="m5.014 19.41 11.674 6.866L15.674 28 4 21.134z"/>
      <path fill="#ec407a" d="M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382l11.415-7.29 1.077 1.686L6.2 12.068z"/>
      <path fill="#ec407a" d="m25.798 12.067-11.415-7.29 1.077-1.685 11.415 7.29zM6.2 19.932l11.416 7.29-1.077 1.686-11.415-7.29z"/>
      <path fill="#ec407a" d="m26.875 21.619-11.415 7.29-1.077-1.687 11.415-7.289zM5.877 22.6 16.04 3.686l1.762.946L7.638 23.546z"/>
      <path fill="#ec407a" d="M24.361 23.545 14.197 4.633l1.761-.947 10.165 18.913z"/>
    </svg>
  )
  if (ext === 'prisma') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#00bfa5" d="m27.777 22.617-.459-.946L18.43 3.26a2.25 2.25 0 0 0-1.914-1.256A2 2 0 0 0 16.379 2a2.23 2.23 0 0 0-1.891 1.042L4.348 19.056a2.2 2.2 0 0 0 .025 2.417l4.957 7.488A2.34 2.34 0 0 0 11.29 30a2.4 2.4 0 0 0 .655-.092l14.387-4.149a2.32 2.32 0 0 0 1.458-1.234 2.21 2.21 0 0 0-.013-1.908m-3.538.604-11.268 3.25 4.075-19.033 7.568 15.671-.376.098Z"/>
    </svg>
  )
  if (ext === 'svg') return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={s}>
      <path fill="#ffb300" d="M29.168 14.03a2.7 2.7 0 0 0-1.968-.83 2.51 2.51 0 0 0-1.929.8h-4.443l3.078-3.078a2.835 2.835 0 0 0 2.857-2.842 2.6 2.6 0 0 0-.831-1.969 2.82 2.82 0 0 0-2.014-.788 2.67 2.67 0 0 0-1.968.788 2.36 2.36 0 0 0-.812 1.922L18 11.17V6.726a2.51 2.51 0 0 0 .8-1.929 2.7 2.7 0 0 0-.832-1.968 2.745 2.745 0 0 0-3.936 0 2.7 2.7 0 0 0-.832 1.968 2.51 2.51 0 0 0 .8 1.93v4.443l-3.138-3.138a2.36 2.36 0 0 0-.812-1.922 2.66 2.66 0 0 0-1.968-.788 2.83 2.83 0 0 0-2.014.788 2.6 2.6 0 0 0-.831 1.969 2.74 2.74 0 0 0 .831 2.013 2.8 2.8 0 0 0 2.026.829l3.078 3.078H6.729a2.51 2.51 0 0 0-1.929-.8 2.7 2.7 0 0 0-1.968.831 2.745 2.745 0 0 0 0 3.937 2.7 2.7 0 0 0 1.968.832 2.51 2.51 0 0 0 1.929-.8h4.443l-3.078 3.077a2.835 2.835 0 0 0-2.857 2.842 2.6 2.6 0 0 0 .831 1.969 2.82 2.82 0 0 0 2.014.788 2.67 2.67 0 0 0 1.968-.788 2.36 2.36 0 0 0 .812-1.922L14 20.827v4.444a2.51 2.51 0 0 0-.8 1.929 2.784 2.784 0 0 0 4.768 1.968A2.7 2.7 0 0 0 18.8 27.2a2.51 2.51 0 0 0-.8-1.929v-4.444l3.138 3.138a2.36 2.36 0 0 0 .812 1.922 2.66 2.66 0 0 0 1.968.788 2.83 2.83 0 0 0 2.014-.788 2.6 2.6 0 0 0 .831-1.969 2.74 2.74 0 0 0-.831-2.013 2.8 2.8 0 0 0-2.026-.829L20.828 18h4.443a2.51 2.51 0 0 0 1.93.8 2.784 2.784 0 0 0 1.967-4.769Z"/>
    </svg>
  )
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={s}>
      <path fill="#26a69a" d="M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9"/>
    </svg>
  )
  if (ext === 'pdf') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#ef5350" d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z"/>
    </svg>
  )
  if (ext === 'xml') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#8bc34a" d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41zm11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41z"/>
    </svg>
  )
  if (ext === 'csv') return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s}>
      <path fill="#43a047" d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m1 8v2h2v-2zm0 3v2h2v-2zm0 3v2h2v-2zm3-6v2h2v-2zm0 3v2h2v-2zm0 3v2h2v-2zm3-6v2h2v-2zm0 3v2h2v-2zm0 3v2h2v-2z"/>
    </svg>
  )
  const meta = fileIconMeta(name)
  return badge(meta.label, meta.bg, meta.fg ?? '#ffffff')
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeLang(lang: string) {
  const l = (lang || '').toLowerCase().trim()
  if (l === 'typescript' || l === 'tsx') return 'typescript'
  if (l === 'javascript' || l === 'jsx' || l === 'js') return 'javascript'
  if (l === 'py') return 'python'
  if (l === 'sh' || l === 'shell' || l === 'zsh' || l === 'bash') return 'bash'
  if (l === 'scss' || l === 'sass') return 'scss'
  return l
}

function hljsHighlight(code: string, lang: string): string {
  const l = normalizeLang(lang)
  try {
    if (l && hljs.getLanguage(l)) {
      return hljs.highlight(code, { language: l, ignoreIllegals: true }).value
    }
  } catch {}
  return esc(code)
}

function normalizeMarkdownFences(text: string): string {
  return (text || '')
    .replace(/(^|\n)\s*<\/?[a-z][a-z0-9_-]*_docs\s*\/?>\s*(?=\n|$)/gi, '$1')
    .replace(/<CodeGroup[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/CodeGroup>/g, function (_match, inner: string) {
      return `\n${inner.replace(/^ {2}/gm, '').trim()}\n`
    })
    .replace(/(^|\n)(\s*)\\`\\`\\`/g, '$1$2```')
    .replace(
      /(^|\n)(\s*)```([A-Za-z0-9_-]+)([^\n`]*?\btheme=\{null\})(?:\s+([^\n]+))?/g,
      function (_match, prefix: string, indent: string, lang: string, _meta: string, rest?: string) {
        const code = rest?.trim()
        return `${prefix}${indent}\`\`\`${normalizeLang(lang)}${code ? `\n${indent}${code}` : ''}`
      }
    )
    .replace(
      /(^|\n)(\s*)```([A-Za-z0-9_-]+)\s+((?:from|import|async|def|class|if|for|while|const|let|var|function|return|#|\/\/)[^\n]*)/g,
      function (_match, prefix: string, indent: string, lang: string, code: string) {
        return `${prefix}${indent}\`\`\`${normalizeLang(lang)}\n${indent}${code.trim()}`
      }
    )
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

type FullDiffRow = {
  kind: 'context' | 'add' | 'del'
  text: string
  lineNo: string
}

type DiffPart = {
  kind: 'context' | 'add' | 'del'
  text: string
}

function parseDiffChanges(diff: string): Array<{ parts: DiffPart[] }> {
  const changes: Array<{ parts: DiffPart[] }> = []
  let current: { parts: DiffPart[] } | null = null
  const flush = () => {
    if (!current || !current.parts.some((part) => part.kind !== 'context')) return
    changes.push(current)
    current = null
  }
  for (const raw of diff.split(/\r?\n/u)) {
    if (!raw || raw.startsWith('@@') || raw.startsWith('***') || raw.startsWith('---') || raw.startsWith('+++')) {
      flush()
      continue
    }
    const added = raw.startsWith('+')
    const removed = raw.startsWith('-')
    const context = raw.startsWith('  ')
    if (!added && !removed && !context) {
      flush()
      continue
    }
    current ??= { parts: [] }
    const text = raw.startsWith('+ ') || raw.startsWith('- ') || raw.startsWith('  ') ? raw.slice(2) : raw.slice(1)
    current.parts.push({ kind: added ? 'add' : removed ? 'del' : 'context', text })
  }
  flush()
  return changes
}

function findLineSequence(lines: string[], sequence: string[], start: number): number {
  const meaningful = sequence.filter((line) => line.trim())
  if (!meaningful.length) return -1
  for (let index = start; index <= lines.length - sequence.length; index += 1) {
    let exact = true
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (lines[index + offset] !== sequence[offset]) {
        exact = false
        break
      }
    }
    if (exact) return index
  }
  for (let index = start; index <= lines.length - sequence.length; index += 1) {
    let loose = true
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (lines[index + offset].trim() !== sequence[offset].trim()) {
        loose = false
        break
      }
    }
    if (loose) return index
  }
  for (const needle of meaningful) {
    const exact = lines.findIndex((line, index) => index >= start && line === needle)
    if (exact !== -1) return exact
  }
  for (const needle of meaningful) {
    const trimmed = needle.trim()
    if (trimmed.length < 3) continue
    const loose = lines.findIndex((line, index) => index >= start && line.trim() === trimmed)
    if (loose !== -1) return loose
  }
  for (const needle of meaningful) {
    const compact = needle.trim()
    if (compact.length < 8) continue
    const contains = lines.findIndex((line, index) => index >= start && line.includes(compact))
    if (contains !== -1) return contains
  }
  return -1
}

function fullFileDiffRows(content: string, diff: string): FullDiffRow[] {
  const lines = content.split(/\r?\n/u)
  const states = lines.map(() => 'context' as FullDiffRow['kind'])
  const inserts = new Map<number, FullDiffRow[]>()
  let cursor = 0
  for (const change of parseDiffChanges(diff)) {
    const anchor = change.parts.filter((part) => part.kind !== 'del').map((part) => part.text)
    const index = findLineSequence(lines, anchor, cursor)
    if (index === -1) {
      const hasOnlyDeletions = change.parts.some((part) => part.kind === 'del') && !anchor.some((line) => line.trim())
      const fallback = hasOnlyDeletions ? lines.length : Math.min(Math.max(cursor, 0), lines.length)
      const rows = change.parts
        .filter((part) => part.kind !== 'context')
        .map((part) => ({ kind: part.kind === 'add' ? 'add' : 'del', text: part.text, lineNo: '' }) as FullDiffRow)
      if (rows.length) inserts.set(fallback, (inserts.get(fallback) ?? []).concat(rows))
      continue
    }
    let lineIndex = index
    for (const part of change.parts) {
      if (part.kind === 'del') {
        const row = { kind: 'del', text: part.text, lineNo: '' } as FullDiffRow
        inserts.set(lineIndex, (inserts.get(lineIndex) ?? []).concat(row))
        continue
      }
      if (part.kind === 'add') states[lineIndex] = 'add'
      lineIndex += 1
    }
    cursor = Math.max(lineIndex, index + 1)
  }
  const rows: FullDiffRow[] = []
  for (let index = 0; index < lines.length; index += 1) {
    rows.push(...(inserts.get(index) ?? []))
    rows.push({ kind: states[index], text: lines[index] || ' ', lineNo: String(index + 1) })
  }
  rows.push(...(inserts.get(lines.length) ?? []))
  return rows
}

function fullFileSnapshotDiffRows(oldContent: string, content: string): FullDiffRow[] {
  const oldLines = oldContent.split(/\r?\n/u)
  const newLines = content.split(/\r?\n/u)
  const dp = Array.from({ length: oldLines.length + 1 }, () => Array<number>(newLines.length + 1).fill(0))
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      dp[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? dp[oldIndex + 1][newIndex + 1] + 1
          : Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1])
    }
  }
  const rows: FullDiffRow[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      rows.push({ kind: 'context', text: newLines[newIndex] || ' ', lineNo: String(newIndex + 1) })
      oldIndex += 1
      newIndex += 1
    } else if (newIndex < newLines.length && (oldIndex >= oldLines.length || dp[oldIndex][newIndex + 1] >= dp[oldIndex + 1][newIndex])) {
      rows.push({ kind: 'add', text: newLines[newIndex] || ' ', lineNo: String(newIndex + 1) })
      newIndex += 1
    } else if (oldIndex < oldLines.length) {
      rows.push({ kind: 'del', text: oldLines[oldIndex] || ' ', lineNo: '' })
      oldIndex += 1
    }
  }
  return rows
}

function FileDiffPreview({ diff, fileName, content, oldContent }: { diff: string; fileName: string; content: string; oldContent?: string }) {
  const rows = oldContent ? fullFileSnapshotDiffRows(oldContent, content) : fullFileDiffRows(content, diff)
  const lang = codeFileLang(fileName)
  return (
    <pre className="y-file-diff-pre" aria-label="File with edited diff">
      {rows.map((row, index) => {
        const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '
        return (
          <span key={`${index}-${row.kind}-${row.text}`} className={`tool-diff-line${row.kind === 'add' ? ' tool-diff-add' : row.kind === 'del' ? ' tool-diff-del' : ''}`}>
            <span className="tool-diff-ln">{row.lineNo}</span>
            <span className="tool-diff-gutter">{marker}</span>
            <code dangerouslySetInnerHTML={{ __html: hljsHighlight(row.text || ' ', lang) }} />
          </span>
        )
      })}
    </pre>
  )
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const s = { width: size, height: size, display: 'block', flexShrink: 0 } as CSSProperties
  const sw = 1.5
  if (name === 'plus')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'search')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="5.5" stroke="currentColor" strokeWidth={sw} />
        <path d="M14.5 14.5L17 17" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'plugins')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3.5" y="3.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth={sw} />
        <rect x="11.5" y="3.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth={sw} />
        <rect x="3.5" y="11.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth={sw} />
        <path d="M12 14h4M14 12v4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'auto')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M5 6.5h4.2M10.8 6.5H15M5 13.5h4.2M10.8 13.5H15" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        <circle cx="10" cy="6.5" r="1.4" stroke="currentColor" strokeWidth={sw} />
        <circle cx="10" cy="13.5" r="1.4" stroke="currentColor" strokeWidth={sw} />
      </svg>
    )
  if (name === 'model')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 3v14M3 10h14M5.05 5.05l9.9 9.9M14.95 5.05l-9.9 9.9" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      </svg>
    )
  if (name === 'effort')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="2.5" y="13.5" width="3" height="4" rx="0.8" fill="currentColor" />
        <rect x="7" y="10" width="3" height="7.5" rx="0.8" fill="currentColor" />
        <rect x="11.5" y="6.5" width="3" height="11" rx="0.8" fill="currentColor" />
        <rect x="16" y="3" width="3" height="14.5" rx="0.8" fill="currentColor" />
      </svg>
    )
  if (name === 'settings')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth={sw} />
        <path
          d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4"
          stroke="currentColor"
          strokeWidth={sw}
          strokeLinecap="round"
        />
      </svg>
    )
  if (name === 'help')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth={sw} />
        <path d="M7.9 7.75a2.25 2.25 0 0 1 4.35.82c0 1.8-2.2 1.9-2.2 3.45" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 15h.01" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
      </svg>
    )
  if (name === 'menu')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="5" cy="10" r="1.2" fill="currentColor" />
        <circle cx="10" cy="10" r="1.2" fill="currentColor" />
        <circle cx="15" cy="10" r="1.2" fill="currentColor" />
      </svg>
    )
  if (name === 'brain')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M8.1 4.2A2.6 2.6 0 005.4 6.8v.3A2.8 2.8 0 004 9.5c0 1 .5 1.9 1.3 2.4v.5A2.6 2.6 0 008 15h.1M11.9 4.2a2.6 2.6 0 012.7 2.6v.3A2.8 2.8 0 0116 9.5c0 1-.5 1.9-1.3 2.4v.5A2.6 2.6 0 0112 15h-.1M10 3.8v12.4M7.1 8.1c.9 0 1.6.7 1.6 1.6M12.9 8.1c-.9 0-1.6.7-1.6 1.6M7.3 12.1c.8 0 1.4.6 1.4 1.4M12.7 12.1c-.8 0-1.4.6-1.4 1.4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (name === 'mic')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="7.5" y="3" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth={sw} />
        <path d="M5 10a5 5 0 0010 0M10 15v2.5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'panel')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="3" y="5" width="5" height="11" rx="1" stroke="currentColor" strokeWidth={sw} />
        <rect x="9" y="5" width="8" height="11" rx="1" stroke="currentColor" strokeWidth={sw} />
      </svg>
    )
  if (name === 'folder')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M3 6.5A1.5 1.5 0 014.5 5H8l1.5 1.5H15.5A1.5 1.5 0 0117 8v6.5A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5V6.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
      </svg>
    )
  if (name === 'archive')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M5 7h10M6 7v8a1.4 1.4 0 001.4 1.4h5.2A1.4 1.4 0 0014 15V7" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 4.4h6A1.4 1.4 0 0114.4 5.8V7H5.6V5.8A1.4 1.4 0 017 4.4zM8.3 10h3.4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
	  if (name === 'files')
	    return (
	      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
	        <path d="M6.5 3.5h5L15 7v8.5A1.5 1.5 0 0113.5 17h-7A1.5 1.5 0 015 15.5v-10A2 2 0 016.5 3.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
	        <path d="M11.5 3.8V7h3.2M8 10h4M8 13h4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
	      </svg>
	    )
	  if (name === 'terminal')
	    return (
	      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
	        <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth={sw} />
	        <path d="M6 8l2.2 2L6 12M10 12h4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
	      </svg>
	    )
  if (name === 'branch')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="6" cy="5.5" r="2" stroke="currentColor" strokeWidth={sw} />
        <circle cx="14" cy="14.5" r="2" stroke="currentColor" strokeWidth={sw} />
        <path d="M6 7.5v2.2a4.8 4.8 0 004.8 4.8H12" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        <path d="M6 7.5v7" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'send')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 16V6M10 6l-3.5 3.5M10 6l3.5 3.5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (name === 'stop')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="6" y="6" width="8" height="8" rx="1.2" fill="currentColor" />
      </svg>
    )
  if (name === 'check')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M4.5 10.5l3.4 3.4 7.6-8.1" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (name === 'x')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'undo')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M8 5L4 9l4 4M4.5 9H12a4 4 0 014 4v2" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (name === 'goal')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="6.2" stroke="currentColor" strokeWidth={sw} />
        <circle cx="10" cy="10" r="2.8" stroke="currentColor" strokeWidth={sw} />
        <circle cx="10" cy="10" r="0.9" fill="currentColor" />
        <path d="M10 3.8V2.5M16.2 10h1.3M10 16.2v1.3M3.8 10H2.5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'copy')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth={sw} />
        <path d="M13.5 6.5V5A1.5 1.5 0 0012 3.5H5A1.5 1.5 0 003.5 5v7A1.5 1.5 0 005 13.5h1.5" stroke="currentColor" strokeWidth={sw} />
      </svg>
    )
  if (name === 'chevron')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (name === 'more')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="5" cy="10" r="1.2" fill="currentColor" />
        <circle cx="10" cy="10" r="1.2" fill="currentColor" />
        <circle cx="15" cy="10" r="1.2" fill="currentColor" />
      </svg>
    )
  if (name === 'edit')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M12.5 3.5l4 4L8 16H4v-4l8.5-8.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
        <path d="M11 5l4 4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  return null
}

function effortBarCount(effort: string, maxBars: number): number {
  const index = EFFORTS.indexOf(effort)
  return Math.min(maxBars, index === -1 ? 2 : index + 1)
}

function EffortBars({ effort, maxBars = 5, size = 15 }: { effort: string; maxBars?: number; size?: number }) {
  const bars = Array.from({ length: Math.max(1, maxBars) }, function (_, index) { return index })
  const active = effortBarCount(effort, bars.length)
  const s = { width: size, height: size, display: 'block', flexShrink: 0 } as CSSProperties
  const barWidth = bars.length === 4 ? 2.5 : 2.25
  const gap = bars.length === 4 ? 4.05 : 3.45
  const startX = bars.length === 4 ? 3 : 2.4
  return (
    <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
      {bars.map(function (index) {
        const height = bars.length === 4 ? 4.5 + index * 3.1 : 4 + index * 2.6
        const y = 17 - height
        return (
          <rect
            key={index}
            x={startX + index * gap}
            y={y}
            width={barWidth}
            height={height}
            rx="0.8"
            fill="currentColor"
            opacity={index < active ? 1 : 0.28}
          />
        )
      })}
    </svg>
  )
}

function EngineMark({ id, logoUrl, size = 18 }: { id: string; logoUrl?: string; size?: number }) {
  const s: CSSProperties = {
    width: size,
    height: size,
    display: 'block',
    flexShrink: 0,
    objectFit: 'contain',
    borderRadius: 4
  }
  if (logoUrl) {
    return <img src={logoUrl} alt="" aria-hidden style={s} draggable={false} />
  }
  if (id === 'claude-code')
    return (
      <svg aria-hidden style={{ ...s, color: '#D97757' }} viewBox="0 0 24 24" fill="none">
        <path d="M12 2l2.4 6.4H21l-5.4 3.9 2.1 6.4L12 14.8l-5.7 3.9 2.1-6.4L3 8.4h6.6L12 2z" fill="currentColor" opacity="0.9" />
      </svg>
    )
  return (
    <span
      aria-hidden
      style={{
        ...s,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(8, size * 0.45),
        fontWeight: 700,
        color: '#10a37f',
        background: 'rgba(255,255,255,0.06)'
      }}
    >
      O
    </span>
  )
}

function engineLogoFor(engineId: string, catalog: EngineModelCatalog[]): string | undefined {
  return catalog.find((item) => item.engine === engineId)?.logoUrl
}

function YDropdown<T extends string>({
  value,
  options,
  disabled,
  title,
  renderLabel,
  renderItem,
  onChange
}: {
  value: T
  options: Array<{ id: T; label: string }>
  disabled?: boolean
  title?: string
  renderLabel?: (id: T, label: string) => React.ReactNode
  renderItem?: (id: T, label: string, active: boolean) => React.ReactNode
  onChange: (id: T) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const current = options.find(function (o) { return o.id === value })

  useEffect(function () {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return function () { document.removeEventListener('mousedown', onDoc) }
  }, [open])

  return (
    <div ref={ref} className={'y-drop' + (open ? ' is-open' : '')}>
      <button
        type="button"
        className="y-drop-btn"
        disabled={disabled}
        title={title}
        aria-label={title}
        onClick={function () { setOpen(function (o) { return !o }) }}
      >
        {renderLabel
          ? renderLabel(value, current?.label ?? value)
          : <span className="y-drop-label">{current?.label ?? value}</span>}
        <Icon name="chevron" size={10} />
      </button>
      {open ? (
        <div className="y-drop-menu">
          {options.map(function (opt) {
            const active = opt.id === value
            return (
              <button
                key={opt.id}
                type="button"
                className={'y-drop-item' + (active ? ' active' : '')}
                onClick={function () { onChange(opt.id); setOpen(false) }}
              >
                {renderItem ? renderItem(opt.id, opt.label, active) : opt.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function MarkdownCode({ className, children }: { className?: string; children?: React.ReactNode }) {
  const code = String(children ?? '').replace(/\n$/, '')
  const language = className?.match(/language-([^\s]+)/)?.[1] ?? ''
  const block = Boolean(language || code.includes('\n'))
  if (!block) return <code>{children}</code>
  return <code className={className} dangerouslySetInnerHTML={{ __html: hljsHighlight(code, language) || '&nbsp;' }} />
}

function langFromToolTarget(target?: string): string {
  const targetFile = toolTargetFile(target)
  return targetFile ? codeFileLang(targetFile) : 'typescript'
}

function SettingsToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" className={'y-settings-toggle' + (checked ? ' is-on' : '')} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

function SettingsView({
  accountUser,
  accountBusy,
  accountChecking,
  soundEnabled,
  onSoundEnabled,
  engines,
  catalog,
  cliStatus,
  onAccountSignIn,
  onAccountSignOut,
  onResetOriginalApp,
  onOpenPlugins,
  onOpenMcp,
  onAuthStatus,
  onDoctor
}: {
  accountUser: KernelAuthUser | null
  accountBusy: boolean
  accountChecking: boolean
  soundEnabled: boolean
  onSoundEnabled: (enabled: boolean) => void
  engines: string[]
  catalog: EngineModelCatalog[]
  cliStatus: OnboardingCliCheckResult | null
  onAccountSignIn: () => void
  onAccountSignOut: () => void
  onResetOriginalApp: () => void
  onOpenPlugins: (engineId: string) => void
  onOpenMcp: (engineId: string) => void
  onAuthStatus: (engineId: string) => void
  onDoctor: (engineId: string) => void
}) {
  const accountName = accountUser?.displayName || accountUser?.email || 'Signed in'
  const accountInitial = (accountUser?.displayName || accountUser?.email || 'y').trim().slice(0, 1).toUpperCase()
  const signedOutLabel = accountChecking ? 'Checking account...' : 'Not signed in'
  const signedOutHelp = accountChecking ? 'Checking your local y session.' : 'Sign in to sync identity, feedback, and product analytics.'
  const connectedAccounts = accountUser?.connectedAccounts || []
  return (
    <div className="y-settings-view" data-testid="settings-view">
      <div className="y-settings-content">
        <section className="y-settings-section">
          <h2>Account</h2>
          <div className="y-settings-card y-account-card">
            <div className="y-account-main">
              <div className="y-account-avatar" aria-hidden="true">
                {accountUser?.profileImageUrl ? <img src={accountUser.profileImageUrl} alt="" /> : <span>{accountInitial}</span>}
              </div>
              <div>
                <strong>{accountUser ? accountName : signedOutLabel}</strong>
                <p>{accountUser?.email || (accountUser ? 'y account' : signedOutHelp)}</p>
              </div>
            </div>
            {accountUser ? (
              <button type="button" className="y-settings-action" onClick={onAccountSignOut} disabled={accountBusy}>Sign out</button>
            ) : (
              <button type="button" className="y-settings-action" onClick={onAccountSignIn} disabled={accountBusy || accountChecking}>{accountChecking ? 'Checking...' : accountBusy ? 'Opening...' : 'Sign in'}</button>
            )}
          </div>
          {accountUser ? (
            <div className="y-settings-card y-connected-card">
              <div>
                <strong>Connected profiles</strong>
                <p>{connectedAccounts.length ? 'Accounts Hexclave has linked to this y user.' : 'No connected OAuth profiles returned yet.'}</p>
              </div>
              {connectedAccounts.length ? (
                <div className="y-connected-list">
                  {connectedAccounts.map((account) => {
                    const profile = account.profile
                    const provider = account.provider || 'unknown'
                    const label = provider === 'github' ? 'GitHub' : provider === 'google' ? 'Google' : provider
                    const name =
                      profile?.username ||
                      profile?.displayName ||
                      (provider === 'google' ? accountUser.email || 'Connected' : 'Connected')
                    const detail =
                      profile?.profileUrl ||
                      (provider === 'google' ? 'Google sign-in connected' : `Provider account ${account.providerAccountId}`)
                    return (
                      <div className="y-connected-item" key={`${provider}:${account.providerAccountId}`}>
                        <div className="y-connected-avatar" aria-hidden="true">
                          {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : <span>{label.slice(0, 1).toUpperCase()}</span>}
                        </div>
                        <div>
                          <strong>{label}</strong>
                          <p>{name}</p>
                          <span>{detail}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        <section className="y-settings-section"><h2>General</h2><div className="y-settings-card"><div><strong>Completion sound</strong><p>Play a subtle sound when a long-running agent turn finishes.</p></div><SettingsToggle checked={soundEnabled} onChange={onSoundEnabled} /></div></section>
        <section className="y-settings-section"><h2>Agents</h2><p className="y-settings-lead">y auto-detects each local CLI's install and sign-in state on the system.</p><div className="y-agent-grid">{engines.map((engine) => { const entry = catalog.find((item) => item.engine === engine); const label = entry?.label || LABELS[engine] || engine; const tool = cliStatus?.tools.find((t) => t.id === engine); const statusText = !tool ? 'Detecting...' : !tool.installed ? 'Not installed' : tool.authenticated ? 'Signed in' : 'Installed, not signed in'; return <div className="y-agent-card" key={engine}><div className="y-agent-title"><EngineMark id={engine} logoUrl={entry?.logoUrl} size={18} /><strong>{label}</strong></div><span>{statusText}</span><div className="y-settings-actions"><button type="button" className="y-settings-action" onClick={() => onAuthStatus(engine)}>Auth status</button><button type="button" className="y-settings-action" onClick={() => onDoctor(engine)}>Doctor</button></div></div> })}</div></section>
        <section className="y-settings-section"><h2>MCP & Plugins</h2><p className="y-settings-lead">Open each engine's native plugin and MCP views. y displays the real CLI output in the terminal.</p><div className="y-agent-grid">{engines.map((engine) => { const entry = catalog.find((item) => item.engine === engine); const label = entry?.label || LABELS[engine] || engine; return <div className="y-agent-card" key={engine}><div className="y-agent-title"><EngineMark id={engine} logoUrl={entry?.logoUrl} size={18} /><strong>{label}</strong></div><p>Inspect native integrations for this engine.</p><div className="y-settings-actions"><button type="button" className="y-settings-action" onClick={() => onOpenPlugins(engine)}>Plugins</button><button type="button" className="y-settings-action" onClick={() => onOpenMcp(engine)}>MCP</button></div></div> })}</div></section>
        <section className="y-settings-section"><h2>Modify Chat</h2><div className="y-settings-card"><div><strong>Reset to original app</strong><p>Restore the bundled y chat interface and replace the current customized app UI.</p></div><button type="button" className="y-settings-action danger" onClick={onResetOriginalApp}>Reset</button></div></section>
      </div>
    </div>
  )
}

function OnboardingView({
  catalog,
  onFinish
}: {
  catalog: EngineModelCatalog[]
  onFinish: () => void
}) {
  const [cliResult, setCliResult] = useState<OnboardingCliCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    trackEvent('onboarding_viewed')
    void runCliCheck()
  }, [])

  async function runCliCheck(): Promise<void> {
    setChecking(true)
    try {
      const result = await window.y.engine.checkCliStatus()
      setCliResult(result)
    } finally {
      setChecking(false)
    }
  }

  async function copyCommand(command: string, label: string): Promise<void> {
    if (window.y?.clipboard?.writeText) {
      const result = await window.y.clipboard.writeText(command)
      if (!result.ok) throw new Error(result.error || 'Could not copy command')
    } else {
      await navigator.clipboard.writeText(command)
    }
    setCopied(label)
    window.setTimeout(() => setCopied(''), 1400)
    trackEvent('onboarding_install_command_copied', { label })
  }

  function complete(): void {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, 'true')
    window.localStorage.setItem(ONBOARDING_CLI_DONE_KEY, 'true')
    trackEvent('onboarding_completed', { cliChecked: Boolean(cliResult) })
    onFinish()
  }

  const allReady = Boolean(cliResult?.tools.length) && cliResult!.tools.every((tool) => tool.authenticated)

  return (
    <div className="y-onboarding" data-testid="onboarding">
      <div className="y-onboarding-card">
        <div className="y-onboarding-brand">
          <BinaryYMark />
          <div>
            <p className="y-onboarding-kicker">Welcome to y</p>
            <h1>Set up your coding agents.</h1>
            <p>y detects whether Claude Code and Codex are installed and signed in automatically.</p>
          </div>
        </div>

        <section className="y-onboarding-panel">
          <div className="y-onboarding-row">
            <div>
              <h2>Agent CLIs</h2>
              <p className="y-onboarding-muted">y runs the official local CLIs and checks their install and sign-in state on your system.</p>
            </div>
            <button type="button" className="y-onboarding-primary" onClick={() => void runCliCheck()} disabled={checking}>
              {checking ? 'Checking...' : 'Check again'}
            </button>
          </div>
          <div className="y-cli-grid">
            {(cliResult?.tools ?? [
              {
                id: 'claude-code',
                label: 'Claude Code',
                command: 'claude',
                installed: false,
                authenticated: false,
                installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
                authCommand: 'claude auth login',
                docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/quickstart'
              },
              {
                id: 'codex',
                label: 'Codex',
                command: 'codex',
                installed: false,
                authenticated: false,
                installCommand: 'npm install -g @openai/codex',
                authCommand: 'codex login',
                docsUrl: 'https://github.com/openai/codex'
              }
            ] as OnboardingCliToolStatus[]).map((tool) => (
              <div key={tool.id} className={'y-cli-card' + (tool.installed ? ' installed' : '') + (tool.authenticated ? ' ready' : '')}>
                <div className="y-cli-head">
                  <EngineMark id={tool.id} logoUrl={engineLogoFor(tool.id, catalog)} size={22} />
                  <div>
                    <strong>{tool.label}</strong>
                    <span>{!tool.installed ? (checking ? 'Detecting...' : 'Not installed') : tool.authenticated ? 'Signed in' : 'Installed, not signed in'}</span>
                  </div>
                  {tool.authenticated ? (
                    <div className="y-cli-tick" aria-label="Signed in">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 13 9 18 20 6" /></svg>
                    </div>
                  ) : null}
                </div>
                {!tool.authenticated ? (
                  <>
                    <p className="y-cli-hint">Copy this, then paste it into your Mac's Terminal app and press Enter.</p>
                    <code>{!tool.installed ? tool.installCommand : tool.authCommand}</code>
                    <button type="button" className="y-onboarding-secondary" onClick={() => void copyCommand(!tool.installed ? tool.installCommand : tool.authCommand, tool.label)}>
                      {copied === tool.label ? 'Copied' : !tool.installed ? 'Copy install' : 'Copy login'}
                    </button>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <div className="y-onboarding-footer">
          {allReady ? <p className="y-onboarding-ready-note">You're all set.</p> : <span />}
          <div className="y-onboarding-footer-end">
            <button type="button" className="y-onboarding-primary" onClick={complete}>Start using y</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Chat() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [accountUser, setAccountUser] = useState<KernelAuthUser | null>(null)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountChecking, setAccountChecking] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(
    () =>
      window.localStorage.getItem(ONBOARDING_DONE_KEY) === 'true' &&
      window.localStorage.getItem(ONBOARDING_CLI_DONE_KEY) === 'true'
  )
  const [cliStatus, setCliStatus] = useState<OnboardingCliCheckResult | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(() => storedBoolean('y.settings.sound', true))
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState('')
  const [isolationChoice, setIsolationChoice] = useState<{ projectId: string; projectName: string } | null>(null)
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null)
  const [expandedChatProjects, setExpandedChatProjects] = useState<Record<string, boolean>>({})
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined)
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined)
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string | undefined>(undefined)
  const [appReady, setAppReady] = useState(PREVIEW)
  const [engines, setEngines] = useState<string[]>(PREVIEW ? ['claude-code', 'codex'] : [])
  const [catalog, setCatalog] = useState<EngineModelCatalog[]>(PREVIEW ? PREVIEW_CATALOG : [])
  const [engineId, setEngineId] = useState('claude-code')
  const [modelId, setModelId] = useState('claude-sonnet-4-6#effort=medium')
  const [runOptions, setRunOptions] = useState<EngineRunOptions>(defaultRunOptions)
  const [sessionId, setSessionId] = useState<string | null>(PREVIEW ? 'preview' : null)
  const [title, setTitle] = useState('New chat')
  const [goal, setGoal] = useState('')
  const [composerMode, setComposerMode] = useState<'chat' | 'goal'>('chat')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [hasComposerInput, setHasComposerInput] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [attachments, setAttachments] = useState<SelectedFile[]>([])
  const [pastedAttachments, setPastedAttachments] = useState<PastedTextAttachment[]>([])
  const [projectDirectories, setProjectDirectories] = useState<Record<string, ProjectDirectoryEntry[]>>({})
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set())
  const [fileSearchResults, setFileSearchResults] = useState<SelectedFile[]>([])
  const [fileRailOpen, setFileRailOpen] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [activeFile, setActiveFile] = useState<SelectedFile | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [savedFileContent, setSavedFileContent] = useState('')
  const [fileMode, setFileMode] = useState<FileMode>('preview')
  const [activeFileDiff, setActiveFileDiff] = useState('')
  const [activeFileOldContent, setActiveFileOldContent] = useState('')
  const [fileStatus, setFileStatus] = useState('')
  const [engineCommands, setEngineCommands] = useState<Array<{ name: string; source?: string }>>([])
  const [composerTerminal, setComposerTerminal] = useState<ComposerTerminal | null>(null)
  const [terminalDockOpen, setTerminalDockOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(252)
  const [fileRailWidth, setFileRailWidth] = useState(() => window.innerWidth <= 980 ? 286 : 326)
  const [terminalHeight, setTerminalHeight] = useState(() => Math.min(380, Math.floor(window.innerHeight * 0.42)))
  const [queuedFollowUps, setQueuedFollowUps] = useState<Record<string, QueuedFollowUp[]>>({})
  const [editingMessage, setEditingMessage] = useState<{ chatId: string; index: number; text: string } | null>(null)
  const [renamingChat, setRenamingChat] = useState<{ projectId: string; chatId: string; title: string } | null>(null)
  const [_runtimeTick, setRuntimeTick] = useState(0)
  const [elapsedTick, setElapsedTick] = useState(() => Date.now())
  const [doneChats, setDoneChats] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [modifyOpen, setModifyOpen] = useState(false)
  const sidRef = useRef<string | null>(PREVIEW ? 'preview' : null)
  const activeRef = useRef<{ projectId?: string; chatId?: string; path?: string }>({})
  const projectsRef = useRef<Project[]>([])
  const projectDirectoriesRef = useRef<Record<string, ProjectDirectoryEntry[]>>({})
  const loadingFoldersRef = useRef<Set<string>>(new Set())
  const pendingFolderRefreshRef = useRef<Set<string>>(new Set())
  const messagesRef = useRef<Msg[]>([])
  const queuedFollowUpsRef = useRef<Record<string, QueuedFollowUp[]>>({})
  const deliveringSteerRef = useRef<Set<string>>(new Set())
  const streamBuffersRef = useRef<Record<string, StreamBuffer>>({})
  const streamFramesRef = useRef<Record<string, number>>({})
  const thinkingBuffersRef = useRef<Record<string, string>>({})
  const thinkingFramesRef = useRef<Record<string, number>>({})
  const seenToolEventsRef = useRef<Record<string, true>>({})
  const runtimesRef = useRef<Record<string, ChatRuntime>>({})
  const sessionToChatRef = useRef<Record<string, string>>({})
  const audioRef = useRef<CompletionAudioContext | null>(null)
  const soundEnabledRef = useRef(soundEnabled)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipPersistRef = useRef(true)
  const logRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const animatedFinalScrollRef = useRef(false)
  const finalScrollFrameRef = useRef<number | null>(null)
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null)
  const inputValueRef = useRef('')
  const inputQueryRef = useRef('')
  const hasComposerInputRef = useRef(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const searchBoxRef = useRef<HTMLDivElement | null>(null)
  soundEnabledRef.current = soundEnabled

  useEffect(() => {
    if (!busy) return
    setElapsedTick(Date.now())
    const id = window.setInterval(() => setElapsedTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy, activeChatId])

  useEffect(() => {
    if (PREVIEW) return
    void window.y.engine.checkCliStatus().then(setCliStatus)
  }, [])

  useEffect(() => {
    if (PREVIEW || !settingsOpen) return
    let cancelled = false
    async function refreshAccount(): Promise<void> {
      setAccountChecking(true)
      try {
        const restored = await window.y.auth.load()
        if (cancelled) return
        if (restored.ok && restored.session) setAccountUser(restored.session.user)
        else setAccountUser(null)
      } finally {
        if (!cancelled) setAccountChecking(false)
      }
    }
    void refreshAccount()
    return () => {
      cancelled = true
    }
  }, [settingsOpen])

  useEffect(() => {
    if (engineId === 'codex' || composerMode !== 'goal') return
    setComposerMode('chat')
    setComposerInput('')
  }, [engineId, composerMode])

  useEffect(() => window.localStorage.setItem('y.settings.sound', String(soundEnabled)), [soundEnabled])

  function beginHorizontalResize(
    event: ReactPointerEvent<HTMLDivElement>,
    startWidth: number,
    direction: 1 | -1,
    min: number,
    max: number,
    update: (width: number) => void,
    collapse?: () => void
  ) {
    event.preventDefault()
    const startX = event.clientX
    const dynamicMax = Math.min(max, Math.floor(window.innerWidth * 0.46))
    let shouldCollapse = false
    document.documentElement.classList.add('y-is-resizing-x')
    const move = (moveEvent: PointerEvent) => {
      const rawWidth = startWidth + (moveEvent.clientX - startX) * direction
      shouldCollapse = Boolean(collapse && rawWidth < min - 56)
      update(clampPanelSize(rawWidth, min, dynamicMax))
    }
    const stop = () => {
      document.documentElement.classList.remove('y-is-resizing-x')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      if (shouldCollapse && collapse) window.requestAnimationFrame(collapse)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function beginTerminalResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = terminalHeight
    const max = Math.min(560, Math.floor(window.innerHeight * 0.62))
    let shouldCollapse = false
    document.documentElement.classList.add('y-is-resizing-y')
    const move = (moveEvent: PointerEvent) => {
      const rawHeight = startHeight - (moveEvent.clientY - startY)
      shouldCollapse = rawHeight < 124
      setTerminalHeight(clampPanelSize(rawHeight, 180, max))
    }
    const stop = () => {
      document.documentElement.classList.remove('y-is-resizing-y')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      if (shouldCollapse) window.requestAnimationFrame(() => setTerminalDockOpen(false))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function composerValue(): string {
    return composerInputRef.current?.value ?? inputValueRef.current
  }

  function resizeComposerInput(element = composerInputRef.current) {
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
  }

  function setComposerInput(value: string) {
    inputValueRef.current = value
    if (composerInputRef.current && composerInputRef.current.value !== value) composerInputRef.current.value = value
    resizeComposerInput()
    const hasValue = Boolean(value.trim())
    hasComposerInputRef.current = hasValue
    setHasComposerInput(hasValue)
    const tracksSuggestions = /^\//.test(value) || /(^|\s)@([^\s@]*)$/.test(value)
    const next = tracksSuggestions ? value : ''
    inputQueryRef.current = next
    setInput(next)
  }

  function handleComposerInput(value: string) {
    inputValueRef.current = value
    resizeComposerInput()
    const hasValue = Boolean(value.trim())
    if (hasComposerInputRef.current !== hasValue) {
      hasComposerInputRef.current = hasValue
      setHasComposerInput(hasValue)
    }
    const tracksSuggestions = /^\//.test(value) || /(^|\s)@([^\s@]*)$/.test(value)
    const next = tracksSuggestions ? value : ''
    if (inputQueryRef.current !== next) {
      inputQueryRef.current = next
      setInput(next)
    }
  }

  function shouldAttachPastedText(text: string): boolean {
    if (!text.trim()) return false
    return text.length >= PASTE_ATTACHMENT_MIN_CHARS || text.split(/\r\n|\r|\n/).length >= PASTE_ATTACHMENT_MIN_LINES
  }

  function addPastedTextAttachment(text: string): boolean {
    const size = new Blob([text]).size
    const totalSize = pastedAttachments.reduce(function (sum, item) { return sum + item.size }, 0)
    if (pastedAttachments.length >= MAX_PASTED_ATTACHMENTS) {
      showToast(`You can attach up to ${MAX_PASTED_ATTACHMENTS} pasted text blocks.`)
      return false
    }
    if (size > MAX_PASTED_ATTACHMENT_BYTES) {
      showToast('That pasted text is too large to attach.')
      return false
    }
    if (totalSize + size > MAX_TOTAL_PASTED_ATTACHMENT_BYTES) {
      showToast('Pasted text attachments are already near the context limit.')
      return false
    }
    setPastedAttachments((items) => {
      const index = items.length + 1
      return items.concat([{ id: `paste-${Date.now()}-${index}`, name: `pasted-text-${index}.txt`, text, size }])
    })
    return true
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData('text/plain')
    if (!shouldAttachPastedText(text)) return
    event.preventDefault()
    addPastedTextAttachment(text)
  }

	  const slashMatch = input.match(/^\/([^\s]*)$/)
	  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null
	  const mentionMatch = input.match(/(^|\s)@([^\s@]*)$/)
	  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null
	  const slashSuggestions =
	    slashQuery === null
	      ? []
	      : mergeCommandSuggestions(builtInCommandsForEngine(engineId), [])
	          .filter((item) => item.name.toLowerCase().slice(1).includes(slashQuery))
	          .slice(0, 40)
  const fileSuggestions =
    mentionQuery === null
      ? []
      : fileSearchResults

  useEffect(() => {
    if (mentionQuery === null || !activeProjectId) {
      setFileSearchResults([])
      return
    }
    let disposed = false
    const timer = setTimeout(() => {
      void window.y.app.searchFiles(activeProjectId, mentionQuery, activeWorkspacePath).then(function (res) {
        if (!disposed && res.ok) setFileSearchResults(res.files)
      })
    }, 100)
    return function () {
      disposed = true
      clearTimeout(timer)
    }
  }, [mentionQuery, activeProjectId, activeWorkspacePath])

  function chatEngine(chat?: AppChat): string {
    return chat?.engineId || 'claude-code'
  }

  function chatModel(chat?: AppChat, engine = chatEngine(chat)): string {
    return chat?.modelId || catalog.find(function (c) { return c.engine === engine })?.defaultModel || 'claude-sonnet-4-6#effort=medium'
  }

  function chatOptions(chat?: AppChat): EngineRunOptions {
    return chat?.runOptions || defaultRunOptions()
  }

  function chatWorkspacePath(project: Project | undefined, chat: AppChat | undefined): string | undefined {
    return chat?.runOptions?.workingDirectory?.trim() || project?.path
  }

  function isIsolatedChat(chat: AppChat, project: Project): boolean {
    const cwd = chat.runOptions?.workingDirectory?.trim()
    if (!cwd) return false
    return cwd.replace(/\/+$/u, '') !== project.path.replace(/\/+$/u, '')
  }

  function mergeCommandSuggestions(
    base: Array<{ name: string; source?: string; detail?: string }>,
    discovered: Array<{ name: string; source?: string }>
  ): Array<{ name: string; source?: string; detail?: string }> {
    const seen = new Set<string>()
    const out: Array<{ name: string; source?: string; detail?: string }> = []
    for (const item of base.concat(discovered)) {
      const name = item.name.startsWith('/') ? item.name : `/${item.name}`
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...item, name })
    }
    return out
  }

  function setRuntime(chatId: string | undefined, patch: ChatRuntime) {
    if (!chatId) return
    const current = runtimesRef.current[chatId] || {}
    const changed = Object.entries(patch).some(([key, value]) => current[key as keyof ChatRuntime] !== value)
    if (!changed) return
    const next = { ...current, ...patch }
    runtimesRef.current[chatId] = next
    setRuntimeTick((n) => n + 1)
    if (activeRef.current.chatId === chatId) {
      setSessionId(next.sessionId ?? null)
      sidRef.current = next.sessionId ?? null
      setBusy(Boolean(next.busy))
      setStatus(next.status || '')
      setError(next.error || '')
    }
  }

  function armCompletionSound() {
    if (PREVIEW || !soundEnabledRef.current) return
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    if (!audioRef.current) audioRef.current = new AudioCtor()
    void audioRef.current.resume?.()
  }

  function playCompletionSound() {
    if (PREVIEW || !soundEnabledRef.current) return
    try {
      const ctx = audioRef.current
      if (!ctx) return
      const now = ctx.currentTime
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34)
      gain.connect(ctx.destination)

      const first = ctx.createOscillator()
      first.type = 'triangle'
      first.frequency.setValueAtTime(523.25, now)
      first.connect(gain)
      first.start(now)
      first.stop(now + 0.26)

      const second = ctx.createOscillator()
      second.type = 'sine'
      second.frequency.setValueAtTime(659.25, now + 0.055)
      second.connect(gain)
      second.start(now + 0.055)
      second.stop(now + 0.3)
    } catch {
      // Sound is best-effort; never block chat completion on browser audio policy.
    }
  }

  function shouldPlayCompletionSound(chatId: string, runtime: ChatRuntime | undefined): boolean {
    if (PREVIEW || !runtime?.busy) return false
    if (activeRef.current.chatId !== chatId) return true
    if (!document.hasFocus()) return true
    return typeof runtime.startedAt === 'number' && Date.now() - runtime.startedAt >= LONG_TASK_NOTIFY_MS
  }

  function markChatDone(chatId: string) {
    if (activeRef.current.chatId === chatId) return
    setDoneChats((prev) => prev[chatId] ? prev : { ...prev, [chatId]: true })
  }

  function applyActiveChat(project: Project | undefined, chat: AppChat | undefined) {
    const nextEngine = chatEngine(chat)
    const nextModel = chatModel(chat, nextEngine)
    const runtime = chat?.id ? runtimesRef.current[chat.id] : undefined
    const fallbackSessionId = PREVIEW && chat?.id ? 'preview' : undefined
    const workspacePath = chatWorkspacePath(project, chat)
    setActiveProjectId(project?.id)
    setActiveChatId(chat?.id)
    setActiveWorkspacePath(workspacePath)
    activeRef.current = { projectId: project?.id, chatId: chat?.id, path: workspacePath }
    sidRef.current = runtime?.sessionId ?? fallbackSessionId ?? null
    setSessionId(runtime?.sessionId ?? fallbackSessionId ?? null)
    setEngineId(nextEngine)
    setModelId(nextModel)
    setRunOptions(chatOptions(chat))
    setGoal(chat?.goal ?? '')
    setTitle(chat?.title ?? 'New chat')
    setMessages(chat?.messages ?? [])
    messagesRef.current = chat?.messages ?? []
    setBusy(Boolean(runtime?.busy))
    setStatus(runtime?.status || '')
    setError(runtime?.error || '')
    setAttachments([])
    if (chat?.id) setDoneChats((prev) => {
      if (!prev[chat.id]) return prev
      const next = { ...prev }
      delete next[chat.id]
      return next
    })
  }

  function persistChatMeta(chatId: string | undefined, patch: Partial<AppChat>) {
    if (!chatId) return
    setProjects((list) =>
      {
        const next = list.map((p) => ({
        ...p,
        chats: p.chats.map((c) => (c.id === chatId ? { ...c, ...patch } : c))
        }))
        projectsRef.current = next
        return next
      }
    )
    if (!PREVIEW && activeRef.current.projectId) {
      void window.y.app.updateChat(activeRef.current.projectId, chatId, patch)
    }
  }

  function patchChatMeta(projectId: string, chatId: string, patch: Partial<AppChat>) {
    setProjects((list) => {
      const next = list.map((p) => ({
        ...p,
        chats: p.chats.map((c) => (c.id === chatId ? { ...c, ...patch } : c))
      }))
      projectsRef.current = next
      return next
    })
    if (activeRef.current.chatId === chatId) {
      if (typeof patch.title === 'string') setTitle(patch.title)
    }
    void window.y.app.updateChat(projectId, chatId, patch)
  }

  function updateChatMessages(chatId: string, updater: (list: Msg[]) => Msg[]) {
    const currentMessages = activeRef.current.chatId === chatId
      ? messagesRef.current
      : getChatById(chatId).chat?.messages ?? []
    const nextMessages = updater(currentMessages)
    if (nextMessages === currentMessages) return
    setProjects((list) => {
        const next = list.map((p) => ({
        ...p,
        chats: p.chats.map((c) => (c.id === chatId ? { ...c, messages: nextMessages } : c))
        }))
        projectsRef.current = next
        return next
      })
    if (activeRef.current.chatId === chatId) {
      messagesRef.current = nextMessages
      setMessages(nextMessages)
      requestLogScrollToBottom(chatId)
    }
  }

  function replaceChatMessages(chatId: string, nextMessages: Msg[]) {
    setProjects((list) => {
      const next = list.map((p) => ({
        ...p,
        chats: p.chats.map((c) => (c.id === chatId ? { ...c, messages: nextMessages } : c))
      }))
      projectsRef.current = next
      return next
    })
    if (activeRef.current.chatId === chatId) {
      messagesRef.current = nextMessages
      setMessages(nextMessages)
      requestLogScrollToBottom(chatId)
    }
  }

  function applyState(state: AppState) {
    const project = findActiveProject(state.projects, state.activeProjectId)
    const chat = findActiveChat(project, state.activeChatId)
    setProjects(state.projects)
    projectsRef.current = state.projects
    applyActiveChat(project, chat)
    skipPersistRef.current = true
    setAppReady(true)
  }

	  async function start(
	    id: string,
	    model?: string,
	    options = runOptions,
	    projectPath = activeRef.current.path,
	    chatId = activeRef.current.chatId
	  ): Promise<string | null> {
	    const resolved =
	      model ?? catalog.find(function (c) { return c.engine === id })?.defaultModel ?? modelId
	    const nextOptions = options.workingDirectory?.trim()
	      ? options
	      : projectPath
	        ? { ...options, workingDirectory: projectPath }
	        : options
	    setEngineCommands([])
	    persistChatMeta(chatId, { engineId: id, modelId: resolved, runOptions: nextOptions })
    if (PREVIEW) {
      setEngineId(id)
      setModelId(resolved)
      setRunOptions(nextOptions)
      setSessionId('preview')
      sidRef.current = 'preview'
      if (chatId) {
        sessionToChatRef.current.preview = chatId
        setRuntime(chatId, { sessionId: 'preview', engineId: id, busy: false, status: '', error: '' })
      }
      return 'preview'
    }
    const existing = chatId ? runtimesRef.current[chatId]?.sessionId : undefined
    if (existing) {
      window.y.engine.cancel(existing)
      delete sessionToChatRef.current[existing]
    }
    if (chatId) setRuntime(chatId, { sessionId: undefined, engineId: id, busy: false, status: '', error: '' })
    setEngineId(id)
    setModelId(resolved)
    setRunOptions(nextOptions)
    setSessionId(null)
    setStatus('')
    setError('')
    setBusy(false)
    const res = await window.y.engine.start({ engine: id, model: resolved, options: nextOptions })
    if (!res.ok || !res.sessionId) {
      setError(res.error || 'Failed to start engine')
      if (chatId) setRuntime(chatId, { engineId: id, error: res.error || 'Failed to start engine' })
      return null
    }
    if (chatId) {
      sessionToChatRef.current[res.sessionId] = chatId
      setRuntime(chatId, { sessionId: res.sessionId, engineId: id, busy: false, status: '', error: '' })
    }
    return res.sessionId
  }

  function settleTools(list: Msg[]): Msg[] {
    let touched = false
    const out = list.map((m) => {
      if (m.role === 'tool' && m.streaming) {
        touched = true
        return { ...m, streaming: false }
      }
      return m
    })
    return touched ? out : list
  }

  function sealAllThinking(list: Msg[]): Msg[] {
    let touched = false
    const out = list.map((m) => {
      if (m.role === 'thinking' && m.streaming) { touched = true; return { ...m, streaming: false } }
      return m
    })
    return touched ? out : list
  }

  function sealAssistantStreaming(list: Msg[]): Msg[] {
    let touched = false
    const out = list.map((m) => {
      if (m.role === 'assistant' && m.streaming) { touched = true; return { ...m, streaming: false } }
      return m
    })
    return touched ? out : list
  }

  function appendThinking(list: Msg[], chunk: string): Msg[] {
    if (!chunk) return list
    const base = settleTools(list)
    const last = base[base.length - 1]
    if (last?.role === 'thinking' && last.streaming) {
      return base.slice(0, -1).concat([{ ...last, text: (last.text ?? '') + chunk }])
    }
    const id = `think-${base.length}`
    return base.concat([{ role: 'thinking', id, text: chunk, streaming: true }])
  }

  function upsertTool(list: Msg[], e: Extract<AgentEvent, { kind: 'tool' }>): Msg[] {
    const verb = e.verb || toolVerbFromName(e.name)
    if (e.name === 'hook' || verb.toLowerCase().includes('hook')) return settleTools(sealAllThinking(list))
    const isLive = e.phase !== 'end'
    const targetKey = normalizeToolTarget(e.target)
    const editEvent = verb === 'edit' || verb === 'Edit' || e.name === 'Edit' || e.name === 'Write'
    const existingIndex = e.id
      ? list.findIndex((m) => m.role === 'tool' && m.id === e.id)
      : -1
    const lastUserIndex = list.findLastIndex((m) => m.role === 'user')
    const sameFileTurnIndex =
      existingIndex === -1 && editEvent && targetKey
        ? list.findLastIndex((m, index) =>
            index > lastUserIndex &&
            m.role === 'tool' &&
            isEditTool(m) &&
            normalizeToolTarget(m.target) === targetKey
          )
        : -1
    const liveSameFileIndex =
      existingIndex === -1 && sameFileTurnIndex === -1 && editEvent && targetKey
        ? list.findLastIndex((m) =>
            m.role === 'tool' &&
            isEditTool(m) &&
            normalizeToolTarget(m.target) === targetKey &&
            (m.streaming || e.phase !== 'start')
          )
        : -1
    const updateIndex = existingIndex !== -1 ? existingIndex : sameFileTurnIndex !== -1 ? sameFileTurnIndex : liveSameFileIndex
    if (updateIndex !== -1) {
      const prev = list[updateIndex]
      const next = list.slice()
      next[updateIndex] = {
        ...prev,
        id: prev.id ?? e.id,
        name: e.name,
        verb,
        target: e.target ?? prev.target,
        body: e.body ?? prev.body,
        failed: e.failed ?? prev.failed,
        streaming: isLive
      }
      return isLive ? next : mergeAdjacentSameFileEdit(next)
    }
    const last = list[list.length - 1]
    const sameTool =
      last?.role === 'tool' &&
      Boolean(e.id && last.id === e.id)
    const base = sameTool ? list : settleTools(list)
    const prev = base[base.length - 1]
    const next: Msg = {
      role: 'tool',
      name: e.name,
      id: e.id ?? `${e.name}-${e.target ?? e.verb ?? 'tool'}-${base.length}`,
      verb,
      target: e.target,
      body: e.body,
      failed: e.failed,
      streaming: isLive
    }
    const merge =
      prev?.role === 'tool' &&
      Boolean(e.id && prev.id === e.id)
    if (merge) {
      const merged = base.slice(0, -1).concat([
        { ...prev, ...next, target: e.target ?? prev.target, body: e.body ?? prev.body, failed: e.failed ?? prev.failed }
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

  function normalizeToolTarget(target?: string): string {
    if (!target) return ''
    const p = target.replace(/\\/g, '/')
    return p.split('/').pop() || p
  }

  function isEditTool(m: Msg): boolean {
    if (m.role !== 'tool' || m.system) return false
    const v = m.verb || toolVerbFromName(m.name || 'tool')
    return v.toLowerCase() === 'edit' || v.toLowerCase() === 'write'
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

  function append(list: Msg[], chunk: string, sourceEngineId = engineId): Msg[] {
    const last = list[list.length - 1]
    if (chunk === '\n\n' && last?.role === 'tool') return list
    const base = settleTools(sealAllThinking(list))
    const prev = base[base.length - 1]
    if (prev && prev.role === 'assistant' && prev.engineId === sourceEngineId) {
      return base.slice(0, -1).concat([{ ...prev, text: (prev.text ?? '') + chunk, streaming: true }])
    }
    return base.concat([{ role: 'assistant', text: chunk, engineId: sourceEngineId, streaming: true }])
  }

  function finalizeInterruptedTurn(list: Msg[], durationMs?: number, checkpointId?: string): Msg[] {
    const base = sealAssistantStreaming(settleTools(sealAllThinking(list)))
    const lastAssistantIndex = base.findLastIndex((message) => message.role === 'assistant')
    if (lastAssistantIndex !== -1) {
      const next = base.slice()
      const message = next[lastAssistantIndex]
      next[lastAssistantIndex] = { ...message, checkpointId: checkpointId ?? message.checkpointId, durationMs, interrupted: true }
      return next
    }
    const fallbackEngine = runtimesRef.current[activeRef.current.chatId || '']?.engineId || engineId
    return base.concat([{ role: 'assistant', text: 'Interrupted.', engineId: fallbackEngine, checkpointId, durationMs, interrupted: true }])
  }

  function flushStreamBuffer(chatId: string, force = false) {
    const frame = streamFramesRef.current[chatId]
    if (frame) window.clearTimeout(frame)
    delete streamFramesRef.current[chatId]
    const buffered = streamBuffersRef.current[chatId]
    if (!buffered) return
    delete streamBuffersRef.current[chatId]
    const next = splitVisibleStreamText(buffered, force)
    if (next.visible) updateChatMessages(chatId, (messages) => append(messages, next.visible, buffered.engineId))
    if (next.rest) {
      streamBuffersRef.current[chatId] = {
        text: next.rest,
        engineId: buffered.engineId,
        firstAt: next.visible ? Date.now() : buffered.firstAt
      }
      streamFramesRef.current[chatId] = window.setTimeout(() => flushStreamBuffer(chatId), STREAM_FLUSH_MS)
    }
  }

  function queueStreamText(chatId: string, text: string, sourceEngineId: string) {
    const frame = streamFramesRef.current[chatId]
    if (frame) window.clearTimeout(frame)
    const buffered = streamBuffersRef.current[chatId]
    streamBuffersRef.current[chatId] = {
      text: (buffered?.text ?? '') + text,
      engineId: buffered?.engineId ?? sourceEngineId,
      firstAt: buffered?.firstAt ?? Date.now()
    }
    streamFramesRef.current[chatId] = window.setTimeout(() => flushStreamBuffer(chatId), STREAM_FLUSH_MS)
  }

  function scrollCommittedTextIntoView(chatId: string) {
    if (activeRef.current.chatId !== chatId) return
    stickToBottomRef.current = true
    animatedFinalScrollRef.current = true
    if (finalScrollFrameRef.current !== null) cancelAnimationFrame(finalScrollFrameRef.current)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const log = logRef.current
        if (!log) {
          animatedFinalScrollRef.current = false
          return
        }
        const start = log.scrollTop
        const target = Math.max(0, log.scrollHeight - log.clientHeight)
        const distance = target - start
        const duration = Math.max(700, Math.min(1100, 700 + Math.abs(distance) * 0.25))
        const startedAt = performance.now()
        const step = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / duration)
          const eased = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2
          log.scrollTop = start + distance * eased
          if (progress < 1) {
            finalScrollFrameRef.current = requestAnimationFrame(step)
            return
          }
          finalScrollFrameRef.current = null
          animatedFinalScrollRef.current = false
        }
        finalScrollFrameRef.current = requestAnimationFrame(step)
      })
    })
  }

  function flushThinkingBuffer(chatId: string) {
    const frame = thinkingFramesRef.current[chatId]
    if (frame) window.clearTimeout(frame)
    delete thinkingFramesRef.current[chatId]
    const text = thinkingBuffersRef.current[chatId]
    if (!text) return
    delete thinkingBuffersRef.current[chatId]
    updateChatMessages(chatId, (messages) => appendThinking(messages, text))
  }

  function queueThinkingText(chatId: string, text: string) {
    thinkingBuffersRef.current[chatId] = (thinkingBuffersRef.current[chatId] ?? '') + text
    if (thinkingFramesRef.current[chatId]) return
    thinkingFramesRef.current[chatId] = window.setTimeout(() => flushThinkingBuffer(chatId), 32)
  }

  function addSystemNote(text: string) {
    const chatId = activeRef.current.chatId
    const apply = (m: Msg[]) => settleTools(sealAllThinking(m)).concat([{ role: 'tool', name: text, system: true }])
    if (chatId) updateChatMessages(chatId, apply)
    else setMessages(apply)
  }

  function modelWithEffort(effort: string): string | null {
    const { base } = parseModelId(modelId)
    const efforts = catalogEfforts(pickerCatalog, engineId, base)
    if (!efforts.some((item) => item.id === effort)) return null
    return buildModelId(base, effort)
  }

  function applyEffortCommand(effort: string, label: string): boolean {
    if (!EFFORTS.includes(effort)) {
      addSystemNote('Unknown reasoning effort. Use low, medium, high, xhigh, or max.')
      return true
    }
    const nextModel = modelWithEffort(effort)
    if (!nextModel) {
      addSystemNote(`${LABELS[engineId] || engineId} does not expose ${effort} effort for the selected model.`)
      return true
    }
    start(engineId, nextModel, runOptions)
    addSystemNote(`${label}: reasoning effort set to ${effort}.`)
    return true
  }

  function clearChat() {
    const chatId = activeRef.current.chatId
    const current = chatId ? runtimesRef.current[chatId]?.sessionId : sidRef.current
    if (current && !PREVIEW) {
      window.y.engine.cancel(current)
      delete sessionToChatRef.current[current]
    }
    if (chatId) setRuntime(chatId, { sessionId: undefined, busy: false, status: '', error: '' })
    sidRef.current = null
    if (chatId) updateChatMessages(chatId, function () { return [] })
    else setMessages([])
    setTitle('New chat')
    setError('')
    setStatus('')
    setBusy(false)
    persistChatMeta(chatId, { title: 'New chat', messages: [] })
    start(engineId, modelId, runOptions)
  }

  function currentSessionId(): string | null {
    const chatId = activeRef.current.chatId
    if (PREVIEW) return sessionId
    return chatId ? (runtimesRef.current[chatId]?.sessionId || null) : sidRef.current
  }

  function applyNativeGoalResult(value: string | undefined): string {
    const nextGoal = (value ?? '').trim()
    setGoal(nextGoal)
    persistChatMeta(activeRef.current.chatId, { goal: nextGoal })
    return nextGoal
  }

  function clearGoalAfterTurn(chatId: string | undefined, sessionIdToClear?: string): void {
    setGoal('')
    persistChatMeta(chatId, { goal: '' })
    if (!sessionIdToClear || PREVIEW) return
    void window.y.engine.command(sessionIdToClear, { name: 'goal', action: 'clear' })
  }

  function runGoalCommand(command: Extract<EngineCommand, { name: 'goal' }>, fallbackObjective = ''): void {
    if (engineId !== 'codex') {
      addSystemNote('Native goals are available for Codex only. Claude Code does not expose an equivalent persistent goal command through this adapter.')
      return
    }
    if (command.action === 'set') {
      const objective = command.value?.trim() ?? ''
      if (!objective) {
        addSystemNote('Goal text is required.')
        return
      }
      if (objective.length > 4000) {
        addSystemNote('Codex goals must be at most 4,000 characters. Put longer instructions in a file and point the goal at that file.')
        return
      }
    }
    const sid = currentSessionId()
    if (!sid) {
      addSystemNote('Codex goals attach to the active Codex thread. Wait for the session to start, then set the goal again.')
      return
    }
    void window.y.engine.command(sid, command).then((res) => {
      if (!res.ok) {
        addSystemNote(commandFailureMessage(command, res.error, 'Codex goal command failed.'))
        return
      }
      const nextGoal = applyNativeGoalResult(command.action === 'clear' ? '' : res.value ?? fallbackObjective)
      addSystemNote(res.message || (nextGoal ? `Codex goal active: ${nextGoal}` : 'No Codex goal is set.'))
      trackEvent('chat_goal_updated', { engineId, hasGoal: Boolean(nextGoal), source: 'native', status: res.status })
    })
  }

  function beginGoalComposer(): void {
    if (composerMode === 'goal') {
      setComposerMode('chat')
      return
    }
    setComposerMode('goal')
    window.requestAnimationFrame(() => composerInputRef.current?.focus())
  }

  function updateQueuedFollowUps(updater: (queued: Record<string, QueuedFollowUp[]>) => Record<string, QueuedFollowUp[]>) {
    setQueuedFollowUps((queued) => {
      const next = updater(queued)
      queuedFollowUpsRef.current = next
      return next
    })
  }

  function getChatById(chatId: string): { project?: Project; chat?: AppChat } {
    for (const project of projectsRef.current) {
      const chat = project.chats.find((item) => item.id === chatId)
      if (chat) return { project, chat }
    }
    return {}
  }

  function getMessagesForChat(chatId: string): Msg[] {
    if (activeRef.current.chatId === chatId) return messagesRef.current
    return getChatById(chatId).chat?.messages ?? []
  }

  function requestLogScrollToBottom(chatId?: string) {
    if (chatId && activeRef.current.chatId !== chatId) return
    stickToBottomRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const log = logRef.current
        if (log && stickToBottomRef.current) log.scrollTop = log.scrollHeight
      })
    })
  }

  async function restartChatSession(chatId: string): Promise<string | null> {
    const { project, chat } = getChatById(chatId)
    if (!chat) return null
    const existing = runtimesRef.current[chatId]?.sessionId
    if (existing && !PREVIEW) {
      void window.y.engine.cancel(existing)
      delete sessionToChatRef.current[existing]
    }
    return start(chatEngine(chat), chatModel(chat, chatEngine(chat)), chatOptions(chat), project?.path, chatId)
  }

  async function sendTextToChat(chatId: string, text: string, files: SelectedFile[] = [], pasted: PastedTextAttachment[] = [], goalBacked = false): Promise<boolean> {
    const trimmed = text.trim() || (pasted.length ? 'See pasted text attachment.' : '')
    if (!trimmed) return false
    const runtime = runtimesRef.current[chatId]
    const targetSession = runtime?.sessionId || (PREVIEW ? sessionId : null)
    if (!targetSession) return false
    const { project, chat } = getChatById(chatId)
    const targetEngine = runtime?.engineId || chatEngine(chat) || engineId
    if (goalBacked) {
      if (targetEngine !== 'codex') {
        addSystemNote('Goal mode is available for Codex only.')
        return false
      }
      if (trimmed.length > 4000) {
        addSystemNote('Codex goals must be at most 4,000 characters. Put longer instructions in a file and point the goal at that file.')
        return false
      }
      const goalResult = await window.y.engine.command(targetSession, { name: 'goal', action: 'set', value: trimmed })
      if (!goalResult.ok) {
        addSystemNote(commandFailureMessage({ name: 'goal', action: 'set', value: trimmed }, goalResult.error, 'Could not start Codex goal mode.'))
        return false
      }
      applyNativeGoalResult(goalResult.value ?? trimmed)
      trackEvent('chat_goal_started', { chatId, projectId: project?.id, engineId: targetEngine, promptLength: trimmed.length, status: goalResult.status })
    }
    const checkpoint = await window.y.app.checkpoint(project?.id)
    const history = getMessagesForChat(chatId)
    const firstUserMessage = !history.some((message) => message.role === 'user')
    if (firstUserMessage && activeRef.current.chatId === chatId && title === 'New chat') setTitle(chatTitleFromText(trimmed))
    if (firstUserMessage && chat && chat.title === 'New chat') persistChatMeta(chatId, { title: chatTitleFromText(trimmed) })
    const visibleText = pasted.length
      ? `${trimmed}\n\n${pasted.map((item) => `[attached: ${item.name}]`).join('\n')}`
      : trimmed
    updateChatMessages(chatId, (m) => m.concat([{ role: 'user', text: visibleText, checkpointId: checkpoint.checkpointId }]))
    const fileSection = files.length ? `Attached files:\n${files.map((file) => `- ${file.path}`).join('\n')}` : ''
    const pastedSection = pasted.length
      ? `Attached pasted text:\n${pasted.map((item) => `--- ${item.name} (${formatBytes(item.size) || `${item.size} bytes`}) ---\n${item.text}`).join('\n\n')}`
      : ''
    const promptParts = [fileSection, pastedSection, trimmed].filter(Boolean)
    const prompt = promptParts.join('\n\n')
    trackEvent('chat_message_sent', {
      chatId,
      projectId: project?.id,
      engineId: runtime?.engineId || engineId,
      modelId,
      promptLength: trimmed.length,
      attachmentCount: files.length,
      pastedAttachmentCount: pasted.length,
      hasGoal: goalBacked || Boolean(targetEngine === 'codex' && (activeRef.current.chatId === chatId ? goal : chat?.goal ?? '')),
      firstUserMessage
    })
    trackEvent('user_active', {
      surface: 'main',
      engineId: runtime?.engineId || engineId,
      hasGoal: goalBacked || Boolean(targetEngine === 'codex' && (activeRef.current.chatId === chatId ? goal : chat?.goal ?? ''))
    })
    armCompletionSound()
    setDoneChats((prev) => {
      if (!prev[chatId]) return prev
      const next = { ...prev }
      delete next[chatId]
      return next
    })
    setRuntime(chatId, { busy: true, startedAt: Date.now(), status: '...', error: '', goalBacked })
    if (PREVIEW) {
      void window.y.engine.send(targetSession, prompt)
      return true
    }
    void window.y.engine.send(targetSession, prompt)
    return true
  }

  function queueFollowUp(chatId: string, text: string, goalBacked = false) {
    const trimmed = text.trim()
    if (!trimmed) return
    const current = queuedFollowUpsRef.current[chatId] ?? []
    if (current.length >= 7) {
      showToast('Queue limit reached (7)')
      return
    }
    updateQueuedFollowUps((queued) => {
      const items = queued[chatId] ?? []
      return {
        ...queued,
        [chatId]: items.concat([{ id: `${Date.now()}-${items.length}`, text: trimmed, steer: false, goal: goalBacked }])
      }
    })
    setComposerInput('')
  }

  function requestQueuedSteer(chatId: string, itemId: string) {
    updateQueuedFollowUps((queued) => ({
      ...queued,
      [chatId]: (queued[chatId] ?? []).map((item) => item.id === itemId ? { ...item, steer: true } : item)
    }))
  }

  async function deliverQueuedSteer(chatId: string) {
    if (deliveringSteerRef.current.has(chatId)) return
    const item = (queuedFollowUpsRef.current[chatId] ?? []).find((queued) => queued.steer)
    const session = runtimesRef.current[chatId]?.sessionId
    if (!item || !session) return
    deliveringSteerRef.current.add(chatId)
    const { project } = getChatById(chatId)
    const checkpoint = await window.y.app.checkpoint(project?.id)
    const res = await window.y.engine.command(session, { name: 'steer', value: buildSteeringText(item.text) })
    deliveringSteerRef.current.delete(chatId)
    if (!res.ok) {
      addSystemNote(res.error || 'The engine could not steer this turn; the message remains queued.')
      return
    }
    updateChatMessages(chatId, (messages) =>
      settleTools(sealAllThinking(messages)).concat([
        { role: 'user', text: item.text, checkpointId: checkpoint.checkpointId }
      ])
    )
    updateQueuedFollowUps((queued) => {
      const remaining = (queued[chatId] ?? []).filter((queuedItem) => queuedItem.id !== item.id)
      const next = { ...queued, [chatId]: remaining }
      if (!remaining.length) delete next[chatId]
      return next
    })
    setRuntime(chatId, { status: res.message || 'Steering after the completed tool call.' })
  }

  function flushQueuedFollowUp(chatId: string) {
    const item = queuedFollowUpsRef.current[chatId]?.[0]
    if (!item) return
    updateQueuedFollowUps((queued) => {
      const remaining = (queued[chatId] ?? []).slice(1)
      const next = { ...queued, [chatId]: remaining }
      if (!remaining.length) delete next[chatId]
      return next
    })
    void sendTextToChat(chatId, item.text, [], [], Boolean(item.goal))
  }

  function copyMessage(text: string) {
    if (!text) return
    const write = window.y?.clipboard?.writeText
      ? window.y.clipboard.writeText(text).then(function (result) {
          if (!result.ok) throw new Error(result.error || 'Could not copy message')
        })
      : navigator.clipboard.writeText(text)
    void write.then(
      function () { showToast('Copied message') },
      function () { showToast('Could not copy message') }
    )
  }

  async function resetToMessage(chatId: string, index: number) {
    const list = getMessagesForChat(chatId)
    if (index < 0 || index >= list.length || list[index].role !== 'assistant') return
    const checkpointId = list[index].checkpointId
    if (!checkpointId) {
      addSystemNote('This older message has no code checkpoint, so it cannot reset code safely.')
      return
    }
    const { project } = getChatById(chatId)
    const restored = await window.y.app.restoreCheckpoint(project?.id, checkpointId)
    if (!restored.ok) {
      addSystemNote(restored.error || 'Could not restore the code checkpoint.')
      return
    }
    const current = runtimesRef.current[chatId]?.sessionId
    if (runtimesRef.current[chatId]?.busy && current && !PREVIEW) await window.y.engine.cancel(current)
    const nextMessages = list.slice(0, index + 1)
    replaceChatMessages(chatId, nextMessages)
    updateQueuedFollowUps((queued) => {
      if (!queued[chatId]) return queued
      const next = { ...queued }
      delete next[chatId]
      return next
    })
    setEditingMessage(null)
    await restartChatSession(chatId)
    trackEvent('chat_reset_to_message', { chatId, assistantIndex: index })
    showToast('Reset conversation to this point')
  }

  async function undoTurnEdits(chatId: string, assistantIndex: number) {
    const list = getMessagesForChat(chatId)
    const userIndex = list.slice(0, assistantIndex).findLastIndex((message) => message.role === 'user')
    if (userIndex === -1) {
      addSystemNote('Could not find the message checkpoint before those edits.')
      return
    }
    const checkpointId = list[userIndex].checkpointId
    if (!checkpointId) {
      addSystemNote('This turn has no starting code checkpoint, so it cannot undo code safely.')
      return
    }
    const { project } = getChatById(chatId)
    const restored = await window.y.app.restoreCheckpoint(project?.id, checkpointId)
    if (!restored.ok) {
      addSystemNote(restored.error || 'Could not restore the code checkpoint.')
      return
    }
    const current = runtimesRef.current[chatId]?.sessionId
    if (runtimesRef.current[chatId]?.busy && current && !PREVIEW) await window.y.engine.cancel(current)
    replaceChatMessages(chatId, list.slice(0, userIndex))
    updateQueuedFollowUps((queued) => {
      if (!queued[chatId]) return queued
      const next = { ...queued }
      delete next[chatId]
      return next
    })
    setEditingMessage(null)
    await restartChatSession(chatId)
    trackEvent('chat_undo_edits', { chatId, assistantIndex, projectId: project?.id })
    showToast('Undid edited files')
  }

  function beginEditUserMessage(chatId: string, index: number, text: string) {
    setEditingMessage({ chatId, index, text })
  }

  async function submitEditedUserMessage(chatId: string, index: number) {
    if (!editingMessage || editingMessage.chatId !== chatId || editingMessage.index !== index) return
    const text = editingMessage.text.trim()
    if (!text) return
    const list = getMessagesForChat(chatId)
    const checkpointId = list[index]?.checkpointId
    if (!checkpointId) {
      addSystemNote('This older message has no code checkpoint, so it cannot be edited safely.')
      return
    }
    const { project } = getChatById(chatId)
    const restored = await window.y.app.restoreCheckpoint(project?.id, checkpointId)
    if (!restored.ok) {
      addSystemNote(restored.error || 'Could not restore the code checkpoint.')
      return
    }
    const current = runtimesRef.current[chatId]?.sessionId
    if (runtimesRef.current[chatId]?.busy && current && !PREVIEW) await window.y.engine.cancel(current)
    const nextMessages = list.slice(0, index)
    replaceChatMessages(chatId, nextMessages)
    updateQueuedFollowUps((queued) => {
      if (!queued[chatId]) return queued
      const next = { ...queued }
      delete next[chatId]
      return next
    })
    if (activeRef.current.chatId !== chatId) {
      const { project } = getChatById(chatId)
      if (project) selectChat(project.id, chatId)
    }
    setEditingMessage(null)
    await restartChatSession(chatId)
    void sendTextToChat(chatId, text)
  }

  function cancelEditUserMessage() {
    setEditingMessage(null)
  }

  function buildSteeringText(text: string): string {
    return [
      'Steering update for the current running turn:',
      text.trim(),
      '',
      'Apply this as a correction to the current work. If I explicitly ask to ignore or replace earlier work, do that. Otherwise continue the existing task and incorporate this update; do not abandon unfinished prior requirements.'
    ].join('\n')
  }

	  function runNativeCommand(command: EngineCommand, fallbackMessage?: string) {
	    const sid = currentSessionId()
	    if (!sid) {
	      addSystemNote(fallbackMessage || 'Command queued for the next engine session.')
	      return
    }
    void window.y.engine.command(sid, command).then(function (res) {
      if (res.ok) addSystemNote(res.message || fallbackMessage || 'Command handled.')
	      else addSystemNote(commandFailureMessage(command, res.error, fallbackMessage))
	    })
	  }

	  function chooseSlashCommand(command: string) {
    const bare = command.replace(/^\//, '')
	    const noArg = ['help', 'clear', 'compact', 'plugins', 'mcp', 'doctor', 'agents', 'logout', 'update']
    setComposerInput('/' + bare + (noArg.includes(bare.toLowerCase()) ? '' : ' '))
  }

  function chooseMention(file: SelectedFile) {
    const token = '@' + (file.relPath || file.name)
    const value = composerValue()
    const match = value.match(/(^|\s)@([^\s@]*)$/)
    const next = !match || match.index === undefined
      ? `${value}${value.endsWith(' ') || !value ? '' : ' '}${token} `
      : `${value.slice(0, match.index) + match[1]}${token} `
    setComposerInput(next)
    setAttachments((prev) => {
      if (prev.some((item) => item.path === file.path)) return prev
      return prev.concat([file])
    })
  }

	  function closeComposerTerminal() {
	    setTerminalDockOpen(false)
      setComposerTerminal((term) => term?.transient ? null : term)
	  }

  function commandFailureMessage(command: EngineCommand, error?: string, fallbackMessage?: string): string {
    if (command.name === 'update') return error || fallbackMessage || 'Could not update this engine.'
    if (command.name === 'inventory' && command.target === 'skills') return error || fallbackMessage || 'No native skills list is available for this engine.'
    if (error && /update/i.test(error)) return error
    const label = LABELS[engineId] || engineId
    const base = error || fallbackMessage || `/${command.name} is not available for ${label}.`
    if (/does not expose|not available for this engine|unsupported .* command/i.test(base)) return base
    return `${base} If this command should work, run /update while using ${label}, then try again.`
  }

  function shellCommand(parts: string[], args?: string): string {
    const suffix = args?.trim()
    return suffix ? parts.concat([suffix]).join(' ') : parts.join(' ')
  }

  function shellQuote(value: string): string {
    return "'" + value.replace(/'/g, "'\\''") + "'"
  }

  function providerCliFor(engine: string): string {
    return engine === 'codex' ? 'codex' : 'claude'
  }

  function providerSlashCommandFor(engine: string, name: string, args?: string): string {
    const trimmed = args?.trim()
    const cli = providerCliFor(engine)
    if (!trimmed) return `${cli} ${name}`
    return `${cli} ${shellQuote(`${name} ${trimmed}`)}`
  }

  function providerSlashCommand(name: string, args?: string): string {
    return providerSlashCommandFor(engineId, name, args)
  }

  function providerStatusCommand(engine: string, kind: 'auth' | 'doctor'): string {
    if (kind === 'doctor') return `${providerCliFor(engine)} doctor`
    return engine === 'codex' ? 'codex login status' : 'claude auth status'
  }

	  function startTerminal(initialCommand?: string, label = 'Terminal', transient = false): true {
	    const cwd = activeRef.current.path
	    const id = `term-${Date.now()}-${Math.random().toString(16).slice(2)}`
	    const title = initialCommand ? `Running ${label}.` : label
	    setTerminalDockOpen(true)
	    if (composerTerminal?.id && composerTerminal.running && !PREVIEW) {
	      if (initialCommand) void window.y.terminal?.write(composerTerminal.id, initialCommand + '\r')
	      setComposerTerminal((term) => term ? { ...term, title, command: initialCommand ?? term.command } : term)
	      return true
	    }
	    if (PREVIEW) {
	      const body = initialCommand ? `$ ${initialCommand}\r\npreview terminal\r\n` : 'preview terminal\r\n'
	      setComposerTerminal((term) =>
	        term
	          ? { ...term, title, command: initialCommand ?? term.command, body: initialCommand ? term.body + body : term.body || body, running: true, transient: term.transient }
	          : { id, title, command: initialCommand, body, running: true, transient }
	      )
	      return true
	    }
    if (!window.y.terminal) {
      addSystemNote('This build does not expose the terminal brick yet.')
      return true
    }
    setComposerTerminal({ id, title, command: initialCommand, body: '', running: true, transient })
    void window.y.terminal.start({ id, cwd, command: initialCommand, cols: 96, rows: 24 }).then((res) => {
      if (!res.ok) {
        const error = res.error || 'Failed to start terminal.'
        setComposerTerminal((term) => term?.id === id ? { ...term, body: error, running: false } : term)
        return
      }
    })
    return true
  }

  function terminalCommand(command: string, label = 'Terminal'): true {
    return startTerminal(command, label, true)
  }

  function utilitySubcommand(arg: string): { sub: string; rest: string } {
    const [sub = 'list', ...tail] = arg.trim().split(/\s+/).filter(Boolean)
    return { sub: sub.toLowerCase(), rest: tail.join(' ') }
  }

  function handlePluginCommand(arg: string): true {
    const { sub, rest } = utilitySubcommand(arg)
    if (sub === 'marketplace' || sub === 'marketplaces') return handleMarketplaceCommand(rest)
    const passthrough = arg.trim() && sub !== 'list' && sub !== 'ls' ? arg.trim() : ''
    if (!passthrough || sub === 'list' || sub === 'ls') return terminalCommand(providerSlashCommand('/plugins'), '/plugins')
    if (
      ['details', 'detail', 'info', 'validate', 'install', 'i', 'add', 'enable', 'disable', 'uninstall', 'remove', 'rm', 'update', 'upgrade', 'prune', 'autoremove', 'tag', 'init', 'new'].includes(sub)
    ) {
      return terminalCommand(providerSlashCommand('/plugins', passthrough), '/plugins')
    }
    return terminalCommand(providerSlashCommand('/plugins', arg), '/plugins')
  }

  function handleMarketplaceCommand(arg: string): true {
    const { sub, rest } = utilitySubcommand(arg)
    const base = engineId === 'codex' ? ['codex', 'plugin', 'marketplace'] : ['claude', 'plugin', 'marketplace']
    if (sub === 'list' || sub === 'ls') return terminalCommand(shellCommand(base.concat(['list']), rest), '/marketplaces')
    if (sub === 'add') return terminalCommand(shellCommand(base.concat(['add']), rest), '/marketplaces')
    if (sub === 'remove' || sub === 'rm') return terminalCommand(shellCommand(base.concat(['remove']), rest), '/marketplaces')
    if (sub === 'update' || sub === 'upgrade') return terminalCommand(shellCommand(base.concat([engineId === 'codex' ? 'upgrade' : 'update']), rest), '/marketplaces')
    addSystemNote('Marketplace commands: /marketplaces list, add, remove, update.')
    return true
  }

  function handleMcpCommand(arg: string): true {
    const { sub } = utilitySubcommand(arg)
    const passthrough = arg.trim() && sub !== 'list' && sub !== 'ls' ? arg.trim() : ''
    if (!passthrough || sub === 'list' || sub === 'ls') return terminalCommand(providerSlashCommand('/mcp'), '/mcp')
    if (
      ['get', 'details', 'detail', 'add', 'add-json', 'remove', 'rm', 'login', 'logout', 'serve', 'reset-project-choices'].includes(sub)
    ) {
      return terminalCommand(providerSlashCommand('/mcp', passthrough), '/mcp')
    }
    return terminalCommand(providerSlashCommand('/mcp', arg), '/mcp')
  }

	  function handleSlashCommand(text: string): boolean {
	    if (!text.startsWith('/')) return false
	    const [raw, ...rest] = text.slice(1).trim().split(/\s+/)
	    const cmd = raw.toLowerCase()
	    const arg = rest.join(' ').trim()
	    if (!cmd || cmd === 'help') {
	      addSystemNote(slashHelpForEngine(engineId))
	      return true
	    }
	    if (!isCommandAvailableForEngine(cmd, engineId)) {
	      addSystemNote(commandUnavailableMessage(cmd, engineId))
	      return true
	    }
	    if (cmd === 'fast') {
      const nativeFast = engineCommands.some((item) => item.name.replace(/^\//, '').toLowerCase() === 'fast')
      if (!nativeFast) {
        addSystemNote('/fast is not a y shortcut. It will appear here only when the active engine reports a real /fast command.')
        return true
      }
      runNativeCommand({ name: 'slash', value: '/fast' }, 'Running /fast.')
      return true
    }
    if (cmd === 'effort' || cmd === 'reasoning') return applyEffortCommand(arg.toLowerCase(), 'Reasoning')
    if (cmd === 'compact') {
      runNativeCommand({ name: 'compact' }, 'Compacting context.')
      return true
    }
    if (cmd === 'plugins' || cmd === 'plugin') {
      return handlePluginCommand(arg || 'list')
    }
    if (cmd === 'mcp') {
      return handleMcpCommand(arg || 'list')
    }
    if (cmd === 'marketplaces' || cmd === 'marketplace') return handleMarketplaceCommand(arg || 'list')
    if (cmd === 'terminal' || cmd === 'term') return startTerminal(arg, 'Terminal')
    if (cmd === 'doctor') return terminalCommand(shellCommand([engineId === 'codex' ? 'codex' : 'claude', 'doctor'], arg), 'Doctor terminal')
    if (cmd === 'agents') return terminalCommand(shellCommand(['claude', 'agents', '--json'], arg), 'Agents terminal')
    if (cmd === 'auth') {
      const sub = arg.toLowerCase() || 'status'
      if (sub === 'status') return terminalCommand('claude auth status', 'Auth terminal')
      if (sub === 'login') return terminalCommand('claude auth login', 'Auth terminal')
      if (sub === 'logout') return terminalCommand('claude auth logout', 'Auth terminal')
      addSystemNote('Auth commands: /auth status, /auth login, /auth logout.')
      return true
    }
    if (cmd === 'login') return terminalCommand(arg.toLowerCase() === 'status' ? 'codex login status' : 'codex login', 'Login terminal')
    if (cmd === 'logout') return terminalCommand('codex logout', 'Login terminal')
    if (cmd === 'features') {
      const { sub, rest } = utilitySubcommand(arg)
      if (sub === 'list' || sub === 'ls') return terminalCommand(shellCommand(['codex', 'features', 'list'], rest), 'Features terminal')
      if (sub === 'enable') return terminalCommand(shellCommand(['codex', 'features', 'enable'], rest), 'Features terminal')
      if (sub === 'disable') return terminalCommand(shellCommand(['codex', 'features', 'disable'], rest), 'Features terminal')
      addSystemNote('Feature commands: /features list, /features enable <name>, /features disable <name>.')
      return true
    }
    if (cmd === 'project') {
      const { sub, rest } = utilitySubcommand(arg)
      if (sub === 'purge') return terminalCommand(shellCommand(['claude', 'project', 'purge'], rest), 'Project terminal')
      addSystemNote('Project commands: /project purge [path].')
      return true
    }
    if (cmd === 'auto-mode') {
      const sub = arg.toLowerCase() || 'config'
      if (sub === 'config') return terminalCommand('claude auto-mode config', 'Auto-mode terminal')
      if (sub === 'defaults') return terminalCommand('claude auto-mode defaults', 'Auto-mode terminal')
      if (sub === 'critique') return terminalCommand('claude auto-mode critique', 'Auto-mode terminal')
      addSystemNote('Auto-mode commands: /auto-mode config, defaults, critique.')
      return true
    }
	    if (cmd === 'update') {
	      runNativeCommand({ name: 'update' }, 'Checking for engine updates.')
	      return true
	    }
    if (cmd === 'goal') {
      if (!arg) {
        runGoalCommand({ name: 'goal', action: 'get' }, goal)
        return true
      }
      if (['pause', 'resume'].includes(arg.toLowerCase())) {
        addSystemNote('Codex CLI documents /goal pause and /goal resume for the interactive CLI, but Codex app-server 0.139 exposes only thread/goal/set, thread/goal/get, and thread/goal/clear. Open the native Codex terminal if you need pause/resume.')
        return true
      }
      if (['clear', 'off', 'reset'].includes(arg.toLowerCase())) {
        runGoalCommand({ name: 'goal', action: 'clear' })
        return true
      }
      runGoalCommand({ name: 'goal', action: 'set', value: arg }, arg)
      return true
    }
	    if (cmd === 'clear') {
	      clearChat()
	      return true
	    }
		    addSystemNote(`Unknown command /${cmd}. ${slashHelpForEngine(engineId)}`)
		    return true
		  }

  useEffect(() => {
    if (window.parent === window) return
    window.parent.postMessage({ type: 'y:userland-layout', fileRailOpen, fileRailWidth }, '*')
  }, [fileRailOpen, fileRailWidth])

  useEffect(() => {
    if (PREVIEW || !window.y.modify) return
    return window.y.modify.onChange((open) => {
      setModifyOpen(open)
      if (open) setFileRailOpen(false)
    })
  }, [])

  useEffect(() => {
    let disposed = false
    void window.y.app.getState().then(function (state) {
      if (!disposed) applyState(state)
    })
    return function () {
      disposed = true
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!appReady) return
    const off = window.y.engine.onEvent(({ sessionId: sid, event: e }) => {
      const chatId = sessionToChatRef.current[sid]
      if (!chatId) return
      if (e.kind === 'status') {
        setRuntime(chatId, { status: isNoisyRuntimeStatus(e.status) ? '' : e.status })
      } else if (e.kind === 'text') {
        flushThinkingBuffer(chatId)
        setRuntime(chatId, { status: '' })
        queueStreamText(chatId, e.text, runtimesRef.current[chatId]?.engineId || engineId)
      } else if (e.kind === 'thinking') {
        flushStreamBuffer(chatId, true)
        setRuntime(chatId, { status: '' })
        updateChatMessages(chatId, sealAssistantStreaming)
        queueThinkingText(chatId, e.text)
      } else if (e.kind === 'tool') {
        flushStreamBuffer(chatId, true)
        flushThinkingBuffer(chatId)
        const runtime = runtimesRef.current[chatId]
        const existing = getMessagesForChat(chatId).some((m) => m.role === 'tool' && e.id && m.id === e.id)
        if (!PREVIEW && !runtime?.busy && !existing) return
        const signature = `${sid}:${e.id || ''}:${e.phase}:${e.name}:${e.verb || ''}:${e.target || ''}:${e.body || ''}`
        if (seenToolEventsRef.current[signature]) return
        seenToolEventsRef.current[signature] = true
        setRuntime(chatId, { status: '' })
        updateChatMessages(chatId, (m) => upsertTool(sealAssistantStreaming(m), e))
        if (e.phase === 'start' || e.phase === 'end') {
          trackEvent('chat_tool_call', {
            chatId,
            engineId: runtime?.engineId || engineId,
            name: e.name,
            verb: e.verb,
            phase: e.phase,
            hasTarget: Boolean(e.target)
          })
        }
        if (e.phase === 'end' && (queuedFollowUpsRef.current[chatId] ?? []).some((item) => item.steer)) {
          void deliverQueuedSteer(chatId)
        }
      } else if (e.kind === 'suggestion') {
        flushStreamBuffer(chatId, true)
        flushThinkingBuffer(chatId)
        setRuntime(chatId, { status: '' })
        updateChatMessages(chatId, (m) => m.concat([{ role: 'tool', name: `Suggested next: ${e.text}`, system: true }]))
      } else if (e.kind === 'commands') {
        setEngineCommands(e.commands)
      } else if (e.kind === 'result') {
        const runtime = runtimesRef.current[chatId]
        const durationMs = runtime?.startedAt ? Date.now() - runtime.startedAt : undefined
        if (runtime?.goalBacked) clearGoalAfterTurn(chatId, runtime.sessionId)
        flushStreamBuffer(chatId, true)
        scrollCommittedTextIntoView(chatId)
        flushThinkingBuffer(chatId)
        const notify = e.ok && shouldPlayCompletionSound(chatId, runtime)
        seenToolEventsRef.current = {}
        setRuntime(chatId, { busy: false, startedAt: undefined, status: '', error: e.ok ? '' : e.summary || 'The engine reported an error.', goalBacked: false })
        trackEvent('chat_turn_completed', {
          chatId,
          engineId: runtime?.engineId || engineId,
          ok: e.ok,
          durationMs
        })
        updateChatMessages(chatId, (m) => sealAssistantStreaming(settleTools(sealAllThinking(m))))
        if (e.ok) {
          if (notify) playCompletionSound()
          if (activeRef.current.chatId !== chatId) markChatDone(chatId)
          const { project } = getChatById(chatId)
          void window.y.app.checkpoint(project?.id).then((checkpoint) => {
            if (checkpoint.ok && checkpoint.checkpointId) {
              updateChatMessages(chatId, (list) => {
                const index = list.findLastIndex((message) => message.role === 'assistant')
                if (index === -1) return list
                const next = list.slice()
                next[index] = { ...next[index], checkpointId: checkpoint.checkpointId, durationMs, interrupted: false }
                return next
              })
            }
            flushQueuedFollowUp(chatId)
          })
        }
      } else if (e.kind === 'error') {
        const runtime = runtimesRef.current[chatId]
        if (runtime?.goalBacked) clearGoalAfterTurn(chatId, runtime.sessionId)
        flushStreamBuffer(chatId, true)
        scrollCommittedTextIntoView(chatId)
        flushThinkingBuffer(chatId)
        seenToolEventsRef.current = {}
        setRuntime(chatId, { busy: false, startedAt: undefined, status: '', error: e.message, goalBacked: false })
        trackEvent('chat_turn_error', { engineId: runtime?.engineId || engineId })
        updateChatMessages(chatId, (m) => sealAssistantStreaming(settleTools(sealAllThinking(m))))
      }
    })
    void Promise.all([window.y.engine.list(), window.y.engine.models()]).then(function (res) {
      const ids = res[0]
      const cat = res[1]
      if (ids.length) setEngines(ids)
      if (cat.length) {
        setCatalog(cat)
        const project = projects.find(function (p) { return p.id === activeRef.current.projectId })
        const chat = project?.chats.find(function (c) { return c.id === activeRef.current.chatId })
        const first = cat.find(function (c) { return c.engine === chatEngine(chat) }) ?? cat.find(function (c) { return c.engine === 'claude-code' }) ?? cat[0]
        start(first.engine, chatModel(chat, first.engine), chatOptions(chat), activeRef.current.path, chat?.id ?? activeRef.current.chatId)
        return
      }
      start('claude-code')
    })
    return off
  }, [appReady])

  useEffect(() => {
    if (PREVIEW || !appReady || !window.y.terminal) return
    return window.y.terminal.onEvent((e) => {
      if (e.kind === 'data') {
        if (PREVIEW) {
          setComposerTerminal((term) =>
            term?.id === e.id
              ? { ...term, body: (term.body + stripAnsi(e.data ?? '')).slice(-20000), running: true }
              : term
          )
        }
      } else if (e.kind === 'exit') {
        setComposerTerminal((term) =>
          term?.id === e.id
            ? { ...term, body: `${term.body}\n[process exited${typeof e.exitCode === 'number' ? ` ${e.exitCode}` : ''}]`, running: false }
            : term
        )
      } else if (e.kind === 'error') {
        setComposerTerminal((term) =>
          term?.id === e.id
            ? { ...term, body: `${term.body}\n[terminal error] ${e.message}`, running: false }
            : term
        )
      }
    })
  }, [appReady])

  useEffect(() => {
    if (!appReady || !activeProjectId || !activeWorkspacePath) return
    const off = window.y.app.onFilesChanged(function (payload) {
      if (payload.projectId !== activeProjectId) return
      const loaded = Object.keys(projectDirectoriesRef.current)
      const affected = new Set<string>()
      if (!payload.paths.length || payload.paths.includes('')) {
        for (const directory of loaded) affected.add(directory)
      } else {
        for (const rawPath of payload.paths) {
          const changedPath = rawPath.replace(/\\/g, '/').replace(/^\.\//, '')
          const slash = changedPath.lastIndexOf('/')
          const parent = slash === -1 ? '' : changedPath.slice(0, slash)
          if (Object.prototype.hasOwnProperty.call(projectDirectoriesRef.current, parent)) affected.add(parent)
          if (Object.prototype.hasOwnProperty.call(projectDirectoriesRef.current, changedPath)) affected.add(changedPath)
        }
      }
      for (const directory of affected) void loadProjectDirectory(activeProjectId, directory, true, activeWorkspacePath)
    })
    setProjectDirectories({})
    projectDirectoriesRef.current = {}
    pendingFolderRefreshRef.current.clear()
    setExpandedFolders(new Set())
    void loadProjectDirectory(activeProjectId, '', true, activeWorkspacePath)
    void window.y.app.watchFiles(activeProjectId, activeWorkspacePath)
    return function () {
      off()
      void window.y.app.unwatchFiles(activeProjectId)
    }
  }, [appReady, activeProjectId, activeWorkspacePath])

  useEffect(() => {
    closeFileView()
  }, [activeProjectId, activeWorkspacePath])

  useEffect(() => {
    if (!appReady || !activeProjectId || !activeChatId) return
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    if (PREVIEW) return
	    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
	    persistTimerRef.current = setTimeout(function () {
	      void window.y.app.updateChat(activeProjectId, activeChatId, { title, messages, engineId, modelId, goal, runOptions })
	    }, 350)
	  }, [appReady, activeProjectId, activeChatId, title, messages, engineId, modelId, goal, runOptions])

  useEffect(() => {
    const log = logRef.current
    if (!log || !stickToBottomRef.current || animatedFinalScrollRef.current) return
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (stickToBottomRef.current) log.scrollTop = log.scrollHeight
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, status])

  useEffect(() => {
    if (!searchOpen) return
    const id = window.setTimeout(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen) return
    const closeEmptySearch = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && searchBoxRef.current?.contains(target)) return
      if (!searchQuery.trim()) setSearchOpen(false)
    }
    document.addEventListener('pointerdown', closeEmptySearch)
    return () => document.removeEventListener('pointerdown', closeEmptySearch)
  }, [searchOpen, searchQuery])

  function send() {
    const rawText = composerValue()
    const text = rawText.trim()
    const pasted = pastedAttachments
    if (!text && !pasted.length) return
    const chatId = activeRef.current.chatId || activeChatId
    const goalBacked = composerMode === 'goal'
    if (!goalBacked && handleSlashCommand(text)) {
      setComposerInput('')
      return
    }
    if (busy) {
      if (chatId) queueFollowUp(chatId, text || 'See pasted text attachment.', goalBacked)
      if (goalBacked) setComposerMode('chat')
      return
    }
    if (!chatId) return
    setError('')
    setComposerInput('')
    requestLogScrollToBottom(chatId)
    if (goalBacked) setComposerMode('chat')
    const files = attachments
    setAttachments([])
    setPastedAttachments([])
    void sendTextToChat(chatId, text, files, pasted, goalBacked)
  }

  function interruptTurn() {
    const chatId = activeRef.current.chatId || activeChatId
    const targetSession = chatId ? (runtimesRef.current[chatId]?.sessionId || sidRef.current) : sidRef.current
    if (!targetSession) return
    if (!PREVIEW) void window.y.engine.cancel(targetSession)
    if (chatId) {
      const runtime = runtimesRef.current[chatId]
      const durationMs = runtime?.startedAt ? Date.now() - runtime.startedAt : undefined
      if (runtime?.goalBacked) clearGoalAfterTurn(chatId, targetSession)
      flushStreamBuffer(chatId, true)
      flushThinkingBuffer(chatId)
      updateChatMessages(chatId, (messages) => finalizeInterruptedTurn(messages, durationMs))
      trackEvent('chat_interrupted', { chatId, durationMs })
        setRuntime(chatId, { busy: false, startedAt: undefined, status: 'Interrupted.', error: '', goalBacked: false })
      const { project } = getChatById(chatId)
      void window.y.app.checkpoint(project?.id).then((checkpoint) => {
        if (!checkpoint.ok || !checkpoint.checkpointId) return
        updateChatMessages(chatId, (list) => finalizeInterruptedTurn(list, durationMs, checkpoint.checkpointId))
      })
    }
    else {
      setBusy(false)
      setStatus('Interrupted.')
      setError('')
    }
  }

  function submitOrInterrupt() {
    if (busy) {
      if (composerValue().trim()) send()
      else interruptTurn()
      return
    }
    send()
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(function () { setToast('') }, 2200)
  }

  async function signInFromSettings() {
    if (accountBusy) return
    setAccountBusy(true)
    trackEvent('settings_sign_in_started')
    try {
      const res = await window.y.auth.signIn()
      if (!res.ok) {
        trackEvent('settings_sign_in_failed')
        showToast(res.error || 'Could not sign in.')
        return
      }
      setAccountUser(res.user ?? null)
      trackEvent('settings_sign_in_completed')
      showToast('Signed in.')
      window.location.reload()
    } catch (err) {
      trackEvent('settings_sign_in_failed')
      showToast(getErrorMessage(err) || 'Could not sign in.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function signOutFromSettings() {
    if (accountBusy) return
    setAccountBusy(true)
    try {
      const res = await window.y.auth.clear()
      if (!res.ok) {
        trackEvent('settings_sign_out_failed')
        showToast(res.error || 'Could not sign out.')
        return
      }
      setAccountUser(null)
      trackEvent('settings_sign_out_completed')
      trackEvent('auth_signed_out', { source: 'settings' })
      window.location.reload()
    } catch {
      setAccountBusy(false)
      trackEvent('settings_sign_out_failed')
      showToast('Could not sign out.')
    }
  }

  async function submitFeedback() {
    const message = feedbackMessage.trim()
    if (!message || feedbackSending) return
    setFeedbackSending(true)
    try {
      const res = await window.y.feedback.submit({
        message,
        category: 'in-app',
        context: {
          activeProjectId,
          activeChatId,
          settingsOpen,
          onboardingDone
        }
      })
      if (!res.ok) {
        showToast(res.error || 'Could not send feedback.')
        return
      }
      trackEvent('feedback_dialog_sent', { stored: res.stored })
      setFeedbackMessage('')
      setFeedbackOpen(false)
      showToast(res.stored === 'remote' ? 'Feedback sent.' : 'Feedback saved locally.')
    } catch {
      showToast('Could not send feedback.')
    } finally {
      setFeedbackSending(false)
    }
  }

  function handleNav(id: string) {
    if (id === 'new') {
      newChat()
      return
    }
    if (id === 'search') {
      setSearchOpen(function (o) { return !o })
      setSettingsOpen(false)
      return
    }
    if (id === 'open') {
      void openProject()
    }
  }

  async function openProject() {
    const res = await window.y.app.addProject()
    if (!res.ok) {
      if (!res.canceled) showToast(res.error || 'Could not open folder.')
      return
    }
    if (res.state) {
      applyState(res.state)
      const project = findActiveProject(res.state.projects, res.state.activeProjectId)
      const chat = findActiveChat(project, res.state.activeChatId)
      start(chatEngine(chat), chatModel(chat, chatEngine(chat)), chatOptions(chat), project?.path, chat?.id)
    }
  }

	  async function attachFiles() {
	    const project = findActiveProject(projects, activeProjectId)
	    if (!project) {
	      showToast('Open a folder first.')
	      return
    }
    const res = await window.y.app.selectFiles(project.id)
    if (!res.ok) {
      if (!res.canceled) showToast(res.error || 'Could not attach files.')
      return
    }
    addAttachments(res.files)
	  }

	  function addAttachments(files: SelectedFile[]) {
	    if (!files.length) return
	    const seen = new Set(attachments.map((file) => file.path))
	    const next = attachments.slice()
	    let skippedLarge = 0
	    let skippedLimit = 0
	    let skippedDuplicate = 0
	    for (const file of files) {
	      if (seen.has(file.path)) {
	        skippedDuplicate += 1
	        continue
	      }
	      if (typeof file.size === 'number' && file.size > MAX_FILE_ATTACHMENT_BYTES) {
	        skippedLarge += 1
	        continue
	      }
	      if (next.length >= MAX_FILE_ATTACHMENTS) {
	        skippedLimit += 1
	        continue
	      }
	      seen.add(file.path)
	      next.push(file)
	    }
	    if (next.length !== attachments.length) setAttachments(next)
	    if (skippedLimit > 0) showToast(`You can attach up to ${MAX_FILE_ATTACHMENTS} files.`)
	    else if (skippedLarge > 0) showToast('Some files were too large to attach.')
	    else if (skippedDuplicate > 0 && next.length === attachments.length) showToast('Those files are already attached.')
	  }

	  function droppedSelectedFiles(fileList: FileList): SelectedFile[] {
	    const out: SelectedFile[] = []
	    for (const file of Array.from(fileList)) {
	      const path = (file as File & { path?: string }).path || file.webkitRelativePath || file.name
	      if (!path) continue
	      out.push({ name: file.name || path.split(/[\\/]/).pop() || path, path, relPath: file.name || undefined, size: file.size })
	    }
	    return out
	  }

	  function handleChatDrag(event: DragEvent<HTMLDivElement>) {
	    if (!event.dataTransfer?.types.includes('Files')) return
	    event.preventDefault()
	    event.stopPropagation()
	    if (!dragActive) setDragActive(true)
	  }

	  function handleChatDragLeave(event: DragEvent<HTMLDivElement>) {
	    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
	    setDragActive(false)
	  }

	  function handleChatDrop(event: DragEvent<HTMLDivElement>) {
	    if (!event.dataTransfer?.types.includes('Files')) return
	    event.preventDefault()
	    event.stopPropagation()
	    setDragActive(false)
	    if (!activeProjectId) {
	      showToast('Open a folder first.')
	      return
	    }
	    const files = droppedSelectedFiles(event.dataTransfer.files)
	    if (!files.length) {
	      showToast('No files found in drop.')
	      return
	    }
	    addAttachments(files)
	  }

	  async function loadProjectDirectory(projectId: string, directory = '', force = false, workspaceRoot = activeWorkspacePath) {
    const key = directory.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
    const requestKey = `${projectId}:${workspaceRoot || ''}:${key}`
    if (!force && Object.prototype.hasOwnProperty.call(projectDirectoriesRef.current, key)) return
    if (loadingFoldersRef.current.has(requestKey)) {
      if (force) pendingFolderRefreshRef.current.add(requestKey)
      return
    }
    loadingFoldersRef.current.add(requestKey)
    setLoadingFolders(new Set(loadingFoldersRef.current))
    const res = await window.y.app.listDirectory(projectId, key, workspaceRoot)
    loadingFoldersRef.current.delete(requestKey)
    setLoadingFolders(new Set(loadingFoldersRef.current))
    const queuedRefresh = pendingFolderRefreshRef.current.delete(requestKey)
    if (activeRef.current.projectId !== projectId || activeRef.current.path !== workspaceRoot) return
    if (res.ok) {
      setProjectDirectories(function (current) {
        const next = { ...current, [key]: res.entries }
        projectDirectoriesRef.current = next
        return next
      })
    } else if (key) {
      setProjectDirectories(function (current) {
        const next = { ...current }
        delete next[key]
        projectDirectoriesRef.current = next
        return next
      })
    }
    if (queuedRefresh) {
      void loadProjectDirectory(projectId, key, true, workspaceRoot)
    }
  }

  async function resolveFileCandidate(file: SelectedFile): Promise<SelectedFile> {
    const project = findActiveProject(projectsRef.current, activeProjectId)
    if (!project) return file
    const rawPath = (file.path || file.relPath || file.name).replace(/\\/g, '/')
    const projectRoot = (activeWorkspacePath || project.path).replace(/\\/g, '/').replace(/\/$/u, '')
    const relFromRoot = rawPath.startsWith(`${projectRoot}/`) ? rawPath.slice(projectRoot.length + 1) : rawPath.replace(/^\.?\//u, '')
    const wanted = [file.relPath, relFromRoot, rawPath, file.name]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\\/g, '/').replace(/^\.?\//u, ''))
    const query = file.name || rawPath.split('/').filter(Boolean).pop() || ''
    if (!query) return file
    const result = await window.y.app.searchFiles(project.id, query, activeWorkspacePath)
    if (!result.ok || !result.files.length) return file
    const exact = result.files.find((candidate) => {
      const rel = (candidate.relPath || candidate.path).replace(/\\/g, '/')
      return wanted.some((value) => rel === value || rel.endsWith(`/${value}`) || candidate.path.replace(/\\/g, '/') === value)
    })
    const sameName = result.files.find((candidate) => candidate.name === file.name)
    return exact || sameName || file
  }

  async function openFile(file: SelectedFile) {
    setSettingsOpen(false)
    setActiveFile(file)
    setActiveFileDiff('')
    setActiveFileOldContent('')
    setFileRailOpen(true)
    setFileStatus('Opening...')
    let currentFile = file
    let res = await window.y.app.readProjectFile(activeProjectId, currentFile.path || currentFile.relPath || currentFile.name, activeWorkspacePath)
    if (!res.ok) {
      const candidate = await resolveFileCandidate(file)
      if (candidate.path !== file.path || candidate.relPath !== file.relPath) {
        currentFile = candidate
        res = await window.y.app.readProjectFile(activeProjectId, candidate.path || candidate.relPath || candidate.name, activeWorkspacePath)
      }
    }
    if (!res.ok) {
      setFileContent('')
      setSavedFileContent('')
      setFileStatus(res.error || 'Could not open file.')
      return
    }
    if (res.path) {
      const normalizedPath = res.path.replace(/\\/g, '/')
      const normalizedRel = res.relPath?.replace(/\\/g, '/')
      const normalizedName = (normalizedRel || normalizedPath).split('/').filter(Boolean).pop() || currentFile.name
      setActiveFile({ ...currentFile, name: normalizedName, path: normalizedPath, relPath: normalizedRel || currentFile.relPath })
    } else if (currentFile !== file) {
      setActiveFile(currentFile)
    }
    const content = res.content ?? ''
    setFileContent(content)
    setSavedFileContent(content)
    setFileMode('preview')
    setFileStatus('')
  }

  async function openEditedFileTarget(target: string, diff: string, oldContent?: string) {
    const project = findActiveProject(projects, activeProjectId)
    if (!project) {
      setToast('Open a project folder first.')
      return
    }
    const normalized = target.replace(/\\/g, '/')
    const path = normalized.startsWith('/') ? normalized : normalized.replace(/^\.?\//u, '')
    const name = normalized.split('/').filter(Boolean).pop() || 'file'
    await openFile({ name, path, relPath: normalized.startsWith('/') ? undefined : path })
    setActiveFileDiff(diff)
    setActiveFileOldContent(oldContent || '')
    setFileMode(diff ? 'diff' : 'preview')
    trackEvent('chat_file_diff_opened', { projectId: project.id, hasDiff: Boolean(diff), fileExtension: name.split('.').pop() || '' })
  }

  function assistantLinkFileTarget(href: string, label: string): string | null {
    const raw = (href || label || '').trim()
    if (!raw || raw.startsWith('#')) return null
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('file:')) return null
    let value = raw
    if (value.startsWith('file://')) {
      try {
        value = new URL(value).pathname
      } catch {
        value = value.replace(/^file:\/\//i, '')
      }
    }
    try {
      value = decodeURIComponent(value)
    } catch {}
    value = value
      .replace(/\\/g, '/')
      .replace(/[?#].*$/u, '')
      .replace(/:(\d+)(?::\d+)?$/u, '')
      .trim()
    if (!value || value.endsWith('/')) return null
    if (value.includes('://')) return null
    if (!value.startsWith('/') && !/^[\w@.+-]+(?:\/[\w@.+ -]+)+$/u.test(value)) return null
    return value
  }

  function openAssistantFileLink(href: string, label: string): boolean {
    const target = assistantLinkFileTarget(href, label)
    if (!target) return false
    void openEditedFileTarget(target, '')
    return true
  }

  async function saveActiveFile() {
    if (!activeFile) return
    setFileStatus('Saving...')
    const res = await window.y.app.writeProjectFile(activeProjectId, activeFile.path, fileContent, activeWorkspacePath)
    if (!res.ok) {
      setFileStatus(res.error || 'Could not save file.')
      return
    }
    if (res.path) {
      setActiveFile((file) => file ? { ...file, path: res.path!, relPath: res.relPath || file.relPath } : file)
    }
    setSavedFileContent(fileContent)
    setFileStatus('Saved')
    const relPath = (activeFile.relPath || activeFile.name).replace(/\\/g, '/')
    const slash = relPath.lastIndexOf('/')
    void loadProjectDirectory(activeProjectId!, slash === -1 ? '' : relPath.slice(0, slash), true, activeWorkspacePath)
    setTimeout(() => setFileStatus((status) => (status === 'Saved' ? '' : status)), 1400)
  }

  function closeFileView() {
    setActiveFile(null)
    setFileContent('')
    setSavedFileContent('')
    setActiveFileDiff('')
    setActiveFileOldContent('')
    setFileStatus('')
  }

  function selectChat(projectId: string, chatId: string) {
    const project = projects.find((p) => p.id === projectId)
    const chat = project?.chats.find((c) => c.id === chatId)
    if (!project || !chat || chat.archived) return
    setOpenProjectMenuId(null)
    setSettingsOpen(false)
    closeFileView()
    applyActiveChat(project, chat)
    skipPersistRef.current = true
    if (!runtimesRef.current[chat.id]?.sessionId) {
      start(chatEngine(chat), chatModel(chat, chatEngine(chat)), chatOptions(chat), project.path, chat.id)
    }
    if (!PREVIEW) void window.y.app.setActive(project.id, chat.id)
  }

  const filteredProjects = projects
    .map(function (p) {
      const visibleChats = p.chats.filter((c) => !c.archived)
      if (!searchQuery.trim()) return { ...p, chats: visibleChats }
      const q = searchQuery.toLowerCase()
      if (p.name.toLowerCase().includes(q)) return { ...p, chats: visibleChats }
      const chats = visibleChats.filter(function (c) { return c.title.toLowerCase().includes(q) })
      if (chats.length) return { ...p, open: true, chats: chats }
      return null
    })
    .filter(Boolean) as Project[]

  function beginRenameChat(projectId: string, chat: AppChat) {
    setRenamingChat({ projectId, chatId: chat.id, title: chat.title })
  }

  function submitRenameChat() {
    if (!renamingChat) return
    const title = renamingChat.title.trim() || 'New chat'
    patchChatMeta(renamingChat.projectId, renamingChat.chatId, { title })
    setRenamingChat(null)
  }

  function cancelRenameChat() {
    setRenamingChat(null)
  }

  async function archiveChat(projectId: string, chatId: string) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    const visible = project.chats.filter((c) => !c.archived)
    const nextChat = visible.find((c) => c.id !== chatId)
    const current = runtimesRef.current[chatId]?.sessionId
    if (activeRef.current.chatId === chatId && current && !PREVIEW) void window.y.engine.cancel(current)
    patchChatMeta(projectId, chatId, { archived: true })
    setRenamingChat((draft) => (draft?.chatId === chatId ? null : draft))
    if (activeRef.current.chatId !== chatId) return
    if (nextChat) {
      selectChat(projectId, nextChat.id)
      return
    }
    await newChat()
  }

  async function removeProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    setOpenProjectMenuId(null)
    setExpandedChatProjects((expanded) => {
      const next = { ...expanded }
      delete next[projectId]
      return next
    })
    setRenamingChat((draft) => (draft?.projectId === projectId ? null : draft))
    for (const chat of project.chats) {
      const session = runtimesRef.current[chat.id]?.sessionId
      if (session && !PREVIEW) void window.y.engine.cancel(session)
      if (session) delete sessionToChatRef.current[session]
      delete runtimesRef.current[chat.id]
    }
    if (activeProjectId === projectId) closeFileView()
    const res = await window.y.app.removeProject(projectId)
    if (!res.ok || !res.state) {
      showToast(res.error || 'Could not remove folder.')
      return
    }
    applyState(res.state)
    showToast('Folder removed from y.')
  }

  async function createChatInProject(projectId: string, isolate = false) {
    const res = await window.y.app.createChat(projectId, { isolate })
    if (!res.ok || !res.state) {
      showToast(res.error || 'Could not create chat.')
      return
    }
    applyState(res.state)
    const nextProject = findActiveProject(res.state.projects, res.state.activeProjectId)
    const nextChat = findActiveChat(nextProject, res.state.activeChatId)
    start(chatEngine(nextChat), chatModel(nextChat, chatEngine(nextChat)), chatOptions(nextChat), nextProject?.path, nextChat?.id)
  }

  async function newChat(projectId = activeProjectId) {
    setSettingsOpen(false)
    setOpenProjectMenuId(null)
    const project = projects.find((p) => p.id === projectId) ?? findActiveProject(projects, activeProjectId)
    if (!project) {
      showToast('Open a folder first.')
      return
    }

    if (project.chats.length > 0) {
      const status = await window.y.app.getIsolationStatus(project.id)
      if (!status.ok) {
        showToast(status.error || 'Could not check workspace isolation.')
        return
      }
      if (status.canIsolate) {
        setIsolationChoice({ projectId: project.id, projectName: project.name })
        return
      }
    }

    await createChatInProject(project.id, false)
  }

  async function chooseIsolation(isolate: boolean) {
    const choice = isolationChoice
    setIsolationChoice(null)
    if (!choice) return
    await createChatInProject(choice.projectId, isolate)
  }

  function cancelIsolationChoice() {
    setIsolationChoice(null)
  }

  function onIsolationKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    cancelIsolationChoice()
  }

  async function newChatFromProject(projectId: string) {
    await newChat(projectId)
  }

  function toggleProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    setOpenProjectMenuId(null)
    const nextOpen = !project.open
    setProjects((list) => list.map((p) => (p.id === projectId ? { ...p, open: nextOpen } : p)))
    if (!PREVIEW) void window.y.app.setProjectOpen(projectId, nextOpen)
  }

  function toggleChatList(projectId: string) {
    setExpandedChatProjects((expanded) => ({ ...expanded, [projectId]: !expanded[projectId] }))
  }

  const empty = messages.length === 0 && !error
  const runtimeVersion = _runtimeTick
  const pickerCatalog: EngineModelCatalog[] =
    catalog.length > 0
      ? catalog
      : engines.map(function (id) {
          return {
            engine: id,
            label: LABELS[id] || id,
            defaultModel: modelId,
            models: [{ id: modelId, label: modelId }]
          }
        })

  const hasProject = Boolean(activeProjectId && activeChatId)
  const slashReady = input.trim().startsWith('/')
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
  const activeRuntime = activeChatId ? runtimesRef.current[activeChatId] : undefined
  const activeGoalRunning = Boolean(activeRuntime?.busy && activeRuntime?.goalBacked)
  const liveStartedAt = activeRuntime?.startedAt
  const liveDurationMs = busy && liveStartedAt ? Math.max(0, elapsedTick - liveStartedAt) : 0
  const liveWorkLabel = status && isCompactionStatus(status)
    ? status
    : `Working for ${formatLiveDuration(liveDurationMs)}`
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;1,400&display=swap');
        .y-app {
          --y-bg: #09090a;
          --y-sidebar: rgba(28, 29, 32, 0.16);
          --y-main: #0a0a0b;
          --y-surface: rgba(255, 255, 255, 0.045);
          --y-border: rgba(255, 255, 255, 0.08);
          --y-border-strong: rgba(255, 255, 255, 0.12);
          --y-text: rgba(255, 255, 255, 0.92);
          --y-text-2: rgba(255, 255, 255, 0.58);
          --y-text-3: rgba(255, 255, 255, 0.36);
          --y-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          --y-code-size: 13px;
          --y-code-line: 1.65;
          --y-code-color: #e4e4e4;
          --y-code-bg: #111214;
          --y-font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          flex: 1;
          min-height: 0;
          position: relative;
          background: transparent;
          color: var(--y-text);
          font-family: var(--y-font);
          font-size: 14px;
          line-height: 1.45;
          -webkit-font-smoothing: antialiased;
          --y-toggle-x: 10px;
        }
        .y-app button:focus,
        .y-app button:focus-visible {
          outline: none;
          box-shadow: none;
        }
        .y-app button::-moz-focus-inner {
          border: 0;
        }
        html.platform-darwin .y-app {
          --y-toggle-x: 79px;
        }
        html.platform-darwin.is-fullscreen .y-app {
          --y-toggle-x: 10px;
        }
        .y-sidebar {
          width: var(--y-sidebar-width, 252px);
          flex-shrink: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: rgba(28, 29, 32, var(--y-sidebar-tint, 0.16));
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          border-right: 1px solid rgba(255, 255, 255, 0.09);
          position: relative;
          transition: width 0.26s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.26s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .y-sidebar.is-collapsed {
          width: 0;
          border-right-color: transparent;
        }
        .y-sidebar-inner {
          width: var(--y-sidebar-width, 252px);
          min-width: var(--y-sidebar-width, 252px);
          height: 100%;
          display: flex;
          flex-direction: column;
          padding: 0 0 12px;
          opacity: 1;
          transition: opacity 0.18s ease;
        }
        .y-sidebar.is-collapsed .y-sidebar-inner {
          opacity: 0;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .y-sidebar, .y-sidebar-inner { transition: none; }
        }
        .y-sidebar-toggle-fixed {
          position: absolute;
          top: 0;
          left: 0;
          z-index: 25;
          pointer-events: none;
        }
        .y-sidebar-top {
          display: flex;
          height: 44px;
          flex-shrink: 0;
        }
        .y-sidebar-top-spacer {
          width: calc(var(--y-toggle-x) + 28px);
          flex-shrink: 0;
          height: 44px;
          -webkit-app-region: drag;
        }
        .y-sidebar-chrome {
          flex: 1;
          min-width: 0;
          height: 44px;
          -webkit-app-region: drag;
        }
        .y-sidebar-toggle-slot {
          flex-shrink: 0;
          display: flex;
          align-items: flex-start;
          height: 44px;
          padding-left: var(--y-toggle-x);
          padding-top: 12px;
          gap: 8px;
          -webkit-app-region: no-drag;
          pointer-events: none;
        }
        .y-sidebar-toggle,
        .y-toolbar-btn {
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--y-text-2);
          cursor: pointer;
          display: grid;
          place-items: center;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
          padding: 0;
          line-height: 0;
          pointer-events: auto;
        }
        .y-sidebar-toggle svg,
        .y-toolbar-btn svg { width: 16px; height: 16px; display: block; }
        .y-sidebar-toggle:hover,
        .y-toolbar-btn:hover { background: rgba(255,255,255,0.06); color: var(--y-text); }
        .y-nav { padding: 2px 10px 0; display: flex; flex-direction: column; gap: 2px; }
        .y-nav-btn {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 10px; border-radius: 9px; border: none;
          background: transparent; color: var(--y-text-2); font: inherit; font-size: 13px;
          cursor: pointer; text-align: left; transition: background 0.12s, color 0.12s;
        }
        .y-nav-btn:hover { background: rgba(255,255,255,0.05); color: var(--y-text); }
        .y-nav-btn.active { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-nav-search {
          display: flex; align-items: center; gap: 10px; padding: 8px 10px;
          border-radius: 9px; background: rgba(255,255,255,0.07); color: var(--y-text);
        }
        .y-nav-search .y-search {
          flex: 1; min-width: 0; padding: 0; border: none; border-radius: 0;
          background: transparent; color: var(--y-text); font: inherit; font-size: 13px;
          outline: none;
        }
        .y-nav-search .y-search::placeholder { color: var(--y-text-3); }
        .y-nav-icon {
          width: 18px; height: 18px; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          opacity: 0.72;
        }
        .y-nav-icon svg { width: 16px; height: 16px; display: block; }
        .y-projects { flex: 1; min-height: 0; overflow: auto; padding: 14px 10px 8px; }
        .y-section-label {
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--y-text-3); padding: 0 10px 10px;
        }
        .y-project { margin-bottom: 10px; position: relative; }
        .y-empty-projects {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 8px 10px; border: 1px dashed rgba(255,255,255,0.12);
          border-radius: 9px; background: rgba(255,255,255,0.025);
          color: var(--y-text-2); font: inherit; font-size: 12.5px; cursor: pointer;
        }
        .y-empty-projects:hover { background: rgba(255,255,255,0.045); color: var(--y-text); }
        .y-project-head {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 6px 10px; border: none; border-radius: 8px; background: transparent;
          color: var(--y-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left;
        }
        .y-project-head:hover { background: rgba(255,255,255,0.04); }
        .y-project-new-chat {
          width: 22px; height: 22px; flex: 0 0 22px; margin-left: auto; border-radius: 7px;
          background: transparent; color: var(--y-text-3); display: flex; align-items: center; justify-content: center;
          cursor: pointer; opacity: 0; transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
        }
        .y-project-head:hover .y-project-new-chat, .y-project-new-chat:focus-visible {
          opacity: 1;
        }
        .y-project-new-chat:hover, .y-project-new-chat:focus-visible {
          background: rgba(255,255,255,0.055); color: var(--y-text);
        }
        .y-project-more {
          width: 22px; height: 22px; flex: 0 0 22px; margin-left: auto; border-radius: 7px;
          background: transparent; color: var(--y-text-3); display: flex; align-items: center; justify-content: center;
          cursor: pointer; opacity: 0; transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
        }
        .y-project-head:hover .y-project-more, .y-project-more:focus-visible, .y-project-more.is-open {
          opacity: 1;
        }
        .y-project-more:hover, .y-project-more:focus-visible, .y-project-more.is-open {
          background: rgba(255,255,255,0.055); color: var(--y-text);
        }
        .y-project-more + .y-project-new-chat { margin-left: 0; }
        .y-project-menu {
          position: absolute; right: 28px; top: 30px; z-index: 25; min-width: 132px; padding: 5px;
          border: 1px solid var(--y-border-strong); border-radius: 9px;
          background: rgba(18,18,20,0.98); box-shadow: 0 12px 36px rgba(0,0,0,0.36);
        }
        .y-project-menu-item {
          width: 100%; height: 28px; padding: 0 8px; border: none; border-radius: 7px;
          background: transparent; color: var(--y-text-2); display: flex; align-items: center; justify-content: space-between;
          font: inherit; font-size: 12px; cursor: pointer; text-align: left;
        }
        .y-project-menu-item:hover, .y-project-menu-item:focus-visible {
          background: rgba(255,255,255,0.06); color: var(--y-text);
        }
        .y-project-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-project-icon { opacity: 0.72; display: flex; align-items: center; }
        .y-chevron {
          display: flex; align-items: center; flex-shrink: 0;
          opacity: 0; transition: opacity 0.12s ease, transform 0.15s ease;
        }
        .y-project-head:hover .y-chevron { opacity: 0.45; }
        .y-project.is-closed .y-chevron { transform: rotate(-90deg); }
        .y-chat-list {
          margin: 2px 16px 0 14px; padding-left: 0;
        }
        .y-chat-list-toggle {
          width: 100%; height: 26px; margin: 2px 0 4px; padding: 0 8px;
          border: none; border-radius: 7px; background: transparent; color: var(--y-text-3);
          display: flex; align-items: center; justify-content: flex-start;
          font: inherit; font-size: 11.5px; cursor: pointer;
        }
        .y-chat-list-toggle:hover, .y-chat-list-toggle:focus-visible {
          background: rgba(255,255,255,0.045); color: var(--y-text-2); outline: none;
        }
        .y-chat-item {
          margin-left: 0; padding: 5px 12px 5px 8px; border-radius: 7px; font-size: 12.5px;
          color: var(--y-text-2); cursor: pointer; border: none; background: transparent;
          font: inherit; text-align: left; width: 100%; display: flex; align-items: center; gap: 7px;
        }
        .y-chat-item:focus-visible {
          outline: 1px solid rgba(222,190,156,0.42); outline-offset: 1px;
        }
        .y-chat-item:hover { background: rgba(255,255,255,0.04); color: var(--y-text); }
        .y-chat-item.active { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-chat-title {
          flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .y-chat-isolated-icon {
          flex: 0 0 16px; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;
          color: rgba(255,255,255,0.9);
        }
        .y-chat-rename {
          flex: 1; min-width: 0; height: 22px; padding: 0 5px; border-radius: 6px;
          border: 1px solid rgba(222,190,156,0.26); background: rgba(0,0,0,0.22);
          color: var(--y-text); font: inherit; font-size: 12.5px; outline: none;
        }
        .y-chat-right {
          margin-left: auto; flex: 0 0 42px; width: 42px; min-width: 42px; position: relative;
          display: inline-flex; align-items: center; justify-content: flex-end; align-self: center; height: 22px;
        }
        .y-chat-meta { font-size: 11px; color: var(--y-text-3); transition: opacity 0.12s ease; white-space: nowrap; line-height: 22px; height: 22px; display: block; }
        .y-chat-actions {
          position: absolute; right: 0; top: 0; height: 22px;
          display: inline-flex; align-items: center; justify-content: center; gap: 2px;
          opacity: 0; transition: opacity 0.12s ease;
        }
        .y-chat-item:hover .y-chat-actions,
        .y-chat-item:focus-within .y-chat-actions { opacity: 1; }
        .y-chat-item:hover .y-chat-meta,
        .y-chat-item:focus-within .y-chat-meta { opacity: 0; }
        .y-chat-action {
          width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
          border: none; border-radius: 6px; background: transparent; color: var(--y-text-3);
          cursor: pointer; padding: 0;
        }
        .y-chat-action svg { display: block; }
        .y-chat-action:hover { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-chat-indicator {
          width: 10px; height: 10px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
        }
        .y-chat-indicator.is-idle { opacity: 0; }
        .y-chat-done {
          width: 8px; height: 8px; border-radius: 50%; background: #6f9fd8;
        }
        .y-chat-spinner {
          width: 7px; height: 7px; border-radius: 50%;
          background: rgba(247,247,244,0.82);
          box-shadow: 0 0 0 0 rgba(247,247,244,0.22);
          animation: y-status-pulse 1.15s ease-in-out infinite;
        }
        @keyframes y-status-pulse {
          0%, 100% { opacity: 0.46; transform: scale(0.86); box-shadow: 0 0 0 0 rgba(247,247,244,0.14); }
          50% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 4px rgba(247,247,244,0.05); }
        }
        .y-sidebar-foot {
          padding: 8px 10px 0; border-top: 1px solid var(--y-border); margin-top: auto;
          display: flex; align-items: center; gap: 6px;
        }
        .y-sidebar-foot .y-nav-btn { flex: 1; min-width: 0; }
        .y-feedback-btn {
          width: 34px; height: 34px; flex: 0 0 34px; margin-left: auto; border-radius: 9px; border: none;
          background: transparent; color: var(--y-text-2); display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background 0.12s, color 0.12s;
        }
        .y-feedback-btn:hover, .y-feedback-btn.active { background: rgba(255,255,255,0.05); color: var(--y-text); }
	        .y-main {
	          flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column;
	          background: var(--y-main); position: relative; overflow: hidden;
	          transition: flex 0.26s cubic-bezier(0.4, 0, 0.2, 1);
	        }
        .y-header {
          flex-shrink: 0; height: 44px; display: flex; align-items: stretch;
          padding: 0 14px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          -webkit-app-region: drag;
        }
        .y-header-lead {
          width: 0;
          flex-shrink: 0;
          -webkit-app-region: drag;
        }
        .y-app.sidebar-closed .y-header-lead { width: calc(var(--y-toggle-x) + 28px); }
        .y-header-drag {
          flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
          -webkit-app-region: drag;
        }
        .y-header button, .y-header .y-modify-btn { -webkit-app-region: no-drag; }
        .y-icon-btn {
          width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--y-border);
          background: transparent; color: var(--y-text-2); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
	        .y-icon-btn:hover { background: rgba(255,255,255,0.04); color: var(--y-text); }
	        .y-icon-btn.active {
	          background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); color: var(--y-text);
	        }
        .y-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transform: translateY(3px); }
        .y-header-actions { display: flex; flex-shrink: 0; gap: 6px; align-items: center; }
        .y-modify-btn {
          display: inline-flex; align-items: center; gap: 6px;
          height: 32px; padding: 0 12px; border-radius: 8px;
          border: 1px solid var(--y-border); background: transparent;
          color: var(--y-text-2); font: inherit; font-size: 12px; font-weight: 500;
          cursor: pointer;
        }
        .y-modify-btn:hover { background: rgba(255,255,255,0.04); color: var(--y-text); }
        .y-modify-btn.active {
          background: rgba(200, 130, 60, 0.12); border-color: rgba(200, 140, 70, 0.22);
          color: rgba(240, 190, 120, 0.95);
        }
        .y-file-rail {
          flex-shrink: 0;
          width: var(--y-file-rail-width, 326px);
          border-left: 1px solid rgba(255,255,255,0.07);
          background: #09090a;
          display: flex; flex-direction: column; min-height: 0;
          overflow: hidden;
          position: relative;
          transition: width 0.26s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.26s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .y-file-rail:not(.is-open) { width: 0; min-width: 0; border-left-width: 0; pointer-events: none; }
        .y-file-rail:not(.is-open) .y-resize-handle { display: none; }
        @media (prefers-reduced-motion: reduce) { .y-file-rail { transition: none; } }
        .y-file-rail-head {
          height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px 0 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
          background: #09090a;
        }
        .y-file-rail-title { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
        .y-file-rail-list { flex: 1; min-height: 0; overflow: auto; padding: 10px 8px; }
        .y-file-row {
          display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px;
          border: none; border-radius: 8px; background: transparent; color: #ffffff;
          -webkit-font-smoothing: antialiased;
          font: inherit; text-align: left; cursor: pointer; outline: none;
        }
        .y-file-row:hover { background: rgba(255,255,255,0.05); color: var(--y-text); }
        .y-file-row.active { background: rgba(255,255,255,0.075); color: var(--y-text); }
        .y-file-row-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .y-file-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
        .y-file-row-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--y-text-3); font-size: 11px; }
        .y-file-folder { color: var(--y-text-2); }
        .y-file-folder-chevron { margin-left: auto; color: var(--y-text-3); display: flex; align-items: center; transition: transform 0.15s ease; }
        .y-file-rail-list::-webkit-scrollbar { width: 5px; }
        .y-file-rail-list::-webkit-scrollbar-track { background: transparent; }
        .y-file-rail-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
        .y-file-rail-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
        .y-file-empty { padding: 18px 12px; color: var(--y-text-3); font-size: 12.5px; line-height: 1.5; }
        .y-file-view {
          flex: 1; min-height: 0; display: flex; flex-direction: column;
        }
        .y-file-toolbar {
          height: 44px; flex-shrink: 0; display: flex; align-items: center; gap: 8px;
          padding: 0 12px; border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .y-file-name {
          min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-family: var(--y-mono); font-size: 13px; color: var(--y-text);
        }
        .y-file-spacer { flex: 1; min-width: 12px; }
        .y-file-status { color: var(--y-text-3); font-size: 12px; white-space: nowrap; }
        .y-segment {
          display: inline-flex; align-items: center; padding: 3px; border-radius: 10px;
          background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.06);
        }
        .y-segment button {
          height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent;
          color: var(--y-text-2); font: inherit; font-size: 12px; cursor: pointer;
        }
        .y-segment button.active { background: rgba(255,255,255,0.08); color: var(--y-text); }
        .y-file-action {
          height: 30px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--y-border);
          background: transparent; color: var(--y-text-2); font: inherit; font-size: 12px; cursor: pointer;
        }
        .y-file-action:hover:not(:disabled) { background: rgba(255,255,255,0.055); color: var(--y-text); }
        .y-file-action:disabled { opacity: 0.42; cursor: default; }
        .y-file-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
        .y-file-code-pre {
          flex: 1; margin: 0; padding: 22px 26px 40px; overflow: auto;
          font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line); tab-size: 2;
          color: var(--y-code-color); white-space: pre; background: var(--y-code-bg);
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .y-file-code-pre::-webkit-scrollbar { width: 5px; height: 5px; }
        .y-file-code-pre::-webkit-scrollbar-track { background: transparent; }
        .y-file-code-pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .y-file-code-pre::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .y-file-code-pre code { background: none; padding: 0; font-size: inherit; font-weight: 400; font-family: inherit; color: inherit; border-radius: 0; }
        .y-file-code-pre .hljs-keyword, .y-file-editor-shell .hljs-keyword,
        .y-file-code-pre .hljs-operator, .y-file-editor-shell .hljs-operator,
        .y-file-code-pre .hljs-selector-tag, .y-file-editor-shell .hljs-selector-tag,
        .y-file-code-pre .hljs-tag, .y-file-editor-shell .hljs-tag,
        .y-file-code-pre .hljs-deletion, .y-file-editor-shell .hljs-deletion { color: #ff5370; }
        .y-file-code-pre .hljs-title, .y-file-editor-shell .hljs-title,
        .y-file-code-pre .hljs-title.class_, .y-file-editor-shell .hljs-title.class_,
        .y-file-code-pre .hljs-title.function_, .y-file-editor-shell .hljs-title.function_,
        .y-file-code-pre .hljs-section, .y-file-editor-shell .hljs-section { color: #c792ea; }
        .y-file-code-pre .hljs-built_in, .y-file-editor-shell .hljs-built_in,
        .y-file-code-pre .hljs-builtin-name, .y-file-editor-shell .hljs-builtin-name,
        .y-file-code-pre .hljs-attr, .y-file-editor-shell .hljs-attr,
        .y-file-code-pre .hljs-selector-class, .y-file-editor-shell .hljs-selector-class,
        .y-file-code-pre .hljs-selector-attr, .y-file-editor-shell .hljs-selector-attr,
        .y-file-code-pre .hljs-selector-pseudo, .y-file-editor-shell .hljs-selector-pseudo,
        .y-file-code-pre .hljs-attribute, .y-file-editor-shell .hljs-attribute,
        .y-file-code-pre .hljs-meta, .y-file-editor-shell .hljs-meta,
        .y-file-code-pre .hljs-link, .y-file-editor-shell .hljs-link { color: #82aaff; }
        .y-file-code-pre .hljs-string, .y-file-editor-shell .hljs-string,
        .y-file-code-pre .hljs-doctag, .y-file-editor-shell .hljs-doctag,
        .y-file-code-pre .hljs-addition, .y-file-editor-shell .hljs-addition,
        .y-file-code-pre .hljs-regexp, .y-file-editor-shell .hljs-regexp { color: #c3e88d; }
        .y-file-code-pre .hljs-number, .y-file-editor-shell .hljs-number,
        .y-file-code-pre .hljs-literal, .y-file-editor-shell .hljs-literal { color: #f78c6c; }
        .y-file-code-pre .hljs-type, .y-file-editor-shell .hljs-type,
        .y-file-code-pre .hljs-class .hljs-title, .y-file-editor-shell .hljs-class .hljs-title { color: #ffcb6b; }
        .y-file-code-pre .hljs-variable, .y-file-editor-shell .hljs-variable,
        .y-file-code-pre .hljs-template-variable, .y-file-editor-shell .hljs-template-variable,
        .y-file-code-pre .hljs-subst, .y-file-editor-shell .hljs-subst,
        .y-file-code-pre .hljs-symbol, .y-file-editor-shell .hljs-symbol,
        .y-file-code-pre .hljs-bullet, .y-file-editor-shell .hljs-bullet { color: #f07178; }
        .y-file-code-pre .hljs-comment, .y-file-editor-shell .hljs-comment,
        .y-file-code-pre .hljs-quote, .y-file-editor-shell .hljs-quote { color: #6b7280; font-style: italic; }
        .y-file-code-pre .hljs-emphasis, .y-file-editor-shell .hljs-emphasis { font-style: italic; }
        .y-file-code-pre .hljs-strong, .y-file-editor-shell .hljs-strong { font-weight: 600; }
        .y-file-diff-pre .hljs-keyword, .tool-activity-detail .hljs-keyword,
        .y-file-diff-pre .hljs-operator, .tool-activity-detail .hljs-operator,
        .y-file-diff-pre .hljs-selector-tag, .tool-activity-detail .hljs-selector-tag,
        .y-file-diff-pre .hljs-tag, .tool-activity-detail .hljs-tag,
        .y-file-diff-pre .hljs-deletion, .tool-activity-detail .hljs-deletion { color: #ff5370; }
        .y-file-diff-pre .hljs-title, .tool-activity-detail .hljs-title,
        .y-file-diff-pre .hljs-title.class_, .tool-activity-detail .hljs-title.class_,
        .y-file-diff-pre .hljs-title.function_, .tool-activity-detail .hljs-title.function_,
        .y-file-diff-pre .hljs-section, .tool-activity-detail .hljs-section { color: #c792ea; }
        .y-file-diff-pre .hljs-built_in, .tool-activity-detail .hljs-built_in,
        .y-file-diff-pre .hljs-builtin-name, .tool-activity-detail .hljs-builtin-name,
        .y-file-diff-pre .hljs-attr, .tool-activity-detail .hljs-attr,
        .y-file-diff-pre .hljs-selector-class, .tool-activity-detail .hljs-selector-class,
        .y-file-diff-pre .hljs-selector-attr, .tool-activity-detail .hljs-selector-attr,
        .y-file-diff-pre .hljs-selector-pseudo, .tool-activity-detail .hljs-selector-pseudo,
        .y-file-diff-pre .hljs-attribute, .tool-activity-detail .hljs-attribute,
        .y-file-diff-pre .hljs-meta, .tool-activity-detail .hljs-meta,
        .y-file-diff-pre .hljs-link, .tool-activity-detail .hljs-link { color: #82aaff; }
        .y-file-diff-pre .hljs-string, .tool-activity-detail .hljs-string,
        .y-file-diff-pre .hljs-doctag, .tool-activity-detail .hljs-doctag,
        .y-file-diff-pre .hljs-addition, .tool-activity-detail .hljs-addition,
        .y-file-diff-pre .hljs-regexp, .tool-activity-detail .hljs-regexp { color: #c3e88d; }
        .y-file-diff-pre .hljs-number, .tool-activity-detail .hljs-number,
        .y-file-diff-pre .hljs-literal, .tool-activity-detail .hljs-literal { color: #f78c6c; }
        .y-file-diff-pre .hljs-type, .tool-activity-detail .hljs-type,
        .y-file-diff-pre .hljs-class .hljs-title, .tool-activity-detail .hljs-class .hljs-title { color: #ffcb6b; }
        .y-file-diff-pre .hljs-variable, .tool-activity-detail .hljs-variable,
        .y-file-diff-pre .hljs-template-variable, .tool-activity-detail .hljs-template-variable,
        .y-file-diff-pre .hljs-subst, .tool-activity-detail .hljs-subst,
        .y-file-diff-pre .hljs-symbol, .tool-activity-detail .hljs-symbol,
        .y-file-diff-pre .hljs-bullet, .tool-activity-detail .hljs-bullet { color: #f07178; }
        .y-file-diff-pre .hljs-comment, .tool-activity-detail .hljs-comment,
        .y-file-diff-pre .hljs-quote, .tool-activity-detail .hljs-quote { color: #6b7280; font-style: italic; }
        .y-file-diff-pre .hljs-emphasis, .tool-activity-detail .hljs-emphasis { font-style: italic; }
        .y-file-diff-pre .hljs-strong, .tool-activity-detail .hljs-strong { font-weight: 600; }
        .y-file-diff-pre {
          flex: 1; margin: 0; padding: 0 0 36px; overflow: auto;
          font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line); tab-size: 2;
          color: var(--y-code-color); background: var(--y-code-bg);
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .y-file-diff-pre::-webkit-scrollbar { width: 5px; height: 5px; }
        .y-file-diff-pre::-webkit-scrollbar-track { background: transparent; }
        .y-file-diff-pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .y-file-diff-pre::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .y-file-editor {
          flex: 1; width: 100%; resize: none; border: none; outline: none;
          padding: 22px 26px 40px; background: transparent; color: rgba(245,245,245,0.9);
          font-family: var(--y-mono); font-size: 13px; line-height: 1.65; tab-size: 2;
        }
        .y-file-editor-shell {
          flex: 1; display: grid; overflow: auto; min-height: 0;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .y-file-editor-shell::-webkit-scrollbar { width: 5px; height: 5px; }
        .y-file-editor-shell::-webkit-scrollbar-track { background: transparent; }
        .y-file-editor-shell::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .y-file-editor-shell::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .y-file-editor-shell > pre,
        .y-file-editor-shell > textarea {
          grid-area: 1 / 1; margin: 0;
          padding: 22px 26px 40px;
          font-family: var(--y-mono); font-size: 13px; line-height: 1.65; tab-size: 2;
          white-space: pre;
        }
        .y-file-editor-shell > pre {
          pointer-events: none; color: #e4e4e4; background: transparent; border: 0; overflow: visible;
        }
        .y-file-editor-shell > pre code { background: none; padding: 0; font-size: inherit; font-weight: 400; font-family: inherit; color: inherit; border-radius: 0; }
        .y-file-editor-shell > textarea {
          color: transparent; caret-color: #e4e4e4; background: transparent;
          border: none; outline: none; resize: none; overflow: hidden;
        }
        .y-file-image {
          flex: 1; min-height: 0; overflow: auto; display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .y-file-img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }
        .y-file-markdown {
          flex: 1; min-height: 0; overflow: auto;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .y-file-markdown::-webkit-scrollbar { width: 5px; }
        .y-file-markdown::-webkit-scrollbar-track { background: transparent; }
        .y-file-markdown::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .y-file-markdown::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .y-file-markdown > * {
          max-width: 860px; margin-left: auto; margin-right: auto;
        }
        .y-file-markdown { padding: 30px 34px 70px; font-size: 15px; line-height: 1.78; color: rgba(255,255,255,0.88); }
        .y-file-markdown h1 { font-size: 28px; line-height: 1.18; font-weight: 700; margin: 40px 0 10px; color: rgba(255,255,255,0.95); letter-spacing: -0.02em; }
        .y-file-markdown h2 { font-size: 22px; line-height: 1.25; font-weight: 600; margin: 32px 0 8px; color: rgba(255,255,255,0.95); letter-spacing: -0.015em; border-bottom: 1px solid rgba(255,255,255,0.07); padding-bottom: 6px; }
        .y-file-markdown h3 { font-size: 17px; line-height: 1.35; font-weight: 600; margin: 24px 0 5px; color: rgba(255,255,255,0.92); }
        .y-file-markdown h4, .y-file-markdown h5, .y-file-markdown h6 { font-weight: 600; margin: 16px 0 4px; color: rgba(255,255,255,0.88); }
        .y-file-markdown > h1:first-child, .y-file-markdown > h2:first-child, .y-file-markdown > h3:first-child { margin-top: 4px; }
        .y-file-markdown p { color: rgba(255,255,255,0.84); line-height: 1.82; margin: 8px 0; }
        .y-file-markdown ul, .y-file-markdown ol { padding-left: 28px; margin: 6px 0; }
        .y-file-markdown li { margin: 7px 0; line-height: 1.72; color: rgba(255,255,255,0.84); }
        .y-file-markdown blockquote { border-left: 3px solid rgba(255,255,255,0.18); margin: 12px 0; padding: 10px 18px; color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.03); border-radius: 0 6px 6px 0; }
        .y-file-markdown hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 24px 0; }
        .y-file-markdown a { color: rgba(160,180,255,0.9); text-decoration: none; }
        .y-file-markdown a:hover { text-decoration: underline; }
        .y-file-markdown img { max-width: 100% !important; width: auto !important; height: auto !important; display: inline-block; border-radius: 6px; vertical-align: middle; }
        .y-file-markdown code { font-family: var(--y-mono); font-size: 0.875em; background: rgba(255,255,255,0.08); border-radius: 5px; padding: 2px 6px; }
        .y-file-markdown pre { background: var(--y-code-bg); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 16px 18px; overflow-x: auto; margin: 14px 8px; font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line); color: var(--y-code-color); }
        .y-file-markdown pre code { background: none; padding: 0; font: inherit; color: inherit; border-radius: 0; }
        .y-file-markdown table { border-collapse: collapse; width: 100%; font-size: 13.5px; line-height: 1.5; margin: 12px 0; }
        .y-file-markdown th, .y-file-markdown td { padding: 7px 14px; border: 1px solid rgba(255,255,255,0.08); text-align: left; vertical-align: top; }
        .y-file-markdown th { background: rgba(255,255,255,0.05); font-weight: 600; color: var(--y-text); }
        .y-file-markdown td { color: rgba(255,255,255,0.78); }
        .y-file-markdown tr:hover td { background: rgba(255,255,255,0.025); }
        .y-file-markdown [align="center"], .y-file-markdown center { text-align: center; }
        .md-hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 22px 0; }
        .md-table-wrap { overflow-x: auto; }
        .md-table { border-collapse: collapse; width: 100%; font-size: 13.5px; line-height: 1.5; }
        .md-table th, .md-table td { padding: 7px 14px; border: 1px solid rgba(255,255,255,0.08); text-align: left; vertical-align: top; }
        .md-table th { background: rgba(255,255,255,0.05); font-weight: 600; color: var(--y-text); }
        .md-table td { color: rgba(255,255,255,0.78); }
        .md-table tr:hover td { background: rgba(255,255,255,0.025); }
        .y-empty {
          flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px;
        }
        .y-empty-inner { text-align: center; max-width: 420px; }
        @keyframes y-mark-enter { from { opacity: 0; transform: scale(0.93); } to { opacity: 1; transform: scale(1); } }
        @keyframes y-row-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes y-scroll { from { transform: translateY(0); } to { transform: translateY(-96px); } }
        .y-mark {
          display: inline-block; width: 120px; height: 132px; color: #fff; overflow: visible;
          animation: y-mark-enter 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .binary-y-digits text {
          fill: currentColor; opacity: 0;
          animation: y-row-in 0.3s ease forwards;
        }
        .binary-y-digits text:nth-child(1)  { animation-delay: 120ms; }
        .binary-y-digits text:nth-child(2)  { animation-delay: 180ms; }
        .binary-y-digits text:nth-child(3)  { animation-delay: 240ms; }
        .binary-y-digits text:nth-child(4)  { animation-delay: 300ms; }
        .binary-y-digits text:nth-child(5)  { animation-delay: 360ms; }
        .binary-y-digits text:nth-child(6)  { animation-delay: 420ms; }
        .binary-y-digits text:nth-child(7)  { animation-delay: 480ms; }
        .binary-y-digits text:nth-child(8)  { animation-delay: 540ms; }
        .binary-y-digits text:nth-child(9)  { animation-delay: 600ms; }
        .binary-y-digits text:nth-child(10) { animation-delay: 660ms; }
        .binary-y-digits text:nth-child(11) { animation-delay: 720ms; }
        .binary-y-digits { animation: y-scroll 7s linear 1.1s infinite; }
        .y-empty-copy { margin-top: 18px; font-size: 15px; line-height: 24px; color: var(--y-text-3); }
        .y-empty-action {
          margin-top: 18px; height: 34px; padding: 0 13px; border-radius: 9px;
          border: 1px solid var(--y-border-strong); background: rgba(255,255,255,0.06);
          color: var(--y-text); font: inherit; font-size: 13px; cursor: pointer;
          display: inline-flex; align-items: center; gap: 8px;
        }
        .y-empty-action:hover { background: rgba(255,255,255,0.09); }
        .y-log { flex: 1; min-height: 0; overflow: auto; padding: 28px 24px 40px; user-select: text; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; position: relative; }
        .y-log::-webkit-scrollbar { width: 5px; }
        .y-log::-webkit-scrollbar-track { background: transparent; }
        .y-log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .y-log::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .y-composer textarea { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
        .y-composer textarea::-webkit-scrollbar { width: 4px; }
        .y-composer textarea::-webkit-scrollbar-track { background: transparent; }
        .y-composer textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 99px; }
        .y-composer textarea::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .y-log * { user-select: text; }
        .y-log button, .y-log summary, .tool-diff-ln, .tool-diff-gutter { user-select: none; }
        .y-log-inner { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
        .y-user-row { display: flex; justify-content: flex-end; align-items: flex-end; gap: 8px; }
        .y-user-wrap {
          position: relative; max-width: 78%; display: flex; flex-direction: column; align-items: stretch;
        }
        .y-user-actions {
          position: absolute; right: 8px; bottom: -16px; display: flex; gap: 4px;
          opacity: 0; transition: opacity 0.14s ease; z-index: 2;
        }
        .y-user-row:hover .y-user-actions, .y-user-actions:focus-within, .y-user-wrap.is-editing .y-user-actions { opacity: 1; }
        .y-message-action {
          width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--y-border);
          background: rgba(25,24,23,0.92); color: var(--y-text-3); cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 18px rgba(0,0,0,0.24);
        }
        .y-message-action:hover { color: var(--y-text); background: rgba(255,255,255,0.07); }
        .y-message-action.is-copied { color: #fff; background: rgba(255,255,255,0.1); }
        .y-user-bubble {
          padding: 11px 16px; border-radius: 18px 18px 6px 18px;
          background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.05);
          white-space: pre-wrap; line-height: 22px; color: rgba(255,255,255,0.88);
        }
        .y-inline-edit {
          width: min(100%, 620px); min-height: 92px; resize: vertical; border: 0; outline: none;
          background: transparent; color: rgba(255,255,255,0.92); font: inherit; line-height: 22px;
          white-space: pre-wrap;
        }
        .y-inline-edit::selection { background: rgba(166, 132, 82, 0.36); }
        .y-assistant { display: flex; flex-direction: column; gap: 10px; }
        .y-assistant-footer { min-height: 28px; display: flex; align-items: center; gap: 3px; color: var(--y-text-3); }
        .y-assistant-footer .y-message-action {
          width: 32px; height: 32px; border: 0; background: transparent; box-shadow: none;
        }
        .y-message-menu { position: relative; }
        .y-message-menu > summary { list-style: none; }
        .y-message-menu > summary::-webkit-details-marker { display: none; }
        .y-message-menu-popover {
          position: absolute; left: 0; top: calc(100% + 6px); z-index: 20;
          min-width: 164px; padding: 4px; border: 1px solid var(--y-border); border-radius: 10px;
          background: rgba(35,33,31,0.98); box-shadow: 0 18px 40px rgba(0,0,0,0.42);
        }
        .y-message-menu-popover button {
          width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 8px;
          border: 0; border-radius: 7px; background: transparent; color: var(--y-text);
          font: inherit; font-size: 12px; text-align: left; cursor: pointer;
        }
        .y-message-menu-popover button:hover { background: rgba(255,255,255,0.07); }
        .y-assistant-body { display: flex; flex-direction: column; gap: 12px; }
        .md-body { display: flex; flex-direction: column; gap: 14px; font-size: 14px; line-height: 1.68; color: rgba(255,255,255,0.88); }
        .md-stream-plain { white-space: pre-wrap; overflow-wrap: anywhere; }
        .md-stream-segment { animation: none; will-change: auto; }
        @media (prefers-reduced-motion: reduce) {
          .md-stream-segment { animation: none; }
        }
        .md-p { margin: 0; }
        .md-html img { max-width: 100% !important; width: auto !important; max-height: 280px; height: auto !important; display: inline-block; border-radius: 6px; vertical-align: middle; }
        .md-html a { color: rgba(180,160,255,0.9); text-decoration: none; }
        .md-html a:hover { text-decoration: underline; }
        .md-html [align="center"], .md-html center { text-align: center; display: block; }
        .md-html [align="center"] img, .md-html center img { margin: 0 auto; }
        .md-html picture { display: inline; }
        .md-html source { display: none; }
        .md-list { margin: 2px 0 4px; padding-left: 24px; display: flex; flex-direction: column; gap: 7px; }
        .md-list li { margin: 0; padding-left: 2px; }
        .md-task-list { list-style: none; padding-left: 2px; gap: 8px; }
        .md-task-list li { display: flex; align-items: flex-start; gap: 9px; color: rgba(255,255,255,0.84); }
        .md-task-list li.is-checked { color: rgba(255,255,255,0.58); }
        .md-task-box {
          width: 15px; height: 15px; margin-top: 4px; border-radius: 5px;
          border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.045); color: #f4f4f2;
          display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
          font-size: 10px; line-height: 1;
        }
        .md-task-list li.is-checked .md-task-box { border-color: rgba(120,160,215,0.42); background: rgba(95,135,190,0.18); }
        .md-inline { font-family: 'Fira Code', 'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace; font-size: 0.88em; background: rgba(255,255,255,0.08); border-radius: 5px; padding: 1px 6px; }
        .md-code { margin: 2px 8px; overflow: hidden; background: var(--y-code-bg); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; }
        .md-code-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); background: var(--y-code-bg); }
        .md-code-lang { font-family: var(--y-mono); font-size: 11px; color: rgba(255,255,255,0.3); text-transform: lowercase; }
        .md-code-copy { width: 24px; height: 24px; color: rgba(255,255,255,0.35); background: transparent; border: none; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
        .md-code-copy:hover { color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.06); }
        .md-code-copy.is-copied { color: #fff; background: rgba(255,255,255,0.1); }
        .md-code-pre {
          margin: 0; padding: 16px 18px; overflow: auto;
          font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line); white-space: pre; tab-size: 2;
          color: var(--y-code-color); background: var(--y-code-bg); scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .md-code-pre::-webkit-scrollbar { width: 5px; height: 5px; }
        .md-code-pre::-webkit-scrollbar-track { background: transparent; }
        .md-code-pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .md-code-pre::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .md-code-pre::-webkit-scrollbar-corner { background: transparent; }
        .md-h1, .md-h2, .md-h3 { margin: 8px 0 0; font-weight: 600; letter-spacing: -0.02em; color: rgba(255,255,255,0.94); }
        .md-body > :first-child .md-h1, .md-body > :first-child .md-h2, .md-body > :first-child .md-h3 { margin-top: 0; }
        .md-h1 { font-size: 20px; line-height: 1.3; } .md-h2 { font-size: 17px; line-height: 1.35; } .md-h3 { font-size: 15px; line-height: 1.4; }
        .md-quote { margin: 0; padding: 10px 14px; border-left: 3px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.03); border-radius: 0 8px 8px 0; color: rgba(235,235,235,0.78); }
        .md-olist { list-style: decimal; }
        .md-link { color: #7aa2ff; text-decoration: none; } .md-link:hover { text-decoration: underline; }
        .md-code-pre code { background: none; padding: 0; font-size: inherit; font-weight: 400; font-family: inherit; color: inherit; border-radius: 0; }
	        .y-composer-terminal {
	          margin: -8px -8px 10px; overflow: hidden;
	          border-bottom: 1px solid rgba(255,255,255,0.07);
	          background: #050506;
	        }
	        .y-terminal-dock {
	          flex-shrink: 0;
	          height: 0;
	          opacity: 0;
	          overflow: hidden;
	          position: relative;
	          border-top: 1px solid transparent;
	          transition:
	            height 0.26s cubic-bezier(0.4, 0, 0.2, 1),
	            opacity 0.18s ease,
	            border-color 0.26s cubic-bezier(0.4, 0, 0.2, 1);
	        }
	        .y-terminal-dock.is-open {
	          height: min(var(--y-terminal-height, 320px), 62vh);
	          opacity: 1;
	          border-top-color: rgba(255,255,255,0.07);
	        }
	        .y-terminal-dock .y-composer-terminal {
	          margin: 0; height: 100%; display: flex; flex-direction: column;
	          border-bottom: 0;
	        }
	        .y-composer-terminal-bar {
	          min-height: 32px; display: flex; align-items: center; gap: 8px;
	          padding: 0 10px; border-bottom: 1px solid rgba(255,255,255,0.07);
	          color: var(--y-text-2); font-family: var(--y-mono); font-size: 11px;
	        }
	        .y-composer-terminal-title {
	          min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	          display: flex; align-items: center; gap: 8px;
	        }
        .y-composer-terminal-close {
          width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
          border-radius: 6px; border: 0; background: transparent; color: var(--y-text-3);
          font: inherit; font-size: 18px; line-height: 1; cursor: pointer;
        }
        .y-composer-terminal-close:hover { color: var(--y-text); background: rgba(255,255,255,0.06); }
        .y-composer-terminal-screen {
          margin: 0; min-height: 92px; max-height: min(280px, 34vh); overflow: auto;
          padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere;
          font-family: var(--y-mono); font-size: 12px; line-height: 1.45;
          color: rgba(238,238,238,0.88);
        }
	        .y-xterm {
	          height: 100%; min-height: 0; flex: 1;
	          padding: 8px 0 8px 8px; background: #050506;
	          overflow: hidden; position: relative;
	        }
	        @media (prefers-reduced-motion: reduce) {
	          .y-terminal-dock { transition: none; }
	        }
	        .y-xterm .xterm {
	          height: 100%; width: 100%;
	        }
        .y-xterm .xterm-viewport,
        .y-xterm .xterm-screen {
          background: transparent !important;
        }
	        .y-xterm .xterm-viewport {
	          overflow-y: auto !important;
	          scrollbar-color: rgba(255,255,255,0.2) transparent;
	        }
        .y-resize-handle { position: absolute; z-index: 40; touch-action: none; }
        .y-resize-handle::after { content: ''; position: absolute; background: rgba(255,255,255,0); transition: background 0.14s ease; }
        .y-resize-handle:hover::after, .y-resize-handle:focus-visible::after { background: rgba(255,255,255,0.22); }
        .y-resize-handle-x { top: 0; bottom: 0; width: 7px; cursor: col-resize; }
        .y-resize-handle-x::after { top: 0; bottom: 0; left: 3px; width: 1px; }
        .y-sidebar-resize { right: -4px; }
        .y-file-resize { left: -4px; }
        .y-resize-handle-y { top: -4px; left: 0; right: 0; height: 8px; cursor: row-resize; }
        .y-resize-handle-y::after { left: 0; right: 0; top: 3px; height: 1px; }
        html.y-is-resizing-x, html.y-is-resizing-x * { cursor: col-resize !important; user-select: none !important; }
        html.y-is-resizing-y, html.y-is-resizing-y * { cursor: row-resize !important; user-select: none !important; }
        html.y-is-resizing-x .y-sidebar, html.y-is-resizing-x .y-file-rail,
        html.y-is-resizing-y .y-terminal-dock { transition: none !important; }
        .y-toast {
          position: absolute; bottom: 88px; left: 50%; transform: translateX(-50%);
          background: rgba(20,20,22,0.96); border: 1px solid var(--y-border-strong);
          border-radius: 10px; padding: 8px 14px; font-size: 12px; color: var(--y-text-2);
          z-index: 30; pointer-events: none; max-width: 90%; text-align: center;
        }
        .y-modal-backdrop {
          position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
          padding: 24px; background: rgba(0,0,0,0.42); backdrop-filter: blur(10px);
        }
        .y-isolation-dialog {
          width: min(420px, 100%); border: 1px solid var(--y-border-strong); border-radius: 14px;
          background: rgba(18,18,20,0.98); box-shadow: 0 24px 80px rgba(0,0,0,0.52);
          padding: 18px; color: var(--y-text);
        }
        .y-isolation-title {
          margin: 0; font-size: 15px; line-height: 1.35; font-weight: 650; letter-spacing: 0;
        }
        .y-isolation-copy {
          margin: 8px 0 0; color: var(--y-text-2); font-size: 12.5px; line-height: 1.55;
        }
        .y-isolation-path {
          margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.04);
          color: var(--y-text-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .y-isolation-actions {
          display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
        }
        .y-isolation-action {
          height: 34px; padding: 0 12px; border-radius: 9px; border: 1px solid var(--y-border);
          background: rgba(255,255,255,0.04); color: var(--y-text-2); font: inherit; font-size: 12.5px;
          cursor: pointer;
        }
        .y-isolation-action:hover, .y-isolation-action:focus-visible {
          background: rgba(255,255,255,0.08); color: var(--y-text);
        }
        .y-isolation-action.primary {
          background: rgba(255,255,255,0.92); border-color: rgba(255,255,255,0.92); color: #111;
        }
        .y-isolation-action.primary:hover, .y-isolation-action.primary:focus-visible {
          background: #fff; border-color: #fff; color: #050505;
        }
        .y-feedback-dialog {
          width: min(390px, 100%); border: 1px solid var(--y-border-strong); border-radius: 14px;
          background: rgba(18,18,20,0.98); box-shadow: 0 24px 80px rgba(0,0,0,0.52);
          padding: 16px; color: var(--y-text);
        }
        .y-feedback-head {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
        }
        .y-feedback-head h2 {
          margin: 0; font-size: 15px; line-height: 1.35; font-weight: 650; letter-spacing: 0;
        }
        .y-feedback-head p {
          margin: 6px 0 0; color: var(--y-text-3); font-size: 12px; line-height: 1.45;
        }
        .y-feedback-close {
          width: 28px; height: 28px; border-radius: 8px; border: none; background: transparent;
          color: var(--y-text-3); cursor: pointer; display: flex; align-items: center; justify-content: center;
        }
        .y-feedback-close:hover { background: rgba(255,255,255,0.06); color: var(--y-text); }
        .y-feedback-form { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
        .y-feedback-form textarea {
          width: 100%; border: 1px solid var(--y-border); border-radius: 10px;
          background: rgba(255,255,255,0.04); color: var(--y-text); font: inherit; font-size: 13px;
          outline: none; box-sizing: border-box;
        }
        .y-feedback-form textarea { min-height: 118px; resize: vertical; padding: 11px 12px; line-height: 1.5; }
        .y-feedback-form textarea:focus { border-color: rgba(222,190,156,0.32); background: rgba(255,255,255,0.055); }
        .y-feedback-actions { display: flex; justify-content: flex-end; gap: 8px; }
        .y-feedback-submit {
          height: 34px; padding: 0 13px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.9);
          background: rgba(255,255,255,0.92); color: #111; font: inherit; font-size: 12.5px; font-weight: 600;
          cursor: pointer;
        }
        .y-feedback-submit:hover:not(:disabled) { background: #fff; border-color: #fff; }
        .y-feedback-submit:disabled { opacity: 0.36; cursor: default; }
        .y-settings-panel {
          margin: 0 10px 8px; padding: 10px; border-radius: 10px;
          border: 1px solid var(--y-border); background: rgba(0,0,0,0.18);
          display: flex; flex-direction: column; gap: 8px;
        }
        .y-settings-title { font-size: 12px; font-weight: 600; color: var(--y-text); }
        .y-settings-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--y-text-2); }
        .y-settings-row span:last-child { color: var(--y-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-settings-view { flex: 1 1 auto; min-height: 0; overflow: hidden; border-top: 1px solid rgba(255,255,255,0.045); display: flex; flex-direction: column; }
        .y-settings-content { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 34px clamp(28px, 7vw, 96px) 96px; display: flex; flex-direction: column; align-items: center; gap: 28px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
        .y-settings-content::-webkit-scrollbar { width: 10px; }
        .y-settings-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border: 3px solid transparent; border-radius: 999px; background-clip: padding-box; }
        .y-settings-content::-webkit-scrollbar-track { background: transparent; }
        .y-settings-header-close { color: var(--y-text-3); }
        .y-settings-lead { margin: 7px 0 0; color: var(--y-text-3); font-size: 12.5px; }
        .y-settings-action { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--y-border); background: rgba(255,255,255,0.04); color: var(--y-text-2); font: inherit; font-size: 12px; cursor: pointer; }
        .y-settings-action:hover { background: rgba(255,255,255,0.075); color: var(--y-text); }
        .y-settings-action:disabled { opacity: 0.45; cursor: default; }
        .y-settings-action:disabled:hover { background: rgba(255,255,255,0.04); color: var(--y-text-2); }
        .y-settings-action.danger { color: rgba(255,145,145,0.92); border-color: rgba(255,120,120,0.2); }
        .y-settings-action.danger:hover { background: rgba(255,80,80,0.08); color: rgba(255,170,170,0.96); }
        .y-settings-section { width: min(760px, 100%); display: flex; flex-direction: column; gap: 12px; }
        .y-settings-section h2 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
        .y-settings-card { min-height: 68px; padding: 14px 16px; border: 1px solid var(--y-border); border-radius: 12px; background: rgba(255,255,255,0.025); display: flex; align-items: center; justify-content: space-between; gap: 24px; }
        .y-account-card { min-height: 76px; }
        .y-account-main { min-width: 0; display: flex; align-items: center; gap: 12px; }
        .y-account-avatar { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 50%; overflow: hidden; border: 1px solid var(--y-border); background: rgba(255,255,255,0.06); display: grid; place-items: center; color: var(--y-text); font-size: 13px; font-weight: 700; }
        .y-account-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .y-account-avatar span { transform: translateY(-0.5px); }
        .y-connected-card { align-items: flex-start; flex-direction: column; gap: 14px; }
        .y-connected-list { width: 100%; display: flex; flex-direction: column; gap: 8px; }
        .y-connected-item { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 9px 10px; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; background: rgba(255,255,255,0.025); }
        .y-connected-avatar { width: 28px; height: 28px; flex: 0 0 28px; border-radius: 50%; overflow: hidden; border: 1px solid var(--y-border); background: rgba(255,255,255,0.06); display: grid; place-items: center; color: var(--y-text); font-size: 11px; font-weight: 700; }
        .y-connected-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .y-connected-item > div:last-child { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .y-connected-item p, .y-connected-item span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-connected-item p { margin: 1px 0 0; color: var(--y-text-2); font-size: 11.5px; }
        .y-connected-item span { color: var(--y-text-3); font-family: var(--y-mono); font-size: 10.5px; }
        .y-settings-card.is-column { align-items: flex-start; flex-direction: column; gap: 7px; }
        .y-settings-card strong, .y-agent-card strong { font-size: 12.5px; font-weight: 600; }
        .y-settings-card p, .y-agent-card p { margin: 4px 0 0; color: var(--y-text-3); font-size: 11.5px; line-height: 1.5; }
        .y-settings-toggle { width: 34px; height: 20px; padding: 2px; flex: 0 0 34px; border: 0; border-radius: 99px; background: rgba(255,255,255,0.14); cursor: pointer; transition: background 0.14s ease; }
        .y-settings-toggle span { display: block; width: 16px; height: 16px; border-radius: 50%; background: rgba(255,255,255,0.82); transform: translateX(0); transition: transform 0.14s ease; }
        .y-settings-toggle.is-on { background: #4e7fb8; }
        .y-settings-toggle.is-on span { transform: translateX(14px); background: #fff; }
        .y-agent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-top: 6px; }
        .y-agent-card { min-height: 100px; padding: 15px; border: 1px solid var(--y-border); border-radius: 12px; background: rgba(255,255,255,0.025); display: flex; flex-direction: column; align-items: flex-start; }
        .y-agent-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .y-agent-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-agent-card > span { margin-top: 10px; padding: 3px 7px; border-radius: 99px; background: rgba(90,145,105,0.14); color: rgba(145,205,160,0.86); font-size: 10.5px; }
        .y-settings-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; }
        .tool-activity { align-self: flex-start; max-width: 100%; width: min(680px, 100%); padding: 1px 0; }
        .tool-activity summary { list-style: none; cursor: pointer; outline: none; border-radius: 6px; }
        .tool-activity summary:focus-visible { box-shadow: 0 0 0 2px rgba(121,192,255,0.38); }
        .tool-activity summary::-webkit-details-marker { display: none; }
        .tool-activity.is-collapsible summary:hover .tool-activity-target,
        .tool-activity.is-collapsible summary:hover .tool-activity-stat { color: rgba(235,235,235,0.78); }
        .tool-activity-line {
          display: flex; align-items: center; flex-wrap: nowrap; gap: 7px;
          font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line);
        }
        .tool-activity-icon {
          width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
          align-self: center; flex: 0 0 18px; color: rgba(185,185,190,0.72);
        }
        .tool-activity-verb { color: rgba(235,235,235,0.9); flex-shrink: 0; font-weight: 600; }
        .tool-activity-target { color: rgba(165,165,170,0.76); min-width: 0; display: inline-flex; align-items: center; gap: 5px; }
        .tool-activity-target > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tool-activity-file-icon { width: 15px; height: 15px; display: inline-flex; flex: 0 0 15px; }
        .tool-activity-stat { display: inline-flex; gap: 6px; font-size: 11.5px; flex-shrink: 0; font-weight: 600; }
        .tool-activity-chevron { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 14px; color: rgba(170,170,175,0.58); transform: rotate(-90deg); transition: transform 0.16s ease; }
        .tool-activity[open] .tool-activity-chevron { transform: rotate(0deg); }
        .tool-stat-add { color: #4ade80; }
        .tool-stat-del { color: #ff6b6b; }
        .tool-activity-detail {
          margin: 8px 0 2px 0; padding: 6px 0; font-family: var(--y-mono); font-size: var(--y-code-size);
          line-height: var(--y-code-line); color: var(--y-code-color); word-break: normal;
          max-height: 420px; overflow-x: hidden; overflow-y: auto;
          border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; background: var(--y-code-bg);
        }
        .tool-activity-plain { padding: 10px 12px; font-size: var(--y-code-size); line-height: 1.55; }
        .tool-activity-plain.has-file { font-size: var(--y-code-size); line-height: var(--y-code-line); color: var(--y-code-color); tab-size: 2; }
        .tool-activity-command { color: rgba(235,235,235,0.92); white-space: pre-wrap; overflow-wrap: anywhere; }
        .tool-activity-plain pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .tool-activity-command + pre { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); }
        .tool-activity-plain code { color: rgba(210,210,215,0.84); font: inherit; }
        .tool-diff-line { display: grid; grid-template-columns: 38px 24px minmax(0, 1fr); min-height: 32px; padding: 0; align-items: stretch; width: 100%; min-width: 0; }
        .tool-diff-ln, .tool-diff-gutter { color: rgba(170,170,175,0.56); text-align: right; user-select: none; }
        .tool-diff-ln { align-self: stretch; display: flex; align-items: center; justify-content: flex-end; padding-right: 12px; border-right: 1px solid rgba(255,255,255,0.07); background: var(--y-code-bg); }
        .tool-diff-gutter { align-self: stretch; display: flex; align-items: center; justify-content: center; text-align: center; }
        .tool-diff-line code { display: block; min-width: 0; color: var(--y-code-color); font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line); background: none; border-radius: 0; font-weight: 400; padding: 6px 14px 6px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
        .tool-diff-del .tool-diff-gutter, .tool-diff-del code { background: rgba(248, 81, 73, 0.15); }
        .tool-diff-add .tool-diff-gutter, .tool-diff-add code { background: rgba(46, 160, 67, 0.17); }
        .tool-diff-del .tool-diff-gutter { color: #ff7b72; }
        .tool-diff-add .tool-diff-gutter { color: #56d364; }
        .tool-diff-del .tool-diff-ln { color: #ff7b72; }
        .tool-diff-add .tool-diff-ln { color: #56d364; }
        .y-tool-note { font-size: 12px; color: var(--y-text-3); font-style: italic; }
        .y-status { color: var(--y-text-3); font-size: 13px; font-style: italic; }
        .y-binary-spinner {
          position: relative; width: 24px; height: 24px; display: block; box-sizing: border-box;
          color: rgba(255,255,255,0.28); font-family: var(--y-mono); font-size: 7.5px; line-height: 1;
        }
        .y-binary-spinner.is-resetting { animation: y-binary-wipe 500ms ease-in-out both; }
        @keyframes y-binary-wipe {
          0% { clip-path: inset(0 0 0 0); }
          44% { clip-path: inset(0 0 0 100%); }
          45% { clip-path: inset(0 100% 0 0); }
          100% { clip-path: inset(0 0 0 0); }
        }
        .y-binary-glow {
          position: absolute; left: 0; top: 0; width: 8px; height: 8px; border-radius: 4px;
          background: rgba(255,255,255,0.08); box-shadow: 0 0 10px rgba(255,255,255,0.2);
          transition: transform 120ms ease-in-out; will-change: transform;
        }
        .y-binary-cell {
          position: absolute; width: 8px; height: 8px; display: grid; place-items: center;
          color: rgba(255,255,255,0.28); transition: color 120ms ease-in-out, text-shadow 120ms ease-in-out;
        }
        .y-binary-cell.active { color: rgba(255,255,255,0.96); text-shadow: 0 0 8px rgba(255,255,255,0.32); }
        .cell-1 { left: 0; top: 0; } .cell-2 { left: 8px; top: 0; } .cell-3 { left: 16px; top: 0; }
        .cell-4 { left: 0; top: 8px; } .cell-5 { left: 8px; top: 8px; } .cell-6 { left: 16px; top: 8px; }
        .cell-7 { left: 0; top: 16px; } .cell-8 { left: 8px; top: 16px; } .cell-9 { left: 16px; top: 16px; }
        .y-thinking { align-self: flex-start; max-width: min(680px, 100%); color: var(--y-text-2); }
        .y-thinking > summary { display: flex; align-items: center; gap: 7px; min-height: 24px; list-style: none; cursor: pointer; font-family: var(--y-mono); font-size: 12px; }
        .y-thinking > summary::-webkit-details-marker { display: none; }
        .y-thinking > summary svg:last-child { transform: rotate(-90deg); transition: transform 0.16s ease; }
        .y-thinking[open] > summary svg:last-child { transform: rotate(0deg); }
        .y-thinking-body { margin: 7px 0 0 22px; padding-left: 10px; border-left: 1px solid var(--y-border-strong); white-space: pre-wrap; font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line); color: var(--y-code-color); }
        .y-work-log { border-bottom: 1px solid rgba(255,255,255,0.07); }
        .y-work-log > summary {
          min-height: 38px; display: flex; align-items: center; gap: 8px; list-style: none; cursor: pointer;
          color: var(--y-text-2); font-size: 13px;
        }
        .y-work-log > summary::-webkit-details-marker { display: none; }
        .y-work-log > summary svg { transform: rotate(-90deg); transition: transform 0.16s ease; }
        .y-work-log[open] > summary svg { transform: rotate(0deg); }
        .y-live-work { display: flex; align-items: center; gap: 9px; min-height: 28px; color: var(--y-text-3); font-family: var(--y-mono); font-size: 11.5px; }
        .y-completed-turn { display: flex; flex-direction: column; gap: 18px; }
        .y-work-body { display: flex; flex-direction: column; gap: 16px; padding: 8px 0 20px 16px; }
        .y-work-narration .md-body { font-family: var(--y-mono); font-size: var(--y-code-size); line-height: var(--y-code-line); color: var(--y-code-color); }
        .y-edited-files { border: 1px solid var(--y-border-strong); border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.025); }
        .y-edited-files-head, .y-edited-file { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 12px; }
        .y-edited-files-head { border-bottom: 1px solid var(--y-border); }
        .y-edited-files-head strong { font-size: 13px; }
        .y-edited-file { font-family: var(--y-mono); font-size: 12px; color: #e4e4e4; }
        .y-edited-file-button { width: 100%; border: 0; background: transparent; text-align: left; cursor: pointer; }
        .y-edited-file-button:hover { background: rgba(255,255,255,0.04); }
        .y-edited-files-actions { display: inline-flex; align-items: center; gap: 10px; }
        .y-edited-undo { display: inline-flex; align-items: center; gap: 5px; height: 24px; border: 1px solid var(--y-border); border-radius: 999px; background: rgba(255,255,255,0.045); color: var(--y-text-2); padding: 0 9px; font: inherit; font-family: var(--y-font); font-size: 11.5px; cursor: pointer; }
        .y-edited-undo:hover { border-color: var(--y-border-strong); color: var(--y-text); background: rgba(255,255,255,0.075); }
        .y-edited-files b { color: #4ade80; font-style: normal; }
        .y-edited-files i { color: #ff6b6b; font-style: normal; }
        .y-error { color: #ff7a7a; white-space: pre-wrap; font-size: 13px; line-height: 20px; }
        .y-composer-wrap { flex-shrink: 0; padding: 0 24px 22px; }
        .y-composer {
          max-width: 820px; margin: 0 auto; background: rgba(255,255,255,0.035);
          border: 1px solid rgba(255,255,255,0.11); border-radius: 20px;
          padding: 16px 16px 12px; display: flex; flex-direction: column; gap: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.28); position: relative;
        }
        .y-composer > :not(.y-composer-drop-indicator) {
          transition: filter 0.16s ease, opacity 0.16s ease;
        }
        .y-composer.is-drop-target > :not(.y-composer-drop-indicator) {
          filter: blur(3px);
          opacity: 0.38;
        }
        .y-composer-drop-indicator {
          position: absolute;
          inset: 0;
          z-index: 4;
          display: grid;
          place-items: center;
          pointer-events: none;
          opacity: 0;
          transform: scale(0.96);
          transition: opacity 0.16s ease, transform 0.16s ease;
        }
        .y-composer.is-drop-target .y-composer-drop-indicator {
          opacity: 1;
          transform: scale(1);
        }
        .y-composer-drop-icon {
          width: 54px;
          height: 54px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(24,24,26,0.72);
          color: var(--y-text);
          box-shadow: 0 14px 52px rgba(0,0,0,0.32);
          backdrop-filter: blur(18px) saturate(145%);
          -webkit-backdrop-filter: blur(18px) saturate(145%);
        }
        .y-composer textarea {
          resize: none; font: inherit; font-size: 14px; line-height: 22px; color: inherit;
          background: transparent; border: none; outline: none; padding: 0 4px; min-height: 24px;
          max-height: 164px; overflow-y: auto;
        }
        .y-suggest {
          position: absolute; left: 12px; right: 12px; bottom: calc(100% + 8px);
          z-index: 40;
          border: 1px solid var(--y-border); border-radius: 12px; overflow-y: auto; overflow-x: hidden;
          max-height: min(260px, 38vh);
          background: rgba(12,12,14,0.96); box-shadow: 0 12px 36px rgba(0,0,0,0.34);
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .y-suggest::-webkit-scrollbar { width: 5px; }
        .y-suggest::-webkit-scrollbar-track { background: transparent; }
        .y-suggest::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .y-suggest::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .y-suggest-item {
          display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px;
          border: none; border-bottom: 1px solid rgba(255,255,255,0.06); background: transparent;
          color: var(--y-text); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
        }
        .y-suggest-item:last-child { border-bottom: none; }
        .y-suggest-item:hover { background: rgba(255,255,255,0.06); }
        .y-suggest-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .y-suggest-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
        .y-suggest-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--y-text-3); font-size: 11.5px; }
        .y-suggest-source { margin-left: auto; flex-shrink: 0; color: var(--y-text-3); font-size: 11px; }
        .y-attachments {
          display: flex; flex-wrap: wrap; gap: 6px; padding: 0 2px;
        }
	        .y-queued-stack { max-width: 820px; margin: 0 auto 8px; display: flex; flex-direction: column; gap: 5px; }
	        .y-queued {
          display: flex; align-items: center; gap: 8px; min-width: 0;
          border: 1px solid var(--y-border); background: rgba(255,255,255,0.035);
          color: var(--y-text-2); border-radius: 10px; padding: 7px 8px;
          font-size: 12px;
        }
        .y-queued-label { flex-shrink: 0; color: var(--y-text-3); font-family: var(--y-mono); }
        .y-queued-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-queued-steer {
          margin-left: auto; height: 24px; padding: 0 9px; border-radius: 7px;
          border: 1px solid var(--y-border); background: rgba(255,255,255,0.04);
          color: var(--y-text-2); font: inherit; font-size: 11px; cursor: pointer;
        }
        .y-queued-steer:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: var(--y-text); }
        .y-queued-steer:disabled { opacity: 0.56; cursor: default; }
        .y-queued-remove {
          width: 20px; height: 20px; border: none; border-radius: 6px;
          background: transparent; color: var(--y-text-3); cursor: pointer;
        }
        .y-queued-remove:hover { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-attachment {
          display: inline-flex; align-items: center; gap: 6px; max-width: 240px; height: 26px;
          padding: 0 6px 0 8px; border-radius: 8px; border: 1px solid var(--y-border);
          background: rgba(255,255,255,0.04); color: var(--y-text-2); font-size: 11.5px;
        }
        .y-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,0.76); }
        .y-attachment-size { color: var(--y-text-3); flex-shrink: 0; }
        .y-attachment-remove {
          width: 18px; height: 18px; border: none; border-radius: 5px; background: transparent;
          color: var(--y-text-3); cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
        }
        .y-attachment-remove:hover { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-composer-row { display: flex; align-items: center; gap: 8px; }
        .y-round-btn {
          width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--y-border);
          background: transparent; color: var(--y-text-2); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .y-round-btn:disabled { opacity: 0.45; cursor: default; }
        .y-goal-btn.is-active {
          color: #f4f4f2;
          border-color: rgba(120,160,215,0.38);
          background: rgba(95,135,190,0.16);
        }
        .y-composer-mode-pill,
        .y-composer-goal-chip {
          height: 24px;
          max-width: 190px;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 0 9px;
          border-radius: 999px;
          border: 1px solid rgba(120,160,215,0.28);
          background: rgba(95,135,190,0.12);
          color: rgba(218,226,238,0.9);
          font-size: 11.5px;
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-shrink: 0;
        }
        .y-composer-mode-pill { color: #f4f4f2; }
        .y-composer-mode-pill button {
          width: 16px;
          height: 16px;
          border: none;
          border-radius: 50%;
          background: rgba(255,255,255,0.08);
          color: inherit;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          font: inherit;
          line-height: 1;
        }
        .y-composer-mode-pill button:hover { background: rgba(255,255,255,0.14); }
        .y-steer-btn {
          height: 30px; padding: 0 11px; border-radius: 9px; border: 1px solid rgba(120,150,190,0.28);
          background: rgba(110,145,190,0.12); color: rgba(205,220,240,0.92);
          font: inherit; font-size: 12px; cursor: pointer; flex-shrink: 0;
        }
        .y-steer-btn:hover { background: rgba(110,145,190,0.18); color: var(--y-text); }
        .y-send {
          width: 34px; height: 34px; border-radius: 50%; border: none;
          background: #fff; color: #0a0a0b; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 17px; font-weight: 600; line-height: 1;
          margin-left: auto; flex-shrink: 0;
        }
        .y-send:disabled { background: rgba(255,255,255,0.15); cursor: default; }
        .y-drop { position: relative; flex-shrink: 0; }
        .y-drop-btn {
          display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px;
          border-radius: 8px; border: 1px solid var(--y-border); background: rgba(255,255,255,0.04);
          color: var(--y-text-2); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
        }
        .y-drop-btn:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-drop-btn:disabled { opacity: 0.38; cursor: default; }
        .y-drop-btn > svg:last-child { flex-shrink: 0; opacity: 0.5; transition: transform 0.15s ease; }
        .y-drop.is-open .y-drop-btn > svg:last-child { transform: rotate(180deg); }
        .y-drop-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .y-drop-menu {
          position: absolute; bottom: calc(100% + 6px); left: 0; min-width: 130px; z-index: 40;
          padding: 4px; border-radius: 10px; border: 1px solid var(--y-border-strong);
          background: rgba(16,16,18,0.98); box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        }
        .y-drop-item {
          display: flex; align-items: center; gap: 7px; width: 100%; padding: 7px 10px; border: none;
          border-radius: 7px; background: transparent; color: var(--y-text-2); font: inherit;
          font-size: 12px; text-align: left; cursor: pointer; white-space: nowrap;
        }
        .y-drop-item:hover { background: rgba(255,255,255,0.06); color: var(--y-text); }
        .y-drop-item.active { background: rgba(255,255,255,0.08); color: var(--y-text); }
        .y-onboarding {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          place-items: center;
          background: #0a0a0b;
          padding: 48px 24px;
          overflow: auto;
        }
        .y-onboarding-card {
          width: min(920px, 100%);
          background: transparent;
          padding: 0;
        }
        .y-onboarding-brand {
          display: flex;
          align-items: center;
          gap: 18px;
        }
        .y-onboarding-brand .y-mark { width: 58px; height: 64px; flex: 0 0 auto; }
        .y-onboarding-kicker {
          margin: 0 0 6px;
          color: var(--y-text-3);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .y-onboarding h1 {
          margin: 0;
          font-size: clamp(28px, 4vw, 44px);
          line-height: 1;
          letter-spacing: -0.04em;
        }
        .y-onboarding h2 {
          margin: 0 0 6px;
          font-size: 17px;
          letter-spacing: -0.02em;
        }
        .y-onboarding p { margin: 0; color: var(--y-text-2); line-height: 1.55; }
        .y-onboarding-panel {
          margin-top: 26px;
          border: 1px solid var(--y-border);
          border-radius: 20px;
          background: rgba(0,0,0,0.16);
          padding: 20px;
        }
        .y-onboarding-muted { max-width: 640px; font-size: 13px; }
        .y-auth-grid,
        .y-cli-grid,
        .y-guide-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
          margin-top: 18px;
        }
        .y-auth-card,
        .y-cli-card,
        .y-guide-grid > div {
          border: 1px solid var(--y-border);
          border-radius: 16px;
          background: rgba(255,255,255,0.035);
          color: var(--y-text);
        }
        .y-auth-card {
          min-height: 92px;
          padding: 16px;
          text-align: left;
          font: inherit;
          cursor: pointer;
        }
        .y-auth-card:hover,
        .y-auth-card.active {
          border-color: rgba(120,160,215,0.36);
          background: rgba(95,135,190,0.15);
        }
        .y-auth-card strong,
        .y-cli-card strong,
        .y-guide-grid strong { display: block; font-size: 13px; font-weight: 700; }
        .y-auth-card span,
        .y-cli-card span,
        .y-guide-grid span { display: block; margin-top: 6px; color: var(--y-text-3); font-size: 12px; line-height: 1.5; }
        .y-email-auth {
          display: flex;
          gap: 10px;
          margin-top: 12px;
        }
        .y-email-auth input {
          min-width: 0;
          flex: 1;
          height: 34px;
          padding: 0 12px;
          border: 1px solid var(--y-border);
          border-radius: 10px;
          background: rgba(0,0,0,0.18);
          color: var(--y-text);
          font: inherit;
          font-size: 12px;
          outline: none;
        }
        .y-email-auth input:focus { border-color: rgba(120,160,215,0.48); }
        .y-auth-status {
          margin-top: 10px;
          color: var(--y-text-2);
          font-size: 12px;
          line-height: 1.45;
        }
        .y-guide-grid .y-guide-engines {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin: 0 2px;
          color: var(--y-text-2);
          white-space: nowrap;
        }
        .y-onboarding-note {
          margin-top: 14px;
          padding: 11px 12px;
          border: 1px solid rgba(120,160,215,0.18);
          border-radius: 12px;
          background: rgba(95,135,190,0.08);
          color: var(--y-text-2);
          font-size: 12px;
          line-height: 1.5;
        }
        .y-onboarding-toggle {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 14px;
          color: var(--y-text);
        }
        .y-onboarding-toggle small { display: block; margin-top: 3px; color: var(--y-text-3); font-size: 11.5px; line-height: 1.45; }
        .y-onboarding-row,
        .y-onboarding-actions,
        .y-onboarding-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }
        .y-onboarding-footer { margin-top: 18px; align-items: center; }
        .y-onboarding-ready-note {
          margin: 0;
          color: rgba(74,222,128,0.92);
          font-size: 13px;
          font-weight: 700;
        }
        .y-onboarding-footer-end { display: flex; gap: 8px; margin-left: auto; }
        .y-onboarding-primary,
        .y-onboarding-secondary {
          height: 34px;
          padding: 0 14px;
          border-radius: 10px;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .y-onboarding-primary {
          border: 1px solid rgba(255,255,255,0.12);
          background: #f7f7f4;
          color: #0a0a0b;
        }
        .y-onboarding-primary:disabled,
        .y-onboarding-secondary:disabled { opacity: 0.45; cursor: default; }
        .y-onboarding-secondary {
          border: 1px solid var(--y-border);
          background: rgba(255,255,255,0.045);
          color: var(--y-text-2);
        }
        .y-cli-card {
          padding: 15px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .y-cli-card.installed { border-color: rgba(74,222,128,0.24); background: rgba(74,222,128,0.07); }
        .y-cli-card.ready { border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.1); }
        .y-cli-head { display: flex; align-items: center; gap: 10px; }
        .y-cli-tick {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          margin-left: auto;
          flex-shrink: 0;
          background: rgba(74,222,128,0.18);
          color: #4ade80;
        }
        .y-cli-hint {
          margin: -4px 0 0;
          font-size: 11px;
          color: var(--y-text-2);
        }
        .y-cli-card code {
          display: block;
          min-height: 34px;
          padding: 9px 10px;
          border: 1px solid var(--y-border);
          border-radius: 10px;
          background: rgba(0,0,0,0.18);
          color: var(--y-code-color);
          font-family: var(--y-mono);
          font-size: 11.5px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .y-guide-grid > div { padding: 16px; min-height: 106px; }
        .y-onboarding-actions { justify-content: flex-end; margin-top: 20px; }

      `}</style>

      <div className={'y-app' + (sidebarOpen ? '' : ' sidebar-closed')} data-testid="y-app">
        <div className="y-sidebar-toggle-fixed">
          <div className="y-sidebar-toggle-slot">
            <button
              type="button"
              className="y-toolbar-btn y-sidebar-toggle"
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
              aria-expanded={sidebarOpen}
              data-testid="sidebar-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <Icon name="panel" size={16} />
            </button>
          </div>
        </div>

        <aside
          className={'y-sidebar' + (sidebarOpen ? '' : ' is-collapsed')}
          data-testid="y-sidebar"
          aria-hidden={!sidebarOpen}
          style={{ '--y-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        >
          <div className="y-sidebar-inner">
            <div className="y-sidebar-top">
              <div className="y-sidebar-top-spacer" aria-hidden="true" />
              <div className="y-sidebar-chrome" aria-hidden="true" />
            </div>
            <nav className="y-nav">
              {NAV.map((item) =>
                item.id === 'search' && searchOpen ? (
                  <div key={item.id} ref={searchBoxRef} className="y-nav-search" data-testid="nav-search">
                    <span className="y-nav-icon">
                      <Icon name="search" size={16} />
                    </span>
                    <input
                      ref={searchRef}
                      className="y-search"
                      data-testid="sidebar-search"
                      value={searchQuery}
                      onChange={(ev) => setSearchQuery(ev.target.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Escape') {
                          setSearchQuery('')
                          setSearchOpen(false)
                        }
                      }}
                      placeholder="Search"
                    />
                  </div>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    className={'y-nav-btn' + (item.id === 'search' && searchOpen ? ' active' : '')}
                    data-testid={`nav-${item.id}`}
                    onClick={() => handleNav(item.id)}
                  >
                    <span className="y-nav-icon">
                      <Icon name={item.icon} size={16} />
                    </span>
                    {item.label}
                  </button>
                )
              )}
            </nav>

            <div className="y-projects">
              <div className="y-section-label">Open folders</div>
              {filteredProjects.length === 0 ? (
                <button type="button" className="y-empty-projects" onClick={() => void openProject()}>
                  <span className="y-project-icon"><FolderIcon open={false} size={14} /></span>
                  Add a folder
                </button>
              ) : null}
              {filteredProjects.map((proj) => {
                const chatListExpanded = Boolean(expandedChatProjects[proj.id])
                const hiddenChatCount = Math.max(0, proj.chats.length - CHAT_LIST_COLLAPSED_LIMIT)
                const visibleChats = chatListExpanded ? proj.chats : proj.chats.slice(0, CHAT_LIST_COLLAPSED_LIMIT)
                return (
                <div key={proj.id} className={'y-project' + (proj.open ? '' : ' is-closed')}>
                  <button type="button" className="y-project-head" title={proj.path} onClick={() => toggleProject(proj.id)}>
                    <span className="y-project-icon"><FolderIcon open={proj.open} size={20} /></span>
                    <span className="y-project-name">{proj.name}</span>
                    <span
                      className={'y-project-more' + (openProjectMenuId === proj.id ? ' is-open' : '')}
                      role="button"
                      tabIndex={0}
                      aria-label={`Folder actions for ${proj.name}`}
                      title="Folder actions"
                      onClick={(event) => {
                        event.stopPropagation()
                        setOpenProjectMenuId((id) => (id === proj.id ? null : proj.id))
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        setOpenProjectMenuId((id) => (id === proj.id ? null : proj.id))
                      }}
                    >
                      <Icon name="more" size={14} />
                    </span>
                    <span
                      className="y-project-new-chat"
                      role="button"
                      tabIndex={0}
                      aria-label={`New chat in ${proj.name}`}
                      title="New chat"
                      onClick={(event) => {
                        event.stopPropagation()
                        void newChatFromProject(proj.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        void newChatFromProject(proj.id)
                      }}
                    >
                      <Icon name="plus" size={13} />
                    </span>
                    <span className="y-chevron"><Icon name="chevron" size={11} /></span>
                  </button>
                  {openProjectMenuId === proj.id ? (
                    <div className="y-project-menu" onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="y-project-menu-item" onClick={() => void removeProject(proj.id)}>
                        Remove folder
                      </button>
                    </div>
                  ) : null}
                  {proj.open ? (
	                    <div className="y-chat-list" data-runtime-version={runtimeVersion}>
	                      {visibleChats.map((c, i) => {
	                        const chatRuntime = runtimesRef.current[c.id]
	                        const running = Boolean(chatRuntime?.busy)
	                        const done = Boolean(doneChats[c.id]) && !running
	                        const renaming = renamingChat?.chatId === c.id
	                        const isolated = isIsolatedChat(c, proj)
	                        return (
	                          <div
	                            role="button"
	                            tabIndex={0}
	                            key={c.id || i}
	                            className={'y-chat-item' + (c.id === activeChatId ? ' active' : '')}
	                            data-testid={c.id === activeChatId ? 'active-chat' : undefined}
	                            onClick={() => selectChat(proj.id, c.id)}
	                            onDoubleClick={() => beginRenameChat(proj.id, c)}
	                            onKeyDown={(event) => {
	                              if (event.key === 'Enter') selectChat(proj.id, c.id)
	                            }}
	                          >
	                            {running || done ? (
	                              <span className="y-chat-indicator" data-state={running ? 'running' : 'done'}>
	                                {running ? <span className="y-chat-spinner" data-testid="chat-running-indicator" /> : <span className="y-chat-done" data-testid="chat-done-indicator" />}
	                              </span>
	                            ) : null}
	                            {isolated && !renaming ? (
	                              <span className="y-chat-isolated-icon" title="Isolated workspace">
	                                <Icon name="branch" size={13} />
	                              </span>
	                            ) : null}
	                            {renaming ? (
	                              <input
	                                className="y-chat-rename"
	                                data-testid="chat-rename-input"
	                                value={renamingChat.title}
	                                autoFocus
	                                onClick={(event) => event.stopPropagation()}
	                                onDoubleClick={(event) => event.stopPropagation()}
	                                onChange={(event) =>
	                                  setRenamingChat({ projectId: proj.id, chatId: c.id, title: event.currentTarget.value })
	                                }
	                                onBlur={submitRenameChat}
	                                onKeyDown={(event) => {
	                                  event.stopPropagation()
	                                  if (event.key === 'Enter') submitRenameChat()
	                                  if (event.key === 'Escape') cancelRenameChat()
	                                }}
	                              />
	                            ) : (
	                              <span className="y-chat-title">{c.title}</span>
	                            )}
	                            {!renaming ? (
	                              <span className="y-chat-right">
	                                {c.updatedAt ? <span className="y-chat-meta">{formatAge(c.updatedAt)}</span> : null}
	                                <span className="y-chat-actions">
	                                  <button
	                                    type="button"
	                                    className="y-chat-action"
	                                    aria-label="Archive chat"
	                                    title="Archive chat"
	                                    onClick={(event) => {
	                                      event.stopPropagation()
	                                      void archiveChat(proj.id, c.id)
	                                    }}
	                                  >
	                                    <Icon name="archive" size={13} />
	                                  </button>
	                                </span>
	                              </span>
	                            ) : null}
	                          </div>
	                        )
	                      })}
                        {hiddenChatCount > 0 ? (
                          <button type="button" className="y-chat-list-toggle" onClick={() => toggleChatList(proj.id)}>
                            {chatListExpanded ? 'Show less' : 'Show more'}
                          </button>
                        ) : null}
                    </div>
                  ) : null}
                </div>
                )
              })}
            </div>

            <div className="y-sidebar-foot">
              <button type="button" className={'y-nav-btn' + (settingsOpen ? ' active' : '')} data-testid="settings-button" onClick={() => {
                const opening = !settingsOpen
                setSettingsOpen(opening)
                if (opening) {
                  trackEvent('settings_opened')
                  setFileRailOpen(false)
                  setTerminalDockOpen(false)
                  if (modifyOpen && !PREVIEW) window.y.modify.close()
                }
              }}>
                Settings
              </button>
              <button
                type="button"
                className={'y-feedback-btn' + (feedbackOpen ? ' active' : '')}
                aria-label="Send feedback"
                title="Send feedback"
                onClick={() => {
                  trackEvent('feedback_dialog_opened', { source: settingsOpen ? 'settings' : 'sidebar' })
                  setFeedbackOpen(true)
                }}
              >
                <Icon name="help" size={16} />
              </button>
            </div>
          </div>
          <div
            className="y-resize-handle y-resize-handle-x y-sidebar-resize"
            role="separator"
            tabIndex={sidebarOpen ? 0 : -1}
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            onPointerDown={(event) => beginHorizontalResize(event, sidebarWidth, 1, 210, 420, setSidebarWidth, () => setSidebarOpen(false))}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setSidebarWidth((width) => clampPanelSize(width - 10, 210, 420))
              if (event.key === 'ArrowRight') setSidebarWidth((width) => clampPanelSize(width + 10, 210, 420))
            }}
          />
        </aside>

	        <div
	          className={'y-main' + (dragActive ? ' is-dragging' : '')}
	          data-testid="y-main"
	          onDragEnter={handleChatDrag}
	          onDragOver={handleChatDrag}
	          onDragLeave={handleChatDragLeave}
	          onDrop={handleChatDrop}
	        >
	          {toast ? <div className="y-toast">{toast}</div> : null}
	          {isolationChoice ? (
	            <div className="y-modal-backdrop" role="presentation" onMouseDown={cancelIsolationChoice}>
	              <div
	                className="y-isolation-dialog"
	                role="dialog"
	                aria-modal="true"
	                aria-labelledby="y-isolation-title"
	                tabIndex={-1}
	                onKeyDown={onIsolationKeyDown}
	                onMouseDown={(event) => event.stopPropagation()}
	              >
	                <h2 id="y-isolation-title" className="y-isolation-title">Use an isolated workspace?</h2>
	                <p className="y-isolation-copy">
	                  y can create a separate Git worktree for this chat so agents can run in parallel without editing the same files.
	                  Your current folder stays untouched.
	                </p>
	                <div className="y-isolation-path" title={isolationChoice.projectName}>{isolationChoice.projectName}</div>
	                <div className="y-isolation-actions">
	                  <button type="button" className="y-isolation-action" onClick={() => void chooseIsolation(false)}>
	                    Use same folder
	                  </button>
	                  <button type="button" className="y-isolation-action primary" onClick={() => void chooseIsolation(true)}>
	                    Isolate workspace
	                  </button>
	                </div>
	              </div>
	            </div>
	          ) : null}
	          {feedbackOpen ? (
	            <div className="y-modal-backdrop" role="presentation" onMouseDown={() => setFeedbackOpen(false)}>
	              <div className="y-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="y-feedback-title" onMouseDown={(event) => event.stopPropagation()}>
	                <div className="y-feedback-head">
	                  <div>
	                    <h2 id="y-feedback-title">Send feedback</h2>
	                    <p>Tell us what broke, what feels off, or what you want y to do better.</p>
	                  </div>
	                  <button type="button" className="y-feedback-close" aria-label="Close feedback" onClick={() => setFeedbackOpen(false)}>
	                    <Icon name="x" size={14} />
	                  </button>
	                </div>
	                <div className="y-feedback-form">
	                  <textarea
	                    value={feedbackMessage}
	                    onChange={(event) => setFeedbackMessage(event.currentTarget.value)}
	                    placeholder="What should we know?"
	                    autoFocus
	                  />
	                  <div className="y-feedback-actions">
	                    <button type="button" className="y-feedback-submit" disabled={!feedbackMessage.trim() || feedbackSending} onClick={() => void submitFeedback()}>
	                      {feedbackSending ? 'Sending...' : 'Send'}
	                    </button>
	                  </div>
	                </div>
	              </div>
	            </div>
	          ) : null}
          <header className="y-header">
            <div className="y-header-lead" aria-hidden="true" />
            <div className="y-header-drag">
              <span className="y-title" data-testid="chat-title" title={settingsOpen ? 'Settings' : !onboardingDone ? 'Welcome to y' : title}>{settingsOpen ? 'Settings' : !onboardingDone ? 'Welcome to y' : title}</span>
              {settingsOpen ? (
                <div className="y-header-actions">
                  <button type="button" className="y-icon-btn y-settings-header-close" aria-label="Close settings" title="Close settings" onClick={() => setSettingsOpen(false)}>
                    <Icon name="x" size={15} />
                  </button>
                </div>
              ) : null}
	              {!settingsOpen ? <div className="y-header-actions">
	              <button
	                type="button"
	                className={'y-icon-btn' + (terminalDockOpen ? ' active' : '')}
	                data-testid="terminal-dock-button"
	                aria-label={terminalDockOpen ? 'Hide terminal' : 'Open terminal'}
	                title={terminalDockOpen ? 'Hide terminal' : 'Open terminal'}
	                onClick={() => {
	                  if (terminalDockOpen) {
	                    setTerminalDockOpen(false)
	                    return
	                  }
	                  if (composerTerminal) setTerminalDockOpen(true)
	                  else startTerminal(undefined, 'Terminal')
	                }}
	                disabled={!activeProjectId}
	              >
	                <Icon name="terminal" size={14} />
	              </button>
	              <button
                  type="button"
                  className={'y-icon-btn' + (fileRailOpen ? ' active' : '')}
                  data-testid="file-rail-button"
                  aria-label={fileRailOpen ? 'Hide files' : 'Open files'}
                  title={fileRailOpen ? 'Hide files' : 'Open files'}
                  onClick={() => {
                    if (fileRailOpen) {
                      setFileRailOpen(false)
                      return
                    }
                    if (modifyOpen && !PREVIEW) window.y.modify.close()
                    setFileRailOpen(true)
                  }}
                  disabled={!activeProjectId}
                >
                  <Icon name="files" size={14} />
                </button>
              {!PREVIEW && window.y.modify ? (
                <button
                  type="button"
                  className={'y-modify-btn' + (modifyOpen ? ' active' : '')}
                  data-testid="modify-button"
                  aria-label={modifyOpen ? 'Hide Modify' : 'Open Modify'}
                  title={modifyOpen ? 'Hide Modify' : 'Open Modify'}
                  aria-pressed={modifyOpen}
                  onClick={() => {
                    if (modifyOpen) {
                      window.y.modify.close()
                      return
                    }
                    setFileRailOpen(false)
                    window.y.modify.open()
                  }}
                >
                  <Icon name="edit" size={14} />
                  Modify
                </button>
              ) : null}
            </div> : null}
            </div>
          </header>

          {settingsOpen ? (
            <SettingsView
              accountUser={accountUser}
              accountBusy={accountBusy}
              accountChecking={accountChecking}
              soundEnabled={soundEnabled}
              onSoundEnabled={setSoundEnabled}
              engines={engines}
              catalog={catalog}
              cliStatus={cliStatus}
              onAccountSignIn={() => void signInFromSettings()}
              onAccountSignOut={() => void signOutFromSettings()}
              onResetOriginalApp={() => {
                if (!window.confirm('Reset y to the original app? This replaces your current customized app.')) return
                void window.y.userland.resetToSeed().then((res) => {
                  if (!res.ok) {
                    showToast(res.error || 'Could not reset y.')
                    return
                  }
                  showToast('Reset to original y.')
                  setSettingsOpen(false)
                })
              }}
              onOpenPlugins={(engine) => { terminalCommand(providerSlashCommandFor(engine, '/plugins'), `${LABELS[engine] || engine} plugins`) }}
              onOpenMcp={(engine) => { terminalCommand(providerSlashCommandFor(engine, '/mcp'), `${LABELS[engine] || engine} MCP`) }}
              onAuthStatus={(engine) => { terminalCommand(providerStatusCommand(engine, 'auth'), `${LABELS[engine] || engine} auth`) }}
              onDoctor={(engine) => { terminalCommand(providerStatusCommand(engine, 'doctor'), `${LABELS[engine] || engine} doctor`) }}
            />
          ) : !onboardingDone ? (
            <OnboardingView
              catalog={catalog}
              onFinish={() => setOnboardingDone(true)}
            />
          ) : <>
          {activeFile ? (
            <div className="y-file-view" data-testid="file-view">
              <div className="y-file-toolbar">
                <FileIcon name={activeFile.name} size={20} />
                <span className="y-file-name" title={fileDisplayPath(activeFile)}>{fileDisplayPath(activeFile)}</span>
                <div className="y-segment" role="tablist" aria-label="File view mode">
                  {activeFileDiff ? (
                    <button
                      type="button"
                      className={fileMode === 'diff' ? 'active' : ''}
                      onClick={() => setFileMode('diff')}
                    >
                      Diff
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={fileMode === 'preview' ? 'active' : ''}
                    onClick={() => setFileMode('preview')}
                  >
                    {isMarkdownFile(activeFile) ? 'Preview' : 'View'}
                  </button>
                  <button
                    type="button"
                    className={fileMode === 'edit' ? 'active' : ''}
                    onClick={() => setFileMode('edit')}
                  >
                    Edit
                  </button>
                </div>
                <span className="y-file-spacer" />
                {fileStatus ? <span className="y-file-status">{fileStatus}</span> : null}
                <button
                  type="button"
                  className="y-file-action"
                  data-testid="file-save-button"
                  onClick={() => void saveActiveFile()}
                  disabled={fileContent === savedFileContent}
                >
                  Save
                </button>
                <button type="button" className="y-icon-btn" aria-label="Close file" onClick={closeFileView}>
                  <Icon name="x" size={14} />
                </button>
              </div>
              <div className="y-file-body">
                {fileMode === 'diff' && activeFileDiff ? (
                  <FileDiffPreview diff={activeFileDiff} fileName={activeFile.name} content={fileContent} oldContent={activeFileOldContent} />
                ) : isImageFile(activeFile) ? (
                  <div className="y-file-image">
                    {fileContent ? (
                      <img src={fileContent} alt={activeFile.name} className="y-file-img" />
                    ) : (
                      <span style={{ color: 'var(--y-text-3)', fontSize: 13 }}>{fileStatus || 'Loading...'}</span>
                    )}
                  </div>
                ) : fileMode === 'preview' && isMarkdownFile(activeFile) ? (
                  <div className="y-file-markdown" data-testid="markdown-preview">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{ code: MarkdownCode }}
                    >
                      {normalizeMarkdownFences(fileContent)}
                    </ReactMarkdown>
                  </div>
                ) : fileMode === 'preview' ? (
                  <pre className="y-file-code-pre" aria-label={`View ${activeFile.name}`}>
                    <code dangerouslySetInnerHTML={{
                      __html: hljsHighlight(fileContent, codeFileLang(activeFile.name)) || ' '
                    }} />
                  </pre>
                ) : isCodeFile(activeFile) ? (
                  <div className="y-file-editor-shell">
                    <pre aria-hidden="true">
                      <code dangerouslySetInnerHTML={{
                        __html: hljsHighlight(fileContent, codeFileLang(activeFile.name)) || ' '
                      }} />
                    </pre>
                    <textarea
                      data-testid="file-editor"
                      spellCheck={false}
                      value={fileContent}
                      onChange={(event) => setFileContent(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                          event.preventDefault()
                          void saveActiveFile()
                        }
                      }}
                      aria-label={`Edit ${activeFile.name}`}
                    />
                  </div>
                ) : (
                  <textarea
                    className="y-file-editor"
                    data-testid="file-editor"
                    spellCheck={false}
                    value={fileContent}
                    onChange={(event) => setFileContent(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                        event.preventDefault()
                        void saveActiveFile()
                      }
                    }}
                    aria-label={`Edit ${activeFile.name}`}
                  />
                )}
              </div>
            </div>
          ) : empty ? (
            <div className="y-empty" data-testid="empty-state">
              <div className="y-empty-inner">
                <BinaryYMark key={activeChatId} />
                <p className="y-empty-copy">
                  {hasProject ? 'Ask anything about your code.' : 'Open a folder to start a real project chat.'}
                </p>
              </div>
            </div>
          ) : (
	            <div
	              ref={logRef}
	              className="y-log"
	              data-testid="chat-log"
	              onScroll={(event) => {
	                const log = event.currentTarget
	                stickToBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80
	              }}
	            >
	              <div className="y-log-inner">
                {messages.map((m, i) => {
                  const key = `${m.role}-${m.id ?? i}`
                  if (hiddenWork.has(i)) return null
	                  if (m.role === 'thinking') return <ChatThinkingBlock key={key} message={m} classes={CHAT_SURFACE_CLASSES.main} />
	                  if (m.role === 'user') {
		                    const editingDraft =
			                      editingMessage?.chatId === activeChatId && editingMessage?.index === i ? editingMessage : null
	                    return (
	                      <ChatUserMessage
                          key={key}
                          text={m.text ?? ''}
                          editingText={editingDraft?.text}
                          classes={CHAT_SURFACE_CLASSES.main}
                          testId="user-message"
                          editTestId="inline-edit-input"
                          actions={Boolean(activeChatId)}
                          onCopy={() => copyMessage(m.text ?? '')}
                          onStartEdit={() => activeChatId ? beginEditUserMessage(activeChatId, i, m.text ?? '') : undefined}
                          onEditChange={(text) => setEditingMessage({ chatId: activeChatId || '', index: i, text })}
                          onSubmitEdit={() => {
                            if (activeChatId) void submitEditedUserMessage(activeChatId, i)
                          }}
                          onCancelEdit={cancelEditUserMessage}
                        />
	                    )
	                  }
	                  if (m.role === 'assistant') {
	                    const assistantMessage = (
	                      <ChatAssistantMessage
                          key={key}
                          text={m.text ?? ''}
                          streaming={Boolean(m.streaming)}
                          checkpointId={activeChatId ? m.checkpointId : undefined}
                          classes={CHAT_SURFACE_CLASSES.main}
                          testId="assistant-message"
	                          onCopy={() => copyMessage(m.text ?? '')}
	                          onLinkClick={openAssistantFileLink}
	                          onReset={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open')
                            if (activeChatId) void resetToMessage(activeChatId, i)
                          }}
                        />
	                    )
	                    const work = collapsedTurns.get(i)
	                    if (!work) return assistantMessage
	                    return (
	                      <div key={`completed-${key}`} className={CHAT_SURFACE_CLASSES.main.completedTurn}>
	                        <ChatWorkSummary
                            work={work}
                            durationMs={m.durationMs}
                            interrupted={m.interrupted}
                            classes={CHAT_SURFACE_CLASSES.main}
                            testId="work-log"
                            formatDuration={formatDuration}
                            langFromTarget={langFromToolTarget}
                          />
	                        {assistantMessage}
	                        <ChatEditedFilesSummary
                            work={work}
                            classes={CHAT_SURFACE_CLASSES.main}
                            testId="edited-files"
                            onUndo={() => activeChatId ? void undoTurnEdits(activeChatId, i) : undefined}
                            onOpenFile={(file, diff, oldContent) => void openEditedFileTarget(file, diff, oldContent)}
                          />
	                      </div>
	                    )
	                  }
	                  if (m.role === 'tool') {
	                    if (m.system) return <div key={key} className={CHAT_SURFACE_CLASSES.main.toolNote}>{m.name}</div>
                    return <ChatToolMessage key={key} message={m} langFromTarget={langFromToolTarget} />
	                  }
	                  return null
	                })}
                {busy ? <div className="y-live-work"><BinarySpinner /><span>{liveWorkLabel}</span></div> : null}
                {!busy && status ? <div className="y-status">{status}</div> : null}
                {error ? <div className="y-error">{error}</div> : null}
              </div>
            </div>
          )}

	          {!activeFile && onboardingDone ? <div className="y-composer-wrap">
	            {activeChatId && queuedFollowUps[activeChatId]?.length ? (
              <div className="y-queued-stack" data-testid="queued-follow-up-stack">
                {queuedFollowUps[activeChatId].map((item, index) => (
	                  <div key={item.id} className="y-queued" data-testid="queued-follow-up">
	                    <span className="y-queued-label">Queued {index + 1}</span>
	                    {item.goal ? <span className="y-queued-label">Goal</span> : null}
	                    <span className="y-queued-text">{item.text}</span>
                    <button type="button" className="y-queued-steer" disabled={item.steer} onClick={() => requestQueuedSteer(activeChatId, item.id)}>
                      {item.steer ? 'Steering...' : 'Steer'}
                    </button>
                    <button
                      type="button"
                      className="y-queued-remove"
                      aria-label={`Remove queued follow-up ${index + 1}`}
                      onClick={() => updateQueuedFollowUps((queued) => {
                        const remaining = (queued[activeChatId] ?? []).filter((queuedItem) => queuedItem.id !== item.id)
                        const next = { ...queued, [activeChatId]: remaining }
                        if (!remaining.length) delete next[activeChatId]
                        return next
                      })}
                    >×</button>
                  </div>
                ))}
              </div>
            ) : null}
            <ChatComposerShell
              classes={CHAT_SURFACE_CLASSES.main}
              testId="composer"
              inputTestId="composer-input"
              inputRef={composerInputRef}
              isDropTarget={dragActive}
              dropOverlay={<Icon name="files" size={22} />}
              placeholder={composerMode === 'goal' ? 'Write the goal for this chat...' : !hasProject ? 'Open a folder to start...' : sessionId ? 'Ask for follow-up changes' : 'Starting engine...'}
              onInput={handleComposerInput}
              onPaste={handleComposerPaste}
              onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault()
                    send()
                  }
                }}
            >
              {slashSuggestions.length ? (
                <div className="y-suggest" data-testid="slash-suggestions">
                  {slashSuggestions.map((item) => (
                    <button type="button" key={item.name} className="y-suggest-item" onClick={() => chooseSlashCommand(item.name)}>
                      <Icon name={item.source === 'Claude' ? 'plugins' : 'auto'} size={16} />
                      <span className="y-suggest-main">
                        <span className="y-suggest-title">{item.name}</span>
                        {item.detail ? <span className="y-suggest-sub">{item.detail}</span> : null}
                      </span>
                      {item.source ? <span className="y-suggest-source">{item.source}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {fileSuggestions.length ? (
                <div className="y-suggest" data-testid="file-suggestions">
                  {fileSuggestions.map((file) => (
                    <button type="button" key={file.path} className="y-suggest-item" onClick={() => chooseMention(file)}>
                      <FileIcon name={file.name} />
                      <span className="y-suggest-main">
                        <span className="y-suggest-title">{file.name}</span>
                        <span className="y-suggest-sub">{file.relPath || file.path}</span>
                      </span>
                      {formatBytes(file.size) ? <span className="y-suggest-source">{formatBytes(file.size)}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {attachments.length || pastedAttachments.length ? (
                <div className="y-attachments" data-testid="attachments">
                  {attachments.map((file) => (
                    <div key={file.path} className="y-attachment" title={file.path}>
                      <FileIcon name={file.name} size={18} />
                      <span className="y-attachment-name">{file.name}</span>
                      {formatBytes(file.size) ? <span className="y-attachment-size">{formatBytes(file.size)}</span> : null}
                      <button
                        type="button"
                        className="y-attachment-remove"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setAttachments((list) => list.filter((item) => item.path !== file.path))}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  {pastedAttachments.map((item) => (
                    <div key={item.id} className="y-attachment" title={item.name} data-testid="pasted-text-attachment">
                      <FileIcon name={item.name} size={18} />
                      <span className="y-attachment-name">{item.name}</span>
                      <span className="y-attachment-size">{formatBytes(item.size) || `${item.size} bytes`}</span>
                      <button
                        type="button"
                        className="y-attachment-remove"
                        aria-label={`Remove ${item.name}`}
                        onClick={() => setPastedAttachments((list) => list.filter((entry) => entry.id !== item.id))}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className={CHAT_SURFACE_CLASSES.main.composerRow}>
                <button type="button" className="y-round-btn" aria-label="Attach files" title="Attach files" onClick={() => void attachFiles()} disabled={!hasProject || busy}>
                  <Icon name="plus" size={14} />
                </button>
                <YDropdown
                  value={engineId}
                  options={pickerCatalog.map(function (e) { return { id: e.engine, label: e.label } })}
                  disabled={busy}
                  title="Choose coding agent"
                  renderLabel={function (id, label) {
                    const entry = pickerCatalog.find(function (e) { return e.engine === id })
                    return (
                      <>
                        <EngineMark id={id} logoUrl={entry?.logoUrl} size={13} />
                        <span className="y-drop-label">{label}</span>
                      </>
                    )
                  }}
                  renderItem={function (id, label) {
                    const entry = pickerCatalog.find(function (e) { return e.engine === id })
                    return (
                      <>
                        <EngineMark id={id} logoUrl={entry?.logoUrl} size={13} />
                        <span>{label}</span>
                      </>
                    )
                  }}
                  onChange={function (eng) {
                    const entry = pickerCatalog.find(function (e) { return e.engine === eng })
                    start(eng, entry?.defaultModel ?? '')
                  }}
                />
                {(function () {
                  const { base, effort } = parseModelId(modelId)
                  const bases = catalogBaseModels(pickerCatalog, engineId)
                  const efforts = catalogEfforts(pickerCatalog, engineId, base)
                  const effortBarMax = engineId === 'codex' ? 4 : 5
                  return (
                    <>
                      <YDropdown
                        value={base}
                        options={bases}
                        disabled={busy || bases.length === 0}
                        title="Choose model"
                        renderLabel={function (_id, label) {
                          return <span className="y-drop-label">{label}</span>
                        }}
                        renderItem={function (_id, label) {
                          return <span>{label}</span>
                        }}
                        onChange={function (nb) {
                          const ne = catalogEfforts(pickerCatalog, engineId, nb)
                          start(engineId, buildModelId(nb, ne.find(function (x) { return x.id === effort })?.id ?? ne[0]?.id ?? 'medium'))
                        }}
                      />
                      <YDropdown
                        value={effort}
                        options={efforts}
                        disabled={busy || efforts.length === 0}
                        title="Choose reasoning effort"
                        renderLabel={function (id, label) {
                          return (
                            <>
                              <EffortBars effort={id} maxBars={effortBarMax} size={15} />
                              <span className="y-drop-label">{label}</span>
                            </>
                          )
                        }}
                        renderItem={function (id, label) {
                          return (
                            <>
                              <EffortBars effort={id} maxBars={effortBarMax} size={15} />
                              <span>{label}</span>
                            </>
                          )
                        }}
                        onChange={function (ef) { start(engineId, buildModelId(base, ef)) }}
                      />
                      {engineId === 'codex' ? (
                        <>
                          <button
                            type="button"
                            className={'y-round-btn y-goal-btn' + (activeGoalRunning || composerMode === 'goal' ? ' is-active' : '')}
                            aria-label={composerMode === 'goal' ? 'Turn goal mode off' : activeGoalRunning ? 'Codex goal is running' : 'Turn goal mode on'}
                            title={composerMode === 'goal' ? 'Turn goal mode off' : activeGoalRunning ? 'Codex goal is running' : 'Turn goal mode on'}
                            onClick={beginGoalComposer}
                            disabled={!hasProject || activeGoalRunning}
                          >
                            <Icon name="goal" size={15} />
                          </button>
                          {activeGoalRunning ? (
                            <span className="y-composer-goal-chip" title="Codex is running a goal">Goal running</span>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  )
                })()}
                <button
                  type="button"
                  className="y-send"
                  data-testid="send-button"
                  onClick={submitOrInterrupt}
                  disabled={!busy && !slashReady && (((!PREVIEW && !hasProject) || !sessionId))}
                  aria-label={busy && !hasComposerInput && !pastedAttachments.length ? 'Pause' : busy ? 'Queue follow-up' : 'Send'}
                  title={busy && !hasComposerInput && !pastedAttachments.length ? 'Stop current response' : busy ? 'Queue follow-up' : 'Send message'}
                >
                  <Icon name={busy && !hasComposerInput && !pastedAttachments.length ? 'stop' : 'send'} size={16} />
                </button>
              </div>
	            </ChatComposerShell>
	          </div> : null}
	          </>}
	          {composerTerminal ? (
	            <div
	              className={'y-terminal-dock' + (terminalDockOpen ? ' is-open' : '')}
	              data-testid="terminal-dock"
	              aria-hidden={!terminalDockOpen}
	              style={{ '--y-terminal-height': `${terminalHeight}px` } as CSSProperties}
	            >
	              <div
	                className="y-resize-handle y-resize-handle-y"
	                role="separator"
	                tabIndex={terminalDockOpen ? 0 : -1}
	                aria-label="Resize terminal"
	                aria-orientation="horizontal"
	                onPointerDown={beginTerminalResize}
	                onKeyDown={(event) => {
	                  if (event.key === 'ArrowUp') setTerminalHeight((height) => clampPanelSize(height + 10, 180, 560))
	                  if (event.key === 'ArrowDown') setTerminalHeight((height) => clampPanelSize(height - 10, 180, 560))
	                }}
	              />
	              <div className="y-composer-terminal" data-testid="composer-terminal">
	                <div className="y-composer-terminal-bar">
	                  <span className="y-composer-terminal-title">
	                    <Icon name="terminal" size={14} />
	                    {composerTerminal.title}
	                  </span>
	                  <button type="button" className="y-composer-terminal-close" aria-label="Hide terminal" onClick={closeComposerTerminal}>×</button>
	                </div>
	                {PREVIEW ? (
	                  <pre className="y-composer-terminal-screen">{composerTerminal.body || 'Starting terminal...'}</pre>
	                ) : (
	                  <XtermTerminal
	                    id={composerTerminal.id}
	                    running={composerTerminal.running}
	                    initialText={composerTerminal.body || undefined}
	                  />
	                )}
	              </div>
	            </div>
	          ) : null}
	        </div>

        <aside
          className={'y-file-rail' + (fileRailOpen ? ' is-open' : '')}
          data-testid="file-rail"
          aria-hidden={!fileRailOpen}
          style={{ '--y-file-rail-width': `${fileRailWidth}px` } as CSSProperties}
        >
            <div
              className="y-resize-handle y-resize-handle-x y-file-resize"
              role="separator"
              tabIndex={fileRailOpen ? 0 : -1}
              aria-label="Resize Files sidebar"
              aria-orientation="vertical"
              onPointerDown={(event) => beginHorizontalResize(event, fileRailWidth, -1, 260, 560, setFileRailWidth, () => setFileRailOpen(false))}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') setFileRailWidth((width) => clampPanelSize(width + 10, 260, 560))
                if (event.key === 'ArrowRight') setFileRailWidth((width) => clampPanelSize(width - 10, 260, 560))
              }}
            />
            <div className="y-file-rail-head">
              <span className="y-file-rail-title">
                <Icon name="files" size={14} />
                Files
              </span>
              <button type="button" className="y-icon-btn" aria-label="Close files" onClick={() => setFileRailOpen(false)}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="y-file-rail-list">
              {projectDirectories['']?.length ? (
                buildVisibleTree(projectDirectories, expandedFolders).map((node) => {
                  const indent = 10 + node.depth * 16
                  if (node.kind === 'folder') {
                    const isOpen = expandedFolders.has(node.folderPath)
                    return (
                      <button
                        type="button"
                        key={node.folderPath}
                        className="y-file-row y-file-folder"
                        style={{ paddingLeft: indent }}
                        onClick={() => {
                          const opening = !expandedFolders.has(node.folderPath)
                          setExpandedFolders((prev) => {
                            const next = new Set(prev)
                            if (next.has(node.folderPath)) next.delete(node.folderPath)
                            else next.add(node.folderPath)
                            return next
                          })
                          if (opening && activeProjectId) void loadProjectDirectory(activeProjectId, node.folderPath)
                        }}
                      >
                        <FolderIcon open={isOpen} size={20} />
                        <span className="y-file-row-name">{node.name}</span>
                        <span className="y-file-folder-chevron" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                          <Icon name="chevron" size={12} />
                        </span>
                        {loadingFolders.has(`${activeProjectId}:${node.folderPath}`) ? <span className="y-file-loading">...</span> : null}
                      </button>
                    )
                  }
                  return (
                    <button
                      type="button"
                      key={node.file.path}
                      className={'y-file-row' + (activeFile?.path === node.file.path ? ' active' : '')}
                      data-testid="file-tree-item"
                      style={{ paddingLeft: indent }}
                      title={node.file.relPath || node.file.name}
                      onClick={() => void openFile(node.file)}
                    >
                      <FileIcon name={node.name} size={20} />
                      <span className="y-file-row-name">{node.name}</span>
                    </button>
                  )
                })
              ) : loadingFolders.has(`${activeProjectId}:`) ? (
                <div className="y-file-empty">Loading files...</div>
              ) : (
                <div className="y-file-empty">No files found in this folder.</div>
              )}
            </div>
          </aside>
      </div>
    </>
  )
}
