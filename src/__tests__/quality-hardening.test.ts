import { parseApiResponse } from '../api-response';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSingleFlight, clearInFlightRequests } from '../api-client';
import { canonicalizeBadgeUrl, normalizeBadgeData, } from '../normalize';
import { estimateCO2Detailed, resetResourceTimingGuard } from '../estimator';
import { buildBadgeMarkup, mountBadge } from '../render';
import { timestampMs } from '../normalize';
import { trustedEvidenceUrl } from '../url';
import { BADGE_VERSION, FACTOR_SET_ID_SWDM_V4, FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1, SCORE_MODEL_ID_COMETWEB_BANDS_V1 } from '../types';
import factors from '../../docs/model-factors.json';
import pkg from '../../package.json';

afterEach(() => {
    clearInFlightRequests();
    resetResourceTimingGuard();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('bounded, isolated and cancellable requests', () => {
    it.each([
        [{ headers: { Authorization: 'one' } }, { headers: { Authorization: 'two' } }],
        [{ credentials: 'omit' }, { credentials: 'include' }],
        [{ cache: 'default' }, { cache: 'no-cache' }],
    ] as const)('does not share different request options %j', async (a, b) => {
        const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
        vi.stubGlobal('fetch', fetch);
        await Promise.all([fetchSingleFlight('same', a), fetchSingleFlight('same', b)]);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('keeps the other subscriber alive and aborts when the last one leaves', async () => {
        let networkSignal: AbortSignal | undefined;
        const fetch = vi.fn((_url: string, init: RequestInit) => {
            networkSignal = init.signal as AbortSignal;
            return new Promise<Response>((_resolve, reject) => networkSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
        });
        vi.stubGlobal('fetch', fetch);
        const first = new AbortController(), second = new AbortController();
        const a = fetchSingleFlight('same', { signal: first.signal }).catch(error => error.name);
        const b = fetchSingleFlight('same', { signal: second.signal }).catch(error => error.name);
        expect(fetch).toHaveBeenCalledTimes(1);
        first.abort();
        expect(await a).toBe('AbortError');
        expect(networkSignal?.aborted).toBe(false);
        second.abort();
        expect(await b).toBe('AbortError');
        expect(networkSignal?.aborted).toBe(true);
    });

    it('does not share mutations or bodies', async () => {
        const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
        vi.stubGlobal('fetch', fetch);
        await Promise.all([fetchSingleFlight('same', { method: 'POST', body: 'a' }), fetchSingleFlight('same', { method: 'POST', body: 'a' })]);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('bounds the streamed body even with no Content-Length', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(65_537))));
        await expect(fetchSingleFlight('large')).rejects.toBeInstanceOf(RangeError);
    });

    it('times out the whole read even when a response ignores abort', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), text: () => new Promise(() => {}) })));
        await expect(fetchSingleFlight('stalled-body', {}, 20)).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('never starts a fetch for an already aborted caller', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const controller = new AbortController(); controller.abort();
        await expect(fetchSingleFlight('aborted', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects redirects and provides an immutable envelope', async () => {
        const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
        vi.stubGlobal('fetch', fetch);
        const result = await fetchSingleFlight('one');
        expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
        expect(Object.isFrozen(result)).toBe(true);
    });
});

