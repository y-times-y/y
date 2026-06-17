import * as React from 'react'
import { highlightLine } from './markdown'

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
  const stat = diffStat(body)
  const activityLine = (
    <div className="tool-activity-line">
      <span className={'tool-activity-verb' + (live ? ' is-live' : '')}>{verb}</span>
      {target ? <span className="tool-activity-target">{target}</span> : null}
      {stat ? (
        <span className="tool-activity-stat">
          <span className="tool-stat-add">+{stat.added}</span>
          <span className="tool-stat-del">-{stat.removed}</span>
        </span>
      ) : null}
    </div>
  )
  if (showDiff) {
    return (
      <details className="tool-activity is-collapsible">
        <summary>{activityLine}</summary>
        <ToolDiffBody body={body} lang={lang} />
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
