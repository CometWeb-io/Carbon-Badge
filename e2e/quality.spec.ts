import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './test';

test('PL/EN and all variants remain accessible at 200% zoom, RTL and forced colors', async ({ page, browserName }) => {
  await page.goto('/e2e/fixtures/badge.html');
  await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; document.documentElement.dir = 'rtl'; });
  const badge = page.locator('cometweb-carbon-badge');
  for (const theme of ['dark', 'light']) for (const lang of ['pl', 'en']) for (const variant of ['default', 'compact', 'minimal']) {
    await page.evaluate(theme => { document.documentElement.style.backgroundColor = theme === 'dark' ? '#111' : '#fff'; }, theme);
    await badge.evaluate((el, settings) => { el.setAttribute('theme', settings.theme); el.setAttribute('lang', settings.lang); el.setAttribute('variant', settings.variant); }, { theme, lang, variant });
    await expect(badge).toContainText(lang === 'pl' ? 'CometWeb' : 'Powered by CometWeb');
    expect(await badge.evaluate(el => el.shadowRoot?.querySelector('[role="status"]')?.getAttribute('lang'))).toBe(lang);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const audit = await new AxeBuilder({ page }).include('cometweb-carbon-badge').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(audit.violations).toEqual([]);
  }
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await expect(badge).toBeVisible();
  expect(await badge.evaluate(el => Number.parseFloat(getComputedStyle(el.shadowRoot!.querySelector('.cw-footer')!).fontSize))).toBeGreaterThanOrEqual(12);
  // Safari's default macOS navigation reaches links with Option+Tab.
  await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
  expect(await badge.evaluate(el => el.shadowRoot?.activeElement?.matches('a,button'))).toBe(true);
});

for (const entry of ['sdk', 'embed']) test(`${entry}: strict CSP can style a fallback sheet using the host nonce without network measurements`, async ({ page }) => {
  test.skip(entry === 'embed' && process.env.BADGE_E2E_SOURCE === '1', 'The split entry requires compiled release artifacts.');
  await page.addInitScript(() => { delete (CSSStyleSheet.prototype as any).replaceSync; });
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname === 'app.cometweb.io') requests.push(request.url()); });
  await page.goto(entry === 'embed' ? '/e2e/fixtures/csp-embed.html' : '/e2e/fixtures/csp.html');
  await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
  const badge = page.locator('cometweb-carbon-badge');
  const style = await badge.evaluate(el => ({
    nonce: (el.shadowRoot?.querySelector('style') as HTMLStyleElement)?.nonce,
    background: getComputedStyle(el.shadowRoot!.querySelector('.cw-badge')!).backgroundColor,
  }));
  expect(style).toEqual({ nonce: 'badge-fixture', background: 'rgb(25, 35, 29)' });
  await expect(badge).toContainText('CometWeb');
  expect(requests).toEqual([]);
});

test('SPA invalidates the displayed grade without a host reload call', async ({ page }) => {
  await page.goto('/e2e/fixtures/badge.html');
  await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
  await page.evaluate(() => history.pushState({}, '', '/automatically-stale?route=2'));
  await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus === 'stale');
  await expect(page.locator('cometweb-carbon-badge')).toContainText('N/D');
});

for (const format of ['esm', 'umd']) test(`${format}: a snapshot is fetched only near the viewport and rechecked at expiry`, async ({ page }) => {
  let calls = 0;
  await page.route('**/public/carbon-badge/id/abcdef0123?**', async route => {
    calls++;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      public_id: 'abcdef0123', url: 'https://example.com/snapshot',
      co2_grams: calls === 1 ? 0.09995 : null, status: calls === 1 ? 'ready' : 'revoked',
      measurement_source: 'published_snapshot', formula_id: 'swdm-v4-lite-first-load-v1',
      measurement_method: 'resource_timing_lite', score_model_id: 'carbon-badge-bands-v1',
      measured_at: new Date(Date.now() - 60_000).toISOString(), valid_until: new Date(Date.now() + 2_000).toISOString(),
      evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
    }) });
  });
  await page.goto('/e2e/fixtures/empty.html');
  await page.addScriptTag({ type: format === 'esm' ? 'module' : undefined, url: `/dist/cometweb-carbon-badge.${format}.js` });
  await page.evaluate(async () => {
    await customElements.whenDefined('cometweb-carbon-badge');
    const space = document.createElement('div'); space.style.height = '3000px'; document.body.append(space);
    const badge = document.createElement('cometweb-carbon-badge'); badge.setAttribute('snapshot-id', 'abcdef0123'); document.body.append(badge);
  });
  await expect(page.locator('cometweb-carbon-badge')).toContainText('Waiting until visible');
  expect(calls).toBe(0);
  await page.locator('cometweb-carbon-badge').scrollIntoViewIfNeeded();
  await expect(page.locator('cometweb-carbon-badge')).toContainText('0.09995g');
  await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus === 'revoked');
  await expect(page.locator('cometweb-carbon-badge')).toContainText('N/D');
  expect(calls).toBe(2);
});
