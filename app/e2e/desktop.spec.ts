import { test, expect, chromium, type Browser, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import net from 'node:net'

type DesktopApp = {
  browser: Browser
  page: Page
  process: ChildProcessWithoutNullStreams
  userDataDir: string
  output: () => string
}

type LaunchOptions = {
  prepareUserData?: (userDataDir: string) => Promise<void>
  fakeUpdateNotice?: boolean
  completeOnboarding?: boolean
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a local debug port')))
        return
      }
      const port = address.port
      server.close(() => resolvePort(port))
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function sha256ForTest(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

async function waitForDebugSocket(port: number, appProcess: ChildProcessWithoutNullStreams): Promise<string> {
  const startedAt = Date.now()
  let lastError = ''

  while (Date.now() - startedAt < 45_000) {
    if (appProcess.exitCode !== null) {
      throw new Error(`y exited before opening DevTools on port ${port}`)
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        const payload = (await response.json()) as { webSocketDebuggerUrl?: string }
        if (payload.webSocketDebuggerUrl) return payload.webSocketDebuggerUrl
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(250)
  }

  throw new Error(`Timed out waiting for y DevTools endpoint on port ${port}: ${lastError}`)
}

async function firstPage(browser: Browser): Promise<Page> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 15_000) {
    for (const context of browser.contexts()) {
      const page = context.pages()[0]
      if (page) return page
    }
    await delay(100)
  }

  throw new Error('Connected to y over CDP, but no renderer page was available')
}

async function launchPackagedY(options: LaunchOptions = {}): Promise<DesktopApp> {
  const appBinary =
    process.env.Y_DESKTOP_APP_BINARY || resolve(__dirname, '../dist/mac-arm64/y.app/Contents/MacOS/y')
  const port = await findFreePort()
  const userDataDir = await mkdtemp(join(tmpdir(), 'y-desktop-test-'))
  const chunks: string[] = []
  await options.prepareUserData?.(userDataDir)

  const appProcess = spawn(appBinary, [`--remote-debugging-port=${port}`, `--y-user-data-dir=${userDataDir}`], {
    env: {
      ...process.env,
      Y_E2E: '1',
      Y_E2E_BYPASS_AUTH: '1',
      ...(options.fakeUpdateNotice === false ? {} : { Y_E2E_UPDATE_STATE: '1' }),
      Y_E2E_UPDATE_PHASE: process.env.Y_E2E_UPDATE_PHASE || 'available',
      Y_E2E_UPDATE_VERSION: process.env.Y_E2E_UPDATE_VERSION || '0.0.2'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  appProcess.stdout.on('data', (chunk) => chunks.push(String(chunk)))
  appProcess.stderr.on('data', (chunk) => chunks.push(String(chunk)))

  try {
    const websocketUrl = await waitForDebugSocket(port, appProcess)
    const browser = await chromium.connectOverCDP(websocketUrl)
    const page = await firstPage(browser)
    await page.waitForLoadState('domcontentloaded')
    if (options.completeOnboarding === false) {
      await page.evaluate(() => {
        window.localStorage.removeItem('y.onboarding.done')
        window.localStorage.removeItem('y.onboarding.cli.v2.done')
        window.dispatchEvent(new CustomEvent('y:kernel-storage-changed'))
      })
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
    } else {
      await page.evaluate(() => {
        window.localStorage.setItem('y.onboarding.done', 'true')
        window.localStorage.setItem('y.onboarding.cli.v2.done', 'true')
        window.dispatchEvent(new CustomEvent('y:kernel-storage-changed'))
      })
    }
    return {
      browser,
      page,
      process: appProcess,
      userDataDir,
      output: () => chunks.join('')
    }
  } catch (error) {
    appProcess.kill('SIGTERM')
    await rm(userDataDir, { recursive: true, force: true })
    throw error
  }
}

async function closePackagedY(app: DesktopApp): Promise<void> {
  await app.browser.close().catch(() => undefined)
  if (app.process.exitCode === null) {
    app.process.kill('SIGTERM')
    await delay(500)
  }
  if (app.process.exitCode === null) app.process.kill('SIGKILL')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(app.userDataDir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 4) throw error
      await delay(250)
    }
  }
}

async function prepareCustomizedUserland(userDataDir: string): Promise<void> {
  const seed = await readFile(resolve(__dirname, '../userland-seed/panel.tsx'), 'utf-8')
  const customized = seed.replace('Make something you want.', 'Make something you want. (customized local test)')
  const userlandDir = join(userDataDir, 'userland')
  await mkdir(userlandDir, { recursive: true })
  await writeFile(join(userlandDir, 'panel.tsx'), customized, 'utf-8')
  await writeFile(
    join(userDataDir, 'userland-seed.json'),
    JSON.stringify(
      {
        version: 1,
        seedHash: 'previous-bundled-seed',
        seedVersion: '0.0.0',
        customized: true,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  )
}

async function prepareLegacyUserlandWithoutMetadata(userDataDir: string): Promise<void> {
  const seed = await readFile(resolve(__dirname, '../userland-seed/panel.tsx'), 'utf-8')
  const legacyPanel = seed.replace('Make something you want.', 'Legacy installed y panel')
  const userlandDir = join(userDataDir, 'userland')
  await mkdir(userlandDir, { recursive: true })
  await writeFile(join(userlandDir, 'panel.tsx'), legacyPanel, 'utf-8')
}

async function prepareAcceptedCustomizedUserlandWithPendingUpdate(userDataDir: string): Promise<void> {
  const seed = await readFile(resolve(__dirname, '../userland-seed/panel.tsx'), 'utf-8')
  const accepted = seed.replace('Make something you want.', 'Make something you want. (accepted customized)')
  const pending = accepted.replace(
    'Make something you want. (accepted customized)',
    'Make something you want. (accepted customized + pending update)'
  )
  const userlandDir = join(userDataDir, 'userland')
  const pendingDir = join(userlandDir, '.y')
  await mkdir(pendingDir, { recursive: true })
  await writeFile(join(userlandDir, 'panel.tsx'), accepted, 'utf-8')
  await writeFile(join(pendingDir, 'pending-panel.tsx'), pending, 'utf-8')
  await writeFile(
    join(userDataDir, 'userland-seed.json'),
    JSON.stringify(
      {
        version: 1,
        seedHash: sha256ForTest(accepted),
        seedVersion: '0.0.1',
        customized: true,
        pendingSeedHash: sha256ForTest(pending),
        pendingSeedVersion: '0.0.2-test',
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  )
}

async function prepareUnmodifiedPreviousUserlandSeed(userDataDir: string): Promise<void> {
  const seed = await readFile(resolve(__dirname, '../userland-seed/panel.tsx'), 'utf-8')
  const previousSeed = seed.replace('Make something you want.', 'Ask for follow-up changes')
  const userlandDir = join(userDataDir, 'userland')
  await mkdir(userlandDir, { recursive: true })
  await writeFile(join(userlandDir, 'panel.tsx'), previousSeed, 'utf-8')
  await writeFile(
    join(userDataDir, 'userland-seed.json'),
    JSON.stringify(
      {
        version: 1,
        seedHash: sha256ForTest(previousSeed),
        seedVersion: '0.0.2',
        customized: false,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  )
}

test.describe.serial('packaged desktop app', () => {
  let app: DesktopApp

  test.beforeEach(async () => {
    app = await launchPackagedY()
  })

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('y-desktop.log', {
        body: app.output(),
        contentType: 'text/plain'
      })
    }
    await closePackagedY(app)
  })

  test('opens the real kernel shell in dark mode with isolated test data', async () => {
    await expect(app.page.locator('.kernel-shell')).toBeVisible({ timeout: 30_000 })
    await expect(app.page.locator('.userland-frame')).toBeVisible({ timeout: 30_000 })

    const state = await app.page.evaluate(() => {
      const body = getComputedStyle(document.body)
      const shell = getComputedStyle(document.querySelector('.kernel-shell')!)
      const frame = document.querySelector('.userland-frame')
      return {
        bodyBackground: body.backgroundColor,
        shellBackground: shell.backgroundColor,
        frameExists: Boolean(frame),
        text: document.body.innerText
      }
    })

    expect(state.frameExists).toBe(true)
    expect(state.bodyBackground).not.toBe('rgb(255, 255, 255)')
    expect(state.shellBackground).not.toBe('rgb(255, 255, 255)')
    expect(state.text).not.toContain('Sign in or create an account')
    expect(app.userDataDir).toContain('y-desktop-test-')
  })

  test('shows the update notice without a real release feed', async () => {
    await expect(app.page.locator('.kernel-update-notice')).toBeVisible({ timeout: 30_000 })
    await expect(app.page.locator('.kernel-update-badge')).toHaveText('Update available')
    await expect(app.page.locator('.kernel-update-copy')).toHaveText('y 0.0.2 is ready.')
    await expect(app.page.getByRole('button', { name: 'Update now' })).toBeVisible()
    await expect(app.page.getByRole('button', { name: 'Later' })).toBeVisible()
  })
})

test.describe.serial('packaged onboarding card gating', () => {
  let app: DesktopApp

  test.afterEach(async ({}, testInfo) => {
    if (app) {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('y-desktop.log', {
          body: app.output(),
          contentType: 'text/plain'
        })
      }
      await closePackagedY(app)
    }
  })

  test('does not show kernel update cards during onboarding', async () => {
    app = await launchPackagedY({ prepareUserData: prepareCustomizedUserland, completeOnboarding: false })

    await expect(app.page.locator('.kernel-update-notice')).toHaveCount(0)
    await app.page.evaluate(() => {
      window.localStorage.setItem('y.onboarding.done', 'true')
      window.localStorage.setItem('y.onboarding.cli.v2.done', 'true')
      window.dispatchEvent(new CustomEvent('y:kernel-storage-changed'))
    })
    await expect(app.page.locator('.kernel-userland-update-notice')).toBeVisible({ timeout: 30_000 })
  })
})

test.describe.serial('packaged Userland update flow', () => {
  let app: DesktopApp

  test.afterEach(async ({}, testInfo) => {
    if (app) {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('y-desktop.log', {
          body: app.output(),
          contentType: 'text/plain'
        })
      }
      await closePackagedY(app)
    }
  })

  test('preserves customized Userland and gates feature checklist behind review', async () => {
    app = await launchPackagedY({ prepareUserData: prepareCustomizedUserland, fakeUpdateNotice: false })

    const notice = app.page.locator('.kernel-userland-update-notice')
    await expect(notice).toBeVisible({ timeout: 30_000 })
    const userlandBox = await notice.boundingBox()
    const viewport = await app.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    expect(userlandBox).not.toBeNull()
    expect(viewport.height - (userlandBox!.y + userlandBox!.height)).toBeLessThan(50)
    expect(viewport.width - (userlandBox!.x + userlandBox!.width)).toBeLessThan(50)
    await expect(notice).toContainText('Your customized app is safe')
    await expect(app.page.getByRole('button', { name: 'Select changes' })).toBeVisible()
    await expect(app.page.getByRole('button', { name: 'Leave as is' })).toBeVisible()
    await expect(app.page.getByRole('button', { name: 'Switch to default y...' })).toBeVisible()
    await expect(app.page.getByRole('button', { name: 'Switch to default y', exact: true })).toHaveCount(0)
    await expect(notice.getByText('Safer app UI update flow')).toHaveCount(0)

    await app.page.getByRole('button', { name: 'Select changes' }).click()
    await expect(notice).toContainText('Choose changes to apply')
    await expect(notice.getByText('Safer app UI update flow')).toBeVisible()
    await expect(notice.getByRole('checkbox')).toHaveCount(1)
    await expect(notice.getByRole('checkbox').first()).toBeChecked()
    await expect(app.page.getByRole('button', { name: 'Apply selected changes' })).toBeVisible()
    await expect(app.page.getByRole('button', { name: 'Back' })).toBeVisible()
    await app.page.getByRole('button', { name: 'Back' }).click()
    await expect(notice.getByText('Safer app UI update flow')).toHaveCount(0)

    const live = await readFile(join(app.userDataDir, 'userland/panel.tsx'), 'utf-8')
    const pending = await readFile(join(app.userDataDir, 'userland/.y/pending-panel.tsx'), 'utf-8')
    expect(live).toContain('Make something you want. (customized local test)')
    expect(pending).toContain('Make something you want.')
    expect(pending).not.toContain('(customized local test)')

    const status = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(status.pending).toBe(true)
    expect(status.customized).toBe(true)
    expect(status.updateManifest?.items.map((item) => item.id)).toEqual(['update-checklist-flow'])

    await app.page.getByRole('button', { name: 'Switch to default y...' }).click()
    await expect(notice).toContainText('This replaces your customized app UI')
    await expect(app.page.getByRole('button', { name: 'Switch to default y', exact: true })).toBeVisible()
    await expect(app.page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await app.page.getByRole('button', { name: 'Cancel' }).click()
    await expect(app.page.getByRole('button', { name: 'Select changes' })).toBeVisible()
  })

  test('stacks app update and Userland update cards from the bottom right', async () => {
    app = await launchPackagedY({ prepareUserData: prepareCustomizedUserland })

    const appUpdate = app.page.locator('.kernel-update-notice').filter({ hasText: 'Update available' })
    const userlandUpdate = app.page.locator('.kernel-userland-update-notice')
    await expect(appUpdate).toBeVisible({ timeout: 30_000 })
    await expect(userlandUpdate).toBeVisible({ timeout: 30_000 })

    const appBox = await appUpdate.boundingBox()
    const userlandBox = await userlandUpdate.boundingBox()
    const viewport = await app.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    expect(appBox).not.toBeNull()
    expect(userlandBox).not.toBeNull()
    expect(appBox!.y).toBeGreaterThan(userlandBox!.y)
    expect(viewport.height - (appBox!.y + appBox!.height)).toBeLessThan(50)
    expect(viewport.width - (appBox!.x + appBox!.width)).toBeLessThan(50)
    expect(viewport.width - (userlandBox!.x + userlandBox!.width)).toBeLessThan(50)
    expect(appBox!.y - (userlandBox!.y + userlandBox!.height)).toBeGreaterThanOrEqual(8)
  })

  test('stages the bundled seed for legacy installs that have Userland but no metadata', async () => {
    app = await launchPackagedY({ prepareUserData: prepareLegacyUserlandWithoutMetadata, fakeUpdateNotice: false })

    await expect(app.page.locator('.kernel-userland-update-notice')).toBeVisible({ timeout: 30_000 })
    const live = await readFile(join(app.userDataDir, 'userland/panel.tsx'), 'utf-8')
    const pending = await readFile(join(app.userDataDir, 'userland/.y/pending-panel.tsx'), 'utf-8')
    expect(live).toContain('Legacy installed y panel')
    expect(pending).toContain('Make something you want.')
    expect(pending).not.toContain('Legacy installed y panel')

    const status = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(status.pending).toBe(true)
    expect(status.customized).toBe(true)
  })

  test('skip for now hides only the current pending seed without changing Userland files', async () => {
    app = await launchPackagedY({ prepareUserData: prepareCustomizedUserland, fakeUpdateNotice: false })

    const notice = app.page.locator('.kernel-userland-update-notice')
    await expect(notice).toBeVisible({ timeout: 30_000 })
    await app.page.getByRole('button', { name: 'Leave as is' }).click()
    await expect(notice).toBeHidden()

    const live = await readFile(join(app.userDataDir, 'userland/panel.tsx'), 'utf-8')
    const pending = await readFile(join(app.userDataDir, 'userland/.y/pending-panel.tsx'), 'utf-8')
    expect(live).toContain('(customized local test)')
    expect(pending).not.toContain('(customized local test)')

    const status = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(status.pending).toBe(true)
    await expect(windowLocalStorageValue(app.page, 'y.dismissedUserlandSeedHash')).resolves.toBe(status.pendingSeedHash)
  })

  test('keeps an existing pending update when the live panel is the accepted customized seed', async () => {
    app = await launchPackagedY({
      prepareUserData: prepareAcceptedCustomizedUserlandWithPendingUpdate,
      fakeUpdateNotice: false
    })

    await expect(app.page.locator('.kernel-userland-update-notice')).toBeVisible({ timeout: 30_000 })
    const live = await readFile(join(app.userDataDir, 'userland/panel.tsx'), 'utf-8')
    const pending = await readFile(join(app.userDataDir, 'userland/.y/pending-panel.tsx'), 'utf-8')
    expect(live).toContain('Make something you want. (accepted customized)')
    expect(live).not.toContain('+ pending update')
    expect(pending).toContain('Make something you want. (accepted customized + pending update)')

    const status = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(status.pending).toBe(true)
    expect(status.customized).toBe(true)
  })

  test('stages manifest-backed Userland changes even when the previous seed was unmodified', async () => {
    app = await launchPackagedY({
      prepareUserData: prepareUnmodifiedPreviousUserlandSeed,
      fakeUpdateNotice: false
    })

    const notice = app.page.locator('.kernel-userland-update-notice')
    await expect(notice).toBeVisible({ timeout: 30_000 })
    await expect(notice).toContainText('Your customized app is safe')
    await app.page.getByRole('button', { name: 'Select changes' }).click()
    await expect(notice.getByText('Safer app UI update flow')).toBeVisible()

    const live = await readFile(join(app.userDataDir, 'userland/panel.tsx'), 'utf-8')
    const pending = await readFile(join(app.userDataDir, 'userland/.y/pending-panel.tsx'), 'utf-8')
    expect(live).toContain('Ask for follow-up changes')
    expect(live).not.toContain('Make something you want.')
    expect(pending).toContain('Make something you want.')

    const status = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(status.pending).toBe(true)
    expect(status.customized).toBe(true)
    expect(status.seedVersion).toBe('0.0.2')
    expect(status.pendingSeedVersion).toBe('0.0.2')
  })

  test('skip for now does not hide a later pending seed from a newer app update', async () => {
    app = await launchPackagedY({ prepareUserData: prepareCustomizedUserland, fakeUpdateNotice: false })

    const notice = app.page.locator('.kernel-userland-update-notice')
    await expect(notice).toBeVisible({ timeout: 30_000 })
    const originalStatus = await app.page.evaluate(() => window.y.userland.seedStatus())
    await app.page.getByRole('button', { name: 'Leave as is' }).click()
    await expect(notice).toBeHidden()
    await expect(windowLocalStorageValue(app.page, 'y.dismissedUserlandSeedHash')).resolves.toBe(
      originalStatus.pendingSeedHash
    )

    const nextSeedHash = 'f'.repeat(64)
    await writeFile(
      join(app.userDataDir, 'userland-seed.json'),
      JSON.stringify(
        {
          version: 1,
          seedHash: 'previous-bundled-seed',
          seedVersion: '0.0.0',
          customized: true,
          pendingSeedHash: nextSeedHash,
          pendingSeedVersion: '0.0.2',
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf-8'
    )
    await writeFile(join(app.userDataDir, 'userland/.y/pending-panel.tsx'), '// next bundled seed\n', 'utf-8')

    await app.page.reload()
    await expect(app.page.locator('.kernel-userland-update-notice')).toBeVisible({ timeout: 30_000 })
    const nextStatus = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(nextStatus.pendingSeedHash).toBe(nextSeedHash)
    await expect(windowLocalStorageValue(app.page, 'y.dismissedUserlandSeedHash')).resolves.toBe(
      originalStatus.pendingSeedHash
    )
  })

  test('use default replaces the customized panel and can restore the saved custom app', async () => {
    app = await launchPackagedY({ prepareUserData: prepareCustomizedUserland, fakeUpdateNotice: false })

    await expect(app.page.locator('.kernel-userland-update-notice')).toBeVisible({ timeout: 30_000 })
    await app.page.getByRole('button', { name: 'Switch to default y...' }).click()
    await app.page.getByRole('button', { name: 'Switch to default y', exact: true }).click()
    await expect(app.page.locator('.kernel-userland-update-notice')).toContainText('Custom app saved')
    await expect(app.page.getByRole('button', { name: 'Restore my custom app' })).toBeVisible()

    const live = await readFile(join(app.userDataDir, 'userland/panel.tsx'), 'utf-8')
    const seed = await readFile(resolve(__dirname, '../userland-seed/panel.tsx'), 'utf-8')
    expect(live).toBe(seed)
    const status = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(status.pending).toBe(false)
    expect(status.customized).toBe(false)
    expect(status.restoreDefaultAvailable).toBe(true)

    await app.page.getByRole('button', { name: 'Restore my custom app' }).click()
    await expect(app.page.locator('.kernel-userland-update-notice')).toBeHidden()
    const restored = await readFile(join(app.userDataDir, 'userland/panel.tsx'), 'utf-8')
    expect(restored).toContain('Make something you want. (customized local test)')
    const restoredStatus = await app.page.evaluate(() => window.y.userland.seedStatus())
    expect(restoredStatus.pending).toBe(false)
    expect(restoredStatus.customized).toBe(true)
  })
})

async function windowLocalStorageValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => window.localStorage.getItem(name), key)
}
