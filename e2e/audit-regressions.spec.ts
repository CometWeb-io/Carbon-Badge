import { test, expect } from './test';

test('a cross-origin response without TAO withholds the grade in the real browser', async ({ page }) => {
    await page.route('https://hidden.test/asset', route => route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
        contentType: 'text/plain', body: 'x'.repeat(1000),
    }));
    await page.goto('/e2e/fixtures/badge.html');
    await page.evaluate(async () => {
        await fetch('https://hidden.test/asset').then(response => response.text());
        (document.querySelector('cometweb-carbon-badge') as any).reload();
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toContainText('N/D');
    await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.badgeData?.reasonCode === 'unobservable-resource');
    expect(await badge.evaluate((el: any) => el.score)).toBeNull();
});

test('a SPA route cannot reuse first-document timing as its own score', async ({ page }) => {
    await page.goto('/e2e/fixtures/badge.html');
    await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
    await page.evaluate(() => {
        history.pushState({}, '', '/changed-route?id=2');
        (document.querySelector('cometweb-carbon-badge') as any).reload();
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toContainText('N/D');
    await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus === 'stale');
    expect(await badge.evaluate((el: any) => ({ status: el.measurementStatus, score: el.score, reason: el.badgeData.reasonCode })))
        .toEqual({ status: 'stale', score: null, reason: 'document-url-changed' });
});

test('continuous resources reach the hard deadline without a grade', async ({ page }) => {
    await page.goto('/e2e/fixtures/empty.html');
    await page.addScriptTag({ type: 'module', url: '/dist/cometweb-carbon-badge.esm.js' });
    await page.evaluate(async () => {
        await customElements.whenDefined('cometweb-carbon-badge');
        let i = 0;
        (window as any).resourceInterval = setInterval(() => {
            void fetch(`/e2e/fixtures/empty.html?late=${i++}`, { cache: 'no-store' }).then(response => response.text());
        }, 100);
        document.body.append(document.createElement('cometweb-carbon-badge'));
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toContainText('N/D');
    expect(await badge.evaluate((el: any) => ({ status: el.measurementStatus, score: el.score, reason: el.badgeData.reasonCode })))
        .toEqual({ status: 'partial', score: null, reason: 'quiescence-timeout' });
    await page.evaluate(() => clearInterval((window as any).resourceInterval));
});
