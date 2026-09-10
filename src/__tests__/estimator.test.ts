/**
 * Tests for SWDM v4 estimator (estimator.ts)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { estimateCO2, co2ToScore } from '../estimator';

// Silence expected fallback warnings
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// --- estimateCO2 ---

describe('estimateCO2', () => {
    it('returns a BadgeData object with all required fields', () => {
        const result = estimateCO2(false);
        expect(result).toMatchObject({
            url: expect.any(String),
            co2Grams: expect.any(Number),
            score: expect.stringMatching(/^(A\+|A|B|C|D|F)$/),
            cleanerThan: null,
            pageWeightKb: expect.any(Number),
            greenHost: false,
            timestamp: expect.any(Number),
            formulaId: 'swdm-v4-lite',
        });
    });

    it('co2Grams is always >= 0', () => {
        const result = estimateCO2(false);
        expect(result.co2Grams).toBeGreaterThanOrEqual(0);
    });

    it('does not invent a web percentile (cleanerThan is null)', () => {
        const result = estimateCO2(false);
        expect(result.cleanerThan).toBeNull();
        expect(result.formulaId).toBe('swdm-v4-lite');
    });

    it('greenHost=true produces lower CO₂ than greenHost=false', () => {
        // Stub Performance API with a realistic page weight
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) => {
                if (type === 'resource') return [{ transferSize: 300 * 1024, encodedBodySize: 300 * 1024 }];
                if (type === 'navigation') return [{ transferSize: 80 * 1024, encodedBodySize: 80 * 1024 }];
                return [];
            },
            now: () => Date.now(),
        });

        const standard = estimateCO2(false);
        const green = estimateCO2(true);
        expect(green.co2Grams).toBeLessThan(standard.co2Grams);
    });

    it('falls back to DOM estimation when Performance API returns 0', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: () => [],
            now: () => Date.now(),
        });
        vi.stubGlobal('document', {
            documentElement: { outerHTML: 'x'.repeat(100 * 1024) },
        });

        const result = estimateCO2(false);
        expect(result.co2Grams).toBeGreaterThan(0);
    });

    it('falls back to 500KB default when Performance API throws and DOM throws', () => {
        // Make Performance API throw (triggers catch + warn)
        vi.stubGlobal('performance', {
            getEntriesByType: () => { throw new Error('not supported'); },
        });
        // Make DOM access throw (triggers second catch)
        vi.stubGlobal('document', {
            documentElement: { get outerHTML() { throw new Error('no DOM'); } },
        });

        const result = estimateCO2(false);
        // 500KB fallback → non-zero, finite co2Grams
        expect(result.co2Grams).toBeGreaterThan(0);
        expect(Number.isFinite(result.co2Grams)).toBe(true);
    });

    it('logs a warning when Performance API throws', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('performance', {
            getEntriesByType: () => { throw new Error('not supported'); },
        });

        estimateCO2(false);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Performance Resource Timing API unavailable'));
    });
});
