import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  nativeTheme,
  Menu,
  dialog,
  type MenuItemConstructorOptions,
  type MessageBoxOptions
} from 'electron'
import { isAbsolute, join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { copyFile, mkdir, readFile, writeFile, stat, rm } from 'fs/promises'
import { watch } from 'node:fs'
import { createHash } from 'node:crypto'
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
import { checkAppUpdates, registerUpdateBricks } from './appUpdates'
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
const RESET_LOCAL_DATA_ARG = '--reset-y-data'
const USERLAND_SEED_METADATA_VERSION = 1
const DEFAULT_HEXCLAVE_PROJECT_ID = 'eeb236a6-5299-4457-8819-d15a1728ca38'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function configureUserDataDirOverride(): void {
  const arg = process.argv.find((value) => value.startsWith('--y-user-data-dir='))
  const rawPath = arg?.slice('--y-user-data-dir='.length).trim()
  if (!rawPath) return
  app.setPath('userData', isAbsolute(rawPath) ? rawPath : resolve(rawPath))
}

configureUserDataDirOverride()

app.commandLine.appendSwitch('force-dark-mode')
nativeTheme.themeSource = 'dark'
nativeTheme.on('updated', () => {
  if (nativeTheme.themeSource !== 'dark') nativeTheme.themeSource = 'dark'
})

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

async function resetPersistedAppData(): Promise<void> {
  killAllTerminals()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy()
  }
  await rm(app.getPath('userData'), { recursive: true, force: true })
}

async function resetLocalDataAndRelaunch(): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['Cancel', 'Reset and Relaunch'],
    defaultId: 0,
    cancelId: 0,
    message: 'Reset local y data?',
    detail:
      'This deletes local chats, folders, auth session, Modify history, Userland changes, permissions, analytics cache, and isolated workspaces stored on this Mac. It does not delete your project folders.'
  }
  const focusedWindow = BrowserWindow.getFocusedWindow()
  const result = focusedWindow
    ? await dialog.showMessageBox(focusedWindow, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 1) return

  try {
    await resetPersistedAppData()
    app.relaunch()
    app.exit(0)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await dialog.showErrorBox('Could not reset local data', error)
  }
}

