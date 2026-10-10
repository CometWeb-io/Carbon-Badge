import { test, expect } from './test';

test('unfinished and later transfers do not become a claimed complete document bound', async ({ page }) => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    await page.route('**/unfinished-transfer', async route => {
        await pending;
        await route.fulfill({ body: 'x'.repeat(4000), contentType: 'text/plain' });
    });
    await page.goto('/e2e/fixtures/empty.html');
    await page.addScriptTag({ type: 'module', url: '/dist/cometweb-carbon-badge.esm.js' });
    await page.evaluate(async () => {
        await customElements.whenDefined('cometweb-carbon-badge');
        (window as any).unfinishedTransferDone = false;
        void fetch('/unfinished-transfer').then(response => response.text()).then(() => { (window as any).unfinishedTransferDone = true; });
        document.body.append(document.createElement('cometweb-carbon-badge'));
    });
    const badge = page.locator('cometweb-carbon-badge');
    await expect.poll(() => badge.evaluate(el => (el as any).measurementStatus)).toMatch(/^(ready|partial)$/);
    const cutoff = await badge.evaluate(el => (el as any).badgeData.measurementWindowEndMs);
    expect(await badge.evaluate(el => (el as any).badgeData.transferUpperBoundBytes)).toBeNull();
    if (await badge.evaluate(el => (el as any).measurementStatus) === 'ready') {
        await expect(badge).toContainText('Observed-transfer SWDM v4 estimate');
    } else {
        expect(await badge.evaluate(el => (el as any).score)).toBeNull();
        await expect(badge).toContainText('grade withheld');
    }
    expect(await page.evaluate(() => (window as any).unfinishedTransferDone)).toBe(false);
    finish();
    await page.waitForFunction(() => (window as any).unfinishedTransferDone === true);
    await page.evaluate(async () => { await fetch('/e2e/fixtures/empty.html?lazy=after-cutoff').then(response => response.text()); });
    expect(await badge.evaluate(el => (el as any).badgeData.measurementWindowEndMs)).toBe(cutoff);
    expect(await badge.evaluate(el => (el as any).badgeData.transferUpperBoundBytes)).toBeNull();
});
