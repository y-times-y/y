import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { watch } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startSession, sendToSession, cancelSession, listEngines } from './engine'

// ---- Userland lives in a writable folder, NOT inside the app bundle ----
// It sits under Electron's per-user data dir. The app reads it at runtime,
// which is what makes self-modification possible (the app bundle stays sealed).
const DEFAULT_PANEL = `import { useEffect, useRef, useState } from 'react'

// This chat lives in USERLAND — it's just code you can edit. It talks to the
// coding-agent engine through window.y.engine (the bricks the Kernel exposes).
// Change the styles, the layout, the behavior — save and watch it hot-reload.
const LABELS = { 'claude-code': 'Claude Code', codex: 'Codex' }

export default function Chat() {
  const [engines, setEngines] = useState([])
  const [engineId, setEngineId] = useState('claude-code')
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const sidRef = useRef(null)

  function start(id) {
    if (sidRef.current) window.y.engine.cancel(sidRef.current)
    sidRef.current = null
    setSessionId(null)
    setMessages([])
    setStatus('')
    setError('')
    setBusy(false)
    window.y.engine.start({ engine: id }).then(function (res) {
      if (!res.ok || !res.sessionId) {
        setError(res.error || 'Failed to start engine')
        return
      }
      sidRef.current = res.sessionId
      setSessionId(res.sessionId)
    })
  }

  function append(list, chunk) {
    const last = list[list.length - 1]
    if (last && last.role === 'assistant') {
      return list.slice(0, -1).concat([{ role: 'assistant', text: last.text + chunk }])
    }
    return list.concat([{ role: 'assistant', text: chunk }])
  }

  useEffect(function () {
    const off = window.y.engine.onEvent(function (p) {
      if (p.sessionId !== sidRef.current) return
      const e = p.event
      if (e.kind === 'text') {
        setStatus('')
        setMessages(function (m) { return append(m, e.text) })
      } else if (e.kind === 'thinking') {
        setStatus('thinking...')
      } else if (e.kind === 'tool') {
        setStatus('')
        setMessages(function (m) { return m.concat([{ role: 'tool', name: e.name }]) })
      } else if (e.kind === 'result') {
        setBusy(false)
        setStatus('')
        if (!e.ok) setError(e.summary || 'The engine reported an error.')
      } else if (e.kind === 'error') {
        setBusy(false)
        setStatus('')
        setError(e.message)
      }
    })
    window.y.engine.list().then(function (ids) { if (ids.length) setEngines(ids) })
    start('claude-code')
    return off
  }, [])

  function send() {
    const text = input.trim()
    if (!text || !sessionId || busy) return
    setError('')
    setMessages(function (m) { return m.concat([{ role: 'user', text: text }]) })
    setInput('')
    setBusy(true)
    setStatus('...')
    window.y.engine.send(sessionId, text)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.55 }}>engine</span>
        <select
          value={engineId}
          disabled={busy}
          onChange={function (ev) { setEngineId(ev.target.value); start(ev.target.value) }}
          style={{ font: 'inherit', padding: '4px 8px', borderRadius: 8 }}
        >
          {engines.map(function (id) {
            return <option key={id} value={id}>{LABELS[id] || id}</option>
          })}
        </select>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && !error ? (
          <div style={{ margin: 'auto', opacity: 0.5 }}>Ask the engine something to start.</div>
        ) : null}
        {messages.map(function (m, i) {
          if (m.role === 'tool') {
            const label = (m.name || 'tool')
            const shown = label.length > 64 ? label.slice(0, 64) + '…' : label
            return (
              <div key={i} style={{ alignSelf: 'flex-start', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, opacity: 0.65, padding: '3px 9px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.2)' }}>
                {'→ ' + shown}
              </div>
            )
          }
          return (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5 }}>{m.role === 'user' ? 'you' : 'y'}</span>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(127,127,127,0.25)' }}>{m.text}</div>
            </div>
          )
        })}
        {status ? <div style={{ opacity: 0.5, fontStyle: 'italic' }}>{status}</div> : null}
        {error ? <div style={{ color: '#ff7a7a', whiteSpace: 'pre-wrap' }}>{error}</div> : null}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <textarea
          value={input}
          rows={2}
          onChange={function (ev) { setInput(ev.target.value) }}
          onKeyDown={function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send() } }}
          placeholder={sessionId ? 'Message the engine...' : 'Starting engine...'}
          style={{ flex: 1, resize: 'none', font: 'inherit', fontSize: 14, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(127,127,127,0.3)', background: 'transparent', color: 'inherit' }}
        />
        <button
          onClick={send}
          disabled={!sessionId || busy}
          style={{ alignSelf: 'flex-end', font: 'inherit', fontWeight: 600, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' }}
        >
          {busy ? '...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
`

// esbuild ships a native binary. In a packaged app it's unpacked next to the
// asar (electron-builder's smartUnpack), but esbuild resolves the binary to the
// VIRTUAL app.asar path, which the OS can't exec. Point it at the real unpacked
// path. (No-op in dev, where node_modules resolves normally.)
function fixEsbuildBinaryPath(): void {
  if (!app.isPackaged || process.env.ESBUILD_BINARY_PATH) return
  const platformDir = `${process.platform}-${process.arch}`
  const binName = process.platform === 'win32' ? 'esbuild.exe' : join('bin', 'esbuild')
  process.env.ESBUILD_BINARY_PATH = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@esbuild',
    platformDir,
    binName
  )
}

