// The pluggable engine layer (ARCHITECTURE §6). One interface, thin adapters;
// the UI never knows which CLI runs underneath.

// The ONE normalized shape the UI renders, no matter which engine produced it.
// Each adapter's job is to translate its CLI's native output into these events.
export type AgentEvent =
  | { kind: 'session'; sessionId: string } // engine reported its conversation id
  | { kind: 'status'; status: string } // CLI-native loading/status text
  | { kind: 'suggestion'; text: string } // CLI-native suggested next prompt
  | { kind: 'commands'; commands: Array<{ name: string; source?: string }> } // engine/provider slash commands
  | { kind: 'text'; text: string } // a chunk of assistant reply
  | { kind: 'thinking'; text: string } // a chunk of reasoning (optional)
  | {
      kind: 'tool'
      name: string
      phase: 'start' | 'update' | 'end'
      id?: string
      verb?: string // lowercase action shown inline: read, edit…
      target?: string // file, pattern, or command
      body?: string // diff preview or snippet
    } // tool activity
  | { kind: 'result'; ok: boolean; summary?: string } // the turn finished
  | { kind: 'error'; message: string } // something went wrong

export type EngineCommand =
  | { name: 'compact' }
  | { name: 'clear' }
  | { name: 'rollback'; turns?: number }
  | { name: 'steer'; value: string }
  | { name: 'goal'; action: 'get' | 'set' | 'clear'; value?: string }
  | { name: 'inventory'; target: 'plugins' | 'mcp' | 'skills' }
  | { name: 'utility'; command: string; args?: string }
  | { name: 'slash'; value: string }
  | { name: 'update' }

export interface EngineCommandResult {
  ok: boolean
  message?: string
  value?: string
  error?: string
}

export type ClaudePermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'auto'
  | 'plan'
  | 'dontAsk'
  | 'bypassPermissions'

export type ClaudeUtilityCommand =
  | 'doctor'
  | 'autoModeConfig'
  | 'autoModeDefaults'
  | 'autoModeCritique'
  | 'authStatus'
  | 'authLogin'
  | 'authLogout'
  | 'setupToken'
  | 'install'
  | 'update'
  | 'projectPurge'
  | 'pluginList'
  | 'pluginDetails'
  | 'pluginValidate'
  | 'pluginInstall'
  | 'pluginEnable'
  | 'pluginDisable'
  | 'pluginUninstall'
  | 'pluginUpdate'
  | 'pluginPrune'
  | 'pluginTag'
  | 'pluginInit'
  | 'pluginMarketplaceList'
  | 'pluginMarketplaceAdd'
  | 'pluginMarketplaceRemove'
  | 'pluginMarketplaceUpdate'
  | 'mcpList'
  | 'mcpGet'
  | 'mcpAdd'
  | 'mcpAddJson'
  | 'mcpRemove'
  | 'mcpServe'
  | 'mcpResetProjectChoices'

export type CodexUtilityCommand =
  | 'login'
  | 'loginStatus'
  | 'logout'
  | 'doctor'
  | 'pluginList'
  | 'pluginAdd'
  | 'pluginRemove'
  | 'mcpList'
  | 'mcpGet'
  | 'mcpAdd'
  | 'mcpRemove'
  | 'mcpLogin'
  | 'mcpLogout'
  | 'pluginMarketplaceList'
  | 'pluginMarketplaceAdd'
  | 'pluginMarketplaceRemove'
  | 'pluginMarketplaceUpdate'
  | 'mcpServer'
  | 'appServer'
  | 'app'
  | 'completion'
  | 'update'
  | 'sandboxMacos'
  | 'sandboxLinux'
  | 'sandboxWindows'
  | 'debugModels'
  | 'debugAppServer'
  | 'debugPromptInput'
  | 'apply'
  | 'resume'
  | 'fork'
  | 'cloudList'
  | 'cloudStatus'
  | 'cloudApply'
  | 'cloudDiff'
  | 'cloudExec'
  | 'execServer'
  | 'featuresList'
  | 'featuresEnable'
  | 'featuresDisable'

export interface EngineRunOptions {
  // Shared intent flags. Adapters map only the options their CLI supports.
  ephemeral?: boolean
  sessionName?: string
  workingDirectory?: string

