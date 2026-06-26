import * as React from 'react'
import UserlandHost from './UserlandHost'
import ModifyChat from './ModifyChat'

const ONBOARDING_DONE_KEY = 'y.onboarding.done'
const ONBOARDING_CLI_DONE_KEY = 'y.onboarding.cli.v2.done'

function mainChatReady(): boolean {
  return (
    window.localStorage.getItem(ONBOARDING_DONE_KEY) === 'true' &&
    window.localStorage.getItem(ONBOARDING_CLI_DONE_KEY) === 'true'
  )
}

function trackKernelEvent(name: string, props?: Record<string, unknown>): void {
  void window.y.analytics.track(name, props)
}

function shortUpdateError(error?: string): string {
  if (!error) return 'The update could not be installed.'
  if (/code signature|satisfy specified code requirement|validation/iu.test(error)) {
    return 'macOS rejected the downloaded update signature. Download the latest y again, or try after quitting y completely.'
  }
  if (/not start the installer|applications/iu.test(error)) {
    return 'macOS could not start the installer. Move y to Applications and try again.'
  }
  return error.length > 140 ? `${error.slice(0, 137).trim()}...` : error
}

function UpdateNotice(): React.JSX.Element | null {
  const [state, setState] = React.useState<AppUpdateState | null>(null)
  const [dismissedVersion, setDismissedVersion] = React.useState(() =>
    window.localStorage.getItem('y.dismissedUpdateVersion') || ''
  )

  React.useEffect(() => {
    let mounted = true
    void window.y.updates.get().then((next) => {
      if (mounted) setState(next)
    })
    const off = window.y.updates.onChanged((next) => setState(next))
    return () => {
      mounted = false
      off()
    }
  }, [])

  if (!state?.available || !state.latestVersion || dismissedVersion === state.latestVersion) return null
  const isDownloading = state.phase === 'downloading'
  const isDownloaded = state.phase === 'downloaded'
  const isInstalling = state.phase === 'installing'
  const hasUpdateError = state.phase === 'error' && Boolean(state.error)
  const disableUpdate = isDownloading || isDownloaded || isInstalling
  const progressText =
    typeof state.progress === 'number' ? ` ${Math.max(0, Math.min(100, Math.round(state.progress)))}%` : ''
  const copy = isDownloading
    ? `Downloading y ${state.latestVersion}.${progressText}`
    : isDownloaded
      ? `Preparing y ${state.latestVersion}...`
      : isInstalling
        ? `Restarting y to install ${state.latestVersion}...`
        : hasUpdateError
          ? `Could not install y ${state.latestVersion}.`
          : `y ${state.latestVersion} is ready.`
  const badgeCopy = hasUpdateError ? 'Update failed' : 'Update available'
  const buttonCopy = disableUpdate ? 'Updating...' : hasUpdateError ? 'Try again' : 'Update now'

  return (
    <div className="kernel-update-notice" role="status" aria-live="polite">
      <div className="kernel-update-badge">{badgeCopy}</div>
      <div className="kernel-update-copy">{copy}</div>
      {hasUpdateError ? <div className="kernel-update-error">{shortUpdateError(state.error)}</div> : null}
      <div className="kernel-update-actions">
        <button
          className="kernel-update-now"
          disabled={disableUpdate}
          type="button"
          onClick={() => {
            trackKernelEvent('app_update_opened', { latestVersion: state.latestVersion })
            void window.y.updates
              .open()
              .then((result) => {
                if (!result.ok) {
                  void window.y.updates.get().then((next) => setState(next))
                }
              })
              .catch(() => {
                void window.y.updates.get().then((next) => setState(next))
              })
          }}
        >
          {buttonCopy}
        </button>
        <button
          className="kernel-update-later"
          disabled={disableUpdate}
          type="button"
          onClick={() => {
            window.localStorage.setItem('y.dismissedUpdateVersion', state.latestVersion!)
            setDismissedVersion(state.latestVersion!)
            trackKernelEvent('app_update_dismissed', { latestVersion: state.latestVersion })
          }}
        >
          Later
        </button>
      </div>
    </div>
  )
}

