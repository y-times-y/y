import * as React from 'react'
import { latestAgentWorking, publishVerdict, subscribeAgentWorking } from './userlandStatus'

type UserlandFrameVerdict = {
  type: 'y:userland-verdict'
  token: number
  outcome: 'ok' | 'compile-error' | 'crash'
  error?: string
}

type UserlandFrameReady = {
  type: 'y:userland-ready'
}

type UserlandShellState = {
  type: 'y:shell-state'
  platform: string
  fullscreen: boolean
}

type UserlandLayoutState = {
  type: 'y:userland-layout'
  fileRailOpen: boolean
  fileRailWidth?: number
}

type BridgeRequest = {
  type: 'y:bridge-request'
  id: string
  path: string[]
  args: unknown[]
}

type BridgeSubscribe = {
  type: 'y:bridge-subscribe'
  id: string
  path: string[]
  args: unknown[]
}

type BridgeUnsubscribe = {
  type: 'y:bridge-unsubscribe'
  subscriptionId: string
}

type StorageAreaName = 'localStorage' | 'sessionStorage'

type StorageStateMessage = {
  type: 'y:storage-state'
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}

type StorageSetMessage = {
  type: 'y:storage-set'
  area: StorageAreaName
  key: string
  value: string
}

type StorageRemoveMessage = {
  type: 'y:storage-remove'
  area: StorageAreaName
  key: string
}

type StorageClearMessage = {
  type: 'y:storage-clear'
  area: StorageAreaName
}

type StorageMutationMessage = StorageSetMessage | StorageRemoveMessage | StorageClearMessage

type FrameMessage =
  | UserlandFrameReady
  | UserlandFrameVerdict
  | UserlandLayoutState
  | BridgeRequest
  | BridgeSubscribe
  | BridgeUnsubscribe
  | StorageMutationMessage

const USERLAND_CALLS = new Set([
  'modify.open',
  'modify.close',
  'modify.toggle',
  'userland.resetToSeed',
  'engine.list',
  'engine.models',
  'engine.checkCliStatus',
  'engine.start',
  'engine.send',
  'engine.command',
  'engine.cancel',
  'app.getState',
  'app.checkpoint',
  'app.restoreCheckpoint',
  'app.addProject',
  'app.getIsolationStatus',
  'app.createChat',
  'app.selectFiles',
  'app.searchFiles',
  'app.listDirectory',
  'app.watchFiles',
  'app.unwatchFiles',
  'app.readProjectFile',
  'app.updateChat',
  'app.setActive',
  'app.setProjectOpen',
  'app.removeProject',
  'auth.load',
  'auth.restore',
  'auth.signIn',
  'auth.clear',
  'feedback.submit',
  'analytics.track',
  'clipboard.writeText',
  'net.request',
  'files.root',
  'files.list',
  'files.read',
  'files.write',
  'files.mkdir',
  'files.remove',
  'terminal.start',
  'terminal.write',
  'terminal.resize',
  'terminal.kill'
])

const USERLAND_SUBSCRIPTIONS = new Set([
  'modify.onChange',
  'modify.onOpenFile',
  'engine.onEvent',
  'app.onFilesChanged',
  'app.onStateChanged',
  'auth.onChanged',
  'terminal.onEvent'
])

function bridgeKey(path: string[]): string {
  return path.join('.')
}

function getBridgeFunction(path: string[]): (...args: unknown[]) => unknown {
  let target: unknown = window.y
  for (const part of path) {
    if (!target || typeof target !== 'object') throw new Error(`Bridge path "${bridgeKey(path)}" is not available`)
    target = (target as Record<string, unknown>)[part]
  }
  if (typeof target !== 'function') throw new Error(`Bridge path "${bridgeKey(path)}" is not callable`)
  return target as (...args: unknown[]) => unknown
}

function frameUrl(): string {
  return 'y-userland://frame/userland-frame.html'
}

function readStorage(storage: Storage): Record<string, string> {
  const values: Record<string, string> = {}
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (!key) continue
    const value = storage.getItem(key)
    if (value !== null) values[key] = value
  }
  return values
}

function readStorageState(): StorageStateMessage {
  return {
    type: 'y:storage-state',
    localStorage: readStorage(window.localStorage),
    sessionStorage: readStorage(window.sessionStorage)
  }
}

function getStorageArea(area: StorageAreaName): Storage {
  return area === 'localStorage' ? window.localStorage : window.sessionStorage
}

