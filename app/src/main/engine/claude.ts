import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  ClaudeUtilityCommand,
  EngineCommand,
  EngineCommandResult,
  Engine,
  Session,
  StartOpts
} from './types'
import { formatToolFinal, formatToolStream, type ToolPresentation } from './toolFormat'

// The subset of Claude Code's stream-json output we read. The CLI emits one of
// these JSON objects per line; we only pick out the fields we care about.
interface ClaudeLine {
  type?: string
  subtype?: string
  session_id?: string
  status?: string
  hook_id?: string
  hook_name?: string
  hook_event?: string
  outcome?: string
  output?: string
  stdout?: string
  stderr?: string
  exit_code?: number
  text?: string
  prompt?: string
  suggestion?: string
  slash_commands?: string[]
  is_error?: boolean
  result?: unknown
  event?: ClaudeStreamEvent
  message?: {
    content?: Array<{
      type?: string
      text?: string
      thinking?: string
      name?: string
      id?: string
      input?: Record<string, unknown>
      tool_use_id?: string
      content?: string | Array<{ type?: string; text?: string }>
      is_error?: boolean
    }>
  }
}

interface ClaudeStreamEvent {
  type?: string
  index?: number
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
  content_block?: { type?: string; name?: string; id?: string; input?: Record<string, unknown> }
}

interface ToolBlock {
  id?: string
  name: string
  json: string
}

const CLAUDE_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'auto',
  'plan',
  'dontAsk',
  'bypassPermissions'
])
const MAX_HOOK_DETAIL_CHARS = 1800

function trimHookDetail(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_HOOK_DETAIL_CHARS) return trimmed
  return trimmed.slice(0, MAX_HOOK_DETAIL_CHARS) + '\n…'
}

