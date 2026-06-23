import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron'
import { HexclaveClientApp, hexclaveAppInternalsSymbol } from '@hexclave/js'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { identifyAnalyticsUser } from './analytics'

type AuthTokens = {
  accessToken: string
  refreshToken: string
}

type AuthUser = {
  id: string
  email?: string
  displayName?: string
  profileImageUrl?: string
  connectedAccounts?: AuthConnectedAccount[]
}

type AuthConnectedAccount = {
  provider: string
  providerAccountId: string
  profile?: {
    username?: string
    displayName?: string
    avatarUrl?: string
    profileUrl?: string
  }
}

type StoredAuthSession = {
  tokens: AuthTokens
  user: AuthUser
  savedAt: string
}

class AuthRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'AuthRefreshError'
  }
}

const DEFAULT_HEXCLAVE_PROJECT_ID = 'eeb236a6-5299-4457-8819-d15a1728ca38'
const DEFAULT_HEXCLAVE_API_URL = 'https://api.hexclave.com'
const DEFAULT_Y_AUTH_HANDLER_URL = 'https://ytimesy.com/handler/cli-auth-confirm'
const DEFAULT_Y_AUTH_SIGN_IN_URL = 'https://ytimesy.com/handler/sign-in'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hexclaveProjectId(): string {
  return (
    process.env.HEXCLAVE_PROJECT_ID ||
    process.env.VITE_HEXCLAVE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID ||
    DEFAULT_HEXCLAVE_PROJECT_ID
  )
}

function hexclaveApiUrl(): string {
  return (
    process.env.HEXCLAVE_API_URL ||
    process.env.VITE_HEXCLAVE_API_URL ||
    process.env.NEXT_PUBLIC_HEXCLAVE_API_URL ||
    DEFAULT_HEXCLAVE_API_URL
  ).replace(/\/+$/u, '')
}

function hexclavePublishableClientKey(): string {
  return (
    process.env.HEXCLAVE_PUBLISHABLE_CLIENT_KEY ||
    process.env.VITE_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ||
    process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ||
    ''
  )
}

function cliAuthConfirmUrl(loginCode: string): URL {
  const configured =
    process.env.Y_AUTH_HANDLER_URL ||
    process.env.VITE_Y_AUTH_HANDLER_URL ||
    process.env.HEXCLAVE_CLI_AUTH_CONFIRM_URL ||
    process.env.VITE_HEXCLAVE_CLI_AUTH_CONFIRM_URL ||
    process.env.NEXT_PUBLIC_HEXCLAVE_CLI_AUTH_CONFIRM_URL ||
    ''
  const base = configured || DEFAULT_Y_AUTH_HANDLER_URL
  const url = new URL(base)
  url.searchParams.set('login_code', loginCode)
  return url
}

function hostedSignInUrl(loginCode: string): string {
  const configured =
    process.env.Y_AUTH_SIGN_IN_URL ||
    process.env.VITE_Y_AUTH_SIGN_IN_URL ||
    process.env.HEXCLAVE_SIGN_IN_URL ||
    process.env.VITE_HEXCLAVE_SIGN_IN_URL ||
    ''
  const url = new URL(configured || DEFAULT_Y_AUTH_SIGN_IN_URL)
  url.searchParams.set('after_auth_return_to', cliAuthConfirmUrl(loginCode).toString())
  return url.toString()
}

function createAuthApp(tokenStore: 'memory' | AuthTokens): HexclaveClientApp<true, string> {
  return new HexclaveClientApp({
    projectId: hexclaveProjectId(),
    baseUrl: hexclaveApiUrl(),
    ...(hexclavePublishableClientKey() ? { publishableClientKey: hexclavePublishableClientKey() } : {}),
    tokenStore,
    analytics: { enabled: false, replays: { enabled: false } },
    devTool: false,
    redirectMethod: 'none',
    noAutomaticPrefetch: true
  })
}

function authDir(): string {
  return join(app.getPath('userData'), 'auth')
}

function authSessionFile(): string {
  return join(authDir(), 'session.bin')
}

