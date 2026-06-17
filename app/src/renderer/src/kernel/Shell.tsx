import * as React from 'react'
import UserlandHost from './UserlandHost'
import ModifyChat from './ModifyChat'

// Kernel frame: Userland fills the window; Modify is a side rail toggled via window.y.modify.
function Shell(): React.JSX.Element {
  const [modifyOpen, setModifyOpen] = React.useState(false)

  React.useEffect(() => {
    return window.y.modify.onChange(setModifyOpen)
  }, [])

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

        <aside className={'modify-rail' + (modifyOpen ? ' is-open' : '')} aria-hidden={!modifyOpen}>
          <ModifyChat onClose={() => window.y.modify.close()} />
        </aside>
      </div>
    </div>
  )
}

export default Shell
