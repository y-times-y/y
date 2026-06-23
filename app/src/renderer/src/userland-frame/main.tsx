import * as React from 'react'
import { createRoot } from 'react-dom/client'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import XtermTerminal from '../kernel/XtermTerminal'
import * as ChatPrimitivesModule from '../kernel/ChatPrimitives'
import * as MarkdownModule from '../kernel/markdown'
import * as ToolActivityModule from '../kernel/ToolActivity'
import hljs from 'highlight.js/lib/common'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

type LoadMessage = {
  type: 'y:userland-load'
  token: number
  code: string
}

type BridgeResponse = {
  type: 'y:bridge-response'
  id: string
  ok: boolean
  value?: unknown
  error?: string
}

type BridgeEvent = {
  type: 'y:bridge-event'
  subscriptionId: string
  payload: unknown
}

type ShellStateMessage = {
  type: 'y:shell-state'
  platform: string
  fullscreen: boolean
}

type StorageAreaName = 'localStorage' | 'sessionStorage'

type StorageStateMessage = {
  type: 'y:storage-state'
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}

type FrameMessage = LoadMessage | BridgeResponse | BridgeEvent | ShellStateMessage | StorageStateMessage

type PendingBridgeCall = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

type SyncedStorage = Storage & {
  replaceAll: (next: Record<string, string>) => void
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing Userland frame root')

const root = createRoot(rootElement)
let activeToken = 0
let nextBridgeId = 0
const pendingBridgeCalls = new Map<string, PendingBridgeCall>()
const bridgeSubscriptions = new Map<string, (payload: unknown) => void>()

document.documentElement.style.width = '100%'
document.documentElement.style.height = '100%'
document.documentElement.style.margin = '0'
document.body.style.width = '100%'
document.body.style.height = '100%'
document.body.style.margin = '0'
document.body.style.overflow = 'hidden'
rootElement.style.width = '100%'
rootElement.style.height = '100%'
rootElement.style.minHeight = '0'
rootElement.style.display = 'flex'
rootElement.style.flexDirection = 'column'

function createSyncedStorage(area: StorageAreaName): SyncedStorage {
  const values = new Map<string, string>()

  const notifySet = (key: string, value: string): void => {
    window.parent.postMessage({ type: 'y:storage-set', area, key, value }, '*')
  }
  const notifyRemove = (key: string): void => {
    window.parent.postMessage({ type: 'y:storage-remove', area, key }, '*')
  }
  const notifyClear = (): void => {
    window.parent.postMessage({ type: 'y:storage-clear', area }, '*')
  }

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
      notifyClear()
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null
    },
    key(index: number) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
      notifyRemove(key)
    },
    setItem(key: string, value: string) {
      const next = String(value)
      values.set(key, next)
      notifySet(key, next)
    },
    replaceAll(next: Record<string, string>) {
      values.clear()
      for (const [key, value] of Object.entries(next)) {
        values.set(key, String(value))
      }
    }
  }
}

const localStorageShim = createSyncedStorage('localStorage')
const sessionStorageShim = createSyncedStorage('sessionStorage')

function installStorageShim(name: StorageAreaName, storage: SyncedStorage): void {
  try {
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      value: storage
    })
  } catch {
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      value: storage
    })
  }
}

installStorageShim('localStorage', localStorageShim)
installStorageShim('sessionStorage', sessionStorageShim)

function applyShellState(message: ShellStateMessage): void {
  document.documentElement.classList.toggle('platform-darwin', message.platform === 'darwin')
  document.documentElement.classList.toggle('is-fullscreen', message.fullscreen)
}

function reportVerdict(outcome: 'ok' | 'compile-error' | 'crash', error?: string): void {
  window.parent.postMessage({ type: 'y:userland-verdict', token: activeToken, outcome, error }, '*')
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.stack || err.message
  return String(err)
}

function bridgeCall(path: string[], args: unknown[]): Promise<unknown> {
  const id = `call-${++nextBridgeId}`
  window.parent.postMessage({ type: 'y:bridge-request', id, path, args }, '*')
  return new Promise((resolve, reject) => {
    pendingBridgeCalls.set(id, { resolve, reject })
  })
}

function bridgeSubscribe(path: string[], args: unknown[], callback: (payload: unknown) => void): () => void {
  const id = `sub-${++nextBridgeId}`
  bridgeSubscriptions.set(id, callback)
  window.parent.postMessage({ type: 'y:bridge-subscribe', id, path, args }, '*')
  return () => {
    bridgeSubscriptions.delete(id)
    window.parent.postMessage({ type: 'y:bridge-unsubscribe', subscriptionId: id }, '*')
  }
}

