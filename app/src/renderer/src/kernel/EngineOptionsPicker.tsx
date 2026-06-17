import * as React from 'react'

type EngineOptionsPickerProps = {
  engineId: string
  value: EngineRunOptions
  onChange: (next: EngineRunOptions) => void
  disabled?: boolean
  className?: string
}

const CLAUDE_UTILITY_OPTIONS: Array<{ value: NonNullable<EngineRunOptions['claudeUtilityCommand']>; label: string }> = [
  { value: 'doctor', label: 'Doctor health check' },
  { value: 'autoModeConfig', label: 'Auto mode config' },
  { value: 'autoModeDefaults', label: 'Auto mode defaults' },
  { value: 'autoModeCritique', label: 'Auto mode critique' },
  { value: 'authStatus', label: 'Auth status' },
  { value: 'authLogin', label: 'Auth login' },
  { value: 'authLogout', label: 'Auth logout' },
  { value: 'setupToken', label: 'Setup token' },
  { value: 'install', label: 'Install native build' },
  { value: 'update', label: 'Update Claude Code' },
  { value: 'projectPurge', label: 'Purge project state' },
  { value: 'pluginList', label: 'List plugins' },
  { value: 'pluginDetails', label: 'Plugin details' },
  { value: 'pluginValidate', label: 'Validate plugin' },
  { value: 'pluginInstall', label: 'Install plugin' },
  { value: 'pluginEnable', label: 'Enable plugin' },
  { value: 'pluginDisable', label: 'Disable plugin' },
  { value: 'pluginUninstall', label: 'Uninstall plugin' },
  { value: 'pluginUpdate', label: 'Update plugin' },
  { value: 'pluginPrune', label: 'Prune plugins' },
  { value: 'pluginTag', label: 'Tag plugin release' },
  { value: 'pluginInit', label: 'Create plugin' },
  { value: 'pluginMarketplaceList', label: 'List marketplaces' },
  { value: 'pluginMarketplaceAdd', label: 'Add marketplace' },
  { value: 'pluginMarketplaceRemove', label: 'Remove marketplace' },
  { value: 'pluginMarketplaceUpdate', label: 'Update marketplace' },
  { value: 'mcpList', label: 'List MCP servers' },
  { value: 'mcpGet', label: 'MCP server details' },
  { value: 'mcpAdd', label: 'Add MCP server' },
  { value: 'mcpAddJson', label: 'Add MCP from JSON' },
  { value: 'mcpRemove', label: 'Remove MCP server' },
  { value: 'mcpServe', label: 'Serve MCP' },
  { value: 'mcpResetProjectChoices', label: 'Reset MCP project choices' }
]

const CODEX_UTILITY_OPTIONS: Array<{ value: NonNullable<EngineRunOptions['codexUtilityCommand']>; label: string }> = [
  { value: 'loginStatus', label: 'Login status' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'doctor', label: 'Doctor health check' },
  { value: 'pluginList', label: 'List plugins' },
  { value: 'pluginAdd', label: 'Install plugin' },
  { value: 'pluginRemove', label: 'Remove plugin' },
  { value: 'mcpList', label: 'List MCP servers' },
  { value: 'mcpGet', label: 'MCP server details' },
  { value: 'mcpAdd', label: 'Add MCP server' },
  { value: 'mcpRemove', label: 'Remove MCP server' },
  { value: 'mcpLogin', label: 'MCP login' },
  { value: 'mcpLogout', label: 'MCP logout' },
  { value: 'pluginMarketplaceList', label: 'List plugin marketplaces' },
  { value: 'pluginMarketplaceAdd', label: 'Add plugin marketplace' },
  { value: 'pluginMarketplaceRemove', label: 'Remove plugin marketplace' },
  { value: 'pluginMarketplaceUpdate', label: 'Update plugin marketplace' },
  { value: 'completion', label: 'Shell completions' },
  { value: 'update', label: 'Update Codex' },
  { value: 'debugModels', label: 'Debug models' },
  { value: 'featuresList', label: 'Feature flags' },
  { value: 'featuresEnable', label: 'Enable feature' },
  { value: 'featuresDisable', label: 'Disable feature' },
  { value: 'cloudList', label: 'Cloud task list' },
  { value: 'cloudStatus', label: 'Cloud task status' },
  { value: 'cloudApply', label: 'Cloud task apply' },
  { value: 'cloudDiff', label: 'Cloud task diff' },
  { value: 'cloudExec', label: 'Cloud task exec' },
  { value: 'apply', label: 'Apply cloud diff' },
  { value: 'resume', label: 'Resume interactive session' },
  { value: 'fork', label: 'Fork interactive session' },
  { value: 'mcpServer', label: 'Start MCP server' },
  { value: 'appServer', label: 'App server' },
  { value: 'app', label: 'Open Codex app' },
  { value: 'execServer', label: 'Exec server' },
  { value: 'sandboxMacos', label: 'macOS sandbox' },
  { value: 'sandboxLinux', label: 'Linux sandbox' },
  { value: 'sandboxWindows', label: 'Windows sandbox' },
  { value: 'debugAppServer', label: 'Debug app server' },
  { value: 'debugPromptInput', label: 'Debug prompt input' }
]

