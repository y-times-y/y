import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  CodexUtilityCommand,
  EngineCommand,
  EngineCommandResult,
  Engine,
  Session,
  StartOpts
} from './types'

function commandName(command: EngineCommand): string {
  if (command.name === 'goal') return 'goal'
  if (command.name === 'slash') return command.value
  if (command.name === 'utility') return command.command
  if (command.name === 'steer') return 'steer'
  if (command.name === 'rollback') return 'rollback'
  return command.name
}

function codexUpdateHint(command: EngineCommand): string {
  return `Your installed Codex CLI does not support /${commandName(command)} yet. Run /update while using Codex, then try again.`
}

function codexUtilityCommandArgs(command: string): string[] | null {
  switch (command) {
    case 'doctor':
      return ['doctor']
    case 'login':
      return ['login']
    case 'loginStatus':
      return ['login', 'status']
    case 'logout':
      return ['logout']
    case 'pluginList':
      return ['plugin', 'list']
    case 'pluginAdd':
      return ['plugin', 'add']
    case 'pluginRemove':
      return ['plugin', 'remove']
    case 'pluginMarketplaceList':
      return ['plugin', 'marketplace', 'list']
    case 'pluginMarketplaceAdd':
      return ['plugin', 'marketplace', 'add']
    case 'pluginMarketplaceRemove':
      return ['plugin', 'marketplace', 'remove']
    case 'pluginMarketplaceUpdate':
      return ['plugin', 'marketplace', 'upgrade']
    case 'mcpList':
      return ['mcp', 'list']
    case 'mcpGet':
      return ['mcp', 'get']
    case 'mcpAdd':
      return ['mcp', 'add']
    case 'mcpRemove':
      return ['mcp', 'remove']
    case 'mcpLogin':
      return ['mcp', 'login']
    case 'mcpLogout':
      return ['mcp', 'logout']
    case 'featuresList':
      return ['features', 'list']
    case 'featuresEnable':
      return ['features', 'enable']
    case 'featuresDisable':
      return ['features', 'disable']
    case 'cloudList':
      return ['cloud', 'list']
    case 'cloudStatus':
      return ['cloud', 'status']
    case 'cloudApply':
      return ['cloud', 'apply']
    case 'cloudDiff':
      return ['cloud', 'diff']
    default:
      return null
  }
}

function isMissingCodexCapability(message: string): boolean {
  return /method|unknown|not found|unsupported|unrecognized|invalid request/i.test(message)
}

// The subset of `codex exec --json` output we read. Codex uses a thread/turn/item
// model: a thread.started gives the session id, agent_message items carry the
// reply (as one full block, not token deltas), and turn.completed ends the turn.
interface CodexLine {
  type?: string
  thread_id?: string
  item?: { id?: string; type?: string; text?: string; command?: string }
  usage?: { reasoning_output_tokens?: number }
  error?: { message?: string }
  message?: string
}

