import Panel from '../userland/Panel'

// The Shell is KERNEL: the protected frame around everything. The user/agent
// can never change this file. It draws the brand and decides where Userland
// is allowed to render (the "slot").
function Shell(): React.JSX.Element {
  return (
    <div className="kernel-shell">
      <header className="kernel-topbar">
        <span className="kernel-logo">y</span>
        <span className="kernel-tag">kernel · protected</span>
      </header>

      {/* The slot: Kernel owns the layout; Userland renders INSIDE here. */}
      <main className="userland-slot">
        <Panel />
      </main>
    </div>
  )
}

export default Shell