function userlandMergePrompt(status: UserlandSeedStatus, choices: UserlandUpdateChoice[]): string {
  return [
    'A bundled y interface update is available.',
    '',
    'Selected optional changes:',
    ...choices.map((choice) => `- ${choice.id}: ${choice.title} — ${choice.description}`),
    '',
    'Current customized app UI: panel.tsx',
    'Bundled update to merge from: .y/pending-panel.tsx',
    '',
    'Please compare both files and update panel.tsx with only the selected useful changes from .y/pending-panel.tsx.',
    'Preserve my existing local customizations. If a line differs, prefer the current panel.tsx unless the selected update clearly requires changing it.',
    'Do not overwrite panel.tsx wholesale. Do not call resetToSeed. Do not copy .y/pending-panel.tsx over panel.tsx.',
    'Keep panel.tsx valid TSX with exactly one default export.',
    status.updateManifest?.version ? `Update manifest version: ${status.updateManifest.version}` : '',
    status.pendingSeedVersion ? `Bundled update version: ${status.pendingSeedVersion}` : ''
  ].filter(Boolean).join('\n')
}

type UserlandUpdateChoice = {
  id: string
  title: string
  description: string
  required: boolean
}

function userlandUpdateChoices(status: UserlandSeedStatus): UserlandUpdateChoice[] {
  const manifestItems = status.updateManifest?.items || []
  if (manifestItems.length) return manifestItems
  return [
    {
      id: 'bundled-userland',
      title: 'Bring the new app changes into my version',
      description: `Modify will compare your current app with the new default${status.pendingSeedVersion ? ` (${status.pendingSeedVersion})` : ''} and keep your customizations unless this update needs a specific change.`,
      required: false
    }
  ]
}

