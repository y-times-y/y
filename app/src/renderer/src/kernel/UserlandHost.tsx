import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'

// Turn compiled CommonJS code into a live React component.
// The require shim hands the Userland module OUR React (and jsx runtime), so
// there is only ever ONE React instance in play — that's what lets hooks work
// inside Userland components (two copies of React would break them).
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

// UserlandHost is KERNEL code: it compiles + mounts Userland into the slot,
// and snapshots every good state so a Revert is always one click away.
function UserlandHost(): React.JSX.Element {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null)
  const [error, setError] = React.useState('')
  const [path, setPath] = React.useState('')
  const [snap, setSnap] = React.useState<{ hash: string; count: number } | null>(null)

  const load = React.useCallback(async () => {
    setError('')
    setPath(await window.y.userland.getPath())

    const result = await window.y.userland.compile()
    if (!result.ok || !result.code) {
      setComponent(null)
      setError(result.error ?? 'Unknown compile error')
      return
    }

    try {
      const Compiled = buildComponent(result.code)
      // Store the component via the updater form: setState(fn) would otherwise
      // CALL fn as a reducer. We want to keep the function itself in state.
      setComponent(() => Compiled)
      // It rendered cleanly → save a snapshot (no-op if nothing changed).
      const s = await window.y.userland.snapshot()
      if (s.ok && s.hash) setSnap({ hash: s.hash, count: s.count ?? 0 })
    } catch (err) {
      setComponent(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const revert = React.useCallback(async () => {
    const r = await window.y.userland.revert()
    if (!r.ok) {
      setError(r.error ?? 'Could not revert')
      return
    }
    // Re-compile + render the restored code.
    await load()
  }, [load])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="userland-host">
      <div className="userland-toolbar">
        <button className="btn" onClick={() => void load()}>
          Reload Userland
        </button>
        <button className="btn" onClick={() => void revert()}>
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
        ) : Component ? (
          <Component />
        ) : (
          <span className="userland-path">Loading…</span>
        )}
      </div>
      <span className="userland-path userland-meta">{path}</span>
    </div>
  )
}

export default UserlandHost
