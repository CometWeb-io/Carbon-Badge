/**
 * @cometweb/carbon-badge — URL canonicalize + API response normalizer
 *
 * Fail-closed: missing / non-finite CO₂ never becomes a letter grade.
 * Default public identity is origin + pathname (no query string).
 */

import type {
    BadgeData,
    MeasurementSource,
    MeasurementStatus,
} from './types';
import { SCORE_MODEL_ID_COMETWEB_BANDS_V1 } from './types';
import { co2ToScore } from './estimator';
import { toFiniteNumberOrNull } from './utils';
import { canonicalizeBadgeUrl, trustedEvidenceUrl } from './url';
export { canonicalizeBadgeUrl } from './url';

export function mapMeasurementSource(raw: unknown): MeasurementSource | null {
    // Older API payloads omitted the field entirely. An explicit but unknown
    // value must not be relabeled as API provenance.
    if (raw === undefined) return 'api';
    if (typeof raw !== 'string') return null;
    const source = raw.trim().toLowerCase();
    if (source === 'published_snapshot') return 'published_snapshot';
    if (source === 'cometweb_scan') return 'cometweb_scan';
    if (source === 'badge_http_estimate' || source === 'http_estimate') {
        return 'http_estimate';
    }
    if (source === 'estimate') return 'estimate';
    if (source === 'api') return 'api';
    return null;
}

export function parseMeasurementStatus(raw: unknown): MeasurementStatus | null {
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

export function percentageOrNull(value: unknown): number | null {
    const n = toFiniteNumberOrNull(value);
    return n !== null && n >= 0 && n <= 100 ? n : null;
}

/** Require an ISO timestamp with a timezone; do not normalize impossible calendar dates. */
export function timestampMs(value: string): number {
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    const calendar = new Date(value.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
    return Date.parse(value);
}

/** Missing legacy API timestamps are allowed; explicit invalid dates never are. */
export function hasInvalidFreshness(measuredAt: string | null, validUntil: string | null, now = Date.now(), required = false): boolean {
    const measured = measuredAt ? timestampMs(measuredAt) : NaN;
    const until = validUntil ? timestampMs(validUntil) : NaN;
    return Boolean(
        required && (!measuredAt || !validUntil) ||
        measuredAt && (!Number.isFinite(measured) || measured > now) ||
        validUntil && !Number.isFinite(until) ||
        measuredAt && validUntil && until <= measured
    );
}

/** Reconcile cached / in-memory payload: never invent a letter from missing CO₂. */
export function normalizeBadgeData(
    data: BadgeData | null | undefined,
): BadgeData | null {
    if (!data) return null;
    const co2 = toFiniteNumberOrNull(data.co2Grams);
    const url = canonicalizeBadgeUrl(data.url);
    const status = parseMeasurementStatus(data.status) ?? 'unknown';
    const source = data.source === undefined ? null : mapMeasurementSource(data.source);
    data = { ...data, url: url ?? '', source, evidenceUrl: trustedEvidenceUrl(data.evidenceUrl, data.publicId)?.href ?? null };
    const unsupportedModel = data.scoreModelId && data.scoreModelId !== SCORE_MODEL_ID_COMETWEB_BANDS_V1;
    if (
        co2 === null ||
        co2 < 0 ||
        status !== 'ready' || !source || unsupportedModel || !url
    ) {
        return {
            ...data,
            co2Grams: null,
            score: null,
            cleanerThan: null,
            status: status === 'revoked' || status === 'stale' || status === 'partial' ? status : 'unknown',
        };
    }
    if (hasInvalidFreshness(data.measuredAt, data.validUntil, Date.now(), data.source === 'published_snapshot')) {
        return { ...data, co2Grams: null, score: null, cleanerThan: null, status: 'partial', reasonCode: 'invalid-freshness' };
    }
    const validUntilMs = data.validUntil ? timestampMs(data.validUntil) : Number.NaN;
    if (Number.isFinite(validUntilMs) && validUntilMs <= Date.now()) {
        return {
            ...data,
            co2Grams: null,
            score: null,
            cleanerThan: null,
            status: 'stale',
        };
    }
    const cleanerThan = percentageOrNull(data.cleanerThan);
    return {
        ...data,
        co2Grams: co2,
        score: co2ToScore(co2),
        status,
        source,
        cleanerThan,
        scoreModelId: data.scoreModelId ?? SCORE_MODEL_ID_COMETWEB_BANDS_V1,
    };
}

export function cloneBadgeData(data: BadgeData): BadgeData {
    return { ...data };
}
