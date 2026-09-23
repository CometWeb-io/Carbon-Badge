import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildCarbonBadgeEndpoint,
    calculateRetryDelay,
    clearInFlightRequests,
    fetchSingleFlight,
    parseRetryAfter,
    validateApiUrl,
} from '../api-client';

describe('api-client helpers', () => {
    afterEach(() => {
        clearInFlightRequests();
        vi.unstubAllGlobals();
    });

    it('accepts only the trusted CometWeb origin (plus loopback)', () => {
        expect(validateApiUrl('https://app.cometweb.io/api').href).toBe(
            'https://app.cometweb.io/api',
        );
        expect(validateApiUrl('http://127.0.0.1:8787/api').hostname).toBe(
            '127.0.0.1',
        );
        expect(() => validateApiUrl('https://example.test/api')).toThrow(
            'Untrusted',
        );
        expect(() => validateApiUrl('http://example.test/api')).toThrow(
            'must use HTTPS',
        );
        expect(() =>
            validateApiUrl('https://user:pass@app.cometweb.io/api'),
        ).toThrow('credentials');
        expect(() =>
            validateApiUrl('https://app.cometweb.io/api?token=secret'),
        ).toThrow('credentials, query or fragment');
    });

    it('builds an encoded endpoint and reports the embedding origin', () => {
        const endpoint = buildCarbonBadgeEndpoint(
            new URL('https://app.cometweb.io/api'),
            'https://example.com/a',
            'https://publisher.test',
        );

        expect(endpoint.pathname).toBe('/api/public/carbon-badge');
        expect(endpoint.searchParams.get('url')).toBe('https://example.com/a');
        expect(endpoint.searchParams.get('source')).toBe('badge');
        expect(endpoint.searchParams.get('badge_origin')).toBe(
            'https://publisher.test',
        );
    });

    it('parses Retry-After seconds and HTTP dates with a bounded delay', () => {
        expect(parseRetryAfter('2', 1_000)).toBe(2_000);
        expect(
            parseRetryAfter('Thu, 01 Jan 1970 00:00:05 GMT', 1_000),
        ).toBe(4_000);
        expect(parseRetryAfter('999', 1_000, 30_000)).toBe(30_000);
        expect(parseRetryAfter('invalid', 1_000)).toBe(0);
    });

    it('applies jittered exponential backoff', () => {
        const delay = calculateRetryDelay(2);
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(3000);
        expect(calculateRetryDelay(0, 12_000)).toBe(12_000);
        expect(calculateRetryDelay(0, 99_000)).toBe(30_000);
    });

    it('serves identical concurrent callers without sharing a consumed body', async () => {
        let fetchCalls = 0;

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                fetchCalls += 1;
                return new Response(
                    JSON.stringify({
                        url: 'https://example.com',
                        status: 'ready',
                        co2_grams: 0.2,
                    }),
                    {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    },
                );
            }),
        );

        const [a, b] = await Promise.all([
            fetchSingleFlight('same-key', { headers: {} }),
            fetchSingleFlight('same-key', { headers: {} }),
        ]);

        expect(JSON.parse(a.bodyText)).toEqual(JSON.parse(b.bodyText));
        expect(fetchCalls).toBe(1);
        expect(a.ok).toBe(true);
        expect(b.status).toBe(200);
    });

    it('aborts hanging fetches via timeout', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                (_url: string, init?: RequestInit) =>
                    new Promise((_resolve, reject) => {
                        init?.signal?.addEventListener('abort', () => {
                            reject(
                                new DOMException('Aborted', 'AbortError'),
                            );
                        });
                    }),
            ),
        );

        await expect(
            fetchSingleFlight('hang', {}, 20),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });
});
