import { describe, expect, it } from 'vitest';
import { buildBadgeMarkup, buildLoadingMarkup, buildUnknownMarkup } from '../render';
import type { BadgeData } from '../types';

const readyData: BadgeData = {
    url: 'https://example.com',
    publicId: 'abcdef0123',
    co2Grams: 0.004,
    score: 'A',
    cleanerThan: 82.5,
    pageWeightKb: 120,
    greenHost: true,
    verified: true,
    timestamp: 1,
    status: 'ready',
    source: 'published_snapshot',
    formulaId: 'formula-v1',
    measurementMethod: 'resource-timing',
    measuredAt: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    evidenceUrl: 'https://cometweb.io/carbon-badge?url=example',
};

describe('badge render model', () => {
    it('renders loading and unknown states with escaped user-facing text', () => {
        expect(buildLoadingMarkup('<loading>')).toContain(
            'aria-label="&lt;loading&gt;"',
        );
        expect(buildUnknownMarkup('<reason>')).toContain('&lt;reason&gt;');
        expect(buildUnknownMarkup('<reason>')).toContain('N/D');
    });

    it('renders verified markup only with a trusted evidence URL', () => {
        const result = buildBadgeMarkup(readyData, 'dark');
        expect(result.verified).toBe(true);
        expect(result.markup).toContain('Verified by CometWeb');
        expect(result.markup).toContain('href="https://cometweb.io/carbon-badge?url=example"');
        expect(result.markup).toContain('Measured');
        expect(result.markup).toContain('2026');
        expect(result.ariaLabel).toContain('less than 0.01g');

        const untrusted = buildBadgeMarkup(
            { ...readyData, evidenceUrl: 'https://evil.test/proof' },
            'light',
        );
        expect(untrusted.verified).toBe(false);
        expect(untrusted.markup).toContain('Powered by CometWeb');
        expect(untrusted.markup).toContain(
            'href="https://cometweb.io/carbon-badge"',
        );
    });

    it('does not claim verification for a live API payload', () => {
        const result = buildBadgeMarkup(
            { ...readyData, source: 'api', publicId: null, cleanerThan: null },
            'dark',
        );

        expect(result.verified).toBe(false);
        expect(result.markup).toContain('Estimated page-load footprint');
        expect(result.markup).not.toContain('Verified by CometWeb');
    });

    it('does not claim verification without a fresh dated snapshot', () => {
        const result = buildBadgeMarkup(
            {
                ...readyData,
                measuredAt: null,
                validUntil: null,
            },
            'dark',
        );

        expect(result.verified).toBe(false);
        expect(result.markup).toContain('Powered by CometWeb');
    });
});