async function restoreSavedCustomInterface(): Promise<{ ok: boolean; error?: string }> {
  try {
    const backup = await readFile(userlandDefaultResetBackupFile(), 'utf-8')
    const backupHash = sha256(backup)
    await writeFile(userlandFile(), backup, 'utf-8')
    await writeUserlandSeedMetadata({
      seedHash: backupHash,
      seedVersion: app.getVersion(),
      customized: true
    }).catch((err) => {
      console.warn('[y] Userland seed metadata unavailable:', err)
    })
    await clearPendingUserlandSeed()
    await ulSnapshot(userlandDir(), 'restore custom app').catch((err) => {
      console.warn('[y] Userland restore snapshot unavailable:', err)
    })
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('userland:changed')
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function restoreSavedCustomInterfaceFromMenu(focusedWindow?: BrowserWindow | null): Promise<void> {
  const result = await restoreSavedCustomInterface()
  const target = focusedWindow && !focusedWindow.isDestroyed() ? focusedWindow : BrowserWindow.getFocusedWindow()
  if (result.ok) {
    if (target && !target.isDestroyed()) target.focus()
    return
  }

  const message = result.error?.includes('ENOENT') ? 'No saved custom interface' : 'Could not restore custom interface'
  const detail =
    result.error?.includes('ENOENT')
      ? 'y saves your custom interface when you switch to the default y interface. There is no saved custom interface to restore yet.'
      : result.error || 'The saved custom interface could not be restored.'
  if (target && !target.isDestroyed()) {
    await dialog.showMessageBox(target, { type: 'warning', message, detail })
  } else {
    await dialog.showMessageBox({ type: 'warning', message, detail })
  }
}

function installAppMenu(): void {
  const resetLocalDataItem: MenuItemConstructorOptions = {
    label: 'Reset Local Data...',
    click: () => void resetLocalDataAndRelaunch()
  }
  const restoreCustomInterfaceItem: MenuItemConstructorOptions = {
    label: 'Restore Custom Interface...',
    click: (_item, focusedWindow) =>
      void restoreSavedCustomInterfaceFromMenu(focusedWindow instanceof BrowserWindow ? focusedWindow : null)
  }
  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates...',
    click: async (_item, focusedWindow) => {
      const result = await checkAppUpdates()
      if (result.available) return
      const message = result.error ? 'Could not check for updates' : 'y is up to date'
      const detail = result.error || `You are running y ${result.currentVersion}.`
      if (focusedWindow && !focusedWindow.isDestroyed()) {
        await dialog.showMessageBox(focusedWindow, { type: result.error ? 'warning' : 'info', message, detail })
      } else {
        await dialog.showMessageBox({ type: result.error ? 'warning' : 'info', message, detail })
      }
    }
  }

  const template: MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              checkForUpdatesItem,
              { type: 'separator' },
              restoreCustomInterfaceItem,
              { type: 'separator' },
              resetLocalDataItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
          { role: 'help', submenu: [] }
        ]
      : [
          {
            label: 'File',
            submenu: [restoreCustomInterfaceItem, { type: 'separator' }, resetLocalDataItem, { type: 'separator' }, { role: 'quit' }]
          },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' }
        ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const isE2E = process.env.Y_E2E === '1'
const gotSingleInstanceLock = isE2E || app.requestSingleInstanceLock()
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

function userlandPendingSeedFile(): string {
  return join(userlandDir(), '.y', 'pending-panel.tsx')
}

function userlandDefaultResetBackupFile(): string {
  return join(userlandDir(), '.y', 'before-default-panel.tsx')
}

type UserlandSeedMetadata = {
  version: number
  seedHash: string
  seedVersion: string
  updatedAt: string
  customized: boolean
  pendingSeedHash?: string
  pendingSeedVersion?: string
}

type UserlandUpdateManifestItem = {
  id: string
  title: string
  description: string
  required: boolean
}

type UserlandUpdateManifest = {
  version: string
  items: UserlandUpdateManifestItem[]
}

function userlandSeedMetadataFile(): string {
  return join(app.getPath('userData'), 'userland-seed.json')
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

function userlandUpdateManifestFile(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'userland-update-manifest.json')
    : join(app.getAppPath(), 'userland-update-manifest.json')
}

async function readUserlandUpdateManifest(): Promise<UserlandUpdateManifest | undefined> {
  try {
    const parsed = JSON.parse(await readFile(userlandUpdateManifestFile(), 'utf-8')) as Partial<UserlandUpdateManifest>
    if (typeof parsed.version !== 'string' || !Array.isArray(parsed.items)) return undefined
    const items = parsed.items
      .map((item) => ({
        id: typeof item?.id === 'string' ? item.id : '',
        title: typeof item?.title === 'string' ? item.title : '',
        description: typeof item?.description === 'string' ? item.description : '',
        required: Boolean(item?.required)
      }))
      .filter((item) => item.id && item.title && item.description)
    if (!items.length) return undefined
    return { version: parsed.version, items }
  } catch {
    return undefined
  }
}

function userlandSeedArchiveDir(): string {
  return join(app.getPath('userData'), 'userland-seeds')
}

function archivedUserlandSeedFile(hash: string): string {
  if (!/^[0-9a-f]{64}$/iu.test(hash)) throw new Error('Invalid Userland seed hash.')
  return join(userlandSeedArchiveDir(), `${hash}.tsx`)
}

async function archiveUserlandSeed(hash: string, source: string): Promise<void> {
  await mkdir(userlandSeedArchiveDir(), { recursive: true })
  await writeFile(archivedUserlandSeedFile(hash), source, 'utf-8')
}

async function stagePendingUserlandSeed(source: string): Promise<void> {
  await mkdir(join(userlandDir(), '.y'), { recursive: true })
  await writeFile(userlandPendingSeedFile(), source, 'utf-8')
}

async function clearPendingUserlandSeed(): Promise<void> {
  await rm(userlandPendingSeedFile(), { force: true }).catch(() => {})
}

async function stageUserlandUpdateForReview(
  seed: string,
  seedHash: string,
  seedVersion: string,
  metadata: UserlandSeedMetadata | null,
  liveHash: string
): Promise<void> {
  await stagePendingUserlandSeed(seed).catch((err) => {
    console.warn('[y] Userland pending seed unavailable:', err)
  })
  await writeUserlandSeedMetadata({
    seedHash: metadata?.seedHash || liveHash,
    seedVersion: metadata?.seedVersion || seedVersion,
    customized: true,
    pendingSeedHash: seedHash,
    pendingSeedVersion: seedVersion
  }).catch((err) => {
    console.warn('[y] Userland seed metadata unavailable:', err)
  })
}

async function saveDefaultResetBackup(source: string): Promise<void> {
  await mkdir(join(userlandDir(), '.y'), { recursive: true })
  await writeFile(userlandDefaultResetBackupFile(), source, 'utf-8')
}

async function readUserlandSeedMetadata(): Promise<UserlandSeedMetadata | null> {
  try {
    const raw = await readFile(userlandSeedMetadataFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<UserlandSeedMetadata>
    if (parsed.version !== USERLAND_SEED_METADATA_VERSION || typeof parsed.seedHash !== 'string') return null
    return {
      version: USERLAND_SEED_METADATA_VERSION,
      seedHash: parsed.seedHash,
      seedVersion: typeof parsed.seedVersion === 'string' ? parsed.seedVersion : 'unknown',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      customized: Boolean(parsed.customized),
      pendingSeedHash: typeof parsed.pendingSeedHash === 'string' ? parsed.pendingSeedHash : undefined,
      pendingSeedVersion: typeof parsed.pendingSeedVersion === 'string' ? parsed.pendingSeedVersion : undefined
    }
  } catch {
    return null
  }
}

async function writeUserlandSeedMetadata(metadata: Omit<UserlandSeedMetadata, 'version' | 'updatedAt'>): Promise<void> {
  await writeFile(
    userlandSeedMetadataFile(),
    JSON.stringify(
      {
        version: USERLAND_SEED_METADATA_VERSION,
        ...metadata,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  )
}

async function userlandSeedStatus(): Promise<{
  ok: boolean
  customized: boolean
  seedVersion: string
  pending: boolean
  pendingSeedHash?: string
  pendingSeedVersion?: string
  updateManifest?: UserlandUpdateManifest
  restoreDefaultAvailable: boolean
  error?: string
}> {
  try {
    const metadata = await readUserlandSeedMetadata()
    const updateManifest = await readUserlandUpdateManifest()
    const live = await readFile(userlandFile(), 'utf-8')
    const liveHash = sha256(live)
    let restoreDefaultAvailable = false
    try {
      const backup = await readFile(userlandDefaultResetBackupFile(), 'utf-8')
      restoreDefaultAvailable = sha256(backup) !== liveHash
    } catch {
      restoreDefaultAvailable = false
    }
    if (metadata?.pendingSeedHash) {
      if (liveHash === metadata.pendingSeedHash) {
        await writeUserlandSeedMetadata({
          seedHash: metadata.pendingSeedHash,
          seedVersion: metadata.pendingSeedVersion || app.getVersion(),
          customized: false
        })
        await clearPendingUserlandSeed()
        return {
          ok: true,
          customized: false,
          seedVersion: metadata.pendingSeedVersion || app.getVersion(),
          pending: false,
          updateManifest,
          restoreDefaultAvailable
        }
      }
    }
    return {
      ok: true,
      customized: Boolean(metadata?.customized),
      seedVersion: metadata?.seedVersion || app.getVersion(),
      pending: Boolean(metadata?.pendingSeedHash),
      pendingSeedHash: metadata?.pendingSeedHash,
      pendingSeedVersion: metadata?.pendingSeedVersion,
      updateManifest,
      restoreDefaultAvailable
    }
  } catch (err) {
    return {
      ok: false,
      customized: false,
      seedVersion: app.getVersion(),
      pending: false,
      restoreDefaultAvailable: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function isKnownLightUserlandDefault(source: string): boolean {
  return (
    source.includes('data-testid="y-app"') &&
    source.includes('--y-bg: #f5f5f7') &&
    source.includes('--y-sidebar: rgba(230, 231, 235')
  )
}

function userlandRepairBackupFile(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(userlandDir(), `panel.before-dark-repair.${stamp}.tsx`)
}

// Snapshot history lives in a git repo INSIDE the Userland folder — fully
// separate from the project repo. We pass identity via -c flags so we never
// touch the user's global git config, and always run with cwd = userlandDir.
async function ensureUserland(): Promise<void> {
  await mkdir(userlandDir(), { recursive: true })
  const seed = await readUserlandSeed()
  const seedHash = sha256(seed)
  const seedVersion = app.getVersion()
  const updateManifest = await readUserlandUpdateManifest()
  const shouldReviewBundledUserlandUpdate = Boolean(updateManifest?.items.length)
  let needsWrite = false
  let metadata: UserlandSeedMetadata | null = null
  await archiveUserlandSeed(seedHash, seed).catch((err) => {
    console.warn('[y] Userland seed archive unavailable:', err)
  })
  try {
    const live = await readFile(userlandFile(), 'utf-8')
    const liveHash = sha256(live)
    metadata = await readUserlandSeedMetadata()
    if (isKnownLightUserlandDefault(live)) {
      await copyFile(userlandFile(), userlandRepairBackupFile()).catch((err) => {
        console.warn('[y] Userland dark repair backup unavailable:', err)
      })
      needsWrite = true
    } else if (metadata && !metadata.pendingSeedHash && metadata.seedHash !== seedHash && liveHash === metadata.seedHash) {
      // The user never changed the previous bundled Userland. Move them to the
      // new bundled seed automatically unless this release describes Userland
      // changes. In that case, show the same checklist to everyone so users can
      // understand what changed before accepting it.
      if (shouldReviewBundledUserlandUpdate) {
        await stageUserlandUpdateForReview(seed, seedHash, seedVersion, metadata, liveHash)
      } else {
        needsWrite = true
      }
    } else if (liveHash === seedHash && (!metadata || metadata.seedHash !== seedHash || metadata.customized)) {
      await writeUserlandSeedMetadata({
        seedHash,
        seedVersion,
        customized: false
      }).catch((err) => {
        console.warn('[y] Userland seed metadata unavailable:', err)
      })
      await clearPendingUserlandSeed()
    } else if (metadata?.pendingSeedHash && liveHash === metadata.seedHash && metadata.seedHash !== seedHash) {
      // The user kept their accepted/customized Userland while a bundled seed is
      // waiting for explicit action. Keep the pending update visible across
      // restarts; do not treat the accepted customized file as fully up to date.
      await writeUserlandSeedMetadata({
        seedHash: metadata.seedHash,
        seedVersion: metadata.seedVersion,
        customized: true,
        pendingSeedHash: metadata.pendingSeedHash,
        pendingSeedVersion: metadata.pendingSeedVersion || seedVersion
      }).catch((err) => {
        console.warn('[y] Userland seed metadata unavailable:', err)
      })
    } else if (metadata && metadata.seedHash !== seedHash && liveHash !== metadata.seedHash) {
      // Userland is user-owned once it diverges from the last accepted seed.
      // Stage the new bundled seed for an explicit Modify-assisted update flow
      // instead of silently merging optional UI changes during app startup.
      await stageUserlandUpdateForReview(seed, seedHash, seedVersion, metadata, liveHash)
    } else if (!metadata || metadata.seedHash !== seedHash || metadata.customized !== (liveHash !== seedHash)) {
      // Existing 0.0.1 installs have no metadata. Mark customized Userland as
      // user-owned and record newer bundled seeds as pending instead of
      // overwriting local UI changes.
      const shouldStagePendingSeed =
        liveHash !== seedHash && (!metadata || (liveHash !== metadata.seedHash && metadata.seedHash !== seedHash))
      if (shouldStagePendingSeed) {
        await stageUserlandUpdateForReview(seed, seedHash, seedVersion, metadata, liveHash)
      } else {
        await writeUserlandSeedMetadata({
          seedHash: metadata?.seedHash || liveHash,
          seedVersion: metadata?.seedVersion || seedVersion,
          customized: liveHash !== seedHash
        }).catch((err) => {
          console.warn('[y] Userland seed metadata unavailable:', err)
        })
        await clearPendingUserlandSeed()
      }
    }
    // Dev: pull kernel seed updates into the live Userland file when seed is newer.
    if (!needsWrite && is.dev) {
      const [seedStat, liveStat] = await Promise.all([stat(userlandSeedFile()), stat(userlandFile())])
      if (seedStat.mtimeMs > liveStat.mtimeMs) needsWrite = true
    }
  } catch {
    needsWrite = true
  }
  if (needsWrite) {
    await writeFile(userlandFile(), seed, 'utf-8')
    await writeUserlandSeedMetadata({
      seedHash,
      seedVersion,
      customized: false
    }).catch((err) => {
      console.warn('[y] Userland seed metadata unavailable:', err)
    })
    await clearPendingUserlandSeed()
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
  nativeTheme.themeSource = 'dark'
  if (process.argv.includes(RESET_LOCAL_DATA_ARG)) {
    await resetPersistedAppData()
    app.relaunch({ args: process.argv.filter((arg) => arg !== RESET_LOCAL_DATA_ARG) })
    app.exit(0)
    return
  }
  installAppMenu()
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
  ipcMain.handle('userland:seedStatus', () => userlandSeedStatus())

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
      const seedHash = sha256(seed)
      const current = await readFile(userlandFile(), 'utf-8').catch(() => '')
      if (current && sha256(current) !== seedHash) {
        await saveDefaultResetBackup(current).catch((err) => {
          console.warn('[y] Userland default reset backup unavailable:', err)
        })
        await ulSnapshot(userlandDir(), 'before default app').catch((err) => {
          console.warn('[y] Userland pre-reset snapshot unavailable:', err)
        })
      }
      await writeFile(userlandFile(), seed, 'utf-8')
      await writeUserlandSeedMetadata({
        seedHash,
        seedVersion: app.getVersion(),
        customized: false
      }).catch((err) => {
        console.warn('[y] Userland seed metadata unavailable:', err)
      })
      await clearPendingUserlandSeed()
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

  ipcMain.handle('userland:restoreDefaultResetBackup', async () => {
    return restoreSavedCustomInterface()
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
  registerUpdateBricks()
  ipcMain.handle('auth:config', () => {
    const configuredProjectId =
      process.env.HEXCLAVE_PROJECT_ID ||
      process.env.VITE_HEXCLAVE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID ||
      ''
    const projectId = UUID_RE.test(configuredProjectId) ? configuredProjectId : DEFAULT_HEXCLAVE_PROJECT_ID
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
}).catch((err: unknown) => {
  const error = err instanceof Error ? err.stack || err.message : String(err)
  console.error('[y] Fatal startup error:', error)
  app.quit()
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