function exposeCall(path: string[]): (...args: unknown[]) => Promise<unknown> {
  return (...args: unknown[]) => bridgeCall(path, args)
}

function exposeSubscription(path: string[]): (cb: (payload: unknown) => void) => () => void {
  return (cb: (payload: unknown) => void) => bridgeSubscribe(path, [], cb)
}

type SafeYApi = Window['y']
type SafeKernelAuthApi = Pick<Window['yKernelAuth'], 'restore' | 'signIn' | 'clear'>

;(window as unknown as { y: Partial<SafeYApi> }).y = {
  userland: {
    resetToSeed: exposeCall(['userland', 'resetToSeed']) as SafeYApi['userland']['resetToSeed']
  } as Partial<SafeYApi['userland']> as SafeYApi['userland'],
  modify: {
    open: exposeCall(['modify', 'open']) as SafeYApi['modify']['open'],
    close: exposeCall(['modify', 'close']) as SafeYApi['modify']['close'],
    toggle: exposeCall(['modify', 'toggle']) as SafeYApi['modify']['toggle'],
    onChange: exposeSubscription(['modify', 'onChange']) as SafeYApi['modify']['onChange'],
    onOpenFile: exposeSubscription(['modify', 'onOpenFile']) as SafeYApi['modify']['onOpenFile']
  },
  engine: {
    list: exposeCall(['engine', 'list']) as SafeYApi['engine']['list'],
    models: exposeCall(['engine', 'models']) as SafeYApi['engine']['models'],
    checkCliStatus: exposeCall(['engine', 'checkCliStatus']) as SafeYApi['engine']['checkCliStatus'],
    start: exposeCall(['engine', 'start']) as SafeYApi['engine']['start'],
    send: exposeCall(['engine', 'send']) as SafeYApi['engine']['send'],
    command: exposeCall(['engine', 'command']) as SafeYApi['engine']['command'],
    cancel: exposeCall(['engine', 'cancel']) as SafeYApi['engine']['cancel'],
    onEvent: exposeSubscription(['engine', 'onEvent']) as SafeYApi['engine']['onEvent']
  },
  app: {
    getState: exposeCall(['app', 'getState']) as SafeYApi['app']['getState'],
    checkpoint: exposeCall(['app', 'checkpoint']) as SafeYApi['app']['checkpoint'],
    restoreCheckpoint: exposeCall(['app', 'restoreCheckpoint']) as SafeYApi['app']['restoreCheckpoint'],
    addProject: exposeCall(['app', 'addProject']) as SafeYApi['app']['addProject'],
    getIsolationStatus: exposeCall(['app', 'getIsolationStatus']) as SafeYApi['app']['getIsolationStatus'],
    createChat: exposeCall(['app', 'createChat']) as SafeYApi['app']['createChat'],
    selectFiles: exposeCall(['app', 'selectFiles']) as SafeYApi['app']['selectFiles'],
    searchFiles: exposeCall(['app', 'searchFiles']) as SafeYApi['app']['searchFiles'],
    listDirectory: exposeCall(['app', 'listDirectory']) as SafeYApi['app']['listDirectory'],
    watchFiles: exposeCall(['app', 'watchFiles']) as SafeYApi['app']['watchFiles'],
    unwatchFiles: exposeCall(['app', 'unwatchFiles']) as SafeYApi['app']['unwatchFiles'],
    onFilesChanged: exposeSubscription(['app', 'onFilesChanged']) as SafeYApi['app']['onFilesChanged'],
    readProjectFile: exposeCall(['app', 'readProjectFile']) as SafeYApi['app']['readProjectFile'],
    updateChat: exposeCall(['app', 'updateChat']) as SafeYApi['app']['updateChat'],
    setActive: exposeCall(['app', 'setActive']) as SafeYApi['app']['setActive'],
    setProjectOpen: exposeCall(['app', 'setProjectOpen']) as SafeYApi['app']['setProjectOpen'],
    removeProject: exposeCall(['app', 'removeProject']) as SafeYApi['app']['removeProject'],
    onStateChanged: exposeSubscription(['app', 'onStateChanged']) as SafeYApi['app']['onStateChanged']
  } as Partial<SafeYApi['app']> as SafeYApi['app'],
  feedback: {
    submit: exposeCall(['feedback', 'submit']) as SafeYApi['feedback']['submit']
  },
  analytics: {
    track: exposeCall(['analytics', 'track']) as SafeYApi['analytics']['track']
  } as Partial<SafeYApi['analytics']> as SafeYApi['analytics'],
  clipboard: {
    writeText: exposeCall(['clipboard', 'writeText']) as SafeYApi['clipboard']['writeText']
  },
  net: {
    request: exposeCall(['net', 'request']) as SafeYApi['net']['request']
  },
  files: {
    root: exposeCall(['files', 'root']) as SafeYApi['files']['root'],
    list: exposeCall(['files', 'list']) as SafeYApi['files']['list'],
    read: exposeCall(['files', 'read']) as SafeYApi['files']['read'],
    write: exposeCall(['files', 'write']) as SafeYApi['files']['write'],
    mkdir: exposeCall(['files', 'mkdir']) as SafeYApi['files']['mkdir'],
    remove: exposeCall(['files', 'remove']) as SafeYApi['files']['remove']
  },
  terminal: {
    start: exposeCall(['terminal', 'start']) as SafeYApi['terminal']['start'],
    write: exposeCall(['terminal', 'write']) as SafeYApi['terminal']['write'],
    resize: exposeCall(['terminal', 'resize']) as SafeYApi['terminal']['resize'],
    kill: exposeCall(['terminal', 'kill']) as SafeYApi['terminal']['kill'],
    onEvent: exposeSubscription(['terminal', 'onEvent']) as SafeYApi['terminal']['onEvent']
  }
}

