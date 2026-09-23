export const DEFAULT_API_URL = 'https://app.cometweb.io/api';
export const DEFAULT_API_ORIGIN = new URL(DEFAULT_API_URL).origin;
export const API_TIMEOUT_MS = 8000;
export const MAX_RETRIES = 3;
export const MAX_RETRY_AFTER_MS = 30_000;
const SNAPSHOT_ID_PATTERN = /^[a-f0-9]{1,64}$/i;

/** Immutable response envelope shared across concurrent badge instances. */
export interface HttpEnvelope {
    ok: boolean;
    status: number;
    retryAfter: string | null;
    bodyText: string;
}

const inFlightRequests = new Map<string, Promise<HttpEnvelope>>();

function isLocalhost(hostname: string): boolean {
    return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]'
    );
}

/**
 * Public runtime builds may only talk to CometWeb (or loopback for local
 * development). Arbitrary `api-url` values are rejected so an embedder cannot
 * spoof branded measurement responses.
 */
export function validateApiUrl(raw: string): URL {
    const url = new URL(raw);
    const isLoopback = isLocalhost(url.hostname);

    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
        throw new Error('Carbon Badge API must use HTTPS');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error(
            'Carbon Badge API URL must not contain credentials, query or fragment',
        );
    }
    if (url.origin !== DEFAULT_API_ORIGIN && !isLoopback) {
        throw new Error('Untrusted Carbon Badge API origin');
    }
    return url;
}

export function buildCarbonBadgeEndpoint(
    apiBase: URL,
    canonicalUrl: string,
    badgeOrigin: string,
): URL {
    const endpoint = new URL('public/carbon-badge', `${apiBase.href}/`);
    endpoint.searchParams.set('url', canonicalUrl);
    endpoint.searchParams.set('source', 'badge');
    endpoint.searchParams.set('badge_origin', badgeOrigin);
    return endpoint;
}

export function validateSnapshotId(raw: string): string {
    const snapshotId = raw.trim().toLowerCase();
    if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
        throw new Error('Invalid Carbon Badge snapshot ID');
    }
    return snapshotId;
}

export function buildCarbonBadgeSnapshotEndpoint(
    apiBase: URL,
    snapshotId: string,
    badgeOrigin: string,
): URL {
    const endpoint = new URL(
        `public/carbon-badge/id/${validateSnapshotId(snapshotId)}`,
        `${apiBase.href}/`,
    );
    endpoint.searchParams.set('source', 'badge');
    endpoint.searchParams.set('badge_origin', badgeOrigin);
    return endpoint;
}

export function parseRetryAfter(
    value: string | null,
    now = Date.now(),
    maxDelay = MAX_RETRY_AFTER_MS,
): number {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
        return Math.min(Math.max(seconds * 1000, 0), maxDelay);
    }
    const date = Date.parse(value);
    return Number.isFinite(date)
        ? Math.min(Math.max(date - now, 0), maxDelay)
        : 0;
}

export function isRetryableHttpStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Exponential backoff with jitter; Retry-After wins when present. */
export function calculateRetryDelay(
    attempt: number,
    retryAfterMs = 0,
): number {
    if (retryAfterMs > 0) {
        return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
    }
    const base = Math.min(500 * 2 ** Math.max(0, attempt), 10_000);
    const jitter = 0.5 + Math.random();
    return Math.round(base * jitter);
}

/**
 * Deduplicate identical in-flight network requests across badge instances.
 * Shares an immutable {@link HttpEnvelope} (body already read), never a
 * one-shot `Response`. Timeout aborts the shared fetch.
 */
export function fetchSingleFlight(
    key: string,
    init: RequestInit = {},
    timeoutMs = API_TIMEOUT_MS,
): Promise<HttpEnvelope> {
    const existing = inFlightRequests.get(key);
    if (existing) return existing;

    const request = (async (): Promise<HttpEnvelope> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(key, {
                ...init,
                signal: controller.signal,
            });

            return {
                ok: response.ok,
                status: response.status,
                retryAfter: response.headers.get('Retry-After'),
                bodyText: await response.text(),
            };
        } finally {
            clearTimeout(timeout);
        }
    })().finally(() => {
        inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, request);
    return request;
}

/** Test helper — clears the module-level single-flight map. */
export function clearInFlightRequests(): void {
    inFlightRequests.clear();
}
