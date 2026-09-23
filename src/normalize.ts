/**
 * @cometweb/carbon-badge — URL canonicalize + API response normalizer
 *
 * Fail-closed: missing / non-finite CO₂ never becomes a letter grade.
 * Default public identity is origin + pathname (no query string).
 */

import type {
    APIResponse,
    BadgeData,
    MeasurementSource,
    MeasurementStatus,
    ScoreLetter,
} from './types';
import { SCORE_MODEL_ID_COMETWEB_BANDS_V1 } from './types';
import { co2ToScore } from './estimator';
import { clamp, toFiniteNumberOrNull } from './utils';
import { validateSnapshotId } from './api-client';

/**
 * Canonical public URL identity.
 *
 * By default strips **all** query parameters (privacy-safe). Pass an explicit
 * allowlist only when a product surface intentionally needs semantic query keys.
 */
export function canonicalizeBadgeUrl(
    raw: string,
    allowedQueryKeys: readonly string[] = [],
): string | null {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;
    try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        if (u.username || u.password) return null;
        u.hash = '';

        const allowlist = new Set(
            allowedQueryKeys.map((key) => key.toLowerCase()),
        );
        const safeQuery = new URLSearchParams();
        for (const [key, value] of u.searchParams.entries()) {
            if (allowlist.has(key.toLowerCase())) {
                safeQuery.append(key, value);
            }
        }
        safeQuery.sort();
        const qs = safeQuery.toString();
        u.search = qs ? `?${qs}` : '';

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
    if (raw === 'published_snapshot') return 'published_snapshot';
    if (raw === 'cometweb_scan') return 'published_snapshot';
    if (raw === 'badge_http_estimate' || raw === 'http_estimate') {
        return 'http_estimate';
    }
    if (raw === 'estimate') return 'estimate';
    return 'api';
}

function parseMeasurementStatus(raw: unknown): MeasurementStatus | null {
    if (typeof raw !== 'string') return null;
    switch (raw.trim().toLowerCase()) {
        case 'ok':
        case 'ready':
            return 'ready';
        case 'partial':
            return 'partial';
        case 'stale':
            return 'stale';
        case 'revoked':
            return 'revoked';
        case 'unknown':
            return 'unknown';
        default:
            return null;
    }
}

export interface NormalizeApiOptions {
    requestedUrl: string;
    requestedSnapshotId?: string | null;
    now?: number;
}

/**
 * Parse public API JSON into BadgeData. Returns null when measurement is unusable
 * (missing CO₂, status, URL, or identity mismatch) — caller must show N/D.
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

    const statusFromApi = parseMeasurementStatus(apiData.status);
    if (statusFromApi === null) return null;
    if (options.requestedSnapshotId && statusFromApi !== 'ready') return null;
    if (statusFromApi === 'revoked' || statusFromApi === 'unknown') return null;

    const co2Grams = toFiniteNumberOrNull(apiData.co2_grams);
    if (co2Grams === null || co2Grams < 0) return null;

    const responseUrl =
        typeof apiData.url === 'string' ? apiData.url.trim() : '';
    if (!responseUrl) return null;
    const canonicalResponseUrl = canonicalizeBadgeUrl(responseUrl);
    if (!canonicalResponseUrl) return null;

    if (
        !options.requestedSnapshotId &&
        !sameUrlIdentity(responseUrl, options.requestedUrl)
    ) {
        return null;
    }

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
        (typeof apiData.scan_measured_at === 'string' &&
            apiData.scan_measured_at) ||
        null;
    if (options.requestedSnapshotId) {
        if (!measuredAt || !Number.isFinite(Date.parse(measuredAt))) {
            return null;
        }
    }
    const expired =
        Number.isFinite(validUntilMs) &&
        validUntilMs <= (options.now ?? Date.now());
    const status: MeasurementStatus =
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
        url: canonicalResponseUrl,
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
            (typeof apiData.formula_id === 'string' &&
                apiData.formula_id.trim()) ||
            (typeof apiData.formula_version === 'string' &&
                apiData.formula_version.trim()) ||
            null,
        scoreModelId: SCORE_MODEL_ID_COMETWEB_BANDS_V1,
        measurementMethod:
            (typeof apiData.measurement_method === 'string' &&
                apiData.measurement_method) ||
            null,
        measuredAt,
        validUntil,
        evidenceUrl:
            (typeof apiData.evidence_url === 'string' &&
                apiData.evidence_url.trim()) ||
            null,
    };
}

/** Reconcile cached / in-memory payload: never invent a letter from missing CO₂. */
export function normalizeBadgeData(
    data: BadgeData | null | undefined,
): BadgeData | null {
    if (!data) return null;
    const co2 = toFiniteNumberOrNull(data.co2Grams);
    if (
        co2 === null ||
        co2 < 0 ||
        data.status === 'revoked' ||
        data.status === 'unknown'
    ) {
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
        scoreModelId: data.scoreModelId ?? SCORE_MODEL_ID_COMETWEB_BANDS_V1,
    };
}

export function cloneBadgeData(data: BadgeData): BadgeData {
    return { ...data };
}