describe('measurement and presentation contracts', () => {
    it.each([
        [' PARTIAL ', 'partial'], [' stale ', 'stale'], ['Revoked', 'revoked'], ['UNKNOWN', 'unknown'],
    ] as const)('withholds cached emissions after normalizing lifecycle %s', (raw, status) => {
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [] });
        expect(normalizeBadgeData({ ...estimateCO2Detailed().data, status: raw as never })).toMatchObject({ status, co2Grams: null, score: null });
    });

    it('pins the packaged model, version and coefficients to the runtime', () => {
        expect(BADGE_VERSION).toBe(pkg.version);
        expect(factors).toMatchObject({ id: FACTOR_SET_ID_SWDM_V4, formulaId: FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1, scoreModelId: SCORE_MODEL_ID_COMETWEB_BANDS_V1 });
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: factors.bytesPerGB }] : [] });
        const intensity = [...Object.values(factors.operationalKwhPerGB), ...Object.values(factors.embodiedKwhPerGB)].reduce((a, b) => a + b, 0) * factors.gridIntensityGCo2ePerKwh;
        expect(estimateCO2Detailed().data.co2Grams).toBeCloseTo(intensity, 10);
    });

    it.each(['2026-02-31T12:00:00Z', '2026-10-09T24:00:00Z', '2026-10-09T12:00:00', '2026-10-09T12:00:00+25:00'])('rejects a malformed ISO date %s', date => {
        expect(timestampMs(date)).toBeNaN();
    });

    it('does not hide a malformed primary timestamp behind a legacy fallback', () => {
        const result = parseApiResponse({ url: 'https://example.com/', status: 'ready', co2_grams: 0.2, measured_at: 'invalid', scan_measured_at: new Date(Date.now() - 1000).toISOString() }, { requestedUrl: 'https://example.com/' });
        expect(result).toMatchObject({ status: 'partial', score: null, reasonCode: 'invalid-freshness' });
    });

    it.each(['https://cometweb.io/carbon-badge/abcdef?token=secret', 'https://secret@cometweb.io/carbon-badge/abcdef', 'https://cometweb.io/Carbon-Badge/abcdef'])('rejects an unsafe proof link %s', url => {
        expect(trustedEvidenceUrl(url, 'abcdef')).toBeNull();
    });

    it('sanitizes the subject and proof even when freshness is invalid', () => {
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [] });
        const result = normalizeBadgeData({ ...estimateCO2Detailed().data, url: 'https://example.com/?token=secret', measuredAt: 'invalid', evidenceUrl: 'https://cometweb.io/?token=secret' });
        expect(result).toMatchObject({ url: 'https://example.com/', evidenceUrl: null, status: 'partial', score: null });
    });

    it('formats the same letter boundary in Polish without rounding into the next band', () => {
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [] });
        const root = document.createElement('div');
        mountBadge(root, { ...estimateCO2Detailed().data, co2Grams: 0.09995 }, 'light', { language: 'pl' });
        expect(root.querySelector('.cw-title')?.textContent).toContain('0,09995g');
        expect(root.querySelector('.cw-grade')?.textContent).toBe('A+');
        expect(root.querySelector('[role="status"]')?.getAttribute('aria-label')).toContain('estymacja');
    });

    it('warns about a different measured path even on the same host', () => {
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [] });
        vi.stubGlobal('location', new URL('https://example.com/embedding'));
        const root = document.createElement('div');
        mountBadge(root, { ...estimateCO2Detailed().data, url: 'https://example.com/measured', publicId: 'abcdef', source: 'published_snapshot', validUntil: new Date(Date.now() + 60_000).toISOString(), evidenceUrl: 'https://cometweb.io/carbon-badge/abcdef' }, 'light', { trust: { allowPublished: true } });
        expect(root.textContent).toContain('example.com/measured');
        expect(root.textContent).toContain('result for another page');
    });

    it('rejects oversized raw and canonical URLs', () => {
        expect(canonicalizeBadgeUrl('https://example.com/' + 'a'.repeat(4096))).toBeNull();
        expect(canonicalizeBadgeUrl('https://example.com/' + 'ą'.repeat(1000))).toBeNull();
    });

    it('does not resize the host timing buffer', () => {
        const resize = vi.fn();
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [], setResourceTimingBufferSize: resize });
        expect(estimateCO2Detailed().data.score).not.toBeNull();
        expect(resize).not.toHaveBeenCalled();
    });

    it('exposes decimal KB and binary KiB without changing the legacy field', () => {
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [] });
        expect(estimateCO2Detailed().data).toMatchObject({ pageWeightKb: 1, pageWeightKiB: 1, pageWeightKB: 1.024 });
    });

    it('cannot grade an unsupported cache lifecycle or score model', () => {
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [] });
        const data = estimateCO2Detailed().data;
        expect(normalizeBadgeData({ ...data, status: 'future' as never })?.score).toBeNull();
        expect(normalizeBadgeData({ ...data, scoreModelId: 'future-model' })?.score).toBeNull();
        expect(parseApiResponse({ url: 'https://example.com/', status: 'ready', co2_grams: 0.2, score_model_id: 'future-model' }, { requestedUrl: 'https://example.com/' })).toBeNull();
    });

    it.each([0.09995, 0.19995, 0.39995, 0.69995, 0.99995])('keeps the displayed %f grams inside its letter band', grams => {
        vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1024 }] : [] });
        const data = normalizeBadgeData({ ...estimateCO2Detailed().data, co2Grams: grams })!;
        const result = buildBadgeMarkup(data, 'light');
        const root = document.createElement('div'); root.innerHTML = result.markup;
        const visible = Number(root.querySelector('.cw-title')?.textContent?.split('g')[0]);
        expect(visible).toBeLessThan(grams + 0.00001);
        expect(root.querySelector('.cw-grade')?.textContent).toBe(data.score);
    });
});
