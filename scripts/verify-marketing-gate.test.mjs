import { expect, it } from 'vitest';
import { verifyMarketingReceipt } from './verify-marketing-gate.mjs';

const now = Date.parse('2026-10-10T13:00:00Z');
const manifest = { version: '2.0.3', gitSha: 'a'.repeat(40), esm: { sha256: 'b'.repeat(64) }, sourceDirty: false };
const receipt = { schema: 1, origin: 'https://example.org', version: manifest.version, gitSha: manifest.gitSha,
    esmSha256: manifest.esm.sha256, sourceDirty: false, testedAt: new Date(now - 1000).toISOString() };

it('accepts only fresh evidence for the same source, bytes and target', () => {
    expect(() => verifyMarketingReceipt(receipt, manifest, receipt.origin, now)).not.toThrow();
    for (const patch of [{ schema: 2 }, { origin: 'https://other.example' }, { version: '2.0.2' },
        { gitSha: 'c'.repeat(40) }, { esmSha256: 'd'.repeat(64) }, { sourceDirty: true },
        { testedAt: 'invalid' }, { testedAt: new Date(now + 1).toISOString() },
        { testedAt: new Date(now - 7 * 86400_000 - 1).toISOString() }]) {
        expect(() => verifyMarketingReceipt({ ...receipt, ...patch }, manifest, receipt.origin, now)).toThrow();
    }
    expect(() => verifyMarketingReceipt(receipt, { ...manifest, sourceDirty: true }, receipt.origin, now)).toThrow();
    expect(() => verifyMarketingReceipt(receipt, manifest, 'http://example.org', now)).toThrow();
    expect(() => verifyMarketingReceipt(receipt, manifest, 'https://example.org/path', now)).toThrow();
});
