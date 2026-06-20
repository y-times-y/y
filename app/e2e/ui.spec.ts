import { test, expect } from '@playwright/test'
import { join } from 'path'

const shots = join(__dirname, '..', 'e2e', 'screenshots')

test.describe('y chat UI', () => {
  test('empty state matches production layout', async ({ page }) => {
    await page.goto('/preview.html?mode=empty')
    await expect(page.getByTestId('y-app')).toBeVisible()
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByTestId('binary-y')).toHaveAttribute('aria-label', 'y')
    await expect(page.locator('.binary-y-digits')).toHaveText(/^[01\s]+$/)
    await expect(page.getByTestId('y-sidebar')).toBeVisible()
    await expect(page.getByTestId('composer')).toBeVisible()
    await expect(page.getByTestId('composer-input')).toHaveAttribute(
      'placeholder',
      /Ask for follow-up changes|Starting engine/
    )
    await expect(page.locator('.y-drop-btn').first()).toContainText(/Claude Code|Codex/)
    await expect(page.locator('.y-drop-btn').nth(1)).toContainText(/Sonnet|GPT-5|Opus|Haiku/)
    await expect(page.getByTestId('send-button')).toBeVisible()
    await page.screenshot({ path: join(shots, 'empty-state.png'), fullPage: true })
  })

  test('conversation state has sidebar, messages, and composer', async ({ page }) => {
    await page.goto('/preview.html')
    await expect(page.getByTestId('y-sidebar')).toBeVisible()
    await expect(page.getByTestId('nav-new')).toBeVisible()
    await expect(page.getByText('Open folders')).toBeVisible()
    await expect(page.getByTestId('active-chat')).toBeVisible()
    await expect(page.getByTestId('assistant-message')).toBeVisible()
    await expect(page.getByTestId('user-message')).toBeVisible()
    await expect(page.getByTestId('code-block')).toBeVisible()
    await expect(page.getByTestId('composer-input')).toBeVisible()
    await expect(page.getByTestId('composer-input')).toHaveAttribute('data-native-input', 'true')
    await expect(page.locator('.y-drop-btn').first()).toBeVisible()
    await expect(page.locator('.y-drop-btn').first()).toContainText(/Claude Code|Codex/)
    await page.getByRole('button', { name: 'Attach' }).click()
    await expect(page.getByTestId('attachments')).toContainText('panel.tsx')
    await expect(page.getByText('/Users/hetpatel/Desktop/ytimesy')).toHaveCount(0)
    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('chat-title')).toHaveText('Settings')
    await expect(page.getByTestId('settings-view')).toContainText('General')
    await expect(page.getByTestId('composer')).toHaveCount(0)
    await page.getByRole('button', { name: 'MCP & Plugins' }).click()
    await expect(page.getByRole('button', { name: 'Plugins', exact: true })).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'MCP', exact: true })).toHaveCount(2)

    const sidebar = page.getByTestId('y-sidebar')
    const main = page.getByTestId('y-main')
    const sidebarBox = await sidebar.boundingBox()
    const mainBox = await main.boundingBox()
    expect(sidebarBox?.width).toBeGreaterThan(220)
    expect(sidebarBox?.width).toBeLessThan(280)
    expect(mainBox?.width).toBeGreaterThan(900)

    await page.screenshot({ path: join(shots, 'conversation-state.png'), fullPage: true })
  })

  test('sidebar toggles without breaking composer', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('sidebar-toggle').click()
    await expect(page.getByTestId('y-sidebar')).toHaveClass(/is-collapsed/)
    await expect(page.getByTestId('composer')).toBeVisible()
    await page.screenshot({ path: join(shots, 'sidebar-collapsed.png'), fullPage: true })
  })

  test('terminal dock toggles without killing the terminal', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('terminal-dock-button').click()
    await expect(page.getByTestId('terminal-dock')).toHaveClass(/is-open/)
    await expect(page.getByTestId('composer-terminal')).toContainText('preview terminal')

    await page.getByTestId('composer-terminal').getByRole('button', { name: 'Hide terminal' }).click()
    await expect(page.getByTestId('terminal-dock')).not.toHaveClass(/is-open/)
    await expect(page.getByTestId('composer-terminal')).toHaveCount(1)

    await page.getByTestId('terminal-dock-button').click()
    await expect(page.getByTestId('terminal-dock')).toHaveClass(/is-open/)
    await expect(page.getByTestId('composer-terminal')).toContainText('preview terminal')
  })

  test('chat accepts dropped files as attachments', async ({ page }) => {
    await page.goto('/preview.html')
    await expect(page.getByTestId('y-main')).toBeVisible()
    await page.evaluate(() => {
      const main = document.querySelector('[data-testid="y-main"]')!
      const data = new DataTransfer()
      data.items.add(new File(['hello from drop'], 'dropped.txt', { type: 'text/plain' }))
      main.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }))
      main.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
    })
    await expect(page.getByTestId('attachments')).toContainText('dropped.txt')
  })

  test('search filters projects and code blocks render with syntax', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('nav-search').click()
    await expect(page.getByTestId('sidebar-search')).toBeVisible()
    await expect(page.getByTestId('sidebar-search')).toBeFocused()
    await page.getByTestId('sidebar-search').fill('Agent')
    await expect(page.getByText('Explain agent communication')).toBeVisible()
    await expect(page.getByTestId('nav-open')).toBeVisible()

    const codeBlock = page.getByTestId('code-block')
    await expect(codeBlock).toBeVisible()
    await expect(codeBlock.locator('.md-code-lang')).toHaveText('python')
    await expect(codeBlock.locator('.md-code-pre')).toContainText('await')
    await expect(codeBlock.getByRole('button', { name: 'Copy' })).toBeVisible()
    const codeStyle = await codeBlock.locator('.md-code-pre').evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, color: style.color, family: style.fontFamily, size: style.fontSize, line: style.lineHeight }
    })
    expect(codeStyle.background).toBe('rgb(17, 18, 20)')
    expect(codeStyle.color).toBe('rgb(228, 228, 228)')
    expect(codeStyle.family).toContain('ui-monospace')
    expect(codeStyle.size).toBe('13px')
    expect(codeStyle.line).toBe('21.45px')
    await expect(codeBlock).toHaveCSS('border-radius', '12px')
    await expect(codeBlock).toHaveCSS('margin-left', '8px')
    await expect(codeBlock).toHaveCSS('margin-right', '8px')
    await expect(codeBlock).toHaveCSS('border-top-style', 'solid')
    await expect(codeBlock.locator('.md-code-head')).toHaveCSS('background-color', 'rgb(17, 18, 20)')
  })

  test('sidebar chats can be renamed, archived, and auto named from intent', async ({ page }) => {
    await page.goto('/preview.html?mode=empty')
    const input = page.getByTestId('composer-input')
    await input.fill('can you add the ability to archive chats with an icon in the sidebar itself')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('active-chat')).toContainText('Archive Chats Icon Sidebar')
    await expect(page.getByTestId('chat-title')).toHaveText('Archive Chats Icon Sidebar')

    await page.getByTestId('active-chat').dblclick()
    const longTitle = 'Sidebar controls with a deliberately long descriptive title that must stay inside the top bar even when the conversation name contains extensive implementation context and several additional details about the requested work'
    await page.getByTestId('chat-rename-input').fill(longTitle)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('active-chat')).toContainText(longTitle)
    await expect(page.getByTestId('chat-title')).toHaveAttribute('title', longTitle)
    expect(await page.getByTestId('chat-title').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    const titleBox = await page.getByTestId('chat-title').boundingBox()
    const actionsBox = await page.locator('.y-header-actions').boundingBox()
    expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(actionsBox?.x ?? 0)

    await page.getByTestId('active-chat').getByRole('button', { name: 'Archive chat' }).click()
    await expect(page.getByText(longTitle)).toHaveCount(0)
    await expect(page.getByTestId('active-chat')).toContainText('New chat')
  })

  test('right file rail opens markdown preview and editable file view', async ({ page }) => {
    await page.goto('/preview.html')
    await page.evaluate(() => {
      const markdown = '# ytimesy\n\n## Run your first agent\n\n<CodeGroup>\n  ```python Browser Use theme={null}\n  from browser_use import Agent, ChatBrowserUse\n  from dotenv import load_dotenv\n  import asyncio\n\n  load_dotenv()\n  ```\n\n  ```python Google theme={null}\n  from browser_use import Agent, ChatGoogle\n  ```\n</CodeGroup>\n'
      window.y.app.readProjectFile = async () => ({ ok: true, content: markdown })
    })
    await page.getByTestId('file-rail-button').click()
    await expect(page.getByTestId('file-rail')).toBeVisible()
    await page.getByTestId('file-tree-item').filter({ hasText: 'README.md' }).click()
    await expect(page.getByTestId('file-view')).toBeVisible()
    await expect(page.getByTestId('composer')).toHaveCount(0)
    await expect(page.getByTestId('markdown-preview')).toContainText('ytimesy')
    const previewCode = page.getByTestId('markdown-preview').locator('pre')
    await expect(previewCode.first()).toHaveCSS('background-color', 'rgb(17, 18, 20)')
    await expect(previewCode.first()).toHaveCSS('border-radius', '12px')
    await expect(previewCode.first()).toHaveCSS('padding-left', '18px')
    await expect(page.getByTestId('markdown-preview').locator('.hljs-keyword').first()).toHaveText('from')
    await expect(page.getByTestId('markdown-preview')).not.toContainText('```python')
    await expect(page.getByTestId('markdown-preview')).not.toContainText('theme={null}')
    await expect(page.getByTestId('markdown-preview')).not.toContainText('CodeGroup')
    await expect(previewCode).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByTestId('file-editor')).toContainText('Run your first agent')
    await page.getByTestId('file-editor').fill('# ytimesy\n\nUpdated from the file view.')
    await expect(page.getByTestId('file-save-button')).toBeEnabled()
    await page.getByTestId('file-save-button').click()
    await expect(page.getByText('Saved')).toBeVisible()
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByTestId('markdown-preview')).toContainText('Updated from the file view.')
  })

  test('right file rail refreshes when project files are created or removed', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByRole('button', { name: 'Open files' }).click()
    await expect(page.getByTestId('file-rail')).toHaveClass(/is-open/)

    await page.evaluate(() => {
      const state = window as typeof window & {
        __previewDirectory?: ProjectDirectoryEntry[]
        __emitProjectFilesChanged?: (projectId?: string, paths?: string[]) => void
      }
      state.__previewDirectory = [
        {
          kind: 'file',
          name: 'agent-created.ts',
          path: '/Users/hetpatel/Desktop/ytimesy/agent-created.ts',
          relPath: 'agent-created.ts',
          size: 24
        }
      ]
      window.y.app.listDirectory = async () => ({ ok: true, entries: state.__previewDirectory ?? [] })
      state.__emitProjectFilesChanged?.()
    })

    await expect(page.getByTestId('file-tree-item').filter({ hasText: 'agent-created.ts' })).toBeVisible()
    await expect(page.getByTestId('file-tree-item').filter({ hasText: 'README.md' })).toHaveCount(0)

    await page.evaluate(() => {
      const state = window as typeof window & {
        __previewDirectory?: ProjectDirectoryEntry[]
        __emitProjectFilesChanged?: (projectId?: string, paths?: string[]) => void
      }
      state.__previewDirectory = []
      state.__emitProjectFilesChanged?.()
    })
    await expect(page.getByText('No files found in this folder.')).toBeVisible()
  })

  test('right file rail loads nested folders only when expanded', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByRole('button', { name: 'Open files' }).click()
    await expect(page.getByText('app', { exact: true })).toBeVisible()
    await expect(page.getByText('panel.tsx', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as typeof window & { __listedDirectories?: string[] }).__listedDirectories ?? [])).not.toContain('app')

    await page.getByText('app', { exact: true }).click()
    await expect(page.getByText('userland-seed', { exact: true })).toBeVisible()
    await expect(page.getByText('panel.tsx', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as typeof window & { __listedDirectories?: string[] }).__listedDirectories ?? [])).not.toContain('app/userland-seed')

    await page.getByText('userland-seed', { exact: true }).click()
    await expect(page.getByText('panel.tsx', { exact: true })).toBeVisible()
  })

  test('composer shows slash commands and file mentions', async ({ page }) => {
    await page.goto('/preview.html')
    const input = page.getByTestId('composer-input')
    await input.fill('/')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/compact')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/plugins')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/mcp')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/doctor')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/update')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/auth')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/agents')
    await expect(page.getByTestId('slash-suggestions')).not.toContainText('/login')
    await expect(page.getByTestId('slash-suggestions')).not.toContainText('/features')
    await page.locator('.y-drop').first().click()
    await page.getByRole('button', { name: 'Codex' }).click()
    await input.fill('/')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/plugins')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/mcp')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/login')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/features')
    await expect(page.getByTestId('slash-suggestions')).not.toContainText('/auth')
    await expect(page.getByTestId('slash-suggestions')).not.toContainText('/agents')
    await page.getByText('/compact').click()
    await expect(input).toHaveValue('/compact')

    await input.fill('Look at @pan')
    await expect(page.getByTestId('file-suggestions')).toContainText('panel.tsx')
    const panelSuggestion = page.getByTestId('file-suggestions').getByRole('button').filter({ hasText: 'panel.tsx' }).first()
    await expect(panelSuggestion.locator('svg')).toBeVisible()
    await panelSuggestion.click()
    await expect(input).toHaveValue(/@app\/userland-seed\/panel\.tsx /)
    await expect(page.getByTestId('attachments')).toContainText('panel.tsx')
  })

  test('slash commands work across Claude and Codex', async ({ page }) => {
    await page.goto('/preview.html?mode=empty')
    const input = page.getByTestId('composer-input')
    await input.fill('/fast')
    await page.getByTestId('send-button').click()
    await expect(page.getByText(/not a y shortcut/i)).toBeVisible()
    await page.locator('.y-drop').first().click()
    await page.getByRole('button', { name: 'Codex' }).click()
    await input.fill('/effort high')
    await page.getByTestId('send-button').click()
    await expect(page.getByText('Reasoning: reasoning effort set to high.')).toBeVisible()
    await expect(page.locator('.y-drop-btn').nth(2)).toContainText('High')
    await page.evaluate(() => {
      ;(window as typeof window & { __engineCommands?: unknown[] }).__engineCommands = []
      const original = window.y.engine.command
      window.y.engine.command = async (sessionId, command) => {
        ;(window as typeof window & { __engineCommands?: unknown[] }).__engineCommands?.push({ sessionId, command })
        return original(sessionId, command)
      }
    })
    await input.fill('/goal keep answers short')
    await page.getByTestId('send-button').click()
    await expect(page.getByText('Goal set: keep answers short')).toBeVisible()
    await input.fill('/compact')
    await page.getByTestId('send-button').click()
    await input.fill('/plugins')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('composer-terminal')).toContainText('codex /plugins')
    await input.fill('/plugin install example-plugin')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('composer-terminal')).toContainText("codex '/plugins install example-plugin'")
    const commands = await page.evaluate(() => (window as typeof window & { __engineCommands?: unknown[] }).__engineCommands ?? [])
    expect(commands).toContainEqual({ sessionId: 'preview', command: { name: 'goal', action: 'set', value: 'keep answers short' } })
    expect(commands).toContainEqual({ sessionId: 'preview', command: { name: 'compact' } })
    await expect(page.getByText('Compacting context.')).toBeVisible()
    await input.fill('/clear')
    await page.getByTestId('send-button').click()
    await expect(page.getByText('Goal set: keep answers short')).toHaveCount(0)
    await page.evaluate(() => {
      window.y.engine.command = async () => ({ ok: false, error: 'unknown method thread/future' })
    })
    await input.fill('/compact')
    await page.getByTestId('send-button').click()
    await expect(page.getByText(/run \/update/i)).toBeVisible()
    await page.locator('.y-drop').first().click()
    await page.getByRole('button', { name: 'Claude Code' }).click()
    await page.evaluate(() => {
      window.y.engine.command = async () => ({ ok: false, error: 'Claude Code does not expose native goals in this chat.' })
    })
    await input.fill('/goal claude native goal')
    await page.getByTestId('send-button').click()
    await expect(page.getByText('/goal is only available for Codex. Current engine: Claude Code.')).toBeVisible()
  })

  test('normal sends include visible transcript context', async ({ page }) => {
    await page.goto('/preview.html')
    await page.evaluate(() => {
      ;(window as typeof window & { __sentPrompts?: string[] }).__sentPrompts = []
      const original = window.y.engine.send
      window.y.engine.send = async (sessionId, prompt) => {
        ;(window as typeof window & { __sentPrompts?: string[] }).__sentPrompts?.push(prompt)
        return original(sessionId, prompt)
      }
    })
    await page.getByTestId('composer-input').fill('What should we do next?')
    await page.getByTestId('send-button').click()
    const prompts = await page.evaluate(() => (window as typeof window & { __sentPrompts?: string[] }).__sentPrompts ?? [])
    expect(prompts[prompts.length - 1]).toContain('Use this full visible y chat transcript as context')
    expect(prompts[prompts.length - 1]).toContain('native context management/compaction behavior')
    expect(prompts[prompts.length - 1]).toContain('[assistant: assistant]')
    expect(prompts[prompts.length - 1]).toContain('Here is a quick example')
    expect(prompts[prompts.length - 1]).toContain('[user]')
    expect(prompts[prompts.length - 1]).toContain('Can you make the sidebar feel more like the reference?')
    expect(prompts[prompts.length - 1]).toContain('[current user request]')
    expect(prompts[prompts.length - 1]).toContain('What should we do next?')
  })

  test('composer typing and streamed bursts stay on the lightweight path', async ({ page }) => {
    await page.goto('/preview.html')
    await expect(page.getByTestId('composer-input')).toBeVisible()
    const metrics = await page.evaluate(async () => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')!
      const sample = 'responsive typing '.repeat(250)
      const inputStart = performance.now()
      input.value = sample
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: sample }))
      const inputDispatchMs = performance.now() - inputStart

      input.value = 'Start stream benchmark'
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: input.value }))
      document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')!.click()
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      const streamStart = performance.now()
      for (let index = 0; index < 200; index += 1) emit?.({ kind: 'text', text: `chunk-${index} ` })
      const streamDispatchMs = performance.now() - streamStart
      emit?.({ kind: 'result', ok: true })
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { inputDispatchMs, streamDispatchMs }
    })
    expect(metrics.inputDispatchMs).toBeLessThan(50)
    expect(metrics.streamDispatchMs).toBeLessThan(50)
    console.log(`interaction benchmark: input=${metrics.inputDispatchMs.toFixed(2)}ms stream200=${metrics.streamDispatchMs.toFixed(2)}ms`)
    await expect(page.getByTestId('assistant-message').last()).toContainText('chunk-199')
  })

  test('large pasted text becomes a txt attachment and composer height is capped', async ({ page }) => {
    await page.goto('/preview.html')
    await page.evaluate(() => {
      ;(window as typeof window & { __sentPrompts?: string[] }).__sentPrompts = []
      const originalSend = window.y.engine.send
      window.y.engine.send = async (sessionId, prompt) => {
        ;(window as typeof window & { __sentPrompts?: string[] }).__sentPrompts?.push(prompt)
        return originalSend(sessionId, prompt)
      }
    })
    const input = page.getByTestId('composer-input')
    await input.focus()
    const pasted = Array.from({ length: 20 }, (_, index) => `line ${index} pasted content`).join('\n')
    await page.evaluate((text) => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')!
      const data = new DataTransfer()
      data.setData('text/plain', text)
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    }, pasted)
    await expect(page.getByTestId('pasted-text-attachment')).toContainText('pasted-text-1.txt')
    await expect(page.getByTestId('pasted-text-attachment')).not.toHaveClass(/y-attachment-paste/)
    await expect(input).toHaveValue('')

    await input.fill('Please use this pasted text')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('pasted-text-attachment')).toHaveCount(0)
    const prompts = await page.evaluate(() => (window as typeof window & { __sentPrompts?: string[] }).__sentPrompts ?? [])
    expect(prompts[prompts.length - 1]).toContain('Attached pasted text:')
    expect(prompts[prompts.length - 1]).toContain('pasted-text-1.txt')
    expect(prompts[prompts.length - 1]).toContain('line 19 pasted content')

    await input.fill(Array.from({ length: 30 }, (_, index) => `draft line ${index}`).join('\n'))
    const size = await input.evaluate((element) => ({ height: element.clientHeight, scrollHeight: element.scrollHeight }))
    expect(size.height).toBeLessThanOrEqual(164)
    expect(size.scrollHeight).toBeGreaterThan(size.height)
  })

  test('buffers streaming text and renders final markdown once complete', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('composer-input').fill('Stream with markdown')
    await page.getByTestId('send-button').click()
    const assistantCountBeforeStream = await page.getByTestId('assistant-message').count()
    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'text', text: 'Read [the implementation' })
    })
    await new Promise((resolve) => setTimeout(resolve, 90))
    expect(await page.getByTestId('assistant-message').count()).toBe(assistantCountBeforeStream)

    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'text', text: ' notes](README.md) before deciding what to change in the renderer. ' })
    })
    await new Promise((resolve) => setTimeout(resolve, 90))
    expect(await page.getByTestId('assistant-message').count()).toBe(assistantCountBeforeStream)

    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'text', text: 'tail' })
      emit?.({ kind: 'result', ok: true })
    })
    await expect(page.getByTestId('assistant-message').last()).toContainText('Read the implementation notes')
    await expect(page.getByTestId('assistant-message').last()).toContainText('renderer. tail')
    await expect(page.getByTestId('assistant-message').last()).not.toHaveClass(/is-streaming/)
  })

  test('busy chat supports queued follow-ups, boundary steering, and provider-independent editing', async ({ page }) => {
    await page.goto('/preview.html')
    await page.evaluate(() => {
      ;(window as typeof window & { __sentPrompts?: string[]; __engineCommands?: unknown[] }).__sentPrompts = []
      ;(window as typeof window & { __sentPrompts?: string[]; __engineCommands?: unknown[] }).__engineCommands = []
      const originalSend = window.y.engine.send
      const originalCommand = window.y.engine.command
      window.y.engine.send = async (sessionId, prompt) => {
        ;(window as typeof window & { __sentPrompts?: string[] }).__sentPrompts?.push(prompt)
        return originalSend(sessionId, prompt)
      }
      window.y.engine.command = async (sessionId, command) => {
        ;(window as typeof window & { __engineCommands?: unknown[] }).__engineCommands?.push({ sessionId, command })
        return originalCommand(sessionId, command)
      }
    })

    const input = page.getByTestId('composer-input')
    await input.fill('Start a longer change')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('binary-stream-spinner')).toBeVisible()
    await expect(page.getByTestId('chat-running-indicator')).toBeVisible()
    await expect(page.getByTestId('send-button')).toHaveAccessibleName('Pause')

    await input.fill('Send this after the current turn')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('queued-follow-up')).toContainText('Send this after the current turn')
    await expect(input).toHaveValue('')
    const queuedBox = await page.getByTestId('queued-follow-up').boundingBox()
    const composerBox = await page.getByTestId('composer').boundingBox()
    expect(queuedBox?.y).toBeLessThan(composerBox?.y ?? 0)

    await page.evaluate(() => {
      ;(window as typeof window & { __emitEngineEvent?: (event: unknown) => void }).__emitEngineEvent?.({ kind: 'result', ok: true })
    })
    await expect(page.getByTestId('queued-follow-up')).toHaveCount(0)
    await expect(page.getByTestId('chat-log').getByText('Send this after the current turn')).toBeVisible()
    const promptsAfterQueue = await page.evaluate(() => (window as typeof window & { __sentPrompts?: string[] }).__sentPrompts ?? [])
    expect(promptsAfterQueue[promptsAfterQueue.length - 1]).toContain('Send this after the current turn')

    await input.fill('Try to steer now')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('queued-follow-up')).toContainText('Try to steer now')
    await page.getByTestId('queued-follow-up').getByRole('button', { name: 'Steer' }).click()
    await expect(page.getByTestId('queued-follow-up')).toContainText('Steering...')
    let commands = await page.evaluate(() =>
      (window as typeof window & { __engineCommands?: Array<{ command?: { name?: string; value?: string } }> }).__engineCommands ?? []
    )
    expect(commands.some((entry) => entry.command?.name === 'steer')).toBe(false)
    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'tool', name: 'Edit', phase: 'start', id: 'steer-boundary', verb: 'edit', target: 'panel.tsx' })
      emit?.({ kind: 'tool', name: 'Edit', phase: 'end', id: 'steer-boundary', verb: 'edit', target: 'panel.tsx' })
    })
    await expect(page.getByTestId('queued-follow-up')).toHaveCount(0)
    await expect(page.getByTestId('chat-log').getByText('Try to steer now')).toBeVisible()
    commands = await page.evaluate(() =>
      (window as typeof window & { __engineCommands?: Array<{ command?: { name?: string; value?: string } }> }).__engineCommands ?? []
    )
    expect(commands).toContainEqual({
      sessionId: 'preview',
      command: expect.objectContaining({
        name: 'steer',
        value: expect.stringContaining('Try to steer now')
      })
    })
    await page.evaluate(() => {
      ;(window as typeof window & { __emitEngineEvent?: (event: unknown) => void }).__emitEngineEvent?.({ kind: 'result', ok: true })
    })

    await page.getByRole('button', { name: 'Edit message' }).first().click()
    await expect(page.getByTestId('inline-edit-input')).toHaveValue('Can you make the sidebar feel more like the reference?')
    await expect(input).toHaveValue('')

    await page.getByTestId('inline-edit-input').fill('Edited original request')
    await page.getByRole('button', { name: 'Submit edited message' }).click()
    await expect(page.getByText('Send this after the current turn')).toHaveCount(0)
    await expect(page.getByTestId('queued-follow-up')).toHaveCount(0)
    await page.evaluate(() => {
      ;(window as typeof window & { __emitEngineEvent?: (event: unknown) => void }).__emitEngineEvent?.({ kind: 'result', ok: true })
    })
    await expect(page.getByTestId('chat-log').getByText('Edited original request')).toBeVisible()
    const commandsAfterEdit = await page.evaluate(() => (window as typeof window & { __engineCommands?: Array<{ command?: { name?: string } }> }).__engineCommands ?? [])
    expect(commandsAfterEdit.some((entry) => entry.command?.name === 'rollback')).toBe(false)
  })

  test('partial assistant messages hide actions and interrupt settles the active tool', async ({ page }) => {
    await page.goto('/preview.html')
    const input = page.getByTestId('composer-input')
    await input.fill('Run a tool')
    const assistantCountBeforeTurn = await page.getByTestId('assistant-message').count()
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('binary-stream-spinner')).toBeVisible()
    const spinner = page.getByTestId('binary-stream-spinner')
    await expect(spinner.locator('.y-binary-cell')).toHaveCount(9)
    await expect(spinner.locator('.y-binary-cell')).toHaveText(['1', '0', '1', '0', '1', '0', '1', '0', '1'])
    await expect(spinner.locator('.y-binary-glow')).toBeVisible()
    await page.evaluate(() => {
      ;(window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent?.({ kind: 'thinking', text: 'Checking the relevant state before editing.' })
    })
    const thinking = page.getByTestId('thinking-block').last()
    await expect(thinking).toBeVisible()
    await expect(thinking).toHaveAttribute('open', '')
    await expect(thinking).toContainText('Checking the relevant state before editing.')
    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'text', text: 'I am still working.' })
      emit?.({ kind: 'tool', name: 'Read', phase: 'start', id: 'read-live', verb: 'Read', target: 'src/index.ts' })
    })
    expect(await page.getByTestId('assistant-message').count()).toBe(assistantCountBeforeTurn)
    await expect(page.getByTestId('binary-stream-spinner')).toBeVisible()
    await expect(page.locator('.y-engine-badge')).toHaveCount(0)

    await page.getByTestId('send-button').click()
    await expect(page.getByText('Interrupted.')).toBeVisible()
    const currentAssistant = page.getByTestId('assistant-message').last()
    await expect(currentAssistant).toContainText('I am still working.')
    await expect(currentAssistant.locator('.y-assistant-footer')).toBeVisible()
    await expect(currentAssistant.getByRole('button', { name: 'Copy message' })).toBeVisible()
    await expect(currentAssistant.getByLabel('More message actions')).toBeVisible()
    await expect(page.getByTestId('binary-stream-spinner')).toHaveCount(0)
  })

  test('queues at most seven follow-ups in a neutral stack', async ({ page }) => {
    await page.goto('/preview.html')
    const input = page.getByTestId('composer-input')
    await input.fill('Start work')
    await page.getByTestId('send-button').click()
    for (let index = 1; index <= 8; index += 1) {
      await input.fill(`Queued message ${index}`)
      await page.getByTestId('send-button').click()
    }
    await expect(page.getByTestId('queued-follow-up')).toHaveCount(7)
    await expect(page.getByTestId('queued-follow-up').first()).toContainText('Queued message 1')
    await expect(page.getByTestId('queued-follow-up').last()).toContainText('Queued message 7')
    await expect(page.getByText('Queue limit reached (7)')).toBeVisible()
  })

  test('collapses completed work and summarizes edited files after the final response', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('composer-input').fill('Make the change')
    await page.getByTestId('send-button').click()
    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'thinking', text: 'I should preserve the current spacing while changing the component.' })
      emit?.({ kind: 'text', text: 'I will inspect the component first.' })
      emit?.({ kind: 'tool', name: 'Edit', phase: 'end', id: 'edit-summary', verb: 'Edit', target: 'app/panel.tsx', body: '- old\n+ new\n+ extra' })
      emit?.({ kind: 'text', text: 'The component now uses the updated layout.' })
      emit?.({ kind: 'result', ok: true })
    })
    const work = page.getByTestId('work-log')
    await expect(work).toBeVisible()
    await expect(work).not.toHaveAttribute('open', '')
    await expect(work.getByText('I will inspect the component first.')).toBeHidden()
    await work.locator('summary').first().click()
    await expect(work.getByTestId('thinking-block')).toContainText('I should preserve the current spacing')
    await expect(page.getByTestId('assistant-message').last()).toContainText('The component now uses the updated layout.')
    await expect(page.getByTestId('edited-files')).toContainText('Edited 1 file')
    await expect(page.getByTestId('edited-files')).toContainText('app/panel.tsx')
    await expect(page.getByTestId('edited-files')).toContainText('+2')
    await expect(page.getByTestId('edited-files')).toContainText('-1')
    await expect(page.getByTestId('edited-files').getByText('Undo')).toHaveCount(0)
    await expect(page.getByTestId('edited-files').getByText('Review')).toHaveCount(0)
  })

  test('does not show Worked for on reasoning-only turns', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('composer-input').fill('Answer without tools')
    await page.getByTestId('send-button').click()
    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'thinking', text: 'This only needs a direct explanation.' })
      emit?.({ kind: 'text', text: 'Here is the direct answer.' })
      emit?.({ kind: 'result', ok: true })
    })
    await expect(page.getByTestId('work-log')).toHaveCount(0)
    await expect(page.getByTestId('thinking-block').last()).toBeVisible()
    await expect(page.getByTestId('assistant-message').last()).toContainText('Here is the direct answer.')
  })

  test('messages can be copied and reset without provider rollback', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/preview.html')
    await page.evaluate(() => {
      ;(window as typeof window & { __engineCommands?: unknown[] }).__engineCommands = []
      const original = window.y.engine.command
      window.y.engine.command = async (sessionId, command) => {
        ;(window as typeof window & { __engineCommands?: unknown[] }).__engineCommands?.push({ sessionId, command })
        return original(sessionId, command)
      }
    })

    const assistant = page.getByTestId('assistant-message').first()
    await assistant.getByRole('button', { name: 'Copy message' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('```python')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('run_action("click"')

    const user = page.getByTestId('user-message').first()
    await user.hover()
    const userText = await user.locator('.y-user-bubble').innerText()
    await user.getByRole('button', { name: 'Copy message' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(userText)

    await assistant.getByLabel('More message actions').click()
    const footerBox = await assistant.locator('.y-assistant-footer').boundingBox()
    const menuBox = await assistant.locator('.y-message-menu-popover').boundingBox()
    expect(menuBox?.y).toBeGreaterThanOrEqual(footerBox?.y ?? 0)
    await assistant.getByRole('button', { name: 'Reset to this point' }).click()
    await expect(assistant.locator('.y-message-menu-popover')).toBeHidden()
    await expect(page.getByTestId('assistant-message')).toHaveCount(1)
    await expect(page.getByTestId('user-message')).toHaveCount(0)
    await expect(page.getByText('Reset conversation to this point')).toBeVisible()
    const commands = await page.evaluate(() => (window as typeof window & { __engineCommands?: Array<{ command?: { name?: string } }> }).__engineCommands ?? [])
    expect(commands.some((entry) => entry.command?.name === 'rollback')).toBe(false)
  })

  test('codex file change updates replace the same visible tool row', async ({ page }) => {
    await page.goto('/preview.html')
    await expect(page.getByTestId('composer-input')).toHaveAttribute('placeholder', /Ask for follow-up changes/)
    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      emit?.({ kind: 'tool', name: 'Edit', phase: 'start', id: 'file-1', verb: 'edit', target: 'panel.tsx' })
      emit?.({
        kind: 'tool',
        name: 'Edit',
        phase: 'update',
        id: 'file-1',
        verb: 'edit',
        target: 'panel.tsx',
        body: '- old\n+ new'
      })
      emit?.({
        kind: 'tool',
        name: 'Edit',
        phase: 'end',
        id: 'file-2',
        verb: 'edit',
        target: 'panel.tsx',
        body: '- old\n+ new'
      })
    })
    await page.getByTestId('composer-input').fill('typing should not create more edit rows')
    await page.evaluate(() => {
      const emit = (window as typeof window & { __emitEngineEvent?: (event: AgentEvent) => void }).__emitEngineEvent
      for (let i = 0; i < 5; i += 1) {
        emit?.({
          kind: 'tool',
          name: 'Edit',
          phase: 'end',
          id: `file-replay-${i}`,
          verb: 'edit',
          target: 'panel.tsx',
          body: '- old\n+ new'
        })
      }
    })
    await expect(page.locator('.tool-activity').filter({ hasText: 'panel.tsx' })).toHaveCount(1)
    await expect(page.locator('.tool-activity').filter({ hasText: 'panel.tsx' }).locator('.tool-stat-add')).toHaveText('+1')
    await expect(page.locator('.tool-activity').filter({ hasText: 'panel.tsx' }).locator('.tool-stat-del')).toHaveText('-1')
  })

  test('tool activity stays ordered and keeps edit diff collapsed', async ({ page }) => {
    await page.goto('/preview.html?mode=tool')
    const items = page.locator('.y-log-inner > *')
    await expect(items.nth(0)).toContainText('I will make the button state easier to scan first.')
    await expect(items.nth(1).locator('.tool-activity-verb')).toHaveText('Edit')
    await expect(items.nth(1).locator('.tool-activity-target')).toHaveText('panel.tsx')
    await expect(items.nth(1).locator('.tool-stat-add')).toHaveText('+2')
    await expect(items.nth(1).locator('.tool-stat-del')).toHaveText('-2')
    await expect(items.nth(1).locator('.tool-activity-detail')).toBeHidden()
    await items.nth(1).locator('summary').click()
    await expect(items.nth(1).locator('.tool-diff-gutter').first()).toHaveText('-')
    await expect(items.nth(1).locator('.tool-diff-add .tool-diff-gutter').first()).toHaveText('+')
    const detail = items.nth(1).locator('.tool-activity-detail')
    await detail.locator('code').first().evaluate((element) => {
      element.textContent = `const responsiveLine = "${'long-value-'.repeat(80)}"`
    })
    await page.getByTestId('file-rail-button').click()
    const layout = await detail.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(layout.scrollWidth).toBe(layout.clientWidth)
    await expect(detail.locator('code').first()).toHaveCSS('font-size', '13px')
    await expect(detail.locator('code').first()).toHaveCSS('line-height', '21.45px')
    await expect(detail.locator('code').first()).toHaveCSS('white-space', 'pre-wrap')
    await expect(items.nth(2)).toContainText('The edit is in place.')
    await page.screenshot({ path: join(shots, 'tool-diff.png'), fullPage: true })
  })
})
