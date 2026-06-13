import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const params = new URLSearchParams(window.location.search)
;(window as Window & { __Y_PREVIEW__?: boolean; __Y_PREVIEW_EMPTY__?: boolean }).__Y_PREVIEW__ =
  true
;(window as Window & { __Y_PREVIEW__?: boolean; __Y_PREVIEW_EMPTY__?: boolean }).__Y_PREVIEW_EMPTY__ =
  params.get('mode') === 'empty'

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
    start: async () => ({ ok: true, sessionId: 'preview' }),
    startModify: async () => ({ ok: true, sessionId: 'preview' }),
    send: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    onEvent: () => () => undefined
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
