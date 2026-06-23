import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { trackAnalytics } from './analytics'

const execFileAsync = promisify(execFile)

type ToolStatus = {
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

type CliCheckResult = {
  ok: boolean
  checkedAt: string
  tools: ToolStatus[]
}

const AUTH_CREDENTIAL_PATHS: Record<ToolStatus['id'], string[]> = {
  'claude-code': [join(homedir(), '.claude', '.credentials.json')],
  codex: [join(homedir(), '.codex', 'auth.json')]
}

async function hasCredentialFile(id: ToolStatus['id']): Promise<boolean> {
  for (const path of AUTH_CREDENTIAL_PATHS[id]) {
    try {
      await access(path)
      return true
    } catch {
      // try the next candidate path
    }
  }
  return false
}

async function hasKeychainCredential(service: string): Promise<boolean> {
  try {
    await execFileAsync('security', ['find-generic-password', '-s', service], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function isAuthenticated(id: ToolStatus['id']): Promise<boolean> {
  if (id === 'claude-code' && process.platform === 'darwin') {
    return (await hasKeychainCredential('Claude Code-credentials')) || (await hasCredentialFile(id))
  }
  return hasCredentialFile(id)
}

async function checkTool(args: Omit<ToolStatus, 'installed' | 'version' | 'authenticated' | 'error'>): Promise<ToolStatus> {
  try {
    const result = await execFileAsync(args.command, ['--version'], { timeout: 5000 })
    const authenticated = await isAuthenticated(args.id)
    return {
      ...args,
      installed: true,
      version: (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || 'Installed',
      authenticated
    }
  } catch (err) {
    return {
      ...args,
      installed: false,
      authenticated: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export function registerOnboardingBricks(): void {
  ipcMain.handle('onboarding:checkCli', async (): Promise<CliCheckResult> => {
    const startedAt = Date.now()
    await trackAnalytics('onboarding_cli_check_started')
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
    const result = { ok: true, checkedAt: new Date().toISOString(), tools }
    await trackAnalytics('onboarding_cli_check_completed', {
      toolCount: tools.length,
      readyCount: tools.filter((tool) => tool.authenticated).length,
      durationMs: Date.now() - startedAt
    })
    return result
  })
}
