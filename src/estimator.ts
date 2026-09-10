/**
 * @cometweb/carbon-badge — Client-side SWDM v4 Lite Estimator
 *
 * Uses PerformanceObserver / Resource Timing API to measure actual page weight,
 * then applies a simplified SWDM v4 formula to estimate CO₂e per page view.
 *
 * Accuracy: ~20-30% variance vs full server-side analysis (no green hosting
 * detection without API). Use `greenHost` override for manual correction.
 *
 * Does NOT invent a web percentile — cleanerThan stays null for local estimates
 * unless a reference comparison is explicitly requested by the caller.
 */

import type { BadgeData, ScoreLetter } from './types';
import { FORMULA_ID_SWDM_V4_LITE } from './types';

const ENERGY_DC = 0.055;
const ENERGY_NET_MIXED = 0.071;
const ENERGY_USER = 0.080;
const ENERGY_EMBODIED = 0.106;
const CI_GLOBAL = 494;
/** GiB (1024³) — SWDM transfer base. */
const BYTES_PER_GIB = 1024 * 1024 * 1024;

export interface EstimateResult {
    data: BadgeData;
    /** Bytes used for the formula (0 when unknown). */
    pageWeightBytes: number;
    /** True when weight came from a hard-coded fallback, not timing/DOM. */
    partial: boolean;
}

/**
 * Estimate CO₂e for the current page using Resource Timing API.
 */
export function estimateCO2(greenHost: boolean = false): BadgeData {
    return estimateCO2Detailed(greenHost).data;
}

export function estimateCO2Detailed(greenHost: boolean = false): EstimateResult {
    const measured = measurePageWeight();
    const pageWeightBytes = measured.bytes;
    const partial = measured.partial;
    const pageWeightKb = pageWeightBytes / 1024;
    const dataTransferGib = pageWeightBytes / BYTES_PER_GIB;

    const greenFactor = greenHost ? 0.3 : 1.0;

    const co2Dc = dataTransferGib * ENERGY_DC * CI_GLOBAL * greenFactor;
    const co2Net = dataTransferGib * ENERGY_NET_MIXED * CI_GLOBAL;
    const co2User = dataTransferGib * ENERGY_USER * CI_GLOBAL;
    const co2Embodied = dataTransferGib * ENERGY_EMBODIED * CI_GLOBAL;

    const totalCo2 = co2Dc + co2Net + co2User + co2Embodied;
    const score = co2ToScore(totalCo2);
    const href =
        typeof location !== 'undefined' && location.href ? location.href : '';

    const data: BadgeData = {
        url: href,
        co2Grams: Math.round(totalCo2 * 10000) / 10000,
        score,
        // Local lite estimate has no cohort benchmark — never invent "% of web".
        cleanerThan: null,
        pageWeightKb: Math.round(pageWeightKb),
        greenHost,
        verified: false,
        timestamp: Date.now(),
        status: partial ? 'partial' : 'ready',
        source: 'estimate',
        formulaId: FORMULA_ID_SWDM_V4_LITE,
        measurementMethod: 'resource_timing_lite',
        measuredAt: new Date().toISOString(),
        validUntil: null,
        evidenceUrl: null,
        estimatePartial: partial,
    };

    return { data, pageWeightBytes, partial };
}

interface WeightMeasure {
    bytes: number;
    partial: boolean;
}

/**
 * Measure total page weight using Performance Resource Timing API.
 * Falls back to document size estimation if API is unavailable.
 * Hard-coded 500 KiB is marked partial (not a confident measurement).
 */
function measurePageWeight(): WeightMeasure {
    try {
        if (typeof performance !== 'undefined' && performance.getEntriesByType) {
            const resources = performance.getEntriesByType(
                'resource',
            ) as PerformanceResourceTiming[];
            const navigation = performance.getEntriesByType(
                'navigation',
            ) as PerformanceNavigationTiming[];

            let total = 0;

            if (navigation.length > 0) {
                const nav = navigation[0];
                total += nav.transferSize || nav.encodedBodySize || 0;
            }
            for (const res of resources) {
                total += res.transferSize || res.encodedBodySize || 0;
            }

            if (total > 0) return { bytes: total, partial: false };
        }
    } catch {
        console.warn(
            '[CometWeb Carbon Badge] Performance Resource Timing API unavailable, falling back to DOM size estimation.',
        );
    }

    try {
        const html = document.documentElement?.outerHTML || '';
        if (html.length > 0) {
            return { bytes: html.length * 1.3, partial: true };
        }
    } catch {
        console.warn(
            '[CometWeb Carbon Badge] DOM size estimation failed, using default 500KB fallback.',
        );
    }

    return { bytes: 500 * 1024, partial: true };
}

/**
 * Map CO₂e grams to a letter score (public badge bands).
 */
export function co2ToScore(co2Grams: number): ScoreLetter {
    if (co2Grams < 0.1) return 'A+';
    if (co2Grams < 0.2) return 'A';
    if (co2Grams < 0.4) return 'B';
    if (co2Grams < 0.7) return 'C';
    if (co2Grams < 1.0) return 'D';
    return 'F';
}
