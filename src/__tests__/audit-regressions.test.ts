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
        expect(result.pageWeightBytes).toBe(30_000);
        expect(result.data).toMatchObject({
            networkTransferBytes: 10_000, encodedBodyBytes: 29_000,
            cachedBodyBytes: 20_000, status: 'ready',
            measurementScope: 'document-observed-resource-sizes',
            measurementMethod: 'resource_timing_resource_sizes',
            formulaId: 'swdm-v4-lite-resource-sizes-v1',
        });
        expect(result.data.co2Grams).toBeCloseTo(0.004446, 9);
    });

    it('records conditional cache revalidation without charging the cached body as transfer', () => {
        timing([{ transferSize: 300, encodedBodySize: 20_000 }]);
        const result = estimateCO2Detailed();
        expect(result.pageWeightBytes).toBe(30_000);
        expect(result.data).toMatchObject({ cachedBodyBytes: 20_000, networkTransferBytes: 10_300, status: 'ready' });
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


describe('known-size cache estimates', () => {
    it('estimates an all-cached document while keeping actual network bytes zero', () => {
        timing([{ transferSize: 0, encodedBodySize: 20_000 }], [{ transferSize: 0, encodedBodySize: 10_000 }]);
        const result = estimateCO2Detailed();
        expect(result.pageWeightBytes).toBe(30_000);
        expect(result.data).toMatchObject({ status: 'ready', networkTransferBytes: 0, cachedBodyBytes: 30_000, estimatePartial: false });
        expect(result.data.co2Grams).toBeCloseTo(0.004446, 9);
        const root = document.createElement('div');
        mountBadge(root, result.data, 'dark', { language: 'pl' });
        expect(root.textContent).toContain('rozmiarów zasobów');
        expect(root.textContent).not.toContain('pierwsze ładowanie');
        expect(root.textContent).not.toContain('Brak pełnych danych');
        expect(root.querySelector('[role="status"]')?.getAttribute('aria-label')).toContain('rozmiarów zasobów');
    });
    it('withholds a cached estimate if even one resource is opaque', () => {
        timing([{ transferSize: 0, encodedBodySize: 20_000 }, { transferSize: 0, encodedBodySize: 0 }]);
        const data = estimateCO2Detailed().data;
        expect(data).toMatchObject({ status: 'partial', score: null, co2Grams: null, reasonCode: 'unobservable-resource' });
        const root = document.createElement('div');
        mountBadge(root, data, 'dark', { language: 'pl' });
        expect(root.querySelector('button')).toBeNull();
        expect(root.textContent).toContain('Timing-Allow-Origin');
        expect(root.textContent).not.toContain('niepełna historia');
    });
    it('offers a real document reload after a SPA route change', () => {
        timing([], [{ name: 'https://example.com/', transferSize: 10_000 }]);
        vi.stubGlobal('location', { href: 'https://example.com/new-route' });
        const root = document.createElement('div');
        mountBadge(root, estimateCO2Detailed().data, 'dark', { language: 'pl' });
        expect(root.querySelector('button')?.getAttribute('data-cw-action')).toBe('reload-document');
        expect(root.querySelector('button')?.textContent).toContain('Odśwież');
    });
    it('does not invalidate the same document on a hash-only change', () => {
        timing();
        vi.stubGlobal('location', { href: 'https://example.com/#one' });
        estimateCO2Detailed();
        vi.stubGlobal('location', { href: 'https://example.com/#two' });
        expect(estimateCO2Detailed().data.status).toBe('ready');
    });
});


describe('cache timing validation', () => {
    it.each([1, 100, 300, 301])('recognizes a revalidated %s-byte body with or without deliveryType', encodedBodySize => {
        for (const deliveryType of [undefined, 'cache']) {
            timing([{ transferSize: 300, encodedBodySize, deliveryType }]);
            expect(estimateCO2Detailed().data).toMatchObject({ measurementScope: 'document-observed-resource-sizes', cachedBodyBytes: encodedBodySize });
            timing([], [{ transferSize: 300, encodedBodySize, deliveryType }]);
            expect(estimateCO2Detailed().data.measurementScope).toBe('document-observed-resource-sizes');
        }
    });
    it.each([undefined, NaN, -1, Infinity])('withholds the cache model when encoded size is malformed (%s)', encodedBodySize => {
        timing([{ transferSize: 0, encodedBodySize: 20_000 }, { transferSize: 300, encodedBodySize }]);
        expect(estimateCO2Detailed().data).toMatchObject({ score: null, reasonCode: 'unobservable-resource' });
    });
    it('does not throw or grade a malformed navigation identity', () => {
        timing([], [{ name: 'malformed', transferSize: 10_000 }]);
        expect(estimateCO2Detailed().data).toMatchObject({ score: null, status: 'stale' });
    });
});


it.each([undefined, NaN, -1, Infinity])('keeps malformed cache sizes ungraded in the element and error event (%s)', async encodedBodySize => {
    timing([{ transferSize: 0, encodedBodySize: 20_000 }, { transferSize: 300, encodedBodySize }]);
    const el = document.createElement('cometweb-carbon-badge') as CometWebCarbonBadge;
    let detail: any;
    el.addEventListener('cometweb:badge-error', event => { detail = (event as CustomEvent).detail; });
    document.body.append(el);
    await vi.waitFor(() => expect(detail?.reasonCode).toBe('unobservable-resource'), { timeout: 1800 });
    expect(el.badgeData).toMatchObject({ score: null, co2Grams: null, status: 'partial' });
    expect(detail.status).toBe('partial');
    expect(el.shadowRoot?.querySelector('button')).toBeNull();
});
