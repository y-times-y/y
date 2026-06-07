import Shell from './kernel/Shell'

// App just mounts the Kernel Shell. The Shell is what enforces the
// Kernel-frame / Userland-slot structure.
function App(): React.JSX.Element {
  return <Shell />
}

export default App
