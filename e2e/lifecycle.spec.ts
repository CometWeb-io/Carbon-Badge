import { test, expect } from '@playwright/test';

test.describe('carbon badge lifecycle (CB-29)', () => {
  test('registers CE, renders estimate without invented empty A+, unmount is clean', async ({
    page,
  }) => {
    await page.goto('/e2e/fixtures/badge.html');

    await page.waitForFunction(() => !!customElements.get('cometweb-carbon-badge'));

    const el = page.locator('cometweb-carbon-badge');
    await expect(el).toBeVisible();

    await page.waitForFunction(() => {
      const host = document.querySelector('cometweb-carbon-badge');
      const root = host?.shadowRoot;
      return !!root && (root.textContent || '').trim().length > 0;
    });

    const text = await page.evaluate(() => {
      const host = document.querySelector('cometweb-carbon-badge');
      return host?.shadowRoot?.textContent || '';
    });

    // Fail-closed: unknown/empty must never paint a lone invented A+.
    expect(text.includes('N/D') || /\d/.test(text)).toBeTruthy();

    const isCe = await page.evaluate(() => {
      const host = document.querySelector('cometweb-carbon-badge');
      return host instanceof HTMLElement && !!host.shadowRoot;
    });
    expect(isCe).toBe(true);

    await page.evaluate(() => {
      document.querySelector('cometweb-carbon-badge')?.remove();
    });
    await expect(page.locator('cometweb-carbon-badge')).toHaveCount(0);
  });
});