const CLAUDE_TARGET_COMMANDS = new Set<NonNullable<EngineRunOptions['claudeUtilityCommand']>>([
  'install',
  'pluginDetails',
  'pluginInstall',
  'pluginEnable',
  'pluginDisable',
  'pluginUninstall',
  'pluginUpdate',
  'pluginInit',
  'pluginMarketplaceAdd',
  'pluginMarketplaceRemove',
  'pluginMarketplaceUpdate',
  'mcpGet',
  'mcpAdd',
  'mcpAddJson',
  'mcpRemove'
])

const CLAUDE_PATH_COMMANDS = new Set<NonNullable<EngineRunOptions['claudeUtilityCommand']>>([
  'projectPurge',
  'pluginValidate',
  'pluginTag'
])

function hasAdvancedOptions(engineId: string, options: EngineRunOptions): boolean {
  if (options.ephemeral || options.sessionName?.trim() || options.workingDirectory?.trim()) return true
  if (engineId === 'claude-code') {
    return Boolean(
      options.claudePromptSuggestions ||
        options.claudeHookEvents ||
        options.claudeBrief ||
        options.claudeAllowedTools?.trim() ||
        options.claudeDisallowedTools?.trim() ||
        options.claudeAgent?.trim() ||
        options.claudeSystemPrompt?.trim() ||
        options.claudeSystemPromptFile?.trim() ||
        options.claudeAppendSystemPrompt?.trim() ||
        options.claudeAppendSystemPromptFile?.trim() ||
        options.claudeFallbackModel?.trim() ||
        options.claudeAddDirs?.trim() ||
        options.claudePluginDirs?.trim() ||
        options.claudePluginUrls?.trim() ||
        options.claudeMcpConfigs?.trim() ||
        options.claudeSettings?.trim() ||
        options.claudeAgentsJson?.trim() ||
        options.claudeFiles?.trim() ||
        options.claudeDebug !== undefined ||
        options.claudeDebugFile?.trim() ||
        options.claudeDangerouslySkipPermissions ||
        options.claudeAllowDangerouslySkipPermissions ||
        options.claudeBare ||
        options.claudeIde ||
        options.claudeChrome !== undefined ||
        options.claudeRemoteControlName?.trim() ||
        options.claudeWorktreeName?.trim() ||
        (options.claudeTmux && options.claudeTmux !== 'off')
    )
  }
  return Boolean(
    options.codexProfile?.trim() ||
      options.codexAddDirs?.trim() ||
      options.codexImages?.trim() ||
      options.codexOutputSchema?.trim() ||
      options.codexEnableFeatures?.trim() ||
      options.codexDisableFeatures?.trim() ||
      options.codexConfigOverrides?.trim() ||
      options.codexOutputLastMessage?.trim() ||
      options.codexRemote?.trim() ||
      options.codexRemoteAuthTokenEnv?.trim() ||
      options.codexNoAltScreen ||
      options.codexDangerouslyBypassApprovalsAndSandbox
  )
}

function optionCount(engineId: string, options: EngineRunOptions): number {
  let count = 0
  if (engineId === 'claude-code') {
    if (options.claudeCommand && options.claudeCommand !== 'chat') count += 1
    if (options.claudePermissionMode && options.claudePermissionMode !== 'default') count += 1
    if (options.claudeToolMode && options.claudeToolMode !== 'safe') count += 1
    if (options.claudeInitialResume && options.claudeInitialResume !== 'new') count += 1
    if (hasAdvancedOptions(engineId, options)) count += 1
  } else {
    if (options.codexCommand && options.codexCommand !== 'chat') count += 1
    if (options.codexWebSearch) count += 1
    if (options.codexAskForApproval && options.codexAskForApproval !== 'default') count += 1
    if (options.codexInitialResume && options.codexInitialResume !== 'new') count += 1
    if (hasAdvancedOptions(engineId, options)) count += 1
  }
  return count
}

