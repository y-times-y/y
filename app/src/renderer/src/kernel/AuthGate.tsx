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

function BootLoadingMark(): React.JSX.Element {
  return (
    <svg className="y-boot-loading-mark" viewBox="0 0 84 92" aria-hidden="true">
      <text
        x="42"
        y="68"
        textAnchor="middle"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="90"
        fontWeight="700"
        fill="transparent"
        stroke="currentColor"
        strokeWidth="2.25"
        paintOrder="stroke"
      >
        y
      </text>
    </svg>
  )
}

function AuthGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const bypassAuth = Boolean(window.yTest?.bypassAuth)
  const [status, setStatus] = React.useState<AuthStatus>(bypassAuth ? 'signed-in' : 'checking')
  const [error, setError] = React.useState<string>('')
  const [busy, setBusy] = React.useState(false)
  const [browserOpened, setBrowserOpened] = React.useState(false)
  const signInAttemptRef = React.useRef(0)
  const activeSignInRef = React.useRef(false)

  React.useEffect(() => {
    if (bypassAuth) return
    void window.y.analytics.track('auth_gate_viewed')
  }, [bypassAuth])

  React.useEffect(() => {
    if (bypassAuth) return
    let cancelled = false
    const off = window.yKernelAuth.onChanged((session) => {
      setStatus(session ? 'signed-in' : 'signed-out')
      if (session) void window.y.analytics.track('auth_sign_in_completed', { source: 'browser' })
      if (!session) {
        setBusy(false)
        setBrowserOpened(false)
      }
    })
    const offCallback = window.yKernelAuth.onCallback(() => {})
    async function loadPublicSession(): Promise<void> {
      try {
        const loaded = await window.yKernelAuth.load()
        if (cancelled) return
        if (loaded.ok && loaded.session) {
          setStatus('signed-in')
          void window.y.analytics.track('auth_sign_in_completed', { source: 'cached' })
        } else {
          setStatus('signed-out')
        }
      } catch (err) {
        if (cancelled) return
        setStatus('signed-out')
        setError(getErrorMessage(err))
      }
    }
    void loadPublicSession()
    return () => {
      cancelled = true
      off()
      offCallback()
    }
  }, [bypassAuth])

  async function signIn(): Promise<void> {
    const attempt = signInAttemptRef.current + 1
    signInAttemptRef.current = attempt
    setBusy(true)
    setBrowserOpened(true)
    activeSignInRef.current = true
    setError('')
    void window.y.analytics.track('auth_sign_in_started', { source: 'login' })
    try {
      const result = await window.yKernelAuth.signIn()
      if (signInAttemptRef.current !== attempt) return
      if (!result.ok) throw new Error(result.error || 'Could not sign in.')
      setStatus('signed-in')
      setError('')
      void window.y.analytics.track('auth_sign_in_completed', { source: 'login' })
    } catch (err) {
      if (signInAttemptRef.current !== attempt) return
      const message = getErrorMessage(err)
      setError(message)
      setStatus('signed-out')
      void window.y.analytics.track('auth_sign_in_failed', { source: 'login' })
    } finally {
      if (signInAttemptRef.current === attempt) {
        activeSignInRef.current = false
        setBusy(false)
      }
    }
  }

  if (status === 'signed-in') return <>{children}</>
  if (status === 'checking') {
    return (
      <div className="y-auth-boot" aria-label="Loading y">
        <BootLoadingMark />
      </div>
    )
  }

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
