/**
 * @cometweb/carbon-badge — Client-side SWDM v4 first-load Lite Estimator
 *
 * Measures transfer with Resource Timing, then applies a simplified SWDM v4
 * formula. Does NOT invent a web percentile. DOM size is never used as a
 * carbon score input.
 */

import type { BadgeData, ScoreLetter } from './types';
import {
    FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1,
    SCORE_MODEL_ID_COMETWEB_BANDS_V1,
} from './types';

const OPERATIONAL_DC_KWH_PER_GB = 0.055;
const OPERATIONAL_NETWORK_KWH_PER_GB = 0.059;
const OPERATIONAL_USER_KWH_PER_GB = 0.080;
const EMBODIED_DC_KWH_PER_GB = 0.012;
const EMBODIED_NETWORK_KWH_PER_GB = 0.013;
const EMBODIED_USER_KWH_PER_GB = 0.081;
const CI_GLOBAL = 494;
/** SWDM uses decimal GB, not GiB. */
const BYTES_PER_GB = 1_000_000_000;

let resourceTimingBufferOverflowed = false;
let resourceTimingInitialized = false;

/**
 * Enlarge the Resource Timing buffer and watch for overflow so a truncated
 * buffer cannot look like a complete measurement (CB-11).
 */
export function initializeResourceTiming(): void {
    if (resourceTimingInitialized) return;
    resourceTimingInitialized = true;

    if (typeof performance === 'undefined') {
        resourceTimingBufferOverflowed = true;
        return;
    }

    try {
        if (typeof performance.setResourceTimingBufferSize === 'function') {
            performance.setResourceTimingBufferSize(2_000);
        }
        if (typeof performance.addEventListener === 'function') {
            performance.addEventListener('resourcetimingbufferfull', () => {
                resourceTimingBufferOverflowed = true;
            });
        }
    } catch {
        resourceTimingBufferOverflowed = true;
    }
}

/** Test helper. */
export function resetResourceTimingGuard(): void {
    resourceTimingBufferOverflowed = false;
    resourceTimingInitialized = false;
}

export interface EstimateResult {
    data: BadgeData;
    /** Bytes used for the formula (0 when unknown). */
    pageWeightBytes: number;
    /** True when weight is partial. */
    partial: boolean;
    measuredResourceCount: number;
    unknownResourceCount: number;
    /** Count-based Resource Timing entry ratio — not byte coverage. */
    observableResourceRatio: number;
    /** @deprecated Alias of observableResourceRatio. */
    coverageRatio: number;
}

/**
 * Estimate CO₂e for the current page using Resource Timing API.
 */
export function estimateCO2(greenHost: boolean = false): BadgeData {
    return estimateCO2Detailed(greenHost).data;
}

