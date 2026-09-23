import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4177',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'node scripts/serve-static.mjs 4177',
    port: 4177,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
