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
      const host = document.querySelector('cometweb-carbon-badge') as any;
      return host?.measurementStatus !== null;
    });

    const state = await page.evaluate(() => {
      const host = document.querySelector('cometweb-carbon-badge');
      const badge = host as any;
      return {
        text: host?.shadowRoot?.textContent || '',
        score: badge?.score ?? null,
        co2Grams: badge?.co2Grams ?? null,
        status: badge?.measurementStatus ?? null,
      };
    });

    expect(state.status).toMatch(/^(ready|partial|unknown)$/);
    if (state.status === 'unknown') {
      expect(state.score).toBeNull();
      expect(state.co2Grams).toBeNull();
      expect(state.text).toContain('N/D');
    } else {
      expect(state.score).toMatch(/^(A\+|A|B|C|D|F)$/);
      expect(state.co2Grams).toEqual(expect.any(Number));
    }

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
