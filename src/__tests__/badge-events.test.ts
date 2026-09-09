/**
 * Tests for CometWebCarbonBadge custom events and race condition guard.
 *
 * Uses happy-dom (bundled with Vitest) for a lightweight DOM environment.
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import '../index'; // registers the custom element

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

// Block all real network calls — each test overrides per-need
beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch not mocked in this test')));
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
    // Re-apply the global fetch block after unstubAllGlobals
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch not mocked in this test')));
});

// --- cometweb:badge-load dispatched after DOM is updated ---

describe('cometweb:badge-load event', () => {
    it('is dispatched after shadow DOM is updated with badge data', async () => {
        const apiData = makeApiResponse();

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve(apiData),
        }));

        const el = document.createElement(TAG) as HTMLElement & { score: string | null };
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

        // Shadow DOM must already contain the score when the event fires
        expect(shadowHtmlAtEventTime).toContain('B');
        expect(shadowHtmlAtEventTime).toContain('0.23');
    });

    it('exposes correct score via public getter after load', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve(makeApiResponse({ url: 'https://example.com/a', score: 'A', co2_grams: 0.15 })),
        }));

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com/a');
        el.setAttribute('mode', 'api');

        await new Promise<void>(resolve => {
            el.addEventListener('cometweb:badge-load', () => resolve());
            document.body.appendChild(el);
        });

        expect(el.score).toBe('A');
        expect(el.co2Grams).toBe(0.15);
    });
});

// --- cometweb:badge-error dispatched on failure ---

describe('cometweb:badge-error event', () => {
    it('is dispatched when url resolves to empty string', async () => {
        // Stub location.href to '' so targetUrl fallback also gives ''
        vi.stubGlobal('location', { href: '' });
        const el = document.createElement(TAG) as HTMLElement;
        el.setAttribute('url', '');
        el.setAttribute('mode', 'api');

        let errorDetail: unknown = null;
        el.addEventListener('cometweb:badge-error', (e) => {
            errorDetail = (e as CustomEvent).detail;
        });

        document.body.appendChild(el);
        await vi.waitFor(() => expect(errorDetail).not.toBeNull(), { timeout: 1000 });

        expect(errorDetail).toBeDefined();
    });
});

// --- race condition: stale fetch result discarded ---

describe('race condition guard (_loadId)', () => {
    it('_loadId increments on each loadData call', () => {
        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'estimate');

        const idBefore = el._loadId;
        el.reload();
        expect(el._loadId).toBeGreaterThan(idBefore);

        el.reload();
        expect(el._loadId).toBeGreaterThan(idBefore + 1);
    });
});

// --- API score validation: unknown score → 'F' ---

describe('API response validation', () => {
    it('derives letter from CO₂ bands when API score disagrees (Honest Operator)', async () => {
        // API historically returned Insight grades (A < 0.30); public badge docs use A < 0.20
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve(makeApiResponse({
                score: 'A',
                co2_grams: 0.2872,
                verified: false,
            })),
        }));

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        await new Promise<void>(resolve => {
            el.addEventListener('cometweb:badge-load', () => resolve());
            document.body.appendChild(el);
        });

        expect(el.score).toBe('B');
        expect(el.shadowRoot?.innerHTML).toContain('Powered by CometWeb');
        expect(el.shadowRoot?.innerHTML).not.toContain('Verified by CometWeb');
    });

    it('shows Verified footer only when API verified=true', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve(makeApiResponse({
                score: 'A',
                co2_grams: 0.15,
                verified: true,
            })),
        }));

        const el = document.createElement(TAG) as any;
        el.setAttribute('url', 'https://example.com');
        el.setAttribute('mode', 'api');

        await new Promise<void>(resolve => {
            el.addEventListener('cometweb:badge-load', () => resolve());
            document.body.appendChild(el);
        });

        expect(el.score).toBe('A');
        expect(el.shadowRoot?.innerHTML).toContain('Verified by CometWeb');
    });
});

// --- estimate mode ---

describe('estimate mode', () => {
    it('populates score in estimate mode without API call', async () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (t: string) => t === 'navigation'
                ? [{ transferSize: 200 * 1024, encodedBodySize: 200 * 1024 }]
                : [],
            now: () => Date.now(),
        });

        const el = document.createElement(TAG) as any;
        el.setAttribute('mode', 'estimate');
        el.setAttribute('url', 'https://example.com/estimate');
        document.body.appendChild(el);

        // score is null while loading; waitFor polls until estimate completes
        await vi.waitFor(
            () => expect(el.score).toMatch(/^(A\+|A|B|C|D|F)$/),
            { timeout: 2000 },
        );
    });
});
