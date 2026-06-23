import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { join, resolve, dirname, sep } from 'node:path'
import { mkdir, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises'

// ---- Phase 6: the brick-box ----
// The Kernel hands Userland GENERAL capabilities (network, files, …) instead of
// special-cased features. Each powerful capability is gated by a one-time user
// CONSENT prompt (a native dialog — Userland can't spoof or bypass it). Grants
// persist so we only ask once. This is what lets the user build anything —
// a browser, a file editor, data widgets — without ever touching the Kernel.

type Cap = 'network' | 'files'
type Grant = 'granted' | 'denied'

function permsFile(): string {
  return join(app.getPath('userData'), 'permissions.json')
}

// Userland's private sandbox on disk. The file bricks are locked to this folder;
// paths that try to escape it are rejected — so "file access" can never reach
// the user's real documents or y's own source.
function workspaceDir(): string {
  return join(app.getPath('userData'), 'workspace')
}

let grants: Partial<Record<Cap, Grant>> = {}

async function loadGrants(): Promise<void> {
  try {
    grants = JSON.parse(await readFile(permsFile(), 'utf-8')) as Partial<Record<Cap, Grant>>
  } catch {
    grants = {}
  }
}

async function saveGrants(): Promise<void> {
  try {
    await writeFile(permsFile(), JSON.stringify(grants, null, 2), 'utf-8')
  } catch {
    // Persisting consent is best-effort; a failure just means we re-ask next time.
  }
}

const PROMPTS: Record<Cap, { message: string; detail: string }> = {
  network: {
    message: 'Allow network access?',
    detail:
      'The current y UI wants to make network requests (fetch URLs and APIs ' +
      'through y). Allow this only if you trust the current app customization.'
  },
  files: {
    message: 'Allow file access?',
    detail:
      'The current y UI wants to read and write files in its own private ' +
      'workspace folder. It cannot reach anything outside that folder.'
  }
}

// The gate every capability call passes through. Returns true only if the user
// has granted (now or previously) the capability.
async function ensurePermission(cap: Cap): Promise<boolean> {
  if (grants[cap] === 'granted') return true
  if (grants[cap] === 'denied') return false

  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const p = PROMPTS[cap]
  const { response } = await dialog.showMessageBox(win ?? undefined!, {
    type: 'question',
    buttons: ['Allow', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    title: 'y · permission',
    message: p.message,
    detail: p.detail
  })
  const granted = response === 0
  grants[cap] = granted ? 'granted' : 'denied'
  void saveGrants()
  return granted
}

// Resolve a Userland-supplied relative path INSIDE the workspace, refusing any
// path that escapes it (../.., absolute paths, symlink-ish tricks via resolve).
function resolveInWorkspace(rel: string): string {
  const root = workspaceDir()
  const abs = resolve(root, rel || '.')
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error('Path escapes the workspace')
  }
  return abs
}

async function realWorkspaceRoot(): Promise<string> {
  return realpath(workspaceDir())
}

function assertInsideWorkspace(root: string, target: string): void {
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('Path escapes the workspace')
  }
}

async function resolveExistingWorkspacePath(rel: string): Promise<string> {
  const root = await realWorkspaceRoot()
  const abs = resolveInWorkspace(rel)
  const target = await realpath(abs)
  assertInsideWorkspace(root, target)
  return abs
}

async function resolveWritableWorkspacePath(rel: string): Promise<string> {
  const root = await realWorkspaceRoot()
  const abs = resolveInWorkspace(rel)
  let parent = dirname(abs)
  while (parent !== root && parent.startsWith(root + sep)) {
    try {
      const realParent = await realpath(parent)
      assertInsideWorkspace(root, realParent)
      return abs
    } catch {
      parent = dirname(parent)
    }
  }
  const realParent = await realpath(parent)
  assertInsideWorkspace(root, parent)
  assertInsideWorkspace(root, realParent)
  return abs
}

// Create the workspace folder + load saved grants. Call once at boot.
export async function ensureWorkspace(): Promise<void> {
  await mkdir(workspaceDir(), { recursive: true })
  await loadGrants()
}

// Register all capability bricks. Each is a thin, consent-gated IPC handler.
export function registerCapabilityBricks(): void {
  // ---- Network: a fetch proxied through main (no renderer CSP limits) ----
  ipcMain.handle(
    'net:request',
    async (
      _e,
      req: { url: string; method?: string; headers?: Record<string, string>; body?: string }
    ) => {
      if (!req?.url) return { ok: false, error: 'Missing url' }
      if (!(await ensurePermission('network'))) return { ok: false, error: 'Network permission denied' }
      try {
        const res = await fetch(req.url, {
          method: req.method ?? 'GET',
          headers: req.headers,
          body: req.body
        })
        const headers: Record<string, string> = {}
        res.headers.forEach((v, k) => {
          headers[k] = v
        })
        return { ok: true, status: res.status, headers, body: await res.text() }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ---- Files: read/write scoped to the Userland workspace folder ----
  ipcMain.handle('files:root', () => workspaceDir())

  ipcMain.handle('files:list', async (_e, rel: string) => {
    if (!(await ensurePermission('files'))) return { ok: false, error: 'File permission denied' }
    try {
      const entries = await readdir(await resolveExistingWorkspacePath(rel), { withFileTypes: true })
      return { ok: true, entries: entries.map((d) => ({ name: d.name, dir: d.isDirectory() })) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('files:read', async (_e, rel: string) => {
    if (!(await ensurePermission('files'))) return { ok: false, error: 'File permission denied' }
    try {
      return { ok: true, contents: await readFile(await resolveExistingWorkspacePath(rel), 'utf-8') }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('files:write', async (_e, rel: string, contents: string) => {
    if (!(await ensurePermission('files'))) return { ok: false, error: 'File permission denied' }
    try {
      const abs = await resolveWritableWorkspacePath(rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, contents ?? '', 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('files:mkdir', async (_e, rel: string) => {
    if (!(await ensurePermission('files'))) return { ok: false, error: 'File permission denied' }
    try {
      const abs = resolveInWorkspace(rel)
      await resolveWritableWorkspacePath(rel)
      await mkdir(abs, { recursive: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('files:remove', async (_e, rel: string) => {
    if (!(await ensurePermission('files'))) return { ok: false, error: 'File permission denied' }
    try {
      await rm(await resolveExistingWorkspacePath(rel), { recursive: true, force: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
