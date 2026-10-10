// @ts-expect-error The pinned CO2.js package does not publish TypeScript declarations.
import { co2 } from '@tgwf/co2';
import { afterEach, expect, it, vi } from 'vitest';
import { estimateCO2Detailed, resetResourceTimingGuard } from '../estimator';
import fixture from './fixtures/swdm-v4-co2js-0.19.0.json';

afterEach(() => { vi.unstubAllGlobals(); resetResourceTimingGuard(); });

it.each(fixture.cases)('matches the independent pinned SWDM v4 implementation at $bytes bytes', ({ bytes, grams }) => {
    const reference = new co2({ model: 'swd', version: 4 }).perByte(bytes, false);
    expect(reference).toBeCloseTo(grams, 12);
    vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: bytes }] : [] });
    expect(estimateCO2Detailed().data.co2Grams).toBeCloseTo(reference, 12);
});
