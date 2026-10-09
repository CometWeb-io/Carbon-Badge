import type { APIResponse, BadgeData, MeasurementStatus, ScoreLetter } from './types';
import { SCORE_MODEL_ID_COMETWEB_BANDS_V1 } from './types';
import { co2ToScore } from './estimator';
import { toFiniteNumberOrNull } from './utils';
import { canonicalizeBadgeUrl, trustedEvidenceUrl, validateSnapshotId } from './url';
import { mapMeasurementSource, parseMeasurementStatus, percentageOrNull, timestampMs, hasInvalidFreshness } from './normalize';

function sameUrlIdentity(
    a: string,
    b: string,
): boolean {
    const ca = canonicalizeBadgeUrl(a);
    const cb = canonicalizeBadgeUrl(b);
    if (!ca || !cb) return false;
    return ca === cb;
}

function nonNegativeOrNull(value: unknown): number | null {
    const n = toFiniteNumberOrNull(value);
    return n !== null && n >= 0 ? n : null;
}

export interface NormalizeApiOptions {
    requestedUrl: string;
    requestedSnapshotId?: string | null;
    now?: number;
}

/**
 * Parse public API JSON into BadgeData. Returns null when measurement is unusable
 * (missing CO₂, status, URL, identity mismatch, or expired snapshot) — caller must show N/D.
 */
export function parseApiResponse(
    apiData: APIResponse | null | undefined,
    options: NormalizeApiOptions,
): BadgeData | null {
    if (!apiData || typeof apiData !== 'object') return null;

    const now = options.now ?? Date.now();

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

    const measurementSource = mapMeasurementSource(apiData.measurement_source);
    if (!measurementSource) return null;
    if (
        options.requestedSnapshotId &&
        measurementSource !== 'published_snapshot'
    ) {
        return null;
    }

    const statusFromApi = parseMeasurementStatus(apiData.status);
    if (statusFromApi === null) return null;

    const co2Grams = toFiniteNumberOrNull(apiData.co2_grams);
    if (statusFromApi === 'ready' && (co2Grams === null || co2Grams < 0)) return null;

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
    const validUntilMs = validUntil ? timestampMs(validUntil) : Number.NaN;
    const rawMeasuredAt = apiData.measured_at ?? apiData.scan_measured_at;
    const measuredAt = typeof rawMeasuredAt === 'string' ? rawMeasuredAt.trim() || null : null;
    const measuredAtMs = measuredAt ? timestampMs(measuredAt) : Number.NaN;

    const invalidFreshness =
        apiData.valid_until != null && (!validUntil || !Number.isFinite(validUntilMs)) ||
        (apiData.measured_at != null || apiData.scan_measured_at != null) && (!measuredAt || !Number.isFinite(measuredAtMs)) ||
        hasInvalidFreshness(measuredAt, validUntil, now, measurementSource === 'published_snapshot');
    const expired = Number.isFinite(validUntilMs) && validUntilMs <= now;
    const status: MeasurementStatus = statusFromApi === 'revoked' || statusFromApi === 'unknown'
        ? statusFromApi
        : expired || statusFromApi === 'stale' ? 'stale'
        : invalidFreshness || statusFromApi === 'partial' ? 'partial' : 'ready';

    const formulaId =
        (typeof apiData.formula_id === 'string' &&
            apiData.formula_id.trim()) ||
        (typeof apiData.formula_version === 'string' &&
            apiData.formula_version.trim()) ||
        null;

    const measurementMethod =
        typeof apiData.measurement_method === 'string' &&
        apiData.measurement_method.trim()
            ? apiData.measurement_method.trim()
            : null;

    const scoreModelId =
        typeof apiData.score_model_id === 'string' &&
        apiData.score_model_id.trim()
            ? apiData.score_model_id.trim()
            : null;

    if (scoreModelId && scoreModelId !== SCORE_MODEL_ID_COMETWEB_BANDS_V1) return null;

    if (options.requestedSnapshotId && status === 'ready') {
        if (
            !formulaId ||
            !measurementMethod ||
            scoreModelId !== SCORE_MODEL_ID_COMETWEB_BANDS_V1
        ) {
            return null;
        }
    }

    const score: ScoreLetter | null = status === 'ready' ? co2ToScore(co2Grams as number) : null;
    const cleanerThan = percentageOrNull(
        apiData.cleaner_than ?? apiData.benchmark ?? null,
    );
    const pageWeightKb = nonNegativeOrNull(apiData.page_weight_kb);
    const greenHost =
        typeof apiData.green_host === 'boolean' ? apiData.green_host : null;

    return {
        url: canonicalResponseUrl,
        publicId,
        co2Grams: status === 'ready' ? co2Grams : null,
        score,
        cleanerThan: status === 'ready' ? cleanerThan : null,
        reasonCode: invalidFreshness ? 'invalid-freshness' : status !== 'ready' ? `measurement-${status}` : undefined,
        pageWeightKb,
        pageWeightKiB: null,
        pageWeightKB: null,
        factorSetId: typeof apiData.factor_set_id === 'string' ? apiData.factor_set_id.trim() || null : null,
        greenHost,
        originMatched: apiData.verification_reason === 'origin_match'
            ? true : apiData.verification_reason === 'origin_mismatch' ? false : null,
        timestamp: now,
        status,
        source: measurementSource,
        formulaId,
        scoreModelId: scoreModelId ?? SCORE_MODEL_ID_COMETWEB_BANDS_V1,
        measurementMethod,
        measuredAt,
        validUntil,
        evidenceUrl: trustedEvidenceUrl(apiData.evidence_url, publicId)?.href ?? null,
    };
}