function emitAuthChanged(session: StoredAuthSession | null): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('kernel-auth:changed', session)
  }
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function cleanUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = cleanString(raw.id, 160)
  if (!id) return null
  const email = cleanString(raw.email ?? raw.primaryEmail ?? raw.primary_email, 320)
  const displayName = cleanString(raw.displayName ?? raw.display_name, 160)
  const profileImageUrl = cleanString(raw.profileImageUrl ?? raw.profile_image_url, 2000)
  const connectedAccounts = cleanConnectedAccounts(raw.connectedAccounts)
  return {
    id,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
    ...(profileImageUrl ? { profileImageUrl } : {}),
    ...(connectedAccounts.length ? { connectedAccounts } : {})
  }
}

function cleanConnectedAccounts(value: unknown): AuthConnectedAccount[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): AuthConnectedAccount | null => {
      if (!item || typeof item !== 'object') return null
      const raw = item as Record<string, unknown>
      const provider = cleanString(raw.provider ?? raw.id, 80)
      const providerAccountId = cleanString(raw.providerAccountId ?? raw.provider_account_id, 240)
      if (!provider || !providerAccountId) return null
      const rawProfile = raw.profile && typeof raw.profile === 'object' ? (raw.profile as Record<string, unknown>) : {}
      const username = cleanString(rawProfile.username, 160)
      const profileDisplayName = cleanString(rawProfile.displayName ?? rawProfile.display_name, 160)
      const avatarUrl = cleanString(rawProfile.avatarUrl ?? rawProfile.avatar_url, 2000)
      const profileUrl = cleanString(rawProfile.profileUrl ?? rawProfile.profile_url, 2000)
      return {
        provider,
        providerAccountId,
        ...((username || profileDisplayName || avatarUrl || profileUrl)
          ? {
              profile: {
                ...(username ? { username } : {}),
                ...(profileDisplayName ? { displayName: profileDisplayName } : {}),
                ...(avatarUrl ? { avatarUrl } : {}),
                ...(profileUrl ? { profileUrl } : {})
              }
            }
          : {})
      }
    })
    .filter((item): item is AuthConnectedAccount => Boolean(item))
}

function cleanTokens(value: unknown): AuthTokens | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const accessToken = cleanString(raw.accessToken, 12000)
  const refreshToken = cleanString(raw.refreshToken, 12000)
  return accessToken && refreshToken ? { accessToken, refreshToken } : null
}

async function readStoredAuthSession(): Promise<StoredAuthSession | null> {
  try {
    const encrypted = await readFile(authSessionFile())
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encrypted)
      : encrypted.toString('utf-8')
    const parsed = JSON.parse(json) as Partial<StoredAuthSession>
    const tokens = cleanTokens(parsed.tokens)
    const user = cleanUser(parsed.user)
    if (!tokens || !user) return null
    return { tokens, user, savedAt: cleanString(parsed.savedAt, 80) || new Date().toISOString() }
  } catch {
    return null
  }
}

async function saveStoredAuthSession(payload: unknown): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'Secure token storage is not available on this device.' }
  }
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid auth session.' }
  const raw = payload as Record<string, unknown>
  const tokens = cleanTokens(raw.tokens)
  const user = cleanUser(raw.user)
  if (!tokens || !user) return { ok: false, error: 'Invalid auth session.' }

  const session: StoredAuthSession = { tokens, user, savedAt: new Date().toISOString() }
  await mkdir(authDir(), { recursive: true })
  await writeFile(authSessionFile(), safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 })
  await identifyAnalyticsUser({ userId: user.id, email: user.email })
  emitAuthChanged(session)
  return { ok: true, user }
}

