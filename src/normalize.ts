/**
 * @cometweb/carbon-badge — URL canonicalize + API response normalizer
 *
 * Fail-closed: missing / non-finite CO₂ never becomes a letter grade.
 */

import type {
    APIResponse,
    BadgeData,
    MeasurementSource,
    MeasurementStatus,
    ScoreLetter,
} from './types';
import { co2ToScore } from './estimator';
import { clamp, toFiniteNumberOrNull } from './utils';
import { validateSnapshotId } from './api-client';

/** Tracking query keys stripped from public badge identity. */
const STRIP_QUERY_KEYS = new Set([
    'auth',
    'key',
    'apikey',
    'ref',
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
]);

const SENSITIVE_QUERY = /^(token|access_token|authorization|api[_-]?key|session(?:[_-].*)?|sid|jwt|signature|sig|code|x-amz-.+)$/i;

/**
 * Canonical public URL identity: strip fragments and known tracking parameters,
 * reject credential-bearing URLs, and keep semantic query (e.g. ?item=123).
 */
export function canonicalizeBadgeUrl(raw: string): string | null {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;
    try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (u.username || u.password) return null;
        u.hash = '';
        const kept = new URLSearchParams();
        u.searchParams.forEach((value, key) => {
            if (SENSITIVE_QUERY.test(key)) {
                throw new Error('credential-bearing URL');
            }
            if (STRIP_QUERY_KEYS.has(key.toLowerCase())) return;
            kept.append(key, value);
        });
        kept.sort();
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
    requestedSnapshotId?: string | null;
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

    let publicId: string | null = null;
    if (typeof apiData.public_id === 'string' && apiData.public_id.trim()) {
        try {
            publicId = validateSnapshotId(apiData.public_id);
        } catch {
            if (options.requestedSnapshotId) return null;
        }
    }
    if (options.requestedSnapshotId) {
        let requestedSnapshotId: string;
        try {
            requestedSnapshotId = validateSnapshotId(options.requestedSnapshotId);
        } catch {
            return null;
        }
        if (!publicId || publicId !== requestedSnapshotId) return null;
    }

    const rawMeasurementSource =
        typeof apiData.measurement_source === 'string'
            ? apiData.measurement_source.trim().toLowerCase()
            : null;
    const measurementSource = mapMeasurementSource(rawMeasurementSource);
    if (
        options.requestedSnapshotId &&
        rawMeasurementSource !== 'published_snapshot'
    ) {
        return null;
    }

    const rawStatus =
        typeof apiData.status === 'string'
            ? apiData.status.trim().toLowerCase()
            : null;
    let statusFromApi: MeasurementStatus | null = null;
    if (rawStatus === 'ok' || rawStatus === 'ready') statusFromApi = 'ready';
    else if (rawStatus === 'partial') statusFromApi = 'partial';
    else if (rawStatus === 'stale') statusFromApi = 'stale';
    else if (rawStatus === 'revoked') statusFromApi = 'revoked';
    else if (rawStatus === 'unknown') statusFromApi = 'unknown';
    else if (rawStatus !== null) return null;
    if (options.requestedSnapshotId && statusFromApi !== 'ready') return null;

    const co2Grams = toFiniteNumberOrNull(apiData.co2_grams);
    if (co2Grams === null || co2Grams < 0) return null;

    const responseUrl = typeof apiData.url === 'string' ? apiData.url : '';
    const canonicalResponseUrl = responseUrl
        ? canonicalizeBadgeUrl(responseUrl)
        : null;
    if (responseUrl && !canonicalResponseUrl) return null;
    if (
        !options.requestedSnapshotId &&
        responseUrl &&
        !sameUrlIdentity(responseUrl, options.requestedUrl)
    ) {
        // Soft mismatch: still accept if requested canonical equals response host+path
        // but reject when response URL is empty or clearly different page.
        return null;
    }

    if (statusFromApi === 'revoked' || statusFromApi === 'unknown') return null;

    const validUntil =
        typeof apiData.valid_until === 'string' && apiData.valid_until.trim()
            ? apiData.valid_until.trim()
            : null;
    const validUntilMs = validUntil ? Date.parse(validUntil) : Number.NaN;
    if (options.requestedSnapshotId && !Number.isFinite(validUntilMs)) {
        return null;
    }
    const measuredAt =
        (typeof apiData.measured_at === 'string' && apiData.measured_at) ||
        (typeof apiData.scan_measured_at === 'string' && apiData.scan_measured_at) ||
        null;
    if (options.requestedSnapshotId) {
        if (!measuredAt || !Number.isFinite(Date.parse(measuredAt))) {
            return null;
        }
    }
    const expired = Number.isFinite(validUntilMs) && validUntilMs <= (options.now ?? Date.now());
    const status =
        expired || statusFromApi === 'stale'
            ? 'stale'
            : statusFromApi === 'partial'
              ? 'partial'
              : 'ready';

    const score: ScoreLetter = co2ToScore(co2Grams);
    const cleanerRaw = toFiniteNumberOrNull(
        apiData.cleaner_than ?? apiData.benchmark ?? null,
    );
    const cleanerThan =
        cleanerRaw === null ? null : clamp(cleanerRaw, 0, 100);

    const pageWeightKb = toFiniteNumberOrNull(apiData.page_weight_kb);
    const greenHost =
        typeof apiData.green_host === 'boolean' ? apiData.green_host : null;

    return {
        url: canonicalResponseUrl || options.requestedUrl,
        publicId,
        co2Grams,
        score,
        cleanerThan,
        pageWeightKb: pageWeightKb === null ? null : Math.max(0, pageWeightKb),
        greenHost,
        verified: apiData.verified === true,
        timestamp: options.now ?? Date.now(),
        status,
        source: measurementSource,
        formulaId:
            typeof apiData.formula_id === 'string' && apiData.formula_id.trim()
                ? apiData.formula_id.trim()
                : null,
        measurementMethod:
            (typeof apiData.measurement_method === 'string' &&
                apiData.measurement_method) ||
            null,
        measuredAt,
        validUntil,
        evidenceUrl:
            (typeof apiData.evidence_url === 'string' && apiData.evidence_url) ||
            null,
    };
}

/** Reconcile cached / in-memory payload: never invent a letter from missing CO₂. */
export function normalizeBadgeData(data: BadgeData | null | undefined): BadgeData | null {
    if (!data) return null;
    const co2 = toFiniteNumberOrNull(data.co2Grams);
    if (co2 === null || co2 < 0 || data.status === 'revoked' || data.status === 'unknown') {
        return {
            ...data,
            co2Grams: null,
            score: null,
            cleanerThan: null,
            status: data.status === 'revoked' ? 'revoked' : 'unknown',
        };
    }
    const validUntilMs = data.validUntil ? Date.parse(data.validUntil) : Number.NaN;
    const status =
        Number.isFinite(validUntilMs) && validUntilMs <= Date.now()
            ? 'stale'
            : data.status;
    const cleanerThan = toFiniteNumberOrNull(data.cleanerThan);
    return {
        ...data,
        co2Grams: co2,
        score: co2ToScore(co2),
        status,
        cleanerThan: cleanerThan === null ? null : clamp(cleanerThan, 0, 100),
    };
}

export function cloneBadgeData(data: BadgeData): BadgeData {
    return { ...data };
}
