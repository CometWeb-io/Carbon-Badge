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

    it('strips tracking query params but keeps semantic query', () => {
        const out = canonicalizeBadgeUrl(
            'https://example.com/catalog?item=123&utm_source=x',
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

    it('rejects credentials and credential-bearing query parameters', () => {
        expect(canonicalizeBadgeUrl('https://user:password@example.com/')).toBeNull();
        expect(canonicalizeBadgeUrl('https://example.com/?session_id=abc')).toBeNull();
        expect(canonicalizeBadgeUrl('https://example.com/?signature=abc')).toBeNull();
    });

    it('strips auth aliases the backend removes from public URL identity', () => {
        expect(canonicalizeBadgeUrl('https://example.com/?ref=mail&key=abc&item=1')).toBe(
            'https://example.com/?item=1',
        );
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

    it('trusts snapshot identity over the embedding page URL', () => {
        const data = parseApiResponse(
            {
                url: 'https://example.com/published-home',
                public_id: 'abcdef0123',
                co2_grams: 0.2,
                measurement_source: 'published_snapshot',
                status: 'ready',
                measured_at: '2026-09-22T10:00:00.000Z',
                valid_until: '2026-10-22T10:00:00.000Z',
            },
            {
                requestedUrl: 'https://example.com/blog/article',
                requestedSnapshotId: 'ABCDEF0123',
            },
        );

        expect(data?.publicId).toBe('abcdef0123');
        expect(data?.url).toBe('https://example.com/published-home');
    });

    it('rejects a snapshot response that is not marked as a published snapshot', () => {
        expect(
            parseApiResponse(
                {
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'api',
                },
                {
                    requestedUrl: requested,
                    requestedSnapshotId: 'abcdef0123',
                },
            ),
        ).toBeNull();
    });

    it('rejects scan aliases and partial status on the snapshot endpoint', () => {
        expect(
            parseApiResponse(
                {
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'cometweb_scan',
                    status: 'ready',
                    measured_at: '2026-09-22T10:00:00.000Z',
                    valid_until: '2026-10-22T10:00:00.000Z',
                },
                { requestedUrl: requested, requestedSnapshotId: 'abcdef0123' },
            ),
        ).toBeNull();
        expect(
            parseApiResponse(
                {
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'published_snapshot',
                    status: 'partial',
                    measured_at: '2026-09-22T10:00:00.000Z',
                    valid_until: '2026-10-22T10:00:00.000Z',
                },
                { requestedUrl: requested, requestedSnapshotId: 'abcdef0123' },
            ),
        ).toBeNull();
    });

    it('rejects unsupported runtime statuses instead of treating them as ready', () => {
        expect(
            parseApiResponse(
                { url: requested, co2_grams: 0.2, status: 'error' as never },
                { requestedUrl: requested },
            ),
        ).toBeNull();
        expect(
            parseApiResponse(
                { url: requested, co2_grams: 0.2, status: 'ok' as never },
                { requestedUrl: requested },
            )?.status,
        ).toBe('ready');
    });

    it('rejects a malformed snapshot freshness deadline', () => {
        expect(
            parseApiResponse(
                {
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'published_snapshot',
                    status: 'ready',
                    measured_at: '2026-09-22T10:00:00.000Z',
                    valid_until: 'not-a-date',
                },
                {
                    requestedUrl: requested,
                    requestedSnapshotId: 'abcdef0123',
                },
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

    it('rejects revoked and unknown responses', () => {
        expect(
            parseApiResponse(
                { url: requested, co2_grams: 0.2, status: 'revoked' },
                { requestedUrl: requested },
            ),
        ).toBeNull();
        expect(
            parseApiResponse(
                { url: requested, co2_grams: 0.2, status: 'unknown' },
                { requestedUrl: requested },
            ),
        ).toBeNull();
    });

    it('marks an expired measurement stale and preserves missing formula provenance', () => {
        const data = parseApiResponse(
            {
                url: requested,
                co2_grams: 0.2,
                valid_until: '2026-09-21T00:00:00.000Z',
            },
            { requestedUrl: requested, now: Date.parse('2026-09-22T00:00:00.000Z') },
        );
        expect(data!.status).toBe('stale');
        expect(data!.formulaId).toBeNull();
    });
});

describe('normalizeBadgeData', () => {
    it('forces unknown when co2Grams missing', () => {
        const out = normalizeBadgeData({
            url: 'https://example.com',
            publicId: null,
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

    it('does not turn malformed cleanerThan into zero', () => {
        const out = normalizeBadgeData({
            url: 'https://example.com',
            publicId: null,
            co2Grams: 0.2,
            score: 'A',
            cleanerThan: Number.NaN,
            pageWeightKb: null,
            greenHost: null,
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
        expect(out!.cleanerThan).toBeNull();
    });
});
