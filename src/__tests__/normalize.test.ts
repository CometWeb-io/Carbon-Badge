/**
 * Tests for URL canonicalize + API fail-closed normalizer
 */
import { describe, it, expect } from 'vitest';
import {
    canonicalizeBadgeUrl,
    parseApiResponse,
    normalizeBadgeData,
} from '../normalize';

describe('canonicalizeBadgeUrl', () => {
    it('strips hash fragments', () => {
        expect(canonicalizeBadgeUrl('https://example.com/page#section')).toBe(
            'https://example.com/page',
        );
    });

    it('strips tracking and token query params but keeps semantic query', () => {
        const out = canonicalizeBadgeUrl(
            'https://example.com/catalog?item=123&utm_source=x&token=secret',
        );
        expect(out).toBe('https://example.com/catalog?item=123');
    });

    it('returns null for non-http URLs', () => {
        expect(canonicalizeBadgeUrl('javascript:alert(1)')).toBeNull();
        expect(canonicalizeBadgeUrl('')).toBeNull();
    });

    it('distinguishes different semantic query values', () => {
        const a = canonicalizeBadgeUrl('https://example.com/c?item=123');
        const b = canonicalizeBadgeUrl('https://example.com/c?item=456');
        expect(a).not.toBe(b);
    });
});

describe('parseApiResponse', () => {
    const requested = 'https://example.com';

    it('returns null for empty / missing co2 (never A+)', () => {
        expect(parseApiResponse({}, { requestedUrl: requested })).toBeNull();
        expect(
            parseApiResponse({ co2_grams: null }, { requestedUrl: requested }),
        ).toBeNull();
        expect(
            parseApiResponse({ co2_grams: NaN }, { requestedUrl: requested }),
        ).toBeNull();
    });

    it('returns null when response URL identity mismatches', () => {
        expect(
            parseApiResponse(
                {
                    url: 'https://other.com/',
                    co2_grams: 0.2,
                    cleaner_than: 50,
                },
                { requestedUrl: requested },
            ),
        ).toBeNull();
    });

    it('maps finite CO₂ to letter bands without trusting API score', () => {
        const data = parseApiResponse(
            {
                url: 'https://example.com',
                co2_grams: 0.2872,
                score: 'A',
                cleaner_than: 60,
                verified: false,
            },
            { requestedUrl: requested },
        );
        expect(data).not.toBeNull();
        expect(data!.score).toBe('B');
        expect(data!.co2Grams).toBe(0.2872);
        expect(data!.cleanerThan).toBe(60);
    });

    it('keeps cleanerThan null when benchmark missing', () => {
        const data = parseApiResponse(
            {
                url: 'https://example.com',
                co2_grams: 0.15,
            },
            { requestedUrl: requested },
        );
        expect(data!.cleanerThan).toBeNull();
    });
});

describe('normalizeBadgeData', () => {
    it('forces unknown when co2Grams missing', () => {
        const out = normalizeBadgeData({
            url: 'https://example.com',
            co2Grams: null,
            score: 'A+',
            cleanerThan: 50,
            pageWeightKb: 1,
            greenHost: false,
            verified: false,
            timestamp: 1,
            status: 'ready',
            source: 'api',
            formulaId: null,
            measurementMethod: null,
            measuredAt: null,
            validUntil: null,
            evidenceUrl: null,
        });
        expect(out!.score).toBeNull();
        expect(out!.status).toBe('unknown');
    });
});
