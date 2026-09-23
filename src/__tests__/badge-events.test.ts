/**
 * Tests for CometWebCarbonBadge — fail-closed honesty + lifecycle.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import '../index';
import { SCORE_MODEL_ID_COMETWEB_BANDS_V1 } from '../types';
import { clearInFlightRequests } from '../api-client';
import { buildCacheKey, setCache } from '../cache';
import { canonicalizeBadgeUrl } from '../normalize';

const TAG = 'cometweb-carbon-badge';

const SNAPSHOT_PROVENANCE = {
    formula_id: 'swdm-v4-lite',
    measurement_method: 'cometweb_scan_transfer_v2',
    score_model_id: SCORE_MODEL_ID_COMETWEB_BANDS_V1,
};

function makeApiResponse(overrides: Record<string, unknown> = {}) {
    return {
        url: 'https://example.com',
        co2_grams: 0.23,
        score: 'B',
        cleaner_than: 72,
        page_weight_kb: 480,
        green_host: false,
        status: 'ready',
        cached: false,
        ttl: 720,
        ...overrides,
    };
}

function mockOkResponse(body: unknown, status = 200) {
    const bodyText = JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null as string | null },
        text: () => Promise.resolve(bodyText),
        json: () => Promise.resolve(body),
    };
}

function mockFailResponse(status = 404) {
    return {
        ok: false,
        status,
        headers: { get: () => null as string | null },
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({}),
    };
}

beforeAll(() => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('fetch not mocked in this test')),
    );
});

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    clearInFlightRequests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    localStorage.clear();
    vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('fetch not mocked in this test')),
    );
});

describe('cometweb:badge-load event', () => {
    it('is dispatched after shadow DOM is updated with badge data', async () => {
        const apiData = makeApiResponse();

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(mockOkResponse(apiData)),
        );

        const el = document.createElement(TAG) as HTMLElement;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        let eventFired = false;
        let shadowHtmlAtEventTime = '';

        el.addEventListener('cometweb:badge-load', () => {
            eventFired = true;
            shadowHtmlAtEventTime = (el as any).shadowRoot?.innerHTML ?? '';
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(eventFired).toBe(true), { timeout: 2000 });

        expect(shadowHtmlAtEventTime).toContain('B');
        expect(shadowHtmlAtEventTime).toContain('0.23');
    });

    it('exposes correct score via public getter after load', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                mockOkResponse(
                    makeApiResponse({
                        url: 'https://example.com/a',
                        score: 'A',
                        co2_grams: 0.15,
                    }),
                ),
            ),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com/a');
        el.setAttribute('mode', 'api');

        await new Promise<void>((resolve) => {
            el.addEventListener('cometweb:badge-load', () => resolve());
            document.body.appendChild(el);
        });

        expect(el.score).toBe('A');
        expect(el.co2Grams).toBe(0.15);
        expect(el.badgeData).not.toBe(el.badgeData); // copy each get
        expect(el.badgeData.co2Grams).toBe(0.15);
    });
});

describe('CB-01 fail-closed empty CO₂', () => {
    it('shows N/D for empty API body — never A+', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(mockOkResponse({})),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        let errorFired = false;
        el.addEventListener('cometweb:badge-error', () => {
            errorFired = true;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(errorFired).toBe(true), { timeout: 2000 });

        expect(el.score).toBeNull();
        expect(el.co2Grams).toBeNull();
        expect(el.shadowRoot?.innerHTML).toContain('N/D');
        expect(el.shadowRoot?.innerHTML).not.toContain('A+');
    });
});

describe('CB-04 no host estimate fallback on API failure', () => {
    it('shows N/D instead of estimating the host page', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('network down')),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://remote.example.com');
        el.setAttribute('mode', 'api');

        let errorFired = false;
        el.addEventListener('cometweb:badge-error', () => {
            errorFired = true;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(errorFired).toBe(true), { timeout: 3000 });

        expect(el.score).toBeNull();
        expect(el.shadowRoot?.innerHTML).toContain('N/D');
    });
});

describe('CB-02 tabindex only after connect', () => {
    it('createElement after define yields a real custom element without constructor tabindex race', () => {
        const el = document.createElement(TAG) as HTMLElement;
        expect(el instanceof HTMLElement).toBe(true);
        expect(el.tagName.toLowerCase()).toBe(TAG);
        // tabindex applied in connectedCallback, not constructor
        expect(el.hasAttribute('tabindex')).toBe(false);
        document.body.appendChild(el);
        expect(el.getAttribute('tabindex')).toBe('-1');
        expect(el.shadowRoot).toBeTruthy();
    });
});

describe('cometweb:badge-error event', () => {
    it('is dispatched when url resolves to empty string', async () => {
        vi.stubGlobal('location', { href: '' });
        const el = document.createElement(TAG) as HTMLElement;
        el.setAttribute('url', '');
        el.setAttribute('mode', 'api');

        let errorDetail: unknown = null;
        el.addEventListener('cometweb:badge-error', (e) => {
            errorDetail = (e as CustomEvent).detail;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(errorDetail).not.toBeNull(), {
            timeout: 1000,
        });

        expect(errorDetail).toBeDefined();
    });
});

describe('race condition guard (_loadId)', () => {
    it('_loadId increments on each reload', () => {
        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        const idBefore = el._loadId;
        el.reload();
        expect(el._loadId).toBeGreaterThan(idBefore);

        el.reload();
        expect(el._loadId).toBeGreaterThan(idBefore + 1);
    });
});

describe('API response validation', () => {
    it('renders revoked measurements as N/D', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async function () { return JSON.stringify(await this.json()); },
                json: () =>
                    Promise.resolve(
                        makeApiResponse({ co2_grams: 0.1, status: 'revoked' }),
                    ),
            }),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com/revoked');
        el.setAttribute('mode', 'api');
        document.body.appendChild(el);

        await vi.waitFor(() => expect(el.shadowRoot?.innerHTML).toContain('N/D'), {
            timeout: 2000,
        });
        expect(el.score).toBeNull();
        expect(el.shadowRoot?.innerHTML).toContain('N/D');
    });

    it('fail-closes expired responses to N/D (never a verified letter)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                mockOkResponse(
                    makeApiResponse({
                        url: 'https://example.com/stale',
                        co2_grams: 0.15,
                        verified: true,
                        evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
                        valid_until: '2020-01-01T00:00:00.000Z',
                    }),
                ),
            ),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com/stale');
        el.setAttribute('mode', 'api');
        document.body.appendChild(el);

        await vi.waitFor(
            () => expect(el.shadowRoot?.innerHTML).toContain('N/D'),
            { timeout: 2000 },
        );
        expect(el.score).toBeNull();
        expect(el.shadowRoot?.innerHTML).not.toContain('Verified by CometWeb');
    });

    it('ignores removed api-key / untrusted api-url attributes', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async function () { return JSON.stringify(await this.json()); },
            json: () =>
                Promise.resolve(
                    makeApiResponse({ url: 'https://example.com/secure' }),
                ),
        });
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com/secure');
        el.setAttribute('api-url', 'https://attacker.example/api');
        el.setAttribute('api-key', 'should-be-ignored');
        el.setAttribute('mode', 'api');
        document.body.appendChild(el);

        await vi.waitFor(() => expect(el.score).toBe('B'), { timeout: 2000 });
        expect(fetchMock).toHaveBeenCalled();
        const requestUrl = String(fetchMock.mock.calls[0][0]);
        expect(requestUrl).toContain('https://app.cometweb.io/');
        expect(requestUrl).not.toContain('attacker.example');
        const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
        expect(init?.headers).toEqual({ Accept: 'application/json' });
    });

    it('sends the full embed origin to the API', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async function () { return JSON.stringify(await this.json()); },
            json: () => Promise.resolve(makeApiResponse({ url: 'https://example.com/origin' })),
        });
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com/origin');
        el.setAttribute('mode', 'api');
        document.body.appendChild(el);

        await vi.waitFor(() => expect(el.score).toBe('B'), { timeout: 2000 });
        const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
        expect(requestUrl.searchParams.get('badge_origin')).toBe(window.location.origin);
    });

    it('derives letter from CO₂ bands when API score disagrees', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async function () { return JSON.stringify(await this.json()); },
                json: () =>
                    Promise.resolve(
                        makeApiResponse({
                            score: 'A',
                            co2_grams: 0.2872,
                            verified: false,
                        }),
                    ),
            }),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        await new Promise<void>((resolve) => {
            el.addEventListener('cometweb:badge-load', () => resolve());
            document.body.appendChild(el);
        });

        expect(el.score).toBe('B');
        expect(el.shadowRoot?.innerHTML).toContain('Powered by CometWeb');
        expect(el.shadowRoot?.innerHTML).not.toContain('Verified by CometWeb');
    });

    it('shows Verified footer only for a published snapshot with trusted evidence', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async function () { return JSON.stringify(await this.json()); },
                json: () =>
                    Promise.resolve(
                        makeApiResponse({
                            score: 'A',
                            co2_grams: 0.15,
                            verified: true,
                            public_id: 'abcdef0123',
                            measurement_source: 'published_snapshot',
                            measured_at: new Date(Date.now() - 60_000).toISOString(),
                            valid_until: new Date(Date.now() + 86_400_000).toISOString(),
                            evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
                            ...SNAPSHOT_PROVENANCE,
                        }),
                    ),
            }),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        await new Promise<void>((resolve) => {
            el.addEventListener('cometweb:badge-load', () => resolve());
            document.body.appendChild(el);
        });

        expect(el.score).toBe('A');
        expect(el.shadowRoot?.innerHTML).toContain('Verified by CometWeb');
    });

    it('omits % of web when cleaner_than is absent (CB-07)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async function () { return JSON.stringify(await this.json()); },
                json: () =>
                    Promise.resolve({
                        url: 'https://example.com',
                        co2_grams: 0.2,
                        status: 'ready',
                        page_weight_kb: 100,
                        green_host: false,
                    }),
            }),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        await new Promise<void>((resolve) => {
            el.addEventListener('cometweb:badge-load', () => resolve());
            document.body.appendChild(el);
        });

        expect(el.cleanerThan).toBeNull();
        expect(el.shadowRoot?.innerHTML).not.toContain('%');
        expect(el.shadowRoot?.innerHTML).toContain('Estimated page-load footprint');
    });

    it('uses the same less-than threshold in visible and ARIA CO₂ text', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async function () { return JSON.stringify(await this.json()); },
                json: () =>
                    Promise.resolve(
                        makeApiResponse({
                            url: 'https://example.com/tiny',
                            co2_grams: 0.004,
                        }),
                    ),
            }),
        );

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com/tiny');
        el.setAttribute('mode', 'api');
        document.body.appendChild(el);

        await vi.waitFor(() => expect(el.score).toBe('A+'), { timeout: 2000 });
        expect(el.shadowRoot?.innerHTML).toContain('less than 0.01g');
        expect(el.shadowRoot?.innerHTML).not.toContain('0.00g');
    });
});

describe('snapshot-first owner mode', () => {
    it('uses the published snapshot endpoint when mode is omitted', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async function () { return JSON.stringify(await this.json()); },
            json: () =>
                Promise.resolve(
                    makeApiResponse({
                        public_id: 'abcdef0123',
                        measurement_source: 'published_snapshot',
                        ...SNAPSHOT_PROVENANCE,
                        measured_at: '2026-09-22T10:00:00.000Z',
                        valid_until: '2026-10-22T10:00:00.000Z',
                        evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
                    }),
                ),
        });
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('snapshot-id', 'ABCDEF0123');
        let eventDetail: Record<string, unknown> | null = null;
        el.addEventListener('cometweb:badge-load', (event: Event) => {
            eventDetail = (event as CustomEvent).detail;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(el.score).toBe('B'), { timeout: 2000 });

        expect(String(fetchMock.mock.calls[0][0])).toContain(
            '/public/carbon-badge/id/abcdef0123',
        );
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-cache' });
        expect(el.badgeData.publicId).toBe('abcdef0123');
        expect(eventDetail).toMatchObject({
            mode: 'snapshot',
            publicId: 'abcdef0123',
        });
    });

    it('keeps explicit api mode as the URL-based compatibility path', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async function () { return JSON.stringify(await this.json()); },
            json: () => Promise.resolve(makeApiResponse()),
        });
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('snapshot-id', 'abcdef0123');
        el.setAttribute('mode', 'api');

        document.body.appendChild(el);
        await vi.waitFor(() => expect(el.score).toBe('B'), { timeout: 2000 });

        expect(String(fetchMock.mock.calls[0][0])).toContain(
            '/public/carbon-badge?url=',
        );
        expect(String(fetchMock.mock.calls[0][0])).not.toContain('/id/');
    });

    it('rejects a response for a different snapshot without URL fallback', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async function () { return JSON.stringify(await this.json()); },
            json: () =>
                Promise.resolve(
                    makeApiResponse({
                        public_id: 'fedcba9876',
                        measurement_source: 'published_snapshot',
                    }),
                ),
        });
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('snapshot-id', 'abcdef0123');
        let errorFired = false;
        el.addEventListener('cometweb:badge-error', () => {
            errorFired = true;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(errorFired).toBe(true), { timeout: 2000 });

        expect(el.score).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/id/abcdef0123');
    });

    it('keeps a missing snapshot as N/D without falling back to URL scan', async () => {
        const fetchMock = vi.fn().mockResolvedValue(mockFailResponse(404));
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('snapshot-id', 'abcdef0123');
        let errorFired = false;
        el.addEventListener('cometweb:badge-error', () => {
            errorFired = true;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(errorFired).toBe(true), { timeout: 2000 });

        expect(el.score).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls.every(([input]) => String(input).includes('/id/'))).toBe(true);
    });

    it('does not expose credential-bearing URLs in error state or events', async () => {
        const fetchMock = vi.fn().mockResolvedValue(mockFailResponse(404));
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://user:secret@example.com/private');
        el.setAttribute('mode', 'api');
        let errorDetail: Record<string, unknown> | null = null;
        el.addEventListener('cometweb:badge-error', (event: Event) => {
            errorDetail = (event as CustomEvent).detail;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(errorDetail).not.toBeNull(), { timeout: 2000 });

        const detail = errorDetail as unknown as Record<string, unknown>;
        expect(detail.url).toBe('');
        expect(el.badgeData.url).toBe('');
        expect(el.badgeData.url).not.toContain('secret');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not require the embedding URL when snapshot identity is explicit', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async function () { return JSON.stringify(await this.json()); },
            json: () =>
                Promise.resolve(
                    makeApiResponse({
                        public_id: 'abcdef0123',
                        url: 'https://example.com/published-home',
                        measurement_source: 'published_snapshot',
                        ...SNAPSHOT_PROVENANCE,
                        measured_at: new Date(Date.now() - 60_000).toISOString(),
                        valid_until: new Date(Date.now() + 86_400_000).toISOString(),
                    }),
                ),
        });
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://user:password@example.com/private');
        el.setAttribute('snapshot-id', 'abcdef0123');

        document.body.appendChild(el);
        await vi.waitFor(() => expect(el.score).toBe('B'), { timeout: 2000 });

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refreshes snapshot provenance instead of serving a persistent cache entry', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async function () { return JSON.stringify(await this.json()); },
            json: () =>
                Promise.resolve(
                    makeApiResponse({
                        public_id: 'abcdef0123',
                        measurement_source: 'published_snapshot',
                        ...SNAPSHOT_PROVENANCE,
                        measured_at: new Date(Date.now() - 60_000).toISOString(),
                        valid_until: new Date(Date.now() + 86_400_000).toISOString(),
                        verified: true,
                        evidence_url: 'https://cometweb.io/carbon-badge/abcdef0123',
                    }),
                ),
        });
        vi.stubGlobal('fetch', fetchMock);

        const first = document.createElement(TAG) as any;
        first.setAttribute('url', 'https://example.com');
        first.setAttribute('snapshot-id', 'abcdef0123');
        document.body.appendChild(first);
        await vi.waitFor(() => expect(first.score).toBe('B'), { timeout: 2000 });
        first.remove();

        const second = document.createElement(TAG) as any;
        second.setAttribute('url', 'https://example.com');
        second.setAttribute('snapshot-id', 'abcdef0123');
        document.body.appendChild(second);
        await vi.waitFor(() => expect(second.score).toBe('B'), { timeout: 1000 });

        expect(second.shadowRoot?.innerHTML).toContain('Verified by CometWeb');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('estimate mode', () => {
    it('populates score for current page without API call', async () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (t: string) =>
                t === 'navigation'
                    ? [{ transferSize: 200 * 1024, encodedBodySize: 200 * 1024 }]
                    : [],
            now: () => Date.now(),
        });

        const el = document.createElement(TAG) as any;
        el.setAttribute('mode', 'estimate');
        // No remote url — estimate measures location
        document.body.appendChild(el);

        await vi.waitFor(
            () => expect(el.score).toMatch(/^(A\+|A|B|C|D|F)$/),
            { timeout: 2000 },
        );
        expect(el.cleanerThan).toBeNull();
        expect(el.shadowRoot?.innerHTML).not.toContain('of modelled cohort');
        expect(el.shadowRoot?.innerHTML).not.toContain('of web');
    });
});

describe('strict modes and Verified trust boundary', () => {
    it('fail-closes explicit mode=snapshot without snapshot-id (CB-08)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const el = document.createElement(TAG) as any;
        el.setAttribute('mode', 'snapshot');
        document.body.appendChild(el);

        await vi.waitFor(
            () => expect(el.shadowRoot?.innerHTML).toContain('N/D'),
            { timeout: 2000 },
        );
        expect(el.shadowRoot?.innerHTML).toContain('Missing snapshot ID');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never shows Verified from a poisoned localStorage cache (CB-02)', async () => {
        const canonical = canonicalizeBadgeUrl('https://example.com')!;
        const cacheKey = buildCacheKey({
            canonicalUrl: canonical,
            snapshotId: null,
            mode: 'api',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: false,
        });
        setCache(
            cacheKey,
            {
                url: canonical,
                publicId: 'abcdef0123',
                co2Grams: 0.15,
                score: 'A',
                cleanerThan: null,
                pageWeightKb: 100,
                greenHost: false,
                verified: true,
                timestamp: Date.now(),
                status: 'ready',
                source: 'published_snapshot',
                formulaId: 'formula-v1',
                scoreModelId: SCORE_MODEL_ID_COMETWEB_BANDS_V1,
                measurementMethod: 'resource-timing',
                measuredAt: new Date(Date.now() - 60_000).toISOString(),
                validUntil: new Date(Date.now() + 86_400_000).toISOString(),
                evidenceUrl: 'https://cometweb.io/carbon-badge/abcdef0123',
            },
            720,
        );

        const el = document.createElement(TAG) as any;
        let detail: any = null;
        el.addEventListener('cometweb:badge-load', (e: Event) => {
            detail = (e as CustomEvent).detail;
        });
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');
        document.body.appendChild(el);

        await vi.waitFor(() => expect(el.score).toBe('A'), { timeout: 2000 });
        expect(el.shadowRoot?.innerHTML).toContain('Powered by CometWeb');
        expect(el.shadowRoot?.innerHTML).not.toContain('Verified by CometWeb');
        expect(detail?.verified).toBe(false);
        expect(detail?.retrievalSource).toBe('cache');
    });

    it('emits effective verified separately from backendVerified (CB-16)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async function () {
                    return JSON.stringify(await this.json());
                },
                json: () =>
                    Promise.resolve(
                        makeApiResponse({
                            score: 'A',
                            co2_grams: 0.15,
                            verified: true,
                            public_id: 'abcdef0123',
                            measurement_source: 'published_snapshot',
                            measured_at: new Date(Date.now() - 60_000).toISOString(),
                            valid_until: new Date(
                                Date.now() + 86_400_000,
                            ).toISOString(),
                            evidence_url:
                                'https://cometweb.io/carbon-badge/abcdef0123',
                            ...SNAPSHOT_PROVENANCE,
                        }),
                    ),
            }),
        );

        const el = document.createElement(TAG) as any;
        let detail: any = null;
        el.addEventListener('cometweb:badge-load', (e: Event) => {
            detail = (e as CustomEvent).detail;
        });
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('snapshot-id', 'abcdef0123');
        document.body.appendChild(el);

        await vi.waitFor(() => expect(detail).not.toBeNull(), { timeout: 2000 });
        expect(detail.verified).toBe(true);
        expect(detail.backendVerified).toBe(true);
        expect(el.shadowRoot?.innerHTML).toContain('Verified by CometWeb');
    });
});

describe('CB-11 disconnect aborts', () => {
    it('disconnectedCallback increments load id and does not throw', () => {
        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        document.body.appendChild(el);
        const id = el._loadId;
        document.body.removeChild(el);
        expect(el._loadId).toBeGreaterThan(id);
    });
});
