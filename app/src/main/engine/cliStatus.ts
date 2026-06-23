import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

type CliToolStatus = {
  id: 'claude-code' | 'codex'
  label: string
  command: string
  installed: boolean
  version?: string
  authenticated: boolean
  installCommand: string
  authCommand: string
  docsUrl: string
  error?: string
}

export type CliStatusResult = {
  ok: boolean
  checkedAt: string
  tools: CliToolStatus[]
}

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

function cliPath(): string {
  const inherited = (process.env.PATH || '').split(delimiter).filter((entry) => entry && entry !== MONET_BIN)
  const preferred = process.platform === 'darwin' ? MACOS_CLI_PATHS : []
  return uniquePathEntries([...preferred, ...inherited]).join(delimiter)
}

function cliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: cliPath(),
    ELECTRON_RUN_AS_NODE: undefined,
    ELECTRON_NO_ATTACH_CONSOLE: undefined
  }
}

function commandExists(command: string): boolean {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of cliPath().split(delimiter)) {
    for (const ext of extensions) {
      if (existsSync(join(dir, command + ext))) return true
    }
  }
  return false
}

function runCli(command: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let settled = false
    let output = ''
    const child = spawn(command, args, {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ ok: false, output, error: 'Timed out.' })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, output, error: err.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, output: output.trim() })
    })
  })
}

async function checkTool(tool: Omit<CliToolStatus, 'installed' | 'authenticated' | 'version' | 'error'>): Promise<CliToolStatus> {
  const installed = commandExists(tool.command)
  if (!installed) return { ...tool, installed: false, authenticated: false }

  const version = await runCli(tool.command, ['--version'], 3000)
  const authArgs = tool.id === 'codex' ? ['login', 'status'] : ['auth', 'status']
  const auth = await runCli(tool.command, authArgs, 5000)
  const authText = auth.output.toLowerCase()
  const authenticated = auth.ok && !/(not\\s+(logged|signed)|logged\\s+out|sign\\s+in|required|unauthenticated)/i.test(authText)

  return {
    ...tool,
    installed: true,
    version: version.output.split('\n')[0]?.trim() || undefined,
    authenticated,
    error: authenticated ? undefined : auth.output || auth.error
  }
}

export async function checkCliStatus(): Promise<CliStatusResult> {
  const tools = await Promise.all([
    checkTool({
      id: 'claude-code',
      label: 'Claude Code',
      command: 'claude',
      installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
      authCommand: 'claude auth login',
      docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/quickstart'
    }),
    checkTool({
      id: 'codex',
      label: 'Codex',
      command: 'codex',
      installCommand: 'npm install -g @openai/codex',
      authCommand: 'codex login',
      docsUrl: 'https://github.com/openai/codex'
    })
  ])

  return { ok: true, checkedAt: new Date().toISOString(), tools }
}