  // Claude Code CLI options.
  claudeCommand?: 'chat' | 'ultrareview' | 'agents' | 'utility'
  claudeUtilityCommand?: ClaudeUtilityCommand
  claudeUtilityTarget?: string
  claudeUtilityPath?: string
  claudeUtilityJson?: boolean
  claudeUtilityAvailable?: boolean
  claudeUtilityStrict?: boolean
  claudeUtilityAll?: boolean
  claudeUtilityDryRun?: boolean
  claudeUtilityInteractive?: boolean
  claudeUtilityYes?: boolean
  claudeUtilityForce?: boolean
  claudeUtilityScope?: 'auto' | 'local' | 'user' | 'project'
  claudeUtilityTransport?: 'stdio' | 'sse' | 'http'
  claudeUtilityCommandOrUrl?: string
  claudeUtilityArgs?: string
  claudeUtilityEnv?: string
  claudeUtilityHeaders?: string
  claudeUtilityConfig?: string
  claudeUtilityClientId?: string
  claudeUtilityClientSecret?: boolean
  claudeUtilityCallbackPort?: string
  claudeUtilityRawArgs?: string
  claudeInitialResume?: 'new' | 'continue' | 'resume' | 'fromPr'
  claudeResumeId?: string
  claudeFromPr?: string
  claudePromptSuggestions?: boolean
  claudeHookEvents?: boolean
  claudeBrief?: boolean
  claudePermissionMode?: ClaudePermissionMode
  claudeToolMode?: 'safe' | 'default' | 'custom'
  claudeTools?: string
  claudeAllowedTools?: string
  claudeDisallowedTools?: string
  claudeAgent?: string
  claudeSystemPrompt?: string
  claudeSystemPromptFile?: string
  claudeAppendSystemPrompt?: string
  claudeAppendSystemPromptFile?: string
  claudeFallbackModel?: string
  claudeMaxBudgetUsd?: string
  claudeExcludeDynamicSystemPrompt?: boolean
  claudeDisableSlashCommands?: boolean
  claudeSettingSources?: string
  claudeAddDirs?: string
  claudePluginDirs?: string
  claudePluginUrls?: string
  claudeMcpConfigs?: string
  claudeStrictMcpConfig?: boolean
  claudeFiles?: string
  claudeJsonSchema?: string
  claudeBare?: boolean
  claudeIde?: boolean
  claudeChrome?: 'default' | 'enabled' | 'disabled'
  claudeRemoteControlName?: string
  claudeRemoteControlPrefix?: string
  claudeWorktreeName?: string
  claudeTmux?: 'off' | 'default' | 'classic'
  claudeForkSession?: boolean
  claudeSessionId?: string
  claudeBetas?: string
  claudeSettings?: string
  claudeAgentsJson?: string
  claudeDebug?: string
  claudeDebugFile?: string
  claudeUltrareviewTarget?: string
  claudeUltrareviewJson?: boolean
  claudeUltrareviewTimeoutMinutes?: string
  claudeAllowDangerouslySkipPermissions?: boolean
  claudeDangerouslySkipPermissions?: boolean

  // Codex CLI options.
  codexCommand?: 'chat' | 'review' | 'utility'
  codexUtilityCommand?: CodexUtilityCommand
  codexUtilityTarget?: string
  codexUtilityRawArgs?: string
  codexWebSearch?: boolean
  codexAskForApproval?: 'default' | 'untrusted' | 'on-request' | 'on-failure' | 'never'
  codexRemote?: string
  codexRemoteAuthTokenEnv?: string
  codexNoAltScreen?: boolean
  codexInitialResume?: 'new' | 'last'
  codexResumeAll?: boolean
  codexSkipGitRepoCheck?: boolean
  codexIgnoreRules?: boolean
  codexIgnoreUserConfig?: boolean
  codexOss?: boolean
  codexLocalProvider?: 'ollama' | 'lmstudio'
  codexProfile?: string
  codexAddDirs?: string
  codexImages?: string
  codexOutputSchema?: string
  codexEnableFeatures?: string
  codexDisableFeatures?: string
  codexConfigOverrides?: string
  codexOutputLastMessage?: string
  codexColor?: 'auto' | 'always' | 'never'
  codexReviewMode?: 'default' | 'uncommitted' | 'base' | 'commit'
  codexReviewBase?: string
  codexReviewCommit?: string
  codexReviewTitle?: string
  codexDangerouslyBypassApprovalsAndSandbox?: boolean
}

export interface StartOpts {
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  options?: EngineRunOptions
  cwd?: string
  // 'native': defer tools, approvals, and sandboxing to the official CLI config.
  // 'read'/'write': Kernel-owned scopes used by protected surfaces such as Modify.
  mode?: 'native' | 'read' | 'write'
}

// A live conversation with one engine. send() runs one turn; the engine streams
// AgentEvents back through the onEvent callback the manager wires up at start.
export interface Session {
  readonly id: string
  send(prompt: string): void
  command?(command: EngineCommand): Promise<EngineCommandResult> | EngineCommandResult
  cancel(): void
}

export interface Engine {
  readonly id: string // "claude-code" | "codex" | ...
  startSession(opts: StartOpts, onEvent: (event: AgentEvent) => void): Session
}
