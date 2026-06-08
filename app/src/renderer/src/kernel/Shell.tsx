import * as React from 'react'
import UserlandHost from './UserlandHost'
import ModifyChat from './ModifyChat'

// The Shell is KERNEL: the protected frame around everything. The user/agent
// can never change this file. It draws the brand and decides where Userland
// is allowed to render (the "slot"). The chat now lives INSIDE Userland
// (panel.tsx) — moddable code that calls the engine bricks itself. The Modify
// surface, by contrast, is Kernel-owned (protected) — the one place that can
// change the app, so you can never modify away your own ability to modify.
function Shell(): React.JSX.Element {
  const [modifyOpen, setModifyOpen] = React.useState(false)

  return (
    <div className="kernel-shell">
      <header className="kernel-topbar">
        <span className="kernel-logo">y</span>
        <button
          className={'modify-toggle' + (modifyOpen ? ' is-open' : '')}
          onClick={() => setModifyOpen((o) => !o)}
        >
          {modifyOpen ? 'Close Modify' : 'Modify'}
        </button>
        <span className="kernel-tag">kernel · protected</span>
      </header>

      <div className="kernel-body">
        {/* The slot: Kernel owns the layout. UserlandHost loads + mounts Userland here. */}
        <main className="userland-slot">
          <UserlandHost />
        </main>

        {/* Modify rail: Kernel-protected; edits Userland live (write mode). */}
        {modifyOpen ? (
          <aside className="modify-rail">
            <ModifyChat />
          </aside>
        ) : null}
      </div>
    </div>
  )
}

export default Shell