export function estimateCO2Detailed(greenHost: boolean = false): EstimateResult {
    initializeResourceTiming();
    const measured = measurePageWeight();
    const pageWeightBytes = measured.bytes;
    const partial = measured.partial || resourceTimingBufferOverflowed;
    const pageWeightKb = pageWeightBytes > 0 ? pageWeightBytes / 1024 : null;
    const dataTransferGb = pageWeightBytes / BYTES_PER_GB;

    // Local mode cannot independently verify green hosting. Self-declared
    // `green-host="true"` must not improve a public letter grade.
    void greenHost;
    const greenHostingFactor = 0;

    const operationalKwhPerGb =
        OPERATIONAL_DC_KWH_PER_GB * (1 - greenHostingFactor) +
        OPERATIONAL_NETWORK_KWH_PER_GB +
        OPERATIONAL_USER_KWH_PER_GB;
    const embodiedKwhPerGb =
        EMBODIED_DC_KWH_PER_GB +
        EMBODIED_NETWORK_KWH_PER_GB +
        EMBODIED_USER_KWH_PER_GB;

    const totalCo2 =
        pageWeightBytes > 0 &&
        measured.measuredResourceCount > 0 &&
        measured.unknownResourceCount === 0
            ? dataTransferGb *
              (operationalKwhPerGb + embodiedKwhPerGb) *
              CI_GLOBAL
            : null;
    const score = totalCo2 === null ? null : co2ToScore(totalCo2);
    const href =
        typeof location !== 'undefined' && location.href ? location.href : '';

    const data: BadgeData = {
        url: href,
        publicId: null,
        co2Grams:
            totalCo2 === null ? null : Math.round(totalCo2 * 10000) / 10000,
        score,
        cleanerThan: null,
        pageWeightKb: pageWeightKb === null ? null : Math.round(pageWeightKb),
        // Record the assertion for telemetry, but never improve the grade from it.
        greenHost,
        verified: false,
        timestamp: Date.now(),
        status:
            totalCo2 === null
                ? partial && measured.measuredResourceCount > 0
                    ? 'partial'
                    : 'unknown'
                : 'ready',
        source: 'estimate',
        formulaId:
            totalCo2 === null ? null : FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1,
        scoreModelId:
            totalCo2 === null ? null : SCORE_MODEL_ID_COMETWEB_BANDS_V1,
        measurementMethod:
            totalCo2 === null ? null : 'resource_timing_lite',
        measuredAt: totalCo2 === null ? null : new Date().toISOString(),
        validUntil: null,
        evidenceUrl: null,
        estimatePartial: partial || totalCo2 === null,
        measuredResourceCount: measured.measuredResourceCount,
        unknownResourceCount: measured.unknownResourceCount,
        observableResourceRatio: measured.observableResourceRatio,
        coverageRatio: measured.observableResourceRatio,
    };

    return {
        data,
        pageWeightBytes,
        partial,
        measuredResourceCount: measured.measuredResourceCount,
        unknownResourceCount: measured.unknownResourceCount,
        observableResourceRatio: measured.observableResourceRatio,
        coverageRatio: measured.observableResourceRatio,
    };
}

interface WeightMeasure {
    bytes: number;
    partial: boolean;
    measuredResourceCount: number;
    unknownResourceCount: number;
    observableResourceRatio: number;
}

/**
 * Measure total page weight using Performance Resource Timing API.
 * No DOM-size fallback — unavailable timing yields N/D, not a fabricated grade.
 */
function measurePageWeight(): WeightMeasure {
    const unavailable = (): WeightMeasure => ({
        bytes: 0,
        partial: true,
        measuredResourceCount: 0,
        unknownResourceCount: 0,
        observableResourceRatio: 0,
    });

    try {
        if (
            typeof performance === 'undefined' ||
            !performance.getEntriesByType
        ) {
            return unavailable();
        }

        const resources = performance.getEntriesByType(
            'resource',
        ) as PerformanceResourceTiming[];
        const navigation = performance.getEntriesByType(
            'navigation',
        ) as PerformanceNavigationTiming[];

        let total = 0;
        let measuredResourceCount = 0;
        let unknownResourceCount = 0;
        const entries = [...navigation.slice(0, 1), ...resources];

        for (const entry of entries) {
            const bytes = entry.transferSize || entry.encodedBodySize || 0;
            if (bytes > 0) {
                total += bytes;
                measuredResourceCount++;
            } else {
                unknownResourceCount++;
            }
        }

        if (total > 0 && measuredResourceCount > 0) {
            const entryCount = measuredResourceCount + unknownResourceCount;
            return {
                bytes: total,
                partial:
                    unknownResourceCount > 0 || resourceTimingBufferOverflowed,
                measuredResourceCount,
                unknownResourceCount,
                observableResourceRatio:
                    entryCount > 0 ? measuredResourceCount / entryCount : 0,
            };
        }
    } catch {
        console.warn(
            '[CometWeb Carbon Badge] Performance Resource Timing API unavailable.',
        );
    }

    return unavailable();
}

/**
 * Map CO₂e grams to the CometWeb Carbon Score letter bands.
 * These are product bands (`carbon-badge-bands-v1`), not the public
 * Digital Carbon Rating Scale thresholds.
 */
export function co2ToScore(co2Grams: number): ScoreLetter {
    if (!Number.isFinite(co2Grams) || co2Grams < 0) {
        throw new RangeError(
            'co2Grams must be a finite non-negative number',
        );
    }
    if (co2Grams < 0.1) return 'A+';
    if (co2Grams < 0.2) return 'A';
    if (co2Grams < 0.4) return 'B';
    if (co2Grams < 0.7) return 'C';
    if (co2Grams < 1.0) return 'D';
    return 'F';
}
