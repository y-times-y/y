import * as React from 'react'
import { highlightLine } from './markdown'

function ToolDiffBody({ body, lang }: { body: string; lang: string }): React.JSX.Element {
  return (
    <div className="tool-activity-detail">
      {body.split('\n').map((line, i) => {
        if (!line) return null
        const del = line.startsWith('- ')
        const add = line.startsWith('+ ')
        const raw = del || add ? line.slice(2) : line
        const cls = del ? ' tool-diff-del' : add ? ' tool-diff-add' : ''
        return (
          <div key={i} className={'tool-diff-line' + cls}>
            <code dangerouslySetInnerHTML={{ __html: highlightLine(raw, lang) }} />
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
  const showDiff = !!body && (body.includes('\n- ') || body.startsWith('- ') || body.includes('\n+ '))
  return (
    <div className="tool-activity">
      <div className="tool-activity-line">
        <span className={'tool-activity-verb' + (live ? ' is-live' : '')}>{verb}</span>
        {target ? <span className="tool-activity-target">{target}</span> : null}
      </div>
      {body ? (
        showDiff ? (
          <ToolDiffBody body={body} lang={lang} />
        ) : (
          <pre className="tool-activity-detail">{body}</pre>
        )
      ) : null}
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
