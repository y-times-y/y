import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type EngineModelCatalog = {
  engine: string
  label: string
  logoUrl?: string
  defaultModel: string
  models: { id: string; label: string }[]
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

type ProjectFileResult = {
  ok: boolean
  content?: string
  error?: string
}

let modifyOpen = false
const modifyListeners = new Set<(open: boolean) => void>()

function emitModify(open: boolean): void {
  if (modifyOpen === open) return
  modifyOpen = open
  modifyListeners.forEach((cb) => cb(open))
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
    snapshot: (): Promise<{ ok: boolean; hash?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('userland:snapshot'),
    revert: (): Promise<{ ok: boolean; hash?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke('userland:revert'),
    // The pending change since the last snapshot (for the Keep/Discard gate).
    diff: (): Promise<{
      ok: boolean
      dirty?: boolean
      diff?: string
      hash?: string
      count?: number
      error?: string
    }> => ipcRenderer.invoke('userland:diff'),
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
    addProject: (): Promise<{ ok: boolean; canceled?: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:addProject'),
    createChat: (
      projectId?: string
    ): Promise<{ ok: boolean; state?: AppState; error?: string }> =>
      ipcRenderer.invoke('app:createChat', projectId),
    selectFiles: (
      projectId?: string
    ): Promise<{ ok: boolean; canceled?: boolean; files: SelectedFile[]; error?: string }> =>
      ipcRenderer.invoke('app:selectFiles', projectId),
    listFiles: (
      projectId?: string
    ): Promise<{ ok: boolean; files: SelectedFile[]; error?: string }> =>
      ipcRenderer.invoke('app:listFiles', projectId),
    readProjectFile: (
      projectId: string | undefined,
      filePath: string
    ): Promise<ProjectFileResult> =>
      ipcRenderer.invoke('app:readProjectFile', projectId, filePath),
    writeProjectFile: (
      projectId: string | undefined,
      filePath: string,
      content: string
    ): Promise<ProjectFileResult> =>
      ipcRenderer.invoke('app:writeProjectFile', projectId, filePath, content),
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
    onStateChanged: (cb: (state: AppState) => void): (() => void) => {
      const listener = (_e: unknown, state: AppState): void => cb(state)
      ipcRenderer.on('app:stateChanged', listener)
      return () => ipcRenderer.removeListener('app:stateChanged', listener)
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
  },
  modify: {
    open: () => emitModify(true),
    close: () => emitModify(false),
    toggle: () => emitModify(!modifyOpen),
    onChange: (cb: (open: boolean) => void): (() => void) => {
      modifyListeners.add(cb)
      cb(modifyOpen)
      return () => modifyListeners.delete(cb)
    }
  }
}

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('y', y)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.y = y
}
