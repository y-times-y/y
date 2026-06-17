import { useEffect, useRef, useState, type CSSProperties } from 'react'
import XtermTerminal from '@renderer/kernel/XtermTerminal'
import hljs from 'highlight.js/lib/common'

// Default chat UI — lives in USERLAND (fully moddable). Uses window.y.engine bricks.
const LABELS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

const PREVIEW_CATALOG: EngineModelCatalog[] = [
  {
    engine: 'claude-code',
    label: 'Claude Code',
    defaultModel: 'claude-sonnet-4-6#effort=medium',
    models: [
      { id: 'claude-sonnet-4-6#effort=low', label: 'Sonnet 4.6 · Low' },
      { id: 'claude-sonnet-4-6#effort=medium', label: 'Sonnet 4.6 · Medium' },
      { id: 'claude-sonnet-4-6#effort=high', label: 'Sonnet 4.6 · High' },
      { id: 'claude-opus-4-8#effort=medium', label: 'Opus 4.8 · Medium' },
      { id: 'claude-opus-4-8#effort=max', label: 'Opus 4.8 · Max' },
      { id: 'claude-haiku-4-5-20251001#effort=medium', label: 'Haiku 4.5 · Medium' }
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

type ChatRuntime = {
  sessionId?: string
  engineId?: string
  busy?: boolean
  startedAt?: number
  status?: string
  error?: string
}

type CompletionAudioContext = AudioContext & { webkitAudioContext?: never }

type ComposerTerminal = {
  id: string
  title: string
  command?: string
  body: string
  running: boolean
}

type FileTreeNode =
  | { kind: 'file'; file: SelectedFile; name: string; depth: number }
  | { kind: 'folder'; folderPath: string; name: string; depth: number }

function buildVisibleTree(files: SelectedFile[], expanded: Set<string>): FileTreeNode[] {
  const nodes: FileTreeNode[] = []
  const allFolderPaths = new Set<string>()
  for (const file of files) {
    const rel = (file.relPath || file.name).replace(/\\/g, '/')
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) {
      allFolderPaths.add(parts.slice(0, i).join('/'))
    }
  }
  function addLevel(parentPath: string, depth: number): void {
    const childFolders = [...allFolderPaths]
      .filter(fp => {
        if (parentPath === '') return fp.split('/').length === 1
        return fp.startsWith(parentPath + '/') && fp.split('/').length === parentPath.split('/').length + 1
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    const childFiles = files
      .filter(file => {
        const rel = (file.relPath || file.name).replace(/\\/g, '/')
        const parts = rel.split('/')
        if (parentPath === '') return parts.length === 1
        return parts.slice(0, -1).join('/') === parentPath
      })
      .sort((a, b) => (a.relPath || a.name).split('/').pop()!.localeCompare((b.relPath || b.name).split('/').pop()!, undefined, { sensitivity: 'base' }))
    for (const fp of childFolders) {
      nodes.push({ kind: 'folder', folderPath: fp, name: fp.split('/').pop()!, depth })
      if (expanded.has(fp)) addLevel(fp, depth + 1)
    }
    for (const file of childFiles) {
      const rel = (file.relPath || file.name).replace(/\\/g, '/')
      nodes.push({ kind: 'file', file, name: rel.split('/').pop() || file.name, depth })
    }
  }
  addLevel('', 0)
  return nodes
}

type FileMode = 'preview' | 'edit'

function defaultRunOptions(): EngineRunOptions {
  return {
    claudePermissionMode: 'default',
    claudeDangerouslySkipPermissions: true,
    codexAskForApproval: 'never',
    codexDangerouslyBypassApprovalsAndSandbox: true
  }
}

function parseModelId(id: string): { base: string; effort: string } {
  const i = id.indexOf('#effort=')
  return i === -1 ? { base: id, effort: 'medium' } : { base: id.slice(0, i), effort: id.slice(i + 8) }
}

function buildModelId(base: string, effort: string): string {
  return `${base}#effort=${effort}`
}

const SLASH_HELP = 'Commands: /effort <low|medium|high|xhigh|max>, /reasoning <level>, /goal <text>, /goal clear, /compact, /plugins [subcommand], /mcp [subcommand], /doctor, /auth <status|login|logout>, /features <list|enable|disable>, /skills, /update, /clear, /help. Provider/plugin commands appear in / when the engine reports them.'
const LONG_TASK_NOTIFY_MS = 25_000
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const BUILT_IN_COMMANDS = [
  { name: '/effort', source: 'y', detail: 'set reasoning effort' },
  { name: '/goal', source: 'engine', detail: 'show or set current goal' },
  { name: '/compact', source: 'engine', detail: 'compact context' },
  { name: '/update', source: 'engine', detail: 'update current CLI' },
  { name: '/plugins', source: 'engine', detail: 'list installed plugins' },
  { name: '/plugin', source: 'engine', detail: 'run plugin subcommands' },
  { name: '/mcp', source: 'engine', detail: 'list configured MCP servers' },
  { name: '/skills', source: 'engine', detail: 'show discoverable skill commands' },
  { name: '/doctor', source: 'engine', detail: 'check CLI health' },
  { name: '/auth', source: 'engine', detail: 'Claude auth commands' },
  { name: '/login', source: 'engine', detail: 'Codex login commands' },
  { name: '/logout', source: 'engine', detail: 'Codex logout' },
  { name: '/features', source: 'Codex', detail: 'Codex feature flags' },
  { name: '/agents', source: 'Claude', detail: 'Claude background agents' },
  { name: '/marketplaces', source: 'engine', detail: 'plugin marketplaces' },
  { name: '/terminal', source: 'y', detail: 'open an inline PTY terminal' },
  { name: '/term', source: 'y', detail: 'open an inline PTY terminal' },
  { name: '/clear', source: 'y', detail: 'clear visible chat' },
  { name: '/help', source: 'y', detail: 'show commands' }
]

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

function catalogBaseModels(cat: EngineModelCatalog[], engineId: string): Array<{ id: string; label: string }> {
  const seen = new Set<string>()
  return (cat.find(function (c) { return c.engine === engineId })?.models ?? []).reduce<Array<{ id: string; label: string }>>(function (acc, m) {
    const base = m.id.split('#')[0]
    const label = m.label.split(' · ')[0]
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

function diffStat(body?: string): { added: number; removed: number } | null {
  if (!body) return null
  let added = 0
  let removed = 0
  for (const line of body.split('\n')) {
    if (line.startsWith('+ ')) added += 1
    else if (line.startsWith('- ')) removed += 1
  }
  return added || removed ? { added, removed } : null
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

function transcriptText(value: string | undefined): string {
  return (value || '').replace(/\s+\n/g, '\n').trim()
}

function contextLine(message: Msg): string | null {
  if (message.role === 'thinking') return null
  if (message.role === 'user') return `[user]\n${transcriptText(message.text)}`
  if (message.role === 'assistant') {
    const label = LABELS[message.engineId || ''] || message.engineId || 'assistant'
    return `[assistant: ${label}]\n${transcriptText(message.text)}`
  }
  if (message.role === 'tool') {
    if (message.system) return `[y system note]\n${transcriptText(message.name)}`
    const target = message.target ? ` ${message.target}` : ''
    const body = message.body ? `\n${transcriptText(message.body)}` : ''
    return `[tool: ${message.verb || message.name || 'tool'}${target}]${body}`
  }
  return null
}

function buildContextPrompt(history: Msg[], request: string): string {
  const lines = settleContextHistory(history)
    .map(contextLine)
    .filter((line): line is string => Boolean(line))
  if (!lines.length) return request
  return (
    'Use this full visible y chat transcript as context. It may include replies from different providers. ' +
    'If the transcript is long, use your native context management/compaction behavior. ' +
    'Continue from it, but answer only the current request.\n\n' +
    lines.join('\n\n---\n\n') +
    '\n\n---\n\n[current user request]\n' +
    request
  )
}

function settleContextHistory(history: Msg[]): Msg[] {
  return history
    .filter((message) => !(message.role === 'thinking' && !message.text?.trim()))
    .map((message) => (
      message.streaming && (message.role === 'tool' || message.role === 'thinking')
        ? { ...message, streaming: false }
        : message
    ))
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

function splitBlocks(text: string) {
  const parts: { kind: 'text' | 'code'; lang?: string; value: string }[] = []
  let rest = text || ''
  while (rest.length) {
    const i = rest.indexOf('```')
    if (i === -1) {
      if (rest.trim()) parts.push({ kind: 'text', value: rest })
      break
    }
    if (i > 0) {
      const chunk = rest.slice(0, i)
      if (chunk.trim()) parts.push({ kind: 'text', value: chunk })
    }
    rest = rest.slice(i + 3)
    const nl = rest.indexOf('\n')
    const lang = normalizeLang(nl === -1 ? rest : rest.slice(0, nl))
    rest = nl === -1 ? '' : rest.slice(nl + 1)
    const end = rest.indexOf('```')
    if (end === -1) {
      const code = rest.replace(/\n$/, '')
      if (code.trim() || lang) parts.push({ kind: 'code', lang: lang, value: code })
      break
    }
    parts.push({ kind: 'code', lang: lang, value: rest.slice(0, end).replace(/\n$/, '') })
    rest = rest.slice(end + 3)
    if (rest.startsWith('\n')) rest = rest.slice(1)
  }
  return parts
}

function inlineMd(text: string) {
  let s = esc(text)
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noreferrer">$1</a>')
  return s
}

function TableBlock({ lines }: { lines: string[] }) {
  const rows = lines
    .filter(function (l) { return !/^\s*\|[\s\-:|]+\|\s*$/.test(l) })
    .map(function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim() }) })
  if (!rows.length) return null
  const header = rows[0]
  const body = rows.slice(1)
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{header.map(function (c, j) { return <th key={j} dangerouslySetInnerHTML={{ __html: inlineMd(c) }} /> })}</tr></thead>
        <tbody>{body.map(function (row, i) { return <tr key={i}>{row.map(function (c, j) { return <td key={j} dangerouslySetInnerHTML={{ __html: inlineMd(c) }} /> })}</tr> })}</tbody>
      </table>
    </div>
  )
}

function TextBlock({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const elements: React.ReactElement[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) { i++; continue }
    // Heading
    const h = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const cls = level === 1 ? 'md-h1' : level === 2 ? 'md-h2' : 'md-h3'
      elements.push(<div key={i} className={cls} dangerouslySetInnerHTML={{ __html: inlineMd(h[2]) }} />)
      i++; continue
    }
    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      elements.push(<hr key={i} className="md-hr" />)
      i++; continue
    }
    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      elements.push(<blockquote key={`q${i}`} className="md-quote" dangerouslySetInnerHTML={{ __html: inlineMd(quoteLines.join('\n')) }} />)
      continue
    }
    // Table
    if (trimmed.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(<TableBlock key={`t${i}`} lines={tableLines} />)
      continue
    }
    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i++
      }
      elements.push(<ul key={`ul${i}`} className="md-list">{items.map(function (item, j) { return <li key={j} dangerouslySetInnerHTML={{ __html: inlineMd(item) }} /> })}</ul>)
      continue
    }
    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
        i++
      }
      elements.push(<ol key={`ol${i}`} className="md-list md-olist">{items.map(function (item, j) { return <li key={j} dangerouslySetInnerHTML={{ __html: inlineMd(item) }} /> })}</ol>)
      continue
    }
    // Paragraph: collect until a structural element or blank line
    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i].trim()
      if (!l) { i++; break }
      if (/^#{1,3}\s/.test(l) || /^[-*_]{3,}\s*$/.test(l) || l.startsWith('|') || /^[-*]\s+/.test(l) || /^\d+\.\s+/.test(l) || l.startsWith('> ')) break
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length) {
      elements.push(<p key={`p${i}`} className="md-p" dangerouslySetInnerHTML={{ __html: paraLines.map(function (l) { return inlineMd(l) }).join('<br/>') }} />)
    }
  }
  return <>{elements}</>
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  if (!code.trim() && !lang) return null
  const html = hljsHighlight(code, lang)

  function copy() {
    void navigator.clipboard.writeText(code).then(function () {
      setCopied(true)
      setTimeout(function () { setCopied(false) }, 1500)
    })
  }

  return (
    <div className="md-code" data-testid="code-block">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || 'code'}</span>
        <button type="button" className="md-code-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre className="md-code-pre"><code dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} /></pre>
    </div>
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
        <path
          d="M8.5 3.5h3l2.2 2.2v3.1l-2.2 2.2h-3L6.3 8.8V5.7L8.5 3.5z"
          stroke="currentColor"
          strokeWidth={sw}
          strokeLinejoin="round"
        />
        <circle cx="10" cy="7.5" r="1.1" fill="currentColor" />
      </svg>
    )
  if (name === 'auto')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M11 3L5 11h4l-1 6 6-8h-4l1-6z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
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
  if (name === 'menu')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="5" cy="10" r="1.2" fill="currentColor" />
        <circle cx="10" cy="10" r="1.2" fill="currentColor" />
        <circle cx="15" cy="10" r="1.2" fill="currentColor" />
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
        <rect x="3" y="4" width="5" height="12" rx="1" stroke="currentColor" strokeWidth={sw} />
        <rect x="9" y="4" width="8" height="12" rx="1" stroke="currentColor" strokeWidth={sw} />
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
        <path d="M4 6h12M5 6v9.5A1.5 1.5 0 006.5 17h7a1.5 1.5 0 001.5-1.5V6M4.8 3h10.4A1.8 1.8 0 0117 4.8V6H3V4.8A1.8 1.8 0 014.8 3z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
        <path d="M8 10h4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  if (name === 'files')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6.5 3.5h5L15 7v8.5A1.5 1.5 0 0113.5 17h-7A1.5 1.5 0 015 15.5v-10A2 2 0 016.5 3.5z" stroke="currentColor" strokeWidth={sw} strokeLinejoin="round" />
        <path d="M11.5 3.8V7h3.2M8 10h4M8 13h4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
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
        <path d="M7 7H4V4M4.5 7A6.5 6.5 0 1110 17" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (name === 'chevron')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
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
        color: id === 'codex' ? '#10a37f' : '#D97757',
        background: 'rgba(255,255,255,0.06)'
      }}
    >
      {id === 'codex' ? 'O' : 'A'}
    </span>
  )
}

