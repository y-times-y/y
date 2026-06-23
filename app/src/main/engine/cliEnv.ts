import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MONET_BIN = join(homedir(), 'Library', 'Application Support', 'Monet', 'bin')
const MACOS_CLI_PATHS = [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), '.volta', 'bin'),
  join(homedir(), '.asdf', 'shims'),
  join(homedir(), '.nvm', 'current', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), '.deno', 'bin'),
  join(homedir(), '.cargo', 'bin'),
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  // Last resort only. A home-level node_modules/.bin can contain stale package
  // shims that mask the real globally installed CLI.
  join(homedir(), 'node_modules', '.bin')
]

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

export function cliPath(): string {
  const inherited = (process.env.PATH || '')
    .split(delimiter)
    .filter((entry) => entry && entry !== MONET_BIN)
  const preferred = process.platform === 'darwin' ? MACOS_CLI_PATHS : []
  return uniquePathEntries([...preferred, ...inherited]).join(delimiter)
}

export function cliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: cliPath(),
    ELECTRON_RUN_AS_NODE: undefined,
    ELECTRON_NO_ATTACH_CONSOLE: undefined
  }
}

async function executablePath(path: string): Promise<string | null> {
  try {
    await access(path, constants.X_OK)
    return path
  } catch {
    return null
  }
}

async function shellCommandPath(command: string, interactive: boolean): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    const result = await execFileAsync(
      '/bin/zsh',
      [interactive ? '-lic' : '-lc', `command -v ${command}`],
      { env: cliEnv(), timeout: 5000 }
    )
    const found = result.stdout.trim().split(/\r?\n/u)[0]
    return found ? executablePath(found) : null
  } catch {
    return null
  }
}

export async function resolveCliCommand(command: string): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+$/u.test(command)) return null
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of cliPath().split(delimiter)) {
    for (const ext of extensions) {
      const found = await executablePath(join(dir, command + ext))
      if (found) return found
    }
  }
  return (await shellCommandPath(command, false)) ?? (await shellCommandPath(command, true))
}
