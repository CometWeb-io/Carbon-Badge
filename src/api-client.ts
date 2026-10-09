import { canonicalizeBadgeUrl, validateSnapshotId } from './url';
export { validateSnapshotId } from './url';

export const DEFAULT_API_URL = 'https://app.cometweb.io/api';
export const DEFAULT_API_ORIGIN = new URL(DEFAULT_API_URL).origin;
export const API_TIMEOUT_MS = 8000;
export const MAX_RETRIES = 3;
export const MAX_RETRY_AFTER_MS = 30_000;

/** Immutable response envelope shared across concurrent badge instances. */
export interface HttpEnvelope {
    ok: boolean;
    status: number;
    retryAfter: string | null;
    cacheControl: string | null;
    bodyText: string;
}

const MAX_RESPONSE_BYTES = 65_536;
interface Flight {
    controller: AbortController;
    promise: Promise<HttpEnvelope>;
    subscribers: number;
    finished: boolean;
}
const inFlightRequests = new Map<string | symbol, Flight>();

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
    const subject = canonicalizeBadgeUrl(canonicalUrl);
    if (!subject) throw new Error('Invalid measurement URL');
    const endpoint = new URL('public/carbon-badge', `${apiBase.href}/`);
    endpoint.searchParams.set('url', subject);
    endpoint.searchParams.set('source', 'badge');
    endpoint.searchParams.set('badge_origin', badgeOrigin);
    return endpoint;
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
export async function fetchSingleFlight(
    key: string,
    init: RequestInit = {},
    timeoutMs = API_TIMEOUT_MS,
): Promise<HttpEnvelope> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new RangeError('Invalid request timeout'));
    timeoutMs = Math.min(timeoutMs, 30_000);
    const aborted = () => new DOMException('Measurement aborted', 'AbortError');
    const { signal, ...options } = init;
    if (signal?.aborted) return Promise.reject(aborted());
    const headers = [...new Headers(options.headers).entries()];
    // Bodies/mutations are deliberately never shared, even if their URL matches.
    const requestKey = !options.body && (!options.method || options.method.toUpperCase() === 'GET')
        ? JSON.stringify([key, { ...options, headers }, timeoutMs]) : Symbol();
    let flight = inFlightRequests.get(requestKey);
    if (!flight) {
        const controller = new AbortController();
        let active: Flight;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let failure: unknown;
        const cancellation = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(failure ?? aborted()), { once: true }));
        const request = async (): Promise<HttpEnvelope> => {
            const response = await fetch(key, { ...options, signal: controller.signal, redirect: 'error' });
            if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
                throw new RangeError('Measurement response too large');
            }
            let bodyText = '';
            const reader = response.body?.getReader();
            if (reader) {
                const decoder = new TextDecoder();
                let bytes = 0;
                try {
                    for (;;) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        bytes += chunk.value.byteLength;
                        if (bytes > MAX_RESPONSE_BYTES) throw new RangeError('Measurement response too large');
                        bodyText += decoder.decode(chunk.value, { stream: true });
                    }
                    bodyText += decoder.decode();
                } finally { reader.releaseLock(); }
            } else {
                bodyText = await response.text();
                if (new TextEncoder().encode(bodyText).byteLength > MAX_RESPONSE_BYTES) throw new RangeError('Measurement response too large');
            }
            return Object.freeze({
                ok: response.ok, status: response.status,
                retryAfter: response.headers.get('Retry-After'),
                cacheControl: response.headers.get('Cache-Control'), bodyText,
            });
        };
        const promise = Promise.race([request().catch(error => { failure = error; controller.abort(); throw error; }), cancellation]).finally(() => {
            clearTimeout(timeout);
            active.finished = true;
            if (inFlightRequests.get(requestKey) === active) inFlightRequests.delete(requestKey);
        });
        active = { controller, promise, subscribers: 0, finished: false };
        flight = active;
        inFlightRequests.set(requestKey, active);
    }
    const active = flight;
    active.subscribers++;
    return new Promise((resolve, reject) => {
        let settled = false;
        const release = () => {
            if (settled) return false;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            if (--active.subscribers === 0 && !active.finished) {
                if (inFlightRequests.get(requestKey) === active) inFlightRequests.delete(requestKey);
                active.controller.abort();
            }
            return true;
        };
        const onAbort = () => { if (release()) reject(aborted()); };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        active.promise.then(value => { if (release()) resolve(value); }, error => { if (release()) reject(error); });
    });
}

/** Test helper — clears the module-level single-flight map. */
export function clearInFlightRequests(): void {
    for (const flight of inFlightRequests.values()) flight.controller.abort();
    inFlightRequests.clear();
}
