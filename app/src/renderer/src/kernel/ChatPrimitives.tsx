import * as React from 'react'
import { MarkdownBody } from './markdown'
import { ToolActivity, diffStat, toolVerbFromName } from './ToolActivity'

export type ChatPrimitiveMessage = {
  role: string
  id?: string
  text?: string
  name?: string
  verb?: string
  target?: string
  body?: string
  streaming?: boolean
  system?: boolean
  checkpointId?: string
}

export type ChatWorkEntry = {
  message: ChatPrimitiveMessage
  index: number
}

function normalizeToolTarget(target: string): string {
  return target.replace(/\\/g, '/').replace(/^\.?\//u, '')
}

function stripReadLineNumbers(body: string): string {
  return body
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\t/u, ''))
    .join('\n')
}

export type ChatSurfaceClasses = {
  thinking: string
  thinkingBody: string
  toolNote: string
  workLog: string
  workBody: string
  workNarration: string
  editedFiles: string
  editedFilesHead: string
  editedFilesActions: string
  editedFile: string
  editedFileButton: string
  editedUndo: string
  completedTurn: string
  userRow: string
  userWrap: string
  userBubble: string
  inlineEdit: string
  userActions: string
  messageAction: string
  assistant: string
  assistantFooter: string
  messageMenu: string
  messageMenuPopover: string
  composer: string
  composerRow: string
  composerDropIndicator?: string
  composerDropIcon?: string
}

export const CHAT_SURFACE_CLASSES = {
  main: {
    thinking: 'y-thinking',
    thinkingBody: 'y-thinking-body',
    toolNote: 'y-tool-note',
    workLog: 'y-work-log',
    workBody: 'y-work-body',
    workNarration: 'y-work-narration',
    editedFiles: 'y-edited-files',
    editedFilesHead: 'y-edited-files-head',
    editedFilesActions: 'y-edited-files-actions',
    editedFile: 'y-edited-file',
    editedFileButton: 'y-edited-file-button',
    editedUndo: 'y-edited-undo',
    completedTurn: 'y-completed-turn',
    userRow: 'y-user-row',
    userWrap: 'y-user-wrap',
    userBubble: 'y-user-bubble',
    inlineEdit: 'y-inline-edit',
    userActions: 'y-user-actions',
    messageAction: 'y-message-action',
    assistant: 'y-assistant',
    assistantFooter: 'y-assistant-footer',
    messageMenu: 'y-message-menu',
    messageMenuPopover: 'y-message-menu-popover',
    composer: 'y-composer',
    composerRow: 'y-composer-row',
    composerDropIndicator: 'y-composer-drop-indicator',
    composerDropIcon: 'y-composer-drop-icon'
  },
  modify: {
    thinking: 'modify-thinking',
    thinkingBody: 'modify-thinking-body',
    toolNote: 'modify-tool-note',
    workLog: 'modify-work-log',
    workBody: 'modify-work-body',
    workNarration: 'modify-work-narration',
    editedFiles: 'modify-edited-files',
    editedFilesHead: 'modify-edited-files-head',
    editedFilesActions: 'modify-edited-files-actions',
    editedFile: 'modify-edited-file',
    editedFileButton: 'modify-edited-file-button',
    editedUndo: 'modify-edited-undo',
    completedTurn: 'modify-completed-turn',
    userRow: 'modify-user-row',
    userWrap: 'modify-user-wrap',
    userBubble: 'modify-user-bubble',
    inlineEdit: 'modify-inline-edit',
    userActions: 'modify-user-actions',
    messageAction: 'modify-message-action',
    assistant: 'modify-assistant-message',
    assistantFooter: 'modify-assistant-footer',
    messageMenu: 'modify-message-menu',
    messageMenuPopover: 'modify-message-menu-popover',
    composer: 'modify-composer',
    composerRow: 'modify-composer-row'
  }
} satisfies Record<string, ChatSurfaceClasses>

