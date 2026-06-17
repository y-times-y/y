import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const params = new URLSearchParams(window.location.search)
;(window as Window & { __Y_PREVIEW__?: boolean }).__Y_PREVIEW__ = true
const engineListeners: Array<(payload: EngineEventPayload) => void> = []
;(window as Window & { __emitEngineEvent?: (event: AgentEvent, sessionId?: string) => void }).__emitEngineEvent = (
  event,
  sessionId = 'preview'
) => {
  for (const listener of engineListeners) listener({ sessionId, event })
}

const previewMessages: AppMsg[] =
  params.get('mode') === 'tool'
    ? [
        { role: 'assistant', text: 'I will make the button state easier to scan first.' },
        {
          role: 'tool',
          name: 'Edit',
          verb: 'Edit',
          target: 'panel.tsx',
          body:
            '- const color = "#ffffff"\n' +
            '+ const color = "#ff7b72"\n' +
            '- button.className = "old"\n' +
            '+ button.className = "primaryAction"',
          streaming: false
        },
        {
          role: 'assistant',
          text: 'The edit is in place. I will check the surrounding spacing next.'
        }
      ]
    : params.get('mode') === 'empty'
      ? []
    : [
          {
            role: 'assistant',
            text:
              'Here is a quick example:\n\n```python\nresult = await run_action("click", {"index": 3})\n```\n\nLet me know if you want to iterate on the layout or typography next.'
          },
          { role: 'user', text: 'Can you make the sidebar feel more like the reference?' }
        ]

const previewFileContents: Record<string, string> = {
  '/Users/hetpatel/Desktop/ytimesy/README.md':
    '# ytimesy\n\nA chat-first coding-agent desktop app.\n\n- Open files from the right rail\n- Preview markdown cleanly\n- Edit project files in place\n',
  '/Users/hetpatel/Desktop/ytimesy/app/userland-seed/panel.tsx':
    'export default function Panel() {\n  return <div>panel</div>\n}\n',
  '/Users/hetpatel/Desktop/ytimesy/app/src/main/engine/codex.ts':
    'export const engine = "codex"\n',
  '/Users/hetpatel/Desktop/ytimesy/app/e2e/ui.spec.ts':
    'import { test } from "@playwright/test"\n'
}

let previewState: AppState = {
  version: 1,
  activeProjectId: 'preview-ytimesy',
  activeChatId: 'preview-chat',
  projects: [
    {
      id: 'preview-ytimesy',
      name: 'ytimesy',
      path: '/Users/hetpatel/Desktop/ytimesy',
      open: true,
      chats: [
        {
          id: 'preview-chat',
          title: 'New chat',
          createdAt: '2026-06-14T00:00:00.000Z',
          updatedAt: '2026-06-14T00:00:00.000Z',
          messages: previewMessages
        }
      ]
    },
    {
      id: 'preview-agent-communication',
      name: 'Agent-communication',
      path: '/Users/hetpatel/Desktop/Desktop Organized/Folders/Projects/Agent-communication',
      open: true,
      chats: [
        {
          id: 'preview-chat-2',
          title: 'Explain agent communication',
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z',
          messages: []
        }
      ]
    }
  ]
}

