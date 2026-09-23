import { test, expect, type Page } from '@playwright/test';

async function gotoWithResponse(page: Page, payload: Record<string, unknown>) {
  await page.route('**/public/carbon-badge?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.goto('/e2e/fixtures/api.html');
  await page.waitForFunction(() => {
    const host = document.querySelector('cometweb-carbon-badge') as any;
    return host?.measurementStatus !== null;
  });
}

test.describe('API status contracts', () => {
  test('renders an owner-facing published snapshot with an accessible proof link', async ({ page }) => {
    const measuredAt = new Date(Date.now() - 60_000).toISOString();
    const validUntil = new Date(Date.now() + 86_400_000).toISOString();
    await page.route('**/public/carbon-badge/id/abcdef0123?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          public_id: 'abcdef0123',
          url: 'https://example.com/snapshot',
          co2_grams: 0.23,
          status: 'ready',
          verified: true,
          measurement_source: 'published_snapshot',
          measured_at: measuredAt,
          valid_until: validUntil,
          evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
        }),
      });
    });
    await page.goto('/e2e/fixtures/snapshot.html');
    await page.waitForFunction(() => {
      const host = document.querySelector('cometweb-carbon-badge') as any;
      return host?.measurementStatus === 'ready';
    });

    await expect(page.locator('cometweb-carbon-badge')).toContainText('Measured');
    const proofLink = page.getByRole('link', { name: /Carbon footprint:/ });
    await expect(proofLink).toHaveAttribute(
      'href',
      'https://cometweb.io/carbon-badge/abcdef0123',
    );
    await expect(proofLink).toHaveAttribute(
      'aria-label',
      /opens in new tab/,
    );
  });

  test('renders the exact current API measurement', async ({ page }) => {
    await gotoWithResponse(page, {
      url: 'https://example.com/api-ready',
      co2_grams: 0.23,
      cleaner_than: 72,
      verified: false,
      status: 'ready',
      formula_id: 'cometweb_scan_transfer_v2',
    });

    const state = await page.evaluate(() => {
      const host = document.querySelector('cometweb-carbon-badge') as any;
      return { score: host.score, co2: host.co2Grams, status: host.measurementStatus };
    });
    expect(state).toEqual({ score: 'B', co2: 0.23, status: 'ready' });
  });

  test('renders revoked measurements as N/D', async ({ page }) => {
    await gotoWithResponse(page, {
      url: 'https://example.com/api-ready',
      co2_grams: 0.23,
      status: 'revoked',
    });

    await expect(page.locator('cometweb-carbon-badge')).toContainText('N/D');
    const state = await page.evaluate(() => {
      const host = document.querySelector('cometweb-carbon-badge') as any;
      return { score: host.score, co2: host.co2Grams, status: host.measurementStatus };
    });
    expect(state).toEqual({ score: null, co2: null, status: 'unknown' });
  });

  test('renders expired measurements as stale and not verified', async ({ page }) => {
    await gotoWithResponse(page, {
      url: 'https://example.com/api-ready',
      co2_grams: 0.23,
      status: 'ready',
      verified: true,
      evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
      valid_until: '2020-01-01T00:00:00.000Z',
    });

    await expect(page.locator('cometweb-carbon-badge')).toContainText('Stale measurement');
    await expect(page.locator('cometweb-carbon-badge')).not.toContainText('Verified by CometWeb');
  });
});
