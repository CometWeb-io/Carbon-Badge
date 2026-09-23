/**
 * @cometweb/carbon-badge — Type definitions
 */

/** Public measurement lifecycle for Honest Operator UI. */
export type MeasurementStatus =
    | 'ready'
    | 'partial'
    | 'stale'
    | 'unknown'
    | 'revoked';

/** How the CO₂ figure was produced — never includes cache/retrieval. */
export type MeasurementSource =
    | 'api'
    | 'estimate'
    | 'published_snapshot'
    | 'http_estimate';

/** How the payload was obtained for this render. */
export type RetrievalSource = 'network' | 'cache' | 'local';

export interface BadgeData {
    url: string;
    publicId: string | null;
    /** Finite CO₂e grams when measured; null when unknown / N/D. */
    co2Grams: number | null;
    /** Letter only when co2Grams is a finite measurement. */
    score: ScoreLetter | null;
    /** Percentile vs cohort when API supplies a real benchmark; else null. */
    cleanerThan: number | null;
    pageWeightKb: number | null;
    greenHost: boolean | null;
    /** Backend verification signal; rendering also requires bound evidence. */
    verified: boolean;
    timestamp: number;
    status: MeasurementStatus;
    source: MeasurementSource;
    formulaId: string | null;
    /** Product score model id (CometWeb bands, not Digital Carbon Rating). */
    scoreModelId: string | null;
    measurementMethod: string | null;
    measuredAt: string | null;
    validUntil: string | null;
    evidenceUrl: string | null;
    /** True when local estimate is partial or unavailable. */
    estimatePartial?: boolean;
    measuredResourceCount?: number;
    unknownResourceCount?: number;
    observableResourceRatio?: number;
    /** @deprecated Alias of observableResourceRatio. */
    coverageRatio?: number;
}

export type ScoreLetter = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export type BadgeTheme = 'dark' | 'light';

export type BadgeMode = 'snapshot' | 'api' | 'estimate';

export interface CacheEntry {
    data: BadgeData;
    ts: number;
    expiresAt: number;
    schema: number;
}

export interface CacheKeyParts {
    canonicalUrl: string;
    snapshotId: string | null;
    mode: BadgeMode;
    apiUrl: string;
    greenHost: boolean;
}

export interface APIResponse {
    public_id?: string;
    url?: string;
    co2_grams?: number | null;
    score?: string | null;
    cleaner_than?: number | null;
    page_weight_kb?: number | null;
    green_host?: boolean | null;
    eco_badge_eligible?: boolean;
    eco_badge_threshold_grams?: number;
    verified?: boolean;
    verification_reason?: string;
    cached?: boolean;
    ttl?: number;
    formula_id?: string | null;
    formula_version?: string | null;
    measurement_method?: string | null;
    measurement_source?: string | null;
    measured_at?: string | null;
    scan_measured_at?: string | null;
    valid_until?: string | null;
    evidence_url?: string | null;
    status?: MeasurementStatus | string;
    benchmark?: number | null;
}

export const BADGE_CACHE_SCHEMA = 4;
export const FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1 = 'swdm-v4-lite-first-load-v1';
export const FORMULA_ID_TRANSFER_V2 = 'cometweb_scan_transfer_v2';
export const SCORE_MODEL_ID_COMETWEB_BANDS_V1 = 'carbon-badge-bands-v1';
