import { app, BrowserWindow, ipcMain, net } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

type GithubReleaseAsset = {
  name?: unknown
  browser_download_url?: unknown
}

type GithubRelease = {
  tag_name?: unknown
  html_url?: unknown
  assets?: unknown
}

type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

type UpdateState = {
  phase: UpdatePhase
  checking: boolean
  currentVersion: string
  latestVersion?: string
  available: boolean
  releaseUrl?: string
  downloadUrl?: string
  checkedAt?: string
  error?: string
  progress?: number
}

const RELEASE_API_URL = 'https://api.github.com/repos/y-times-y/y/releases/latest'
const RELEASES_URL = 'https://github.com/y-times-y/y/releases/latest'
const DEFAULT_UPDATE_FEED_URL = 'https://github.com/y-times-y/y/releases/latest/download'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let configured = false
let configuredFeedUrl = ''
let state: UpdateState = {
  phase: 'idle',
  checking: false,
  currentVersion: app.getVersion(),
  available: false
}

function testUpdateState(): UpdateState | null {
  if (process.env.Y_E2E_UPDATE_STATE !== '1') return null
  const phase = (process.env.Y_E2E_UPDATE_PHASE || 'available') as UpdatePhase
  const latestVersion = process.env.Y_E2E_UPDATE_VERSION || '9.9.9'
  const error = process.env.Y_E2E_UPDATE_ERROR || undefined
  const progress = Number.parseInt(process.env.Y_E2E_UPDATE_PROGRESS || '', 10)
  return {
    phase,
    checking: phase === 'checking',
    currentVersion: app.getVersion(),
    latestVersion,
    available: phase !== 'idle' && phase !== 'not-available',
    checkedAt: new Date().toISOString(),
    error,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : undefined
  }
}

function cleanVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().replace(/^v/u, '')
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(cleaned) ? cleaned : undefined
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split(/[.+-]/u).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0)
  const bParts = b.split(/[.+-]/u).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    if (aParts[i] > bParts[i]) return 1
    if (aParts[i] < bParts[i]) return -1
  }
  return 0
}

function pickMacDownloadUrl(release: GithubRelease): string | undefined {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const candidates = assets
    .filter((asset): asset is GithubReleaseAsset => asset && typeof asset === 'object')
    .map((asset) => ({
      name: typeof asset.name === 'string' ? asset.name : '',
      url: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : ''
    }))
    .filter((asset) => asset.url.startsWith('https://github.com/') && /\.dmg$/u.test(asset.name))

  return (
    candidates.find((asset) => asset.name === 'y-mac.dmg')?.url ||
    candidates.find((asset) => /^y-\d+\.\d+\.\d+\.dmg$/u.test(asset.name))?.url ||
    candidates[0]?.url
  )
}

function publishState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app-update:changed', state)
  }
}

function setState(patch: Partial<UpdateState>): UpdateState {
  state = {
    ...state,
    ...patch,
    currentVersion: app.getVersion()
  }
  publishState()
  return state
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  const response = await net.fetch(RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `y/${app.getVersion()}`
    }
  })
  if (!response.ok) throw new Error(`GitHub releases returned ${response.status}`)
  return (await response.json()) as GithubRelease
}

function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

function updateFeedFile(): string {
  return join(app.getPath('userData'), 'update-feed-url.txt')
}

function readUpdateFeedFile(): string {
  try {
    return readFileSync(updateFeedFile(), 'utf-8').trim()
  } catch {
    return ''
  }
}

function updateFeedUrl(): string {
  const arg = process.argv.find((value) => value.startsWith('--y-update-feed-url='))
  const argValue = arg?.slice('--y-update-feed-url='.length).trim()
  const url = (
    argValue ||
    envValue('Y_UPDATE_FEED_URL', 'VITE_Y_UPDATE_FEED_URL') ||
    readUpdateFeedFile() ||
    DEFAULT_UPDATE_FEED_URL
  ).replace(/\/+$/u, '')

  if (argValue || envValue('Y_UPDATE_FEED_URL', 'VITE_Y_UPDATE_FEED_URL')) {
    try {
      writeFileSync(updateFeedFile(), url, 'utf-8')
    } catch (err) {
      console.warn('[y] Could not persist update feed URL:', err)
    }
  }

  return url
}

