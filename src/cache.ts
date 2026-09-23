/**
 * @cometweb/carbon-badge — localStorage caching layer (schema v5)
 *
 * Key includes canonical URL, mode, api-url hash, green-host, and schema version
 * so attribute changes never silently reuse a stale measurement.
 *
 * Current-schema keys are tracked in an owned index so cleanup stays O(owned)
 * instead of scanning the host page's entire localStorage on every mount.
 */

import type { BadgeData, CacheEntry, CacheKeyParts } from './types';
import { BADGE_CACHE_SCHEMA } from './types';

const CACHE_PREFIX = `cometweb:carbon-badge:v${BADGE_CACHE_SCHEMA}:`;
const CACHE_INDEX_KEY = 'cometweb:carbon-badge:index';
/** Owned legacy prefixes only — never wipe arbitrary `cwb:` host keys. */
const OWNED_LEGACY_PREFIXES = [
    'cometweb:carbon-badge:v3:',
    'cometweb:carbon-badge:v2:',
    'cwb:v3:',
    'cwb:v2:',
] as const;

let cleanupPerformed = false;
let legacySweepPerformed = false;

function hashApiUrl(apiUrl: string): string {
    let h = 0;
    const s = apiUrl || '';
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

function isOwnedLegacyKey(key: string): boolean {
    return OWNED_LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function readIndex(): string[] {
    try {
        const raw = localStorage.getItem(CACHE_INDEX_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return [
            ...new Set(
                parsed.filter(
                    (key): key is string =>
                        typeof key === 'string' && key.startsWith(CACHE_PREFIX),
                ),
            ),
        ];
    } catch {
        return [];
    }
}

function writeIndex(keys: string[]): void {
    try {
        localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(keys));
    } catch {
        /* quota / private mode — index is best-effort */
    }
}

function rememberKey(key: string): void {
    if (!key.startsWith(CACHE_PREFIX)) return;
    const keys = readIndex();
    if (keys.includes(key)) return;
    keys.push(key);
    writeIndex(keys);
}

function forgetKey(key: string): void {
    writeIndex(readIndex().filter((entry) => entry !== key));
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

        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return null;
        if (parsed.schema !== BADGE_CACHE_SCHEMA) return null;
        if (!isRecord(parsed.data)) return null;

        // localStorage is host-controlled — never treat cache as Verified proof.
        return {
            ...(parsed.data as unknown as BadgeData),
            verified: false,
        };
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Single localStorage read: fresh entry or null (evicts invalid rows).
 */
export function getFreshCached(
    key: string,
    maxAgeMinutes?: number,
    now = Date.now(),
): BadgeData | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;

        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) {
            localStorage.removeItem(key);
            forgetKey(key);
            return null;
        }
        if (parsed.schema !== BADGE_CACHE_SCHEMA || !isRecord(parsed.data)) {
            localStorage.removeItem(key);
            forgetKey(key);
            return null;
        }

        const ts = parsed.ts;
        const expiresAt = parsed.expiresAt;
        if (
            typeof ts !== 'number' ||
            typeof expiresAt !== 'number' ||
            !Number.isFinite(ts) ||
            !Number.isFinite(expiresAt) ||
            ts > now ||
            expiresAt <= now
        ) {
            localStorage.removeItem(key);
            forgetKey(key);
            return null;
        }

        if (
            typeof maxAgeMinutes === 'number' &&
            Number.isFinite(maxAgeMinutes) &&
            maxAgeMinutes > 0 &&
            ts + maxAgeMinutes * 60_000 <= now
        ) {
            localStorage.removeItem(key);
            forgetKey(key);
            return null;
        }

        const status = (parsed.data as { status?: string }).status;
        if (
            status === 'stale' ||
            status === 'unknown' ||
            status === 'revoked' ||
            status === 'partial'
        ) {
            localStorage.removeItem(key);
            forgetKey(key);
            return null;
        }

        return {
            ...(parsed.data as unknown as BadgeData),
            verified: false,
        };
    } catch {
        try {
            localStorage.removeItem(key);
            forgetKey(key);
        } catch {
            /* ignore */
        }
        return null;
    }
}

export function isCacheValid(key: string, maxAgeMinutes?: number): boolean {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return false;

        const entry: CacheEntry = JSON.parse(raw);
        if (entry.schema !== BADGE_CACHE_SCHEMA) return false;
        if (!Number.isFinite(entry.ts) || !Number.isFinite(entry.expiresAt)) {
            return false;
        }
        const now = Date.now();
        if (entry.ts > now || entry.expiresAt <= now) return false;
        if (
            typeof maxAgeMinutes === 'number' &&
            Number.isFinite(maxAgeMinutes) &&
            maxAgeMinutes > 0
        ) {
            const callerDeadline = entry.ts + maxAgeMinutes * 60_000;
            if (callerDeadline <= now) return false;
        }
        if (
            entry.data?.status === 'stale' ||
            entry.data?.status === 'unknown' ||
            entry.data?.status === 'revoked' ||
            entry.data?.status === 'partial'
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export function setCache(
    key: string,
    data: BadgeData,
    ttlMinutes: number,
): void {
    try {
        const now = Date.now();
        const localExpiry = now + ttlMinutes * 60 * 1000;
        const serverExpiry = data.validUntil
            ? Date.parse(data.validUntil)
            : Number.NaN;
        const entry: CacheEntry = {
            data,
            ts: now,
            expiresAt: Number.isFinite(serverExpiry)
                ? Math.min(localExpiry, serverExpiry)
                : localExpiry,
            schema: BADGE_CACHE_SCHEMA,
        };
        localStorage.setItem(key, JSON.stringify(entry));
        rememberKey(key);
    } catch (e) {
        console.warn(
            '[CometWeb Carbon Badge] Cache write failed (localStorage quota or access denied):',
            e,
        );
    }
}

function sweepOwnedLegacyKeys(): void {
    if (legacySweepPerformed) return;
    legacySweepPerformed = true;
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || !isOwnedLegacyKey(key)) continue;
            localStorage.removeItem(key);
        }
    } catch {
        /* ignore */
    }
}

export function clearExpired(): void {
    try {
        const now = Date.now();
        const retained: string[] = [];

        for (const key of readIndex()) {
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
                    continue;
                }
                retained.push(key);
            } catch {
                localStorage.removeItem(key);
            }
        }

        writeIndex(retained);
        sweepOwnedLegacyKeys();
    } catch (e) {
        console.warn('[CometWeb Carbon Badge] Cache cleanup failed:', e);
    }
}

/** Run localStorage cleanup at most once per module lifetime. */
export function clearExpiredOnce(): void {
    if (cleanupPerformed) return;
    cleanupPerformed = true;
    clearExpired();
}

/** Test helper. */
export function resetCleanupFlag(): void {
    cleanupPerformed = false;
    legacySweepPerformed = false;
}

/** Test helper — expose index key for assertions. */
export const __CACHE_INDEX_KEY = CACHE_INDEX_KEY;
