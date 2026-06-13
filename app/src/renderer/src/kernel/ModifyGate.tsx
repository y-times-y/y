import * as React from 'react'
import { DiffView } from './DiffView'
import { parseUnifiedDiff, type ParsedDiffFile } from './diffParse'

export function ModifyGate({
  diff,
  onKeep,
  onDiscard
}: {
  diff: string
  onKeep: () => void
  onDiscard: () => void
}): React.JSX.Element {
  const files = React.useMemo(() => parseUnifiedDiff(diff), [diff])
  const [selected, setSelected] = React.useState(0)

  React.useEffect(() => {
    if (selected >= files.length) setSelected(0)
  }, [files.length, selected])

  const active: ParsedDiffFile | undefined = files[selected] ?? files[0]
  const totalAdds = files.reduce((n, f) => n + f.adds, 0)
  const totalDels = files.reduce((n, f) => n + f.dels, 0)

  return (
    <div className="modify-gate" data-testid="modify-gate">
      <div className="modify-gate-head">
        <div className="modify-gate-summary">
          <span className="modify-gate-title">
            {files.length === 1 ? '1 file changed' : `${files.length} files changed`}
          </span>
          <span className="modify-gate-stats">
            <span className="modify-gate-add">+{totalAdds}</span>
            <span className="modify-gate-del">−{totalDels}</span>
          </span>
        </div>
        <div className="modify-gate-actions">
          <button type="button" className="modify-gate-discard" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="modify-gate-keep" onClick={onKeep}>
            Keep
          </button>
        </div>
      </div>

      <div className="modify-gate-body">
        <div className="modify-gate-files" role="tablist" aria-label="Changed files">
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              role="tab"
              aria-selected={i === selected}
              className={'modify-gate-file' + (i === selected ? ' active' : '')}
              onClick={() => setSelected(i)}
            >
              <span className="modify-gate-file-name">{f.path}</span>
              <span className="modify-gate-file-stats">
                {f.adds ? <span className="modify-gate-add">+{f.adds}</span> : null}
                {f.dels ? <span className="modify-gate-del">−{f.dels}</span> : null}
              </span>
            </button>
          ))}
        </div>
        <div className="modify-gate-diff" role="tabpanel">
          {active ? <DiffView text={active.diff} /> : null}
        </div>
      </div>
    </div>
  )
}
