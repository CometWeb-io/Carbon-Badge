import { test, expect } from './test';
import snapshot from '../docs/fixtures/python-snapshot.json';

test('the Python serializer payload renders a published snapshot with microseconds', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-10T13:00:00Z'));
    await page.route('**/public/carbon-badge/id/**', route => route.fulfill({
        contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(snapshot),
    }));
    await page.goto('/e2e/fixtures/empty.html');
    await page.addScriptTag({ type: 'module', url: '/dist/cometweb-carbon-badge.esm.js' });
    await page.evaluate(async id => {
        await customElements.whenDefined('cometweb-carbon-badge');
        const badge = document.createElement('cometweb-carbon-badge');
        badge.setAttribute('snapshot-id', id);
        badge.setAttribute('loading', 'eager');
        document.body.append(badge);
    }, snapshot.public_id);
    const badge = page.locator('cometweb-carbon-badge');
    await expect(badge).toContainText('Published by CometWeb');
    await expect(badge).toContainText('0.09996g');
    expect(await badge.evaluate(el => (el as any).measurementStatus)).toBe('ready');
});
