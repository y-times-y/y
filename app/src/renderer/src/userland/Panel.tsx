// This is USERLAND: everything here is fair game for the user/agent to reshape.
// In later phases this file will be loaded from a writable, hot-swappable location
// so the app can rewrite it live. For now it's a normal component, to establish
// the boundary.
function Panel(): React.JSX.Element {
  return (
    <div className="userland-panel">
      <h1 className="userland-title">This panel is yours</h1>
      <p className="userland-body">
        Everything inside this slot is <strong>Userland</strong> — layout, text, colors,
        components. Later, the agent will reshape it live.
      </p>
      <p className="userland-body">
        The bar above with the <code>y</code> logo is <strong>Kernel</strong> — locked, and
        off-limits to changes.
      </p>
    </div>
  )
}

export default Panel
