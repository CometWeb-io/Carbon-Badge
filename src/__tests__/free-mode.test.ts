import { afterEach, describe, expect, it, vi } from 'vitest';
import '../index';
import { clearInFlightRequests } from '../api-client';
import { estimateCO2Detailed, resetResourceTimingGuard } from '../estimator';
import { mountBadge, mountUnknown, evidenceHref } from '../render';
import type { CometWebCarbonBadge } from '../badge';

afterEach(() => {
    document.body.replaceChildren();
    clearInFlightRequests();
    resetResourceTimingGuard();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function timing(resources: object[] = [], navigation: object[] = [{ transferSize: 200_000 }]) {
    vi.stubGlobal('performance', {
        getEntriesByType: (type: string) => type === 'navigation' ? navigation : resources,
        now: () => Date.now(),
    });
}

describe('free embed contract', () => {
    it('explains incomplete timing while keeping the grade empty and linking to the tool', async () => {
        timing([{ transferSize: 0, encodedBodySize: 0 }]);
        const el = document.createElement('cometweb-carbon-badge') as CometWebCarbonBadge;
        el.setAttribute('mode', 'estimate');
        document.body.append(el);
        await vi.waitFor(() => expect(el.measurementStatus).not.toBeNull(), { timeout: 1800 });
        expect(el.measurementStatus).toBe('partial');
        expect(el.score).toBeNull();
        expect(el.badgeData?.unknownResourceCount).toBe(1);
        expect(el.shadowRoot?.textContent).toContain('1 of 2 resource sizes visible');
        expect(el.shadowRoot?.querySelector('a')?.href).toBe('https://cometweb.io/carbon-badge');
    });

    it('a bare embed measures locally without fetch or persistent storage', async () => {
        timing();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const storageRead = vi.spyOn(Storage.prototype, 'getItem');
        const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
        const el = document.createElement('cometweb-carbon-badge') as CometWebCarbonBadge;
        let detail: any;
        el.addEventListener('cometweb:badge-load', (event) => { detail = (event as CustomEvent).detail; });
        document.body.append(el);
        await vi.waitFor(() => expect(detail?.measurementSource).toBe('estimate'), { timeout: 1800 });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(storageRead).not.toHaveBeenCalled();
        expect(storageWrite).not.toHaveBeenCalled();
        expect(detail).toMatchObject({ retrievalSource: 'local', published: false, originMatched: null });
        expect(detail).not.toHaveProperty('verified');
        expect(el.shadowRoot?.textContent).toContain(new URL(location.href).hostname);
    });

    it('a url attribute alone never starts a remote scan', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const el = document.createElement('cometweb-carbon-badge') as CometWebCarbonBadge;
        el.setAttribute('url', 'https://other.example/');
        document.body.append(el);
        await vi.waitFor(() => expect(el.measurementStatus).toBe('unknown'));
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('ignores legacy allow-query even in an explicitly requested API mode', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            url: 'https://example.com/p', co2_grams: 0.2, status: 'ready',
        })));
        vi.stubGlobal('fetch', fetchSpy);
        const el = document.createElement('cometweb-carbon-badge') as CometWebCarbonBadge;
        el.setAttribute('mode', 'api');
        el.setAttribute('url', 'https://example.com/p?ID_TOKEN=a&client_secret=b#secret');
        el.setAttribute('allow-query', 'id_token,client_secret');
        document.body.append(el);
        await vi.waitFor(() => expect(el.score).toBe('B'));
        expect(new URL(fetchSpy.mock.calls[0][0]).searchParams.get('url')).toBe('https://example.com/p');
        expect(el.badgeData?.url).toBe('https://example.com/p');
    });
});

describe('local estimate completeness', () => {
    it('withholds a grade when the default buffer was already saturated at module initialization', () => {
        timing(Array.from({ length: 250 }, () => ({ transferSize: 1000 })));
        const { data } = estimateCO2Detailed();
        expect(data.status).toBe('partial');
        expect(data.co2Grams).toBeNull();
        expect(data.score).toBeNull();
        const host = document.createElement('div');
        mountUnknown(host, 'Incomplete timing', { data });
        expect(host.textContent).toContain('timing history incomplete');
        expect(host.textContent).not.toContain('251 of 251');
    });

    it('withholds a grade when navigation timing is missing', () => {
        timing([{ transferSize: 200_000 }], []);
        const { data } = estimateCO2Detailed();
        expect(data.score).toBeNull();
        expect(data.status).toBe('partial');
    });

    it('withholds a grade after timing buffer overflow', () => {
        let overflow: (() => void) | undefined;
        resetResourceTimingGuard();
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 200_000 }] : [],
            addEventListener: (_event: string, handler: () => void) => { overflow = handler; },
        });
        estimateCO2Detailed();
        overflow?.();
        expect(estimateCO2Detailed().data.score).toBeNull();
    });

    it('treats non-finite transfer sizes as unknown without throwing', () => {
        timing([{ transferSize: Infinity }]);
        expect(() => estimateCO2Detailed()).not.toThrow();
        expect(estimateCO2Detailed().data.score).toBeNull();
    });
});

describe('publication labels', () => {
    it('does not manufacture an evidence URL from an ID', () => {
        expect(evidenceHref(null, 'abcdef0123456789abcdef01')).toBe('https://cometweb.io/carbon-badge');
    });

    it('describes publication without turning a placement signal into ownership', () => {
        timing();
        const data = estimateCO2Detailed().data;
        const host = document.createElement('div');
        const model = mountBadge(host, {
            ...data, url: 'https://example.com/', publicId: 'abcdef0123456789abcdef01',
            source: 'published_snapshot', originMatched: null,
            evidenceUrl: 'https://cometweb.io/carbon-badge/abcdef0123456789abcdef01',
            validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        }, 'dark', { trust: { allowPublished: true } });
        expect((model as any).published).toBe(true);
        expect(host.textContent).toContain('Published by CometWeb');
        expect(host.textContent).toContain('example.com');
        expect(host.querySelector('a')?.getAttribute('aria-label')).toContain('example.com');
    });
});
