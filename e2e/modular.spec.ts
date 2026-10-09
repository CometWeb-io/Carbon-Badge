import { readFile } from 'node:fs/promises';
import { test, expect } from './test';

const waitForData = async (page: import('@playwright/test').Page) => page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
test.skip(process.env.BADGE_E2E_SOURCE === '1', 'Module graph, CORS and SRI require compiled release artifacts.');

test('local embed never requests the network chunk or touches storage', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => {
    (window as any).storageCalls = 0;
    for (const name of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[name];
      (Storage.prototype[name] as any) = function (this: Storage, ...args: any[]) {
        (window as any).storageCalls++;
        return (original as any).apply(this, args);
      };
    }
  });
  await page.goto('/e2e/fixtures/modular.html');
  await waitForData(page);
  expect(await page.locator('cometweb-carbon-badge').evaluate((el: any) => el.badgeData.source)).toBe('estimate');
  expect(requests.filter(url => url.includes('/chunks/') || new URL(url).hostname === 'app.cometweb.io')).toEqual([]);
  expect(await page.evaluate(() => (window as any).storageCalls)).toBe(0);
});

test('switching to API loads one optional chunk and preserves the public getters', async ({ page }) => {
  const chunks: string[] = [];
  page.on('request', request => { if (request.url().includes('/dist/embed/chunks/')) chunks.push(request.url()); });
  await page.route('**/public/carbon-badge?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://example.com/', status: 'ready', co2_grams: 0.23, measurement_source: 'http_estimate' }) }));
  await page.goto('/e2e/fixtures/modular.html');
  await waitForData(page);
  expect(chunks).toEqual([]);
  const badge = page.locator('cometweb-carbon-badge');
  await badge.evaluate(el => { el.setAttribute('url', 'https://example.com/'); el.setAttribute('mode', 'api'); });
  await expect(badge).toContainText('0.23g');
  expect(await badge.evaluate((el: any) => ({ score: el.score, co2: el.co2Grams, source: el.badgeData.source }))).toEqual({ score: 'B', co2: 0.23, source: 'http_estimate' });
  await badge.evaluate((el: any) => el.reload({ force: true }));
  await expect(badge).toContainText('0.23g');
  expect(chunks).toHaveLength(1);
});

test('disconnect during module loading prevents late API work and result events', async ({ page }) => {
  let release!: () => void;
  let seen!: () => void;
  let chunkUrl = '';
  let apiCalls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const chunkRequested = new Promise<void>(resolve => { seen = resolve; });
  page.on('request', request => { if (new URL(request.url()).hostname === 'app.cometweb.io') apiCalls++; });
  await page.route('**/dist/embed/chunks/**', async route => {
    chunkUrl = route.request().url(); seen();
    await gate; await route.continue();
  });
  await page.goto('/e2e/fixtures/modular.html');
  await waitForData(page);
  await page.locator('cometweb-carbon-badge').evaluate(el => {
    (window as any).detachedBadge = el; (window as any).lateEvents = 0;
    for (const event of ['cometweb:badge-load', 'cometweb:badge-error']) el.addEventListener(event, () => { (window as any).lateEvents++; });
    el.setAttribute('url', 'https://example.com/'); el.setAttribute('mode', 'api');
  });
  await chunkRequested;
  await page.evaluate(() => (window as any).detachedBadge.remove());
  release();
  await page.evaluate(async url => { await import(url); }, chunkUrl);
  expect(apiCalls).toBe(0);
  expect(await page.evaluate(() => (window as any).lateEvents)).toBe(0);
});

for (const stalled of [false, true]) test(`a ${stalled ? 'stalled' : 'missing'} network chunk withholds the grade without API fallback`, async ({ page }) => {
  let apiCalls = 0;
  page.on('request', request => { if (new URL(request.url()).hostname === 'app.cometweb.io') apiCalls++; });
  await page.route('**/dist/embed/chunks/**', route => stalled ? new Promise(() => {}) : route.fulfill({ status: 404, body: 'Missing chunk' }));
  await page.goto('/e2e/fixtures/modular.html');
  await waitForData(page);
  const badge = page.locator('cometweb-carbon-badge');
  await badge.evaluate(el => { el.setAttribute('url', 'https://example.com/'); el.setAttribute('mode', 'api'); });
  await expect(badge).toContainText('Unable to load measurement', { timeout: 10_000 });
  expect(await badge.evaluate((el: any) => ({ score: el.score, co2: el.co2Grams }))).toEqual({ score: null, co2: null });
  expect(apiCalls).toBe(0);
});

test('a cross-origin embed with SRI resolves its relative network chunk over CORS', async ({ page }) => {
  const manifest = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
  const entry = manifest.artifacts.find((file: any) => file.path === manifest.embed.entry);
  await page.route('**/public/carbon-badge/id/abcdef0123?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    public_id: 'abcdef0123', url: 'https://example.com/', status: 'ready', co2_grams: 0.18,
    measurement_source: 'published_snapshot', formula_id: 'swdm-v4-lite-first-load-v1', measurement_method: 'resource_timing_lite', score_model_id: 'carbon-badge-bands-v1',
    measured_at: new Date(Date.now() - 1000).toISOString(), valid_until: new Date(Date.now() + 60_000).toISOString(), evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
  }) }));
  const chunks: string[] = [];
  page.on('request', request => { if (request.url().includes('/dist/embed/chunks/')) chunks.push(request.url()); });
  await page.goto('/e2e/fixtures/empty.html');
  await page.evaluate(async (sri: string) => {
    const badge = document.createElement('cometweb-carbon-badge'); badge.setAttribute('snapshot-id', 'abcdef0123'); badge.setAttribute('loading', 'eager'); document.body.append(badge);
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script'); script.type = 'module'; script.src = 'http://localhost:4177/dist/embed/carbon-badge.js'; script.crossOrigin = 'anonymous'; script.integrity = sri; script.onload = () => resolve(); script.onerror = () => reject(new Error('CORS/SRI failed')); document.head.append(script);
    });
  }, entry.sri);
  await expect(page.locator('cometweb-carbon-badge')).toContainText('Published by CometWeb');
  expect(chunks).toHaveLength(1);
  expect(new URL(chunks[0]).hostname).toBe('localhost');
});