export function ChatIcon({ name, size = 16 }: { name: string; size?: number }): React.JSX.Element {
  if (name === 'brain') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M8.1 4.2A2.6 2.6 0 005.4 6.8v.3A2.8 2.8 0 004 9.5c0 1 .5 1.9 1.3 2.4v.5A2.6 2.6 0 008 15h.1M11.9 4.2a2.6 2.6 0 012.7 2.6v.3A2.8 2.8 0 0116 9.5c0 1-.5 1.9-1.3 2.4v.5A2.6 2.6 0 0112 15h-.1M10 3.8v12.4M7.1 8.1c.9 0 1.6.7 1.6 1.6M12.9 8.1c-.9 0-1.6.7-1.6 1.6M7.3 12.1c.8 0 1.4.6 1.4 1.4M12.7 12.1c-.8 0-1.4.6-1.4 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'chevron') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'copy') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M13.5 6.5V5A1.5 1.5 0 0012 3.5H5A1.5 1.5 0 003.5 5v7A1.5 1.5 0 005 13.5h1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  }
  if (name === 'check') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M4.5 10.5l3.4 3.4 7.6-8.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'x') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'menu') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="5" cy="10" r="1.3" fill="currentColor" />
        <circle cx="10" cy="10" r="1.3" fill="currentColor" />
        <circle cx="15" cy="10" r="1.3" fill="currentColor" />
      </svg>
    )
  }
  if (name === 'undo') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M8 5L4 9l4 4M4.5 9H12a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M12.5 3.5l4 4L8 16H4v-4l8.5-8.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 5l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function CopyMessageButton({
  className,
  size,
  onCopy
}: {
  className: string
  size: number
  onCopy: () => void
}): React.JSX.Element {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  function handleClick(): void {
    onCopy()
    setCopied(true)
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      setCopied(false)
      timeoutRef.current = null
    }, 1400)
  }

  return (
    <button
      type="button"
      className={`${className}${copied ? ' is-copied' : ''}`}
      aria-label={copied ? 'Copied message' : 'Copy message'}
      title={copied ? 'Copied' : 'Copy message'}
      onClick={handleClick}
    >
      <ChatIcon name={copied ? 'check' : 'copy'} size={size} />
    </button>
  )
}

export function ChatThinkingBlock({
  message,
  classes
}: {
  message: ChatPrimitiveMessage
  classes: ChatSurfaceClasses
}): React.JSX.Element {
  return (
    <details className={classes.thinking} open={message.streaming ? true : undefined} data-testid="thinking-block">
      <summary><ChatIcon name="brain" size={15} /><span>Thinking</span><ChatIcon name="chevron" size={12} /></summary>
      <div className={classes.thinkingBody}>{message.text}</div>
    </details>
  )
}

export function ChatToolMessage({
  message,
  langFromTarget
}: {
  message: ChatPrimitiveMessage
  langFromTarget: (target?: string) => string
}): React.JSX.Element {
  const verb = message.verb || toolVerbFromName(message.name || 'tool')
  return (
    <ToolActivity
      verb={verb}
      name={message.name}
      target={message.target}
      body={message.body}
      live={message.streaming}
      lang={langFromTarget(message.target)}
    />
  )
}

export function ChatWorkSummary({
  work,
  durationMs,
  interrupted,
  classes,
  testId,
  formatDuration,
  langFromTarget
}: {
  work: ChatWorkEntry[]
  durationMs?: number
  interrupted?: boolean
  classes: ChatSurfaceClasses
  testId: string
  formatDuration: (durationMs?: number) => string
  langFromTarget: (target?: string) => string
}): React.JSX.Element {
  return (
    <details className={classes.workLog} data-testid={testId}>
      <summary><span>{interrupted ? 'Interrupted after' : 'Worked for'} {formatDuration(durationMs)}</span><ChatIcon name="chevron" size={13} /></summary>
      <div className={classes.workBody}>
        {work.map(({ message, index }) => {
          if (message.role === 'assistant') return <div key={index} className={classes.workNarration}><MarkdownBody text={message.text ?? ''} /></div>
          if (message.role === 'thinking') return <ChatThinkingBlock key={index} message={message} classes={classes} />
          if (message.role === 'tool') return message.system ? <div key={index} className={classes.toolNote}>{message.name}</div> : <ChatToolMessage key={index} message={message} langFromTarget={langFromTarget} />
          return null
        })}
      </div>
    </details>
  )
}

