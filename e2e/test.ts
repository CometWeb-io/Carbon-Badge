import { test as base } from '@playwright/test';
export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';

// Source-mode exercises dev/HMR code without generating release artifacts.
// The default release gate always uses dist and the static server.
export const test = base.extend({
  page: async ({ page }, use) => {
    if (process.env.BADGE_E2E_SOURCE === '1') {
      await page.route('**/dist/cometweb-carbon-badge.esm.js', route => route.fulfill({
        contentType: 'text/javascript', body: "export * from '/src/index.ts';",
      }));
    }
    await use(page);
  },
});