export function defaultRunOptions(): EngineRunOptions {
  return {
    claudePermissionMode: 'default',
    claudeToolMode: 'safe',
    claudeDangerouslySkipPermissions: true,
    codexAskForApproval: 'never',
    codexDangerouslyBypassApprovalsAndSandbox: true
  }
}

function Row({
  title,
  copy,
  children,
  danger
}: {
  title: string
  copy?: string
  children: React.ReactNode
  danger?: boolean
}): React.JSX.Element {
  return (
    <label className={'ui-option-field' + (danger ? ' danger' : '')}>
      <span className="ui-option-title">{title}</span>
      {children}
      {copy ? <span className="ui-option-copy">{copy}</span> : null}
    </label>
  )
}

function Check({
  title,
  copy,
  checked,
  onChange,
  danger
}: {
  title: string
  copy?: string
  checked: boolean
  onChange: (checked: boolean) => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <label className={'ui-option-row' + (danger ? ' danger' : '')}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="ui-option-title">{title}</span>
        {copy ? <span className="ui-option-copy">{copy}</span> : null}
      </span>
    </label>
  )
}

export function EngineOptionsPicker({
  engineId,
  value,
  onChange,
  disabled,
  className
}: EngineOptionsPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const count = optionCount(engineId, value)
  const patch = (next: Partial<EngineRunOptions>): void => onChange({ ...value, ...next })

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div
      ref={rootRef}
      className={'ui-picker ui-options-picker' + (className ? ' ' + className : '') + (open ? ' is-open' : '')}
    >
      <button
        type="button"
        className="ui-picker-btn ui-options-picker-btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Engine options"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="ui-picker-label">{count ? `${count} set` : 'Options'}</span>
        <svg className="ui-picker-chevron" width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="ui-picker-menu ui-options-menu" role="menu">
          {engineId === 'claude-code' ? (
            <>
              <Row title="Mode">
                <select
                  value={value.claudeCommand ?? 'chat'}
                  onChange={(e) => patch({ claudeCommand: e.target.value as EngineRunOptions['claudeCommand'] })}
                >
                  <option value="chat">Chat</option>
                  <option value="ultrareview">Code review</option>
                  <option value="agents">Background agents</option>
                  <option value="utility">Utilities</option>
                </select>
              </Row>

              {value.claudeCommand === 'utility' ? (
                <>
                  <Row title="Utility">
                    <select
                      value={value.claudeUtilityCommand ?? 'doctor'}
                      onChange={(e) =>
                        patch({ claudeUtilityCommand: e.target.value as EngineRunOptions['claudeUtilityCommand'] })
                      }
                    >
                      {CLAUDE_UTILITY_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Row>
                  {CLAUDE_TARGET_COMMANDS.has(value.claudeUtilityCommand ?? 'doctor') ? (
                    <Row title="Target">
                      <input
                        value={value.claudeUtilityTarget ?? ''}
                        onChange={(e) => patch({ claudeUtilityTarget: e.target.value })}
                        placeholder="name, source, or server"
                      />
                    </Row>
                  ) : null}
                  {CLAUDE_PATH_COMMANDS.has(value.claudeUtilityCommand ?? 'doctor') ? (
                    <Row title="Path">
                      <input
                        value={value.claudeUtilityPath ?? ''}
                        onChange={(e) => patch({ claudeUtilityPath: e.target.value })}
                        placeholder="project or plugin path"
                      />
                    </Row>
                  ) : null}
                </>
              ) : null}

              {value.claudeCommand === 'ultrareview' ? (
                <>
                  <Row title="Review target">
                    <input
                      value={value.claudeUltrareviewTarget ?? ''}
                      onChange={(e) => patch({ claudeUltrareviewTarget: e.target.value })}
                      placeholder="branch, PR number, or URL"
                    />
                  </Row>
                  <Row title="Timeout">
                    <input
                      value={value.claudeUltrareviewTimeoutMinutes ?? ''}
                      onChange={(e) => patch({ claudeUltrareviewTimeoutMinutes: e.target.value })}
                      placeholder="minutes"
                    />
                  </Row>
                </>
              ) : null}

              <Row title="Permission mode">
                <select
                  value={value.claudePermissionMode ?? 'default'}
                  onChange={(e) =>
                    patch({
                      claudePermissionMode: e.target.value as NonNullable<EngineRunOptions['claudePermissionMode']>
                    })
                  }
                >
                  <option value="default">Ask normally</option>
                  <option value="acceptEdits">Accept edits</option>
                  <option value="auto">Auto approve safe actions</option>
                  <option value="plan">Plan first</option>
                  <option value="dontAsk">Do not ask</option>
                  <option value="bypassPermissions">Bypass permissions</option>
                </select>
              </Row>

              <Row title="Tool access">
                <select
                  value={value.claudeToolMode ?? 'safe'}
                  onChange={(e) => patch({ claudeToolMode: e.target.value as EngineRunOptions['claudeToolMode'] })}
                >
                  <option value="safe">Safe y default</option>
                  <option value="default">Claude default</option>
                  <option value="custom">Custom</option>
                </select>
              </Row>

              {value.claudeToolMode === 'custom' ? (
                <Row title="Custom tools">
                  <input
                    value={value.claudeTools ?? ''}
                    onChange={(e) => patch({ claudeTools: e.target.value })}
                    placeholder="Read, Glob, Grep, Bash"
                  />
                </Row>
              ) : null}

              <Row title="Start from">
                <select
                  value={value.claudeInitialResume ?? 'new'}
                  onChange={(e) => patch({ claudeInitialResume: e.target.value as EngineRunOptions['claudeInitialResume'] })}
                >
                  <option value="new">New chat</option>
                  <option value="continue">Most recent</option>
                  <option value="resume">Session id</option>
                  <option value="fromPr">Pull request</option>
                </select>
              </Row>
            </>
          ) : (
            <>
              <Row title="Mode">
                <select
                  value={value.codexCommand ?? 'chat'}
                  onChange={(e) => patch({ codexCommand: e.target.value as EngineRunOptions['codexCommand'] })}
                >
                  <option value="chat">Chat</option>
                  <option value="review">Code review</option>
                  <option value="utility">Utilities</option>
                </select>
              </Row>

              {value.codexCommand === 'utility' ? (
                <>
                  <Row title="Utility">
                    <select
                      value={value.codexUtilityCommand ?? 'loginStatus'}
                      onChange={(e) => patch({ codexUtilityCommand: e.target.value as EngineRunOptions['codexUtilityCommand'] })}
                    >
                      {CODEX_UTILITY_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Row>
                  <Row title="Target">
                    <input
                      value={value.codexUtilityTarget ?? ''}
                      onChange={(e) => patch({ codexUtilityTarget: e.target.value })}
                      placeholder="task, server, feature, shell"
                    />
                  </Row>
                </>
              ) : null}

              {value.codexCommand === 'review' ? (
                <>
                  <Row title="Review scope">
                    <select
                      value={value.codexReviewMode ?? 'default'}
                      onChange={(e) => patch({ codexReviewMode: e.target.value as EngineRunOptions['codexReviewMode'] })}
                    >
                      <option value="default">Current branch</option>
                      <option value="uncommitted">Uncommitted changes</option>
                      <option value="base">Against base branch</option>
                      <option value="commit">Specific commit</option>
                    </select>
                  </Row>
                  {value.codexReviewMode === 'base' ? (
                    <Row title="Base branch">
                      <input
                        value={value.codexReviewBase ?? ''}
                        onChange={(e) => patch({ codexReviewBase: e.target.value })}
                        placeholder="main"
                      />
                    </Row>
                  ) : null}
                  {value.codexReviewMode === 'commit' ? (
                    <Row title="Commit">
                      <input
                        value={value.codexReviewCommit ?? ''}
                        onChange={(e) => patch({ codexReviewCommit: e.target.value })}
                        placeholder="abc123"
                      />
                    </Row>
                  ) : null}
                </>
              ) : null}

              <Check
                title="Web search"
                copy="Enable Codex's native web search tool."
                checked={value.codexWebSearch === true}
                onChange={(checked) => patch({ codexWebSearch: checked })}
              />

              <Row title="Approval policy">
                <select
                  value={value.codexAskForApproval ?? 'default'}
                  onChange={(e) => patch({ codexAskForApproval: e.target.value as EngineRunOptions['codexAskForApproval'] })}
                >
                  <option value="default">Use config default</option>
                  <option value="untrusted">Ask on untrusted commands</option>
                  <option value="on-request">Model decides</option>
                  <option value="on-failure">Ask after failure</option>
                  <option value="never">Never ask</option>
                </select>
              </Row>
            </>
          )}

          <details className="ui-option-details">
            <summary>Advanced CLI</summary>
            <div className="ui-option-details-body">
              <Check
                title="Temporary session"
                checked={value.ephemeral === true}
                onChange={(checked) => patch({ ephemeral: checked })}
              />
              <Row title="Session name">
                <input value={value.sessionName ?? ''} onChange={(e) => patch({ sessionName: e.target.value })} />
              </Row>
              <Row title="Working directory">
                <input
                  value={value.workingDirectory ?? ''}
                  onChange={(e) => patch({ workingDirectory: e.target.value })}
                  placeholder="absolute path"
                />
              </Row>

              {engineId === 'claude-code' ? (
                <>
                  <Check
                    title="Prompt suggestions"
                    checked={value.claudePromptSuggestions === true}
                    onChange={(checked) => patch({ claudePromptSuggestions: checked })}
                  />
                  <Check
                    title="Hook events"
                    copy="Debug-only; hidden from normal chat unless enabled."
                    checked={value.claudeHookEvents === true}
                    onChange={(checked) => patch({ claudeHookEvents: checked })}
                  />
                  <Check
                    title="Brief replies"
                    checked={value.claudeBrief === true}
                    onChange={(checked) => patch({ claudeBrief: checked })}
                  />
                  <Row title="Always allow tools">
                    <input value={value.claudeAllowedTools ?? ''} onChange={(e) => patch({ claudeAllowedTools: e.target.value })} />
                  </Row>
                  <Row title="Block tools">
                    <input value={value.claudeDisallowedTools ?? ''} onChange={(e) => patch({ claudeDisallowedTools: e.target.value })} />
                  </Row>
                  <Row title="System prompt">
                    <textarea
                      value={value.claudeSystemPrompt ?? ''}
                      onChange={(e) => patch({ claudeSystemPrompt: e.target.value })}
                      rows={3}
                    />
                  </Row>
                  <Row title="Append prompt">
                    <textarea
                      value={value.claudeAppendSystemPrompt ?? ''}
                      onChange={(e) => patch({ claudeAppendSystemPrompt: e.target.value })}
                      rows={3}
                    />
                  </Row>
                  <Row title="MCP configs">
                    <textarea
                      value={value.claudeMcpConfigs ?? ''}
                      onChange={(e) => patch({ claudeMcpConfigs: e.target.value })}
                      rows={2}
                    />
                  </Row>
                  <Row title="Plugin folders">
                    <textarea
                      value={value.claudePluginDirs ?? ''}
                      onChange={(e) => patch({ claudePluginDirs: e.target.value })}
                      rows={2}
                    />
                  </Row>
                  <Row title="Plugin URLs">
                    <textarea
                      value={value.claudePluginUrls ?? ''}
                      onChange={(e) => patch({ claudePluginUrls: e.target.value })}
                      rows={2}
                    />
                  </Row>
                  <Row title="Utility extra args">
                    <input
                      value={value.claudeUtilityRawArgs ?? ''}
                      onChange={(e) => patch({ claudeUtilityRawArgs: e.target.value })}
                    />
                  </Row>
                  <Check
                    title="Skip permissions now"
                    danger
                    checked={value.claudeDangerouslySkipPermissions === true}
                    onChange={(checked) => patch({ claudeDangerouslySkipPermissions: checked })}
                  />
                </>
              ) : (
                <>
                  <Check
                    title="Ignore repo rules"
                    checked={value.codexIgnoreRules === true}
                    onChange={(checked) => patch({ codexIgnoreRules: checked })}
                  />
                  <Check
                    title="Ignore user config"
                    checked={value.codexIgnoreUserConfig === true}
                    onChange={(checked) => patch({ codexIgnoreUserConfig: checked })}
                  />
                  <Row title="Config overrides">
                    <textarea
                      value={value.codexConfigOverrides ?? ''}
                      onChange={(e) => patch({ codexConfigOverrides: e.target.value })}
                      rows={3}
                    />
                  </Row>
                  <Row title="Enable features">
                    <input value={value.codexEnableFeatures ?? ''} onChange={(e) => patch({ codexEnableFeatures: e.target.value })} />
                  </Row>
                  <Row title="Disable features">
                    <input value={value.codexDisableFeatures ?? ''} onChange={(e) => patch({ codexDisableFeatures: e.target.value })} />
                  </Row>
                  <Row title="Utility extra args">
                    <input
                      value={value.codexUtilityRawArgs ?? ''}
                      onChange={(e) => patch({ codexUtilityRawArgs: e.target.value })}
                    />
                  </Row>
                  <Check
                    title="Bypass approvals and sandbox"
                    danger
                    checked={value.codexDangerouslyBypassApprovalsAndSandbox === true}
                    onChange={(checked) => patch({ codexDangerouslyBypassApprovalsAndSandbox: checked })}
                  />
                </>
              )}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  )
}
