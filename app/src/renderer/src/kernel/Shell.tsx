import * as React from 'react'
import UserlandHost from './UserlandHost'
import ModifyChat from './ModifyChat'

function trackKernelEvent(name: string, props?: Record<string, unknown>): void {
  void window.y.analytics.track(name, props)
}

// Kernel frame: Userland fills the window; Modify is a Kernel-owned rail.
function Shell(): React.JSX.Element {
  const [modifyOpen, setModifyOpen] = React.useState(false)
  const [modifyWidth, setModifyWidth] = React.useState(420)
  const [userlandLayout, setUserlandLayout] = React.useState({ fileRailOpen: false, fileRailWidth: 326 })

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
      if (shouldCollapse) window.requestAnimationFrame(() => setModifyOpen(false))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  React.useEffect(() => {
    if (window.electron?.process?.platform === 'darwin') {
      document.documentElement.classList.add('platform-darwin')
    }
    return window.electron?.window?.onFullscreen((full: boolean) => {
      document.documentElement.classList.toggle('is-fullscreen', full)
    })
  }, [])

  const openModify = React.useCallback((source: string): void => {
    setModifyOpen((open) => {
      if (!open) trackKernelEvent('modify_opened', { source })
      return true
    })
  }, [])

  const closeModify = React.useCallback((source: string): void => {
    setModifyOpen((open) => {
      if (open) trackKernelEvent('modify_closed', { source })
      return false
    })
  }, [])

  const toggleModify = React.useCallback((source: string): void => {
    setModifyOpen((open) => {
      trackKernelEvent(open ? 'modify_closed' : 'modify_opened', { source })
      return !open
    })
  }, [])

  return (
    <div className="kernel-shell">
      <div
        className={
          'kernel-body' +
          (modifyOpen ? ' is-modify-open' : '') +
          (userlandLayout.fileRailOpen ? ' is-file-rail-open' : '')
        }
        style={
          {
            '--modify-rail-width': `${modifyWidth}px`,
            '--userland-file-rail-width': `${userlandLayout.fileRailWidth}px`
          } as React.CSSProperties
        }
      >
        <div className="kernel-drag-region kernel-drag-region-top" aria-hidden="true" />
        <main className="userland-slot">
          <UserlandHost
            modifyOpen={modifyOpen}
            onModifyOpen={() => openModify('userland')}
            onModifyClose={() => closeModify('userland')}
            onModifyToggle={() => toggleModify('userland')}
            onUserlandLayout={(state) =>
              setUserlandLayout({
                fileRailOpen: state.fileRailOpen,
                fileRailWidth: state.fileRailWidth ?? 326
              })
            }
          />
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
          <ModifyChat onClose={() => closeModify('modify')} />
        </aside>
      </div>
    </div>
  )
}

export default Shell
