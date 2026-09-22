/**
 * @cometweb/carbon-badge — localStorage caching layer (schema v3)
 *
 * Key includes canonical URL, mode, api-url hash, green-host, and schema version
 * so attribute changes never silently reuse a stale measurement.
 */

import type { BadgeData, CacheEntry, CacheKeyParts } from './types';
import { BADGE_CACHE_SCHEMA } from './types';

const CACHE_PREFIX = 'cwb:v3:';
/** Legacy prefix from pre-v3 schemas — cleared on cleanup. */
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
            parts.snapshotId?.trim().toLowerCase() || '',
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

export function isCacheValid(key: string): boolean {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;

        const entry: CacheEntry = JSON.parse(raw);
        if (entry.schema !== BADGE_CACHE_SCHEMA) return false;
        if (!Number.isFinite(entry.ts) || !Number.isFinite(entry.expiresAt)) return false;
        if (entry.ts > Date.now() || entry.expiresAt <= Date.now()) return false;
        if (
            entry.data?.status === 'stale' ||
            entry.data?.status === 'unknown' ||
            entry.data?.status === 'revoked'
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export function setCache(key: string, data: BadgeData, ttlMinutes: number): void {
    try {
        const now = Date.now();
        const localExpiry = now + ttlMinutes * 60 * 1000;
        const serverExpiry = data.validUntil ? Date.parse(data.validUntil) : Number.NaN;
        const entry: CacheEntry = {
            data,
            ts: now,
            expiresAt: Number.isFinite(serverExpiry)
                ? Math.min(localExpiry, serverExpiry)
                : localExpiry,
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

export function clearExpired(): void {
    try {
        const now = Date.now();

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
                    !Number.isFinite(entry.ts) ||
                    !Number.isFinite(entry.expiresAt) ||
                    entry.ts > now ||
                    entry.expiresAt <= now
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