function applyStorageMutation(message: StorageMutationMessage): void {
  const storage = getStorageArea(message.area)
  if (message.type === 'y:storage-set') {
    storage.setItem(message.key, message.value)
  } else if (message.type === 'y:storage-remove') {
    storage.removeItem(message.key)
  } else {
    storage.clear()
  }
  window.dispatchEvent(new CustomEvent('y:kernel-storage-changed', { detail: { area: message.area } }))
}

function UserlandLoadingMark(): React.JSX.Element {
  return (
    <svg className="userland-loading-mark" viewBox="0 0 84 92" aria-hidden>
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

// UserlandHost compiles Userland in the Kernel, renders it in a sandboxed
// frame, snapshots healthy renders, and auto-rolls-back on runtime crashes.
function UserlandHost({
  modifyOpen,
  onModifyOpen,
  onModifyClose,
  onModifyToggle,
  onUserlandLayout
}: {
  modifyOpen: boolean
  onModifyOpen: () => void
  onModifyClose: () => void
  onModifyToggle: () => void
  onUserlandLayout: (state: { fileRailOpen: boolean; fileRailWidth?: number }) => void
}): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const subscriptionsRef = React.useRef(new Map<string, () => void>())
  const modifySubscriptionsRef = React.useRef(new Set<string>())
  const modifyOpenFileSubscriptionsRef = React.useRef(new Set<string>())
  const frameReadyRef = React.useRef(false)
  const pendingLoadRef = React.useRef<{ token: number; code: string } | null>(null)
  const activeTokenRef = React.useRef(0)
  const shellStateRef = React.useRef<UserlandShellState>({
    type: 'y:shell-state',
    platform: window.electron?.process?.platform ?? '',
    fullscreen: document.documentElement.classList.contains('is-fullscreen')
  })

  const [error, setError] = React.useState('')
  const [crash, setCrash] = React.useState('')
  const [frameError, setFrameError] = React.useState('')
  const [path, setPath] = React.useState('')
  const [snap, setSnap] = React.useState<{ hash: string; count: number } | null>(null)
  const [loaded, setLoaded] = React.useState(false)
  const [agentWorking, setAgentWorking] = React.useState(() => latestAgentWorking())
  const [frameSrc] = React.useState(frameUrl)

  const autoRolledBackRef = React.useRef(false)
  const recoveryRef = React.useRef(false)
  const agentWorkingRef = React.useRef(agentWorking)

  React.useEffect(() => {
    agentWorkingRef.current = agentWorking
  }, [agentWorking])

  const postToFrame = React.useCallback((message: unknown): void => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  const flushPendingLoad = React.useCallback((): void => {
    if (!frameReadyRef.current || !pendingLoadRef.current) return
    postToFrame(readStorageState())
    postToFrame(shellStateRef.current)
    postToFrame({ type: 'y:userland-load', ...pendingLoadRef.current })
  }, [postToFrame])

  React.useEffect(() => {
    const sendShellState = (): void => {
      shellStateRef.current = {
        type: 'y:shell-state',
        platform: window.electron?.process?.platform ?? '',
        fullscreen: document.documentElement.classList.contains('is-fullscreen')
      }
      postToFrame(shellStateRef.current)
    }

    sendShellState()
    return window.electron?.window?.onFullscreen((full: boolean) => {
      document.documentElement.classList.toggle('is-fullscreen', full)
      sendShellState()
    })
  }, [postToFrame])

  const load = React.useCallback(async () => {
    setError('')
    setCrash('')
    setFrameError('')
    setLoaded(false)
    setPath(await window.y.userland.getPath())

    const result = await window.y.userland.compile()
    const token = activeTokenRef.current + 1
    activeTokenRef.current = token

    if (!result.ok || !result.code) {
      pendingLoadRef.current = null
      const msg = result.error ?? 'Unknown compile error'
      setError(msg)
      publishVerdict({ outcome: 'compile-error', error: msg })
      return
    }

    pendingLoadRef.current = { token, code: result.code }
    flushPendingLoad()
  }, [flushPendingLoad])

  const revertAndReload = React.useCallback(async () => {
    const r = await window.y.userland.revert()
    if (!r.ok) {
      setCrash((c) => c || (r.error ?? 'Could not revert'))
      return
    }
    await load()
  }, [load])

  const settleHealthyRender = React.useCallback((token: number): void => {
    if (token !== activeTokenRef.current) return
    setLoaded(true)
    setError('')
    setCrash('')
    autoRolledBackRef.current = false
    if (recoveryRef.current) {
      recoveryRef.current = false
    } else {
      publishVerdict({ outcome: 'ok' })
    }
    void window.y.userland.snapshot().then((result) => {
      if (result.ok && result.hash) setSnap({ hash: result.hash, count: result.count ?? 0 })
    })
  }, [])

  const handleCrash = React.useCallback(
    (message: string): void => {
      setLoaded(false)
      setCrash(message)
      publishVerdict({ outcome: 'crash', error: message })
      if (agentWorkingRef.current) return
      if (!autoRolledBackRef.current) {
        autoRolledBackRef.current = true
        recoveryRef.current = true
        void revertAndReload()
      }
    },
    [revertAndReload]
  )

  const respondToFrame = React.useCallback(
    (id: string, response: { ok: boolean; value?: unknown; error?: string }): void => {
      postToFrame({ type: 'y:bridge-response', id, ...response })
    },
    [postToFrame]
  )

  const handleBridgeRequest = React.useCallback(
    (message: BridgeRequest): void => {
      const key = bridgeKey(message.path)
      if (!USERLAND_CALLS.has(key)) {
        respondToFrame(message.id, { ok: false, error: `The app UI cannot call ${key}` })
        return
      }
      if (key === 'modify.open') {
        onModifyOpen()
        respondToFrame(message.id, { ok: true })
        return
      }
      if (key === 'modify.close') {
        onModifyClose()
        respondToFrame(message.id, { ok: true })
        return
      }
      if (key === 'modify.toggle') {
        onModifyToggle()
        respondToFrame(message.id, { ok: true })
        return
      }
      void Promise.resolve()
        .then(() => getBridgeFunction(message.path)(...(message.args ?? [])))
        .then((value) => respondToFrame(message.id, { ok: true, value }))
        .catch((err) => {
          const error = err instanceof Error ? err.message : String(err)
          respondToFrame(message.id, { ok: false, error })
        })
    },
    [onModifyClose, onModifyOpen, onModifyToggle, respondToFrame]
  )

  const handleBridgeSubscribe = React.useCallback((message: BridgeSubscribe): void => {
    const key = bridgeKey(message.path)
    if (!USERLAND_SUBSCRIPTIONS.has(key)) return
    if (key === 'modify.onChange') {
      modifySubscriptionsRef.current.add(message.id)
      postToFrame({ type: 'y:bridge-event', subscriptionId: message.id, payload: modifyOpen })
      subscriptionsRef.current.set(message.id, () => modifySubscriptionsRef.current.delete(message.id))
      return
    }
    if (key === 'modify.onOpenFile') {
      modifyOpenFileSubscriptionsRef.current.add(message.id)
      subscriptionsRef.current.set(message.id, () => modifyOpenFileSubscriptionsRef.current.delete(message.id))
      return
    }
    const unsubscribe = getBridgeFunction(message.path)(...(message.args ?? []), (payload: unknown) => {
      postToFrame({ type: 'y:bridge-event', subscriptionId: message.id, payload })
    })
    if (typeof unsubscribe === 'function') subscriptionsRef.current.set(message.id, unsubscribe as () => void)
  }, [modifyOpen, postToFrame])

  const handleBridgeUnsubscribe = React.useCallback((message: BridgeUnsubscribe): void => {
    subscriptionsRef.current.get(message.subscriptionId)?.()
    subscriptionsRef.current.delete(message.subscriptionId)
  }, [])

  React.useEffect(() => {
    const onMessage = (event: MessageEvent<FrameMessage>): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = event.data
      if (!message || typeof message !== 'object') return

      if (message.type === 'y:userland-ready') {
        frameReadyRef.current = true
        postToFrame(readStorageState())
        postToFrame(shellStateRef.current)
        flushPendingLoad()
        return
      }

      if (message.type === 'y:userland-verdict') {
        if (message.token !== activeTokenRef.current) return
        if (message.outcome === 'ok') settleHealthyRender(message.token)
        else if (message.outcome === 'compile-error') {
          setLoaded(false)
          const msg = message.error ?? 'Unknown compile error'
          setError(msg)
          publishVerdict({ outcome: 'compile-error', error: msg })
        } else {
          handleCrash(message.error ?? 'The app UI crashed at runtime')
        }
        return
      }

      if (message.type === 'y:userland-layout') {
        onUserlandLayout({
          fileRailOpen: Boolean(message.fileRailOpen),
          fileRailWidth: typeof message.fileRailWidth === 'number' ? message.fileRailWidth : undefined
        })
        return
      }

      if (message.type === 'y:bridge-request') {
        handleBridgeRequest(message)
        return
      }

      if (message.type === 'y:bridge-subscribe') {
        handleBridgeSubscribe(message)
        return
      }

      if (message.type === 'y:bridge-unsubscribe') {
        handleBridgeUnsubscribe(message)
        return
      }

      if (
        message.type === 'y:storage-set' ||
        message.type === 'y:storage-remove' ||
        message.type === 'y:storage-clear'
      ) {
        applyStorageMutation(message)
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [
    flushPendingLoad,
    handleBridgeRequest,
    handleBridgeSubscribe,
    handleBridgeUnsubscribe,
    handleCrash,
    onUserlandLayout,
    settleHealthyRender
  ])

  React.useEffect(() => {
    const off = window.y.userland.onChanged(() => void load())
    void load()
    return off
  }, [load])

  React.useEffect(() => {
    if (loaded || error || crash || frameError || !pendingLoadRef.current) return
    const token = pendingLoadRef.current.token
    const timeout = window.setTimeout(() => {
      if (loaded || activeTokenRef.current !== token) return
      setFrameError('The app UI did not finish loading. Reload y, or revert to the previous snapshot.')
    }, 10000)
    return () => window.clearTimeout(timeout)
  }, [crash, error, frameError, loaded])

  React.useEffect(() => subscribeAgentWorking(setAgentWorking), [])

  React.useEffect(() => {
    const subscriptions = subscriptionsRef.current
    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe())
      subscriptions.clear()
    }
  }, [])

  React.useEffect(() => {
    for (const subscriptionId of modifySubscriptionsRef.current) {
      postToFrame({ type: 'y:bridge-event', subscriptionId, payload: modifyOpen })
    }
  }, [modifyOpen, postToFrame])

  React.useEffect(() => {
    const onOpenFile = (event: Event): void => {
      const payload = (event as CustomEvent<{ file: string; diff: string; oldContent?: string }>).detail
      if (!payload?.file) return
      for (const subscriptionId of modifyOpenFileSubscriptionsRef.current) {
        postToFrame({ type: 'y:bridge-event', subscriptionId, payload })
      }
    }
    window.addEventListener('y:modify-open-file', onOpenFile)
    return () => window.removeEventListener('y:modify-open-file', onOpenFile)
  }, [postToFrame])

  const showDevChrome = Boolean(error || crash || frameError)
  const blockedWhileAgentWorking = agentWorking && Boolean(error || crash || frameError)

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
        {blockedWhileAgentWorking ? (
          <div className="userland-recovery userland-recovery-waiting">
            <strong>Coding agent is still working.</strong>
            <p className="userland-path">
              Please wait until the coding agent finishes. Temporary compile or render errors can happen mid-edit,
              and the agent can usually repair them automatically.
            </p>
            <pre className="userland-error">{error || crash}</pre>
          </div>
        ) : error ? (
          <div className="userland-recovery">
            <strong>The app UI failed to compile.</strong>
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
            <strong>The app UI crashed at runtime.</strong>
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
        ) : frameError ? (
          <div className="userland-recovery">
            <strong>The app UI failed to load.</strong>
            <pre className="userland-error">{frameError}</pre>
            <div className="userland-toolbar">
              <button className="btn" onClick={() => void load()}>
                Reload
              </button>
              <button className="btn" onClick={() => void revertAndReload()}>
                Revert to previous snapshot
              </button>
            </div>
          </div>
        ) : (
          <>
            {!loaded ? (
              <div className="userland-loading" aria-label="Loading y">
                <UserlandLoadingMark />
              </div>
            ) : null}
            <iframe
              ref={iframeRef}
              className="userland-frame"
              title=""
              aria-label="y"
              src={frameSrc}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              onError={() => setFrameError('The app UI failed to load. Reload y, or revert to the previous snapshot.')}
              onLoad={() => {
                frameReadyRef.current = true
                postToFrame(shellStateRef.current)
                flushPendingLoad()
              }}
            />
          </>
        )}
      </div>
      {showDevChrome && path ? <span className="userland-path userland-meta">{path}</span> : null}
    </div>
  )
}

export default UserlandHost
