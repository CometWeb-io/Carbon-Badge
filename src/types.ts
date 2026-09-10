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

export type MeasurementSource =
    | 'api'
    | 'cache'
    | 'estimate'
    | 'published_snapshot'
    | 'http_estimate';

export interface BadgeData {
    url: string;
    /** Finite CO₂e grams when measured; null when unknown / N/D. */
    co2Grams: number | null;
    /** Letter only when co2Grams is a finite measurement. */
    score: ScoreLetter | null;
    /** Percentile vs cohort when API supplies a real benchmark; else null. */
    cleanerThan: number | null;
    pageWeightKb: number | null;
    greenHost: boolean | null;
    /** True only when embed origin matches the measured URL (API verification). */
    verified: boolean;
    timestamp: number;
    status: MeasurementStatus;
    source: MeasurementSource;
    formulaId: string | null;
    measurementMethod: string | null;
    measuredAt: string | null;
    validUntil: string | null;
    evidenceUrl: string | null;
    /** True when local estimate used a hard-coded weight fallback (not a real measurement). */
    estimatePartial?: boolean;
}

export type ScoreLetter = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export type BadgeTheme = 'dark' | 'light';

export type BadgeMode = 'api' | 'estimate';

export interface CacheEntry {
    data: BadgeData;
    ts: number;
    schema: number;
}

export interface CacheKeyParts {
    canonicalUrl: string;
    mode: BadgeMode;
    apiUrl: string;
    greenHost: boolean;
}

export interface APIResponse {
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
    measurement_method?: string | null;
    measurement_source?: string | null;
    measured_at?: string | null;
    scan_measured_at?: string | null;
    valid_until?: string | null;
    evidence_url?: string | null;
    status?: MeasurementStatus;
    benchmark?: number | null;
}

export const BADGE_CACHE_SCHEMA = 2;
export const FORMULA_ID_SWDM_V4_LITE = 'swdm-v4-lite';
export const FORMULA_ID_TRANSFER_V2 = 'cometweb_scan_transfer_v2';