function YDropdown<T extends string>({
  value,
  options,
  disabled,
  renderLabel,
  renderItem,
  onChange
}: {
  value: T
  options: Array<{ id: T; label: string }>
  disabled?: boolean
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
      <button type="button" className="y-drop-btn" disabled={disabled} onClick={function () { setOpen(function (o) { return !o }) }}>
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

function AssistantBody({ text }: { text: string }) {
  const blocks = splitBlocks(text)
  return (
    <div className="md-body">
      {blocks.map(function (b, i) {
        if (b.kind === 'code') return <CodeBlock key={i} lang={b.lang || ''} code={b.value} />
        return <div key={i}><TextBlock text={b.value} /></div>
      })}
    </div>
  )
}

export default function Chat() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined)
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined)
  const [appReady, setAppReady] = useState(PREVIEW)
  const [engines, setEngines] = useState<string[]>(PREVIEW ? ['claude-code', 'codex'] : [])
  const [catalog, setCatalog] = useState<EngineModelCatalog[]>(PREVIEW ? PREVIEW_CATALOG : [])
  const [engineId, setEngineId] = useState('claude-code')
  const [modelId, setModelId] = useState('claude-sonnet-4-6#effort=medium')
  const [runOptions, setRunOptions] = useState<EngineRunOptions>(defaultRunOptions)
  const [sessionId, setSessionId] = useState<string | null>(PREVIEW ? 'preview' : null)
  const [title, setTitle] = useState('New chat')
  const [goal, setGoal] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<SelectedFile[]>([])
  const [projectFiles, setProjectFiles] = useState<SelectedFile[]>([])
  const [fileRailOpen, setFileRailOpen] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [activeFile, setActiveFile] = useState<SelectedFile | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [savedFileContent, setSavedFileContent] = useState('')
  const [fileMode, setFileMode] = useState<FileMode>('preview')
  const [fileStatus, setFileStatus] = useState('')
  const [engineCommands, setEngineCommands] = useState<Array<{ name: string; source?: string }>>([])
  const [composerTerminal, setComposerTerminal] = useState<ComposerTerminal | null>(null)
  const [queuedFollowUps, setQueuedFollowUps] = useState<Record<string, string>>({})
  const [editingMessage, setEditingMessage] = useState<{ chatId: string; index: number; text: string } | null>(null)
  const [renamingChat, setRenamingChat] = useState<{ projectId: string; chatId: string; title: string } | null>(null)
  const [_runtimeTick, setRuntimeTick] = useState(0)
  const [doneChats, setDoneChats] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [modifyOpen, setModifyOpen] = useState(false)
  const sidRef = useRef<string | null>(PREVIEW ? 'preview' : null)
  const activeRef = useRef<{ projectId?: string; chatId?: string; path?: string }>({})
  const projectsRef = useRef<Project[]>([])
  const messagesRef = useRef<Msg[]>([])
  const queuedFollowUpsRef = useRef<Record<string, string>>({})
  const seenToolEventsRef = useRef<Record<string, true>>({})
  const runtimesRef = useRef<Record<string, ChatRuntime>>({})
  const sessionToChatRef = useRef<Record<string, string>>({})
  const audioRef = useRef<CompletionAudioContext | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipPersistRef = useRef(true)
  const logRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const slashMatch = input.match(/^\/([^\s]*)$/)
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null
  const mentionMatch = input.match(/(^|\s)@([^\s@]*)$/)
  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null
  const slashSuggestions =
    slashQuery === null
      ? []
      : mergeCommandSuggestions(BUILT_IN_COMMANDS, engineCommands)
          .filter((item) => item.name.toLowerCase().slice(1).includes(slashQuery))
          .slice(0, 40)
  const fileSuggestions =
    mentionQuery === null
      ? []
      : projectFiles
          .filter((file) => (file.relPath || file.name).toLowerCase().includes(mentionQuery))
          .slice(0, 40)

  function chatEngine(chat?: AppChat): string {
    return chat?.engineId || 'claude-code'
  }

  function chatModel(chat?: AppChat, engine = chatEngine(chat)): string {
    return chat?.modelId || catalog.find(function (c) { return c.engine === engine })?.defaultModel || 'claude-sonnet-4-6#effort=medium'
  }

  function chatOptions(chat?: AppChat): EngineRunOptions {
    return chat?.runOptions || defaultRunOptions()
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
    const next = { ...(runtimesRef.current[chatId] || {}), ...patch }
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
    if (PREVIEW) return
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    if (!audioRef.current) audioRef.current = new AudioCtor()
    void audioRef.current.resume?.()
  }

  function playCompletionSound() {
    if (PREVIEW) return
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
    if (PREVIEW || activeRef.current.chatId !== chatId || !runtime?.busy) return false
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
    setActiveProjectId(project?.id)
    setActiveChatId(chat?.id)
    activeRef.current = { projectId: project?.id, chatId: chat?.id, path: project?.path }
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
    setProjects((list) =>
      {
        const next = list.map((p) => ({
        ...p,
        chats: p.chats.map((c) => (c.id === chatId ? { ...c, messages: updater(c.messages) } : c))
        }))
        projectsRef.current = next
        return next
      }
    )
    if (activeRef.current.chatId === chatId) {
      setMessages((list) => {
        const next = updater(list)
        messagesRef.current = next
        return next
      })
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
    const nextOptions = projectPath ? { ...options, workingDirectory: projectPath } : options
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
      streaming: isLive
    }
    const merge =
      prev?.role === 'tool' &&
      Boolean(e.id && prev.id === e.id)
    if (merge) {
      const merged = base.slice(0, -1).concat([
        { ...prev, ...next, target: e.target ?? prev.target, body: e.body ?? prev.body }
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
      return base.slice(0, -1).concat([{ ...prev, text: (prev.text ?? '') + chunk }])
    }
    return base.concat([{ role: 'assistant', text: chunk, engineId: sourceEngineId }])
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

  function updateQueuedFollowUps(updater: (queued: Record<string, string>) => Record<string, string>) {
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

  function sendTextToChat(chatId: string, text: string, files: SelectedFile[] = []): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false
    const runtime = runtimesRef.current[chatId]
    const targetSession = runtime?.sessionId || (PREVIEW ? sessionId : null)
    if (!targetSession) return false
    const { chat } = getChatById(chatId)
    const history = getMessagesForChat(chatId)
    const firstUserMessage = !history.some((message) => message.role === 'user')
    if (firstUserMessage && activeRef.current.chatId === chatId && title === 'New chat') setTitle(chatTitleFromText(trimmed))
    if (firstUserMessage && chat && chat.title === 'New chat') persistChatMeta(chatId, { title: chatTitleFromText(trimmed) })
    updateChatMessages(chatId, (m) => m.concat([{ role: 'user', text: trimmed }]))
    const chatGoal = activeRef.current.chatId === chatId ? goal : chat?.goal ?? ''
    const requestPrompt = chatGoal ? `Current goal:\n${chatGoal}\n\nUser request:\n${trimmed}` : trimmed
    const prompt = files.length
      ? `Attached files:\n${files.map((file) => `- ${file.path}`).join('\n')}\n\n${requestPrompt}`
      : requestPrompt
    const contextualPrompt = buildContextPrompt(history, prompt)
    armCompletionSound()
    updateQueuedFollowUps((queued) => {
      if (!queued[chatId]) return queued
      const next = { ...queued }
      delete next[chatId]
      return next
    })
    setDoneChats((prev) => {
      if (!prev[chatId]) return prev
      const next = { ...prev }
      delete next[chatId]
      return next
    })
    setRuntime(chatId, { busy: true, startedAt: Date.now(), status: '...', error: '' })
    if (PREVIEW) {
      void window.y.engine.send(targetSession, contextualPrompt)
      return true
    }
    void window.y.engine.send(targetSession, contextualPrompt)
    return true
  }

  function queueFollowUp(chatId: string, text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    updateQueuedFollowUps((queued) => ({ ...queued, [chatId]: trimmed }))
    setInput('')
  }

  function flushQueuedFollowUp(chatId: string) {
    const queued = queuedFollowUpsRef.current[chatId]
    if (!queued) return
    sendTextToChat(chatId, queued)
  }

  async function rollbackProviderTurns(chatId: string, turns: number): Promise<boolean> {
    const current = runtimesRef.current[chatId]?.sessionId
    if (!current || PREVIEW) return true
    const res = await window.y.engine.command(current, { name: 'rollback', turns })
    if (!res.ok) {
      addSystemNote(res.error || 'This engine could not rollback the code for that turn.')
      return false
    }
    if (res.message) addSystemNote(res.message)
    return true
  }

  async function revertLastTurn() {
    const chatId = activeRef.current.chatId || activeChatId
    if (!chatId) return
    const list = getMessagesForChat(chatId)
    let cut = -1
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].role === 'user') { cut = i; break }
    }
    if (cut === -1) return
    const current = runtimesRef.current[chatId]?.sessionId
    if (runtimesRef.current[chatId]?.busy && current && !PREVIEW) await window.y.engine.cancel(current)
    const rolledBack = await rollbackProviderTurns(chatId, 1)
    if (!rolledBack) return
    const nextMessages = list.slice(0, cut)
    replaceChatMessages(chatId, nextMessages)
    if (!nextMessages.some((message) => message.role === 'user')) {
      setTitle('New chat')
      persistChatMeta(chatId, { title: 'New chat' })
    }
    updateQueuedFollowUps((queued) => {
      if (!queued[chatId]) return queued
      const next = { ...queued }
      delete next[chatId]
      return next
    })
    setEditingMessage(null)
    await restartChatSession(chatId)
  }

  function beginEditUserMessage(chatId: string, index: number, text: string) {
    setEditingMessage({ chatId, index, text })
  }

  async function submitEditedUserMessage(chatId: string, index: number) {
    if (!editingMessage || editingMessage.chatId !== chatId || editingMessage.index !== index) return
    const text = editingMessage.text.trim()
    if (!text) return
    const list = getMessagesForChat(chatId)
    const turnsToRollback = Math.max(1, list.slice(index).filter((message) => message.role === 'user').length)
    const current = runtimesRef.current[chatId]?.sessionId
    if (runtimesRef.current[chatId]?.busy && current && !PREVIEW) await window.y.engine.cancel(current)
    const rolledBack = await rollbackProviderTurns(chatId, turnsToRollback)
    if (!rolledBack) return
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
    sendTextToChat(chatId, text)
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
    const noArg = ['help', 'clear', 'compact', 'plugins', 'mcp', 'skills', 'skill', 'doctor', 'agents', 'logout', 'update']
    setInput('/' + bare + (noArg.includes(bare.toLowerCase()) ? '' : ' '))
  }

  function chooseMention(file: SelectedFile) {
    const token = '@' + (file.relPath || file.name)
    setInput((value) => {
      const match = value.match(/(^|\s)@([^\s@]*)$/)
      if (!match || match.index === undefined) return `${value}${value.endsWith(' ') || !value ? '' : ' '}${token} `
      const prefix = value.slice(0, match.index) + match[1]
      return `${prefix}${token} `
    })
    setAttachments((prev) => {
      if (prev.some((item) => item.path === file.path)) return prev
      return prev.concat([file])
    })
  }

  function closeComposerTerminal() {
    const id = composerTerminal?.id
    if (id && composerTerminal.running && !PREVIEW) void window.y.terminal?.kill(id)
    setComposerTerminal(null)
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

  function providerCli(): string {
    return engineId === 'codex' ? 'codex' : 'claude'
  }

  function providerSlashCommand(name: string, args?: string): string {
    const trimmed = args?.trim()
    if (!trimmed) return `${providerCli()} ${name}`
    return `${providerCli()} ${shellQuote(`${name} ${trimmed}`)}`
  }

  function startTerminal(initialCommand?: string, label = 'Terminal'): true {
    const cwd = activeRef.current.path
    const id = `term-${Date.now()}-${Math.random().toString(16).slice(2)}`
    if (composerTerminal?.id && composerTerminal.running && !PREVIEW) {
      void window.y.terminal?.kill(composerTerminal.id)
    }
    const title = initialCommand ? `Running ${label}.` : label
    if (PREVIEW) {
      const body = initialCommand ? `$ ${initialCommand}\r\npreview terminal\r\n` : 'preview terminal\r\n'
      setComposerTerminal({ id, title, command: initialCommand, body, running: true })
      return true
    }
    if (!window.y.terminal) {
      addSystemNote('This build does not expose the terminal brick yet.')
      return true
    }
    setComposerTerminal({ id, title, command: initialCommand, body: '', running: true })
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
    return startTerminal(command, label)
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
      addSystemNote(SLASH_HELP)
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
    if (cmd === 'skills' || cmd === 'skill') {
      const discovered = engineCommands
        .map((item) => item.name.startsWith('/') ? item.name : `/${item.name}`)
        .filter((name) => !BUILT_IN_COMMANDS.some((item) => item.name.toLowerCase() === name.toLowerCase()))
      if (discovered.length) {
        addSystemNote(`Discovered provider skill/slash commands:\n${discovered.join('\n')}`)
      } else {
        runNativeCommand({ name: 'inventory', target: 'skills' }, 'Checking available skills.')
      }
      return true
    }
    if (cmd === 'update') {
      runNativeCommand({ name: 'update' }, 'Checking for engine updates.')
      return true
    }
    if (cmd === 'goal') {
      if (!arg) {
        runNativeCommand({ name: 'goal', action: 'get' }, goal ? `Current goal: ${goal}` : 'No goal is set.')
        return true
      }
      if (['clear', 'off', 'reset'].includes(arg.toLowerCase())) {
        setGoal('')
        persistChatMeta(activeRef.current.chatId, { goal: '' })
        runNativeCommand({ name: 'goal', action: 'clear' }, 'Goal cleared.')
        return true
      }
      setGoal(arg)
      persistChatMeta(activeRef.current.chatId, { goal: arg })
      runNativeCommand({ name: 'goal', action: 'set', value: arg }, `Goal set: ${arg}`)
      return true
    }
    if (cmd === 'clear') {
      clearChat()
      return true
    }
    addSystemNote(`Unknown command /${cmd}. ${SLASH_HELP}`)
    return true
  }

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
        setRuntime(chatId, { status: e.status })
      } else if (e.kind === 'text') {
        setRuntime(chatId, { status: '' })
        updateChatMessages(chatId, (m) => append(m, e.text, runtimesRef.current[chatId]?.engineId || engineId))
      } else if (e.kind === 'thinking') {
        setRuntime(chatId, { status: '' })
        updateChatMessages(chatId, (m) => appendThinking(m, e.text))
      } else if (e.kind === 'tool') {
        const runtime = runtimesRef.current[chatId]
        const existing = getMessagesForChat(chatId).some((m) => m.role === 'tool' && e.id && m.id === e.id)
        if (!PREVIEW && !runtime?.busy && !existing) return
        const signature = `${sid}:${e.id || ''}:${e.phase}:${e.name}:${e.verb || ''}:${e.target || ''}:${e.body || ''}`
        if (seenToolEventsRef.current[signature]) return
        seenToolEventsRef.current[signature] = true
        setRuntime(chatId, { status: '' })
        updateChatMessages(chatId, (m) => upsertTool(m, e))
      } else if (e.kind === 'suggestion') {
        setRuntime(chatId, { status: '' })
        updateChatMessages(chatId, (m) => m.concat([{ role: 'tool', name: `Suggested next: ${e.text}`, system: true }]))
      } else if (e.kind === 'commands') {
        setEngineCommands(e.commands)
      } else if (e.kind === 'result') {
        const runtime = runtimesRef.current[chatId]
        const notify = e.ok && shouldPlayCompletionSound(chatId, runtime)
        seenToolEventsRef.current = {}
        setRuntime(chatId, { busy: false, startedAt: undefined, status: '', error: e.ok ? '' : e.summary || 'The engine reported an error.' })
        updateChatMessages(chatId, (m) => settleTools(sealAllThinking(m)))
        if (e.ok) {
          if (notify) playCompletionSound()
          if (activeRef.current.chatId !== chatId) markChatDone(chatId)
          flushQueuedFollowUp(chatId)
        }
      } else if (e.kind === 'error') {
        seenToolEventsRef.current = {}
        setRuntime(chatId, { busy: false, startedAt: undefined, status: '', error: e.message })
        updateChatMessages(chatId, (m) => settleTools(sealAllThinking(m)))
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
    if (!appReady || !activeProjectId) return
    let disposed = false
    void window.y.app.listFiles(activeProjectId).then(function (res) {
      if (!disposed && res.ok) setProjectFiles(res.files)
    })
    return function () {
      disposed = true
    }
  }, [appReady, activeProjectId])

  useEffect(() => {
    closeFileView()
  }, [activeProjectId])

  useEffect(() => {
    if (!appReady || !activeProjectId || !activeChatId) return
    setProjects((list) =>
      list.map((p) =>
        p.id !== activeProjectId
          ? p
          : {
	              ...p,
	              chats: p.chats.map((c) =>
	                c.id === activeChatId ? { ...c, title, messages, engineId, modelId, goal, runOptions } : c
	              )
	            }
	      )
	    )
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
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages, status])

  useEffect(() => {
    if (!searchOpen) return
    const id = window.setTimeout(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [searchOpen])

  function send() {
    const text = input.trim()
    if (!text) return
    const chatId = activeRef.current.chatId || activeChatId
    if (busy) {
      if (chatId) queueFollowUp(chatId, text)
      return
    }
    if (handleSlashCommand(text)) {
      setInput('')
      return
    }
    if (!chatId) return
    setError('')
    setInput('')
    const files = attachments
    setAttachments([])
    sendTextToChat(chatId, text, files)
  }

  function steerTurn() {
    const text = input.trim()
    const chatId = activeRef.current.chatId || activeChatId
    const targetSession = chatId ? (runtimesRef.current[chatId]?.sessionId || sidRef.current || (PREVIEW ? sessionId : null)) : sidRef.current
    if (!text || !chatId) return
    setInput('')
    if (!targetSession) {
      queueFollowUp(chatId, text)
      addSystemNote('No active engine session was available; queued as a follow-up.')
      return
    }
    void window.y.engine.command(targetSession, { name: 'steer', value: buildSteeringText(text) }).then((res) => {
      if (res.ok) {
        setRuntime(chatId, { status: res.message || 'Steered the running turn.' })
        return
      }
      queueFollowUp(chatId, text)
      addSystemNote(res.error || 'This engine could not steer the running turn; queued as a follow-up.')
    })
  }

  function interruptTurn() {
    const chatId = activeRef.current.chatId || activeChatId
    const targetSession = chatId ? (runtimesRef.current[chatId]?.sessionId || sidRef.current) : sidRef.current
    if (!targetSession) return
    if (!PREVIEW) void window.y.engine.cancel(targetSession)
    if (chatId) setRuntime(chatId, { busy: false, startedAt: undefined, status: 'Interrupted.', error: '' })
    else {
      setBusy(false)
      setStatus('Interrupted.')
      setError('')
    }
  }

  function submitOrInterrupt() {
    if (busy) {
      if (input.trim()) send()
      else interruptTurn()
      return
    }
    send()
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(function () { setToast('') }, 2200)
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
    setAttachments((prev) => {
      const seen = new Set(prev.map((file) => file.path))
      const next = prev.slice()
      for (const file of res.files) {
        if (!seen.has(file.path)) {
          seen.add(file.path)
          next.push(file)
        }
      }
      return next
    })
  }

  async function refreshProjectFiles(projectId = activeProjectId) {
    if (!projectId) return
    const res = await window.y.app.listFiles(projectId)
    if (res.ok) setProjectFiles(res.files)
  }

  async function openFile(file: SelectedFile) {
    setActiveFile(file)
    setFileRailOpen(true)
    setFileStatus('Opening...')
    const res = await window.y.app.readProjectFile(activeProjectId, file.path)
    if (!res.ok) {
      setFileContent('')
      setSavedFileContent('')
      setFileStatus(res.error || 'Could not open file.')
      return
    }
    const content = res.content ?? ''
    setFileContent(content)
    setSavedFileContent(content)
    setFileMode('preview')
    setFileStatus('')
  }

  async function saveActiveFile() {
    if (!activeFile) return
    setFileStatus('Saving...')
    const res = await window.y.app.writeProjectFile(activeProjectId, activeFile.path, fileContent)
    if (!res.ok) {
      setFileStatus(res.error || 'Could not save file.')
      return
    }
    setSavedFileContent(fileContent)
    setFileStatus('Saved')
    void refreshProjectFiles()
    setTimeout(() => setFileStatus((status) => (status === 'Saved' ? '' : status)), 1400)
  }

  function closeFileView() {
    setActiveFile(null)
    setFileContent('')
    setSavedFileContent('')
    setFileStatus('')
  }

  function selectChat(projectId: string, chatId: string) {
    const project = projects.find((p) => p.id === projectId)
    const chat = project?.chats.find((c) => c.id === chatId)
    if (!project || !chat || chat.archived) return
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

  async function newChat() {
    const project = findActiveProject(projects, activeProjectId)
    if (!project) {
      showToast('Open a folder first.')
      return
    }
    const res = await window.y.app.createChat(project.id)
    if (!res.ok || !res.state) {
      showToast(res.error || 'Could not create chat.')
      return
    }
    applyState(res.state)
    const nextProject = findActiveProject(res.state.projects, res.state.activeProjectId)
    const nextChat = findActiveChat(nextProject, res.state.activeChatId)
    start(chatEngine(nextChat), chatModel(nextChat, chatEngine(nextChat)), chatOptions(nextChat), nextProject?.path, nextChat?.id)
  }

  function toggleProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    const nextOpen = !project.open
    setProjects((list) => list.map((p) => (p.id === projectId ? { ...p, open: nextOpen } : p)))
    if (!PREVIEW) void window.y.app.setProjectOpen(projectId, nextOpen)
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

  const engineLabel = LABELS[engineId] || engineId
  const hasProject = Boolean(activeProjectId && activeChatId)
  const slashReady = input.trim().startsWith('/')

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;1,400&display=swap');
        .y-app {
          --y-bg: #09090a;
          --y-sidebar: rgba(38, 30, 30, 0.82);
          --y-main: #0a0a0b;
          --y-surface: rgba(255, 255, 255, 0.045);
          --y-border: rgba(255, 255, 255, 0.08);
          --y-border-strong: rgba(255, 255, 255, 0.12);
          --y-text: rgba(255, 255, 255, 0.92);
          --y-text-2: rgba(255, 255, 255, 0.58);
          --y-text-3: rgba(255, 255, 255, 0.36);
          --y-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          --y-font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          flex: 1;
          min-height: 0;
          position: relative;
          background: var(--y-bg);
          color: var(--y-text);
          font-family: var(--y-font);
          font-size: 14px;
          line-height: 1.45;
          -webkit-font-smoothing: antialiased;
          --y-toggle-x: 10px;
        }
        html.platform-darwin .y-app {
          --y-toggle-x: 84px;
        }
        .y-sidebar {
          width: 252px;
          flex-shrink: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, rgba(44, 34, 34, 0.88) 0%, rgba(32, 26, 26, 0.78) 100%);
          backdrop-filter: blur(32px) saturate(150%);
          -webkit-backdrop-filter: blur(32px) saturate(150%);
          border-right: 1px solid rgba(255, 255, 255, 0.06);
          transition: width 0.26s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.26s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .y-sidebar.is-collapsed {
          width: 0;
          border-right-color: transparent;
        }
        .y-sidebar-inner {
          width: 252px;
          min-width: 252px;
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
          -webkit-app-region: no-drag;
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
          align-items: center;
          height: 44px;
          padding-left: var(--y-toggle-x);
          -webkit-app-region: no-drag;
          pointer-events: auto;
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
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
          padding: 0;
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
        .y-project { margin-bottom: 10px; }
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
        .y-project-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-project-icon { opacity: 0.72; display: flex; align-items: center; }
        .y-chevron {
          display: flex; align-items: center; margin-left: auto; flex-shrink: 0;
          opacity: 0; transition: opacity 0.12s ease, transform 0.15s ease;
        }
        .y-project-head:hover .y-chevron { opacity: 0.45; }
        .y-project.is-closed .y-chevron { transform: rotate(-90deg); }
        .y-chat-list {
          margin: 2px 0 0 10px; padding-left: 12px;
          border-left: 1px solid rgba(255,255,255,0.06);
        }
        .y-chat-item {
          margin-left: 0; padding: 7px 10px; border-radius: 8px; font-size: 12.5px;
          color: var(--y-text-2); cursor: pointer; border: none; background: transparent;
          font: inherit; text-align: left; width: 100%; display: flex; align-items: center; gap: 8px;
        }
        .y-chat-item:focus-visible {
          outline: 1px solid rgba(222,190,156,0.42); outline-offset: 1px;
        }
        .y-chat-item:hover { background: rgba(255,255,255,0.04); color: var(--y-text); }
        .y-chat-item.active { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-chat-title {
          flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .y-chat-rename {
          flex: 1; min-width: 0; height: 22px; padding: 0 5px; border-radius: 6px;
          border: 1px solid rgba(222,190,156,0.26); background: rgba(0,0,0,0.22);
          color: var(--y-text); font: inherit; font-size: 12.5px; outline: none;
        }
        .y-chat-right {
          margin-left: auto; flex-shrink: 0; position: relative;
          display: inline-flex; align-items: center; justify-content: flex-end;
        }
        .y-chat-meta { font-size: 11px; color: var(--y-text-3); transition: opacity 0.12s ease; white-space: nowrap; }
        .y-chat-actions {
          position: absolute; right: 0; top: 50%; transform: translateY(-50%);
          display: inline-flex; align-items: center; gap: 2px;
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
        .y-chat-action:hover { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-chat-indicator {
          width: 10px; height: 10px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
        }
        .y-chat-indicator.is-idle { opacity: 0; }
        .y-chat-done {
          width: 8px; height: 8px; border-radius: 50%; background: #6f9fd8;
          box-shadow: 0 0 0 3px rgba(111,159,216,0.12), 0 0 10px rgba(111,159,216,0.18);
        }
        .y-chat-spinner {
          width: 10px; height: 10px; border-radius: 50%;
          border: 2px solid rgba(222,190,156,0.16); border-top-color: rgba(222,190,156,0.78);
          animation: y-spin 0.9s linear infinite;
        }
        @keyframes y-spin { to { transform: rotate(360deg); } }
        .y-sidebar-foot {
          padding: 8px 10px 0; border-top: 1px solid var(--y-border); margin-top: auto;
        }
        .y-main {
          flex: 1; min-width: 0; display: flex; flex-direction: column;
          background: var(--y-main); position: relative;
          transition: flex 0.26s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .y-header {
          flex-shrink: 0; height: 44px; display: flex; align-items: stretch;
          padding: 0 14px 0 0;
        }
        .y-header-lead {
          width: calc(var(--y-toggle-x) + 28px);
          flex-shrink: 0;
          -webkit-app-region: no-drag;
        }
        .y-header-drag {
          flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
          -webkit-app-region: drag;
        }
        html.platform-darwin .y-app:not(.sidebar-closed) .y-header-drag {
          justify-content: flex-end;
        }
        .y-app:not(.sidebar-closed) .y-title { display: none; }
        .y-header button, .y-header .y-modify-btn { -webkit-app-region: no-drag; }
        .y-icon-btn {
          width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--y-border);
          background: transparent; color: var(--y-text-2); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .y-icon-btn:hover { background: rgba(255,255,255,0.04); color: var(--y-text); }
        .y-icon-btn.active {
          background: rgba(222,190,156,0.11); border-color: rgba(222,190,156,0.22); color: rgba(245,225,200,0.92);
        }
        .y-title { flex: 1; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-header-actions { display: flex; gap: 6px; align-items: center; }
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
          width: 326px;
          border-left: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.035);
          display: flex; flex-direction: column; min-height: 0;
          overflow: hidden;
          transition: width 0.26s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.26s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .y-file-rail:not(.is-open) { width: 0; border-left-color: transparent; }
        @media (prefers-reduced-motion: reduce) { .y-file-rail { transition: none; } }
        .y-file-rail-head {
          height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px 0 14px; border-bottom: 1px solid rgba(255,255,255,0.06);
          background: rgba(255,255,255,0.065);
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
          font-family: var(--y-mono); font-size: 13px; line-height: 1.65; tab-size: 2;
          color: #e4e4e4; white-space: pre; background: transparent;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .y-file-code-pre::-webkit-scrollbar { width: 5px; height: 5px; }
        .y-file-code-pre::-webkit-scrollbar-track { background: transparent; }
        .y-file-code-pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .y-file-code-pre::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .y-file-code-pre code { background: none; padding: 0; font-size: inherit; font-weight: 400; font-family: inherit; color: inherit; border-radius: 0; }
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
        .y-file-markdown > .md-body {
          max-width: 860px; margin: 0 auto; padding: 30px 34px 70px;
        }
        .y-file-markdown .md-body { font-size: 15px; line-height: 1.78; gap: 20px; }
        .y-file-markdown .md-h1 { font-size: 28px; line-height: 1.18; margin-top: 40px; margin-bottom: 10px; }
        .y-file-markdown .md-h2 { font-size: 22px; line-height: 1.25; margin-top: 32px; margin-bottom: 8px; }
        .y-file-markdown .md-h3 { font-size: 17px; line-height: 1.35; margin-top: 24px; margin-bottom: 5px; }
        .y-file-markdown .md-h1:first-child, .y-file-markdown .md-h2:first-child, .y-file-markdown .md-h3:first-child { margin-top: 4px; }
        .y-file-markdown .md-p { color: rgba(255,255,255,0.84); line-height: 1.82; margin: 3px 0; }
        .y-file-markdown .md-list { padding-left: 28px; margin: 2px 0; }
        .y-file-markdown .md-list li { margin: 7px 0; line-height: 1.72; }
        .y-file-markdown .md-quote { margin: 8px 0; padding: 14px 18px; }
        .y-file-markdown .md-code { margin: 6px 0; }
        .md-hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 22px 0; }
        .md-table-wrap { overflow-x: auto; }
        .md-table { border-collapse: collapse; width: 100%; font-size: 13.5px; line-height: 1.5; }
        .md-table th, .md-table td { padding: 7px 14px; border: 1px solid rgba(255,255,255,0.08); text-align: left; vertical-align: top; }
        .md-table th { background: rgba(255,255,255,0.05); font-weight: 600; color: var(--y-text); }
        .md-table td { color: rgba(255,255,255,0.78); }
        .md-table tr:hover td { background: rgba(255,255,255,0.025); }
        @media (max-width: 980px) {
          .y-file-rail { width: 286px; }
        }
        .y-empty {
          flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px;
        }
        .y-empty-inner { text-align: center; max-width: 420px; }
        .y-mark {
          font-family: var(--y-mono); font-size: 56px; font-weight: 600; letter-spacing: -0.03em;
          color: #fff; line-height: 1;
        }
        .y-empty-copy { margin-top: 18px; font-size: 15px; line-height: 24px; color: var(--y-text-3); }
        .y-empty-action {
          margin-top: 18px; height: 34px; padding: 0 13px; border-radius: 9px;
          border: 1px solid var(--y-border-strong); background: rgba(255,255,255,0.06);
          color: var(--y-text); font: inherit; font-size: 13px; cursor: pointer;
          display: inline-flex; align-items: center; gap: 8px;
        }
        .y-empty-action:hover { background: rgba(255,255,255,0.09); }
        .y-log { flex: 1; min-height: 0; overflow: auto; padding: 28px 24px 12px; user-select: text; }
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
        .y-engine-badge {
          align-self: flex-start; font-family: var(--y-mono); font-size: 11px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase; color: var(--y-text-3);
          background: rgba(255,255,255,0.05); border: 1px solid var(--y-border); border-radius: 6px; padding: 3px 8px;
        }
        .y-assistant-body { display: flex; flex-direction: column; gap: 12px; }
        .md-body { display: flex; flex-direction: column; gap: 12px; font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.88); }
        .md-p { margin: 0; }
        .md-list { margin: 0; padding-left: 20px; }
        .md-list li { margin: 4px 0; }
        .md-inline { font-family: 'Fira Code', 'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace; font-size: 0.88em; background: rgba(255,255,255,0.08); border-radius: 5px; padding: 1px 6px; }
        .md-code { border-radius: 12px; overflow: hidden; background: #1a1c24; border: 1px solid rgba(255,255,255,0.07); }
        .md-code-head { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.015); }
        .md-code-lang { font-family: var(--y-mono); font-size: 11px; color: rgba(255,255,255,0.3); text-transform: lowercase; }
        .md-code-copy { font: inherit; font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.35); background: transparent; border: none; cursor: pointer; }
        .md-code-copy:hover { color: rgba(255,255,255,0.7); }
        .md-code-pre {
          margin: 0; padding: 16px 18px; overflow: auto;
          font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
          font-size: 13px; line-height: 1.65; white-space: pre; tab-size: 2;
          color: #e4e4e4; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent;
        }
        .md-code-pre::-webkit-scrollbar { width: 5px; height: 5px; }
        .md-code-pre::-webkit-scrollbar-track { background: transparent; }
        .md-code-pre::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
        .md-code-pre::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
        .md-code-pre::-webkit-scrollbar-corner { background: transparent; }
        .md-h1, .md-h2, .md-h3 { margin: 0; font-weight: 600; letter-spacing: -0.02em; color: rgba(255,255,255,0.94); }
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
        .y-composer-terminal-bar {
          min-height: 32px; display: flex; align-items: center; gap: 8px;
          padding: 0 10px; border-bottom: 1px solid rgba(255,255,255,0.07);
          color: var(--y-text-2); font-family: var(--y-mono); font-size: 11px;
        }
        .y-composer-terminal-title {
          min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
          height: min(300px, 34vh); min-height: 178px;
          padding: 8px 0 8px 8px; background: #050506;
        }
        .y-xterm .xterm {
          height: 100%;
        }
        .y-xterm .xterm-viewport,
        .y-xterm .xterm-screen {
          background: transparent !important;
        }
        .y-xterm .xterm-viewport {
          scrollbar-color: rgba(255,255,255,0.2) transparent;
        }
        .y-toast {
          position: absolute; bottom: 88px; left: 50%; transform: translateX(-50%);
          background: rgba(20,20,22,0.96); border: 1px solid var(--y-border-strong);
          border-radius: 10px; padding: 8px 14px; font-size: 12px; color: var(--y-text-2);
          z-index: 30; pointer-events: none; max-width: 90%; text-align: center;
        }
        .y-settings-panel {
          margin: 0 10px 8px; padding: 10px; border-radius: 10px;
          border: 1px solid var(--y-border); background: rgba(0,0,0,0.18);
          display: flex; flex-direction: column; gap: 8px;
        }
        .y-settings-title { font-size: 12px; font-weight: 600; color: var(--y-text); }
        .y-settings-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--y-text-2); }
        .y-settings-row span:last-child { color: var(--y-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tool-activity { align-self: flex-start; max-width: 100%; width: min(680px, 100%); padding: 1px 0; }
        .tool-activity summary { list-style: none; cursor: pointer; outline: none; border-radius: 6px; }
        .tool-activity summary:focus-visible { box-shadow: 0 0 0 2px rgba(121,192,255,0.38); }
        .tool-activity summary::-webkit-details-marker { display: none; }
        .tool-activity.is-collapsible summary:hover .tool-activity-target,
        .tool-activity.is-collapsible summary:hover .tool-activity-stat { color: rgba(235,235,235,0.78); }
        .tool-activity-line {
          display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px;
          font-family: var(--y-mono); font-size: 12.5px; line-height: 1.45;
        }
        .tool-activity-verb { color: rgba(235,235,235,0.9); flex-shrink: 0; font-weight: 600; }
        .tool-activity-verb.is-live {
          background: linear-gradient(90deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0.25) 100%);
          background-size: 220% 100%; -webkit-background-clip: text; background-clip: text;
          color: transparent; animation: y-verb-shimmer 1.5s ease-in-out infinite;
        }
        @keyframes y-verb-shimmer {
          0% { background-position: 100% center; }
          100% { background-position: -100% center; }
        }
        .tool-activity-target { color: rgba(165,165,170,0.76); min-width: 0; }
        .tool-activity-stat { display: inline-flex; gap: 6px; font-size: 11.5px; flex-shrink: 0; font-weight: 600; }
        .tool-stat-add { color: #4ade80; }
        .tool-stat-del { color: #ff6b6b; }
        .tool-activity-detail {
          margin: 8px 0 2px 0; padding: 0; font-family: var(--y-mono); font-size: 12px;
          line-height: 1.5; color: rgba(226,226,226,0.82); white-space: pre; word-break: normal;
          max-height: 300px; overflow: auto; border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px; background: #111315;
        }
        .tool-diff-line { display: grid; grid-template-columns: 48px 28px minmax(0, 1fr); min-height: 26px; padding: 0; align-items: center; width: max-content; min-width: 100%; }
        .tool-diff-ln, .tool-diff-gutter { color: rgba(170,170,175,0.56); text-align: right; user-select: none; }
        .tool-diff-ln { align-self: stretch; display: flex; align-items: center; justify-content: flex-end; padding-right: 12px; border-right: 1px solid rgba(255,255,255,0.07); background: #111315; }
        .tool-diff-gutter { align-self: stretch; display: flex; align-items: center; justify-content: center; text-align: center; }
        .tool-diff-line code { align-self: stretch; display: flex; align-items: center; min-width: 0; color: rgba(226,226,226,0.84); font-family: inherit; font-size: inherit; background: none; border-radius: 0; font-weight: 400; padding: 0 14px 0 0; white-space: pre; }
        .tool-diff-del .tool-diff-gutter, .tool-diff-del code { background: rgba(248, 81, 73, 0.15); }
        .tool-diff-add .tool-diff-gutter, .tool-diff-add code { background: rgba(46, 160, 67, 0.17); }
        .tool-diff-del .tool-diff-gutter { color: #ff7b72; }
        .tool-diff-add .tool-diff-gutter { color: #56d364; }
        .tool-diff-del .tool-diff-ln { color: #ff7b72; }
        .tool-diff-add .tool-diff-ln { color: #56d364; }
        .y-tool-note { font-size: 12px; color: var(--y-text-3); font-style: italic; }
        .y-status { color: var(--y-text-3); font-size: 13px; font-style: italic; }
        .y-error { color: #ff7a7a; white-space: pre-wrap; font-size: 13px; line-height: 20px; }
        .y-composer-wrap { flex-shrink: 0; padding: 0 24px 22px; }
        .y-composer {
          max-width: 820px; margin: 0 auto; background: rgba(255,255,255,0.035);
          border: 1px solid rgba(255,255,255,0.11); border-radius: 20px;
          padding: 16px 16px 12px; display: flex; flex-direction: column; gap: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.28); position: relative;
        }
        .y-composer textarea {
          resize: none; font: inherit; font-size: 14px; line-height: 22px; color: inherit;
          background: transparent; border: none; outline: none; padding: 0 4px; min-height: 24px;
        }
        .y-suggest {
          position: absolute; left: 12px; right: 12px; bottom: calc(100% + 8px);
          z-index: 40;
          border: 1px solid var(--y-border); border-radius: 12px; overflow-y: auto;
          max-height: min(260px, 38vh);
          background: rgba(12,12,14,0.96); box-shadow: 0 12px 36px rgba(0,0,0,0.34);
        }
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
        .y-queued {
          display: flex; align-items: center; gap: 8px; min-width: 0;
          border: 1px solid rgba(222,190,156,0.2); background: rgba(222,190,156,0.08);
          color: rgba(235,225,210,0.9); border-radius: 10px; padding: 7px 8px;
          font-size: 12px;
        }
        .y-queued-label { flex-shrink: 0; color: rgba(222,190,156,0.78); font-family: var(--y-mono); }
        .y-queued-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-queued-remove {
          margin-left: auto; width: 20px; height: 20px; border: none; border-radius: 6px;
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
        >
          <div className="y-sidebar-inner">
            <div className="y-sidebar-top">
              <div className="y-sidebar-top-spacer" aria-hidden="true" />
              <div className="y-sidebar-chrome" aria-hidden="true" />
            </div>
            <nav className="y-nav">
              {NAV.map((item) =>
                item.id === 'search' && searchOpen ? (
                  <div key={item.id} className="y-nav-search" data-testid="nav-search">
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
              {filteredProjects.map((proj) => (
                <div key={proj.id} className={'y-project' + (proj.open ? '' : ' is-closed')}>
                  <button type="button" className="y-project-head" title={proj.path} onClick={() => toggleProject(proj.id)}>
                    <span className="y-project-icon"><FolderIcon open={proj.open} size={20} /></span>
                    <span className="y-project-name">{proj.name}</span>
                    <span className="y-chevron"><Icon name="chevron" size={11} /></span>
                  </button>
                  {proj.open ? (
	                    <div className="y-chat-list" data-runtime-version={runtimeVersion}>
	                      {proj.chats.map((c, i) => {
	                        const chatRuntime = runtimesRef.current[c.id]
	                        const running = Boolean(chatRuntime?.busy)
	                        const done = Boolean(doneChats[c.id]) && !running
	                        const renaming = renamingChat?.chatId === c.id
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
	                            <span className={'y-chat-indicator' + (!running && !done ? ' is-idle' : '')}>
	                              {running ? <span className="y-chat-spinner" /> : done ? <span className="y-chat-done" /> : null}
	                            </span>
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
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="y-sidebar-foot">
              {settingsOpen ? (
                <div className="y-settings-panel" data-testid="settings-panel">
                  <div className="y-settings-title">Settings</div>
                  <div className="y-settings-row"><span>Folders</span><span>{projects.length}</span></div>
                  <div className="y-settings-row"><span>Engine</span><span>{engineLabel}</span></div>
                </div>
              ) : null}
              <button type="button" className="y-nav-btn" data-testid="settings-button" onClick={() => setSettingsOpen((open) => !open)}>
                <span className="y-nav-icon"><Icon name="settings" size={16} /></span>
                Settings
              </button>
            </div>
          </div>
        </aside>

        <div className="y-main" data-testid="y-main">
          {toast ? <div className="y-toast">{toast}</div> : null}
          <header className="y-header">
            {!sidebarOpen ? <div className="y-header-lead" aria-hidden="true" /> : null}
            <div className="y-header-drag">
            <span className="y-title" data-testid="chat-title">
              {title}
            </span>
            <div className="y-header-actions">
              {!fileRailOpen && (
                <button
                  type="button"
                  className="y-icon-btn"
                  data-testid="file-rail-button"
                  aria-label="Open files"
                  title="Open files"
                  onClick={() => {
                    setFileRailOpen(true)
                    if (modifyOpen && !PREVIEW) window.y.modify.close()
                  }}
                  disabled={!activeProjectId}
                >
                  <Icon name="files" size={15} />
                </button>
              )}
              {!PREVIEW && window.y.modify && !modifyOpen ? (
                <button
                  type="button"
                  className="y-modify-btn"
                  data-testid="modify-button"
                  onClick={() => window.y.modify.toggle()}
                >
                  <Icon name="edit" size={14} />
                  Modify
                </button>
              ) : null}
            </div>
            </div>
          </header>

          {activeFile ? (
            <div className="y-file-view" data-testid="file-view">
              <div className="y-file-toolbar">
                <FileIcon name={activeFile.name} size={20} />
                <span className="y-file-name" title={fileDisplayPath(activeFile)}>{fileDisplayPath(activeFile)}</span>
                <div className="y-segment" role="tablist" aria-label="File view mode">
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
                {isImageFile(activeFile) ? (
                  <div className="y-file-image">
                    {fileContent ? (
                      <img src={fileContent} alt={activeFile.name} className="y-file-img" />
                    ) : (
                      <span style={{ color: 'var(--y-text-3)', fontSize: 13 }}>{fileStatus || 'Loading...'}</span>
                    )}
                  </div>
                ) : fileMode === 'preview' && isMarkdownFile(activeFile) ? (
                  <div className="y-file-markdown" data-testid="markdown-preview">
                    <AssistantBody text={fileContent} />
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
                <div className="y-mark">y</div>
                <p className="y-empty-copy">
                  {hasProject ? 'Ask anything about your code.' : 'Open a folder to start a real project chat.'}
                </p>
                {!hasProject ? (
                  <button type="button" className="y-empty-action" onClick={() => void openProject()}>
                    <Icon name="folder" size={15} />
                    Open folder
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div ref={logRef} className="y-log" data-testid="chat-log">
              <div className="y-log-inner">
                {messages.map((m, i) => {
                  const key = `${m.role}-${m.id ?? i}`
                  if (m.role === 'thinking') return null
	                  if (m.role === 'user') {
	                    const isLastUser = !messages.slice(i + 1).some((item) => item.role === 'user')
		                    const editingDraft =
			                      editingMessage?.chatId === activeChatId && editingMessage?.index === i ? editingMessage : null
		                    const editing = Boolean(editingDraft)
	                    return (
	                      <div key={key} className="y-user-row" data-testid="user-message">
	                        <div className={`y-user-wrap${editing ? ' is-editing' : ''}`}>
	                          <div className="y-user-bubble">
	                            {editing ? (
	                              <textarea
	                                className="y-inline-edit"
	                                data-testid="inline-edit-input"
		                                value={editingDraft?.text ?? ''}
	                                autoFocus
	                                onChange={(event) => setEditingMessage({ chatId: activeChatId || '', index: i, text: event.currentTarget.value })}
	                                onKeyDown={(event) => {
	                                  if (event.key === 'Escape') cancelEditUserMessage()
	                                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && activeChatId) void submitEditedUserMessage(activeChatId, i)
	                                }}
	                              />
	                            ) : m.text}
	                          </div>
	                          {activeChatId ? <div className="y-user-actions">
	                            {editing ? (
	                              <>
	                                <button
	                                  type="button"
	                                  className="y-message-action"
	                                  aria-label="Submit edited message"
	                                  title="Submit edited message"
	                                  onClick={() => void submitEditedUserMessage(activeChatId, i)}
	                                >
	                                  <Icon name="check" size={13} />
	                                </button>
	                                <button
	                                  type="button"
	                                  className="y-message-action"
	                                  aria-label="Cancel edit"
	                                  title="Cancel edit"
	                                  onClick={cancelEditUserMessage}
	                                >
	                                  <Icon name="x" size={13} />
	                                </button>
	                              </>
	                            ) : (
	                              <>
	                                <button
	                                  type="button"
	                                  className="y-message-action"
	                                  aria-label="Edit message"
	                                  title="Edit message"
	                                  onClick={() => beginEditUserMessage(activeChatId, i, m.text ?? '')}
	                                >
	                                  <Icon name="edit" size={13} />
	                                </button>
	                                {isLastUser ? (
	                                  <button
	                                    type="button"
	                                    className="y-message-action"
	                                    aria-label="Revert last turn"
	                                    title="Revert last turn"
	                                    onClick={() => void revertLastTurn()}
	                                  >
	                                    <Icon name="undo" size={13} />
	                                  </button>
	                                ) : null}
	                              </>
	                            )}
	                          </div> : null}
	                        </div>
	                      </div>
	                    )
	                  }
	                  if (m.role === 'assistant') {
	                    const msgEngineLabel = LABELS[m.engineId || engineId] || m.engineId || engineLabel
	                    return (
	                      <div key={key} className="y-assistant" data-testid="assistant-message">
	                        <span className="y-engine-badge">{msgEngineLabel}</span>
	                        <AssistantBody text={m.text ?? ''} />
	                      </div>
	                    )
	                  }
	                  if (m.role === 'tool') {
	                    if (m.system) return <div key={key} className="y-tool-note">{m.name}</div>
                    const verb = m.verb || toolVerbFromName(m.name || 'tool')
                    const stat = diffStat(m.body)
                    const showDiff = !m.streaming && !!m.body && (m.body.includes('\n- ') || m.body.startsWith('- ') || m.body.includes('\n+ '))
                    const line = (
                      <div className="tool-activity-line">
                        <span className={'tool-activity-verb' + (m.streaming ? ' is-live' : '')}>{verb}</span>
                        {m.target ? <span className="tool-activity-target">{m.target}</span> : null}
                        {stat ? (
                          <span className="tool-activity-stat">
                            <span className="tool-stat-add">+{stat.added}</span>
                            <span className="tool-stat-del">-{stat.removed}</span>
                          </span>
                        ) : null}
                      </div>
                    )
                    const detail = showDiff ? (
                      <div className="tool-activity-detail">
                        {(() => {
                          const lines = m.body!
                            .split('\n')
                            .filter(Boolean)
                            .map((line) => {
                              const del = line.startsWith('- ')
                              const add = line.startsWith('+ ')
                              return { line, del, add, raw: del || add || line.startsWith('  ') ? line.slice(2) : line }
                            })
                          const commonIndent = lines.reduce<number | null>(function (min, item) {
                            if (!item.raw.trim()) return min
                            const indent = item.raw.match(/^ */)?.[0].length ?? 0
                            return min === null ? indent : Math.min(min, indent)
                          }, null) ?? 0
                          return lines.map(({ del, add, raw }, j) => {
                          const text = commonIndent > 0 ? raw.slice(commonIndent) : raw
                          const cls = del ? ' tool-diff-del' : add ? ' tool-diff-add' : ''
                          const mark = del ? '-' : add ? '+' : ' '
                          let lineNo = 1
                          for (const prev of lines.slice(0, j)) {
                            if (!prev.del) lineNo += 1
                          }
                          return (
                            <div key={j} className={'tool-diff-line' + cls}>
                              <span className="tool-diff-ln">{lineNo}</span>
                              <span className="tool-diff-gutter">{mark}</span>
                              <code dangerouslySetInnerHTML={{ __html: hljsHighlight(text, 'typescript') }} />
                            </div>
                          )
                          })
                        })()}
                      </div>
                    ) : null
                    if (showDiff) {
                      return (
                        <details key={key} className="tool-activity is-collapsible">
                          <summary>{line}</summary>
                          {detail}
                        </details>
                      )
                    }
                    return (
                      <div key={key} className="tool-activity">
                        {line}
                      </div>
                    )
                  }
                  return null
                })}
                {status ? <div className="y-status">{status}</div> : null}
                {error ? <div className="y-error">{error}</div> : null}
              </div>
            </div>
          )}

          {!activeFile ? <div className="y-composer-wrap">
            <div className="y-composer" data-testid="composer">
	              {composerTerminal ? (
	                <div className="y-composer-terminal" data-testid="composer-terminal">
	                  <div className="y-composer-terminal-bar">
	                    <span className="y-composer-terminal-title">{composerTerminal.title}</span>
	                    <button type="button" className="y-composer-terminal-close" aria-label="Close terminal" onClick={closeComposerTerminal}>×</button>
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
              ) : null}
              <textarea
                value={input}
                rows={1}
                data-testid="composer-input"
                onChange={(ev) => setInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault()
                    send()
                  }
                }}
                placeholder={!hasProject ? 'Open a folder to start...' : sessionId ? 'Ask for follow-up changes' : 'Starting engine...'}
              />
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
              {attachments.length ? (
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
                </div>
              ) : null}
              {activeChatId && queuedFollowUps[activeChatId] ? (
                <div className="y-queued" data-testid="queued-follow-up">
                  <span className="y-queued-label">Queued</span>
                  <span className="y-queued-text">{queuedFollowUps[activeChatId]}</span>
                  <button
                    type="button"
                    className="y-queued-remove"
                    aria-label="Remove queued follow-up"
                    onClick={() => updateQueuedFollowUps((queued) => {
                      const next = { ...queued }
                      delete next[activeChatId]
                      return next
                    })}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <div className="y-composer-row">
                <button type="button" className="y-round-btn" aria-label="Attach" onClick={() => void attachFiles()} disabled={!hasProject || busy}>
                  <Icon name="plus" size={14} />
                </button>
                <YDropdown
                  value={engineId}
                  options={pickerCatalog.map(function (e) { return { id: e.engine, label: e.label } })}
                  disabled={busy}
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
                  return (
                    <>
                      <YDropdown
                        value={base}
                        options={bases}
                        disabled={busy || bases.length === 0}
                        onChange={function (nb) {
                          const ne = catalogEfforts(pickerCatalog, engineId, nb)
                          start(engineId, buildModelId(nb, ne.find(function (x) { return x.id === effort })?.id ?? ne[0]?.id ?? 'medium'))
                        }}
                      />
                      <YDropdown
                        value={effort}
                        options={efforts}
                        disabled={busy || efforts.length === 0}
                        onChange={function (ef) { start(engineId, buildModelId(base, ef)) }}
                      />
                    </>
                  )
                })()}
                {busy && input.trim() ? (
                  <button type="button" className="y-steer-btn" onClick={steerTurn}>
                    Steer
                  </button>
                ) : null}
                <button
                  type="button"
                  className="y-send"
                  data-testid="send-button"
                  onClick={submitOrInterrupt}
                  disabled={!busy && !slashReady && (((!PREVIEW && !hasProject) || !sessionId))}
                  aria-label={busy && !input.trim() ? 'Pause' : busy ? 'Queue follow-up' : 'Send'}
                >
                  <Icon name={busy && !input.trim() ? 'stop' : 'send'} size={16} />
                </button>
              </div>
            </div>
          </div> : null}
        </div>

        <aside className={'y-file-rail' + (fileRailOpen ? ' is-open' : '')} data-testid="file-rail" aria-hidden={!fileRailOpen}>
            <div className="y-file-rail-head">
              <span className="y-file-rail-title">
                <Icon name="files" size={15} />
                Files
              </span>
              <button type="button" className="y-icon-btn" aria-label="Close files" onClick={() => setFileRailOpen(false)}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="y-file-rail-list">
              {projectFiles.length ? (
                buildVisibleTree(projectFiles, expandedFolders).map((node) => {
                  const indent = 10 + node.depth * 16
                  if (node.kind === 'folder') {
                    const isOpen = expandedFolders.has(node.folderPath)
                    return (
                      <button
                        type="button"
                        key={node.folderPath}
                        className="y-file-row y-file-folder"
                        style={{ paddingLeft: indent }}
                        onClick={() => setExpandedFolders((prev) => {
                          const next = new Set(prev)
                          if (next.has(node.folderPath)) next.delete(node.folderPath)
                          else next.add(node.folderPath)
                          return next
                        })}
                      >
                        <FolderIcon open={isOpen} size={20} />
                        <span className="y-file-row-name">{node.name}</span>
                        <span className="y-file-folder-chevron" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                          <Icon name="chevron" size={12} />
                        </span>
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
              ) : (
                <div className="y-file-empty">No files found in this folder.</div>
              )}
            </div>
          </aside>
      </div>
    </>
  )
}