function isEditableToolMessage(message: ChatPrimitiveMessage): boolean {
  if (message.role !== 'tool' || message.system) return false
  const verb = (message.verb || toolVerbFromName(message.name || 'tool')).toLowerCase()
  return verb === 'edit' || verb === 'write'
}

export function chatWorkHasCollapsibleTool(work: ChatWorkEntry[]): boolean {
  return work.some(({ message }) => message.role === 'tool' && !message.system)
}

export function ChatEditedFilesSummary({
  work,
  classes,
  testId,
  onUndo,
  onOpenFile
}: {
  work: ChatWorkEntry[]
  classes: ChatSurfaceClasses
  testId: string
  onUndo?: () => void
  onOpenFile?: (file: string, diff: string, oldContent?: string) => void
}): React.JSX.Element | null {
  const edited = new Map<string, { added: number; removed: number; diff: string[]; oldContent?: string }>()
  const reads = new Map<string, string>()
  for (const entry of work) {
    if (entry.message.target && entry.message.body && toolVerbFromName(entry.message.name || entry.message.verb || '') === 'Read') {
      reads.set(normalizeToolTarget(entry.message.target), stripReadLineNumbers(entry.message.body))
      continue
    }
    if (!isEditableToolMessage(entry.message) || !entry.message.target) continue
    const stat = diffStat(entry.message.body) ?? { added: 0, removed: 0 }
    const normalizedTarget = normalizeToolTarget(entry.message.target)
    const current = edited.get(entry.message.target) ?? { added: 0, removed: 0, diff: [], oldContent: reads.get(normalizedTarget) }
    edited.set(entry.message.target, {
      added: current.added + stat.added,
      removed: current.removed + stat.removed,
      diff: entry.message.body ? current.diff.concat(entry.message.body) : current.diff,
      oldContent: current.oldContent ?? reads.get(normalizedTarget)
    })
  }
  if (!edited.size) return null
  const totals = Array.from(edited.values()).reduce(
    (sum, stat) => ({ added: sum.added + stat.added, removed: sum.removed + stat.removed }),
    { added: 0, removed: 0 }
  )
  return (
    <div className={classes.editedFiles} data-testid={testId}>
      <div className={classes.editedFilesHead}>
        <strong>Edited {edited.size} {edited.size === 1 ? 'file' : 'files'}</strong>
        <span className={classes.editedFilesActions}>
          <span><b>+{totals.added}</b> <i>-{totals.removed}</i></span>
          {onUndo ? (
            <button type="button" className={classes.editedUndo} aria-label="Undo edited files" title="Undo edited files" onClick={onUndo}>
              <ChatIcon name="undo" size={13} />
              <span>Undo</span>
            </button>
          ) : null}
        </span>
      </div>
      {Array.from(edited).map(([file, stat]) => {
        const content = (
          <>
            <span>{file}</span>
            <span><b>+{stat.added}</b> <i>-{stat.removed}</i></span>
          </>
        )
        return onOpenFile ? (
          <button key={file} type="button" className={`${classes.editedFile} ${classes.editedFileButton}`} onClick={() => onOpenFile(file, stat.diff.join('\n'), stat.oldContent)}>
            {content}
          </button>
        ) : (
          <div key={file} className={classes.editedFile}>
            {content}
          </div>
        )
      })}
    </div>
  )
}

