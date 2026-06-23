export {}

// The shape of y's brick-box, visible to BOTH preload and renderer
// (renderer's tsconfig.web.json includes src/preload/*.d.ts).
interface CompileResult {
  ok: boolean
  code?: string
  error?: string
}

interface SnapshotResult {
  ok: boolean
  hash?: string
  count?: number
  error?: string
}

interface SnapshotEntry {
  hash: string
  shortHash: string
  message: string
  label: string
  kind: 'original' | 'change' | 'snapshot'
  timestamp: string
  current?: boolean
}

interface SnapshotHistoryResult {
  ok: boolean
  entries?: SnapshotEntry[]
  error?: string
}

interface EngineModelCatalog {
  engine: string
  label: string
  logoUrl?: string
  defaultModel: string
  models: { id: string; label: string; contextWindow?: number }[]
}

interface OnboardingCliToolStatus {
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

interface OnboardingCliCheckResult {
  ok: boolean
  checkedAt: string
  tools: OnboardingCliToolStatus[]
}

interface MissingBrickReport {
  brick:
    | 'browser'
    | 'file_editor'
    | 'terminal'
    | 'database'
    | 'github'
    | 'figma'
    | 'web_search'
    | 'auth'
    | 'analytics'
    | 'deployment'
    | 'unknown'
  reason:
    | 'needs_external_page_interaction'
    | 'needs_project_file_access'
    | 'needs_shell_execution'
    | 'needs_remote_repo_context'
    | 'needs_design_asset_access'
    | 'needs_live_web_lookup'
    | 'needs_user_identity'
    | 'needs_product_event_tracking'
    | 'needs_hosting_or_release'
    | 'other'
  surface: 'main' | 'modify'
  confidence: 'low' | 'medium' | 'high'
  engineId?: 'claude-code' | 'codex'
}

interface AnalyticsResult {
  ok: boolean
  error?: string
}

interface EngineRunOptions {
  ephemeral?: boolean
  sessionName?: string
  workingDirectory?: string
  claudeCommand?: 'chat' | 'ultrareview' | 'agents' | 'utility'
  claudeUtilityCommand?:
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
  claudePermissionMode?: 'default' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypassPermissions'
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
  codexCommand?: 'chat' | 'review' | 'utility'
  codexUtilityCommand?:
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

interface AppMsg {
  role: 'user' | 'assistant' | 'tool' | 'thinking'
  text?: string
  name?: string
  id?: string
  verb?: string
  target?: string
  body?: string
  failed?: boolean
  streaming?: boolean
  system?: boolean
  engineId?: string
  terminalId?: string
  terminalRunning?: boolean
  checkpointId?: string
  durationMs?: number
  interrupted?: boolean
}

interface AppChat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: AppMsg[]
  archived?: boolean
  engineId?: string
  modelId?: string
  goal?: string
  runOptions?: EngineRunOptions
}

interface ModifyChatRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: AppMsg[]
  archived?: boolean
  engineId?: string
  modelId?: string
  runOptions?: EngineRunOptions
}

interface ModifyChatResult {
  ok: boolean
  chats?: ModifyChatRecord[]
  chat?: ModifyChatRecord
  activeChatId?: string
  error?: string
}

interface AppProject {
  id: string
  name: string
  path: string
  open: boolean
  chats: AppChat[]
}

interface AppState {
  version: 1
  activeProjectId?: string
  activeChatId?: string
  projects: AppProject[]
}

interface AppStateResult {
  ok: boolean
  canceled?: boolean
  state?: AppState
  error?: string
}

interface CreateChatOptions {
  isolate?: boolean
}

interface IsolationStatus {
  ok: boolean
  git: boolean
  canIsolate: boolean
  hasHead: boolean
  reason?: string
  error?: string
}

interface SelectedFile {
  name: string
  path: string
  relPath?: string
  size?: number
}

interface ProjectDirectoryEntry extends SelectedFile {
  kind: 'file' | 'directory'
}

interface SelectFilesResult {
  ok: boolean
  canceled?: boolean
  files: SelectedFile[]
  error?: string
}

interface ProjectFileResult {
  ok: boolean
  content?: string
  path?: string
  relPath?: string
  error?: string
}

interface TerminalEvent {
  kind: 'data' | 'exit' | 'error'
  id: string
  data?: string
  exitCode?: number
  message?: string
}

