/**
 * @cometweb/carbon-badge — URL canonicalize + API response normalizer
 *
 * Fail-closed: missing / non-finite CO₂ never becomes a letter grade.
 */

import type { APIResponse, BadgeData, MeasurementSource, ScoreLetter } from './types';
import { FORMULA_ID_TRANSFER_V2 } from './types';
import { co2ToScore } from './estimator';

/** Tracking / auth query keys stripped from public badge identity. */
const STRIP_QUERY_KEYS = new Set([
    'token',
    'access_token',
    'auth',
    'authorization',
    'api_key',
    'apikey',
    'key',
    'session',
    'sid',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'fbclid',
    'msclkid',
    'mc_cid',
    'mc_eid',
    '_ga',
    'ref',
]);

export function toFiniteNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * Canonical public URL identity: strip fragment, drop tracking/auth query params,
 * keep semantic query (e.g. ?item=123).
 */
export function canonicalizeBadgeUrl(raw: string): string | null {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;
    try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        u.hash = '';
        const kept = new URLSearchParams();
        u.searchParams.forEach((value, key) => {
            if (STRIP_QUERY_KEYS.has(key.toLowerCase())) return;
            kept.append(key, value);
        });
        const qs = kept.toString();
        u.search = qs ? `?${qs}` : '';
        // Normalize trailing slash on bare path only (keep path identity otherwise)
        let path = u.pathname;
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        u.pathname = path || '/';
        u.hostname = u.hostname.toLowerCase();
        return u.toString();
    } catch {
        return null;
    }
}

function sameUrlIdentity(a: string, b: string): boolean {
    const ca = canonicalizeBadgeUrl(a);
    const cb = canonicalizeBadgeUrl(b);
    if (!ca || !cb) return false;
    return ca === cb;
}

function mapMeasurementSource(raw: string | null | undefined): MeasurementSource {
    if (raw === 'cometweb_scan' || raw === 'published_snapshot') return 'published_snapshot';
    if (raw === 'badge_http_estimate' || raw === 'http_estimate') return 'http_estimate';
    if (raw === 'estimate') return 'estimate';
    return 'api';
}

export interface NormalizeApiOptions {
    requestedUrl: string;
    now?: number;
}

/**
 * Parse public API JSON into BadgeData. Returns null when measurement is unusable
 * (missing CO₂, NaN, or URL identity mismatch) — caller must show N/D / unknown.
 */
export function parseApiResponse(
    apiData: APIResponse | null | undefined,
    options: NormalizeApiOptions,
): BadgeData | null {
    if (!apiData || typeof apiData !== 'object') return null;

    const co2Grams = toFiniteNumberOrNull(apiData.co2_grams);
    if (co2Grams === null || co2Grams < 0) return null;

    const responseUrl = typeof apiData.url === 'string' ? apiData.url : '';
    if (responseUrl && !sameUrlIdentity(responseUrl, options.requestedUrl)) {
        // Soft mismatch: still accept if requested canonical equals response host+path
        // but reject when response URL is empty or clearly different page.
        return null;
    }

    const score: ScoreLetter = co2ToScore(co2Grams);
    const cleanerRaw = toFiniteNumberOrNull(
        apiData.cleaner_than ?? apiData.benchmark ?? null,
    );
    const cleanerThan =
        cleanerRaw === null ? null : clamp(cleanerRaw, 0, 100);

    const pageWeightKb = toFiniteNumberOrNull(apiData.page_weight_kb);
    const greenHost =
        typeof apiData.green_host === 'boolean' ? apiData.green_host : null;

    const measuredAt =
        (typeof apiData.measured_at === 'string' && apiData.measured_at) ||
        (typeof apiData.scan_measured_at === 'string' && apiData.scan_measured_at) ||
        null;

    const status =
        apiData.status === 'partial' ||
        apiData.status === 'stale' ||
        apiData.status === 'revoked' ||
        apiData.status === 'unknown'
            ? apiData.status
            : 'ready';

    return {
        url: responseUrl || options.requestedUrl,
        co2Grams,
        score,
        cleanerThan,
        pageWeightKb: pageWeightKb === null ? null : Math.max(0, pageWeightKb),
        greenHost,
        verified: apiData.verified === true,
        timestamp: options.now ?? Date.now(),
        status,
        source: mapMeasurementSource(apiData.measurement_source),
        formulaId:
            (typeof apiData.formula_id === 'string' && apiData.formula_id) ||
            FORMULA_ID_TRANSFER_V2,
        measurementMethod:
            (typeof apiData.measurement_method === 'string' &&
                apiData.measurement_method) ||
            null,
        measuredAt,
        validUntil:
            (typeof apiData.valid_until === 'string' && apiData.valid_until) ||
            null,
        evidenceUrl:
            (typeof apiData.evidence_url === 'string' && apiData.evidence_url) ||
            null,
    };
}

/** Reconcile cached / in-memory payload: never invent a letter from missing CO₂. */
export function normalizeBadgeData(data: BadgeData | null | undefined): BadgeData | null {
    if (!data) return null;
    const co2 = toFiniteNumberOrNull(data.co2Grams);
    if (co2 === null || co2 < 0) {
        return {
            ...data,
            co2Grams: null,
            score: null,
            status: data.status === 'revoked' ? 'revoked' : 'unknown',
        };
    }
    return {
        ...data,
        co2Grams: co2,
        score: co2ToScore(co2),
        cleanerThan:
            data.cleanerThan === null || data.cleanerThan === undefined
                ? null
                : clamp(toFiniteNumberOrNull(data.cleanerThan) ?? 0, 0, 100),
    };
}

export function cloneBadgeData(data: BadgeData): BadgeData {
    return { ...data };
}