;(window as unknown as { yKernelAuth: SafeKernelAuthApi }).yKernelAuth = {
  restore: exposeCall(['kernelAuth', 'restore']) as SafeKernelAuthApi['restore'],
  signIn: exposeCall(['kernelAuth', 'signIn']) as SafeKernelAuthApi['signIn'],
  clear: exposeCall(['kernelAuth', 'clear']) as SafeKernelAuthApi['clear']
}

function buildComponent(code: string): React.ComponentType {
  const moduleObj: { exports: { default?: React.ComponentType } & Record<string, unknown> } = {
    exports: {}
  }
  const requireShim = (name: string): unknown => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') return ReactJsxRuntime
    if (name === '@renderer/kernel/XtermTerminal') return XtermTerminal
    if (name === '@renderer/kernel/ChatPrimitives') return ChatPrimitivesModule
    if (name === '@renderer/kernel/markdown') return MarkdownModule
    if (name === '@renderer/kernel/ToolActivity') return ToolActivityModule
    if (name === 'highlight.js/lib/common') return hljs
    if (name === 'react-markdown') return ReactMarkdown
    if (name === 'remark-gfm') return remarkGfm
    if (name === 'rehype-raw') return rehypeRaw
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

class FrameErrorBoundary extends React.Component<
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

function RenderOk({ token }: { token: number }): null {
  React.useEffect(() => {
    if (token === activeToken) reportVerdict('ok')
  }, [token])
  return null
}

function FrameApp({ Component, token }: { Component: React.ComponentType; token: number }): React.JSX.Element {
  return (
    <FrameErrorBoundary onError={(error) => reportVerdict('crash', error.message)} resetKey={token}>
      <Component />
      <RenderOk token={token} />
    </FrameErrorBoundary>
  )
}

function renderUserland(message: LoadMessage): void {
  activeToken = message.token
  try {
    const Component = buildComponent(message.code)
    root.render(<FrameApp Component={Component} token={message.token} />)
  } catch (err) {
    reportVerdict('compile-error', stringifyError(err))
  }
}

window.addEventListener('error', (event) => {
  reportVerdict('crash', event.error instanceof Error ? event.error.message : event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  reportVerdict('crash', stringifyError(event.reason))
})

window.addEventListener('message', (event: MessageEvent<FrameMessage>) => {
  const message = event.data
  if (!message || typeof message !== 'object') return

  if (message.type === 'y:userland-load') {
    renderUserland(message)
    return
  }

  if (message.type === 'y:shell-state') {
    applyShellState(message)
    return
  }

  if (message.type === 'y:storage-state') {
    localStorageShim.replaceAll(message.localStorage)
    sessionStorageShim.replaceAll(message.sessionStorage)
    return
  }

  if (message.type === 'y:bridge-response') {
    const pending = pendingBridgeCalls.get(message.id)
    if (!pending) return
    pendingBridgeCalls.delete(message.id)
    if (message.ok) pending.resolve(message.value)
    else pending.reject(new Error(message.error || 'Bridge call failed'))
    return
  }

  if (message.type === 'y:bridge-event') {
    bridgeSubscriptions.get(message.subscriptionId)?.(message.payload)
  }
})

window.parent.postMessage({ type: 'y:userland-ready' }, '*')
