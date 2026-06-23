import { app, shell, BrowserWindow, ipcMain, net, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { mkdir, readFile, writeFile, stat } from 'fs/promises'
import { watch } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startSession, sendToSession, commandSession, cancelSession, listEngines, listModels } from './engine'
import type { EngineRunOptions } from './engine/types'
import { checkCliStatus } from './engine/cliStatus'
import { ensureWorkspace, registerCapabilityBricks } from './capabilities'
import { registerAppStateBricks } from './appState'
import { killAllTerminals, registerTerminalBricks } from './terminal'
import { registerAnalyticsBricks } from './analytics'
import { registerFeedbackBricks } from './feedback'
import { registerOnboardingBricks } from './onboarding'
import { registerAuthBricks } from './authStore'
import {
  ensureRepo,
  snapshot as ulSnapshot,
  revert as ulRevert,
  history as ulHistory,
  restoreSnapshot as ulRestoreSnapshot,
  captureCheckpoint,
  restoreCheckpoint
} from './userlandGit'

const AUTH_CALLBACK_PROTOCOL = 'y'
const USERLAND_FRAME_PROTOCOL = 'y-userland'

protocol.registerSchemesAsPrivileged([
  {
    scheme: USERLAND_FRAME_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

function isAuthCallbackUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.startsWith(`${AUTH_CALLBACK_PROTOCOL}://auth-callback`)
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function emitAuthCallback(url: string): void {
  const windows = BrowserWindow.getAllWindows()
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send('auth:callback', url)
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  }
}

function registerAuthProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(AUTH_CALLBACK_PROTOCOL, process.execPath, [process.argv[1]])
  } else {
    app.setAsDefaultProtocolClient(AUTH_CALLBACK_PROTOCOL)
  }
}

function registerUserlandFrameProtocol(): void {
  protocol.handle(USERLAND_FRAME_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const asset = decodeURIComponent(url.pathname).replace(/^\/+/u, '') || 'userland-frame.html'
    if (asset !== 'userland-frame.html' && asset !== 'userland-frame-inline.js') {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(join(__dirname, '../renderer', asset)).toString())
  })
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const callbackUrl = argv.find(isAuthCallbackUrl)
    if (callbackUrl) emitAuthCallback(callbackUrl)
  })
}

app.on('open-url', (event, url) => {
  if (!isAuthCallbackUrl(url)) return
  event.preventDefault()
  emitAuthCallback(url)
})

// ---- Userland lives in a writable folder, NOT inside the app bundle ----
// It sits under Electron's per-user data dir. The app reads it at runtime,
// which is what makes self-modification possible (the app bundle stays sealed).
function userlandSeedFile(): string {
  // Dev: app/userland-seed/panel.tsx. Packaged: copied next to resources (future).
  return join(app.getAppPath(), 'userland-seed', 'panel.tsx')
}

