import { app, BrowserWindow, ipcMain, net, shell } from 'electron'

type GithubReleaseAsset = {
  name?: unknown
  browser_download_url?: unknown
}

type GithubRelease = {
  tag_name?: unknown
  html_url?: unknown
  assets?: unknown
}

type UpdateState = {
  checking: boolean
  currentVersion: string
  latestVersion?: string
  available: boolean
  releaseUrl?: string
  downloadUrl?: string
  checkedAt?: string
  error?: string
}

const RELEASE_API_URL = 'https://api.github.com/repos/y-times-y/y/releases/latest'
const RELEASES_URL = 'https://github.com/y-times-y/y/releases/latest'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

let state: UpdateState = {
  checking: false,
  currentVersion: app.getVersion(),
  available: false
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

async function checkForUpdates(): Promise<UpdateState> {
  state = { ...state, checking: true, error: undefined }
  publishState()

  try {
    const release = await fetchLatestRelease()
    const latestVersion = cleanVersion(release.tag_name)
    const releaseUrl = typeof release.html_url === 'string' ? release.html_url : RELEASES_URL
    const available = Boolean(latestVersion && compareVersions(latestVersion, app.getVersion()) > 0)
    state = {
      checking: false,
      currentVersion: app.getVersion(),
      latestVersion,
      available,
      releaseUrl,
      downloadUrl: pickMacDownloadUrl(release) || releaseUrl,
      checkedAt: new Date().toISOString()
    }
  } catch (err) {
    state = {
      ...state,
      checking: false,
      currentVersion: app.getVersion(),
      available: false,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err)
    }
  }

  publishState()
  return state
}

export function registerUpdateBricks(): void {
  ipcMain.handle('app-update:get', () => state)
  ipcMain.handle('app-update:check', () => checkForUpdates())
  ipcMain.handle('app-update:open', async () => {
    const target = state.downloadUrl || state.releaseUrl || RELEASES_URL
    await shell.openExternal(target)
    return { ok: true }
  })

  setTimeout(() => {
    void checkForUpdates()
  }, 5000)
  setInterval(() => {
    void checkForUpdates()
  }, CHECK_INTERVAL_MS).unref()
}
