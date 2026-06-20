import * as React from 'react'
import UserlandHost from './UserlandHost'
import ModifyChat from './ModifyChat'

// Kernel frame: Userland fills the window; Modify is a side rail toggled via window.y.modify.
function Shell(): React.JSX.Element {
  const [modifyOpen, setModifyOpen] = React.useState(false)
  const [modifyWidth, setModifyWidth] = React.useState(420)

  React.useEffect(() => {
    return window.y.modify.onChange(setModifyOpen)
  }, [])

  function beginModifyResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = modifyWidth
    const max = Math.min(640, Math.floor(window.innerWidth * 0.5))
    let shouldCollapse = false
    document.documentElement.classList.add('is-modify-resizing')
    const move = (moveEvent: PointerEvent): void => {
      const rawWidth = startWidth - (moveEvent.clientX - startX)
      shouldCollapse = rawWidth < 284
      setModifyWidth(Math.min(max, Math.max(340, rawWidth)))
    }
    const stop = (): void => {
      document.documentElement.classList.remove('is-modify-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      if (shouldCollapse) window.requestAnimationFrame(() => window.y.modify.close())
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  React.useEffect(() => {
    if (window.electron?.process?.platform === 'darwin') {
      document.documentElement.classList.add('platform-darwin')
    }
    return window.electron?.ipcRenderer?.on('window:fullscreen', (_e, full: boolean) => {
      document.documentElement.classList.toggle('is-fullscreen', full)
    })
  }, [])

  return (
    <div className="kernel-shell">
      <div className="kernel-body">
        <main className="userland-slot">
          <UserlandHost />
        </main>

        <aside
          className={'modify-rail' + (modifyOpen ? ' is-open' : '')}
          aria-hidden={!modifyOpen}
          style={{ '--modify-rail-width': `${modifyWidth}px` } as React.CSSProperties}
        >
          <div
            className="modify-resize-handle"
            role="separator"
            tabIndex={modifyOpen ? 0 : -1}
            aria-label="Resize Modify sidebar"
            aria-orientation="vertical"
            onPointerDown={beginModifyResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setModifyWidth((width) => Math.min(640, width + 10))
              if (event.key === 'ArrowRight') setModifyWidth((width) => Math.max(340, width - 10))
            }}
          />
          <ModifyChat onClose={() => window.y.modify.close()} />
        </aside>
      </div>
    </div>
  )
}

export default Shell
