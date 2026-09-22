/* @vitest-environment node */

import { describe, expect, it } from 'vitest';

describe('SSR import', () => {
    it('imports the package entrypoint without browser globals', async () => {
        await expect(import('../index')).resolves.toBeDefined();
    });
});
