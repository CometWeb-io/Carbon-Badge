import { test, expect } from './test';

test('force reload remains pending off-screen and bypasses a valid local cache on visibility', async ({ page }) => {
    let requests = 0;
    await page.route('**/public/carbon-badge?**', route => {
        requests++;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
            url: 'https://example.com/', status: 'ready', measurement_source: 'api', co2_grams: requests === 1 ? 0.2 : 0.1,
        }) });
    });
    await page.goto('/e2e/fixtures/empty.html');
    await page.addScriptTag({ type: 'module', url: '/dist/cometweb-carbon-badge.esm.js' });
    await page.evaluate(async () => {
        await customElements.whenDefined('cometweb-carbon-badge');
        const badge = document.createElement('cometweb-carbon-badge');
        badge.setAttribute('mode', 'api'); badge.setAttribute('url', 'https://example.com/');
        document.body.append(badge);
    });
    await expect(page.locator('cometweb-carbon-badge')).toContainText('0.20g');
    expect(requests).toBe(1);
    await page.evaluate(() => {
        document.querySelector('cometweb-carbon-badge')!.remove();
        const space = document.createElement('div'); space.style.height = '3000px'; document.body.append(space);
        const badge = document.createElement('cometweb-carbon-badge');
        badge.setAttribute('mode', 'api'); badge.setAttribute('url', 'https://example.com/');
        document.body.append(badge);
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toContainText('Waiting until visible');
    await badge.evaluate(el => (el as any).reload({ force: true }));
    await expect(badge).toContainText('Waiting until visible');
    expect(requests).toBe(1);
    await badge.scrollIntoViewIfNeeded();
    await expect(badge).toContainText('0.10g');
    expect(requests).toBe(2);
});

test('a persisted pageshow rechecks publication instead of retaining a revoked result', async ({ page }) => {
    let requests = 0;
    await page.route('**/public/carbon-badge/id/abcdef?**', route => {
        requests++;
        return route.fulfill({ contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({
            url: 'https://example.com/', public_id: 'abcdef', status: requests === 1 ? 'ready' : 'revoked',
            co2_grams: requests === 1 ? 0.1 : null, measurement_source: 'published_snapshot',
            formula_id: 'swdm-v4-lite-first-load-v1', measurement_method: 'resource_timing_lite', score_model_id: 'carbon-badge-bands-v1',
            measured_at: new Date(Date.now() - 1000).toISOString(), valid_until: new Date(Date.now() + 60_000).toISOString(),
            evidence_url: 'https://cometweb.io/carbon-badge/abcdef',
        }) });
    });
    await page.goto('/e2e/fixtures/empty.html');
    await page.addScriptTag({ type: 'module', url: '/dist/cometweb-carbon-badge.esm.js' });
    await page.evaluate(async () => {
        await customElements.whenDefined('cometweb-carbon-badge');
        const badge = document.createElement('cometweb-carbon-badge'); badge.setAttribute('snapshot-id', 'abcdef');
        document.body.append(badge);
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toContainText('Published by CometWeb');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(badge).toContainText('N/D');
    await expect.poll(() => badge.evaluate(el => (el as any).measurementStatus)).toBe('revoked');
    expect(requests).toBe(2);
});