async function readUserlandSeed(): Promise<string> {
  try {
    return await readFile(userlandSeedFile(), 'utf-8')
  } catch {
    // Minimal fallback if the seed file is missing (should never happen in dev).
    return `import { useEffect, useState } from 'react'\nexport default function Chat(){ return <div style={{padding:24}}>y</div> }\n`
  }
}

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
async function ensureUserland(): Promise<void> {
  await mkdir(userlandDir(), { recursive: true })
  const seed = await readUserlandSeed()
  let needsWrite = false
  try {
    await readFile(userlandFile())
    // Dev: pull kernel seed updates into the live Userland file when seed is newer.
    if (is.dev) {
      const [seedStat, liveStat] = await Promise.all([stat(userlandSeedFile()), stat(userlandFile())])
      if (seedStat.mtimeMs > liveStat.mtimeMs) needsWrite = true
    }
  } catch {
    needsWrite = true
  }
  if (needsWrite) {
    await writeFile(userlandFile(), seed, 'utf-8')
  }
  // Native Git is required for checkpoints and rollback. Keep boot resilient so
  // the UI can explain a missing installation instead of crashing at startup.
  try {
    await ensureRepo(userlandDir())
  } catch (err) {
    console.warn('[y] Userland snapshots unavailable:', err)
  }
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#09090a',
    ...(process.platform === 'darwin'
      ? { transparent: true, vibrancy: 'sidebar' as const, visualEffectState: 'active' as const }
      : {}),
    ...(isMac
      ? {
          // Lose the separate macOS title-bar strip (the brown bar above the UI).
          // Traffic lights float over the sidebar; the header drag region moves the window.
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 14, y: 20 }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Phase 6: let Userland embed web content via the <webview> tag — the
      // generic "embed" capability (a browser is just one thing you can build
      // with it). Not special-cased to any feature.
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('enter-full-screen', () =>
    mainWindow.webContents.send('window:fullscreen', true)
  )
  mainWindow.on('leave-full-screen', () =>
    mainWindow.webContents.send('window:fullscreen', false)
  )

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
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
  registerAuthProtocol()
  registerUserlandFrameProtocol()

  // Make sure esbuild can find its binary in the packaged app (no-op in dev).
  fixEsbuildBinaryPath()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Make sure the writable Userland folder + seed file exist before the UI loads.
  await ensureUserland()
  // Phase 6: create Userland's sandboxed workspace folder + load saved consent.
  await ensureWorkspace()

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

  // Snapshot/revert are backed by native Git. Userland keeps its own repository,
  // separate from every project repository.
  // Snapshot = a commit of the current Userland state; no-ops when unchanged.
  ipcMain.handle('userland:snapshot', (_e, message?: string) => ulSnapshot(userlandDir(), message))

  // Revert = one step of undo: dirty → restore last snapshot; clean → step back one.
  ipcMain.handle('userland:revert', () => ulRevert(userlandDir()))
  ipcMain.handle('userland:history', () => ulHistory(userlandDir()))
  ipcMain.handle('userland:restoreSnapshot', async (_e, hash: string) => {
    const result = await ulRestoreSnapshot(userlandDir(), hash)
    if (result.ok) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('userland:changed')
      }
    }
    return result
  })

  ipcMain.handle('userland:checkpoint', () => captureCheckpoint(userlandDir()))
  ipcMain.handle('userland:restoreCheckpoint', (_e, checkpointId: string) =>
    restoreCheckpoint(userlandDir(), checkpointId)
  )
  ipcMain.handle('userland:resetToSeed', async () => {
    try {
      const seed = await readUserlandSeed()
      await writeFile(userlandFile(), seed, 'utf-8')
      await ulSnapshot(userlandDir(), 'original app').catch((err) => {
        console.warn('[y] Userland reset snapshot unavailable:', err)
      })
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('userland:changed')
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- Engine bricks (Phase 4): drive a coding-agent CLI from the renderer ----
  // start returns a session id; send/cancel act on it; the actual reply streams
  // back as 'engine:event' pushes (see engine/index.ts → broadcast).
  ipcMain.handle('engine:list', () => listEngines())
  ipcMain.handle('engine:models', () => listModels())
  ipcMain.handle('engine:checkCliStatus', () => checkCliStatus())
  // Normal chat is the user's real coding agent. y gives the CLI the selected
  // project as cwd, defaults to the CLI's dangerous bypass mode, and otherwise
  // lets the official CLI decide tools/sandbox details.
  ipcMain.handle('engine:start', (_e, args: { engine: string; model?: string; options?: EngineRunOptions }) => {
    const cwd = args.options?.workingDirectory?.trim()
    if (!cwd) return { ok: false, error: 'Open a project folder before starting an engine.' }
    return startSession({
      ...args,
      options: {
        ...args.options,
        workingDirectory: cwd,
        claudeAllowDangerouslySkipPermissions:
          args.options?.claudeAllowDangerouslySkipPermissions ?? true,
        claudeDangerouslySkipPermissions:
          args.options?.claudeDangerouslySkipPermissions ?? true,
        codexDangerouslyBypassApprovalsAndSandbox:
          args.options?.codexDangerouslyBypassApprovalsAndSandbox ?? true
      },
      cwd,
      mode: 'native'
    })
  })
  // Modify chat (Kernel-only): write access, pinned to the Userland dir so the
  // agent's edits are scoped there and can never reach y's own source.
  ipcMain.handle(
    'engine:startModify',
    (_e, args: { engine: string; model?: string; options?: EngineRunOptions }) => {
      const { workingDirectory: _ignoredWorkingDirectory, ...safeOptions } = args.options ?? {}
      return startSession({
        engine: args.engine,
        model: args.model,
        options: {
          ...safeOptions,
          claudeToolMode: 'safe',
          claudeDangerouslySkipPermissions: false,
          codexDangerouslyBypassApprovalsAndSandbox: false,
          codexWebSearch: safeOptions.codexWebSearch ?? true
        },
        cwd: userlandDir(),
        mode: 'write'
      })
    }
  )
  ipcMain.handle('engine:send', (_e, sessionId: string, prompt: string) =>
    sendToSession(sessionId, prompt)
  )
  ipcMain.handle('engine:command', (_e, sessionId: string, command) =>
    commandSession(sessionId, command)
  )
  ipcMain.handle('engine:cancel', (_e, sessionId: string) => cancelSession(sessionId))

  // ---- Real app state: project folders + persisted per-project chats.
  registerAppStateBricks()

  // ---- Product instrumentation + first-run setup checks.
  registerAuthBricks()
  registerAnalyticsBricks()
  registerFeedbackBricks()
  registerOnboardingBricks()
  ipcMain.handle('auth:config', () => {
    const projectId =
      process.env.HEXCLAVE_PROJECT_ID ||
      process.env.VITE_HEXCLAVE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID ||
      ''
    const publishableClientKey =
      process.env.HEXCLAVE_PUBLISHABLE_CLIENT_KEY ||
      process.env.VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ||
      process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ||
      ''
    return {
      ok: true,
      configured: Boolean(projectId),
      projectId: projectId || undefined,
      publishableClientKey: publishableClientKey || undefined
    }
  })
  ipcMain.handle('auth:openExternal', (_e, url: string) => {
    if (!/^https?:\/\//.test(url) && !isAuthCallbackUrl(url)) {
      return { ok: false, error: 'Only web URLs and y auth callbacks can be opened for auth.' }
    }
    void shell.openExternal(url)
    return { ok: true }
  })

  // ---- PTY terminal brick: real interactive shell sessions rendered by Userland.
  registerTerminalBricks()

  // ---- Capability bricks (Phase 6): network + scoped filesystem, consent-gated.
  registerCapabilityBricks()

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
  killAllTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