async function clearStoredAuthSession(): Promise<{ ok: boolean; error?: string }> {
  try {
    await rm(authSessionFile(), { force: true })
    emitAuthChanged(null)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const headers: Record<string, string> = {
    'x-hexclave-refresh-token': refreshToken,
    'x-stack-refresh-token': refreshToken,
    'x-hexclave-project-id': hexclaveProjectId(),
    'x-stack-project-id': hexclaveProjectId(),
    'x-hexclave-access-type': 'client',
    'x-stack-access-type': 'client'
  }
  const publishableClientKey = hexclavePublishableClientKey()
  if (publishableClientKey) {
    headers['x-hexclave-publishable-client-key'] = publishableClientKey
    headers['x-stack-publishable-client-key'] = publishableClientKey
  }

  const response = await fetch(`${hexclaveApiUrl()}/api/v1/auth/sessions/current/refresh`, {
    method: 'POST',
    headers
  })
  if (!response.ok) throw new AuthRefreshError(`y sign-in refresh failed (${response.status}).`, response.status)
  const json = (await response.json()) as Record<string, unknown>
  const accessToken = cleanString(json.access_token, 12000)
  const nextRefreshToken = cleanString(json.refresh_token, 12000) || refreshToken
  if (!accessToken) throw new Error('y sign-in did not return an access token.')
  return { accessToken, refreshToken: nextRefreshToken }
}

async function loadUser(tokens: AuthTokens): Promise<AuthUser> {
  const rawUser = await createAuthApp(tokens).getUser({ includeRestricted: true })
  const user = cleanUser(rawUser)
  if (!user) throw new Error('y sign-in did not return a user.')
  const connectedAccounts = await loadConnectedAccounts(rawUser)
  return { ...user, ...(connectedAccounts.length ? { connectedAccounts } : {}) }
}

async function loadConnectedAccounts(rawUser: unknown): Promise<AuthConnectedAccount[]> {
  if (!rawUser || typeof rawUser !== 'object') return []
  const listConnectedAccounts = Reflect.get(rawUser, 'listConnectedAccounts')
  if (typeof listConnectedAccounts !== 'function') return []
  try {
    const accounts = await listConnectedAccounts.call(rawUser)
    if (!Array.isArray(accounts)) return []
    return Promise.all(accounts.map(loadConnectedAccount))
  } catch {
    return []
  }
}

async function loadConnectedAccount(account: unknown): Promise<AuthConnectedAccount> {
  const raw = account && typeof account === 'object' ? (account as Record<string, unknown>) : {}
  const provider = cleanString(raw.provider ?? raw.id, 80)
  const providerAccountId = cleanString(raw.providerAccountId ?? raw.provider_account_id, 240)
  const base: AuthConnectedAccount = {
    provider: provider || 'unknown',
    providerAccountId: providerAccountId || 'unknown'
  }
  if (provider !== 'github') return base

  const profile = await loadGitHubProfile(account)
  return profile ? { ...base, profile } : base
}

async function loadGitHubProfile(account: unknown): Promise<AuthConnectedAccount['profile'] | null> {
  if (!account || typeof account !== 'object') return null
  const getAccessToken = Reflect.get(account, 'getAccessToken')
  if (typeof getAccessToken !== 'function') return null
  try {
    const tokenResult = await getAccessToken.call(account)
    const tokenPayload =
      tokenResult && typeof tokenResult === 'object' && Reflect.get(tokenResult, 'status') === 'ok'
        ? Reflect.get(tokenResult, 'data')
        : tokenResult
    const accessToken = cleanString(
      tokenPayload && typeof tokenPayload === 'object' ? Reflect.get(tokenPayload, 'accessToken') : '',
      12000
    )
    if (!accessToken) return null

    const response = await fetch('https://api.github.com/user', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': 'y-desktop'
      }
    })
    if (!response.ok) return null
    const profile = (await response.json()) as Record<string, unknown>
    const username = cleanString(profile.login, 160)
    const displayName = cleanString(profile.name, 160)
    const avatarUrl = cleanString(profile.avatar_url, 2000)
    const profileUrl = cleanString(profile.html_url, 2000)
    return username || displayName || avatarUrl || profileUrl
      ? {
          ...(username ? { username } : {}),
          ...(displayName ? { displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
          ...(profileUrl ? { profileUrl } : {})
        }
      : null
  } catch {
    return null
  }
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybeHuman = Reflect.get(error, 'humanReadableMessage')
    if (typeof maybeHuman === 'string' && maybeHuman.trim()) return maybeHuman
    const maybeMessage = Reflect.get(error, 'message')
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage
  }
  return error instanceof Error ? error.message : String(error)
}

