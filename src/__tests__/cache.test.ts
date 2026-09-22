/**
 * Tests for localStorage caching layer (cache.ts) — schema v3
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getCached,
    isCacheValid,
    setCache,
    clearExpired,
    buildCacheKey,
} from '../cache';
import type { BadgeData } from '../types';

const mockData: BadgeData = {
    url: 'https://example.com',
    publicId: null,
    co2Grams: 0.23,
    score: 'B',
    cleanerThan: 72,
    pageWeightKb: 480,
    greenHost: false,
    verified: false,
    timestamp: Date.now(),
    status: 'ready',
    source: 'api',
    formulaId: 'cometweb_scan_transfer_v2',
    measurementMethod: 'http_simple',
    measuredAt: null,
    validUntil: null,
    evidenceUrl: null,
};

const key = buildCacheKey({
    canonicalUrl: 'https://example.com',
    snapshotId: null,
    mode: 'api',
    apiUrl: 'https://app.cometweb.io/api',
    greenHost: false,
});

function makeLocalStorageMock() {
    let store: Record<string, string> = {};
    return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
            store[k] = v;
        },
        removeItem: (k: string) => {
            delete store[k];
        },
        clear: () => {
            store = {};
        },
        get length() {
            return Object.keys(store).length;
        },
        key: (i: number) => Object.keys(store)[i] ?? null,
    };
}

beforeEach(() => {
    const ls = makeLocalStorageMock();
    vi.stubGlobal('localStorage', ls);
});

describe('buildCacheKey', () => {
    it('changes when mode or green-host changes', () => {
        const a = buildCacheKey({
            canonicalUrl: 'https://example.com',
            snapshotId: null,
            mode: 'api',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: false,
        });
        const b = buildCacheKey({
            canonicalUrl: 'https://example.com',
            snapshotId: null,
            mode: 'estimate',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: false,
        });
        const c = buildCacheKey({
            canonicalUrl: 'https://example.com',
            snapshotId: null,
            mode: 'api',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: true,
        });
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
    });

    it('changes when the published snapshot identity changes', () => {
        const a = buildCacheKey({
            canonicalUrl: 'https://example.com',
            snapshotId: 'abcdef0123',
            mode: 'snapshot',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: false,
        });
        const b = buildCacheKey({
            canonicalUrl: 'https://example.com',
            snapshotId: 'fedcba9876',
            mode: 'snapshot',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: false,
        });
        expect(a).not.toBe(b);
    });
});

describe('setCache / getCached', () => {
    it('stores and retrieves data for a key', () => {
        setCache(key, mockData, 720);
        const result = getCached(key);
        expect(result).toEqual(mockData);
    });

    it('returns null for a key not in cache', () => {
        expect(getCached('cwb:v2:missing')).toBeNull();
    });

    it('returns null when localStorage contains malformed JSON', () => {
        localStorage.setItem(key, 'not-json{');
        expect(getCached(key)).toBeNull();
    });

    it('warns on setCache failure (quota exceeded)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('localStorage', {
            ...makeLocalStorageMock(),
            setItem: () => {
                throw new DOMException('QuotaExceededError');
            },
        });
        setCache(key, mockData, 720);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Cache write failed'),
            expect.anything(),
        );
        warnSpy.mockRestore();
    });
});

describe('isCacheValid', () => {
    it('returns true for a fresh entry within TTL', () => {
        setCache(key, mockData, 720);
        expect(isCacheValid(key)).toBe(true);
    });

    it('returns false for an expired entry', () => {
        const expiredEntry = {
            data: mockData,
            ts: Date.now() - 25 * 60 * 60 * 1000,
            schema: 3,
            expiresAt: Date.now() - 1,
        };
        localStorage.setItem(key, JSON.stringify(expiredEntry));
        expect(isCacheValid(key)).toBe(false);
    });

    it('returns false when no entry exists', () => {
        expect(isCacheValid('cwb:v2:none')).toBe(false);
    });
});

describe('clearExpired', () => {
    it('removes expired entries', () => {
        const expiredEntry = {
            data: mockData,
            ts: Date.now() - 25 * 60 * 60 * 1000,
            schema: 3,
            expiresAt: Date.now() - 1,
        };
        localStorage.setItem(key, JSON.stringify(expiredEntry));
        clearExpired();
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('keeps fresh entries', () => {
        setCache(key, mockData, 720);
        clearExpired();
        expect(getCached(key)).toEqual(mockData);
    });

    it('removes legacy v1 keys', () => {
        localStorage.setItem('cwb:https://legacy.com', JSON.stringify({ data: mockData, ts: Date.now() }));
        clearExpired();
        expect(localStorage.getItem('cwb:https://legacy.com')).toBeNull();
    });

    it('does not touch keys without the cwb prefix', () => {
        localStorage.setItem('other:key', 'untouched');
        clearExpired();
        expect(localStorage.getItem('other:key')).toBe('untouched');
    });

    it('uses each entry deadline instead of the mounting badge TTL', () => {
        const freshEntry = {
            data: mockData,
            ts: Date.now(),
            expiresAt: Date.now() + 60 * 60 * 1000,
            schema: 3,
        };
        localStorage.setItem(key, JSON.stringify(freshEntry));

        clearExpired();

        expect(localStorage.getItem(key)).not.toBeNull();
        expect(isCacheValid(key)).toBe(true);
    });

    it('caps cache lifetime at server validUntil', () => {
        const data = {
            ...mockData,
            validUntil: new Date(Date.now() + 60_000).toISOString(),
        };
        setCache(key, data, 720);
        const entry = JSON.parse(localStorage.getItem(key)!);

        expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    it('rejects revoked entries even when their deadline is fresh', () => {
        const data = { ...mockData, status: 'revoked' as const };
        setCache(key, data, 720);

        expect(isCacheValid(key)).toBe(false);
    });
});
