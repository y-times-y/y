import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const MONET_BIN = join(homedir(), 'Library', 'Application Support', 'Monet', 'bin')
const MACOS_CLI_PATHS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']

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
