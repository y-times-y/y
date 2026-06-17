import * as React from 'react'
import hljs from 'highlight.js/lib/common'

type Block =
  | { kind: 'code'; lang: string; value: string }
  | { kind: 'text'; value: string }

function normalizeLang(lang: string): string {
  const l = lang.toLowerCase().trim()
  if (l === 'typescript' || l === 'tsx') return 'typescript'
  if (l === 'javascript' || l === 'jsx' || l === 'js') return 'javascript'
  if (l === 'py') return 'python'
  if (l === 'sh' || l === 'shell' || l === 'zsh' || l === 'bash') return 'bash'
  if (l === 'scss' || l === 'sass') return 'scss'
  return l
}

export function splitBlocks(text: string): Block[] {
  const parts: Block[] = []
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
      if (code.trim() || lang) parts.push({ kind: 'code', lang, value: code })
      break
    }
    parts.push({ kind: 'code', lang, value: rest.slice(0, end).replace(/\n$/, '') })
    rest = rest.slice(end + 3)
    if (rest.startsWith('\n')) rest = rest.slice(1)
  }
  return parts
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightCode(code: string, lang: string): string {
  const l = normalizeLang(lang)
  try {
    if (l && hljs.getLanguage(l)) {
      return hljs.highlight(code, { language: l, ignoreIllegals: true }).value
    }
  } catch {}
  return esc(code)
}

export function highlightLine(line: string, lang: string): string {
  return highlightCode(line, lang)
}

function inlineMarkdown(text: string): string {
  let s = esc(text)
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noreferrer">$1</a>')
  return s
}

function renderTextBlock(text: string): React.ReactNode {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return paragraphs.map((para, i) => {
    const trimmed = para.trim()
    if (!trimmed) return null

    const h = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const cls = level === 1 ? 'md-h1' : level === 2 ? 'md-h2' : 'md-h3'
      return (
        <div
          key={i}
          className={cls}
          dangerouslySetInnerHTML={{ __html: inlineMarkdown(h[2]) }}
        />
      )
    }

    if (/^>\s/.test(trimmed)) {
      const quote = trimmed
        .split('\n')
        .map((l) => l.replace(/^>\s?/, ''))
        .join('\n')
      return (
        <blockquote
          key={i}
          className="md-quote"
          dangerouslySetInnerHTML={{ __html: inlineMarkdown(quote) }}
        />
      )
    }

    const lines = para.split('\n')
    const isBullet = lines.every((l) => /^[-*]\s+/.test(l.trim()) || l.trim() === '')
    if (isBullet && lines.some((l) => l.trim())) {
      return (
        <ul key={i} className="md-list">
          {lines
            .filter((l) => l.trim())
            .map((l, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: inlineMarkdown(l.replace(/^[-*]\s+/, '')) }} />
            ))}
        </ul>
      )
    }

    const isOrdered = lines.every((l) => /^\d+\.\s+/.test(l.trim()) || l.trim() === '')
    if (isOrdered && lines.some((l) => l.trim())) {
      return (
        <ol key={i} className="md-list md-olist">
          {lines
            .filter((l) => l.trim())
            .map((l, j) => (
              <li
                key={j}
                dangerouslySetInnerHTML={{ __html: inlineMarkdown(l.replace(/^\d+\.\s+/, '')) }}
              />
            ))}
        </ol>
      )
    }

    return (
      <p
        key={i}
        className="md-p"
        dangerouslySetInnerHTML={{ __html: lines.map((l) => inlineMarkdown(l)).join('<br/>') }}
      />
    )
  })
}

function CodeBlock({ lang, code }: { lang: string; code: string }): React.JSX.Element | null {
  const [copied, setCopied] = React.useState(false)
  if (!code.trim() && !lang) return null
  const html = highlightCode(code, lang)
  const label = lang || 'code'

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="md-code" data-testid="code-block">
      <div className="md-code-head">
        <span className="md-code-lang">{label}</span>
        <button type="button" className="md-code-copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="md-code-pre">
        <code dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} />
      </pre>
    </div>
  )
}

export function MarkdownBody({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const blocks = splitBlocks(text)
  return (
    <div className={className ?? 'md-body'}>
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <CodeBlock key={i} lang={b.lang} code={b.value} />
        ) : (
          <div key={i}>{renderTextBlock(b.value)}</div>
        )
      )}
    </div>
  )
}

export function SendIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 16V6M10 6l-3.5 3.5M10 6l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
