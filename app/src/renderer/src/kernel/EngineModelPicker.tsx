import * as React from 'react'

export function EngineMark({
  engine,
  logoUrl,
  size = 18
}: {
  engine: string
  logoUrl?: string
  size?: number
}): React.JSX.Element {
  const s: React.CSSProperties = {
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
        color: engine === 'codex' ? '#10a37f' : '#D97757',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 4
      }}
    >
      {engine === 'codex' ? 'O' : 'A'}
    </span>
  )
}

type EngineModelPickerProps = {
  engineId: string
  modelId: string
  catalog: EngineModelCatalog[]
  onChange: (engine: string, model: string) => void
  disabled?: boolean
  testId?: string
  className?: string
  menuAlign?: 'left' | 'right'
}

export function EngineModelPicker({
  engineId,
  modelId,
  catalog,
  onChange,
  disabled,
  testId,
  className,
  menuAlign = 'right'
}: EngineModelPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  const engineEntry = catalog.find((c) => c.engine === engineId)
  const modelEntry = engineEntry?.models.find((m) => m.id === modelId)
  const engineLabel = engineEntry?.label ?? engineId
  const modelLabel = modelEntry?.label ?? modelId

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div
      ref={rootRef}
      className={'ui-picker ui-engine-picker' + (className ? ' ' + className : '') + (open ? ' is-open' : '')}
      data-testid={testId}
    >
      <button
        type="button"
        className="ui-picker-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ui-engine-picker-mark">
          <EngineMark engine={engineId} logoUrl={engineEntry?.logoUrl} size={16} />
        </span>
        <span className="ui-engine-picker-body">
          <span className="ui-engine-picker-engine">{engineLabel}</span>
          <span className="ui-engine-picker-sep" aria-hidden>
            ·
          </span>
          <span className="ui-engine-picker-model">{modelLabel}</span>
        </span>
        <svg className="ui-picker-chevron" width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className={'ui-picker-menu' + (menuAlign === 'left' ? ' align-left' : '')} role="listbox">
          {catalog.map((entry) => (
            <div key={entry.engine} className="ui-engine-picker-group">
              <div className="ui-engine-picker-group-head">
                <EngineMark engine={entry.engine} logoUrl={entry.logoUrl} size={14} />
                <span>{entry.label}</span>
              </div>
              {entry.models.map((model) => {
                const active = entry.engine === engineId && model.id === modelId
                return (
                  <button
                    key={`${entry.engine}:${model.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={'ui-picker-item ui-engine-picker-item' + (active ? ' active' : '')}
                    onClick={() => {
                      onChange(entry.engine, model.id)
                      setOpen(false)
                    }}
                  >
                    {model.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
