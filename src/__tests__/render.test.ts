import { describe, expect, it } from 'vitest';
import {
    buildBadgeMarkup,
    mountBadge,
    mountLoading,
    mountUnknown,
    trustedEvidenceUrl,
} from '../render';
import type { BadgeData } from '../types';

const readyData: BadgeData = {
    url: 'https://example.com',
    publicId: 'abcdef0123',
    co2Grams: 0.004,
    score: 'A',
    cleanerThan: 82.5,
    pageWeightKb: 120,
    greenHost: true,
    originMatched: true,
    timestamp: 1,
    status: 'ready',
    source: 'published_snapshot',
    formulaId: 'formula-v1',
    scoreModelId: 'carbon-badge-bands-v1',
    measurementMethod: 'resource-timing',
    measuredAt: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    evidenceUrl: 'https://cometweb.io/carbon-badge/abcdef0123',
};

describe('badge render model', () => {
    it('mounts loading and unknown states with textContent (no HTML injection)', () => {
        const host = document.createElement('div');
        mountLoading(host, '<loading>');
        expect(host.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(
            '<loading>',
        );
        mountUnknown(host, '<reason>');
        expect(host.querySelector('.cw-subtitle')?.textContent).toBe('<reason>');
        expect(host.querySelector('.cw-grade')?.textContent).toBe('N/D');
        expect(host.querySelector('.cw-subtitle')?.innerHTML).toBe('&lt;reason&gt;');
    });

    it('binds evidence URL to the snapshot publicId', () => {
        expect(
            trustedEvidenceUrl(
                'https://cometweb.io/carbon-badge/otherid',
                'abcdef0123',
            ),
        ).toBeNull();
        expect(
            trustedEvidenceUrl(
                'https://user:pass@cometweb.io/carbon-badge/abcdef0123',
                'abcdef0123',
            ),
        ).toBeNull();
        expect(
            trustedEvidenceUrl(
                'https://cometweb.io/carbon-badge/abcdef0123?x=1',
                'abcdef0123',
            ),
        ).toBeNull();
        expect(
            trustedEvidenceUrl(
                'https://cometweb.io/carbon-badge/abcdef0123',
                'abcdef0123',
            )?.href,
        ).toBe('https://cometweb.io/carbon-badge/abcdef0123');
    });

    it('renders verified markup only with a trusted bound evidence URL', () => {
        const host = document.createElement('div');
        const model = mountBadge(host, readyData, 'dark', {
            trust: { allowPublished: true },
        });
        expect(model.published).toBe(true);
        expect(host.querySelector('.cw-footer')?.textContent).toBe(
            'Published by CometWeb',
        );
        expect(host.querySelector('a')?.getAttribute('href')).toBe(
            'https://cometweb.io/carbon-badge/abcdef0123',
        );
        expect(host.querySelector('.cw-score-model')?.textContent).toContain(
            'CometWeb Score A',
        );
        expect(host.querySelector('.cw-subtitle')?.textContent).toContain('Measured');
        expect(model.ariaLabel).toContain('less than 0.01g');
        expect(model.ariaLabel).toContain('CometWeb Score');

        const untrustedHost = document.createElement('div');
        const untrusted = mountBadge(
            untrustedHost,
            { ...readyData, evidenceUrl: 'https://evil.test/proof' },
            'light',
            { trust: { allowPublished: true } },
        );
        expect(untrusted.published).toBe(false);
        expect(untrustedHost.querySelector('.cw-footer')?.textContent).toBe(
            'Powered by CometWeb',
        );
        expect(untrustedHost.querySelector('a')?.getAttribute('href')).toBe(
            'https://cometweb.io/carbon-badge',
        );
    });

    it('does not claim verification for a live API payload', () => {
        const result = buildBadgeMarkup(
            { ...readyData, source: 'api', publicId: null, cleanerThan: null },
            'dark',
        );

        expect(result.published).toBe(false);
        expect(result.markup).toContain('Estimated page-load footprint');
        expect(result.markup).not.toContain('Published by CometWeb');
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

        expect(result.published).toBe(false);
        expect(result.markup).toContain('Powered by CometWeb');
    });
});
