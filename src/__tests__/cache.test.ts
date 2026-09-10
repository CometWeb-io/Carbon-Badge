/**
 * Tests for localStorage caching layer (cache.ts) — schema v2
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
            mode: 'api',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: false,
        });
        const b = buildCacheKey({
            canonicalUrl: 'https://example.com',
            mode: 'estimate',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: false,
        });
        const c = buildCacheKey({
            canonicalUrl: 'https://example.com',
            mode: 'api',
            apiUrl: 'https://app.cometweb.io/api',
            greenHost: true,
        });
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
    });
});

describe('setCache / getCached', () => {
    it('stores and retrieves data for a key', () => {
        setCache(key, mockData);
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
        setCache(key, mockData);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Cache write failed'),
            expect.anything(),
        );
        warnSpy.mockRestore();
    });
});

describe('isCacheValid', () => {
    it('returns true for a fresh entry within TTL', () => {
        setCache(key, mockData);
        expect(isCacheValid(key, 720)).toBe(true);
    });

    it('returns false for an expired entry', () => {
        const expiredEntry = {
            data: mockData,
            ts: Date.now() - 25 * 60 * 60 * 1000,
            schema: 2,
        };
        localStorage.setItem(key, JSON.stringify(expiredEntry));
        expect(isCacheValid(key, 720)).toBe(false);
    });

    it('returns false when no entry exists', () => {
        expect(isCacheValid('cwb:v2:none', 720)).toBe(false);
    });
});

describe('clearExpired', () => {
    it('removes expired entries', () => {
        const expiredEntry = {
            data: mockData,
            ts: Date.now() - 25 * 60 * 60 * 1000,
            schema: 2,
        };
        localStorage.setItem(key, JSON.stringify(expiredEntry));
        clearExpired(720);
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('keeps fresh entries', () => {
        setCache(key, mockData);
        clearExpired(720);
        expect(getCached(key)).toEqual(mockData);
    });

    it('removes legacy v1 keys', () => {
        localStorage.setItem('cwb:https://legacy.com', JSON.stringify({ data: mockData, ts: Date.now() }));
        clearExpired(720);
        expect(localStorage.getItem('cwb:https://legacy.com')).toBeNull();
    });

    it('does not touch keys without the cwb prefix', () => {
        localStorage.setItem('other:key', 'untouched');
        clearExpired(720);
        expect(localStorage.getItem('other:key')).toBe('untouched');
    });
});
