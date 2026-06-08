import UserlandHost from './UserlandHost'

// The Shell is KERNEL: the protected frame around everything. The user/agent
// can never change this file. It draws the brand and decides where Userland
// is allowed to render (the "slot"). The chat now lives INSIDE Userland
// (panel.tsx) — it's moddable code that calls the engine bricks itself.
function Shell(): React.JSX.Element {
  return (
    <div className="kernel-shell">
      <header className="kernel-topbar">
        <span className="kernel-logo">y</span>
        <span className="kernel-tag">kernel · protected</span>
      </header>

      {/* The slot: Kernel owns the layout. UserlandHost loads + mounts Userland here. */}
      <main className="userland-slot">
        <UserlandHost />
      </main>
    </div>
  )
}

export default Shell
