/**
 * @cometweb/carbon-badge — Type definitions
 */

export interface BadgeData {
    url: string;
    co2Grams: number;
    score: ScoreLetter;
    cleanerThan: number;
    pageWeightKb: number;
    greenHost: boolean;
    /** True only when embed origin matches the measured URL (API verification). */
    verified: boolean;
    timestamp: number;
}

export type ScoreLetter = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export type BadgeTheme = 'dark' | 'light';

export type BadgeMode = 'api' | 'estimate';

export interface CacheEntry {
    data: BadgeData;
    ts: number;
}

export interface APIResponse {
    url: string;
    co2_grams: number;
    score: string;
    cleaner_than: number;
    page_weight_kb: number;
    green_host: boolean;
    eco_badge_eligible?: boolean;
    eco_badge_threshold_grams?: number;
    /** Present on public badge API when origin/referer was checked. */
    verified?: boolean;
    verification_reason?: string;
    cached: boolean;
    ttl: number;
}
