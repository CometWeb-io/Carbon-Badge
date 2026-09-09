/**
 * @cometweb/carbon-badge — Client-side SWDM v4 Lite Estimator
 * 
 * Uses PerformanceObserver / Resource Timing API to measure actual page weight,
 * then applies a simplified SWDM v4 formula to estimate CO₂e per page view.
 * 
 * Accuracy: ~20-30% variance vs full server-side analysis (no green hosting
 * detection without API). Use `greenHost` override for manual correction.
 */

import type { BadgeData, ScoreLetter } from './types';

const ENERGY_DC = 0.055;
const ENERGY_NET_MIXED = 0.071;
const ENERGY_USER = 0.080;
const ENERGY_EMBODIED = 0.106;
const CI_GLOBAL = 494;
const AVERAGE_CO2_PER_VISIT = 0.5;

/**
 * Estimate CO₂e for the current page using Resource Timing API.
 */
export function estimateCO2(greenHost: boolean = false): BadgeData {
    const pageWeightBytes = measurePageWeight();
    const pageWeightKb = pageWeightBytes / 1024;
    const dataTransferGb = pageWeightBytes / (1024 * 1024 * 1024);

    const greenFactor = greenHost ? 0.3 : 1.0;

    const co2Dc = dataTransferGb * ENERGY_DC * CI_GLOBAL * greenFactor;
    const co2Net = dataTransferGb * ENERGY_NET_MIXED * CI_GLOBAL;
    const co2User = dataTransferGb * ENERGY_USER * CI_GLOBAL;
    const co2Embodied = dataTransferGb * ENERGY_EMBODIED * CI_GLOBAL;

    const totalCo2 = co2Dc + co2Net + co2User + co2Embodied;

    const cleanerThan = Math.min(99, Math.max(1, 100 - (totalCo2 / AVERAGE_CO2_PER_VISIT) * 50));
    const score = co2ToScore(totalCo2);

    return {
        url: location.href,
        co2Grams: Math.round(totalCo2 * 10000) / 10000,
        score,
        cleanerThan: Math.round(cleanerThan * 10) / 10,
        pageWeightKb: Math.round(pageWeightKb),
        greenHost,
        // Client estimate is never origin-verified against CometWeb scan ownership.
        verified: false,
        timestamp: Date.now(),
    };
}

/**
 * Measure total page weight using Performance Resource Timing API.
 * Falls back to document size estimation if API is unavailable.
 */
function measurePageWeight(): number {
    try {
        if (typeof performance !== 'undefined' && performance.getEntriesByType) {
            const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            const navigation = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];

            let total = 0;

            if (navigation.length > 0) {
                const nav = navigation[0];
                total += nav.transferSize || nav.encodedBodySize || 0;
            }
            for (const res of resources) {
                total += res.transferSize || res.encodedBodySize || 0;
            }

            if (total > 0) return total;
        }
    } catch {
        console.warn('[CometWeb Carbon Badge] Performance Resource Timing API unavailable, falling back to DOM size estimation.');
    }

    try {
        const html = document.documentElement?.outerHTML || '';
        return html.length * 1.3;
    } catch {
        console.warn('[CometWeb Carbon Badge] DOM size estimation failed, using default 500KB fallback.');
        return 500 * 1024;
    }
}

/**
 * Map CO₂e grams to a letter score.
 */
export function co2ToScore(co2Grams: number): ScoreLetter {
    if (co2Grams < 0.10) return 'A+';
    if (co2Grams < 0.20) return 'A';
    if (co2Grams < 0.40) return 'B';
    if (co2Grams < 0.70) return 'C';
    if (co2Grams < 1.00) return 'D';
    return 'F';
}