async function restoreStoredAuthSession(): Promise<{ ok: boolean; session?: StoredAuthSession | null; error?: string }> {
  const stored = await readStoredAuthSession()
  if (!stored?.tokens?.refreshToken) return { ok: true, session: null }

  try {
    const tokens = await refreshTokens(stored.tokens.refreshToken)
    const user = await loadUser(tokens)
    const saved = await saveStoredAuthSession({ tokens, user })
    if (!saved.ok) throw new Error(saved.error || 'Could not save auth session.')
    return { ok: true, session: { tokens, user, savedAt: new Date().toISOString() } }
  } catch (err) {
    if (err instanceof AuthRefreshError && (err.status === 401 || err.status === 403)) {
      await clearStoredAuthSession()
      return { ok: false, error: getErrorMessage(err), session: null }
    }
    await clearStoredAuthSession()
    return { ok: false, error: getErrorMessage(err), session: null }
  }
}

async function startHostedSignIn(): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  try {
    const authApp = createAuthApp('memory')
    const internals = authApp[hexclaveAppInternalsSymbol]
    const initResponse = await internals.sendRequest('/auth/cli', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires_in_millis: 10 * 60 * 1000 })
    })
    if (!initResponse.ok) {
      throw new Error(`Failed to start y sign-in (${initResponse.status}): ${await initResponse.text()}`)
    }

    const init = (await initResponse.json()) as Record<string, unknown>
    const pollingCode = cleanString(init.polling_code, 200)
    const loginCode = cleanString(init.login_code, 200)
    if (!pollingCode || !loginCode) throw new Error('y sign-in did not return a login code.')

    await shell.openExternal(hostedSignInUrl(loginCode))

    for (let attempt = 0; attempt < 300; attempt++) {
      const pollResponse = await internals.sendRequest('/auth/cli/poll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ polling_code: pollingCode })
      })
      if (!pollResponse.ok) {
        throw new Error(`y sign-in polling failed (${pollResponse.status}): ${await pollResponse.text()}`)
      }
      const poll = (await pollResponse.json()) as Record<string, unknown>
      const pollStatus = cleanString(poll.status, 80)
      if (pollStatus === 'success') {
        const refreshToken = cleanString(poll.refresh_token, 12000)
        if (!refreshToken) throw new Error('y sign-in did not return a refresh token.')
        const tokens = await refreshTokens(refreshToken)
        const user = await loadUser(tokens)
        const saved = await saveStoredAuthSession({ tokens, user })
        if (!saved.ok) throw new Error(saved.error || 'Could not save auth session.')
        return { ok: true, user }
      }
      if (pollStatus === 'waiting') {
        await sleep(2000)
        continue
      }
      if (pollStatus === 'expired') throw new Error('y sign-in expired. Please try again.')
      if (pollStatus === 'used') throw new Error('This y sign-in code was already used. Please try again.')
      throw new Error(`Unexpected y sign-in status: ${pollStatus || 'unknown'}`)
    }
    throw new Error('y sign-in timed out. Please try again.')
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) }
  }
}

export function registerAuthBricks(): void {
  ipcMain.handle('kernel-auth:load', async () => ({ ok: true, session: await readStoredAuthSession() }))
  ipcMain.handle('kernel-auth:restore', () => restoreStoredAuthSession())
  ipcMain.handle('kernel-auth:signIn', () => startHostedSignIn())
  ipcMain.handle('kernel-auth:save', (_event, payload: unknown) => saveStoredAuthSession(payload))
  ipcMain.handle('kernel-auth:clear', () => clearStoredAuthSession())
  ipcMain.handle('kernel-auth:openExternal', (_event, url: string) => {
    if (!/^https:\/\//u.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//u.test(url)) {
      return { ok: false, error: 'Only HTTPS auth URLs can be opened.' }
    }
    void shell.openExternal(url)
    return { ok: true }
  })
}
