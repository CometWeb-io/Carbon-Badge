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
    await expect(badge).toContainText(/N\/D|At least/);
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
    await expect(badge).toContainText(/N\/D|At least/);
    expect(await badge.evaluate((el: any) => ({ status: el.measurementStatus, score: el.score, reason: el.badgeData.reasonCode })))
        .toEqual({ status: 'partial', score: null, reason: 'quiescence-timeout' });
    await page.evaluate(() => clearInterval((window as any).resourceInterval));
});


test('a real cached response selects the resource-size model and preserves reported transfer', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Headless WebKit reports both force-cache fetches as network transfers; this fixture cannot qualify its native HTTP cache.');
    await page.goto('/e2e/fixtures/badge.html');
    await page.evaluate(async () => {
        await fetch('/e2e/fixtures/cache.css', { cache: 'reload' }).then(response => response.text());
        await fetch('/e2e/fixtures/cache.css', { cache: 'force-cache' }).then(response => response.text());
        (document.querySelector('cometweb-carbon-badge') as any).reload();
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toContainText('resource-size estimate');
    const data = await badge.evaluate((el: any) => el.badgeData);
    expect(data).toMatchObject({ status: 'ready', measurementScope: 'document-observed-resource-sizes', measurementMethod: 'resource_timing_resource_sizes', formulaId: 'swdm-v4-lite-resource-sizes-v1' });
    expect(data.modelledResourceBytes).toBeGreaterThan(data.networkTransferBytes);
    expect(data.cachedBodyBytes).toBeGreaterThan(0);
    await expect(badge.getByRole('button')).toHaveCount(0);
});

test('the recovery button reloads the actual document after a query-only SPA change', async ({ page }) => {
    await page.goto('/e2e/fixtures/badge.html');
    await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus != null);
    await page.evaluate(() => {
        history.pushState({}, '', '/e2e/fixtures/badge.html?next=2');
        (document.querySelector('cometweb-carbon-badge') as any).reload();
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge.getByRole('button', { name: 'Reload this page' })).toBeVisible();
    await Promise.all([
        page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() }),
        badge.getByRole('button', { name: 'Reload this page' }).click(),
    ]);
    await page.waitForFunction(() => (document.querySelector('cometweb-carbon-badge') as any)?.measurementStatus === 'ready');
    expect(await badge.evaluate((el: any) => el.badgeData.reasonCode)).toBeUndefined();
});