interface ElectronBridge {
  process: {
    platform: string
    versions: {
      electron?: string
      chrome?: string
      node?: string
    }
  }
  window: {
    onFullscreen: (cb: (full: boolean) => void) => () => void
  }
}

interface YApi {
  userland: {
    read: () => Promise<string>
    getPath: () => Promise<string>
    compile: () => Promise<CompileResult>
    snapshot: (message?: string) => Promise<SnapshotResult>
    revert: () => Promise<SnapshotResult>
    history: () => Promise<SnapshotHistoryResult>
    restoreSnapshot: (hash: string) => Promise<SnapshotResult>
    checkpoint: () => Promise<{ ok: boolean; checkpointId?: string; error?: string }>
    restoreCheckpoint: (checkpointId: string) => Promise<{ ok: boolean; checkpointId?: string; error?: string }>
    resetToSeed: () => Promise<{ ok: boolean; error?: string }>
    onChanged: (cb: () => void) => () => void
  }
  modify: {
    open: () => Promise<unknown>
    close: () => Promise<unknown>
    toggle: () => Promise<unknown>
    onChange: (cb: (open: boolean) => void) => () => void
    onOpenFile: (cb: (payload: { file: string; diff: string; oldContent?: string }) => void) => () => void
  }
  engine: {
    list: () => Promise<string[]>
    models: () => Promise<EngineModelCatalog[]>
    checkCliStatus: () => Promise<OnboardingCliCheckResult>
    start: (args: StartEngineArgs) => Promise<StartResult>
    startModify: (args: { engine: string; model?: string; options?: EngineRunOptions }) => Promise<StartResult>
    send: (sessionId: string, prompt: string) => Promise<{ ok: boolean; error?: string }>
    command: (sessionId: string, command: EngineCommand) => Promise<EngineCommandResult>
    cancel: (sessionId: string) => Promise<{ ok: boolean }>
    onEvent: (cb: (payload: EngineEventPayload) => void) => () => void
  }
  app: {
    getState: () => Promise<AppState>
    checkpoint: (projectId?: string) => Promise<{ ok: boolean; checkpointId?: string; error?: string }>
    restoreCheckpoint: (projectId: string | undefined, checkpointId: string) => Promise<{ ok: boolean; checkpointId?: string; error?: string }>
    addProject: () => Promise<AppStateResult>
    getIsolationStatus: (projectId?: string) => Promise<IsolationStatus>
    createChat: (projectId?: string, options?: CreateChatOptions) => Promise<AppStateResult>
    selectFiles: (projectId?: string) => Promise<SelectFilesResult>
    searchFiles: (projectId: string | undefined, query: string, workspaceRoot?: string) => Promise<{ ok: boolean; files: SelectedFile[]; error?: string }>
    listDirectory: (projectId: string | undefined, directory?: string, workspaceRoot?: string) => Promise<{ ok: boolean; entries: ProjectDirectoryEntry[]; error?: string }>
    watchFiles: (projectId?: string, workspaceRoot?: string) => Promise<{ ok: boolean; error?: string }>
    unwatchFiles: (projectId?: string) => Promise<{ ok: boolean }>
    onFilesChanged: (cb: (payload: { projectId: string; paths: string[] }) => void) => () => void
    readProjectFile: (projectId: string | undefined, filePath: string, workspaceRoot?: string) => Promise<ProjectFileResult>
    writeProjectFile: (projectId: string | undefined, filePath: string, content: string, workspaceRoot?: string) => Promise<ProjectFileResult>
    updateChat: (
      projectId: string,
      chatId: string,
      patch: { title?: string; messages?: AppMsg[]; archived?: boolean; engineId?: string; modelId?: string; goal?: string; runOptions?: EngineRunOptions }
    ) => Promise<AppStateResult>
    setActive: (projectId: string, chatId: string) => Promise<AppStateResult>
    setProjectOpen: (projectId: string, open: boolean) => Promise<AppStateResult>
    removeProject: (projectId: string) => Promise<AppStateResult>
    listModifyChats: () => Promise<ModifyChatResult>
    createModifyChat: (seed?: { engineId?: string; modelId?: string; runOptions?: EngineRunOptions }) => Promise<ModifyChatResult>
    updateModifyChat: (
      chatId: string,
      patch: { title?: string; messages?: AppMsg[]; archived?: boolean; engineId?: string; modelId?: string; runOptions?: EngineRunOptions }
    ) => Promise<ModifyChatResult>
    setActiveModifyChat: (chatId: string) => Promise<ModifyChatResult>
    onStateChanged: (cb: (state: AppState) => void) => () => void
  }
  auth: {
    load: () => Promise<{ ok: boolean; session?: KernelAuthSession | null; error?: string }>
    restore: () => Promise<{ ok: boolean; session?: KernelAuthSession | null; error?: string }>
    signIn: () => Promise<{ ok: boolean; user?: KernelAuthUser; error?: string }>
    clear: () => Promise<{ ok: boolean; error?: string }>
    onChanged: (cb: (session: KernelAuthSession | null) => void) => () => void
  }
  feedback: {
    submit: (payload: FeedbackPayload) => Promise<FeedbackResult>
  }
  analytics: {
    identify: (payload: { userId: string; email?: string }) => Promise<AnalyticsResult>
    track: (name: string, props?: Record<string, unknown>) => Promise<AnalyticsResult>
    reportMissingBrick: (report: MissingBrickReport) => Promise<AnalyticsResult>
  }
  clipboard: {
    writeText: (text: string) => Promise<AnalyticsResult>
  }
  net: {
    request: (req: NetRequest) => Promise<NetResult>
  }
  files: {
    root: () => Promise<string>
    list: (path?: string) => Promise<FilesListResult>
    read: (path: string) => Promise<FilesReadResult>
    write: (path: string, contents: string) => Promise<FilesResult>
    mkdir: (path: string) => Promise<FilesResult>
    remove: (path: string) => Promise<FilesResult>
  }
  terminal: {
    start: (args: { id?: string; cwd?: string; command?: string; cols?: number; rows?: number }) => Promise<{ ok: boolean; id?: string; error?: string }>
    write: (id: string, data: string) => Promise<{ ok: boolean; error?: string }>
    resize: (id: string, cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>
    kill: (id: string) => Promise<{ ok: boolean; error?: string }>
    onEvent: (cb: (event: TerminalEvent) => void) => () => void
  }
  updates: {
    get: () => Promise<AppUpdateState>
    check: () => Promise<AppUpdateState>
    open: () => Promise<{ ok: boolean; error?: string }>
    onChanged: (cb: (state: AppUpdateState) => void) => () => void
  }
}

interface KernelAuthConnectedAccount {
  provider: string
  providerAccountId: string
  profile?: {
    username?: string
    displayName?: string
    avatarUrl?: string
    profileUrl?: string
  }
}

interface KernelAuthUser {
  id: string
  email?: string
  displayName?: string
  profileImageUrl?: string
  connectedAccounts?: KernelAuthConnectedAccount[]
}

interface KernelAuthSession {
  user: KernelAuthUser
  savedAt: string
}

interface KernelAuthBridge {
  load: () => Promise<{ ok: boolean; session?: KernelAuthSession | null; error?: string }>
  restore: () => Promise<{ ok: boolean; session?: KernelAuthSession | null; error?: string }>
  signIn: () => Promise<{ ok: boolean; user?: KernelAuthUser; error?: string }>
  clear: () => Promise<{ ok: boolean; error?: string }>
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
  onCallback: (cb: (url: string) => void) => () => void
  onChanged: (cb: (session: KernelAuthSession | null) => void) => () => void
}

declare global {
  interface SnapshotEntry {
    hash: string
    shortHash: string
    message: string
    label: string
    kind: 'original' | 'change' | 'snapshot'
    timestamp: string
    current?: boolean
  }

  interface SnapshotHistoryResult {
    ok: boolean
    entries?: SnapshotEntry[]
    error?: string
  }

  interface EngineModelCatalog {
    engine: string
    label: string
    logoUrl?: string
    defaultModel: string
    models: { id: string; label: string; contextWindow?: number }[]
  }

  interface OnboardingCliToolStatus {
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

  interface OnboardingCliCheckResult {
    ok: boolean
    checkedAt: string
    tools: OnboardingCliToolStatus[]
  }

  interface EngineRunOptions {
    ephemeral?: boolean
    sessionName?: string
    workingDirectory?: string
    claudeCommand?: 'chat' | 'ultrareview' | 'agents' | 'utility'
    claudeUtilityCommand?:
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
    claudePermissionMode?: 'default' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypassPermissions'
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
    codexCommand?: 'chat' | 'review' | 'utility'
    codexUtilityCommand?:
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

  interface AppMsg {
    role: 'user' | 'assistant' | 'tool' | 'thinking'
    text?: string
    name?: string
    id?: string
    verb?: string
    target?: string
    body?: string
    failed?: boolean
    streaming?: boolean
    system?: boolean
    engineId?: string
    terminalId?: string
    terminalRunning?: boolean
    checkpointId?: string
    durationMs?: number
    interrupted?: boolean
  }

  interface AppChat {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    messages: AppMsg[]
    archived?: boolean
    engineId?: string
    modelId?: string
    goal?: string
    runOptions?: EngineRunOptions
  }

  interface ModifyChatRecord {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    messages: AppMsg[]
    archived?: boolean
    engineId?: string
    modelId?: string
    runOptions?: EngineRunOptions
  }

  interface ModifyChatResult {
    ok: boolean
    chats?: ModifyChatRecord[]
    chat?: ModifyChatRecord
    activeChatId?: string
    error?: string
  }

  interface AppProject {
    id: string
    name: string
    path: string
    open: boolean
    chats: AppChat[]
  }

  interface AppState {
    version: 1
    activeProjectId?: string
    activeChatId?: string
    projects: AppProject[]
  }

  interface AppStateResult {
    ok: boolean
    canceled?: boolean
    state?: AppState
    error?: string
  }

  interface CreateChatOptions {
    isolate?: boolean
  }

  interface IsolationStatus {
    ok: boolean
    git: boolean
    canIsolate: boolean
    hasHead: boolean
    reason?: string
    error?: string
  }

  interface SelectedFile {
    name: string
    path: string
    relPath?: string
    size?: number
  }

  interface ProjectDirectoryEntry extends SelectedFile {
    kind: 'file' | 'directory'
  }

  interface SelectFilesResult {
    ok: boolean
    canceled?: boolean
    files: SelectedFile[]
    error?: string
  }

  interface ProjectFileResult {
    ok: boolean
    content?: string
    path?: string
    relPath?: string
    error?: string
  }

  // The normalized event stream the UI renders — mirror of main's engine/types.ts.
  type AgentEvent =
    | { kind: 'session'; sessionId: string }
    | { kind: 'status'; status: string }
    | { kind: 'suggestion'; text: string }
    | { kind: 'commands'; commands: Array<{ name: string; source?: string }> }
    | { kind: 'text'; text: string }
    | { kind: 'thinking'; text: string }
    | {
        kind: 'tool'
        name: string
        phase: 'start' | 'update' | 'end'
        id?: string
        verb?: string
        target?: string
        body?: string
        failed?: boolean
      }
    | { kind: 'result'; ok: boolean; summary?: string }
    | { kind: 'error'; message: string }

  interface EngineEventPayload {
    sessionId: string
    event: AgentEvent
  }

  interface StartEngineArgs {
    engine: string
    model?: string
    options?: EngineRunOptions
    cwd?: string
  }

  interface StartResult {
    ok: boolean
    sessionId?: string
    error?: string
  }

  type EngineCommand =
    | { name: 'compact' }
    | { name: 'clear' }
    | { name: 'rollback'; turns?: number }
    | { name: 'steer'; value: string }
    | { name: 'goal'; action: 'get' | 'set' | 'clear'; value?: string }
    | { name: 'inventory'; target: 'plugins' | 'mcp' | 'skills' }
    | { name: 'utility'; command: string; args?: string }
    | { name: 'slash'; value: string }
    | { name: 'update' }

  interface EngineCommandResult {
    ok: boolean
    message?: string
    value?: string
    status?: string
    error?: string
  }

  interface NetRequest {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
  }

  interface NetResult {
    ok: boolean
    status?: number
    headers?: Record<string, string>
    body?: string
    error?: string
  }

  interface FeedbackPayload {
    message: string
    category?: string
    context?: Record<string, unknown>
  }

  interface FeedbackResult {
    ok: boolean
    stored: 'remote' | 'local'
    error?: string
  }

  interface AppUpdateState {
    checking: boolean
    currentVersion: string
    latestVersion?: string
    available: boolean
    releaseUrl?: string
    downloadUrl?: string
    checkedAt?: string
    error?: string
  }

  interface FilesResult {
    ok: boolean
    error?: string
  }

  interface FilesListResult extends FilesResult {
    entries?: { name: string; dir: boolean }[]
  }

  interface FilesReadResult extends FilesResult {
    contents?: string
  }

  interface Window {
    electron: ElectronBridge
    api: unknown
    y: YApi
    yKernelAuth: KernelAuthBridge
  }
}
