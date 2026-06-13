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
    await expect(page.getByTestId('access-pill')).toContainText('Read only')
    await expect(page.getByTestId('send-button')).toBeVisible()
    await page.screenshot({ path: join(shots, 'empty-state.png'), fullPage: true })
  })

  test('conversation state has sidebar, messages, and composer', async ({ page }) => {
    await page.goto('/preview.html')
    await expect(page.getByTestId('y-sidebar')).toBeVisible()
    await expect(page.getByTestId('nav-new')).toBeVisible()
    await expect(page.getByTestId('active-chat')).toBeVisible()
    await expect(page.getByTestId('assistant-message')).toBeVisible()
    await expect(page.getByTestId('user-message')).toBeVisible()
    await expect(page.getByTestId('code-block')).toBeVisible()
    await expect(page.getByTestId('composer-input')).toBeVisible()
    await expect(page.getByTestId('engine-select')).toBeVisible()
    await expect(page.getByTestId('engine-select')).toContainText(/Claude Code|Codex/)

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
    await expect(page.getByTestId('y-sidebar')).toHaveCount(0)
    await expect(page.getByTestId('composer')).toBeVisible()
    await page.screenshot({ path: join(shots, 'sidebar-collapsed.png'), fullPage: true })
  })

  test('search filters projects and code blocks render with syntax', async ({ page }) => {
    await page.goto('/preview.html')
    await page.getByTestId('nav-search').click()
    await expect(page.getByTestId('sidebar-search')).toBeVisible()
    await page.getByTestId('sidebar-search').fill('Game')
    await expect(page.getByText('Compete with AI giants cheaply')).toBeVisible()

    const codeBlock = page.getByTestId('code-block')
    await expect(codeBlock).toBeVisible()
    await expect(codeBlock.locator('.md-code-lang')).toHaveText('python')
    await expect(codeBlock.locator('.md-code-pre')).toContainText('await')
    await expect(codeBlock.getByRole('button', { name: 'Copy' })).toBeVisible()
  })
})
