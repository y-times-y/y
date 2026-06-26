import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'desktop.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-desktop' }]],
  use: {
    trace: 'retain-on-failure'
  }
})
