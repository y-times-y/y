import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'

// Turn compiled CommonJS code into a live React component.
// The require shim hands the Userland module OUR React (and jsx runtime), so
// there is only ever ONE React instance — that's what lets hooks work inside
// Userland components (two copies of React would break them).
function buildComponent(code: string): React.ComponentType {
  const moduleObj: { exports: { default?: React.ComponentType } & Record<string, unknown> } = {
    exports: {}
  }
  const requireShim = (name: string): unknown => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') return ReactJsxRuntime
    throw new Error(`Userland imported "${name}", which y doesn't expose yet`)
  }
  // new Function is eval-family — this is the deliberate seam where Userland
  // code actually runs. (Requires 'unsafe-eval' in the renderer CSP.)
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  const factory = new Function('require', 'module', 'exports', code)
  factory(requireShim, moduleObj, moduleObj.exports)

  const Component = (moduleObj.exports.default ?? moduleObj.exports) as React.ComponentType
  if (typeof Component !== 'function') {
    throw new Error('Userland file must `export default` a React component')
  }
  return Component
}

// Error boundaries MUST be class components — it's the only way React lets us
// catch a render-time crash in a child subtree. This one reports the error up
// to the host and renders nothing; the host decides how to recover.
class UserlandErrorBoundary extends React.Component<
  { onError: (e: Error) => void; resetKey: number; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey: number }): void {
    // A new resetKey means the host swapped in fresh code → clear the failure.
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error instanceof Error ? error : new Error(String(error)))
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

// UserlandHost is KERNEL code: it compiles + mounts Userland, snapshots every
// good state, watches for live edits, and auto-rolls-back on a crash.
function UserlandHost(): React.JSX.Element {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null)
  const [error, setError] = React.useState('') // compile / build error
  const [crash, setCrash] = React.useState('') // runtime render crash
  const [path, setPath] = React.useState('')
  const [snap, setSnap] = React.useState<{ hash: string; count: number } | null>(null)
  const [loadId, setLoadId] = React.useState(0)

  const crashedRef = React.useRef(false)
  const autoRolledBackRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setError('')
    setCrash('')
    crashedRef.current = false
    setPath(await window.y.userland.getPath())

    const result = await window.y.userland.compile()
    if (!result.ok || !result.code) {
      setComponent(null)
      setError(result.error ?? 'Unknown compile error')
      return
    }

    try {
      const Compiled = buildComponent(result.code)
      // Updater form: setState(fn) would CALL fn as a reducer; we want to KEEP
      // the function in state. Bump loadId so the error boundary resets.
      setComponent(() => Compiled)
      setLoadId((n) => n + 1)
    } catch (err) {
      setComponent(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const revertAndReload = React.useCallback(async () => {
    const r = await window.y.userland.revert()
    if (!r.ok) {
      setCrash((c) => c || (r.error ?? 'Could not revert'))
      return
    }
    await load()
  }, [load])

  // Called by the boundary when Userland throws during render.
  const handleCrash = React.useCallback(
    (err: Error) => {
      crashedRef.current = true
      setCrash(err.message)
      if (!autoRolledBackRef.current) {
        // First crash for this edit → auto-rollback ONCE to the last good snapshot.
        autoRolledBackRef.current = true
        void revertAndReload()
      }
      // If we already rolled back and it STILL crashed, stop and show manual recovery.
    },
    [revertAndReload]
  )

  // Runs after every commit. If the freshly-rendered Userland did NOT crash,
  // this is a known-good state → snapshot it and re-arm auto-rollback. This is
  // why "last snapshot" is always safe to roll back to.
  React.useEffect(() => {
    if (!Component || crashedRef.current) return
    autoRolledBackRef.current = false
    void window.y.userland.snapshot().then((s) => {
      if (s.ok && s.hash) setSnap({ hash: s.hash, count: s.count ?? 0 })
    })
  }, [Component, loadId])

  // Live edits: re-render automatically when panel.tsx changes on disk.
  React.useEffect(() => {
    const off = window.y.userland.onChanged(() => void load())
    void load()
    return off
  }, [load])

  return (
    <div className="userland-host">
      <div className="userland-toolbar">
        <button className="btn" onClick={() => void load()}>
          Reload Userland
        </button>
        <button className="btn" onClick={() => void revertAndReload()}>
          Revert
        </button>
        {snap && (
          <span className="userland-path">
            snapshot {snap.hash} · {snap.count} saved
          </span>
        )}
      </div>
      <div className="userland-stage">
        {error ? (
          <pre className="userland-error">{error}</pre>
        ) : crash ? (
          <div className="userland-recovery">
            <strong>Userland crashed at runtime.</strong>
            <pre className="userland-error">{crash}</pre>
            <p className="userland-path">
              Auto-rollback to the last snapshot didn&apos;t recover it. Fix the code and reload, or
              step back another snapshot.
            </p>
            <div className="userland-toolbar">
              <button className="btn" onClick={() => void revertAndReload()}>
                Revert to previous snapshot
              </button>
              <button className="btn" onClick={() => void load()}>
                Reload
              </button>
            </div>
          </div>
        ) : Component ? (
          <UserlandErrorBoundary onError={handleCrash} resetKey={loadId}>
            <Component />
          </UserlandErrorBoundary>
        ) : (
          <span className="userland-path">Loading…</span>
        )}
      </div>
      <span className="userland-path userland-meta">{path}</span>
    </div>
  )
}

export default UserlandHost
