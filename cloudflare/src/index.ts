type D1Statement = {
  bind: (...values: unknown[]) => D1Statement
  run: () => Promise<unknown>
  first: <T = unknown>() => Promise<T | null>
}

type D1Database = {
  prepare: (query: string) => D1Statement
}

type Env = {
  DB: D1Database
}

type JsonObject = Record<string, unknown>
type RateLimitRule = {
  name: string
  windowSeconds: number
  limit: number
}

type RateLimitResult =
  | { ok: true }
  | { ok: false; response: Response }

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

const BRICK_SURFACES = new Set(['main', 'modify'])
const BRICK_CONFIDENCE = new Set(['low', 'medium', 'high'])
const BRICK_ENGINES = new Set(['claude-code', 'codex'])
const ANALYTICS_EVENTS = new Set([
  'onboarding_viewed',
  'onboarding_auth_selected',
  'onboarding_step_completed',
  'onboarding_install_command_copied',
  'onboarding_completed',
  'onboarding_cli_check_started',
  'onboarding_cli_check_completed',
  'auth_gate_viewed',
  'auth_sign_in_started',
  'auth_sign_in_completed',
  'auth_sign_in_failed',
  'auth_signed_out',
  'settings_opened',
  'settings_sign_in_started',
  'settings_sign_in_completed',
  'settings_sign_in_failed',
  'settings_sign_out_completed',
  'settings_sign_out_failed',
  'feedback_dialog_opened',
  'user_active',
  'chat_goal_updated',
  'chat_goal_started',
  'chat_message_sent',
  'chat_reset_to_message',
  'chat_undo_edits',
  'chat_tool_call',
  'chat_turn_completed',
  'chat_turn_error',
  'chat_interrupted',
  'chat_file_diff_opened',
  'modify_opened',
  'modify_closed',
  'modify_new_chat_created',
  'modify_history_opened',
  'modify_history_chat_selected',
  'modify_message_sent',
  'modify_tool_call',
  'modify_turn_completed',
  'modify_turn_error',
  'modify_interrupted',
  'modify_verified',
  'modify_auto_retry',
  'modify_revert_graph_opened',
  'modify_snapshot_restored',
  'modify_reset_original',
  'feedback_dialog_sent',
  'feedback_submitted',
  'missing_brick_detected'
])
const BRICK_REQUEST_KEYS = new Set([
  'id',
  'userId',
  'brick',
  'reason',
  'surface',
  'confidence',
  'engineId'
])
const INGEST_RATE_LIMITS: Record<string, RateLimitRule[]> = {
  feedback: [
    { name: 'feedback-minute', windowSeconds: 60, limit: 3 },
    { name: 'feedback-hour', windowSeconds: 3600, limit: 12 }
  ],
  events: [
    { name: 'events-minute', windowSeconds: 60, limit: 240 },
    { name: 'events-hour', windowSeconds: 3600, limit: 3000 }
  ],
  brickRequests: [
    { name: 'brick-minute', windowSeconds: 60, limit: 12 },
    { name: 'brick-hour', windowSeconds: 3600, limit: 120 }
  ]
}
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) }
  })
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function cleanJson(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return JSON.stringify(value).slice(0, 12000)
}

function cleanIdentifier(value: unknown, maxLength: number): string {
  const input = cleanString(value, maxLength)
  return /^[a-zA-Z0-9._:@-]+$/.test(input) ? input : ''
}