function splitList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function splitArgs(value: string | undefined): string[] {
  const input = value?.trim()
  if (!input) return []
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false
  for (const ch of input) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }
    if (ch === '\\') {
      escaping = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

function safeToolSet(mode: StartOpts['mode']): string {
  return mode === 'write' ? 'Read,Glob,Grep,Edit,Write,Bash' : 'Read,Glob,Grep'
}

function commandSource(name: string): string {
  const bare = name.replace(/^\//, '')
  const colon = bare.indexOf(':')
  return colon > 0 ? bare.slice(0, colon) : 'Claude'
}

function commandItems(names: unknown): Array<{ name: string; source?: string }> {
  if (!Array.isArray(names)) return []
  return names
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((raw) => {
      const name = raw.startsWith('/') ? raw : `/${raw}`
      return { name, source: commandSource(name) }
    })
}

function claudeUtilityCommandArgs(command: string): string[] | null {
  switch (command) {
    case 'doctor':
      return ['doctor']
    case 'agents':
      return ['agents', '--json']
    case 'authStatus':
      return ['auth', 'status']
    case 'authLogin':
      return ['auth', 'login']
    case 'authLogout':
      return ['auth', 'logout']
    case 'projectPurge':
      return ['project', 'purge']
    case 'autoModeConfig':
      return ['auto-mode', 'config']
    case 'autoModeDefaults':
      return ['auto-mode', 'defaults']
    case 'autoModeCritique':
      return ['auto-mode', 'critique']
    case 'pluginList':
      return ['plugin', 'list']
    case 'pluginDetails':
      return ['plugin', 'details']
    case 'pluginValidate':
      return ['plugin', 'validate']
    case 'pluginInstall':
      return ['plugin', 'install']
    case 'pluginEnable':
      return ['plugin', 'enable']
    case 'pluginDisable':
      return ['plugin', 'disable']
    case 'pluginUninstall':
      return ['plugin', 'uninstall']
    case 'pluginUpdate':
      return ['plugin', 'update']
    case 'pluginPrune':
      return ['plugin', 'prune']
    case 'pluginTag':
      return ['plugin', 'tag']
    case 'pluginInit':
      return ['plugin', 'init']
    case 'pluginMarketplaceList':
      return ['plugin', 'marketplace', 'list']
    case 'pluginMarketplaceAdd':
      return ['plugin', 'marketplace', 'add']
    case 'pluginMarketplaceRemove':
      return ['plugin', 'marketplace', 'remove']
    case 'pluginMarketplaceUpdate':
      return ['plugin', 'marketplace', 'update']
    case 'mcpList':
      return ['mcp', 'list']
    case 'mcpGet':
      return ['mcp', 'get']
    case 'mcpAdd':
      return ['mcp', 'add']
    case 'mcpAddJson':
      return ['mcp', 'add-json']
    case 'mcpRemove':
      return ['mcp', 'remove']
    case 'mcpServe':
      return ['mcp', 'serve']
    case 'mcpResetProjectChoices':
      return ['mcp', 'reset-project-choices']
    default:
      return null
  }
}

// Drives the official `claude` CLI in non-interactive streaming mode. Each turn
// is ONE short-lived process; we remember the engine's session id so the next
// turn continues the same conversation via --resume.
class ClaudeSession implements Session {
  readonly id = randomUUID() // OUR id — routes IPC events back to this chat
  private claudeSessionId: string | null = null // claude's id — for --resume
  private child: ChildProcess | null = null
  private cancelled = false
  private streamedText = false // did we already stream deltas this turn?
  private pendingResult: Extract<AgentEvent, { kind: 'result' }> | null = null
  private pendingSteer: string | null = null
  private blocks = new Map<number, ToolBlock>() // in-flight tool_use blocks by index
  private streamedToolIds = new Set<string>() // IDs of tools finalized via streaming
  private toolPresentations = new Map<string, { name: string; presentation: ToolPresentation }>()

  constructor(
    private opts: StartOpts,
    private emit: (event: AgentEvent) => void
  ) {}

  send(prompt: string): void {
    // One turn at a time keeps the model simple for now.
    if (this.child) {
      this.emit({ kind: 'error', message: 'A turn is already running.' })
      return
    }
    const command = this.opts.options?.claudeCommand ?? 'chat'
    if (command === 'ultrareview') {
      this.runTextCommand(this.buildUltrareviewArgs())
      return
    }
    if (command === 'agents') {
      this.runTextCommand(this.buildAgentsArgs())
      return
    }
    if (command === 'utility') {
      const args = this.buildUtilityArgs()
      if (!args) {
        this.emit({ kind: 'error', message: 'Choose a Claude utility command.' })
        return
      }
      this.runTextCommand(args)
      return
    }
    this.streamedText = false
    this.cancelled = false
    this.pendingResult = null
    this.blocks.clear()
    this.streamedToolIds.clear()

    // Native main chat leaves tool selection to Claude Code. Kernel-scoped
    // surfaces opt into safe/custom modes explicitly.
    const toolMode = this.opts.options?.claudeToolMode ?? (this.opts.mode === 'native' ? undefined : 'safe')
    const safeTools = safeToolSet(this.opts.mode)
    const requestedTools = trimValue(this.opts.options?.claudeTools)
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages', // token-by-token streaming
      '--verbose' // required alongside stream-json with -p
    ]
    if (toolMode === 'default') {
      args.push('--tools', 'default')
    } else if (toolMode) {
      const tools = toolMode === 'custom' && requestedTools ? requestedTools : safeTools
      args.push('--tools', tools)
      if (toolMode === 'safe') args.push('--allowedTools', tools)
    }
    for (const tool of splitList(this.opts.options?.claudeAllowedTools)) {
      args.push('--allowedTools', tool)
    }
    for (const tool of splitList(this.opts.options?.claudeDisallowedTools)) {
      args.push('--disallowedTools', tool)
    }
    if (this.opts.model) args.push('--model', this.opts.model)
    if (this.opts.effort) args.push('--effort', this.opts.effort)
    if (this.opts.options?.ephemeral) args.push('--no-session-persistence')
    if (trimValue(this.opts.options?.sessionName)) args.push('--name', trimValue(this.opts.options?.sessionName)!)
    if (this.opts.options?.claudePromptSuggestions) args.push('--prompt-suggestions', 'true')
    if (this.opts.options?.claudeHookEvents) args.push('--include-hook-events')
    if (this.opts.options?.claudeBrief) args.push('--brief')
    if (trimValue(this.opts.options?.claudeAgent)) args.push('--agent', trimValue(this.opts.options?.claudeAgent)!)
    if (trimValue(this.opts.options?.claudeSystemPrompt)) {
      args.push('--system-prompt', trimValue(this.opts.options?.claudeSystemPrompt)!)
    }
    if (trimValue(this.opts.options?.claudeSystemPromptFile)) {
      args.push('--system-prompt-file', trimValue(this.opts.options?.claudeSystemPromptFile)!)
    }
    if (trimValue(this.opts.options?.claudeAppendSystemPrompt)) {
      args.push('--append-system-prompt', trimValue(this.opts.options?.claudeAppendSystemPrompt)!)
    }
    if (trimValue(this.opts.options?.claudeAppendSystemPromptFile)) {
      args.push('--append-system-prompt-file', trimValue(this.opts.options?.claudeAppendSystemPromptFile)!)
    }
    if (trimValue(this.opts.options?.claudeFallbackModel)) {
      args.push('--fallback-model', trimValue(this.opts.options?.claudeFallbackModel)!)
    }
    if (trimValue(this.opts.options?.claudeMaxBudgetUsd)) {
      args.push('--max-budget-usd', trimValue(this.opts.options?.claudeMaxBudgetUsd)!)
    }
    if (this.opts.options?.claudeExcludeDynamicSystemPrompt) {
      args.push('--exclude-dynamic-system-prompt-sections')
    }
    if (this.opts.options?.claudeDisableSlashCommands) args.push('--disable-slash-commands')
    if (trimValue(this.opts.options?.claudeSettingSources)) {
      args.push('--setting-sources', trimValue(this.opts.options?.claudeSettingSources)!)
    }
    for (const dir of splitList(this.opts.options?.claudeAddDirs)) args.push('--add-dir', dir)
    for (const dir of splitList(this.opts.options?.claudePluginDirs)) args.push('--plugin-dir', dir)
    for (const url of splitList(this.opts.options?.claudePluginUrls)) args.push('--plugin-url', url)
    for (const config of splitList(this.opts.options?.claudeMcpConfigs)) args.push('--mcp-config', config)
    if (this.opts.options?.claudeStrictMcpConfig) args.push('--strict-mcp-config')
    for (const file of splitList(this.opts.options?.claudeFiles)) args.push('--file', file)
    if (trimValue(this.opts.options?.claudeJsonSchema)) {
      args.push('--json-schema', trimValue(this.opts.options?.claudeJsonSchema)!)
    }
    if (this.opts.options?.claudeBare) args.push('--bare')
    if (this.opts.options?.claudeIde) args.push('--ide')
    if (this.opts.options?.claudeChrome === 'enabled') args.push('--chrome')
    if (this.opts.options?.claudeChrome === 'disabled') args.push('--no-chrome')
    if (trimValue(this.opts.options?.claudeRemoteControlName)) {
      args.push('--remote-control', trimValue(this.opts.options?.claudeRemoteControlName)!)
    }
    if (trimValue(this.opts.options?.claudeRemoteControlPrefix)) {
      args.push('--remote-control-session-name-prefix', trimValue(this.opts.options?.claudeRemoteControlPrefix)!)
    }
    if (trimValue(this.opts.options?.claudeWorktreeName)) {
      args.push('--worktree', trimValue(this.opts.options?.claudeWorktreeName)!)
    }
    if (this.opts.options?.claudeTmux === 'default') args.push('--tmux')
    if (this.opts.options?.claudeTmux === 'classic') args.push('--tmux=classic')
    if (this.opts.options?.claudeForkSession) args.push('--fork-session')
    if (trimValue(this.opts.options?.claudeSessionId)) {
      args.push('--session-id', trimValue(this.opts.options?.claudeSessionId)!)
    }
    for (const beta of splitList(this.opts.options?.claudeBetas)) args.push('--betas', beta)
    if (trimValue(this.opts.options?.claudeSettings)) {
      args.push('--settings', trimValue(this.opts.options?.claudeSettings)!)
    }
    if (trimValue(this.opts.options?.claudeAgentsJson)) {
      args.push('--agents', trimValue(this.opts.options?.claudeAgentsJson)!)
    }
    if (this.opts.options?.claudeDebug !== undefined) {
      const debug = trimValue(this.opts.options.claudeDebug)
      args.push(debug ? '--debug=' + debug : '--debug')
    }
    if (trimValue(this.opts.options?.claudeDebugFile)) {
      args.push('--debug-file', trimValue(this.opts.options?.claudeDebugFile)!)
    }
    const permissionMode = this.opts.options?.claudePermissionMode
    if (permissionMode && CLAUDE_PERMISSION_MODES.has(permissionMode)) {
      args.push('--permission-mode', permissionMode)
    }
    if (this.opts.options?.claudeAllowDangerouslySkipPermissions) {
      args.push('--allow-dangerously-skip-permissions')
    }
    if (this.opts.options?.claudeDangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions')
    }
    if (this.claudeSessionId) {
      args.push('--resume', this.claudeSessionId)
    } else {
      const initialResume = this.opts.options?.claudeInitialResume ?? 'new'
      if (initialResume === 'continue') args.push('--continue')
      if (initialResume === 'resume' && trimValue(this.opts.options?.claudeResumeId)) {
        args.push('--resume', trimValue(this.opts.options?.claudeResumeId)!)
      }
      if (initialResume === 'fromPr') {
        args.push('--from-pr')
        const pr = trimValue(this.opts.options?.claudeFromPr)
        if (pr) args.push(pr)
      }
    }

    const child = spawn('claude', args, {
      cwd: this.opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

    // stream-json is newline-delimited JSON. A single read can contain partial
    // lines, so buffer and split on '\n'.
    let buf = ''
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) this.handleLine(line)
      }
    })

    let stderr = ''
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => (stderr += chunk))

    child.on('error', (err) => {
      this.child = null
      if (this.cancelled) return
      this.emit({ kind: 'error', message: `Failed to start claude: ${err.message}` })
    })

    child.on('close', (code) => {
      const wasCancelled = this.cancelled
      const pendingSteer = this.pendingSteer
      this.cancelled = false
      this.pendingSteer = null
      this.child = null
      this.blocks.clear()
      if (wasCancelled) {
        if (pendingSteer) this.send(pendingSteer)
        return
      }
      if (this.pendingResult) {
        const result = this.pendingResult
        this.pendingResult = null
        this.emit(result)
      } else if (code !== 0 && code !== null) {
        this.emit({ kind: 'error', message: stderr.trim() || `claude exited with code ${code}` })
      }
    })
  }

  command(command: EngineCommand): EngineCommandResult {
    if (command.name === 'steer') {
      const text = command.value.trim()
      if (!text) return { ok: false, error: 'Steering text is required.' }
      if (!this.child) return { ok: false, error: 'No Claude turn is currently running.' }
      this.pendingSteer = text
      this.cancelled = true
      this.child.kill('SIGTERM')
      return { ok: true, message: 'Steering Claude after the completed tool call.' }
    }
    if (this.child) return { ok: false, error: 'A turn is already running.' }
    if (command.name === 'compact') {
      this.send('/compact')
      return { ok: true, message: 'Compacting Claude context.' }
    }
    if (command.name === 'clear') {
      this.send('/clear')
      return { ok: true, message: 'Clearing Claude context.' }
    }
    if (command.name === 'rollback') {
      return { ok: false, error: 'Claude Code does not expose thread rollback through the current non-interactive CLI session.' }
    }
    if (command.name === 'goal') {
      return { ok: false, error: 'Claude Code does not expose a native persistent goal command through the current CLI adapter.' }
    }
    if (command.name === 'inventory') {
      if (command.target === 'plugins') {
        this.runTextCommand(['plugin', 'list'])
        return { ok: true, message: 'Listing installed Claude plugins.' }
      }
      if (command.target === 'mcp') {
        this.runTextCommand(['mcp', 'list'])
        return { ok: true, message: 'Listing Claude MCP servers.' }
      }
      return {
        ok: true,
        message:
          'Claude exposes skills as slash commands. Open / to see the commands reported by this session.'
      }
    }
    if (command.name === 'utility') {
      const args = claudeUtilityCommandArgs(command.command)
      if (!args) return { ok: false, error: `Claude Code does not expose /${command.command} through y.` }
      this.runTextCommand(args.concat(splitArgs(command.args)))
      return { ok: true, message: `Running claude ${args.join(' ')}.` }
    }
    if (command.name === 'slash') {
      const value = command.value.trim()
      if (!value.startsWith('/')) return { ok: false, error: 'Slash command must start with /.' }
      this.send(value)
      return { ok: true, message: `Running ${value}.` }
    }
    if (command.name === 'update') {
      this.runTextCommand(['update'])
      return { ok: true, message: 'Checking Claude Code for updates.' }
    }
    return { ok: false, error: 'Unsupported Claude command.' }
  }

  private runTextCommand(args: string[]): void {
    const label = args.slice(0, 3).join(' ')
    this.emit({ kind: 'status', status: args[0] === 'agents' ? 'loading agents' : `running ${label}` })
    this.cancelled = false
    const child = spawn('claude', args, {
      cwd: this.opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => (stdout += chunk))
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (err) => {
      this.child = null
      if (this.cancelled) return
      this.emit({ kind: 'error', message: `Failed to start claude: ${err.message}` })
    })
    child.on('close', (code) => {
      const wasCancelled = this.cancelled
      this.cancelled = false
      this.child = null
      if (wasCancelled) return
      const out = stdout.trim()
      if (out) this.emit({ kind: 'text', text: out })
      if (code === 0 || code === null) {
        this.emit({ kind: 'result', ok: true })
      } else {
        this.emit({ kind: 'result', ok: false, summary: stderr.trim() || `claude exited with code ${code}` })
      }
    })
  }

  private appendUtilityCommon(args: string[]): void {
    for (const raw of splitArgs(this.opts.options?.claudeUtilityRawArgs)) args.push(raw)
  }

  private appendScope(args: string[]): void {
    const scope = this.opts.options?.claudeUtilityScope
    if (scope && scope !== 'auto') args.push('--scope', scope)
  }

  private buildUtilityArgs(): string[] | null {
    const command = this.opts.options?.claudeUtilityCommand
    if (!command) return null
    const target = trimValue(this.opts.options?.claudeUtilityTarget)
    const path = trimValue(this.opts.options?.claudeUtilityPath)
    const args = this.utilityBaseArgs(command)
    if (!args) return null

    switch (command) {
      case 'autoModeCritique':
        if (this.opts.model) args.push('--model', this.opts.model)
        break
      case 'authStatus':
        if (this.opts.options?.claudeUtilityJson) args.push('--json')
        break
      case 'install':
        if (this.opts.options?.claudeUtilityForce) args.push('--force')
        if (target) args.push(target)
        break
      case 'projectPurge':
        if (this.opts.options?.claudeUtilityAll) args.push('--all')
        if (this.opts.options?.claudeUtilityDryRun) args.push('--dry-run')
        if (this.opts.options?.claudeUtilityInteractive) args.push('--interactive')
        if (this.opts.options?.claudeUtilityYes) args.push('--yes')
        if (!this.opts.options?.claudeUtilityAll && path) args.push(path)
        break
      case 'pluginList':
        if (this.opts.options?.claudeUtilityJson) args.push('--json')
        if (this.opts.options?.claudeUtilityAvailable) args.push('--available')
        break
      case 'pluginValidate':
        if (this.opts.options?.claudeUtilityStrict) args.push('--strict')
        if (path) args.push(path)
        break
      case 'pluginInstall':
        this.appendScope(args)
        for (const config of splitList(this.opts.options?.claudeUtilityConfig)) args.push('--config', config)
        if (target) args.push(target)
        break
      case 'pluginEnable':
      case 'pluginDisable':
        this.appendScope(args)
        if (this.opts.options?.claudeUtilityAll && command === 'pluginDisable') args.push('--all')
        if (target) args.push(target)
        break
      case 'pluginDetails':
      case 'pluginUninstall':
      case 'pluginUpdate':
      case 'pluginInit':
      case 'pluginMarketplaceAdd':
      case 'pluginMarketplaceRemove':
      case 'pluginMarketplaceUpdate':
        if (target) args.push(target)
        break
      case 'pluginTag':
        if (path) args.push(path)
        break
      case 'mcpGet':
      case 'mcpRemove':
        if (command === 'mcpRemove') this.appendScope(args)
        if (target) args.push(target)
        break
      case 'mcpAdd': {
        this.appendScope(args)
        const transport = this.opts.options?.claudeUtilityTransport
        if (transport) args.push('--transport', transport)
        for (const env of splitList(this.opts.options?.claudeUtilityEnv)) args.push('--env', env)
        for (const header of splitList(this.opts.options?.claudeUtilityHeaders)) args.push('--header', header)
        if (trimValue(this.opts.options?.claudeUtilityClientId)) {
          args.push('--client-id', trimValue(this.opts.options?.claudeUtilityClientId)!)
        }
        if (this.opts.options?.claudeUtilityClientSecret) args.push('--client-secret')
        if (trimValue(this.opts.options?.claudeUtilityCallbackPort)) {
          args.push('--callback-port', trimValue(this.opts.options?.claudeUtilityCallbackPort)!)
        }
        if (target) args.push(target)
        const commandOrUrl = trimValue(this.opts.options?.claudeUtilityCommandOrUrl)
        const serverArgs = splitArgs(this.opts.options?.claudeUtilityArgs)
        if (commandOrUrl) {
          if (serverArgs.length > 0 || commandOrUrl.startsWith('-')) args.push('--')
          args.push(commandOrUrl)
        }
        for (const arg of serverArgs) args.push(arg)
        break
      }
      case 'mcpAddJson':
        this.appendScope(args)
        if (this.opts.options?.claudeUtilityClientSecret) args.push('--client-secret')
        if (target) args.push(target)
        if (trimValue(this.opts.options?.claudeUtilityConfig)) args.push(trimValue(this.opts.options?.claudeUtilityConfig)!)
        break
    }
    this.appendUtilityCommon(args)
    return args
  }

  private utilityBaseArgs(command: ClaudeUtilityCommand): string[] | null {
    switch (command) {
      case 'doctor':
        return ['doctor']
      case 'autoModeConfig':
        return ['auto-mode', 'config']
      case 'autoModeDefaults':
        return ['auto-mode', 'defaults']
      case 'autoModeCritique':
        return ['auto-mode', 'critique']
      case 'authStatus':
        return ['auth', 'status']
      case 'authLogin':
        return ['auth', 'login']
      case 'authLogout':
        return ['auth', 'logout']
      case 'setupToken':
        return ['setup-token']
      case 'install':
        return ['install']
      case 'update':
        return ['update']
      case 'projectPurge':
        return ['project', 'purge']
      case 'pluginList':
        return ['plugin', 'list']
      case 'pluginDetails':
        return ['plugin', 'details']
      case 'pluginValidate':
        return ['plugin', 'validate']
      case 'pluginInstall':
        return ['plugin', 'install']
      case 'pluginEnable':
        return ['plugin', 'enable']
      case 'pluginDisable':
        return ['plugin', 'disable']
      case 'pluginUninstall':
        return ['plugin', 'uninstall']
      case 'pluginUpdate':
        return ['plugin', 'update']
      case 'pluginPrune':
        return ['plugin', 'prune']
      case 'pluginTag':
        return ['plugin', 'tag']
      case 'pluginInit':
        return ['plugin', 'init']
      case 'pluginMarketplaceList':
        return ['plugin', 'marketplace', 'list']
      case 'pluginMarketplaceAdd':
        return ['plugin', 'marketplace', 'add']
      case 'pluginMarketplaceRemove':
        return ['plugin', 'marketplace', 'remove']
      case 'pluginMarketplaceUpdate':
        return ['plugin', 'marketplace', 'update']
      case 'mcpList':
        return ['mcp', 'list']
      case 'mcpGet':
        return ['mcp', 'get']
      case 'mcpAdd':
        return ['mcp', 'add']
      case 'mcpAddJson':
        return ['mcp', 'add-json']
      case 'mcpRemove':
        return ['mcp', 'remove']
      case 'mcpServe':
        return ['mcp', 'serve']
      case 'mcpResetProjectChoices':
        return ['mcp', 'reset-project-choices']
    }
  }

  private buildUltrareviewArgs(): string[] {
    const args = ['ultrareview']
    const target = trimValue(this.opts.options?.claudeUltrareviewTarget)
    if (target) args.push(target)
    if (this.opts.options?.claudeUltrareviewJson) args.push('--json')
    const timeout = trimValue(this.opts.options?.claudeUltrareviewTimeoutMinutes)
    if (timeout) args.push('--timeout', timeout)
    return args
  }

  private buildAgentsArgs(): string[] {
    const args = ['agents', '--json']
    if (this.opts.model) args.push('--model', this.opts.model)
    if (this.opts.effort) args.push('--effort', this.opts.effort)
    if (trimValue(this.opts.options?.claudeAgent)) args.push('--agent', trimValue(this.opts.options?.claudeAgent)!)
    const permissionMode = this.opts.options?.claudePermissionMode
    if (permissionMode && CLAUDE_PERMISSION_MODES.has(permissionMode)) {
      args.push('--permission-mode', permissionMode)
    }
    if (this.opts.options?.claudeAllowDangerouslySkipPermissions) {
      args.push('--allow-dangerously-skip-permissions')
    }
    if (trimValue(this.opts.options?.claudeSettings)) {
      args.push('--settings', trimValue(this.opts.options?.claudeSettings)!)
    }
    if (trimValue(this.opts.options?.claudeSettingSources)) {
      args.push('--setting-sources', trimValue(this.opts.options?.claudeSettingSources)!)
    }
    for (const dir of splitList(this.opts.options?.claudeAddDirs)) args.push('--add-dir', dir)
    for (const dir of splitList(this.opts.options?.claudePluginDirs)) args.push('--plugin-dir', dir)
    for (const url of splitList(this.opts.options?.claudePluginUrls)) args.push('--plugin-url', url)
    for (const config of splitList(this.opts.options?.claudeMcpConfigs)) args.push('--mcp-config', config)
    if (this.opts.options?.claudeStrictMcpConfig) args.push('--strict-mcp-config')
    return args
  }

  cancel(): void {
    this.pendingSteer = null
    if (this.child) this.cancelled = true
    this.child?.kill('SIGTERM')
    this.child = null
    this.pendingResult = null
    this.blocks.clear()
  }

  private handleLine(line: string): void {
    let obj: ClaudeLine
    try {
      obj = JSON.parse(line) as ClaudeLine
    } catch {
      return // ignore any non-JSON noise
    }

    if (typeof obj.session_id === 'string') this.claudeSessionId = obj.session_id

    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init' && obj.session_id) {
          this.emit({ kind: 'session', sessionId: obj.session_id })
          if (Array.isArray(obj.slash_commands)) {
            this.emit({
              kind: 'commands',
              commands: commandItems(obj.slash_commands)
            })
          }
        } else if (obj.subtype === 'status' && obj.status) {
          this.emit({ kind: 'status', status: obj.status })
        } else if (obj.subtype === 'hook_started') {
          this.emit({
            kind: 'tool',
            name: 'hook',
            id: obj.hook_id,
            phase: 'start',
            verb: 'hook',
            target: obj.hook_name || obj.hook_event
          })
        } else if (obj.subtype === 'hook_response') {
          const detail = [obj.output, obj.stdout, obj.stderr]
            .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
            .join('\n')
          this.emit({
            kind: 'tool',
            name: 'hook',
            id: obj.hook_id,
            phase: 'end',
            verb: obj.outcome === 'success' ? 'hook' : 'hook error',
            target: obj.hook_name || obj.hook_event,
            body: detail
              ? trimHookDetail(detail)
              : typeof obj.exit_code === 'number'
                ? `exit ${obj.exit_code}`
                : undefined
          })
        }
        break
      case 'stream_event':
        if (obj.event) this.handleStreamEvent(obj.event)
        break
      case 'assistant':
        // Always surface tool_use from the full assistant message — it has the
        // complete input even when stream-json redacts thinking or we miss deltas.
        this.emitAssistantTools(obj.message)
        if (!this.streamedText) this.emitAssistantText(obj.message)
        break
      case 'user':
        this.emitToolResults(obj.message)
        break
      case 'prompt_suggestion': {
        const suggestion = obj.text || obj.prompt || obj.suggestion
        if (typeof suggestion === 'string' && suggestion.trim()) {
          this.emit({ kind: 'suggestion', text: suggestion.trim() })
        }
        break
      }
      case 'result':
        this.pendingResult = {
          kind: 'result',
          ok: obj.is_error !== true,
          summary: typeof obj.result === 'string' ? obj.result : undefined
        }
        break
    }
  }

  private handleStreamEvent(ev: ClaudeStreamEvent): void {
    const idx = ev.index
    if (ev.type === 'content_block_delta') {
      const d = ev.delta
      if (d?.type === 'text_delta' && typeof d.text === 'string') {
        this.streamedText = true
        this.emit({ kind: 'text', text: d.text })
      } else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string' && d.thinking) {
        // Claude Code redacts extended thinking in stream-json — skip empty deltas.
        this.emit({ kind: 'thinking', text: d.thinking })
      } else if (
        d?.type === 'input_json_delta' &&
        typeof d.partial_json === 'string' &&
        typeof idx === 'number'
      ) {
        this.updateToolInput(idx, d.partial_json, 'update')
      }
    } else if (ev.type === 'content_block_start') {
      const block = ev.content_block
      if (block?.type === 'tool_use' && typeof block.name === 'string' && typeof idx === 'number') {
        const seed =
          block.input && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : ''
        this.blocks.set(idx, { id: block.id, name: block.name, json: seed })
        this.emitTool(block.name, block.id, 'start', formatToolStream(block.name, seed))
      } else if (block?.type === 'text' && this.streamedText) {
        // Claude sends its between-tool narration as separate text blocks. Insert a
        // paragraph break so they don't render as one run-on line in the chat.
        this.emit({ kind: 'text', text: '\n\n' })
      }
    } else if (ev.type === 'content_block_stop' && typeof idx === 'number') {
      this.finishToolBlock(idx)
    }
  }

  private emitTool(
    name: string,
    id: string | undefined,
    phase: 'start' | 'update' | 'end',
    presentation: ToolPresentation
  ): void {
    if (id) this.toolPresentations.set(id, { name, presentation })
    this.emit({ kind: 'tool', name, id, phase, ...presentation })
  }

  private emitToolResults(message: ClaudeLine['message']): void {
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (block?.type !== 'tool_result' || !block.tool_use_id) continue
      const previous = this.toolPresentations.get(block.tool_use_id)
      if (!previous) continue
      const verb = previous.presentation.verb.toLowerCase()
      if (verb === 'edit' || verb === 'write') continue
      const body = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((part) => part?.text).filter((text): text is string => typeof text === 'string').join('\n')
          : undefined
      this.emit({
        kind: 'tool',
        name: previous.name,
        id: block.tool_use_id,
        phase: 'end',
        ...previous.presentation,
        body: body?.trim() || (block.is_error ? 'Tool failed.' : undefined)
      })
    }
  }

  private updateToolInput(index: number, chunk: string, phase: 'update' | 'end'): void {
    const block = this.blocks.get(index)
    if (!block) return
    block.json += chunk
    const presentation =
      phase === 'end' ? formatToolFinal(block.name, block.json) : formatToolStream(block.name, block.json)
    this.emitTool(block.name, block.id, phase, presentation)
  }

  private finishToolBlock(index: number): void {
    if (!this.blocks.has(index)) return
    const block = this.blocks.get(index)!
    if (block.id) this.streamedToolIds.add(block.id)
    this.updateToolInput(index, '', 'end')
    this.blocks.delete(index)
  }

  private emitAssistantText(message: ClaudeLine['message']): void {
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        this.emit({ kind: 'text', text: block.text })
      }
    }
  }

  private emitAssistantTools(message: ClaudeLine['message']): void {
    const content = message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue
      // Skip tools that were already emitted via streaming — prevents duplicate entries.
      if (block.id && this.streamedToolIds.has(block.id)) continue
      const json = block.input ? JSON.stringify(block.input) : ''
      this.emitTool(block.name, block.id, 'end', formatToolFinal(block.name, json))
    }
  }
}

export const claudeEngine: Engine = {
  id: 'claude-code',
  startSession(opts, onEvent) {
    return new ClaudeSession(opts, onEvent)
  }
}
