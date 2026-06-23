import { spawn, type SpawnOptions } from 'node:child_process'
import { cliEnv, resolveCliCommand } from './cliEnv'

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

function runCli(command: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let settled = false
    let output = ''
    let child: ReturnType<typeof spawn>
    const options: SpawnOptions = {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
    try {
      child = spawn(command, args, options)
    } catch (err) {
      if (process.platform !== 'win32' && err && typeof err === 'object' && Reflect.get(err, 'code') === 'ENOEXEC') {
        try {
          child = spawn('/bin/zsh', [command, ...args], options)
        } catch (fallbackErr) {
          resolve({ ok: false, output, error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) })
          return
        }
      } else {
        resolve({ ok: false, output, error: err instanceof Error ? err.message : String(err) })
        return
      }
    }
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
  const commandPath = await resolveCliCommand(tool.command)
  if (!commandPath) return { ...tool, installed: false, authenticated: false }

  const version = await runCli(commandPath, ['--version'], 3000)
  const authArgs = tool.id === 'codex' ? ['login', 'status'] : ['auth', 'status']
  const auth = await runCli(commandPath, authArgs, 5000)
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
