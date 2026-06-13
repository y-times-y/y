import { useEffect, useRef, useState, type CSSProperties } from 'react'

// Default chat UI — lives in USERLAND (fully moddable). Uses window.y.engine bricks.
const LABELS: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }

const PREVIEW = typeof window !== 'undefined' && !!(window as Window & { __Y_PREVIEW__?: boolean }).__Y_PREVIEW__
const PREVIEW_EMPTY =
  PREVIEW &&
  typeof window !== 'undefined' &&
  !!(window as Window & { __Y_PREVIEW_EMPTY__?: boolean }).__Y_PREVIEW_EMPTY__

type Msg = {
  role: 'user' | 'assistant' | 'tool'
  text?: string
  name?: string
  id?: string
  verb?: string
  target?: string
  body?: string
  streaming?: boolean
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

type Project = {
  name: string
  open?: boolean
  chats: { title: string; active?: boolean; ago?: string }[]
}

const PROJECTS: Project[] = [
  { name: 'ytimesy', open: true, chats: [{ title: 'New chat', active: true }] },
  { name: 'Game', open: true, chats: [{ title: 'Compete with AI giants cheaply', ago: '3d' }] },
  { name: 'Agent-communication', open: false, chats: [{ title: 'Explain agent communication', ago: '4d' }] }
]

const NAV = [
  { id: 'new', label: 'New chat', icon: 'plus' },
  { id: 'search', label: 'Search', icon: 'search' }
] as const

const DEMO_MESSAGES: Msg[] = PREVIEW && !PREVIEW_EMPTY
  ? [
      {
        role: 'assistant',
        text:
          'Here is a quick example:\n\n```python\nresult = await run_action("click", {"index": 3})\n```\n\nLet me know if you want to iterate on the layout or typography next.'
      },
      { role: 'user', text: 'Can you make the sidebar feel more like the reference?' }
    ]
  : []

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function normalizeLang(lang: string) {
  const l = (lang || '').toLowerCase().trim()
  if (l === 'typescript' || l === 'tsx') return 'typescript'
  if (l === 'javascript' || l === 'jsx' || l === 'js') return 'javascript'
  if (l === 'py') return 'python'
  if (l === 'sh' || l === 'shell' || l === 'zsh' || l === 'bash') return 'shell'
  return l
}

function highlightLine(line: string, lang: string) {
  const safe = esc(line)
  if (!lang) return safe

  const slots: string[] = []
  const mark = function (html: string) {
    const i = slots.length
    slots.push(html)
    return '@@HL' + i + '@@'
  }
  const fill = function (s: string) {
    return s.replace(/@@HL(\d+)@@/g, function (_, n) { return slots[Number(n)] || '' })
  }

  if (lang === 'json') {
    let out = safe
    out = out.replace(/"([^"\\]|\\.)*"/g, function (m) { return mark('<span class="md-str">' + m + '</span>') })
    out = out.replace(/\b(true|false|null)\b/g, function (m) { return mark('<span class="md-kw">' + m + '</span>') })
    out = out.replace(/\b(-?\d+\.?\d*)\b/g, function (m) { return mark('<span class="md-num">' + m + '</span>') })
    return fill(out)
  }
  if (lang === 'shell') {
    if (line.trimStart().startsWith('#')) return '<span class="md-com">' + safe + '</span>'
    let out = safe
    out = out.replace(/('([^'\\]|\\.)*'|"([^"\\]|\\.)*")/g, function (m) { return mark('<span class="md-str">' + m + '</span>') })
    out = out.replace(/^(\$\s?)/, function (m) { return mark('<span class="md-kw">' + m + '</span>') })
    return fill(out)
  }
  const keywords =
    lang === 'python'
      ? /\b(async|await|def|class|return|import|from|if|else|elif|for|while|try|except|with|as|None|True|False|in|not|and|or|pass|raise|yield|lambda)\b/g
      : /\b(async|await|function|const|let|var|return|import|from|export|default|class|if|else|for|while|try|catch|new|typeof|interface|type|null|undefined|true|false|extends|implements|enum|switch|case|break|continue|void|this)\b/g
  let out = safe
  // Slot strings/comments before keywords — otherwise the string regex matches
  // attribute quotes inside already-inserted <span class="md-kw"> tags.
  out = out.replace(/('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`)/g, function (m) { return mark('<span class="md-str">' + m + '</span>') })
  out = out.replace(/(\/\/.*|#.*)$/g, function (m) { return mark('<span class="md-com">' + m + '</span>') })
  out = out.replace(keywords, function (m) { return mark('<span class="md-kw">' + m + '</span>') })
  out = out.replace(/\b(\d+\.?\d*)\b/g, function (m) { return mark('<span class="md-num">' + m + '</span>') })
  return fill(out)
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

function TextBlock({ text }: { text: string }) {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <>
      {paragraphs.map(function (para, i) {
        const trimmed = para.trim()
        if (!trimmed) return null
        const h = trimmed.match(/^(#{1,3})\s+(.+)$/)
        if (h) {
          const level = h[1].length
          const cls = level === 1 ? 'md-h1' : level === 2 ? 'md-h2' : 'md-h3'
          return (
            <div key={i} className={cls} dangerouslySetInnerHTML={{ __html: inlineMd(h[2]) }} />
          )
        }
        if (/^>\s/.test(trimmed)) {
          const quote = trimmed.split('\n').map(function (l) { return l.replace(/^>\s?/, '') }).join('\n')
          return (
            <blockquote key={i} className="md-quote" dangerouslySetInnerHTML={{ __html: inlineMd(quote) }} />
          )
        }
        const lines = para.split('\n')
        const isList = lines.every(function (l) { return /^[-*]\s+/.test(l.trim()) || l.trim() === '' })
        if (isList && lines.some(function (l) { return l.trim() })) {
          return (
            <ul key={i} className="md-list">
              {lines.filter(function (l) { return l.trim() }).map(function (l, j) {
                return (
                  <li key={j} dangerouslySetInnerHTML={{ __html: inlineMd(l.replace(/^[-*]\s+/, '')) }} />
                )
              })}
            </ul>
          )
        }
        const isOrdered = lines.every(function (l) { return /^\d+\.\s+/.test(l.trim()) || l.trim() === '' })
        if (isOrdered && lines.some(function (l) { return l.trim() })) {
          return (
            <ol key={i} className="md-list md-olist">
              {lines.filter(function (l) { return l.trim() }).map(function (l, j) {
                return (
                  <li key={j} dangerouslySetInnerHTML={{ __html: inlineMd(l.replace(/^\d+\.\s+/, '')) }} />
                )
              })}
            </ol>
          )
        }
        return (
          <p
            key={i}
            className="md-p"
            dangerouslySetInnerHTML={{ __html: lines.map(function (l) { return inlineMd(l) }).join('<br/>') }}
          />
        )
      })}
    </>
  )
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  if (!code.trim() && !lang) return null
  const html = code.split('\n').map(function (line) { return highlightLine(line, normalizeLang(lang)) }).join('\n')

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
  if (name === 'send')
    return (
      <svg style={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 16V6M10 6l-3.5 3.5M10 6l3.5 3.5" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
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

function EngineMark({ id }: { id: string }) {
  const s: CSSProperties = { width: 18, height: 18, display: 'block', flexShrink: 0 }
  if (id === 'codex') {
    return (
      <svg style={s} viewBox="0 0 18 18" fill="none" aria-hidden>
        <path
          d="M9 2.5L14.5 5.75V12.25L9 15.5L3.5 12.25V5.75L9 2.5Z"
          stroke="#e8a043"
          strokeWidth="1.35"
        />
        <path d="M9 6.5v5M9 6.5l-2 1.2M9 6.5l2 1.2" stroke="#e8a043" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg style={s} viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="6.25" stroke="#c9a0ff" strokeWidth="1.35" />
      <circle cx="9" cy="9" r="2.2" fill="#c9a0ff" />
    </svg>
  )
}

function YPicker({
  value,
  options,
  onChange,
  disabled,
  testId
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
  disabled?: boolean
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const label = options.find(function (o) { return o.id === value })?.label ?? value

  useEffect(function () {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return function () { document.removeEventListener('mousedown', onDoc) }
  }, [open])

  return (
    <div ref={ref} className={'y-picker' + (open ? ' is-open' : '')} data-testid={testId}>
      <button type="button" className="y-picker-btn" disabled={disabled} onClick={() => setOpen(function (o) { return !o })}>
        <span className="y-picker-mark">
          <EngineMark id={value} />
        </span>
        <span className="y-picker-body">
          <span className="y-picker-mode" data-testid="access-pill">
            Read only
          </span>
          <span className="y-picker-sep" aria-hidden>
            ·
          </span>
          <span className="y-picker-label">{label}</span>
        </span>
        <Icon name="chevron" size={12} />
      </button>
      {open ? (
        <div className="y-picker-menu">
          {options.map(function (o) {
            return (
              <button
                key={o.id}
                type="button"
                className={'y-picker-item' + (o.id === value ? ' active' : '')}
                onClick={function () { onChange(o.id); setOpen(false) }}
              >
                {o.label}
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
  const [searchQuery, setSearchQuery] = useState('')
  const [toast, setToast] = useState('')
  const [projects, setProjects] = useState(PROJECTS)
  const [engines, setEngines] = useState<string[]>(PREVIEW ? ['claude-code', 'codex'] : [])
  const [engineId, setEngineId] = useState('claude-code')
  const [sessionId, setSessionId] = useState<string | null>(PREVIEW ? 'preview' : null)
  const [title, setTitle] = useState('New chat')
  const [messages, setMessages] = useState<Msg[]>(DEMO_MESSAGES)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [modifyOpen, setModifyOpen] = useState(false)
  const sidRef = useRef<string | null>(PREVIEW ? 'preview' : null)
  const logRef = useRef<HTMLDivElement | null>(null)

  function start(id: string) {
    if (PREVIEW) {
      setEngineId(id)
      setSessionId('preview')
      sidRef.current = 'preview'
      return
    }
    if (sidRef.current) window.y.engine.cancel(sidRef.current)
    sidRef.current = null
    setSessionId(null)
    setMessages([])
    setTitle('New chat')
    setStatus('')
    setError('')
    setBusy(false)
    void window.y.engine.start({ engine: id }).then((res) => {
      if (!res.ok || !res.sessionId) {
        setError(res.error || 'Failed to start engine')
        return
      }
      sidRef.current = res.sessionId
      setSessionId(res.sessionId)
    })
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

  function upsertTool(list: Msg[], e: Extract<AgentEvent, { kind: 'tool' }>): Msg[] {
    const last = list[list.length - 1]
    const sameTool =
      last?.role === 'tool' &&
      ((e.id && last.id === e.id) || (!e.id && last.name === e.name && last.streaming))
    const base = sameTool ? list : settleTools(list)
    const prev = base[base.length - 1]
    const next: Msg = {
      role: 'tool',
      name: e.name,
      id: e.id,
      verb: e.verb || toolVerbFromName(e.name),
      target: e.target,
      body: e.body,
      streaming: true
    }
    const merge =
      prev?.role === 'tool' &&
      ((e.id && prev.id === e.id) || (!e.id && prev.name === e.name && prev.streaming))
    if (merge) {
      return base.slice(0, -1).concat([
        { ...prev, ...next, target: e.target ?? prev.target, body: e.body ?? prev.body }
      ])
    }
    return base.concat([next])
  }

  function append(list: Msg[], chunk: string): Msg[] {
    const last = list[list.length - 1]
    if (chunk === '\n\n' && last?.role === 'tool') return list
    const base = settleTools(list)
    const prev = base[base.length - 1]
    if (prev && prev.role === 'assistant') {
      return base.slice(0, -1).concat([{ role: 'assistant', text: (prev.text ?? '') + chunk }])
    }
    return base.concat([{ role: 'assistant', text: chunk }])
  }

  useEffect(() => {
    if (PREVIEW || !window.y.modify) return
    return window.y.modify.onChange(setModifyOpen)
  }, [])

  useEffect(() => {
    if (PREVIEW) return
    const off = window.y.engine.onEvent(({ sessionId: sid, event: e }) => {
      if (sid !== sidRef.current) return
      if (e.kind === 'text') {
        setStatus('')
        setMessages((m) => append(m, e.text))
      } else if (e.kind === 'thinking') {
        setStatus('Thinking…')
      } else if (e.kind === 'tool') {
        setStatus('')
        setMessages((m) => upsertTool(m, e))
      } else if (e.kind === 'result') {
        setBusy(false)
        setStatus('')
        setMessages((m) => settleTools(m))
        if (!e.ok) setError(e.summary || 'The engine reported an error.')
      } else if (e.kind === 'error') {
        setBusy(false)
        setStatus('')
        setMessages((m) => settleTools(m))
        setError(e.message)
      }
    })
    void window.y.engine.list().then((ids) => {
      if (ids.length) setEngines(ids)
    })
    start('claude-code')
    return off
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages, status])

  function send() {
    const text = input.trim()
    if (!text || !sessionId || busy) return
    setError('')
    if (title === 'New chat') setTitle(text.length > 46 ? text.slice(0, 46) + '…' : text)
    setMessages((m) => m.concat([{ role: 'user', text }]))
    setInput('')
    if (PREVIEW) return
    setBusy(true)
    setStatus('…')
    void window.y.engine.send(sessionId, text)
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
    }
  }

  function selectChat(projectName: string, chatTitle: string) {
    setTitle(chatTitle)
    setProjects(function (list) {
      return list.map(function (p) {
        return {
          ...p,
          chats: p.chats.map(function (c) {
            return { ...c, active: p.name === projectName && c.title === chatTitle }
          })
        }
      })
    })
  }

  const filteredProjects = projects
    .map(function (p) {
      if (!searchQuery.trim()) return p
      const q = searchQuery.toLowerCase()
      if (p.name.toLowerCase().includes(q)) return p
      const chats = p.chats.filter(function (c) { return c.title.toLowerCase().includes(q) })
      if (chats.length) return { ...p, open: true, chats: chats }
      return null
    })
    .filter(Boolean) as Project[]

  function newChat() {
    start(engineId)
  }

  function toggleProject(name: string) {
    setProjects((list) =>
      list.map((p) => (p.name === name ? { ...p, open: !p.open } : p))
    )
  }

  const empty = messages.length === 0 && !error
  const engineLabel = LABELS[engineId] || engineId

  return (
    <>
      <style>{`
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
        .y-project-head {
          display: flex; align-items: center; gap: 8px; width: 100%;
          padding: 6px 10px; border: none; border-radius: 8px; background: transparent;
          color: var(--y-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left;
        }
        .y-project-head:hover { background: rgba(255,255,255,0.04); }
        .y-project-icon { opacity: 0.72; display: flex; align-items: center; }
        .y-chevron {
          display: flex; align-items: center; opacity: 0.45; transition: transform 0.15s ease;
        }
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
        .y-chat-item:hover { background: rgba(255,255,255,0.04); color: var(--y-text); }
        .y-chat-item.active { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-chat-meta { margin-left: auto; font-size: 11px; color: var(--y-text-3); flex-shrink: 0; }
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
        .y-empty {
          flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px;
        }
        .y-empty-inner { text-align: center; max-width: 420px; }
        .y-mark {
          font-family: var(--y-mono); font-size: 56px; font-weight: 600; letter-spacing: -0.03em;
          color: #fff; line-height: 1;
        }
        .y-empty-copy { margin-top: 18px; font-size: 15px; line-height: 24px; color: var(--y-text-3); }
        .y-log { flex: 1; min-height: 0; overflow: auto; padding: 28px 24px 12px; }
        .y-log-inner { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
        .y-user-row { display: flex; justify-content: flex-end; }
        .y-user-bubble {
          max-width: 78%; padding: 11px 16px; border-radius: 18px 18px 6px 18px;
          background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.05);
          white-space: pre-wrap; line-height: 22px; color: rgba(255,255,255,0.88);
        }
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
        .md-inline { font-family: var(--y-mono); font-size: 0.9em; background: rgba(255,255,255,0.08); border-radius: 5px; padding: 1px 6px; }
        .md-code { border-radius: 12px; overflow: hidden; background: rgba(0,0,0,0.42); border: 1px solid var(--y-border); }
        .md-code-head { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); }
        .md-code-lang { font-family: var(--y-mono); font-size: 11px; color: var(--y-text-3); text-transform: lowercase; }
        .md-code-copy { font: inherit; font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.45); background: transparent; border: none; cursor: pointer; }
        .md-code-copy:hover { color: rgba(255,255,255,0.75); }
        .md-code-pre { margin: 0; padding: 14px 16px; overflow: auto; font-family: var(--y-mono); font-size: 12.5px; line-height: 1.55; white-space: pre; tab-size: 2; }
        .md-kw { color: #7aa2ff; } .md-str { color: #9cdc8c; } .md-com { color: rgba(255,255,255,0.32); } .md-num { color: #e8b080; }
        .md-h1, .md-h2, .md-h3 { margin: 0; font-weight: 600; letter-spacing: -0.02em; color: rgba(255,255,255,0.94); }
        .md-h1 { font-size: 20px; line-height: 1.3; } .md-h2 { font-size: 17px; line-height: 1.35; } .md-h3 { font-size: 15px; line-height: 1.4; }
        .md-quote { margin: 0; padding: 10px 14px; border-left: 3px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.03); border-radius: 0 8px 8px 0; color: rgba(255,255,255,0.72); }
        .md-olist { list-style: decimal; }
        .md-link { color: #7aa2ff; text-decoration: none; } .md-link:hover { text-decoration: underline; }
        .md-code-pre code { background: none; padding: 0; font-size: inherit; }
        .y-search-wrap { padding: 0 10px 8px; }
        .y-search {
          width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
          padding: 8px 10px 8px 32px; border-radius: 9px;
          border: 1px solid var(--y-border); background: rgba(0,0,0,0.22); color: var(--y-text);
          outline: none;
        }
        .y-search:focus { border-color: rgba(255,255,255,0.16); }
        .y-search-box { position: relative; }
        .y-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: 0.45; pointer-events: none; }
        .y-toast {
          position: absolute; bottom: 88px; left: 50%; transform: translateX(-50%);
          background: rgba(20,20,22,0.96); border: 1px solid var(--y-border-strong);
          border-radius: 10px; padding: 8px 14px; font-size: 12px; color: var(--y-text-2);
          z-index: 30; pointer-events: none; max-width: 90%; text-align: center;
        }
        .tool-activity { align-self: flex-start; max-width: 100%; padding: 1px 0; }
        .tool-activity-line {
          display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px;
          font-family: var(--y-mono); font-size: 12.5px; line-height: 1.45;
        }
        .tool-activity-verb { color: rgba(255,255,255,0.78); flex-shrink: 0; font-weight: 500; }
        .tool-activity-verb.is-live {
          background: linear-gradient(90deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0.25) 100%);
          background-size: 220% 100%; -webkit-background-clip: text; background-clip: text;
          color: transparent; animation: y-verb-shimmer 1.5s ease-in-out infinite;
        }
        @keyframes y-verb-shimmer {
          0% { background-position: 100% center; }
          100% { background-position: -100% center; }
        }
        .tool-activity-target { color: rgba(255,255,255,0.42); min-width: 0; }
        .tool-activity-detail {
          margin: 5px 0 2px 0; padding: 0; font-family: var(--y-mono); font-size: 11px;
          line-height: 1.5; color: rgba(255,255,255,0.55); white-space: pre-wrap; word-break: break-word;
          max-height: 220px; overflow: auto;
        }
        .tool-diff-line { display: block; padding: 1px 0 1px 8px; border-left: 2px solid transparent; }
        .tool-diff-line code { font-family: inherit; font-size: inherit; }
        .tool-diff-del { border-left-color: rgba(255, 100, 100, 0.55); background: rgba(255, 80, 80, 0.05); }
        .tool-diff-add { border-left-color: rgba(100, 210, 140, 0.55); background: rgba(80, 200, 120, 0.05); }
        .y-status { color: var(--y-text-3); font-size: 13px; font-style: italic; }
        .y-error { color: #ff7a7a; white-space: pre-wrap; font-size: 13px; line-height: 20px; }
        .y-composer-wrap { flex-shrink: 0; padding: 0 24px 22px; }
        .y-composer {
          max-width: 820px; margin: 0 auto; background: rgba(255,255,255,0.035);
          border: 1px solid rgba(255,255,255,0.11); border-radius: 20px;
          padding: 16px 16px 12px; display: flex; flex-direction: column; gap: 14px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.28);
        }
        .y-composer textarea {
          resize: none; font: inherit; font-size: 14px; line-height: 22px; color: inherit;
          background: transparent; border: none; outline: none; padding: 0 4px; min-height: 24px;
        }
        .y-composer-row { display: flex; align-items: center; gap: 8px; }
        .y-round-btn {
          width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--y-border);
          background: transparent; color: var(--y-text-2); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .y-picker { position: relative; flex: 1; min-width: 0; max-width: 240px; }
        .y-picker-btn {
          display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; padding: 0 8px;
          border-radius: 9px; border: 1px solid var(--y-border); background: rgba(255,255,255,0.04);
          color: var(--y-text-2); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
        }
        .y-picker-btn:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: var(--y-text); }
        .y-picker-btn:disabled { opacity: 0.45; cursor: default; }
        .y-picker-mark {
          flex-shrink: 0; width: 18px; height: 18px;
          display: flex; align-items: center; justify-content: center;
        }
        .y-picker-body {
          flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; overflow: hidden;
        }
        .y-picker-mode { flex-shrink: 0; font-size: 12px; color: var(--y-text-2); }
        .y-picker-sep { flex-shrink: 0; color: var(--y-text-3); }
        .y-picker-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .y-picker-btn > svg:last-child { flex-shrink: 0; transition: transform 0.15s ease; opacity: 0.55; }
        .y-picker.is-open .y-picker-btn > svg:last-child { transform: rotate(180deg); }
        .y-picker-menu {
          position: absolute; bottom: calc(100% + 6px); left: 0; min-width: 160px; z-index: 40;
          padding: 4px; border-radius: 10px; border: 1px solid var(--y-border-strong);
          background: rgba(16,16,18,0.98); box-shadow: 0 12px 40px rgba(0,0,0,0.45);
        }
        .y-picker-item {
          display: block; width: 100%; padding: 7px 10px; border: none; border-radius: 7px;
          background: transparent; color: var(--y-text-2); font: inherit; font-size: 12px;
          text-align: left; cursor: pointer; white-space: nowrap;
        }
        .y-picker-item:hover { background: rgba(255,255,255,0.06); color: var(--y-text); }
        .y-picker-item.active { background: rgba(255,255,255,0.08); color: var(--y-text); }
        .y-send {
          width: 34px; height: 34px; border-radius: 50%; border: none;
          background: #fff; color: #0a0a0b; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 17px; font-weight: 600; line-height: 1;
          margin-left: auto; flex-shrink: 0;
        }
        .y-send:disabled { background: rgba(255,255,255,0.15); cursor: default; }
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
              {NAV.map((item) => (
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
              ))}
            </nav>

            {searchOpen ? (
              <div className="y-search-wrap">
                <div className="y-search-box">
                  <span className="y-search-icon"><Icon name="search" size={14} /></span>
                  <input
                    className="y-search"
                    data-testid="sidebar-search"
                    value={searchQuery}
                    onChange={(ev) => setSearchQuery(ev.target.value)}
                    placeholder="Search chats…"
                    autoFocus
                  />
                </div>
              </div>
            ) : null}

            <div className="y-projects">
              <div className="y-section-label">Projects</div>
              {filteredProjects.map((proj) => (
                <div key={proj.name} className={'y-project' + (proj.open ? '' : ' is-closed')}>
                  <button type="button" className="y-project-head" onClick={() => toggleProject(proj.name)}>
                    <span className="y-chevron"><Icon name="chevron" size={12} /></span>
                    <span className="y-project-icon"><Icon name="folder" size={14} /></span>
                    {proj.name}
                  </button>
                  {proj.open ? (
                    <div className="y-chat-list">
                      {proj.chats.map((c, i) => (
                        <button
                          type="button"
                          key={i}
                          className={'y-chat-item' + (c.active ? ' active' : '')}
                          data-testid={c.active ? 'active-chat' : undefined}
                          onClick={() => selectChat(proj.name, c.title)}
                        >
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.title}
                          </span>
                          {c.ago ? <span className="y-chat-meta">{c.ago}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="y-sidebar-foot">
              <button type="button" className="y-nav-btn" onClick={() => showToast('Settings — preferences and account coming soon.')}>
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
              {!PREVIEW && window.y.modify ? (
                <button
                  type="button"
                  className={'y-modify-btn' + (modifyOpen ? ' active' : '')}
                  data-testid="modify-button"
                  onClick={() => window.y.modify.toggle()}
                >
                  <Icon name="edit" size={14} />
                  Modify
                </button>
              ) : null}
              <button type="button" className="y-icon-btn" aria-label="More" onClick={() => showToast('Chat options — rename, export, and delete coming soon.')}>
                <Icon name="menu" />
              </button>
            </div>
            </div>
          </header>

          {empty ? (
            <div className="y-empty" data-testid="empty-state">
              <div className="y-empty-inner">
                <div className="y-mark">y</div>
                <p className="y-empty-copy">Ask anything about your code.</p>
              </div>
            </div>
          ) : (
            <div ref={logRef} className="y-log" data-testid="chat-log">
              <div className="y-log-inner">
                {messages.map((m, i) => {
                  if (m.role === 'tool') {
                    const verb = m.verb || toolVerbFromName(m.name || 'tool')
                    return (
                      <div key={i} className="tool-activity">
                        <div className="tool-activity-line">
                          <span className={'tool-activity-verb' + (m.streaming ? ' is-live' : '')}>{verb}</span>
                          {m.target ? <span className="tool-activity-target">{m.target}</span> : null}
                        </div>
                        {m.body ? (
                          m.body.includes('- ') || m.body.includes('+ ') ? (
                            <div className="tool-activity-detail">
                              {m.body.split('\n').map((line, j) => {
                                if (!line) return null
                                const del = line.startsWith('- ')
                                const add = line.startsWith('+ ')
                                const raw = del || add ? line.slice(2) : line
                                const cls = del ? ' tool-diff-del' : add ? ' tool-diff-add' : ''
                                return (
                                  <div key={j} className={'tool-diff-line' + cls}>
                                    <code dangerouslySetInnerHTML={{ __html: highlightLine(raw, 'typescript') }} />
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <pre className="tool-activity-detail">{m.body}</pre>
                          )
                        ) : null}
                      </div>
                    )
                  }
                  if (m.role === 'user') {
                    return (
                      <div key={i} className="y-user-row" data-testid="user-message">
                        <div className="y-user-bubble">{m.text}</div>
                      </div>
                    )
                  }
                  return (
                    <div key={i} className="y-assistant" data-testid="assistant-message">
                      <span className="y-engine-badge">{engineLabel}</span>
                      <AssistantBody text={m.text ?? ''} />
                    </div>
                  )
                })}
                {status ? <div className="y-status">{status}</div> : null}
                {error ? <div className="y-error">{error}</div> : null}
              </div>
            </div>
          )}

          <div className="y-composer-wrap">
            <div className="y-composer" data-testid="composer">
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
                placeholder={sessionId ? 'Ask for follow-up changes' : 'Starting engine…'}
              />
              <div className="y-composer-row">
                <button type="button" className="y-round-btn" aria-label="Attach" onClick={() => showToast('Attachments — add files and images soon.')}>
                  <Icon name="plus" size={14} />
                </button>
                <YPicker
                  testId="engine-select"
                  value={engineId}
                  disabled={busy}
                  options={engines.map(function (id) { return { id: id, label: LABELS[id] || id } })}
                  onChange={function (id) { setEngineId(id); start(id) }}
                />
                <button
                  type="button"
                  className="y-send"
                  data-testid="send-button"
                  onClick={send}
                  disabled={!sessionId || busy}
                  aria-label="Send"
                >
                  <Icon name="send" size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
