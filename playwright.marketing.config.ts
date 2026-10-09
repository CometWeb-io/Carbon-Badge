import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'integration', timeout: 30_000, workers: 3,
  forbidOnly: !!process.env.CI,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
