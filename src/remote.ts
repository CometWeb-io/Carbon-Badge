import type { BadgeData } from './types';
import {
    API_TIMEOUT_MS, DEFAULT_API_URL, MAX_RETRIES, validateApiUrl,
    buildCarbonBadgeEndpoint, buildCarbonBadgeSnapshotEndpoint, fetchSingleFlight,
    calculateRetryDelay, isRetryableHttpStatus, parseRetryAfter,
} from './api-client';
import { parseApiResponse } from './api-response';
import { normalizeBadgeData } from './normalize';
import { buildCacheKey, clearExpiredOnce, getFreshCached, setCache } from './cache';

export interface RemoteOptions {
    canonicalUrl: string;
    snapshotId: string | null;
    mode: 'api' | 'snapshot';
    cacheTtl: number;
    greenHost: boolean;
    force: boolean;
    badgeOrigin: string;
}

type RemoteResult = { data: BadgeData; retrievalSource: 'cache' | 'network' } | { reason: string };

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(new DOMException('Measurement aborted', 'AbortError'));
        };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
}

/** Network/cache lifecycle, loaded only after an explicit network mode becomes visible. */
export async function loadRemoteMeasurement(
    options: RemoteOptions,
    signal: AbortSignal,
    onRetry: (label: string) => void,
): Promise<RemoteResult> {
    const { canonicalUrl, snapshotId, mode, cacheTtl, greenHost, force, badgeOrigin } = options;
    const cacheEnabled = mode === 'api';
    const cacheKey = buildCacheKey({ canonicalUrl, snapshotId, mode, apiUrl: DEFAULT_API_URL, greenHost });
    if (signal.aborted) throw new DOMException('Measurement aborted', 'AbortError');
    if (cacheEnabled) {
        clearExpiredOnce();
        if (!force) {
            const cached = normalizeBadgeData(getFreshCached(cacheKey, cacheTtl));
            if (cached && cached.url === canonicalUrl && cached.co2Grams !== null) return { data: cached, retrievalSource: 'cache' };
        }
    }
    const apiUrl = validateApiUrl(DEFAULT_API_URL);
    const endpoint = mode === 'snapshot'
        ? buildCarbonBadgeSnapshotEndpoint(apiUrl, snapshotId || '', badgeOrigin)
        : buildCarbonBadgeEndpoint(apiUrl, canonicalUrl, badgeOrigin);
    let retries = 0;
    for (;;) {
        if (signal.aborted) throw new DOMException('Measurement aborted', 'AbortError');
        let delay = 0;
        let retryLabel = 'Retrying…';
        try {
            const response = await fetchSingleFlight(endpoint.toString(), {
                signal, headers: { Accept: 'application/json' }, cache: force ? 'reload' : 'no-cache',
            }, API_TIMEOUT_MS);
            if (signal.aborted) throw new DOMException('Measurement aborted', 'AbortError');
            if (!response.ok) {
                if (!isRetryableHttpStatus(response.status)) return { reason: response.status === 404 && mode === 'snapshot' ? 'Published snapshot not found' : 'Measurement unavailable' };
                if (retries >= MAX_RETRIES) return { reason: response.status === 429 ? 'Rate limited — try again later' : 'Unable to load measurement' };
                delay = calculateRetryDelay(retries++, parseRetryAfter(response.retryAfter));
                retryLabel = response.status === 429 ? 'Retrying after rate limit…' : 'Retrying…';
            } else {
                let raw;
                try { raw = JSON.parse(response.bodyText); } catch { return { reason: 'Malformed API response' }; }
                const data = parseApiResponse(raw, { requestedUrl: canonicalUrl, requestedSnapshotId: mode === 'snapshot' ? snapshotId : null });
                if (!data) return { reason: 'No usable measurement' };
                const noStore = /(?:^|,)\s*no-store(?:\s*,|$)/i.test(response.cacheControl || '');
                if (cacheEnabled && !noStore && data.source !== 'published_snapshot') setCache(cacheKey, data, cacheTtl);
                return { data, retrievalSource: 'network' };
            }
        } catch (error) {
            if (signal.aborted) throw error;
            if (error instanceof RangeError) return { reason: 'Measurement response too large' };
            if (error instanceof DOMException && error.name === 'AbortError') return { reason: 'Request timed out' };
            if (retries >= 1) return { reason: 'Unable to load measurement' };
            delay = calculateRetryDelay(retries++);
        }
        onRetry(retryLabel);
        await waitForRetry(delay, signal);
    }
}
