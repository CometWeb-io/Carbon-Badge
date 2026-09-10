/**
 * @cometweb/carbon-badge — localStorage caching layer (schema v2)
 *
 * Key includes canonical URL, mode, api-url hash, green-host, and schema version
 * so attribute changes never silently reuse a stale measurement.
 */

import type { BadgeData, CacheEntry, CacheKeyParts } from './types';
import { BADGE_CACHE_SCHEMA } from './types';

const CACHE_PREFIX = 'cwb:v2:';
/** Legacy prefix from 1.0.x — cleared on cleanup. */
const LEGACY_PREFIX = 'cwb:';

function hashApiUrl(apiUrl: string): string {
    let h = 0;
    const s = apiUrl || '';
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

export function buildCacheKey(parts: CacheKeyParts): string {
    const green = parts.greenHost ? '1' : '0';
    return (
        CACHE_PREFIX +
        [
            parts.canonicalUrl,
            parts.mode,
            hashApiUrl(parts.apiUrl),
            green,
            String(BADGE_CACHE_SCHEMA),
        ].join('|')
    );
}

export function getCached(key: string): BadgeData | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;

        const entry: CacheEntry = JSON.parse(raw);
        if (entry.schema !== BADGE_CACHE_SCHEMA) return null;
        return entry.data ?? null;
    } catch {
        return null;
    }
}

export function isCacheValid(key: string, ttlMinutes: number): boolean {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;

        const entry: CacheEntry = JSON.parse(raw);
        if (entry.schema !== BADGE_CACHE_SCHEMA) return false;
        const ageMs = Date.now() - entry.ts;
        return ageMs < ttlMinutes * 60 * 1000;
    } catch {
        return false;
    }
}

export function setCache(key: string, data: BadgeData): void {
    try {
        const entry: CacheEntry = {
            data,
            ts: Date.now(),
            schema: BADGE_CACHE_SCHEMA,
        };
        localStorage.setItem(key, JSON.stringify(entry));
    } catch (e) {
        console.warn(
            '[CometWeb Carbon Badge] Cache write failed (localStorage quota or access denied):',
            e,
        );
    }
}

export function clearExpired(ttlMinutes: number): void {
    try {
        const now = Date.now();
        const maxAge = ttlMinutes * 60 * 1000;

        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (!key.startsWith(CACHE_PREFIX) && !key.startsWith(LEGACY_PREFIX)) {
                continue;
            }
            // Drop all legacy v1 keys
            if (key.startsWith(LEGACY_PREFIX) && !key.startsWith(CACHE_PREFIX)) {
                localStorage.removeItem(key);
                continue;
            }

            const raw = localStorage.getItem(key);
            if (!raw) continue;

            try {
                const entry: CacheEntry = JSON.parse(raw);
                if (
                    entry.schema !== BADGE_CACHE_SCHEMA ||
                    now - entry.ts > maxAge
                ) {
                    localStorage.removeItem(key);
                }
            } catch {
                localStorage.removeItem(key);
            }
        }
    } catch (e) {
        console.warn('[CometWeb Carbon Badge] Cache cleanup failed:', e);
    }
}
