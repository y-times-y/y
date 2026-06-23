import { app, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

type AnalyticsProps = Record<string, unknown>

type AnalyticsIdentity = {
  anonymousId: string
  createdAt: string
  userId?: string
  email?: string
}

type MissingBrickReport = {
  brick: string
  reason: string
  surface: string
  confidence: string
  engineId?: string
}

const SAFE_EVENTS = {
  onboarding_viewed: {},
  onboarding_auth_selected: { source: 'string' },
  onboarding_step_completed: { source: 'string', status: 'string' },
  onboarding_install_command_copied: { label: 'string' },
  onboarding_completed: { cliChecked: 'boolean' },
  onboarding_cli_check_started: {},
  onboarding_cli_check_completed: { toolCount: 'number', readyCount: 'number', durationMs: 'number' },
  auth_gate_viewed: {},
  auth_sign_in_started: { source: 'string' },
  auth_sign_in_completed: { source: 'string' },
  auth_sign_in_failed: { source: 'string' },
  auth_signed_out: { source: 'string' },
  settings_opened: {},
  settings_sign_in_started: {},
  settings_sign_in_completed: {},
  settings_sign_in_failed: {},
  settings_sign_out_completed: {},
  settings_sign_out_failed: {},
  feedback_dialog_opened: { source: 'string' },
  user_active: { surface: 'surface', engineId: 'engine', hasGoal: 'boolean' },
  chat_goal_updated: { engineId: 'engine', hasGoal: 'boolean', source: 'string', status: 'string' },
  chat_goal_started: { engineId: 'engine', promptLength: 'number', status: 'string' },
  chat_message_sent: {
    engineId: 'engine',
    modelId: 'model',
    promptLength: 'number',
    attachmentCount: 'number',
    pastedAttachmentCount: 'number',
    hasGoal: 'boolean',
    firstUserMessage: 'boolean'
  },
  chat_reset_to_message: {},
  chat_undo_edits: {},
  chat_tool_call: { engineId: 'engine', name: 'string', verb: 'string', phase: 'toolPhase', hasTarget: 'boolean' },
  chat_turn_completed: { engineId: 'engine', ok: 'boolean', durationMs: 'number' },
  chat_turn_error: { engineId: 'engine' },
  chat_interrupted: { durationMs: 'number' },
  chat_file_diff_opened: { hasDiff: 'boolean', fileExtension: 'extension' },
  modify_opened: { source: 'string' },
  modify_closed: { source: 'string' },
  modify_new_chat_created: { engineId: 'engine' },
  modify_history_opened: {},
  modify_history_chat_selected: {},
  modify_message_sent: { engineId: 'engine', modelId: 'model', promptLength: 'number', hasGoal: 'boolean' },
  modify_tool_call: { engineId: 'engine', name: 'string', verb: 'string', phase: 'toolPhase', hasTarget: 'boolean' },
  modify_turn_completed: { engineId: 'engine', ok: 'boolean', durationMs: 'number' },
  modify_turn_error: { engineId: 'engine' },
  modify_interrupted: { durationMs: 'number' },
  modify_verified: { durationMs: 'number' },
  modify_auto_retry: { attempt: 'number' },
  modify_revert_graph_opened: {},
  modify_snapshot_restored: {},
  modify_reset_original: {},
  feedback_dialog_sent: { stored: 'stored' },
  feedback_submitted: { stored: 'stored', category: 'string', messageLength: 'number', remoteFailed: 'boolean' },
  missing_brick_detected: { brick: 'brick', reason: 'brickReason', surface: 'surface', confidence: 'confidence', engineId: 'engine' }
} as const satisfies Record<string, Record<string, string>>

const BRICKS = new Set([
  'browser',
  'file_editor',
  'terminal',
  'database',
  'github',
  'figma',
  'web_search',
  'auth',
  'analytics',
  'deployment',
  'unknown'
])

const BRICK_REASONS = new Set([
  'needs_external_page_interaction',
  'needs_project_file_access',
  'needs_shell_execution',
  'needs_remote_repo_context',
  'needs_design_asset_access',
  'needs_live_web_lookup',
  'needs_user_identity',
  'needs_product_event_tracking',
  'needs_hosting_or_release',
  'other'
])

const SURFACES = new Set(['main', 'modify'])
const CONFIDENCE = new Set(['low', 'medium', 'high'])
const STORED = new Set(['remote', 'local'])
const TOOL_PHASES = new Set(['start', 'end'])
const ENGINES = new Set(['claude-code', 'codex'])
const DEFAULT_POSTHOG_PROJECT_API_KEY = 'REMOVED_POSTHOG_PROJECT_API_KEY'
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

let envLoaded = false

function loadLocalEnv(): void {
  if (envLoaded) return
  envLoaded = true
  for (const file of [join(process.cwd(), '.env'), join(process.cwd(), 'app', '.env')]) {
    try {
      const raw = readFileSync(file, 'utf-8')
      for (const line of raw.split(/\r?\n/u)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/u.exec(trimmed)
        if (!match) continue
        const key = match[1]
        if (process.env[key]) continue
        process.env[key] = match[2].replace(/^["']|["']$/gu, '')
      }
    } catch {
      // Try the next candidate path.
    }
  }
}

function envValue(...keys: string[]): string {
  loadLocalEnv()
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

function analyticsDir(): string {
  return join(app.getPath('userData'), 'analytics')
}

function identityFile(): string {
  return join(analyticsDir(), 'identity.json')
}

function eventsFile(): string {
  return join(analyticsDir(), 'events.jsonl')
}

function analyticsEndpoint(): string {
  return (
    envValue('Y_ANALYTICS_URL', 'VITE_Y_ANALYTICS_URL', 'NEXT_PUBLIC_Y_ANALYTICS_URL') ||
    'https://ytimesy.com/api/events'
  ).trim()
}

function brickRequestsEndpoint(): string {
  return (
    envValue('Y_BRICK_REQUESTS_URL', 'VITE_Y_BRICK_REQUESTS_URL', 'NEXT_PUBLIC_Y_BRICK_REQUESTS_URL') ||
    'https://ytimesy.com/api/brick-requests'
  ).trim()
}

function posthogKey(): string {
  return (
    envValue('POSTHOG_PROJECT_API_KEY', 'VITE_POSTHOG_PROJECT_API_KEY', 'NEXT_PUBLIC_POSTHOG_KEY') ||
    DEFAULT_POSTHOG_PROJECT_API_KEY
  )
}

function posthogHost(): string {
  return (
    envValue('POSTHOG_HOST', 'VITE_POSTHOG_HOST', 'NEXT_PUBLIC_POSTHOG_HOST') ||
    DEFAULT_POSTHOG_HOST
  ).replace(/\/+$/u, '')
}

async function readIdentity(): Promise<AnalyticsIdentity> {
  await mkdir(analyticsDir(), { recursive: true })
  try {
    const raw = await readFile(identityFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AnalyticsIdentity>
    if (parsed.anonymousId && parsed.createdAt) return parsed as AnalyticsIdentity
  } catch {
    // Create below.
  }
  const identity = { anonymousId: randomUUID(), createdAt: new Date().toISOString() }
  await writeFile(identityFile(), JSON.stringify(identity, null, 2), 'utf-8')
  return identity
}

export async function getAnalyticsIdentity(): Promise<AnalyticsIdentity> {
  return readIdentity()
}

async function writeIdentity(patch: Partial<AnalyticsIdentity>): Promise<AnalyticsIdentity> {
  const current = await readIdentity()
  const next = { ...current, ...patch }
  await writeFile(identityFile(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().slice(0, maxLength)
  return cleaned || undefined
}

function cleanEmail(value: unknown): string | undefined {
  const email = cleanString(value, 320)
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : undefined
}

function cleanValue(kind: string, value: unknown): unknown {
  if (kind === 'boolean') return typeof value === 'boolean' ? value : undefined
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined
  if (kind === 'string') return cleanString(value, 160)
  if (kind === 'model') return cleanString(value, 120)
  if (kind === 'extension') {
    const ext = cleanString(value, 24)?.toLowerCase()
    return ext && /^[a-z0-9]+$/u.test(ext) ? ext : undefined
  }
  if (kind === 'engine') {
    const engine = cleanString(value, 40)
    return engine && ENGINES.has(engine) ? engine : undefined
  }
  if (kind === 'toolPhase') {
    const phase = cleanString(value, 20)
    return phase && TOOL_PHASES.has(phase) ? phase : undefined
  }
  if (kind === 'stored') {
    const stored = cleanString(value, 20)
    return stored && STORED.has(stored) ? stored : undefined
  }
  if (kind === 'brick') {
    const brick = cleanString(value, 80)
    return brick && BRICKS.has(brick) ? brick : undefined
  }
  if (kind === 'brickReason') {
    const reason = cleanString(value, 120)
    return reason && BRICK_REASONS.has(reason) ? reason : undefined
  }
  if (kind === 'surface') {
    const surface = cleanString(value, 20)
    return surface && SURFACES.has(surface) ? surface : undefined
  }
  if (kind === 'confidence') {
    const confidence = cleanString(value, 20)
    return confidence && CONFIDENCE.has(confidence) ? confidence : undefined
  }
  return undefined
}

function safeEventProps(event: string, props: AnalyticsProps): AnalyticsProps | null {
  const schema = SAFE_EVENTS[event as keyof typeof SAFE_EVENTS]
  if (!schema) return null
  const safe: AnalyticsProps = {}
  for (const [key, kind] of Object.entries(schema)) {
    const value = cleanValue(kind, props[key])
    if (value !== undefined) safe[key] = value
  }
  return safe
}

function safeUrl(url: string): boolean {
  return /^https:\/\//u.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//u.test(url)
}

async function postJson(url: string, body: unknown): Promise<void> {
  if (!safeUrl(url)) return
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function sendPostHog(identity: AnalyticsIdentity, event: string, props: AnalyticsProps, insertId: string): Promise<void> {
  const key = posthogKey()
  if (!key) return
  const distinctId = identity.userId || identity.anonymousId
  await postJson(`${posthogHost()}/capture/`, {
    api_key: key,
    event,
    distinct_id: distinctId,
    properties: {
      ...props,
      $process_person_profile: Boolean(identity.userId),
      $current_url: 'y://desktop/main',
      $screen_name: 'y desktop',
      $lib: 'y-electron-main',
      $insert_id: insertId,
      source: 'desktop',
      app_version: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    },
    timestamp: new Date().toISOString()
  })
}

export async function identifyAnalyticsUser(payload: { userId?: unknown; email?: unknown }): Promise<{ ok: boolean; error?: string }> {
  const userId = cleanString(payload.userId, 160)
  if (!userId) return { ok: false, error: 'Missing analytics user id.' }
  const identity = await writeIdentity({ userId, email: cleanEmail(payload.email) })
  const key = posthogKey()
  if (key) {
    await postJson(`${posthogHost()}/capture/`, {
      api_key: key,
      event: '$identify',
      distinct_id: userId,
      properties: {
        $anon_distinct_id: identity.anonymousId,
        $set: {
          email: identity.email,
          app_version: app.getVersion(),
          platform: process.platform
        }
      }
    }).catch(() => undefined)
  }
  return { ok: true }
}

export async function trackAnalytics(event: string, props: AnalyticsProps = {}): Promise<{ ok: boolean; error?: string }> {
  try {
    const safeProps = safeEventProps(event, props)
    if (!safeProps) return { ok: false, error: 'Analytics event is not allowed.' }
    const identity = await readIdentity()
    const payload = {
      id: randomUUID(),
      event,
      anonymousId: identity.anonymousId,
      userId: identity.userId,
      timestamp: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      props: safeProps
    }
    await appendFile(eventsFile(), `${JSON.stringify(payload)}\n`, 'utf-8')
    await Promise.all([
      sendPostHog(identity, event, safeProps, payload.id).catch(() => undefined),
      analyticsEndpoint() ? postJson(analyticsEndpoint(), payload).catch(() => undefined) : Promise.resolve()
    ])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function reportMissingBrick(report: MissingBrickReport): Promise<{ ok: boolean; error?: string }> {
  const props = safeEventProps('missing_brick_detected', report as AnalyticsProps)
  if (!props) return { ok: false, error: 'Invalid missing brick report.' }
  const tracked = await trackAnalytics('missing_brick_detected', props)
  if (!tracked.ok) return tracked
  const identity = await readIdentity()
  await postJson(brickRequestsEndpoint(), {
    id: randomUUID(),
    userId: identity.userId,
    brick: props.brick,
    reason: props.reason,
    surface: props.surface,
    confidence: props.confidence,
    engineId: props.engineId
  }).catch(() => undefined)
  return { ok: true }
}

export function registerAnalyticsBricks(): void {
  ipcMain.handle('analytics:identify', (_event, payload?: { userId?: unknown; email?: unknown }) =>
    identifyAnalyticsUser(payload ?? {})
  )
  ipcMain.handle('analytics:track', (_event, name: string, props?: AnalyticsProps) => {
    if (!name || typeof name !== 'string') return { ok: false, error: 'Missing analytics event name.' }
    return trackAnalytics(name, props ?? {})
  })
  ipcMain.handle('analytics:reportMissingBrick', (_event, report?: MissingBrickReport) =>
    reportMissingBrick(report ?? { brick: '', reason: '', surface: '', confidence: '' })
  )
}
