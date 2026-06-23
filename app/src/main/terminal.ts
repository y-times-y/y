import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { spawn, type IPty } from 'node-pty'

type TerminalEvent =
  | { kind: 'data'; id: string; data: string }
  | { kind: 'exit'; id: string; exitCode?: number }
  | { kind: 'error'; id: string; message: string }

type StartTerminalArgs = {
  id?: string
  cwd?: string
  command?: string
  cols?: number
  rows?: number
}

const terminals = new Map<string, IPty>()
const requireFromHere = createRequire(import.meta.url)
const MONET_BIN = join(homedir(), 'Library', 'Application Support', 'Monet', 'bin')
const MACOS_CLI_PATHS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']

function broadcast(event: TerminalEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('terminal:event', event)
  }
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.ComSpec || 'powershell.exe'
  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
  return candidates.find((shell): shell is string => Boolean(shell && existsSync(shell))) || '/bin/sh'
}

function shellArgs(shell: string): string[] {
  if (process.platform === 'win32') return ['-NoLogo']
  const name = shell.split('/').pop() || shell
  if (name === 'zsh' || name === 'bash' || name === 'sh') return ['-l']
  return []
}

function cleanCwd(cwd?: string): string {
  return cwd?.trim() || homedir()
}

function uniquePathEntries(entries: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const clean: string[] = []
  for (const entry of entries) {
    const normalized = entry?.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    clean.push(normalized)
  }
  return clean
}

function terminalPath(): string {
  const basePath = process.env.PATH || ''
  const inherited = basePath.split(delimiter).filter((entry) => entry && entry !== MONET_BIN)
  const preferred = process.platform === 'darwin' ? MACOS_CLI_PATHS : []
  return uniquePathEntries([...preferred, ...inherited]).join(delimiter)
}

function terminalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }

  // Electron-specific process flags can make Node-backed CLIs behave as if
  // they were launched inside Electron instead of a user's normal terminal.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE

  env.PATH = terminalPath()
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.FORCE_COLOR = env.FORCE_COLOR || '1'
  env.CLICOLOR = '1'
  return env
}

function ensureNodePtyHelperExecutable(): void {
  if (process.platform !== 'darwin') return
  try {
    const pkgDir = dirname(requireFromHere.resolve('node-pty/package.json'))
    const helper = join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  } catch {
    // node-pty will surface the real spawn error if this best-effort repair fails.
  }
}

export function registerTerminalBricks(): void {
  ipcMain.handle('terminal:start', (_e, args: StartTerminalArgs = {}) => {
    const id = args.id?.trim() || randomUUID()
    try {
      ensureNodePtyHelperExecutable()
      const shell = defaultShell()
      const pty = spawn(shell, shellArgs(shell), {
        name: 'xterm-256color',
        cwd: cleanCwd(args.cwd),
        cols: args.cols || 96,
        rows: args.rows || 24,
        env: terminalEnv()
      })
      terminals.set(id, pty)
      pty.onData((data) => broadcast({ kind: 'data', id, data }))
      pty.onExit(({ exitCode }) => {
        terminals.delete(id)
        broadcast({ kind: 'exit', id, exitCode })
      })
      const command = args.command?.trim()
      if (command) setTimeout(() => pty.write(command + '\r'), 80)
      return { ok: true, id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('terminal:write', (_e, id: string, data: string) => {
    const pty = terminals.get(id)
    if (!pty) return { ok: false, error: 'No such terminal.' }
    pty.write(data)
    return { ok: true }
  })

  ipcMain.handle('terminal:resize', (_e, id: string, cols: number, rows: number) => {
    const pty = terminals.get(id)
    if (!pty) return { ok: false, error: 'No such terminal.' }
    pty.resize(Math.max(20, cols || 96), Math.max(6, rows || 24))
    return { ok: true }
  })

  ipcMain.handle('terminal:kill', (_e, id: string) => {
    const pty = terminals.get(id)
    if (!pty) return { ok: true }
    pty.kill()
    terminals.delete(id)
    return { ok: true }
  })
}

export function killAllTerminals(): void {
  for (const [id, pty] of terminals) {
    try {
      pty.kill()
    } catch {
      // Already gone.
    }
    terminals.delete(id)
  }
}
