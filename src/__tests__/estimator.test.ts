/**
 * Tests for SWDM v4 estimator (estimator.ts)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { estimateCO2, estimateCO2Detailed, co2ToScore } from '../estimator';

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('estimateCO2', () => {
    it('returns a BadgeData object with all required fields', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) => {
                if (type === 'resource') {
                    return [
                        {
                            transferSize: 300 * 1024,
                            encodedBodySize: 300 * 1024,
                        },
                    ];
                }
                if (type === 'navigation') {
                    return [
                        {
                            transferSize: 80 * 1024,
                            encodedBodySize: 80 * 1024,
                        },
                    ];
                }
                return [];
            },
            now: () => Date.now(),
        });

        const result = estimateCO2(false);
        expect(result).toMatchObject({
            url: expect.any(String),
            co2Grams: expect.any(Number),
            score: expect.stringMatching(/^(A\+|A|B|C|D|F)$/),
            cleanerThan: null,
            pageWeightKb: expect.any(Number),
            greenHost: false,
            timestamp: expect.any(Number),
            formulaId: 'swdm-v4-lite-first-load-v1',
            scoreModelId: 'carbon-badge-bands-v1',
        });
    });

    it('co2Grams is always >= 0 when measured', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) =>
                type === 'navigation'
                    ? [{ transferSize: 10_000, encodedBodySize: 10_000 }]
                    : [],
            now: () => Date.now(),
        });
        const result = estimateCO2(false);
        expect(result.co2Grams).toBeGreaterThanOrEqual(0);
    });

    it('does not invent a web percentile (cleanerThan is null)', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) =>
                type === 'navigation'
                    ? [{ transferSize: 10_000, encodedBodySize: 10_000 }]
                    : [],
            now: () => Date.now(),
        });
        const result = estimateCO2(false);
        expect(result.cleanerThan).toBeNull();
        expect(result.formulaId).toBe('swdm-v4-lite-first-load-v1');
    });

    it('greenHost=true produces lower CO₂ than greenHost=false', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) => {
                if (type === 'resource')
                    return [
                        {
                            transferSize: 300 * 1024,
                            encodedBodySize: 300 * 1024,
                        },
                    ];
                if (type === 'navigation')
                    return [
                        {
                            transferSize: 80 * 1024,
                            encodedBodySize: 80 * 1024,
                        },
                    ];
                return [];
            },
            now: () => Date.now(),
        });

        const standard = estimateCO2(false);
        const green = estimateCO2(true);
        expect(green.co2Grams).not.toBeNull();
        expect(standard.co2Grams).not.toBeNull();
        expect(green.co2Grams!).toBeCloseTo(
            standard.co2Grams! * (121.03 / 148.2),
            4,
        );
        expect(green.co2Grams!).toBeLessThan(standard.co2Grams!);
    });

    it('does not turn DOM size into a carbon grade', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: () => [],
            now: () => Date.now(),
        });
        vi.stubGlobal('document', {
            documentElement: { outerHTML: 'x'.repeat(100 * 1024) },
        });

        const result = estimateCO2(false);
        expect(result.co2Grams).toBeNull();
        expect(result.score).toBeNull();
        expect(result.status).toBe('unknown');
    });

    it('returns unknown when Performance API is unavailable', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: () => {
                throw new Error('not supported');
            },
        });

        const result = estimateCO2(false);
        expect(result.co2Grams).toBeNull();
        expect(result.score).toBeNull();
        expect(result.status).toBe('unknown');
        expect(result.pageWeightKb).toBeNull();
    });

    it('uses decimal GB and the SWDM v4 first-load constants', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) =>
                type === 'navigation'
                    ? [
                          {
                              transferSize: 1_000_000_000,
                              encodedBodySize: 1_000_000_000,
                          },
                      ]
                    : [],
        });

        const result = estimateCO2Detailed(false);

        expect(result.data.co2Grams).toBeCloseTo(148.2, 8);
        expect(result.pageWeightBytes).toBe(1_000_000_000);
    });

    it('marks timing as partial when any resource has unknown size', () => {
        vi.stubGlobal('performance', {
            getEntriesByType: (type: string) => {
                if (type === 'navigation')
                    return [{ transferSize: 100, encodedBodySize: 100 }];
                if (type === 'resource')
                    return [{ transferSize: 0, encodedBodySize: 0 }];
                return [];
            },
        });

        const result = estimateCO2Detailed(false);

        expect(result.data.status).toBe('partial');
        expect(result.data.co2Grams).not.toBeNull();
        expect(result.measuredResourceCount).toBe(1);
        expect(result.unknownResourceCount).toBe(1);
        expect(result.observableResourceRatio).toBe(0.5);
        expect(result.coverageRatio).toBe(0.5);
    });

    it('logs a warning when Performance API throws', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('performance', {
            getEntriesByType: () => {
                throw new Error('not supported');
            },
        });

        estimateCO2(false);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Performance Resource Timing API unavailable'),
        );
    });
});

describe('co2ToScore input contract', () => {
    it('rejects non-finite and negative input', () => {
        for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => co2ToScore(value)).toThrow(RangeError);
        }
    });
});
