/**
 * @cometweb/carbon-badge — Client-side SWDM v4 first-load Lite Estimator
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
import { FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1 } from './types';

const OPERATIONAL_DC_KWH_PER_GB = 0.055;
const OPERATIONAL_NETWORK_KWH_PER_GB = 0.059;
const OPERATIONAL_USER_KWH_PER_GB = 0.080;
const EMBODIED_DC_KWH_PER_GB = 0.012;
const EMBODIED_NETWORK_KWH_PER_GB = 0.013;
const EMBODIED_USER_KWH_PER_GB = 0.081;
const CI_GLOBAL = 494;
/** SWDM uses decimal GB, not GiB. */
const BYTES_PER_GB = 1_000_000_000;

export interface EstimateResult {
    data: BadgeData;
    /** Bytes used for the formula (0 when unknown). */
    pageWeightBytes: number;
    /** True when weight is partial or came from DOM estimation. */
    partial: boolean;
    measuredResourceCount: number;
    unknownResourceCount: number;
    coverageRatio: number;
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
    const pageWeightKb = pageWeightBytes > 0 ? pageWeightBytes / 1024 : null;
    const dataTransferGb = pageWeightBytes / BYTES_PER_GB;

    const greenFactor = greenHost ? 0.3 : 1.0;

    const operationalKwhPerGb =
        OPERATIONAL_DC_KWH_PER_GB * greenFactor +
        OPERATIONAL_NETWORK_KWH_PER_GB +
        OPERATIONAL_USER_KWH_PER_GB;
    const embodiedKwhPerGb =
        EMBODIED_DC_KWH_PER_GB +
        EMBODIED_NETWORK_KWH_PER_GB +
        EMBODIED_USER_KWH_PER_GB;

    const totalCo2 =
        pageWeightBytes > 0
            ? dataTransferGb * (operationalKwhPerGb + embodiedKwhPerGb) * CI_GLOBAL
            : null;
    const score = totalCo2 === null ? null : co2ToScore(totalCo2);
    const href =
        typeof location !== 'undefined' && location.href ? location.href : '';

    const data: BadgeData = {
        url: href,
        publicId: null,
        co2Grams: totalCo2 === null ? null : Math.round(totalCo2 * 10000) / 10000,
        score,
        // Local lite estimate has no cohort benchmark — never invent "% of web".
        cleanerThan: null,
        pageWeightKb: pageWeightKb === null ? null : Math.round(pageWeightKb),
        greenHost,
        verified: false,
        timestamp: Date.now(),
        status: totalCo2 === null ? 'unknown' : partial ? 'partial' : 'ready',
        source: 'estimate',
        formulaId: totalCo2 === null ? null : FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1,
        measurementMethod: totalCo2 === null ? null : 'resource_timing_lite',
        measuredAt: totalCo2 === null ? null : new Date().toISOString(),
        validUntil: null,
        evidenceUrl: null,
        estimatePartial: partial || totalCo2 === null,
        measuredResourceCount: measured.measuredResourceCount,
        unknownResourceCount: measured.unknownResourceCount,
        coverageRatio: measured.coverageRatio,
    };

    return {
        data,
        pageWeightBytes,
        partial,
        measuredResourceCount: measured.measuredResourceCount,
        unknownResourceCount: measured.unknownResourceCount,
        coverageRatio: measured.coverageRatio,
    };
}

interface WeightMeasure {
    bytes: number;
    partial: boolean;
    measuredResourceCount: number;
    unknownResourceCount: number;
    coverageRatio: number;
}

/**
 * Measure total page weight using Performance Resource Timing API.
 * Falls back to document size estimation if API is unavailable. The DOM path
 * is explicitly partial; when neither source is available, the result is N/D.
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
            let measuredResourceCount = 0;
            let unknownResourceCount = 0;
            const entries = [
                ...navigation.slice(0, 1),
                ...resources,
            ];

            for (const entry of entries) {
                const bytes = entry.transferSize || entry.encodedBodySize || 0;
                if (bytes > 0) {
                    total += bytes;
                    measuredResourceCount++;
                } else {
                    unknownResourceCount++;
                }
            }

            if (total > 0) {
                const entryCount = measuredResourceCount + unknownResourceCount;
                return {
                    bytes: total,
                    partial: unknownResourceCount > 0,
                    measuredResourceCount,
                    unknownResourceCount,
                    coverageRatio:
                        entryCount > 0 ? measuredResourceCount / entryCount : 0,
                };
            }
        }
    } catch {
        console.warn(
            '[CometWeb Carbon Badge] Performance Resource Timing API unavailable, falling back to DOM size estimation.',
        );
    }

    try {
        const html = document.documentElement?.outerHTML || '';
        if (html.length > 0) {
            return {
                bytes: html.length * 1.3,
                partial: true,
                measuredResourceCount: 0,
                unknownResourceCount: 0,
                coverageRatio: 0,
            };
        }
    } catch {
        console.warn(
            '[CometWeb Carbon Badge] DOM size estimation unavailable.',
        );
    }

    return {
        bytes: 0,
        partial: true,
        measuredResourceCount: 0,
        unknownResourceCount: 0,
        coverageRatio: 0,
    };
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
