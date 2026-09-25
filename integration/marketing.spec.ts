import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const origin = process.env.BADGE_MARKETING_ORIGIN;
if (!origin) throw Error('Set BADGE_MARKETING_ORIGIN to the local production-build server');
const assetPath = '/scripts/carbon-badge/2.0.0/cometweb-carbon-badge.esm.js';
const esm = readFileSync('dist/cometweb-carbon-badge.esm.js');
const sri = `sha384-${createHash('sha384').update(esm).digest('base64')}`;

test('production delivery returns exact bytes and cross-origin headers', async ({ request }) => {
  const response = await request.get(origin + assetPath);
  expect(response.status()).toBe(200);
  expect(await response.body()).toEqual(esm);
  expect(response.headers()['access-control-allow-origin']).toBe('*');
  expect(response.headers()['timing-allow-origin']).toBe('*');
  expect(response.headers()['cache-control']).toContain('immutable');
  expect(response.headers()['content-type']).toContain('javascript');
});

for (const locale of ['', '/pl']) {
  test(`landing ${locale || 'EN'} offers working preview and copy-ready local mode`, async ({ page }) => {
    const apiRequests: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).hostname === 'app.cometweb.io') apiRequests.push(request.url());
    });
    await page.goto(`${origin}${locale}/carbon-badge`);
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toBeVisible();
    await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
    await expect(badge).toHaveAttribute('mode', 'estimate');
    await page.locator('.cw-cb-toggles').getByRole('button', { name: 'light', exact: true }).click();
    await page.locator('.cw-cb-toggles').getByRole('button', { name: 'compact', exact: true }).click();
    await expect(badge).toHaveAttribute('theme', 'light');
    await expect(badge).toHaveAttribute('variant', 'compact');
    const code = await page.locator('.badge-embed-code').innerText();
    expect(code).toContain(sri);
    expect(code).toContain('mode="estimate"');
    expect(code).toContain('theme="light" variant="compact"');
    expect(code).toContain(`https://cometweb.io${assetPath}`);
    await expect(page.locator('.badge-download')).toHaveAttribute('href', assetPath);
    await page.getByRole('button', { name: 'self-host', exact: true }).click();
    await expect(page.locator('.badge-embed-code')).toContainText('src="/scripts/cometweb-carbon-badge.esm.js"');
    for (const width of [390, 320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(apiRequests).toEqual([]);
  });
}

test('copied hosted snippet executes cross-origin with SRI and no Insight requests', async ({ page }) => {
  await page.goto(`${origin}/carbon-badge`);
  const code = await page.locator('.badge-embed-code').innerText();
  // Change only the hosting origin so real CORS/SRI are exercised locally.
  const localCode = code.replace('https://cometweb.io', origin!);
  const visitorServer = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'self'; script-src 'self' ${origin}; style-src 'unsafe-inline'; connect-src 'none'`,
    });
    response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${localCode}</body></html>`);
  });
  await new Promise<void>(resolve => visitorServer.listen(0, '127.0.0.1', resolve));
  const visitorOrigin = `http://127.0.0.1:${(visitorServer.address() as AddressInfo).port}`;
  const context = await page.context().browser()!.newContext();
  try {
    const visitor = await context.newPage();
    const apiRequests: string[] = [];
    visitor.on('request', request => {
      if (new URL(request.url()).hostname === 'app.cometweb.io') apiRequests.push(request.url());
    });
    await visitor.goto(visitorOrigin);
    await visitor.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
    await expect(visitor.locator('cometweb-carbon-badge')).toContainText('Powered by CometWeb');
    expect(apiRequests).toEqual([]);
    expect(await visitor.evaluate(() => localStorage.length)).toBe(0);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => visitorServer.close(error => error ? reject(error) : resolve()));
  }
});