// esbuild is loaded LAZILY (not a top-level import) on purpose: esbuild captures
// process.env.ESBUILD_BINARY_PATH at module-load time, so it MUST load only after
// fixEsbuildBinaryPath() has run — otherwise it caches the wrong (asar) path.
let cachedTransform: typeof import('esbuild').transform | null = null
async function getEsbuildTransform(): Promise<typeof import('esbuild').transform> {
  if (!cachedTransform) {
    const esbuild = await import('esbuild')
    cachedTransform = esbuild.transform
  }
  return cachedTransform
}

function userlandDir(): string {
  return join(app.getPath('userData'), 'userland')
}

function userlandFile(): string {
  return join(userlandDir(), 'panel.tsx')
}

// Snapshot history lives in a git repo INSIDE the Userland folder — fully
// separate from the project repo. We pass identity via -c flags so we never
// touch the user's global git config, and always run with cwd = userlandDir.
const runFile = promisify(execFile)

async function git(args: string[]): Promise<string> {
  const { stdout } = await runFile('git', args, { cwd: userlandDir() })
  return stdout.trim()
}

async function gitCommit(message: string): Promise<void> {
  await git(['add', '-A'])
  await git(['-c', 'user.name=y', '-c', 'user.email=y@localhost', 'commit', '-m', message])
}

async function ensureUserlandRepo(): Promise<void> {
  try {
    await git(['rev-parse', '--git-dir'])
    return // already a repo
  } catch {
    // not a repo yet → init and make the first save point
  }
  await git(['init'])
  await gitCommit('initial userland')
}

async function ensureUserland(): Promise<void> {
  await mkdir(userlandDir(), { recursive: true })
  try {
    await readFile(userlandFile())
  } catch {
    // File doesn't exist yet → seed it with the default content.
    await writeFile(userlandFile(), DEFAULT_PANEL, 'utf-8')
  }
  // Snapshots are a safety NET, not a hard requirement. If git is missing on the
  // user's machine, the app must still launch and self-modify — it just loses
  // snapshot/revert/auto-rollback. So never let repo setup crash boot.
  try {
    await ensureUserlandRepo()
  } catch (err) {
    console.warn('[y] Userland git snapshots unavailable:', err)
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.y.app')

  // Make sure esbuild can find its binary in the packaged app (no-op in dev).
  fixEsbuildBinaryPath()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Make sure the writable Userland folder + seed file exist before the UI loads.
  await ensureUserland()

  // ---- y's first real "bricks": two-way IPC the renderer can call ----
  // ipcMain.handle returns a value back to the caller (unlike ipcMain.on,
  // which is fire-and-forget). The renderer calls these via ipcRenderer.invoke.
  ipcMain.handle('userland:read', () => readFile(userlandFile(), 'utf-8'))
  ipcMain.handle('userland:path', () => userlandFile())

  // Compile the Userland .tsx into runnable JS (CommonJS) with esbuild.
  // We externalize react/jsx-runtime via the output's require() calls — the
  // renderer fills those in with the host's React (see UserlandHost).
  ipcMain.handle('userland:compile', async () => {
    try {
      const src = await readFile(userlandFile(), 'utf-8')
      const transform = await getEsbuildTransform()
      const out = await transform(src, {
        loader: 'tsx',
        jsx: 'automatic',
        format: 'cjs',
        target: 'es2020'
      })
      return { ok: true, code: out.code }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Snapshot = a git commit of the current Userland state (a save point).
  // No-ops cleanly when nothing changed.
  ipcMain.handle('userland:snapshot', async () => {
    try {
      const dirty = (await git(['status', '--porcelain'])).length > 0
      if (dirty) await gitCommit(`snapshot ${new Date().toISOString()}`)
      const hash = await git(['rev-parse', '--short', 'HEAD'])
      const count = Number(await git(['rev-list', '--count', 'HEAD']))
      return { ok: true, hash, count }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Revert = one step of "undo":
  //  - uncommitted edits present → throw them away, restore the last snapshot
  //  - already clean             → step back to the previous snapshot
  ipcMain.handle('userland:revert', async () => {
    try {
      const dirty = (await git(['status', '--porcelain'])).length > 0
      if (dirty) {
        await git(['reset', '--hard', 'HEAD'])
      } else {
        const have = Number(await git(['rev-list', '--count', 'HEAD']))
        if (have <= 1) return { ok: false, error: 'No earlier snapshot to revert to.' }
        await git(['reset', '--hard', 'HEAD~1'])
      }
      const hash = await git(['rev-parse', '--short', 'HEAD'])
      const count = Number(await git(['rev-list', '--count', 'HEAD']))
      return { ok: true, hash, count }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- Engine bricks (Phase 4): drive a coding-agent CLI from the renderer ----
  // start returns a session id; send/cancel act on it; the actual reply streams
  // back as 'engine:event' pushes (see engine/index.ts → broadcast).
  ipcMain.handle('engine:list', () => listEngines())
  ipcMain.handle('engine:start', (_e, args) => startSession(args))
  ipcMain.handle('engine:send', (_e, sessionId: string, prompt: string) =>
    sendToSession(sessionId, prompt)
  )
  ipcMain.handle('engine:cancel', (_e, sessionId: string) => cancelSession(sessionId))

  createWindow()

  // Live edits: when panel.tsx changes on disk, tell the renderer to re-render.
  // We watch the FOLDER (atomic saves replace the file, which breaks watching it
  // directly) and debounce, since one save emits several fs events.
  let watchTimer: ReturnType<typeof setTimeout> | null = null
  watch(userlandDir(), (_event, filename) => {
    if (filename !== 'panel.tsx') return
    if (watchTimer) clearTimeout(watchTimer)
    watchTimer = setTimeout(() => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('userland:changed')
      }
    }, 150)
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