function UserlandUpdateNotice({
  onApplySelected
}: {
  onApplySelected: (prompt: string) => void
}): React.JSX.Element | null {
  const [status, setStatus] = React.useState<UserlandSeedStatus | null>(null)
  const [error, setError] = React.useState('')
  const [confirmDefault, setConfirmDefault] = React.useState(false)
  const [reviewFeatures, setReviewFeatures] = React.useState(false)
  const [restoreDismissed, setRestoreDismissed] = React.useState(
    () => window.localStorage.getItem('y.dismissedDefaultRestore') === 'true'
  )
  const [dismissedHash, setDismissedHash] = React.useState(() =>
    window.localStorage.getItem('y.dismissedUserlandSeedHash') || ''
  )
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    let mounted = true
    const load = (): void => {
      void window.y.userland.seedStatus().then((next) => {
        if (mounted) setStatus(next)
      })
    }
    load()
    const off = window.y.userland.onChanged(load)
    return () => {
      mounted = false
      off()
    }
  }, [])

  if (!status) return null
  if (!status.pending || !status.pendingSeedHash || dismissedHash === status.pendingSeedHash) {
    if (!status.restoreDefaultAvailable || restoreDismissed) return null
    return (
      <div className="kernel-update-notice kernel-userland-update-notice" role="status" aria-live="polite">
        <div className="kernel-update-badge">Custom app saved</div>
        <div className="kernel-update-copy">
          You are using the default y interface. Your previous customized app was saved, so you can bring it back.
        </div>
        {error ? <div className="kernel-update-error">{error}</div> : null}
        <div className="kernel-update-actions kernel-restore-actions">
          <button
            className="kernel-update-now"
            type="button"
            onClick={() => {
              setError('')
              void window.y.userland.restoreDefaultResetBackup().then((result) => {
                if (!result.ok) {
                  setError(result.error || 'Could not restore your customized app.')
                } else {
                  window.localStorage.removeItem('y.dismissedDefaultRestore')
                  setRestoreDismissed(false)
                  void window.y.userland.seedStatus().then((next) => setStatus(next))
                }
              })
            }}
          >
            Restore my custom app
          </button>
          <button
            className="kernel-update-later"
            type="button"
            onClick={() => {
              window.localStorage.setItem('y.dismissedDefaultRestore', 'true')
              setRestoreDismissed(true)
            }}
          >
            Done
          </button>
        </div>
      </div>
    )
  }
  const choices = userlandUpdateChoices(status)
  const selectedChoices = choices.filter((choice) => choice.required || selected[choice.id] !== false)
  const canApply = selectedChoices.length > 0
  const dismissCurrentSeed = (): void => {
    window.localStorage.setItem('y.dismissedUserlandSeedHash', status.pendingSeedHash!)
    setDismissedHash(status.pendingSeedHash!)
  }

  return (
    <div className="kernel-update-notice kernel-userland-update-notice" role="status" aria-live="polite">
      <div className="kernel-update-badge">App UI update</div>
      {confirmDefault ? (
        <div className="kernel-update-copy">
          This replaces your customized app UI with the default y interface. Your current app will be saved so you can restore it later.
        </div>
      ) : reviewFeatures ? (
        <>
          <div className="kernel-update-copy">
            Choose changes to apply. y will ask Modify to merge only the selected changes into your current interface.
          </div>
          <div className="kernel-userland-update-list">
            {choices.map((choice) => (
              <label className="kernel-userland-update-choice" key={choice.id}>
                <input
                  type="checkbox"
                  checked={choice.required || selected[choice.id] !== false}
                  disabled={choice.required}
                  onChange={(event) =>
                    setSelected((current) => ({ ...current, [choice.id]: event.currentTarget.checked }))
                  }
                />
                <span>
                  <strong>{choice.title}</strong>
                  <small>{choice.description}</small>
                </span>
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="kernel-update-copy">
            Your customized app is safe. y can add these changes to your current interface, or you can leave it as it is.
          </div>
        </>
      )}
      {error ? <div className="kernel-update-error">{error}</div> : null}
      {confirmDefault ? (
        <div className="kernel-update-actions kernel-default-confirm-actions">
          <button
            className="kernel-update-now"
            type="button"
            onClick={() => {
              setError('')
              dismissCurrentSeed()
              void window.y.userland.resetToSeed().then((result) => {
                if (!result.ok) {
                  setDismissedHash('')
                  window.localStorage.removeItem('y.dismissedUserlandSeedHash')
                  setError(result.error || 'Could not switch to the default app.')
                } else {
                  window.localStorage.removeItem('y.dismissedDefaultRestore')
                  setRestoreDismissed(false)
                  setConfirmDefault(false)
                  void window.y.userland.seedStatus().then((next) => setStatus(next))
                }
              })
            }}
          >
            Switch to default y
          </button>
          <button className="kernel-update-later" type="button" onClick={() => setConfirmDefault(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          {reviewFeatures ? (
            <div className="kernel-update-actions kernel-userland-review-actions">
              <button
                className="kernel-update-now"
                disabled={!canApply}
                type="button"
                onClick={() => {
                  setError('')
                  dismissCurrentSeed()
                  onApplySelected(userlandMergePrompt(status, selectedChoices))
                }}
              >
                Apply selected changes
              </button>
              <button className="kernel-update-later" type="button" onClick={() => setReviewFeatures(false)}>
                Back
              </button>
              <button
                className="kernel-update-later"
                type="button"
                onClick={() => {
                  setError('')
                  dismissCurrentSeed()
                }}
              >
                Leave as is
              </button>
            </div>
          ) : (
            <div className="kernel-update-actions kernel-userland-primary-actions">
              <button className="kernel-update-now" type="button" onClick={() => setReviewFeatures(true)}>
                Select changes
              </button>
              <button
                className="kernel-update-later"
                type="button"
                onClick={() => {
                  setError('')
                  dismissCurrentSeed()
                }}
              >
                Leave as is
              </button>
            </div>
          )}
          <button className="kernel-update-text-action" type="button" onClick={() => setConfirmDefault(true)}>
            Switch to default y...
          </button>
        </>
      )}
    </div>
  )
}

// Kernel frame: Userland fills the window; Modify is a Kernel-owned rail.
function Shell(): React.JSX.Element {
  const [modifyOpen, setModifyOpen] = React.useState(false)
  const [modifyWidth, setModifyWidth] = React.useState(420)
  const [showKernelCards, setShowKernelCards] = React.useState(mainChatReady)
  const [modifyPromptRequest, setModifyPromptRequest] = React.useState<
    { id: string; text: string; autoSubmit: boolean } | undefined
  >()
  const [userlandLayout, setUserlandLayout] = React.useState({ fileRailOpen: false, fileRailWidth: 326 })

  function beginModifyResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = modifyWidth
    const max = Math.min(640, Math.floor(window.innerWidth * 0.5))
    let shouldCollapse = false
    document.documentElement.classList.add('is-modify-resizing')
    const move = (moveEvent: PointerEvent): void => {
      const rawWidth = startWidth - (moveEvent.clientX - startX)
      shouldCollapse = rawWidth < 284
      setModifyWidth(Math.min(max, Math.max(340, rawWidth)))
    }
    const stop = (): void => {
      document.documentElement.classList.remove('is-modify-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      if (shouldCollapse) window.requestAnimationFrame(() => setModifyOpen(false))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  React.useEffect(() => {
    if (window.electron?.process?.platform === 'darwin') {
      document.documentElement.classList.add('platform-darwin')
    }
    return window.electron?.window?.onFullscreen((full: boolean) => {
      document.documentElement.classList.toggle('is-fullscreen', full)
    })
  }, [])

  React.useEffect(() => {
    const sync = (): void => setShowKernelCards(mainChatReady())
    sync()
    window.addEventListener('storage', sync)
    window.addEventListener('y:kernel-storage-changed', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('y:kernel-storage-changed', sync)
    }
  }, [])

  const openModify = React.useCallback((source: string): void => {
    setModifyOpen((open) => {
      if (!open) trackKernelEvent('modify_opened', { source })
      return true
    })
  }, [])

  const closeModify = React.useCallback((source: string): void => {
    setModifyOpen((open) => {
      if (open) trackKernelEvent('modify_closed', { source })
      return false
    })
  }, [])

  const toggleModify = React.useCallback((source: string): void => {
    setModifyOpen((open) => {
      trackKernelEvent(open ? 'modify_closed' : 'modify_opened', { source })
      return !open
    })
  }, [])

  const applyUserlandUpdateWithModify = React.useCallback(
    (prompt: string): void => {
      setModifyPromptRequest({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text: prompt,
        autoSubmit: true
      })
      openModify('userland-update')
    },
    [openModify]
  )

  return (
    <div className="kernel-shell">
      <div
        className={
          'kernel-body' +
          (modifyOpen ? ' is-modify-open' : '') +
          (userlandLayout.fileRailOpen ? ' is-file-rail-open' : '')
        }
        style={
          {
            '--modify-rail-width': `${modifyWidth}px`,
            '--userland-file-rail-width': `${userlandLayout.fileRailWidth}px`
          } as React.CSSProperties
        }
      >
        <div className="kernel-drag-region kernel-drag-region-top" aria-hidden="true" />
        <main className="userland-slot">
          <UserlandHost
            modifyOpen={modifyOpen}
            onModifyOpen={() => openModify('userland')}
            onModifyClose={() => closeModify('userland')}
            onModifyToggle={() => toggleModify('userland')}
            onUserlandLayout={(state) =>
              setUserlandLayout({
                fileRailOpen: state.fileRailOpen,
                fileRailWidth: state.fileRailWidth ?? 326
              })
            }
          />
        </main>

        <aside
          className={'modify-rail' + (modifyOpen ? ' is-open' : '')}
          aria-hidden={!modifyOpen}
          style={{ '--modify-rail-width': `${modifyWidth}px` } as React.CSSProperties}
        >
          <div
            className="modify-resize-handle"
            role="separator"
            tabIndex={modifyOpen ? 0 : -1}
            aria-label="Resize Modify sidebar"
            aria-orientation="vertical"
            onPointerDown={beginModifyResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setModifyWidth((width) => Math.min(640, width + 10))
              if (event.key === 'ArrowRight') setModifyWidth((width) => Math.max(340, width - 10))
            }}
          />
          <ModifyChat onClose={() => closeModify('modify')} promptRequest={modifyPromptRequest} />
        </aside>
        {showKernelCards ? (
          <div className="kernel-notice-stack" aria-live="polite">
            <UserlandUpdateNotice onApplySelected={applyUserlandUpdateWithModify} />
            <UpdateNotice />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Shell
