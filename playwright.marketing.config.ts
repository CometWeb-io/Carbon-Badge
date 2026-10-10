import { defineConfig, devices } from '@playwright/test';

const origin = process.env.BADGE_MARKETING_ORIGIN ? new URL(process.env.BADGE_MARKETING_ORIGIN) : null;
const localTls = Boolean(origin?.protocol === 'https:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));

export default defineConfig({
  testDir: 'integration', timeout: 30_000, workers: 3,
  forbidOnly: !!process.env.CI,
  use: { ignoreHTTPSErrors: localTls },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
