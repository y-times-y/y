import * as React from 'react'

type AuthStatus = 'checking' | 'signed-out' | 'signed-in'

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybeHuman = Reflect.get(error, 'humanReadableMessage')
    if (typeof maybeHuman === 'string' && maybeHuman.trim()) return maybeHuman
    const maybeMessage = Reflect.get(error, 'message')
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage
  }
  return error instanceof Error ? error.message : String(error)
}

function BinaryRain(): React.JSX.Element {
  const cols = React.useMemo(
    () =>
      Array.from({ length: 32 }, (_, index) => {
        const duration = 14
        const delay = -(Math.random() * duration)
        const half = Array.from({ length: 60 }, () => (Math.random() > 0.5 ? '1' : '0'))
        return { id: index, duration, delay, bits: [...half, ...half] }
      }),
    []
  )

  return (
    <div className="y-bin-rain" aria-hidden="true">
      {cols.map((col) => (
        <div
          key={col.id}
          className="y-bin-col"
          style={{
            left: `${(col.id / (cols.length - 1)) * 100}%`,
            animationDuration: `${col.duration}s`,
            animationDelay: `${col.delay}s`,
            animationDirection: col.id % 2 === 0 ? 'normal' : 'reverse'
          }}
        >
          {col.bits.map((bit, index) => (
            <span key={index}>{bit}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = React.useState<AuthStatus>('checking')
  const [error, setError] = React.useState<string>('')
  const [authStatus, setAuthStatus] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [browserOpened, setBrowserOpened] = React.useState(false)
  const signInAttemptRef = React.useRef(0)

  React.useEffect(() => {
    void window.y.analytics.track('auth_gate_viewed')
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function restore(): Promise<void> {
      const restored = await window.yKernelAuth.restore()
      if (cancelled) return
      setStatus(restored.ok && restored.session ? 'signed-in' : 'signed-out')
      if (restored.ok && restored.session) {
        setBusy(false)
        setBrowserOpened(false)
        setAuthStatus('')
      }
    }
    const off = window.yKernelAuth.onChanged((session) => {
      setStatus(session ? 'signed-in' : 'signed-out')
      if (session) void window.y.analytics.track('auth_sign_in_completed', { source: 'browser' })
      if (!session) {
        setBusy(false)
        setAuthStatus('')
        setBrowserOpened(false)
      }
    })
    const offCallback = window.yKernelAuth.onCallback(() => {
      setAuthStatus('Returning to y. Completing sign in.')
      void restore()
    })
    void restore()
    return () => {
      cancelled = true
      off()
      offCallback()
    }
  }, [])

  async function signIn(): Promise<void> {
    const attempt = signInAttemptRef.current + 1
    signInAttemptRef.current = attempt
    setBusy(true)
    setBrowserOpened(true)
    setError('')
    setAuthStatus('Browser opened. Sign in there, then approve y desktop to finish.')
    void window.y.analytics.track('auth_sign_in_started', { source: 'login' })
    try {
      const result = await window.yKernelAuth.signIn()
      if (signInAttemptRef.current !== attempt) return
      if (!result.ok) throw new Error(result.error || 'Could not sign in.')
      setAuthStatus('Completing sign in.')
      setStatus('signed-in')
      setError('')
      void window.y.analytics.track('auth_sign_in_completed', { source: 'login' })
    } catch (err) {
      if (signInAttemptRef.current !== attempt) return
      const message = getErrorMessage(err)
      setError(message)
      setAuthStatus('')
      setStatus('signed-out')
      void window.y.analytics.track('auth_sign_in_failed', { source: 'login' })
    } finally {
      if (signInAttemptRef.current === attempt) setBusy(false)
    }
  }

  if (status === 'signed-in') return <>{children}</>
  if (status === 'checking') return <div className="y-auth-boot" aria-hidden="true" />

  return (
    <main className="y-login" data-testid="auth-gate">
      <div className="y-login-drag" />
      <section className="y-login-left">
        <div className="y-login-body">
          <h1 className="y-login-headline">There are many coding agent apps out there, this one is yours.</h1>
          <p className="y-login-sub">Sign in or create an account to get started.</p>

          <div className="y-login-form" aria-live="polite">
            <button
              type="button"
              className="y-login-magic"
              onClick={() => void signIn()}
              disabled={busy}
            >
              {busy ? 'OPENING...' : 'SIGN IN TO Y'}
            </button>

            {authStatus ? <div className="y-login-status">{authStatus}</div> : null}
            {browserOpened && busy ? (
              <button type="button" className="y-login-retry" onClick={() => void signIn()}>
                Open again
              </button>
            ) : null}
            {error ? <div className="y-login-status is-error">{error}</div> : null}
          </div>
        </div>
      </section>
      <section className="y-login-right" aria-hidden="true">
        <BinaryRain />
      </section>
    </main>
  )
}

export default AuthGate