function configureAutoUpdater(): void {
  if (configured) return
  configured = true
  const testState = testUpdateState()
  if (testState) {
    setState(testState)
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = Boolean(envValue('Y_UPDATE_ALLOW_PRERELEASE'))
  configuredFeedUrl = updateFeedUrl()
  autoUpdater.setFeedURL({ provider: 'generic', url: configuredFeedUrl })

  autoUpdater.on('checking-for-update', () => {
    setState({ phase: 'checking', checking: true, error: undefined, progress: undefined })
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState({
      phase: 'available',
      checking: false,
      available: true,
      latestVersion: cleanVersion(info.version) || info.version,
      checkedAt: new Date().toISOString(),
      error: undefined,
      progress: undefined
    })
  })
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    setState({
      phase: 'not-available',
      checking: false,
      available: false,
      latestVersion: cleanVersion(info.version) || info.version,
      checkedAt: new Date().toISOString(),
      progress: undefined
    })
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    setState({
      phase: 'downloading',
      checking: false,
      available: true,
      progress: Math.max(0, Math.min(100, Math.round(progress.percent || 0)))
    })
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setState({
      phase: 'downloaded',
      checking: false,
      available: true,
      latestVersion: cleanVersion(info.version) || info.version,
      progress: 100
    })
  })
  autoUpdater.on('error', (err: Error) => {
    setState({
      phase: 'error',
      checking: false,
      error: err.message || String(err)
    })
  })
}

async function checkDownloadFallback(): Promise<Partial<UpdateState>> {
  const release = await fetchLatestRelease()
  const latestVersion = cleanVersion(release.tag_name)
  const releaseUrl = typeof release.html_url === 'string' ? release.html_url : RELEASES_URL
  const available = Boolean(latestVersion && compareVersions(latestVersion, app.getVersion()) > 0)
  return {
    latestVersion,
    available,
    releaseUrl,
    downloadUrl: pickMacDownloadUrl(release) || releaseUrl,
    checkedAt: new Date().toISOString()
  }
}

export async function checkAppUpdates(): Promise<UpdateState> {
  configureAutoUpdater()
  const testState = testUpdateState()
  if (testState) return setState(testState)
  setState({ phase: 'checking', checking: true, error: undefined, progress: undefined })
  const usesDefaultReleaseFeed = !configuredFeedUrl || configuredFeedUrl === DEFAULT_UPDATE_FEED_URL

  try {
    const result = await autoUpdater.checkForUpdates()
    const fallback: Partial<UpdateState> = usesDefaultReleaseFeed ? await checkDownloadFallback().catch(() => ({})) : {}
    const latestVersion = cleanVersion(result?.updateInfo.version) || fallback.latestVersion
    const available = Boolean(latestVersion && compareVersions(latestVersion, app.getVersion()) > 0)
    return setState({
      phase: available ? 'available' : 'not-available',
      checking: false,
      latestVersion,
      available,
      releaseUrl: fallback.releaseUrl,
      downloadUrl: fallback.downloadUrl,
      checkedAt: new Date().toISOString()
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn('[y] App update check failed:', error)
    if (!usesDefaultReleaseFeed) {
      return setState({
        phase: 'error',
        checking: false,
        checkedAt: new Date().toISOString(),
        error
      })
    }

    try {
      const fallback = await checkDownloadFallback()
      return setState({
        phase: fallback.available ? 'available' : 'not-available',
        checking: false,
        error: undefined,
        progress: undefined,
        ...fallback
      })
    } catch {
      return setState({
        phase: 'error',
        checking: false,
        checkedAt: new Date().toISOString(),
        error
      })
    }
  }
}

async function installUpdate(): Promise<{ ok: boolean; error?: string }> {
  configureAutoUpdater()
  const testState = testUpdateState()
  if (testState) {
    if (testState.phase === 'error') return { ok: false, error: testState.error || 'Test update failed.' }
    setState({ ...testState, phase: 'installing', progress: 100 })
    return { ok: true }
  }
  try {
    if (state.phase === 'downloaded') {
      return await startInstallHandoff()
    }
    setState({ phase: 'downloading', checking: false, error: undefined, progress: 0 })
    await autoUpdater.downloadUpdate()
    return await startInstallHandoff()
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    setState({ phase: 'error', checking: false, error })
    return { ok: false, error }
  }
}

async function startInstallHandoff(): Promise<{ ok: boolean; error?: string }> {
  setState({ phase: 'installing', checking: false, available: true, error: undefined, progress: 100 })
  autoUpdater.quitAndInstall(false, true)
  return { ok: true }
}

export function registerUpdateBricks(): void {
  configureAutoUpdater()

  ipcMain.handle('app-update:get', () => state)
  ipcMain.handle('app-update:check', () => checkAppUpdates())
  ipcMain.handle('app-update:open', () => installUpdate())

  if (process.env.Y_E2E_UPDATE_STATE === '1') return

  setTimeout(() => {
    void checkAppUpdates()
  }, 5000)
  setInterval(() => {
    void checkAppUpdates()
  }, CHECK_INTERVAL_MS).unref()
}