function splitList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLines(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function formatFileChangeTarget(changes: any[] | undefined): string | undefined {
  if (!Array.isArray(changes) || changes.length === 0) return undefined
  const paths = changes.map((change) => change?.path).filter((path): path is string => typeof path === 'string' && path.length > 0)
  if (paths.length === 0) return undefined
  if (paths.length === 1) return paths[0]
  return `${paths[0]} +${paths.length - 1} files`
}

function formatFileChangeBody(changes: any[] | undefined): string | undefined {
  if (!Array.isArray(changes) || changes.length === 0) return undefined
  const lines: string[] = []
  for (const change of changes) {
    if (typeof change?.path === 'string') lines.push(`  ${change.path}`)
    if (typeof change?.diff !== 'string') continue
    for (const line of change.diff.split('\n')) {
      if (!line || line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
      if (line.startsWith('+')) lines.push(`+ ${line.slice(1)}`)
      else if (line.startsWith('-')) lines.push(`- ${line.slice(1)}`)
      else if (line.startsWith(' ')) lines.push(`  ${line.slice(1)}`)
    }
  }
  return lines.length ? lines.join('\n') : undefined
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

// Drives the official `codex` CLI through its rich-client app-server protocol.
// Normal chat is one long-lived JSON-RPC stdio process; review/utility commands
// still use short-lived `codex exec`/subcommand processes.
class CodexSession implements Session {
  readonly id = randomUUID() // OUR id — routes IPC events back to this chat
  private threadId: string | null = null // codex's id — for resume
  private child: ChildProcess | null = null
  private appServer: ChildProcess | null = null
  private appServerReady: Promise<void> | null = null
  private appServerRequestId = 0
  private appServerPending = new Map<
    number,
    { method: string; resolve: (value: any) => void; reject: (err: Error) => void }
  >()
  private appServerDeltaItems = new Set<string>()
  private appServerStderr = ''
  private appServerTurnRunning = false
  private appServerActiveTurnId: string | null = null
  private cancelled = false
  private sawResult = false // did we already emit a result this turn?

  constructor(
    private opts: StartOpts,
    private emit: (event: AgentEvent) => void
  ) {}

  send(prompt: string): void {
    if (this.child || this.appServerTurnRunning) {
      this.emit({ kind: 'error', message: 'A turn is already running.' })
      return
    }
    this.cancelled = false
    this.sawResult = false

    // First turn: `codex exec <prompt>`. Later turns: `codex exec resume <id> <prompt>`.
    // Review mode is a one-shot `codex exec review` command that still emits
    // JSONL, so it can reuse the same parser.
    const resumeLast = this.threadId === null && this.opts.options?.codexInitialResume === 'last'
    const resuming = this.threadId !== null || resumeLast
    const command = this.opts.options?.codexCommand ?? 'chat'
    if (command === 'utility') {
      const args = this.buildUtilityArgs(prompt)
      if (!args) {
        this.emit({ kind: 'error', message: 'Choose a Codex utility command.' })
        return
      }
      this.runTextCommand(args)
      return
    }
    const reviewing = command === 'review'
    if (!reviewing) {
      void this.runAppServerTurn(prompt)
      return
    }
    const base = reviewing ? ['exec', 'review'] : resuming ? ['exec', 'resume'] : ['exec']
    const args = [
      ...this.buildGlobalArgs(),
      ...base,
      '--json' // JSONL events on stdout
    ]
    if (this.opts.options?.codexSkipGitRepoCheck !== false) args.push('--skip-git-repo-check')
    if (resumeLast) {
      args.push('--last')
      if (this.opts.options?.codexResumeAll) args.push('--all')
    }
    // Read mode = read-only. Write mode = workspace-write unless the Kernel
    // explicitly enables Codex's dangerous full-access flag for trusted main chat.
    // --sandbox is only valid on the initial `exec`; `resume` rejects the flag,
    // so we pin the mode there via a -c config override instead (verified flow).
    const sandbox = this.opts.mode === 'write' ? 'workspace-write' : 'read-only'
    if (reviewing) {
      // `exec review` has no --sandbox flag; keep sandboxing pinned through config.
      args.push('-c', 'sandbox_mode=' + sandbox)
    } else if (resuming) {
      args.push('-c', 'sandbox_mode=' + sandbox)
    } else {
      args.push('--sandbox', sandbox)
    }
    if (this.opts.effort) args.push('-c', 'model_reasoning_effort=' + this.opts.effort)
    if (this.opts.model) args.push('-m', this.opts.model)
    if (this.opts.options?.ephemeral) args.push('--ephemeral')
    if (this.opts.options?.codexIgnoreUserConfig) args.push('--ignore-user-config')
    if (this.opts.options?.codexIgnoreRules) args.push('--ignore-rules')
    if (this.opts.options?.codexDangerouslyBypassApprovalsAndSandbox) {
      args.push('--dangerously-bypass-approvals-and-sandbox')
    }
    for (const feature of splitList(this.opts.options?.codexEnableFeatures)) args.push('--enable', feature)
    for (const feature of splitList(this.opts.options?.codexDisableFeatures)) args.push('--disable', feature)
    for (const override of splitLines(this.opts.options?.codexConfigOverrides)) {
      args.push('-c', override)
    }
    for (const image of splitList(this.opts.options?.codexImages)) args.push('--image', image)
    if (trimValue(this.opts.options?.codexOutputLastMessage)) {
      args.push('--output-last-message', trimValue(this.opts.options?.codexOutputLastMessage)!)
    }
    if (this.opts.options?.codexColor && this.opts.options.codexColor !== 'auto') {
      args.push('--color', this.opts.options.codexColor)
    }
    if (reviewing) {
      const mode = this.opts.options?.codexReviewMode ?? 'default'
      if (mode === 'uncommitted') args.push('--uncommitted')
      if (mode === 'base' && trimValue(this.opts.options?.codexReviewBase)) {
        args.push('--base', trimValue(this.opts.options?.codexReviewBase)!)
      }
      if (mode === 'commit' && trimValue(this.opts.options?.codexReviewCommit)) {
        args.push('--commit', trimValue(this.opts.options?.codexReviewCommit)!)
      }
      if (trimValue(this.opts.options?.codexReviewTitle)) {
        args.push('--title', trimValue(this.opts.options?.codexReviewTitle)!)
      }
    }
    if (!resuming && !reviewing) {
      if (this.opts.options?.codexOss) args.push('--oss')
      if (this.opts.options?.codexOss && this.opts.options?.codexLocalProvider) {
        args.push('--local-provider', this.opts.options.codexLocalProvider)
      }
      const profile = this.opts.options?.codexProfile?.trim()
      if (profile) args.push('--profile', profile)
      for (const dir of splitList(this.opts.options?.codexAddDirs)) args.push('--add-dir', dir)
      const outputSchema = trimValue(this.opts.options?.codexOutputSchema)
      if (outputSchema) args.push('--output-schema', outputSchema)
    }
    if (resuming && !resumeLast && this.threadId) args.push(this.threadId)
    args.push(prompt)

    const child = spawn('codex', args, {
      cwd: this.opts.cwd,
      // stdin 'ignore' = immediate EOF, so codex doesn't block "reading from stdin".
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

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
      this.emit({ kind: 'error', message: `Failed to start codex: ${err.message}` })
    })

    child.on('close', (code) => {
      const wasCancelled = this.cancelled
      this.cancelled = false
      this.child = null
      if (wasCancelled) return
      // codex can exit non-zero on a benign memories/db warning even after a
      // successful turn, so only surface an error if we never saw a result.
      if (!this.sawResult && code !== 0 && code !== null) {
        this.emit({ kind: 'error', message: stderr.trim() || `codex exited with code ${code}` })
      }
    })
  }

  cancel(): void {
    if (this.appServerTurnRunning && this.threadId) {
      this.cancelled = true
      void this.appServerRequest('turn/interrupt', { threadId: this.threadId }).catch((err) => {
        this.cancelled = false
        this.emit({ kind: 'error', message: `Failed to interrupt codex: ${err.message}` })
      })
      return
    }
    if (this.child) this.cancelled = true
    this.child?.kill('SIGTERM')
    this.child = null
  }

  async command(command: EngineCommand): Promise<EngineCommandResult> {
    if (command.name === 'update') {
      this.runTextCommand(['update'])
      return { ok: true, message: 'Checking Codex for updates.' }
    }
    try {
      await this.ensureAppServer()
      await this.ensureAppServerThread()
      if (!this.threadId) return { ok: false, error: 'Codex thread did not start.' }
      if (command.name === 'compact') {
        await this.appServerRequest('thread/compact/start', { threadId: this.threadId })
        return { ok: true, message: 'Compacting Codex context.' }
      }
      if (command.name === 'clear') {
        await this.appServerRequest('thread/rollback', { threadId: this.threadId, numTurns: 999999 })
        return { ok: true, message: 'Cleared Codex context.' }
      }
      if (command.name === 'rollback') {
        const numTurns = Math.max(1, Math.floor(command.turns ?? 1))
        await this.appServerRequest('thread/rollback', { threadId: this.threadId, numTurns })
        return { ok: true, message: `Rolled back ${numTurns} Codex turn${numTurns === 1 ? '' : 's'}.` }
      }
      if (command.name === 'steer') {
        const text = command.value.trim()
        if (!text) return { ok: false, error: 'Steering text is required.' }
        if (!this.appServerTurnRunning || !this.appServerActiveTurnId) {
          return { ok: false, error: 'No Codex turn is currently running.' }
        }
        const result = await this.appServerRequest('turn/steer', {
          threadId: this.threadId,
          clientUserMessageId: randomUUID(),
          expectedTurnId: this.appServerActiveTurnId,
          input: [{ type: 'text', text, text_elements: [] }]
        })
        if (typeof result?.turnId === 'string') this.appServerActiveTurnId = result.turnId
        return { ok: true, message: 'Steered the running Codex turn.' }
      }
      if (command.name === 'goal') {
        if (command.action === 'set') {
          const objective = command.value?.trim()
          if (!objective) return { ok: false, error: 'Goal text is required.' }
          await this.appServerRequest('thread/goal/set', { threadId: this.threadId, objective })
          return { ok: true, message: `Goal set: ${objective}`, value: objective }
        }
        if (command.action === 'clear') {
          await this.appServerRequest('thread/goal/clear', { threadId: this.threadId })
          return { ok: true, message: 'Goal cleared.' }
        }
        const result = await this.appServerRequest('thread/goal/get', { threadId: this.threadId })
        const objective = result?.goal?.objective
        return {
          ok: true,
          message: typeof objective === 'string' && objective ? `Current goal: ${objective}` : 'No goal is set.',
          value: typeof objective === 'string' ? objective : undefined
        }
      }
      if (command.name === 'inventory') {
        if (command.target === 'plugins') {
          this.runTextCommand(['plugin', 'list'])
          return { ok: true, message: 'Listing Codex plugins.' }
        }
        if (command.target === 'mcp') {
          this.runTextCommand(['mcp', 'list'])
          return { ok: true, message: 'Listing Codex MCP servers.' }
        }
        return {
          ok: false,
          error:
            'Codex does not expose a native skills list command here. Skills that are available through this app are loaded by Codex itself, not as provider slash commands.'
        }
      }
      if (command.name === 'utility') {
        const args = codexUtilityCommandArgs(command.command)
        if (!args) return { ok: false, error: `Codex does not expose /${command.command} through y.` }
        this.runTextCommand(args.concat(splitArgs(command.args)))
        return { ok: true, message: `Running codex ${args.join(' ')}.` }
      }
      if (command.name === 'slash') {
        return { ok: false, error: 'Codex slash commands must be mapped to app-server methods before y can run them.' }
      }
      return { ok: false, error: 'Unsupported Codex command.' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isMissingCodexCapability(message)) {
        return { ok: false, error: codexUpdateHint(command) }
      }
      return { ok: false, error: message }
    }
  }

  private async runAppServerTurn(prompt: string): Promise<void> {
    this.cancelled = false
    this.appServerTurnRunning = true
    this.appServerActiveTurnId = null
    this.appServerDeltaItems.clear()
    try {
      await this.ensureAppServer()
      await this.ensureAppServerThread()
      await this.appServerRequest('turn/start', {
        threadId: this.threadId,
        clientUserMessageId: randomUUID(),
        input: [{ type: 'text', text: prompt, text_elements: [] }],
        cwd: this.opts.cwd,
        approvalPolicy: this.codexApprovalPolicy(),
        sandboxPolicy: this.appServerSandboxPolicy(),
        ...(this.opts.model ? { model: this.opts.model } : {}),
        ...(this.opts.effort ? { effort: this.opts.effort } : {})
      })
    } catch (err) {
      if (this.cancelled) {
        this.appServerTurnRunning = false
        this.appServerActiveTurnId = null
        this.cancelled = false
        return
      }
      this.appServerTurnRunning = false
      this.appServerActiveTurnId = null
      this.emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      this.emit({ kind: 'result', ok: false })
    }
  }

  private async ensureAppServer(): Promise<void> {
    if (this.appServerReady) return this.appServerReady
    this.appServerReady = this.startAppServer()
    return this.appServerReady
  }

  private async ensureAppServerThread(): Promise<void> {
    if (this.threadId) return
    const started = await this.appServerRequest('thread/start', this.buildAppServerThreadParams())
    const threadId = started?.thread?.id
    if (typeof threadId !== 'string' || !threadId) {
      throw new Error('codex app-server did not return a thread id')
    }
    this.threadId = threadId
    this.emit({ kind: 'session', sessionId: threadId })
  }

  private async startAppServer(): Promise<void> {
    this.appServerStderr = ''
    const child = spawn('codex', this.buildAppServerArgs(), {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.appServer = child

    let buf = ''
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) this.handleAppServerLine(line)
      }
    })

    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => {
      this.appServerStderr += chunk
    })

    child.on('error', (err) => {
      this.rejectAppServerPending(`Failed to start codex app-server: ${err.message}`)
      this.appServer = null
      this.appServerReady = null
    })

    child.on('close', (code) => {
      const detail = this.codexLogMessage(this.appServerStderr)
      const summary = detail || `codex app-server exited with code ${code ?? 'unknown'}`
      this.rejectAppServerPending(summary)
      this.appServer = null
      this.appServerReady = null
      if (this.appServerTurnRunning) {
        const wasCancelled = this.cancelled
        this.cancelled = false
        this.appServerTurnRunning = false
        this.appServerActiveTurnId = null
        if (wasCancelled) return
        this.emit({ kind: 'result', ok: false, summary })
      }
    })

    await this.appServerRequest('initialize', {
      clientInfo: { name: 'y', title: 'y', version: '0.0.1' }
    })
    this.appServerNotify('initialized', {})
  }

  private buildAppServerArgs(): string[] {
    const args = ['app-server']
    for (const override of splitLines(this.opts.options?.codexConfigOverrides)) args.push('-c', override)
    for (const feature of splitList(this.opts.options?.codexEnableFeatures)) args.push('--enable', feature)
    for (const feature of splitList(this.opts.options?.codexDisableFeatures)) args.push('--disable', feature)
    return args
  }

  private buildAppServerThreadParams(): Record<string, unknown> {
    return {
      ...(this.opts.model ? { model: this.opts.model } : {}),
      cwd: this.opts.cwd,
      approvalPolicy: this.codexApprovalPolicy(),
      sandbox: this.codexSandboxMode(),
      ...(this.opts.options?.ephemeral ? { ephemeral: true } : {})
    }
  }

  private codexApprovalPolicy(): 'untrusted' | 'on-failure' | 'on-request' | 'never' {
    const approval = this.opts.options?.codexAskForApproval
    if (approval && approval !== 'default') return approval
    return 'never'
  }

  private codexSandboxMode(): 'read-only' | 'workspace-write' | 'danger-full-access' {
    if (this.opts.options?.codexDangerouslyBypassApprovalsAndSandbox) return 'danger-full-access'
    return this.opts.mode === 'write' ? 'workspace-write' : 'read-only'
  }

  private appServerSandboxPolicy(): Record<string, unknown> {
    const sandbox = this.codexSandboxMode()
    if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' }
    if (sandbox === 'workspace-write') {
      return {
        type: 'workspaceWrite',
        writableRoots: [this.opts.cwd],
        networkAccess: Boolean(this.opts.options?.codexWebSearch),
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false
      }
    }
    return { type: 'readOnly', networkAccess: Boolean(this.opts.options?.codexWebSearch) }
  }

  private appServerRequest(method: string, params: Record<string, unknown>): Promise<any> {
    const child = this.appServer
    if (!child?.stdin?.writable) return Promise.reject(new Error('codex app-server is not running'))
    const id = ++this.appServerRequestId
    const message = { method, id, params }
    return new Promise((resolve, reject) => {
      this.appServerPending.set(id, { method, resolve, reject })
      child.stdin!.write(JSON.stringify(message) + '\n', (err) => {
        if (!err) return
        this.appServerPending.delete(id)
        reject(err)
      })
    })
  }

  private appServerNotify(method: string, params: Record<string, unknown>): void {
    this.appServer?.stdin?.write(JSON.stringify({ method, params }) + '\n')
  }

  private handleAppServerLine(line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      this.emit({ kind: 'status', status: line })
      return
    }
    if (typeof msg.id === 'number') {
      const pending = this.appServerPending.get(msg.id)
      if (!pending) return
      this.appServerPending.delete(msg.id)
      if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message || 'codex app-server request failed'}`))
      else pending.resolve(msg.result)
      return
    }
    this.handleAppServerNotification(msg.method, msg.params)
  }

  private handleAppServerNotification(method: string | undefined, params: any): void {
    if (!method) return
    const threadId = params?.threadId
    if (threadId && this.threadId && threadId !== this.threadId) return
    if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
      if (params.itemId) this.appServerDeltaItems.add(params.itemId)
      this.emit({ kind: 'text', text: params.delta })
      return
    }
    if (method === 'item/started') {
      this.emitAppServerItem(params?.item, 'start')
      return
    }
    if (method === 'item/completed') {
      this.emitAppServerItem(params?.item, 'end')
      return
    }
    if (method === 'item/fileChange/patchUpdated') {
      this.emit({
        kind: 'tool',
        name: 'Edit',
        phase: 'update',
        id: params?.itemId,
        verb: 'edit',
        target: formatFileChangeTarget(params?.changes),
        body: formatFileChangeBody(params?.changes)
      })
      return
    }
    if (method === 'turn/completed') {
      const wasCancelled = this.cancelled
      this.cancelled = false
      this.appServerTurnRunning = false
      this.appServerActiveTurnId = null
      if (wasCancelled) return
      const turn = params?.turn
      if (turn?.status === 'completed') this.emit({ kind: 'result', ok: true })
      else this.emit({ kind: 'result', ok: false, summary: turn?.error?.message || turn?.status || 'codex turn failed' })
      return
    }
    if (method === 'turn/started') {
      if (typeof params?.turn?.id === 'string') this.appServerActiveTurnId = params.turn.id
      this.emit({ kind: 'status', status: 'codex turn started' })
      return
    }
    if (method === 'context/compacted') {
      this.emit({ kind: 'status', status: 'codex compacted context' })
      return
    }
    if (method === 'warning' && typeof params?.message === 'string') {
      this.emit({ kind: 'status', status: params.message })
      return
    }
    if (method === 'error' && typeof params?.message === 'string') {
      this.emit({ kind: 'error', message: params.message })
    }
  }

  private emitAppServerItem(item: any, phase: 'start' | 'end'): void {
    if (!item?.type) return
    if (item.type === 'agentMessage') {
      if (phase === 'end' && typeof item.text === 'string' && !this.appServerDeltaItems.has(item.id)) {
        this.emit({ kind: 'text', text: item.text })
      }
      return
    }
    if (item.type === 'reasoning') {
      if (phase === 'end') {
        const text = [...(item.summary ?? []), ...(item.content ?? [])].filter(Boolean).join('\n')
        if (text) this.emit({ kind: 'thinking', text })
      }
      return
    }
    if (item.type === 'commandExecution') {
      this.emit({
        kind: 'tool',
        name: 'Shell',
        phase,
        id: item.id,
        verb: 'run',
        target: item.command,
        body: phase === 'end' ? item.aggregatedOutput || undefined : undefined
      })
      return
    }
    if (item.type === 'fileChange') {
      this.emit({
        kind: 'tool',
        name: 'Edit',
        phase,
        id: item.id,
        verb: 'edit',
        target: formatFileChangeTarget(item.changes),
        body: formatFileChangeBody(item.changes)
      })
      return
    }
    if (item.type === 'mcpToolCall') {
      this.emit({
        kind: 'tool',
        name: item.tool || 'MCP',
        phase,
        id: item.id,
        verb: item.server || 'mcp'
      })
      return
    }
    if (item.type === 'dynamicToolCall') {
      this.emit({
        kind: 'tool',
        name: item.tool || 'Tool',
        phase,
        id: item.id,
        verb: item.namespace || 'tool'
      })
      return
    }
    if (item.type === 'webSearch') {
      this.emit({ kind: 'tool', name: 'WebSearch', phase, id: item.id, verb: 'search', target: item.query })
      return
    }
    if (item.type === 'contextCompaction') {
      this.emit({ kind: 'status', status: 'codex compacted context' })
    }
  }

  private rejectAppServerPending(message: string): void {
    for (const pending of this.appServerPending.values()) pending.reject(new Error(message))
    this.appServerPending.clear()
  }

  private codexLogMessage(chunk: string): string | null {
    const lines = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const messages = lines
      .map((line) => {
        try {
          return JSON.parse(line).fields?.message
        } catch {
          return line
        }
      })
      .filter((line): line is string => Boolean(line))
    return messages[0] ?? null
  }

  private runTextCommand(args: string[]): void {
    this.emit({ kind: 'status', status: `running codex ${args.slice(0, 3).join(' ')}` })
    this.cancelled = false
    const child = spawn('codex', args, {
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
      this.emit({ kind: 'error', message: `Failed to start codex: ${err.message}` })
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
        this.emit({ kind: 'result', ok: false, summary: stderr.trim() || `codex exited with code ${code}` })
      }
    })
  }

  private buildUtilityArgs(prompt: string): string[] | null {
    const command = this.opts.options?.codexUtilityCommand
    if (!command) return null
    const utility = this.utilityBaseArgs(command)
    if (!utility) return null
    const args = [...this.buildGlobalArgs(), ...utility]
    for (const override of splitLines(this.opts.options?.codexConfigOverrides)) args.push('-c', override)
    for (const feature of splitList(this.opts.options?.codexEnableFeatures)) args.push('--enable', feature)
    for (const feature of splitList(this.opts.options?.codexDisableFeatures)) args.push('--disable', feature)
    const target = trimValue(this.opts.options?.codexUtilityTarget)
    if (target) args.push(target)
    for (const raw of splitArgs(this.opts.options?.codexUtilityRawArgs)) args.push(raw)
    if (command === 'cloudExec' && prompt.trim()) args.push(prompt.trim())
    return args
  }

  private buildGlobalArgs(): string[] {
    const args: string[] = []
    if (this.opts.options?.codexWebSearch) args.push('--search')
    const approval = this.opts.options?.codexAskForApproval
    if (approval && approval !== 'default') args.push('--ask-for-approval', approval)
    if (trimValue(this.opts.options?.codexRemote)) args.push('--remote', trimValue(this.opts.options?.codexRemote)!)
    if (trimValue(this.opts.options?.codexRemoteAuthTokenEnv)) {
      args.push('--remote-auth-token-env', trimValue(this.opts.options?.codexRemoteAuthTokenEnv)!)
    }
    if (this.opts.options?.codexNoAltScreen) args.push('--no-alt-screen')
    return args
  }

  private utilityBaseArgs(command: CodexUtilityCommand): string[] | null {
    switch (command) {
      case 'login':
        return ['login']
      case 'loginStatus':
        return ['login', 'status']
      case 'logout':
        return ['logout']
      case 'doctor':
        return ['doctor']
      case 'pluginList':
        return ['plugin', 'list']
      case 'pluginAdd':
        return ['plugin', 'add']
      case 'pluginRemove':
        return ['plugin', 'remove']
      case 'mcpList':
        return ['mcp', 'list']
      case 'mcpGet':
        return ['mcp', 'get']
      case 'mcpAdd':
        return ['mcp', 'add']
      case 'mcpRemove':
        return ['mcp', 'remove']
      case 'mcpLogin':
        return ['mcp', 'login']
      case 'mcpLogout':
        return ['mcp', 'logout']
      case 'pluginMarketplaceList':
        return ['plugin', 'marketplace', 'list']
      case 'pluginMarketplaceAdd':
        return ['plugin', 'marketplace', 'add']
      case 'pluginMarketplaceRemove':
        return ['plugin', 'marketplace', 'remove']
      case 'pluginMarketplaceUpdate':
        return ['plugin', 'marketplace', 'upgrade']
      case 'mcpServer':
        return ['mcp-server']
      case 'appServer':
        return ['app-server']
      case 'app':
        return ['app']
      case 'completion':
        return ['completion']
      case 'update':
        return ['update']
      case 'sandboxMacos':
        return ['sandbox', 'macos']
      case 'sandboxLinux':
        return ['sandbox', 'linux']
      case 'sandboxWindows':
        return ['sandbox', 'windows']
      case 'debugModels':
        return ['debug', 'models']
      case 'debugAppServer':
        return ['debug', 'app-server']
      case 'debugPromptInput':
        return ['debug', 'prompt-input']
      case 'apply':
        return ['apply']
      case 'resume':
        return ['resume']
      case 'fork':
        return ['fork']
      case 'cloudList':
        return ['cloud', 'list']
      case 'cloudStatus':
        return ['cloud', 'status']
      case 'cloudApply':
        return ['cloud', 'apply']
      case 'cloudDiff':
        return ['cloud', 'diff']
      case 'cloudExec':
        return ['cloud', 'exec']
      case 'execServer':
        return ['exec-server']
      case 'featuresList':
        return ['features', 'list']
      case 'featuresEnable':
        return ['features', 'enable']
      case 'featuresDisable':
        return ['features', 'disable']
    }
    return null
  }

  private handleLine(line: string): void {
    let obj: CodexLine
    try {
      obj = JSON.parse(line) as CodexLine
    } catch {
      return
    }

    switch (obj.type) {
      case 'thread.started':
        if (obj.thread_id) {
          this.threadId = obj.thread_id
          this.emit({ kind: 'session', sessionId: obj.thread_id })
        }
        break
      case 'turn.started':
        this.emit({ kind: 'status', status: 'reasoning' })
        break
      case 'item.completed':
        this.handleItem(obj.item)
        break
      case 'turn.completed':
        this.sawResult = true
        if (obj.usage?.reasoning_output_tokens) {
          this.emit({
            kind: 'status',
            status: `${obj.usage.reasoning_output_tokens} reasoning tokens`
          })
        }
        this.emit({ kind: 'result', ok: true })
        break
      case 'turn.failed':
        this.sawResult = true
        this.emit({ kind: 'result', ok: false, summary: obj.error?.message })
        break
      case 'error':
        this.emit({ kind: 'error', message: obj.message || obj.error?.message || 'codex error' })
        break
    }
  }

  private handleItem(item: CodexLine['item']): void {
    if (!item) return
    switch (item.type) {
      case 'agent_message':
        if (typeof item.text === 'string') this.emit({ kind: 'text', text: item.text })
        break
      case 'reasoning':
        if (typeof item.text === 'string') this.emit({ kind: 'thinking', text: item.text })
        break
      case 'command_execution': {
        const cmd = item.command || 'shell'
        const target = cmd.length > 96 ? cmd.slice(0, 96) + '…' : cmd
        this.emit({
          kind: 'tool',
          name: 'shell',
          phase: 'end',
          verb: 'run',
          target,
          body: cmd
        })
        break
      }
    }
  }
}

export const codexEngine: Engine = {
  id: 'codex',
  startSession(opts, onEvent) {
    return new CodexSession(opts, onEvent)
  }
}
