import { test, expect } from '@playwright/test'
import { join } from 'path'

const shots = join(__dirname, '..', 'e2e', 'screenshots')

test.describe('y chat UI', () => {
  test('empty state matches production layout', async ({ page }) => {
    await page.goto('/preview.html?mode=empty')
    await expect(page.getByTestId('y-app')).toBeVisible()
    await expect(page.getByTestId('empty-state')).toBeVisible()
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
    await expect(page.locator('.y-drop-btn').first()).toBeVisible()
    await expect(page.locator('.y-drop-btn').first()).toContainText(/Claude Code|Codex/)
    await page.getByRole('button', { name: 'Attach' }).click()
    await expect(page.getByTestId('attachments')).toContainText('panel.tsx')
    await expect(page.getByText('/Users/hetpatel/Desktop/ytimesy')).toHaveCount(0)
    await page.getByTestId('settings-button').click()
    await expect(page.getByTestId('settings-panel')).toContainText('Settings')

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
  })

  test('sidebar chats can be renamed, archived, and auto named from intent', async ({ page }) => {
    await page.goto('/preview.html?mode=empty')
    const input = page.getByTestId('composer-input')
    await input.fill('can you add the ability to archive chats with an icon in the sidebar itself')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('active-chat')).toContainText('Archive Chats Icon Sidebar')

    await page.getByTestId('active-chat').dblclick()
    await page.getByTestId('chat-rename-input').fill('Sidebar controls')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('active-chat')).toContainText('Sidebar controls')

    await page.getByTestId('active-chat').getByRole('button', { name: 'Archive chat' }).click()
    await expect(page.getByText('Sidebar controls')).toHaveCount(0)
    await expect(page.getByTestId('active-chat')).toContainText('New chat')
  })

  test('right file rail opens markdown preview and editable file view', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('file-rail-button').click()
    await expect(page.getByTestId('file-rail')).toBeVisible()
    await page.getByTestId('file-tree-item').filter({ hasText: 'README.md' }).click()
    await expect(page.getByTestId('file-view')).toBeVisible()
    await expect(page.getByTestId('composer')).toHaveCount(0)
    await expect(page.getByTestId('markdown-preview')).toContainText('ytimesy')
    await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByTestId('file-editor')).toContainText('chat-first coding-agent')
    await page.getByTestId('file-editor').fill('# ytimesy\n\nUpdated from the file view.')
    await expect(page.getByTestId('file-save-button')).toBeEnabled()
    await page.getByTestId('file-save-button').click()
    await expect(page.getByText('Saved')).toBeVisible()
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByTestId('markdown-preview')).toContainText('Updated from the file view.')
  })

  test('composer shows slash commands and file mentions', async ({ page }) => {
    await page.goto('/preview.html')
    const input = page.getByTestId('composer-input')
    await input.fill('/')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/compact')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/plugins')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/mcp')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/skills')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/doctor')
    await expect(page.getByTestId('slash-suggestions')).toContainText('/update')
    await page.getByText('/compact').click()
    await expect(input).toHaveValue('/compact')

    await input.fill('Look at @pan')
    await expect(page.getByTestId('file-suggestions')).toContainText('panel.tsx')
    await expect(page.locator('.y-file-icon').filter({ hasText: 'TX' }).first()).toBeVisible()
    await page.getByTestId('file-suggestions').getByRole('button').filter({ hasText: 'panel.tsx' }).first().click()
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
    await expect(page.getByText('Claude Code does not expose native goals in this chat.')).toBeVisible()
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

  test('busy chat supports queued follow-ups, steer fallback, edit, and revert', async ({ page }) => {
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
        if (command.name === 'steer') return { ok: false, error: 'steer unavailable' }
        return originalCommand(sessionId, command)
      }
    })

    const input = page.getByTestId('composer-input')
    await input.fill('Start a longer change')
    await page.getByTestId('send-button').click()
    await expect(page.getByText('...')).toBeVisible()
    await expect(page.getByTestId('send-button')).toHaveAccessibleName('Pause')

    await input.fill('Send this after the current turn')
    await page.getByTestId('send-button').click()
    await expect(page.getByTestId('queued-follow-up')).toContainText('Send this after the current turn')
    await expect(input).toHaveValue('')

    await page.evaluate(() => {
      ;(window as typeof window & { __emitEngineEvent?: (event: unknown) => void }).__emitEngineEvent?.({ kind: 'result', ok: true })
    })
    await expect(page.getByTestId('queued-follow-up')).toHaveCount(0)
    await expect(page.getByTestId('chat-log').getByText('Send this after the current turn')).toBeVisible()
    const promptsAfterQueue = await page.evaluate(() => (window as typeof window & { __sentPrompts?: string[] }).__sentPrompts ?? [])
    expect(promptsAfterQueue[promptsAfterQueue.length - 1]).toContain('Send this after the current turn')

    await input.fill('Try to steer now')
    await page.locator('.y-steer-btn').click()
    await expect(page.getByTestId('queued-follow-up')).toContainText('Try to steer now')
    await expect(page.getByText('steer unavailable')).toBeVisible()
    const commands = await page.evaluate(() => (window as typeof window & { __engineCommands?: unknown[] }).__engineCommands ?? [])
    expect(commands).toContainEqual({
      sessionId: 'preview',
      command: expect.objectContaining({
        name: 'steer',
        value: expect.stringContaining('Try to steer now')
      })
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
    await page.getByRole('button', { name: 'Revert last turn' }).last().click()
    await expect(page.getByTestId('chat-log').getByText('Edited original request')).toHaveCount(0)
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
    await expect(items.nth(2)).toContainText('The edit is in place.')
    await page.screenshot({ path: join(shots, 'tool-diff.png'), fullPage: true })
  })
})