window.y = {
  userland: {
    read: async () => '',
    getPath: async () => 'preview/panel.tsx',
    compile: async () => ({ ok: true, code: '' }),
    snapshot: async () => ({ ok: true }),
    revert: async () => ({ ok: true }),
    diff: async () => ({ ok: true, dirty: false }),
    onChanged: () => () => undefined
  },
  engine: {
    list: async () => ['claude-code', 'codex'],
    models: async () => [
      {
        engine: 'claude-code',
        label: 'Claude Code',
        defaultModel: 'claude-sonnet-4-6#effort=medium',
        models: [{ id: 'claude-sonnet-4-6#effort=medium', label: 'Sonnet 4.6 · Medium' }]
      },
      {
        engine: 'codex',
        label: 'Codex',
        defaultModel: 'gpt-5.5#effort=medium',
        models: [
          { id: 'gpt-5.5#effort=medium', label: 'GPT-5.5 · Medium' },
          { id: 'gpt-5.5#effort=high', label: 'GPT-5.5 · High' }
        ]
      }
    ],
    start: async () => ({ ok: true, sessionId: 'preview' }),
    startModify: async () => ({ ok: true, sessionId: 'preview' }),
    send: async () => ({ ok: true }),
    command: async (_sessionId, command) => ({
      ok: true,
      message:
        command.name === 'compact'
          ? 'Compacting context.'
          : command.name === 'clear'
            ? 'Context cleared.'
            : command.name === 'update'
              ? 'Checking for engine updates.'
            : command.name === 'inventory' && command.target === 'plugins'
              ? 'Listing plugins.'
            : command.name === 'inventory' && command.target === 'mcp'
              ? 'Listing MCP servers.'
            : command.name === 'inventory' && command.target === 'skills'
              ? 'Checking available skills.'
            : command.name === 'utility'
              ? command.command === 'pluginList'
                ? 'Listing plugins.'
                : command.command === 'pluginAdd'
                  ? 'Installing plugin.'
                  : `Running ${command.command}.`
            : command.name === 'goal' && command.action === 'set'
              ? `Goal set: ${command.value || ''}`
            : command.name === 'goal' && command.action === 'clear'
                ? 'Goal cleared.'
              : command.name === 'steer'
                ? 'Steered turn.'
              : command.name === 'rollback'
                ? 'Rolled back turn.'
              : 'Command handled.'
    }),
    cancel: async () => ({ ok: true }),
    onEvent: (cb) => {
      engineListeners.push(cb)
      return () => {
        const index = engineListeners.indexOf(cb)
        if (index !== -1) engineListeners.splice(index, 1)
      }
    }
  },
  app: {
    getState: async () => previewState,
    addProject: async () => ({ ok: false, canceled: true, state: previewState }),
    createChat: async (projectId?: string) => {
      const project = previewState.projects.find((p) => p.id === projectId) ?? previewState.projects[0]
      if (!project) return { ok: false, error: 'Open a project folder first.', state: previewState }
      const chat: AppChat = {
        id: `preview-chat-${Date.now()}`,
        title: 'New chat',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      }
      previewState = {
        ...previewState,
        activeProjectId: project.id,
        activeChatId: chat.id,
        projects: previewState.projects.map((p) =>
          p.id === project.id ? { ...p, open: true, chats: [chat, ...p.chats] } : p
        )
      }
      return { ok: true, state: previewState }
    },
    selectFiles: async () => ({
      ok: true,
      files: [
        {
          name: 'panel.tsx',
          path: '/Users/hetpatel/Desktop/ytimesy/app/userland-seed/panel.tsx',
          relPath: 'app/userland-seed/panel.tsx',
          size: 48200
        }
      ]
    }),
    listFiles: async () => ({
      ok: true,
      files: [
        { name: 'panel.tsx', path: '/Users/hetpatel/Desktop/ytimesy/app/userland-seed/panel.tsx', relPath: 'app/userland-seed/panel.tsx', size: 48200 },
        { name: 'codex.ts', path: '/Users/hetpatel/Desktop/ytimesy/app/src/main/engine/codex.ts', relPath: 'app/src/main/engine/codex.ts', size: 21000 },
        { name: 'ui.spec.ts', path: '/Users/hetpatel/Desktop/ytimesy/app/e2e/ui.spec.ts', relPath: 'app/e2e/ui.spec.ts', size: 8500 },
        { name: 'README.md', path: '/Users/hetpatel/Desktop/ytimesy/README.md', relPath: 'README.md', size: 1200 }
      ]
    }),
    readProjectFile: async (_projectId, filePath) => ({
      ok: Object.prototype.hasOwnProperty.call(previewFileContents, filePath),
      content: previewFileContents[filePath],
      error: Object.prototype.hasOwnProperty.call(previewFileContents, filePath) ? undefined : 'Missing preview file.'
    }),
    writeProjectFile: async (_projectId, filePath, content) => {
      previewFileContents[filePath] = content
      return { ok: true, content }
    },
    updateChat: async (projectId, chatId, patch) => {
      previewState = {
        ...previewState,
        projects: previewState.projects.map((project) =>
          project.id !== projectId
            ? project
            : {
                ...project,
                chats: project.chats.map((chat) =>
                  chat.id === chatId
                    ? {
                        ...chat,
                        ...patch,
                        updatedAt: new Date().toISOString()
                      }
                    : chat
                )
              }
        )
      }
      return { ok: true, state: previewState }
    },
    setActive: async (projectId, chatId) => {
      previewState = { ...previewState, activeProjectId: projectId, activeChatId: chatId }
      return { ok: true, state: previewState }
    },
    setProjectOpen: async (projectId, open) => {
      previewState = {
        ...previewState,
        projects: previewState.projects.map((p) => (p.id === projectId ? { ...p, open } : p))
      }
      return { ok: true, state: previewState }
    },
    onStateChanged: () => () => undefined
  },
  net: { request: async () => ({ ok: false, error: 'preview' }) },
  files: {
    root: async () => '/preview',
    list: async () => ({ ok: true, entries: [] }),
    read: async () => ({ ok: false }),
    write: async () => ({ ok: false }),
    mkdir: async () => ({ ok: false }),
    remove: async () => ({ ok: false })
  },
  terminal: {
    start: async () => ({ ok: true, id: `preview-terminal-${Date.now()}` }),
    write: async () => ({ ok: true }),
    resize: async () => ({ ok: true }),
    kill: async () => ({ ok: true }),
    onEvent: () => () => undefined
  },
  modify: {
    open: () => undefined,
    close: () => undefined,
    toggle: () => undefined,
    onChange: () => () => undefined
  }
}

async function boot(): Promise<void> {
  const { default: Panel } = await import('../../../../userland-seed/panel')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Panel />
    </StrictMode>
  )
}

void boot()
