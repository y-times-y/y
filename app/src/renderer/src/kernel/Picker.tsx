import * as React from 'react'

type Option = { id: string; label: string }

type PickerProps = {
  value: string
  options: Option[]
  onChange: (id: string) => void
  disabled?: boolean
  testId?: string
  className?: string
  menuAlign?: 'left' | 'right'
}

export function Picker({
  value,
  options,
  onChange,
  disabled,
  testId,
  className,
  menuAlign = 'right'
}: PickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const label = options.find((o) => o.id === value)?.label ?? value

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
      className={'ui-picker' + (className ? ' ' + className : '') + (open ? ' is-open' : '')}
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
        <span className="ui-picker-label">{label}</span>
        <svg className="ui-picker-chevron" width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className={'ui-picker-menu' + (menuAlign === 'left' ? ' align-left' : '')} role="listbox">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className={'ui-picker-item' + (o.id === value ? ' active' : '')}
              onClick={() => {
                onChange(o.id)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
