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

export function normalizeMarkdownFences(text: string): string {
  return (text || '')
    .replace(/<CodeGroup[^>]*>\s*\n?([\s\S]*?)\n?\s*<\/CodeGroup>/g, (_match, inner: string) => {
      return `\n${inner.replace(/^ {2}/gm, '').trim()}\n`
    })
    .replace(/(^|\n)(\s*)\\`\\`\\`/g, '$1$2```')
    .replace(
      /(^|\n)(\s*)```([A-Za-z0-9_-]+)([^\n`]*?\btheme=\{null\})(?:\s+([^\n]+))?/g,
      (_match, prefix: string, indent: string, lang: string, _meta: string, rest?: string) => {
        const code = rest?.trim()
        return `${prefix}${indent}\`\`\`${normalizeLang(lang)}${code ? `\n${indent}${code}` : ''}`
      }
    )
    .replace(
      /(^|\n)(\s*)```([A-Za-z0-9_-]+)\s+((?:from|import|async|def|class|if|for|while|const|let|var|function|return|#|\/\/)[^\n]*)/g,
      (_match, prefix: string, indent: string, lang: string, code: string) => {
        return `${prefix}${indent}\`\`\`${normalizeLang(lang)}\n${indent}${code.trim()}`
      }
    )
}

function TableBlock({ lines }: { lines: string[] }): React.JSX.Element | null {
  const rows = lines
    .filter((line) => !/^\s*\|[\s\-:|]+\|\s*$/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
  if (!rows.length) return null
  const header = rows[0]
  const body = rows.slice(1)
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>{header.map((cell, index) => <th key={index} dangerouslySetInnerHTML={{ __html: inlineMarkdown(cell) }} />)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex} dangerouslySetInnerHTML={{ __html: inlineMarkdown(cell) }} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TextBlock({ text }: { text: string }): React.JSX.Element {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const elements: React.ReactElement[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      i += 1
      continue
    }

    const h = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const cls = level === 1 ? 'md-h1' : level === 2 ? 'md-h2' : 'md-h3'
      elements.push(<div key={i} className={cls} dangerouslySetInnerHTML={{ __html: inlineMarkdown(h[2]) }} />)
      i += 1
      continue
    }

    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      elements.push(<hr key={i} className="md-hr" />)
      i += 1
      continue
    }

    if (trimmed.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      elements.push(<blockquote key={`q${i}`} className="md-quote" dangerouslySetInnerHTML={{ __html: inlineMarkdown(quoteLines.join('\n')) }} />)
      continue
    }

    if (trimmed.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i += 1
      }
      elements.push(<TableBlock key={`t${i}`} lines={tableLines} />)
      continue
    }

    if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
      const items: { checked: boolean; text: string }[] = []
      while (i < lines.length && /^[-*]\s+\[[ xX]\]\s+/.test(lines[i].trim())) {
        const match = lines[i].trim().match(/^[-*]\s+\[([ xX])\]\s+(.+)$/)
        if (match) items.push({ checked: match[1].toLowerCase() === 'x', text: match[2] })
        i += 1
      }
      elements.push(
        <ul key={`tasks${i}`} className="md-list md-task-list">
          {items.map((item, index) => (
            <li key={index} className={item.checked ? 'is-checked' : undefined}>
              <span className="md-task-box" aria-hidden="true">{item.checked ? '✓' : ''}</span>
              <span dangerouslySetInnerHTML={{ __html: inlineMarkdown(item.text) }} />
            </li>
          ))}
        </ul>
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i += 1
      }
      elements.push(<ul key={`ul${i}`} className="md-list">{items.map((item, index) => <li key={index} dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />)}</ul>)
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
        i += 1
      }
      elements.push(<ol key={`ol${i}`} className="md-list md-olist">{items.map((item, index) => <li key={index} dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />)}</ol>)
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length) {
      const current = lines[i].trim()
      if (!current) {
        i += 1
        break
      }
      if (/^#{1,3}\s/.test(current) || /^[-*_]{3,}\s*$/.test(current) || current.startsWith('|') || /^[-*]\s+/.test(current) || /^\d+\.\s+/.test(current) || current.startsWith('> ')) break
      paraLines.push(lines[i])
      i += 1
    }
    if (paraLines.length) {
      elements.push(<p key={`p${i}`} className="md-p" dangerouslySetInnerHTML={{ __html: paraLines.map((current) => inlineMarkdown(current)).join('<br/>') }} />)
    }
  }
  return <>{elements}</>
}

function CodeBlock({ lang, code }: { lang: string; code: string }): React.JSX.Element | null {
  const [copied, setCopied] = React.useState(false)
  if (!code.trim() && !lang) return null
  const html = highlightCode(code, lang)
  const label = lang || 'code'

  const copy = (): void => {
    const write = window.y?.clipboard?.writeText
      ? window.y.clipboard.writeText(code).then((result) => {
          if (!result.ok) throw new Error(result.error || 'Could not copy code')
        })
      : navigator.clipboard.writeText(code)
    void write.then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="md-code" data-testid="code-block">
      <div className="md-code-head">
        <span className="md-code-lang">{label}</span>
        <button type="button" className={`md-code-copy${copied ? ' is-copied' : ''}`} aria-label={copied ? 'Copied code' : 'Copy code'} title={copied ? 'Copied' : 'Copy code'} onClick={copy}>
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M4.5 10.5l3.4 3.4 7.6-8.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden>
              <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13.5 6.5V5A1.5 1.5 0 0012 3.5H5A1.5 1.5 0 003.5 5v7A1.5 1.5 0 005 13.5h1.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>
      </div>
      <pre className="md-code-pre">
        <code dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} />
      </pre>
    </div>
  )
}

export function MarkdownBody({
  text,
  className,
  streaming = false
}: {
  text: string
  className?: string
  streaming?: boolean
}): React.JSX.Element {
  const blocks = splitBlocks(normalizeMarkdownFences(text))
  const rootClassName = className ?? `md-body${streaming ? ' is-streaming' : ''}`
  return (
    <div className={rootClassName}>
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <div key={i}><CodeBlock lang={b.lang} code={b.value} /></div>
        ) : (
          <div key={i}><TextBlock text={b.value} /></div>
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