function enumValue(value: unknown, allowed: Set<string>): string {
  const input = cleanString(value, 80)
  return allowed.has(input) ? input : ''
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function rateLimitKey(request: Request, route: string, rule: RateLimitRule): Promise<string> {
  const ip =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  const ua = request.headers.get('user-agent') || 'unknown'
  const clientHash = await sha256(`${ip}\n${ua}`)
  return `v1:${route}:${rule.name}:${clientHash}`
}

function rateLimitResponse(rule: RateLimitRule, retryAfter: number): Response {
  return json(
    { ok: false, error: 'Rate limit exceeded.' },
    {
      status: 429,
      headers: {
        'retry-after': String(retryAfter),
        ratelimit: `${rule.name};r=0;t=${retryAfter}`,
        'ratelimit-policy': `${rule.limit};w=${rule.windowSeconds}`
      }
    }
  )
}

async function consumeRateLimit(env: Env, request: Request, route: keyof typeof INGEST_RATE_LIMITS): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000)
  const rules = INGEST_RATE_LIMITS[route]

  for (const rule of rules) {
    const windowStart = Math.floor(now / rule.windowSeconds) * rule.windowSeconds
    const retryAfter = Math.max(1, windowStart + rule.windowSeconds - now)
    const bucketKey = await rateLimitKey(request, route, rule)
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits
        (bucket_key, window_start, count, expires_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(bucket_key, window_start) DO UPDATE SET
          count = count + 1,
          updated_at = excluded.updated_at
        RETURNING count`
    )
      .bind(bucketKey, windowStart, windowStart + rule.windowSeconds * 2, now)
      .first<{ count: number }>()

    if ((row?.count ?? 1) > rule.limit) return { ok: false, response: rateLimitResponse(rule, retryAfter) }
  }

  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run()
  return { ok: true }
}

async function readJson(request: Request, maxBytes = 64_000): Promise<JsonObject | null> {
  const contentType = request.headers.get('content-type') || ''
  if (!/^application\/json\b/i.test(contentType)) return null
  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength > maxBytes) return null
  try {
    const value = await request.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null
  } catch {
    return null
  }
}

async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  if (!body) return json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 })

  const id = cleanString(body.id, 80) || crypto.randomUUID()
  const message = cleanString(body.message, 6000)
  if (!message) return json({ ok: false, error: 'Missing feedback message.' }, { status: 400 })

  const category = cleanString(body.category, 80) || 'general'
  const createdAt = cleanString(body.timestamp, 80) || new Date().toISOString()
  const appVersion = cleanString(body.appVersion, 80)
  const platform = cleanString(body.platform, 80)
  const userId = cleanString(body.userId, 160)
  const contextJson = cleanJson(body.context)

  await env.DB.prepare(
    `INSERT OR REPLACE INTO feedback
      (id, message, category, context_json, app_version, platform, source, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, 'desktop', ?, ?)`
  )
    .bind(id, message, category, contextJson, appVersion, platform, createdAt, userId)
    .run()

  return json({ ok: true, id })
}

async function handleEvent(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  if (!body) return json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 })

  const name = cleanString(body.event || body.name, 160)
  if (!name) return json({ ok: false, error: 'Missing event name.' }, { status: 400 })
  if (!ANALYTICS_EVENTS.has(name)) return json({ ok: false, error: 'Analytics event is not allowed.' }, { status: 400 })

  const id = cleanString(body.id, 80) || crypto.randomUUID()
  const anonymousId = cleanString(body.anonymousId, 120)
  const userId = cleanString(body.userId, 160)
  const createdAt = cleanString(body.timestamp, 80) || new Date().toISOString()
  const appVersion = cleanString(body.appVersion, 80)
  const platform = cleanString(body.platform, 80)
  const propsJson = cleanJson(body.props)

  await env.DB.prepare(
    `INSERT OR REPLACE INTO events
      (id, name, anonymous_id, user_id, props_json, app_version, platform, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'desktop', ?)`
  )
    .bind(id, name, anonymousId, userId, propsJson, appVersion, platform, createdAt)
    .run()

  return json({ ok: true, id })
}

async function handleBrickRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request, 2048)
  if (!body) return json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 })

  for (const key of Object.keys(body)) {
    if (!BRICK_REQUEST_KEYS.has(key)) {
      return json({ ok: false, error: 'Unexpected field.' }, { status: 400 })
    }
  }

  const brick = enumValue(body.brick, BRICKS)
  const reason = enumValue(body.reason, BRICK_REASONS)
  const surface = enumValue(body.surface, BRICK_SURFACES)
  const confidence = enumValue(body.confidence, BRICK_CONFIDENCE)
  const engineId = body.engineId === undefined ? '' : enumValue(body.engineId, BRICK_ENGINES)
  if (!brick || !reason || !surface || !confidence) {
    return json({ ok: false, error: 'Invalid brick request.' }, { status: 400 })
  }
  if (body.engineId !== undefined && !engineId) {
    return json({ ok: false, error: 'Invalid engine id.' }, { status: 400 })
  }

  const id = cleanIdentifier(body.id, 80) || crypto.randomUUID()
  const userId = cleanIdentifier(body.userId, 160)

  await env.DB.prepare(
    `INSERT OR REPLACE INTO brick_requests
      (id, brick, reason, context_json, source, created_at, user_id, surface, confidence, engine_id)
      VALUES (?, ?, ?, ?, 'model', ?, ?, ?, ?, ?)`
  )
    .bind(id, brick, reason, null, new Date().toISOString(), userId, surface, confidence, engineId)
    .run()

  return json({ ok: true, id })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS })

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('<div>coming soon</div>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      const db = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
      return json({ ok: db?.ok === 1 })
    }

    if (request.method === 'POST' && url.pathname === '/api/feedback') {
      const limited = await consumeRateLimit(env, request, 'feedback')
      if (!limited.ok) return limited.response
      return handleFeedback(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/api/events') {
      const limited = await consumeRateLimit(env, request, 'events')
      if (!limited.ok) return limited.response
      return handleEvent(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/api/brick-requests') {
      const limited = await consumeRateLimit(env, request, 'brickRequests')
      if (!limited.ok) return limited.response
      return handleBrickRequest(request, env)
    }

    return json({ ok: false, error: 'Not found.' }, { status: 404 })
  }
}
