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
  HEXCLAVE_PROJECT_ID?: string
}

type JsonObject = Record<string, unknown>

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
const BRICK_REQUEST_KEYS = new Set([
  'id',
  'userId',
  'brick',
  'reason',
  'surface',
  'confidence',
  'engineId'
])
const DEFAULT_HEXCLAVE_PROJECT_ID = 'eeb236a6-5299-4457-8819-d15a1728ca38'
const HEXCLAVE_HOSTED_HANDLER_SUFFIX = 'built-with-stack-auth.com'
const DESKTOP_AUTH_CALLBACK_URL = 'y://auth-callback?source=hexclave'
const DESKTOP_AUTH_DONE_HTML = `
  <main data-y-desktop-auth-done="true" style="min-height:100vh;display:grid;place-items:center;background:#050505;color:#f4f4f5;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px">
    <section style="width:min(440px,100%);text-align:center">
      <h1 style="margin:0 0 10px;font-size:24px;line-height:1.2;font-weight:700;letter-spacing:0">You're signed in to y.</h1>
      <p style="margin:0;color:rgba(255,255,255,0.58);font-size:14px;line-height:1.55">You can close this page and return to the desktop app.</p>
    </section>
  </main>`

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

async function handleAuthHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const projectId = cleanIdentifier(env.HEXCLAVE_PROJECT_ID, 160) || DEFAULT_HEXCLAVE_PROJECT_ID
  const upstream = new URL(url.pathname + url.search, `https://${projectId}.${HEXCLAVE_HOSTED_HANDLER_SUFFIX}`)

  const headers = new Headers(request.headers)
  headers.set('host', upstream.host)

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  })

  const responseHeaders = new Headers(response.headers)
  const location = responseHeaders.get('location')
  if (location) {
    try {
      const next = new URL(location, upstream)
      if (next.host === upstream.host) {
        next.protocol = url.protocol
        next.host = url.host
        responseHeaders.set('location', next.toString())
      }
    } catch {
      // Leave non-URL locations untouched.
    }
  }
  responseHeaders.delete('content-security-policy')
  responseHeaders.delete('content-security-policy-report-only')

  const contentType = responseHeaders.get('content-type') || ''
  if (url.pathname.startsWith('/handler/') && contentType.includes('text/html')) {
    const source = await response.text()
    const callbackScript = `
<script>
(() => {
  if (!location.pathname.includes('/handler/cli-auth-confirm')) return;
  let opened = false;
  let successLocked = false;
  let desktopDoneRendered = false;
  const originalAuthUrl = location.href;
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  function keepAuthUrl() {
    if (location.href !== originalAuthUrl) originalReplaceState(null, '', originalAuthUrl);
  }
  history.pushState = function(state, title, nextUrl) {
    if (successLocked && nextUrl) {
      keepAuthUrl();
      return;
    }
    return originalPushState(state, title, nextUrl);
  };
  history.replaceState = function(state, title, nextUrl) {
    if (successLocked && nextUrl) {
      keepAuthUrl();
      return;
    }
    return originalReplaceState(state, title, nextUrl);
  };
  function renderDesktopDone() {
    successLocked = true;
    keepAuthUrl();
    if (desktopDoneRendered || document.querySelector('[data-y-desktop-auth-done="true"]')) {
      desktopDoneRendered = true;
      return;
    }
    desktopDoneRendered = true;
    document.body.innerHTML = ${JSON.stringify(DESKTOP_AUTH_DONE_HTML)};
  }
  function removeSecurityWarning() {
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const text = (el.innerText || '').trim();
      const className = typeof el.className === 'string' ? el.className : '';
      if (text === 'SECURITY WARNING' || (text === '' && className.includes('destructive'))) {
        el.remove();
      }
    }
  }
  function maybeOpenY() {
    const text = document.body && document.body.innerText ? document.body.innerText : '';
    if (!successLocked && !/CLI Authorization Successful|CLI Continued Successfully|You're signed in to y|y desktop sign-in complete/i.test(text)) return;
    renderDesktopDone();
    if (!opened) {
      opened = true;
      setTimeout(() => { location.href = ${JSON.stringify(DESKTOP_AUTH_CALLBACK_URL)}; }, 250);
    }
  }
  function removeSuccessButtons() {
    const text = document.body && document.body.innerText ? document.body.innerText : '';
    if (!/CLI Authorization Successful|CLI Continued Successfully|You're signed in to y|y desktop sign-in complete/i.test(text)) return;
    for (const button of Array.from(document.querySelectorAll('button'))) button.remove();
  }
  const timer = setInterval(() => {
    removeSecurityWarning();
    removeSuccessButtons();
    maybeOpenY();
  }, 500);
  new MutationObserver(() => {
    removeSecurityWarning();
    removeSuccessButtons();
    maybeOpenY();
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => {
    removeSecurityWarning();
    maybeOpenY();
  });
})();
</script>`
    responseHeaders.delete('content-length')
    const patchedHtml = source
      .replace('</body>', `${callbackScript}</body>`)
    return new Response(patchedHtml, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    })
  }

  if (url.pathname.startsWith('/assets/') && contentType.includes('application/javascript')) {
    const source = await response.text()
    const patched = source
      .replace(
        /function Z9\(\)\{const t=window\.location\.hostname\.split\("\."\);return t\.length>=2\?t\[0\]:null\}/g,
        `function Z9(){return${JSON.stringify(projectId)}}`
      )
      .replaceAll('Authorize CLI Application', 'Continue to y')
      .replaceAll('Authorize y', 'Continue to y')
      .replaceAll('Authorize', 'Continue')
      .replaceAll('Authorizing...', 'Continuing...')
      .replaceAll(',s.jsx(q,{variant:"destructive",children:t("")})', '')
      .replaceAll('CLI Continued Successfully', "You're signed in to y.")
      .replaceAll('CLI Authorization Successful', 'y desktop sign-in complete')
      .replaceAll('The CLI application has been authorized successfully. You can close this window and return to the command line.', 'y desktop has been signed in. You can close this window and return to the app.')
      .replaceAll('primaryAction:()=>t.redirectToHome(),primaryText:"Go home"', 'primaryAction:void 0,primaryText:void 0')
      .replaceAll('primaryAction:()=>t.redirectToHome(),primaryText:"Go Home"', 'primaryAction:void 0,primaryText:void 0')
      .replaceAll('primaryAction:()=>{try{window.close()}catch(e){}},primaryText:"Close this page"', 'primaryAction:void 0,primaryText:void 0')
      .replaceAll('primaryText:"Go home"', 'primaryText:void 0')
      .replaceAll('primaryText:"Go Home"', 'primaryText:void 0')
      .replaceAll('primaryText:"Close this page"', 'primaryText:void 0')
      .replaceAll('Invalid CLI Authorization Link', 'Invalid y desktop sign-in link')
      .replaceAll('This CLI authorization link is missing a login code. Please return to the command line and start the login process again.', 'This y desktop sign-in link is missing a login code. Return to the y app and start sign-in again.')
      .replaceAll('Completing Authorization...', 'Finishing y desktop sign-in...')
      .replaceAll('Finishing up the CLI authorization...', 'Sending the approved session back to y desktop...')
      .replaceAll(
        'A command line application is requesting access to your account. Clicking authorize will grant a secure access token to the CLI.',
        'Continue to finish signing in to the y desktop app.'
      )
      .replaceAll(
        'A command line application is requesting access to your account. Click the button below to authorize it.',
        'Continue to finish signing in to the y desktop app.'
      )
      .replaceAll(
        'Make sure you trust the command line application, as it will gain access to your account. If you did not initiate this request, please close this page and ignore it.',
        ''
      )
      .replaceAll(
        'WARNING: Make sure you trust the command line application, as it will gain access to your account. If you did not initiate this request, you can close this page and ignore it. We will never send you this link via email or any other means.',
        ''
      )
    responseHeaders.delete('content-length')
    responseHeaders.set('cache-control', 'no-store, max-age=0')
    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    })
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  })
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

    if (url.pathname.startsWith('/handler/') || url.pathname.startsWith('/assets/')) {
      return handleAuthHandler(request, env)
    }

    if (request.method === 'POST' && url.pathname === '/api/feedback') return handleFeedback(request, env)
    if (request.method === 'POST' && url.pathname === '/api/events') return handleEvent(request, env)
    if (request.method === 'POST' && url.pathname === '/api/brick-requests') return handleBrickRequest(request, env)

    return json({ ok: false, error: 'Not found.' }, { status: 404 })
  }
}
