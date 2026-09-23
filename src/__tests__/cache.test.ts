/**
 * Tests for localStorage caching layer (cache.ts) — schema v4
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getCached,
    isCacheValid,
    setCache,
    clearExpired,
    buildCacheKey,
    resetCleanupFlag,
} from '../cache';
import type { BadgeData } from '../types';
import { BADGE_CACHE_SCHEMA } from '../types';

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
    scoreModelId: 'carbon-badge-bands-v1',
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
    resetCleanupFlag();
    vi.stubGlobal('localStorage', makeLocalStorageMock());
});

describe('buildCacheKey', () => {
    it('uses the owned cometweb namespace', () => {
        expect(key.startsWith('cometweb:carbon-badge:v4:')).toBe(true);
    });

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
        expect(a).not.toBe(b);
    });
});

describe('setCache / getCached', () => {
    it('stores and retrieves data for a key', () => {
        setCache(key, mockData, 720);
        expect(getCached(key)).toEqual(mockData);
    });

    it('returns null for a key not in cache', () => {
        expect(getCached('cometweb:carbon-badge:v4:missing')).toBeNull();
    });

    it('returns null when localStorage contains malformed JSON', () => {
        localStorage.setItem(key, 'not-json{');
        expect(getCached(key)).toBeNull();
    });
});

describe('isCacheValid', () => {
    it('returns true for a fresh entry within TTL', () => {
        setCache(key, mockData, 720);
        expect(isCacheValid(key)).toBe(true);
    });

    it('returns false for an expired entry', () => {
        localStorage.setItem(
            key,
            JSON.stringify({
                data: mockData,
                ts: Date.now() - 25 * 60 * 60 * 1000,
                schema: BADGE_CACHE_SCHEMA,
                expiresAt: Date.now() - 1,
            }),
        );
        expect(isCacheValid(key)).toBe(false);
    });

    it('rejects revoked entries even when their deadline is fresh', () => {
        setCache(key, { ...mockData, status: 'revoked' }, 720);
        expect(isCacheValid(key)).toBe(false);
    });
});

describe('clearExpired', () => {
    it('removes expired entries', () => {
        localStorage.setItem(
            key,
            JSON.stringify({
                data: mockData,
                ts: Date.now() - 25 * 60 * 60 * 1000,
                schema: BADGE_CACHE_SCHEMA,
                expiresAt: Date.now() - 1,
            }),
        );
        clearExpired();
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('keeps fresh entries', () => {
        setCache(key, mockData, 720);
        clearExpired();
        expect(getCached(key)).toEqual(mockData);
    });

    it('removes owned legacy v2/v3 keys only', () => {
        localStorage.setItem(
            'cwb:v2:legacy',
            JSON.stringify({ data: mockData, ts: Date.now() }),
        );
        localStorage.setItem('cwb:host-app-key', 'keep-me');
        clearExpired();
        expect(localStorage.getItem('cwb:v2:legacy')).toBeNull();
        expect(localStorage.getItem('cwb:host-app-key')).toBe('keep-me');
    });

    it('does not touch keys without the owned prefix', () => {
        localStorage.setItem('other:key', 'untouched');
        clearExpired();
        expect(localStorage.getItem('other:key')).toBe('untouched');
    });

    it('uses each entry deadline instead of the mounting badge TTL', () => {
        localStorage.setItem(
            key,
            JSON.stringify({
                data: mockData,
                ts: Date.now(),
                expiresAt: Date.now() + 60 * 60 * 1000,
                schema: BADGE_CACHE_SCHEMA,
            }),
        );
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
});
