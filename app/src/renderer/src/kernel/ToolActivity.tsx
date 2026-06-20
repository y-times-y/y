import * as React from 'react'
import { highlightLine } from './markdown'

function ToolActivityIcon({ verb }: { verb: string }): React.JSX.Element {
  const name = verb.toLowerCase()
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }

  if (name.includes('edit') || name.includes('write')) {
    return <svg {...common}><path d="M10.7 2.3l3 3L6 13H3v-3z" /><path d="M9.4 3.6l3 3" /></svg>
  }
  if (name.includes('read')) {
    return <svg {...common}><path d="M4 1.75h5l3 3V14.25H4z" /><path d="M9 1.75v3h3M6 8h4M6 10.5h4" /></svg>
  }
  if (name.includes('grep') || name.includes('search') || name.includes('find') || name.includes('web')) {
    return <svg {...common}><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25L14 14" /></svg>
  }
  if (name.includes('glob') || name.includes('list')) {
    return <svg {...common}><path d="M1.75 4.5h5L8 6h6.25v7.25H1.75z" /><path d="M1.75 4.5V2.75h4L7 4.25" /></svg>
  }
  if (name.includes('run') || name.includes('shell') || name.includes('bash') || name.includes('terminal')) {
    return <svg {...common}><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" /><path d="M4.5 6l2 2-2 2M8.5 10h3" /></svg>
  }
  return <svg {...common}><circle cx="4" cy="4" r="1.25" /><circle cx="12" cy="8" r="1.25" /><circle cx="5" cy="12" r="1.25" /><path d="M5.1 4.7l5.8 2.6M10.8 8.8l-4.6 2.4" /></svg>
}

function targetFileName(target?: string): string | undefined {
  if (!target) return undefined
  const matches = target.replace(/ · .*$/, '').match(/[A-Za-z0-9_@.()\/-]+\.[A-Za-z0-9]+/g)
  return matches?.[matches.length - 1]
}

function FileTypeIcon({ name }: { name: string }): React.JSX.Element {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const styles: Record<string, { label: string; color: string }> = {
    ts: { label: 'TS', color: '#3178c6' },
    tsx: { label: 'TSX', color: '#0ea5e9' },
    js: { label: 'JS', color: '#ca8a04' },
    jsx: { label: 'JSX', color: '#ca8a04' },
    py: { label: 'PY', color: '#2563eb' },
    css: { label: 'CSS', color: '#7c3aed' },
    html: { label: 'HTM', color: '#ea580c' },
    json: { label: '{ }', color: '#475569' },
    md: { label: 'MD', color: '#4b5563' },
    yml: { label: 'YML', color: '#b91c1c' },
    yaml: { label: 'YML', color: '#b91c1c' },
    sh: { label: 'SH', color: '#059669' },
    rs: { label: 'RS', color: '#c2410c' },
    go: { label: 'GO', color: '#0891b2' }
  }
  const meta = styles[ext] ?? { label: ext ? ext.slice(0, 3).toUpperCase() : 'F', color: '#374151' }
  return (
    <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="14" fill={meta.color} />
      <text x="50" y="52" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize={meta.label.length >= 3 ? 35 : 46}>{meta.label}</text>
    </svg>
  )
}

export function diffStat(body?: string): { added: number; removed: number } | null {
  if (!body) return null
  let added = 0
  let removed = 0
  for (const line of body.split('\n')) {
    if (line.startsWith('+ ')) added += 1
    else if (line.startsWith('- ')) removed += 1
  }
  return added || removed ? { added, removed } : null
}

function ToolDiffBody({ body, lang }: { body: string; lang: string }): React.JSX.Element {
  let lineNo = 1
  const lines = body
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const del = line.startsWith('- ')
      const add = line.startsWith('+ ')
      return { line, del, add, raw: del || add || line.startsWith('  ') ? line.slice(2) : line }
    })
  const commonIndent = lines.reduce<number | null>((min, item) => {
    if (!item.raw.trim()) return min
    const indent = item.raw.match(/^ */)?.[0].length ?? 0
    return min === null ? indent : Math.min(min, indent)
  }, null) ?? 0
  return (
    <div className="tool-activity-detail">
      {lines.map(({ del, add, raw }, i) => {
        const text = commonIndent > 0 ? raw.slice(commonIndent) : raw
        const cls = del ? ' tool-diff-del' : add ? ' tool-diff-add' : ''
        const mark = del ? '-' : add ? '+' : ' '
        const currentLine = lineNo
        if (!del) lineNo += 1
        return (
          <div key={i} className={'tool-diff-line' + cls}>
            <span className="tool-diff-ln">{currentLine}</span>
            <span className="tool-diff-gutter">{mark}</span>
            <code dangerouslySetInnerHTML={{ __html: highlightLine(text, lang) }} />
          </div>
        )
      })}
    </div>
  )
}

function ToolPlainBody({ verb, target, body, lang }: { verb: string; target?: string; body?: string; lang: string }): React.JSX.Element {
  const isCommand = /run|shell|bash|terminal/i.test(verb)
  const file = targetFileName(target)
  const highlighted = file && body
    ? body.split('\n').map((line) => highlightLine(line, lang)).join('\n')
    : undefined
  return (
    <div className={'tool-activity-detail tool-activity-plain' + (file ? ' has-file' : '')}>
      {isCommand && target ? <div className="tool-activity-command">$ {target}</div> : null}
      {body ? highlighted
        ? <pre><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
        : <pre><code>{body}</code></pre> : null}
    </div>
  )
}

export function ToolActivity({
  verb,
  target,
  body,
  live,
  lang = 'typescript'
}: {
  verb: string
  target?: string
  body?: string
  live?: boolean
  lang?: string
}): React.JSX.Element {
  const showDiff = !live && !!body && (body.includes('\n- ') || body.startsWith('- ') || body.includes('\n+ '))
  const canExpand = !live && Boolean(body || (/run|shell|bash|terminal/i.test(verb) && target))
  const stat = diffStat(body)
  const targetFile = targetFileName(target)
  const activityLine = (
    <div className="tool-activity-line">
      <span className="tool-activity-icon"><ToolActivityIcon verb={verb} /></span>
      <span className="tool-activity-verb">{verb}</span>
      {target ? (
        <span className="tool-activity-target">
          {targetFile ? <span className="tool-activity-file-icon"><FileTypeIcon name={targetFile} /></span> : null}
          <span>{target}</span>
        </span>
      ) : null}
      {stat ? (
        <span className="tool-activity-stat">
          <span className="tool-stat-add">+{stat.added}</span>
          <span className="tool-stat-del">-{stat.removed}</span>
        </span>
      ) : null}
      {canExpand ? (
        <span className="tool-activity-chevron" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      ) : null}
    </div>
  )
  if (canExpand) {
    return (
      <details className="tool-activity is-collapsible">
        <summary>{activityLine}</summary>
        {showDiff && body
          ? <ToolDiffBody body={body} lang={lang} />
          : <ToolPlainBody verb={verb} target={target} body={body} lang={lang} />}
      </details>
    )
  }
  return (
    <div className="tool-activity">
      {activityLine}
    </div>
  )
}

export function toolVerbFromName(name: string): string {
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

/** Stop the live shimmer on in-flight tool rows once the model moves on. */
export function settleTools<T extends { role: string; streaming?: boolean; system?: boolean }>(
  list: T[]
): T[] {
  let touched = false
  const out = list.map((m) => {
    if (m.role === 'tool' && m.streaming && !m.system) {
      touched = true
      return { ...m, streaming: false }
    }
    return m
  })
  return touched ? out : list
}
