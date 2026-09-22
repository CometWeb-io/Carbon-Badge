import { describe, expect, it } from 'vitest';
import {
    buildCarbonBadgeEndpoint,
    parseRetryAfter,
    validateApiUrl,
} from '../api-client';

describe('api-client helpers', () => {
    it('accepts HTTPS API URLs without credentials or query data', () => {
        expect(validateApiUrl('https://example.test/api', null).href).toBe(
            'https://example.test/api',
        );
        expect(() =>
            validateApiUrl('http://example.test/api', null),
        ).toThrow('must use HTTPS');
        expect(() =>
            validateApiUrl('https://user:pass@example.test/api', null),
        ).toThrow('credentials');
        expect(() =>
            validateApiUrl('https://example.test/api?token=secret', null),
        ).toThrow('query data');
    });

    it('restricts authenticated requests to the trusted API origin', () => {
        expect(() =>
            validateApiUrl('https://example.test/api', 'publishable-key'),
        ).toThrow('trusted API origin');
        expect(
            validateApiUrl('https://app.cometweb.io/api', 'publishable-key')
                .origin,
        ).toBe('https://app.cometweb.io');
    });

    it('builds an encoded endpoint and reports the embedding origin', () => {
        const endpoint = buildCarbonBadgeEndpoint(
            new URL('https://app.cometweb.io/api'),
            'https://example.com/a?b=1',
            'https://publisher.test',
        );

        expect(endpoint.pathname).toBe('/api/public/carbon-badge');
        expect(endpoint.searchParams.get('url')).toBe(
            'https://example.com/a?b=1',
        );
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
});