export function ChatUserMessage({
  text,
  editingText,
  classes,
  testId,
  editTestId,
  actions = true,
  onCopy,
  onStartEdit,
  onEditChange,
  onSubmitEdit,
  onCancelEdit
}: {
  text: string
  editingText?: string
  classes: ChatSurfaceClasses
  testId: string
  editTestId?: string
  actions?: boolean
  onCopy: () => void
  onStartEdit: () => void
  onEditChange: (value: string) => void
  onSubmitEdit: () => void
  onCancelEdit: () => void
}): React.JSX.Element {
  const editing = editingText !== undefined
  return (
    <div className={classes.userRow} data-testid={testId}>
      <div className={`${classes.userWrap}${editing ? ' is-editing' : ''}`}>
        <div className={classes.userBubble}>
          {editing ? (
            <textarea
              className={classes.inlineEdit}
              data-testid={editTestId}
              value={editingText}
              autoFocus
              onChange={(event) => onEditChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onCancelEdit()
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onSubmitEdit()
              }}
            />
          ) : text}
        </div>
        {actions ? (
          <div className={classes.userActions}>
            <CopyMessageButton className={classes.messageAction} size={13} onCopy={onCopy} />
            {editing ? (
              <>
                <button type="button" className={classes.messageAction} aria-label="Submit edited message" title="Submit edited message" onClick={onSubmitEdit}>
                  <ChatIcon name="check" size={13} />
                </button>
                <button type="button" className={classes.messageAction} aria-label="Cancel edit" title="Cancel edit" onClick={onCancelEdit}>
                  <ChatIcon name="x" size={13} />
                </button>
              </>
            ) : (
              <button type="button" className={classes.messageAction} aria-label="Edit message" title="Edit message" onClick={onStartEdit}>
                <ChatIcon name="edit" size={13} />
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function ChatAssistantMessage({
  text,
  streaming,
  checkpointId,
  classes,
  testId,
  onCopy,
  onReset,
  onLinkClick
}: {
  text: string
  streaming?: boolean
  checkpointId?: string
  classes: ChatSurfaceClasses
  testId?: string
  onCopy: () => void
  onReset: (event: React.MouseEvent<HTMLButtonElement>) => void
  onLinkClick?: (href: string, label: string, event: React.MouseEvent<HTMLAnchorElement>) => boolean | void
}): React.JSX.Element {
  function handleClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (!onLinkClick) return
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a')
    if (!(anchor instanceof HTMLAnchorElement)) return
    const handled = onLinkClick(anchor.getAttribute('href') || anchor.href, anchor.textContent || '', event as unknown as React.MouseEvent<HTMLAnchorElement>)
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  return (
    <div className={`${classes.assistant}${streaming ? ' is-streaming' : ''}`} data-testid={testId} onClick={handleClick}>
      <MarkdownBody text={text} streaming={Boolean(streaming)} />
      {checkpointId ? (
        <div className={classes.assistantFooter}>
          <CopyMessageButton className={classes.messageAction} size={18} onCopy={onCopy} />
          <details className={classes.messageMenu}>
            <summary className={classes.messageAction} aria-label="More message actions" title="More">
              <ChatIcon name="menu" size={18} />
            </summary>
            <div className={classes.messageMenuPopover}>
              <button type="button" onClick={onReset}>
                <ChatIcon name="undo" size={15} />
                Reset to this point
              </button>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  )
}

export function ChatComposerShell({
  classes,
  testId,
  inputTestId,
  inputRef,
  isDropTarget = false,
  dropOverlay,
  placeholder,
  onInput,
  onPaste,
  onKeyDown,
  children
}: {
  classes: ChatSurfaceClasses
  testId: string
  inputTestId?: string
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  isDropTarget?: boolean
  dropOverlay?: React.ReactNode
  placeholder: string
  onInput: (value: string) => void
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`${classes.composer}${isDropTarget ? ' is-drop-target' : ''}`} data-testid={testId}>
      {dropOverlay && classes.composerDropIndicator ? (
        <div className={classes.composerDropIndicator} data-testid="drop-overlay" aria-hidden="true">
          <div className={classes.composerDropIcon}>{dropOverlay}</div>
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        defaultValue=""
        rows={1}
        data-testid={inputTestId}
        data-native-input="true"
        onChange={(event) => onInput(event.currentTarget.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      {children}
    </div>
  )
}
