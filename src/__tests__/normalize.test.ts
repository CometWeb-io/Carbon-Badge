/**
 * Tests for URL canonicalize + API fail-closed normalizer
 */
import { describe, it, expect } from 'vitest';
import {
    canonicalizeBadgeUrl,
    parseApiResponse,
    normalizeBadgeData,
    sanitizeAllowedQueryKeys,
} from '../normalize';
import { SCORE_MODEL_ID_COMETWEB_BANDS_V1 } from '../types';

const SNAPSHOT_PROVENANCE = {
    formula_id: 'swdm-v4-lite',
    measurement_method: 'cometweb_scan_transfer_v2',
    score_model_id: SCORE_MODEL_ID_COMETWEB_BANDS_V1,
} as const;

describe('canonicalizeBadgeUrl', () => {
    it('strips hash fragments', () => {
        expect(canonicalizeBadgeUrl('https://example.com/page#section')).toBe(
            'https://example.com/page',
        );
    });

    it('strips all query params by default (privacy-safe)', () => {
        expect(
            canonicalizeBadgeUrl(
                'https://example.com/catalog?item=123&utm_source=x&email=a@b.c',
            ),
        ).toBe('https://example.com/catalog');
    });

    it('keeps only allowlisted query keys when provided', () => {
        expect(
            canonicalizeBadgeUrl(
                'https://example.com/c?item=123&email=x@y.z&utm_source=a',
                ['item'],
            ),
        ).toBe('https://example.com/c?item=123');
    });

    it('drops sensitive keys even when allowlisted', () => {
        expect(
            canonicalizeBadgeUrl(
                'https://example.com/c?item=1&token=secret',
                ['item', 'token'],
            ),
        ).toBe('https://example.com/c?item=1');
    });

    it('returns null for non-http URLs', () => {
        expect(canonicalizeBadgeUrl('javascript:alert(1)')).toBeNull();
        expect(canonicalizeBadgeUrl('')).toBeNull();
    });

    it('rejects credentials in the authority', () => {
        expect(
            canonicalizeBadgeUrl('https://user:password@example.com/'),
        ).toBeNull();
    });
});

describe('sanitizeAllowedQueryKeys', () => {
    it('dedupes and strips sensitive keys', () => {
        expect(
            sanitizeAllowedQueryKeys(['Item', 'item', 'token', 'email', 'id']),
        ).toEqual(['item', 'id']);
    });
});

