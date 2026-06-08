import UserlandHost from './UserlandHost'
import Chat from './Chat'

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

      <div className="kernel-body">
        {/* Chat-first: the engine conversation is the primary surface. */}
        <main className="chat-slot">
          <Chat />
        </main>

        {/* The slot: Kernel owns the layout. UserlandHost loads + mounts Userland here. */}
        <aside className="userland-slot">
          <UserlandHost />
        </aside>
      </div>
    </div>
  )
}

export default Shell
