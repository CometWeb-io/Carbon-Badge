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

    describe('lower bound for hidden resource sizes', () => {
        const floorData = (co2LowerBoundGrams: number): BadgeData => ({
            ...readyData,
            co2Grams: null,
            score: null,
            status: 'partial',
            reasonCode: 'unobservable-resource',
            co2LowerBoundGrams,
        });
        const mountFloor = (grams: number, language: 'en' | 'pl') => {
            const host = document.createElement('div');
            mountUnknown(host, 'Hidden sizes. Enable Timing-Allow-Origin or use Light.', {
                data: floorData(grams),
                language,
            });
            return host;
        };

        it('rounds the floor down so it never exceeds the measured value', () => {
            const host = mountFloor(1.239, 'en');
            expect(host.querySelector('.cw-title')?.textContent).toBe('At least 1.23 g CO₂e');
            expect(host.querySelector('[role="status"]')?.getAttribute('aria-label'))
                .toBe('example.com: At least 1.23 g CO₂e');
            // Binary floating point must not push an exact value one step down.
            expect(mountFloor(0.29, 'en').querySelector('.cw-title')?.textContent)
                .toBe('At least 0.29 g CO₂e');
        });

        it('uses the Polish decimal comma for lang="pl"', () => {
            const host = mountFloor(1.239, 'pl');
            expect(host.querySelector('.cw-title')?.textContent).toBe('Co najmniej 1,23 g CO₂e');
            expect(host.querySelector('[role="status"]')?.getAttribute('aria-label'))
                .toContain('Co najmniej 1,23 g CO₂e');
        });

        it('adds digits for small floors instead of lifting them to 0.01', () => {
            expect(mountFloor(0.004_49, 'en').querySelector('.cw-title')?.textContent)
                .toBe('At least 0.004 g CO₂e');
            expect(mountFloor(0.004_49, 'pl').querySelector('.cw-title')?.textContent)
                .toBe('Co najmniej 0,004 g CO₂e');
            const tiny = mountFloor(0.000_000_4, 'en');
            expect(tiny.querySelector('.cw-grade')?.textContent).toBe('N/D');
            expect(tiny.textContent).not.toContain('At least');
        });
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

    it('does not call an untrusted cached source a published snapshot', () => {
        const result = buildBadgeMarkup(
            { ...readyData, measuredAt: null, cleanerThan: null },
            'dark',
            { allowPublished: false },
        );
        expect(result.published).toBe(false);
        expect(result.markup).toContain('Powered by CometWeb');
        expect(result.markup).not.toContain('Published snapshot');
        expect(result.markup).not.toContain('/carbon-badge/abcdef0123');
    });
});