describe('parseApiResponse', () => {
    const requested = 'https://example.com';

    it('maps formula_version into formulaId', () => {
        const data = parseApiResponse(
            {
                url: 'https://example.com',
                co2_grams: 0.2,
                status: 'ready',
                formula_version: 'cometweb_v2_2026',
            },
            { requestedUrl: 'https://example.com' },
        );
        expect(data?.formulaId).toBe('cometweb_v2_2026');
    });

    it('returns null for empty / missing co2 (never A+)', () => {
        expect(parseApiResponse({}, { requestedUrl: requested })).toBeNull();
        expect(
            parseApiResponse({ co2_grams: null }, { requestedUrl: requested }),
        ).toBeNull();
        expect(
            parseApiResponse({ co2_grams: NaN }, { requestedUrl: requested }),
        ).toBeNull();
    });

    it('returns null when status is missing (fail-closed)', () => {
        expect(
            parseApiResponse(
                { url: requested, co2_grams: 0.2 },
                { requestedUrl: requested },
            ),
        ).toBeNull();
    });

    it('returns null when response URL is missing', () => {
        expect(
            parseApiResponse(
                { co2_grams: 0.2, status: 'ready' },
                { requestedUrl: requested },
            ),
        ).toBeNull();
    });

    it('returns null when response URL identity mismatches', () => {
        expect(
            parseApiResponse(
                {
                    url: 'https://other.com/',
                    co2_grams: 0.2,
                    status: 'ready',
                    cleaner_than: 50,
                },
                { requestedUrl: requested },
            ),
        ).toBeNull();
    });

    it('uses allow-query consistently for request/response identity', () => {
        const data = parseApiResponse(
            {
                url: 'https://example.com/product?id=123',
                co2_grams: 0.2,
                status: 'ready',
            },
            {
                requestedUrl: 'https://example.com/product?id=123',
                allowedQueryKeys: ['id'],
            },
        );
        expect(data?.url).toBe('https://example.com/product?id=123');
        expect(
            parseApiResponse(
                {
                    url: 'https://example.com/product?id=999',
                    co2_grams: 0.2,
                    status: 'ready',
                },
                {
                    requestedUrl: 'https://example.com/product?id=123',
                    allowedQueryKeys: ['id'],
                },
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
                ...SNAPSHOT_PROVENANCE,
            },
            {
                requestedUrl: 'https://example.com/blog/article',
                requestedSnapshotId: 'ABCDEF0123',
            },
        );

        expect(data?.publicId).toBe('abcdef0123');
        expect(data?.url).toBe('https://example.com/published-home');
    });

    it('rejects an expired published snapshot even when API says ready', () => {
        expect(
            parseApiResponse(
                {
                    public_id: 'abcdef0123',
                    url: 'https://example.com',
                    co2_grams: 0.2,
                    status: 'ready',
                    measurement_source: 'published_snapshot',
                    measured_at: '2026-09-01T00:00:00Z',
                    valid_until: '2026-09-02T00:00:00Z',
                    ...SNAPSHOT_PROVENANCE,
                },
                {
                    requestedUrl: 'https://example.com',
                    requestedSnapshotId: 'abcdef0123',
                    now: Date.parse('2026-09-23T00:00:00Z'),
                },
            ),
        ).toBeNull();
    });

    it('rejects snapshots missing methodological provenance', () => {
        expect(
            parseApiResponse(
                {
                    url: requested,
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'published_snapshot',
                    status: 'ready',
                    measured_at: '2026-09-22T10:00:00.000Z',
                    valid_until: '2026-10-22T10:00:00.000Z',
                    formula_id: 'swdm-v4-lite',
                    // missing measurement_method + score_model_id
                },
                {
                    requestedUrl: requested,
                    requestedSnapshotId: 'abcdef0123',
                },
            ),
        ).toBeNull();
    });

    it('rejects a snapshot response that is not marked as a published snapshot', () => {
        expect(
            parseApiResponse(
                {
                    url: requested,
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'api',
                    status: 'ready',
                    ...SNAPSHOT_PROVENANCE,
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
                    url: requested,
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'cometweb_scan',
                    status: 'ready',
                    measured_at: '2026-09-22T10:00:00.000Z',
                    valid_until: '2026-10-22T10:00:00.000Z',
                    ...SNAPSHOT_PROVENANCE,
                },
                { requestedUrl: requested, requestedSnapshotId: 'abcdef0123' },
            ),
        ).toBeNull();
        expect(
            parseApiResponse(
                {
                    url: requested,
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'published_snapshot',
                    status: 'partial',
                    measured_at: '2026-09-22T10:00:00.000Z',
                    valid_until: '2026-10-22T10:00:00.000Z',
                    ...SNAPSHOT_PROVENANCE,
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
                    url: requested,
                    public_id: 'abcdef0123',
                    co2_grams: 0.2,
                    measurement_source: 'published_snapshot',
                    status: 'ready',
                    measured_at: '2026-09-22T10:00:00.000Z',
                    valid_until: 'not-a-date',
                    ...SNAPSHOT_PROVENANCE,
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
                status: 'ready',
                cleaner_than: 60,
                verified: false,
            },
            { requestedUrl: requested },
        );
        expect(data).not.toBeNull();
        expect(data!.score).toBe('B');
        expect(data!.co2Grams).toBe(0.2872);
        expect(data!.cleanerThan).toBe(60);
        expect(data!.scoreModelId).toBe('carbon-badge-bands-v1');
    });

    it('rejects out-of-range cleaner_than instead of clamping', () => {
        expect(
            parseApiResponse(
                {
                    url: requested,
                    co2_grams: 0.2,
                    status: 'ready',
                    cleaner_than: 175,
                },
                { requestedUrl: requested },
            )?.cleanerThan,
        ).toBeNull();
    });

    it('keeps cleanerThan null when benchmark missing', () => {
        const data = parseApiResponse(
            {
                url: 'https://example.com',
                co2_grams: 0.15,
                status: 'ready',
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

    it('fail-closes expired API measurements (no letter from stale data)', () => {
        expect(
            parseApiResponse(
                {
                    url: requested,
                    co2_grams: 0.2,
                    status: 'ready',
                    valid_until: '2020-01-01T00:00:00.000Z',
                },
                {
                    requestedUrl: requested,
                    now: Date.parse('2026-09-22T00:00:00.000Z'),
                },
            ),
        ).toBeNull();
    });
});

describe('normalizeBadgeData', () => {
    it('forces unknown when co2Grams missing', () => {
        const data = normalizeBadgeData({
            url: 'https://example.com',
            publicId: null,
            co2Grams: null,
            score: 'A',
            cleanerThan: 10,
            pageWeightKb: 1,
            greenHost: false,
            verified: false,
            timestamp: 1,
            status: 'ready',
            source: 'api',
            formulaId: null,
            scoreModelId: null,
            measurementMethod: null,
            measuredAt: null,
            validUntil: null,
            evidenceUrl: null,
        });
        expect(data?.status).toBe('unknown');
        expect(data?.score).toBeNull();
    });
});
