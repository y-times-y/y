import * as React from 'react'

// Minimal unified-diff view for the Keep/Discard gate.
export function DiffView({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  return (
    <pre className="userland-diff">
      {lines.map((line, i) => {
        let cls = ''
        if (line.startsWith('@@')) cls = 'diff-hunk'
        else if (line.startsWith('+++') || line.startsWith('---')) cls = 'diff-meta'
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('Index:'))
          cls = 'diff-meta'
        else if (line.startsWith('===')) cls = 'diff-meta'
        else if (line.startsWith('+')) cls = 'diff-add'
        else if (line.startsWith('-')) cls = 'diff-del'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}
