import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import { publishVerdict } from './userlandStatus'
import XtermTerminal from './XtermTerminal'
import hljs from 'highlight.js/lib/common'

// Turn compiled CommonJS code into a live React component.
function buildComponent(code: string): React.ComponentType {
  const moduleObj: { exports: { default?: React.ComponentType } & Record<string, unknown> } = {
    exports: {}
  }
  const requireShim = (name: string): unknown => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') return ReactJsxRuntime
    if (name === '@renderer/kernel/XtermTerminal') return XtermTerminal
    if (name === 'highlight.js/lib/common') return hljs
    throw new Error(`Userland imported "${name}", which y doesn't expose yet`)
  }
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  const factory = new Function('require', 'module', 'exports', code)
  factory(requireShim, moduleObj, moduleObj.exports)

  const Component = (moduleObj.exports.default ?? moduleObj.exports) as React.ComponentType
  if (typeof Component !== 'function') {
    throw new Error('Userland file must `export default` a React component')
  }
  return Component
}

class UserlandErrorBoundary extends React.Component<
  { onError: (e: Error) => void; resetKey: number; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey: number }): void {
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

// UserlandHost compiles + mounts Userland, watches live edits, auto-rolls-back on crash.
// Keep/Discard lives in ModifyChat — only after a Modify turn finishes.
function UserlandHost(): React.JSX.Element {
  const [Component, setComponent] = React.useState<React.ComponentType | null>(null)
  const [error, setError] = React.useState('')
  const [crash, setCrash] = React.useState('')
  const [path, setPath] = React.useState('')
  const [snap, setSnap] = React.useState<{ hash: string; count: number } | null>(null)
  const [loadId, setLoadId] = React.useState(0)

  const crashedRef = React.useRef(false)
  const autoRolledBackRef = React.useRef(false)
  const recoveryRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setError('')
    setCrash('')
    crashedRef.current = false
    setPath(await window.y.userland.getPath())

    const result = await window.y.userland.compile()
    if (!result.ok || !result.code) {
      setComponent(null)
      const msg = result.error ?? 'Unknown compile error'
      setError(msg)
      publishVerdict({ outcome: 'compile-error', error: msg })
      return
    }

    try {
      const Compiled = buildComponent(result.code)
      setComponent(() => Compiled)
      setLoadId((n) => n + 1)
    } catch (err) {
      setComponent(null)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      publishVerdict({ outcome: 'compile-error', error: msg })
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

  const handleCrash = React.useCallback(
    (err: Error) => {
      crashedRef.current = true
      setCrash(err.message)
      publishVerdict({ outcome: 'crash', error: err.message })
      if (!autoRolledBackRef.current) {
        autoRolledBackRef.current = true
        recoveryRef.current = true
        void revertAndReload()
      }
    },
    [revertAndReload]
  )

  React.useEffect(() => {
    if (!Component || crashedRef.current) return
    autoRolledBackRef.current = false
    if (recoveryRef.current) {
      recoveryRef.current = false
    } else {
      publishVerdict({ outcome: 'ok' })
    }
    void window.y.userland.diff().then((d) => {
      if (d.ok && d.hash) setSnap({ hash: d.hash, count: d.count ?? 0 })
    })
  }, [Component, loadId])

  React.useEffect(() => {
    const off = window.y.userland.onChanged(() => void load())
    void load()
    return off
  }, [load])

  const showDevChrome = Boolean(error || crash)

  return (
    <div className="userland-host">
      {showDevChrome && snap ? (
        <div className="userland-statusbar">
          <span className="userland-path">
            snapshot {snap.hash} · {snap.count} saved
          </span>
          <div className="userland-statusbar-actions">
            <button className="btn btn-ghost" onClick={() => void load()}>
              Reload
            </button>
            <button className="btn btn-ghost" onClick={() => void revertAndReload()}>
              Revert
            </button>
          </div>
        </div>
      ) : null}
      <div className="userland-stage">
        {error ? (
          <div className="userland-recovery">
            <strong>Userland failed to compile.</strong>
            <pre className="userland-error">{error}</pre>
            <div className="userland-toolbar">
              <button className="btn" onClick={() => void revertAndReload()}>
                Revert to previous snapshot
              </button>
              <button className="btn" onClick={() => void load()}>
                Reload
              </button>
            </div>
          </div>
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
          <div className="userland-loading">Loading…</div>
        )}
      </div>
      {showDevChrome && path ? <span className="userland-path userland-meta">{path}</span> : null}
    </div>
  )
}

export default UserlandHost
