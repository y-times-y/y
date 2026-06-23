import { clipboard, contextBridge, ipcRenderer } from 'electron'

type EngineModelCatalog = {
  engine: string
  label: string
  logoUrl?: string
  defaultModel: string
  models: { id: string; label: string; contextWindow?: number }[]
}

type OnboardingCliCheckResult = {
  ok: boolean
  checkedAt: string
  tools: Array<{
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
  }>
}

type SnapshotEntry = {
  hash: string
  shortHash: string
  message: string
  label: string
  kind: 'original' | 'change' | 'snapshot'
  timestamp: string
  current?: boolean
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

type EngineRunOptions = {
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

type AppMsg = {
  role: 'user' | 'assistant' | 'tool' | 'thinking'
  text?: string
  name?: string
  id?: string
  verb?: string
  target?: string
  body?: string
  streaming?: boolean
  system?: boolean
  engineId?: string
  terminalId?: string
  terminalRunning?: boolean
  checkpointId?: string
  durationMs?: number
  interrupted?: boolean
}

type AppChat = {
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

type ModifyChatRecord = {
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

type ModifyChatResult = {
  ok: boolean
  chats?: ModifyChatRecord[]
  chat?: ModifyChatRecord
  activeChatId?: string
  error?: string
}

type AppProject = {
  id: string
  name: string
  path: string
  open: boolean
  chats: AppChat[]
}

type AppState = {
  version: 1
  activeProjectId?: string
  activeChatId?: string
  projects: AppProject[]
}

type SelectedFile = {
  name: string
  path: string
  relPath?: string
  size?: number
}

type ProjectDirectoryEntry = SelectedFile & {
  kind: 'file' | 'directory'
}

type ProjectFileResult = {
  ok: boolean
  content?: string
  path?: string
  relPath?: string
  error?: string
}

type CreateChatOptions = {
  isolate?: boolean
}

type IsolationStatus = {
  ok: boolean
  git: boolean
  canIsolate: boolean
  hasHead: boolean
  reason?: string
  error?: string
}

const electron = {
  process: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  },
  window: {
    onFullscreen: (cb: (full: boolean) => void): (() => void) => {
      const listener = (_e: unknown, full: boolean): void => cb(full)
      ipcRenderer.on('window:fullscreen', listener)
      return () => ipcRenderer.removeListener('window:fullscreen', listener)
    }
  }
}

// y's brick-box: the ONLY powers Userland (the renderer) can reach.
// Each brick is a thin wrapper over an IPC call to the Kernel (main process),
// so the Kernel stays the gatekeeper for everything privileged.
const y = {
  userland: {
    read: (): Promise<string> => ipcRenderer.invoke('userland:read'),
    getPath: (): Promise<string> => ipcRenderer.invoke('userland:path'),
    compile: (): Promise<{ ok: boolean; code?: string; error?: string }> =>
      ipcRenderer.invoke('userland:compile'),
    snapshot: (message?: string): Promise<{ ok: boolean; hash?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('userland:snapshot', message),
    revert: (): Promise<{ ok: boolean; hash?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('userland:revert'),
    history: (): Promise<{ ok: boolean; entries?: SnapshotEntry[]; error?: string }> =>
      ipcRenderer.invoke('userland:history'),
    restoreSnapshot: (hash: string): Promise<{ ok: boolean; hash?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('userland:restoreSnapshot', hash),
    checkpoint: (): Promise<{ ok: boolean; checkpointId?: string; error?: string }> =>
      ipcRenderer.invoke('userland:checkpoint'),
    restoreCheckpoint: (checkpointId: string): Promise<{ ok: boolean; checkpointId?: string; error?: string }> =>
      ipcRenderer.invoke('userland:restoreCheckpoint', checkpointId),
    resetToSeed: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('userland:resetToSeed'),
    // Subscribe to live disk changes; returns an unsubscribe function.
    onChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('userland:changed', listener)
      return () => ipcRenderer.removeListener('userland:changed', listener)
    }
  },
  // Engine bricks: drive a coding-agent CLI and receive its streamed output.
  engine: {
    list: (): Promise<string[]> => ipcRenderer.invoke('engine:list'),
    models: (): Promise<EngineModelCatalog[]> => ipcRenderer.invoke('engine:models'),
    checkCliStatus: (): Promise<OnboardingCliCheckResult> => ipcRenderer.invoke('engine:checkCliStatus'),
    start: (args: { engine: string; model?: string; options?: EngineRunOptions; cwd?: string }) =>
      ipcRenderer.invoke('engine:start', args),
    // Modify session: write access pinned to the Userland dir (Kernel-controlled).
    startModify: (args: { engine: string; model?: string; options?: EngineRunOptions }) =>
      ipcRenderer.invoke('engine:startModify', args),
    send: (sessionId: string, prompt: string) =>
      ipcRenderer.invoke('engine:send', sessionId, prompt),
    command: (sessionId: string, command: EngineCommand) =>
      ipcRenderer.invoke('engine:command', sessionId, command),
    cancel: (sessionId: string) => ipcRenderer.invoke('engine:cancel', sessionId),
    // The streaming side: fires for every event the engine emits. The callback
    // gets { sessionId, event } so a chat can ignore events from other sessions.
    onEvent: (cb: (payload: { sessionId: string; event: unknown }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { sessionId: string; event: unknown }): void =>
        cb(payload)
      ipcRenderer.on('engine:event', listener)
      return () => ipcRenderer.removeListener('engine:event', listener)
    }
  },
  // Real project/chat state owned by the Kernel. Userland can present and
  // update state, but native folder access and persistence stay in main.
  app: {
    getState: (): Promise<AppState> => ipcRenderer.invoke('app:getState'),
    checkpoint: (projectId?: string): Promise<{ ok: boolean; checkpointId?: string; error?: string }> =>
      ipcRenderer.invoke('app:checkpoint', projectId),
    restoreCheckpoint: (projectId: string | undefined, checkpointId: string): Promise<{ ok: boolean; checkpointId?: string; error?: string }> =>
      ipcRenderer.invoke('app:restoreCheckpoint', projectId, checkpointId),
    addProject: (): Promise<{ ok: boolean; canceled?: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:addProject'),
    getIsolationStatus: (
      projectId?: string
    ): Promise<IsolationStatus> =>
      ipcRenderer.invoke('app:getIsolationStatus', projectId),
    createChat: (
      projectId?: string,
      options?: CreateChatOptions
    ): Promise<{ ok: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:createChat', projectId, options),
    selectFiles: (
      projectId?: string
    ): Promise<{ ok: boolean; canceled?: boolean; files: SelectedFile[]; error?: string }> =>
      ipcRenderer.invoke('app:selectFiles', projectId),
    searchFiles: (
      projectId: string | undefined,
      query: string,
      workspaceRoot?: string
    ): Promise<{ ok: boolean; files: SelectedFile[]; error?: string }> =>
      ipcRenderer.invoke('app:searchFiles', projectId, query, workspaceRoot),
    listDirectory: (
      projectId: string | undefined,
      directory?: string,
      workspaceRoot?: string
    ): Promise<{ ok: boolean; entries: ProjectDirectoryEntry[]; error?: string }> =>
      ipcRenderer.invoke('app:listDirectory', projectId, directory, workspaceRoot),
    watchFiles: (projectId?: string, workspaceRoot?: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('app:watchFiles', projectId, workspaceRoot),
    unwatchFiles: (projectId?: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('app:unwatchFiles', projectId),
    onFilesChanged: (cb: (payload: { projectId: string; paths: string[] }) => void): (() => void) => {
      const listener = (_e: unknown, payload: { projectId: string; paths: string[] }): void => cb(payload)
      ipcRenderer.on('app:filesChanged', listener)
      return () => ipcRenderer.removeListener('app:filesChanged', listener)
    },
    readProjectFile: (
      projectId: string | undefined,
      filePath: string,
      workspaceRoot?: string
    ): Promise<ProjectFileResult> =>
      ipcRenderer.invoke('app:readProjectFile', projectId, filePath, workspaceRoot),
    writeProjectFile: (
      projectId: string | undefined,
      filePath: string,
      content: string,
      workspaceRoot?: string
    ): Promise<ProjectFileResult> =>
      ipcRenderer.invoke('app:writeProjectFile', projectId, filePath, content, workspaceRoot),
    updateChat: (
      projectId: string,
      chatId: string,
      patch: { title?: string; messages?: AppMsg[]; archived?: boolean; engineId?: string; modelId?: string; goal?: string; runOptions?: EngineRunOptions }
    ): Promise<{ ok: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:updateChat', projectId, chatId, patch),
    setActive: (
      projectId: string,
      chatId: string
    ): Promise<{ ok: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:setActive', projectId, chatId),
    setProjectOpen: (
      projectId: string,
      open: boolean
    ): Promise<{ ok: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:setProjectOpen', projectId, open),
    removeProject: (
      projectId: string
    ): Promise<{ ok: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:removeProject', projectId),
    listModifyChats: (): Promise<ModifyChatResult> =>
      ipcRenderer.invoke('app:listModifyChats'),
    createModifyChat: (
      seed?: { engineId?: string; modelId?: string; runOptions?: EngineRunOptions }
    ): Promise<ModifyChatResult> =>
      ipcRenderer.invoke('app:createModifyChat', seed),
    updateModifyChat: (
      chatId: string,
      patch: { title?: string; messages?: AppMsg[]; archived?: boolean; engineId?: string; modelId?: string; runOptions?: EngineRunOptions }
    ): Promise<ModifyChatResult> =>
      ipcRenderer.invoke('app:updateModifyChat', chatId, patch),
    setActiveModifyChat: (chatId: string): Promise<ModifyChatResult> =>
      ipcRenderer.invoke('app:setActiveModifyChat', chatId),
    onStateChanged: (cb: (state: AppState) => void): (() => void) => {
      const listener = (_e: unknown, state: AppState): void => cb(state)
      ipcRenderer.on('app:stateChanged', listener)
      return () => ipcRenderer.removeListener('app:stateChanged', listener)
    }
  },
  auth: {
    load: () => ipcRenderer.invoke('kernel-auth:load'),
    restore: () => ipcRenderer.invoke('kernel-auth:restore'),
    signIn: () => ipcRenderer.invoke('kernel-auth:signIn'),
    clear: () => ipcRenderer.invoke('kernel-auth:clear'),
    onChanged: (cb: (session: unknown) => void): (() => void) => {
      const listener = (_event: unknown, session: unknown): void => cb(session)
      ipcRenderer.on('kernel-auth:changed', listener)
      return () => ipcRenderer.removeListener('kernel-auth:changed', listener)
    }
  },
  feedback: {
    submit: (payload: {
      message: string
      category?: string
      context?: Record<string, unknown>
    }): Promise<{ ok: boolean; stored: 'remote' | 'local'; error?: string }> =>
      ipcRenderer.invoke('feedback:submit', payload)
  },
  analytics: {
    identify: (payload: { userId: string; email?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('analytics:identify', payload),
    track: (name: string, props?: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('analytics:track', name, props ?? {}),
    reportMissingBrick: (report: {
      brick: string
      reason: string
      surface: string
      confidence: string
      engineId?: string
    }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('analytics:reportMissingBrick', report)
  },
  clipboard: {
    writeText: (text: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        clipboard.writeText(text)
        return Promise.resolve({ ok: true })
      } catch (err) {
        return Promise.resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
  },
  // ---- Capability bricks (Phase 6): general powers Userland composes into ----
  // features. Each is consent-gated in main; Userland can't bypass the prompt.
  // Network: a fetch proxied through main (no renderer CSP limits).
  net: {
    request: (req: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
    }) => ipcRenderer.invoke('net:request', req)
  },
  // Files: read/write a private workspace folder (paths are locked inside it).
  files: {
    root: (): Promise<string> => ipcRenderer.invoke('files:root'),
    list: (path?: string) => ipcRenderer.invoke('files:list', path ?? '.'),
    read: (path: string) => ipcRenderer.invoke('files:read', path),
    write: (path: string, contents: string) => ipcRenderer.invoke('files:write', path, contents),
    mkdir: (path: string) => ipcRenderer.invoke('files:mkdir', path),
    remove: (path: string) => ipcRenderer.invoke('files:remove', path)
  },
  terminal: {
    start: (args: { id?: string; cwd?: string; command?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:start', args),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onEvent: (
      cb: (event: { kind: 'data' | 'exit' | 'error'; id: string; data?: string; exitCode?: number; message?: string }) => void
    ): (() => void) => {
      const listener = (
        _e: unknown,
        event: { kind: 'data' | 'exit' | 'error'; id: string; data?: string; exitCode?: number; message?: string }
      ): void => cb(event)
      ipcRenderer.on('terminal:event', listener)
      return () => ipcRenderer.removeListener('terminal:event', listener)
    }
  }
}

// Custom APIs for renderer
const api = {}

const yKernelAuth = {
  load: () => ipcRenderer.invoke('kernel-auth:load'),
  restore: () => ipcRenderer.invoke('kernel-auth:restore'),
  signIn: () => ipcRenderer.invoke('kernel-auth:signIn'),
  clear: () => ipcRenderer.invoke('kernel-auth:clear'),
  openExternal: (url: string) => ipcRenderer.invoke('kernel-auth:openExternal', url),
  onCallback: (cb: (url: string) => void): (() => void) => {
    const listener = (_event: unknown, url: string): void => cb(url)
    ipcRenderer.on('auth:callback', listener)
    return () => ipcRenderer.removeListener('auth:callback', listener)
  },
  onChanged: (cb: (session: unknown) => void): (() => void) => {
    const listener = (_event: unknown, session: unknown): void => cb(session)
    ipcRenderer.on('kernel-auth:changed', listener)
    return () => ipcRenderer.removeListener('kernel-auth:changed', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electron)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('y', y)
    contextBridge.exposeInMainWorld('yKernelAuth', yKernelAuth)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electron
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.y = y
  // @ts-ignore (define in dts)
  window.yKernelAuth = yKernelAuth
}
