import { parseApiResponse } from '../api-response';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../index';
import { estimateCO2Detailed, resetResourceTimingGuard } from '../estimator';
import { normalizeBadgeData } from '../normalize';
import { waitForPageQuiescence } from '../page-quiescence';
import { mountBadge } from '../render';
import type { CometWebCarbonBadge } from '../badge';
import oracle from './fixtures/swdm-v4-co2js-0.19.0.json';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    resetResourceTimingGuard();
});

function timing(resources: object[] = [], navigation: object[] = [{ transferSize: 10_000, encodedBodySize: 9_000 }]) {
    resetResourceTimingGuard();
    vi.stubGlobal('performance', {
        now: () => Date.now(),
        getEntriesByType: (type: string) => type === 'navigation' ? navigation : resources,
    });
}

const response = {
    url: 'https://example.com/', co2_grams: 0.2, status: 'ready',
    measured_at: '2026-10-08T10:00:00Z', valid_until: '2026-10-10T10:00:00Z',
};
const options = { requestedUrl: response.url, now: Date.parse('2026-10-09T10:00:00Z') };

describe('audit P0/P1 regressions', () => {
    it.each(oracle.cases)('matches the pinned CO2.js SWDM v4 first-load oracle at $bytes bytes', ({ bytes, grams }) => {
        timing([], [{ transferSize: bytes }]);
        expect(estimateCO2Detailed().data.co2Grams).toBeCloseTo(grams, 12);
    });
    it('never shortens the required quiet window to fit the deadline', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('document', { readyState: 'complete' });
        vi.stubGlobal('PerformanceObserver', class { observe() {} disconnect() {} });
        const result = waitForPageQuiescence(new AbortController().signal, 500, 50).then(() => 'resolved', error => error.message);
        await vi.advanceTimersByTimeAsync(50);
        expect(await result).toMatch(/deadline/i);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('withholds measurement when quiescence cannot be observed', async () => {
        vi.stubGlobal('document', { readyState: 'complete' });
        vi.stubGlobal('PerformanceObserver', undefined);
        await expect(waitForPageQuiescence(new AbortController().signal)).rejects.toThrow(/deadline/i);
    });

    it('reports cached body sizes separately without inventing network transfer', () => {
        timing([{ transferSize: 0, encodedBodySize: 20_000 }]);
        const result = estimateCO2Detailed();
        expect(result.pageWeightBytes).toBe(10_000);
        expect(result.data).toMatchObject({
            networkTransferBytes: 10_000, encodedBodyBytes: 29_000,
            cachedBodyBytes: 20_000, status: 'partial', score: null,
            reasonCode: 'cache-outside-first-load',
        });
    });

    it('records conditional cache revalidation without charging the cached body as transfer', () => {
        timing([{ transferSize: 300, encodedBodySize: 20_000 }]);
        const result = estimateCO2Detailed();
        expect(result.pageWeightBytes).toBe(10_300);
        expect(result.data).toMatchObject({ cachedBodyBytes: 20_000, score: null });
    });

    it('does not attribute document timing to a different SPA route', () => {
        timing([], [{ name: 'https://example.com/', transferSize: 10_000 }]);
        vi.stubGlobal('location', { href: 'https://example.com/new-route' });
        expect(estimateCO2Detailed().data).toMatchObject({ status: 'stale', score: null, reasonCode: 'document-url-changed' });
    });

    it('detects query-only SPA changes even though public identity strips queries', () => {
        timing([], [{ name: 'https://example.com/?id=1', transferSize: 10_000 }]);
        vi.stubGlobal('location', { href: 'https://example.com/?id=2' });
        expect(estimateCO2Detailed().data.score).toBeNull();
    });

    it.each(['partial', 'stale', 'revoked', 'unknown'] as const)('preserves API %s with no grade', status => {
        expect(parseApiResponse({ ...response, status, co2_grams: null }, options))
            .toMatchObject({ status, co2Grams: null, score: null });
    });

    it.each([
        { valid_until: 'not-a-date' },
        { measured_at: 'not-a-date' },
        { measured_at: '2026-10-10T11:00:00Z' },
        { measured_at: '2026-10-09T09:00:00Z', valid_until: '2026-10-09T08:00:00Z' },
    ])('withholds the API grade for invalid freshness %j', dates => {
        expect(parseApiResponse({ ...response, ...dates }, options)?.score).toBeNull();
    });

    it('preserves partial diagnostics through normalization', () => {
        timing([{ transferSize: 0, encodedBodySize: 0 }]);
        const data = estimateCO2Detailed().data;
        expect(normalizeBadgeData(data)).toMatchObject({ status: 'partial', measuredResourceCount: 1, unknownResourceCount: 1, score: null });
    });

    it('labels the actual subject of a third-party published snapshot', () => {
        timing();
        vi.stubGlobal('location', { href: 'https://embed.test/', origin: 'https://embed.test' });
        const root = document.createElement('div');
        const data = estimateCO2Detailed().data;
        mountBadge(root, {
            ...data, url: 'https://example.com/', publicId: 'abcdef0123',
            status: 'ready', co2Grams: 0.2, score: 'B', source: 'published_snapshot',
            formulaId: 'swdm-v4-lite-first-load-v1', measurementMethod: 'resource_timing_lite',
            scoreModelId: 'carbon-badge-bands-v1', measuredAt: new Date(Date.now() - 1_000).toISOString(),
            validUntil: new Date(Date.now() + 60_000).toISOString(),
            evidenceUrl: 'https://cometweb.io/carbon-badge/abcdef0123',
        }, 'dark', { trust: { allowPublished: true } });
        expect(root.textContent).toContain('example.com');
        expect(root.textContent).toContain('another page');
        expect(root.textContent).not.toContain('Verified');
    });

    it('preserves partial API status in the element and error event', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200, headers: { get: () => null },
            text: async () => JSON.stringify({ ...response, status: 'partial', co2_grams: null,
                measured_at: new Date(Date.now() - 60_000).toISOString(),
                valid_until: new Date(Date.now() + 60_000).toISOString() }),
        }));
        const el = document.createElement('cometweb-carbon-badge') as CometWebCarbonBadge;
        el.setAttribute('mode', 'api');
        el.setAttribute('url', response.url);
        const error = vi.fn();
        el.addEventListener('cometweb:badge-error', error);
        document.body.append(el);
        await vi.waitFor(() => expect(el.measurementStatus).toBe('partial'));
        expect(el.score).toBeNull();
        expect(error.mock.calls[0][0].detail.status).toBe('partial');
    });
});
