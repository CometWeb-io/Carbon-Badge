import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeBadgeData, timestampMs } from '../normalize';
import { canonicalizeBadgeUrl } from '../url';
import { parseApiResponse } from '../api-response';
import { buildBadgeMarkup } from '../render';
import snapshot from '../../docs/fixtures/python-snapshot.json';
import urls from '../../docs/fixtures/url-identity.json';
import { estimateCO2Detailed, resetResourceTimingGuard } from '../estimator';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetResourceTimingGuard(); });

describe('public timestamp precision', () => {
    it.each(['1', '12', '123', '1230', '12300', '123000', '1234567', '12345678', '123456789'])('accepts %s fractional digits and truncates to milliseconds', fraction => {
        expect(timestampMs(`2026-10-10T12:45:05.${fraction}+00:00`)).toBe(Date.parse(`2026-10-10T12:45:05.${fraction.padEnd(3, '0').slice(0, 3)}Z`));
    });
    it.each(['+02:30', '-02:30', '+23:59', '-23:59'])('accepts a valid offset %s', offset => {
        expect(timestampMs(`2026-10-10T12:45:05.123456${offset}`)).toBe(Date.parse(`2026-10-10T12:45:05.123${offset}`));
    });
    it.each(['2026-02-29T12:00:00Z', '2026-02-31T12:00:00Z', '2026-10-10T25:00:00Z', '2026-10-10T12:00:00+24:00', '2026-10-10T12:00:00+02:60', '2026-10-10T12:00:00.1234567890Z', '2026-10-10T12:00:00'])('rejects %s', value => {
        expect(timestampMs(value)).toBeNaN();
    });
    it('accepts leap day without rolling impossible dates forward', () => {
        expect(timestampMs('2024-02-29T12:00:00.000001Z')).toBe(Date.parse('2024-02-29T12:00:00Z'));
    });
});

it('never invents a document transfer upper bound from completed timing entries', () => {
    vi.stubGlobal('performance', { getEntriesByType: (type: string) => type === 'navigation' ? [{ transferSize: 1000 }] : [] });
    const data = estimateCO2Detailed().data;
    expect(data).toMatchObject({ status: 'ready', networkTransferBytes: 1000, transferUpperBoundBytes: null });
    expect(buildBadgeMarkup(data, 'light').markup).toContain('Observed-transfer SWDM v4 estimate');
});

describe('public URL identity', () => {
    it.each(urls)('matches the Python producer for $input', ({ input, canonical }) => {
        expect(canonicalizeBadgeUrl(input)).toBe(canonical);
    });
    it('removes every trailing slash while preserving the root and internal slashes', () => {
        expect(canonicalizeBadgeUrl('https://example.com/a////')).toBe('https://example.com/a');
        expect(canonicalizeBadgeUrl('https://example.com////')).toBe('https://example.com/');
        expect(canonicalizeBadgeUrl('https://example.com/a//b/')).toBe('https://example.com/a//b');
    });
    it('enforces the API 2048-character limit before and after URL encoding', () => {
        const prefix = 'https://example.com/';
        expect(canonicalizeBadgeUrl(prefix + 'a'.repeat(2048 - prefix.length))).toHaveLength(2048);
        expect(canonicalizeBadgeUrl(prefix + 'a'.repeat(2049 - prefix.length))).toBeNull();
        expect(canonicalizeBadgeUrl(prefix + 'ą'.repeat(400))).toBeNull();
    });
});

describe('Python-produced snapshot', () => {
    const now = Date.parse('2026-10-10T13:00:00Z');
    it('survives API parsing, cache normalization and published rendering', () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const parsed = parseApiResponse(snapshot, { requestedUrl: snapshot.url, requestedSnapshotId: snapshot.public_id, now });
        expect(parsed).toMatchObject({ status: 'ready', score: 'A+', co2Grams: 0.09996 });
        const data = normalizeBadgeData(parsed)!;
        expect(data).toMatchObject({ status: 'ready', score: 'A+' });
        expect(buildBadgeMarkup(data, 'light', { allowPublished: true }).markup).toContain('Published by CometWeb');
    });
    it.each([
        ['measured_at', '2026-02-31T12:00:00.123456Z'],
        ['measured_at', '2026-10-10T14:00:00.123456Z'],
        ['valid_until', snapshot.measured_at],
        ['valid_until', '2026-10-10T12:00:00Z'],
    ])('withholds grades with unusable %s=%s', (field, value) => {
        expect(parseApiResponse({ ...snapshot, [field]: value }, { requestedUrl: snapshot.url, now })?.score).toBeNull();
    });
});
