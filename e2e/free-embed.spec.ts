import { test, expect } from './test';

test('a late embed cannot grade a previously saturated timing buffer', async ({ page }) => {
  await page.goto('/e2e/fixtures/empty.html');
  const retained = await page.evaluate(async () => {
    performance.clearResourceTimings();
    performance.setResourceTimingBufferSize(250);
    for (let batch = 0; batch < 14; batch++) {
      await Promise.all(Array.from({ length: 20 }, (_, i) =>
        fetch(`/e2e/fixtures/empty.html?resource=${batch * 20 + i}`, { cache: 'no-store' }).then(r => r.text())));
    }
    return performance.getEntriesByType('resource').length;
  });
  expect(retained).toBe(250);
  await page.addScriptTag({ type: 'module', url: '/dist/cometweb-carbon-badge.esm.js' });
  await page.evaluate(() => document.body.append(document.createElement('cometweb-carbon-badge')));
  await expect(page.locator('cometweb-carbon-badge')).toContainText('N/D');
  expect(await page.locator('cometweb-carbon-badge').evaluate((el: any) => ({ score: el.score, status: el.measurementStatus })))
    .toEqual({ score: null, status: 'partial' });
});

test('default embed stays local through theme, variant and narrow layouts', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname === 'app.cometweb.io') apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    (window as any).badgeStorageCalls = [];
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method];
      (Storage.prototype[method] as any) = function (this: Storage, ...args: any[]) {
        if (String(args[0]).includes('cometweb:carbon-badge')) {
          (window as any).badgeStorageCalls.push(method);
        }
        return (original as any).apply(this, args);
      };
    }
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/e2e/fixtures/badge.html?token=secret#private');
  await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
  const badge = page.locator('cometweb-carbon-badge');
  for (const theme of ['light', 'dark']) {
    for (const variant of ['default', 'compact', 'minimal']) {
      await badge.evaluate((el, settings) => {
        el.setAttribute('theme', settings.theme);
        el.setAttribute('variant', settings.variant);
      }, { theme, variant });
      await expect(badge).toContainText('127.0.0.1');
      await expect(badge).toContainText('Powered by CometWeb');
      const state = await badge.evaluate((el: any) => ({
        url: el.badgeData?.url,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      }));
      expect(state.url).not.toContain('secret');
      expect(state.url).not.toContain('private');
      expect(state.overflow).toBe(false);
    }
  }
  expect(apiRequests).toEqual([]);
  expect(await page.evaluate(() => (window as any).badgeStorageCalls)).toEqual([]);
});
