import Shell from './kernel/Shell'
import AuthGate from './kernel/AuthGate'

// App just mounts the Kernel Shell. The Shell is what enforces the
// Kernel-frame / Userland-slot structure.
function App(): React.JSX.Element {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  )
}

export default App
