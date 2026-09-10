/**
 * Tests for CometWebCarbonBadge — fail-closed honesty + lifecycle.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import '../index';

const TAG = 'cometweb-carbon-badge';

function makeApiResponse(overrides: Record<string, unknown> = {}) {
    return {
        url: 'https://example.com',
        co2_grams: 0.23,
        score: 'B',
        cleaner_than: 72,
        page_weight_kb: 480,
        green_host: false,
        cached: false,
        ttl: 720,
        ...overrides,
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
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () => Promise.resolve(apiData),
            }),
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
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () =>
                    Promise.resolve(
                        makeApiResponse({
                            url: 'https://example.com/a',
                            score: 'A',
                            co2_grams: 0.15,
                        }),
                    ),
            }),
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
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () => Promise.resolve({}),
            }),
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
    it('derives letter from CO₂ bands when API score disagrees', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
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

    it('shows Verified footer only when API verified=true', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: { get: () => null },
                json: () =>
                    Promise.resolve(
                        makeApiResponse({
                            score: 'A',
                            co2_grams: 0.15,
                            verified: true,
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
                json: () =>
                    Promise.resolve({
                        url: 'https://example.com',
                        co2_grams: 0.2,
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
        expect(el.shadowRoot?.innerHTML).not.toContain('of web');
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
