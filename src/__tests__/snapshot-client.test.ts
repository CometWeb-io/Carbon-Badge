import { describe, expect, it } from 'vitest';
import {
    buildCarbonBadgeSnapshotEndpoint,
    validateSnapshotId,
} from '../api-client';

describe('snapshot client helpers', () => {
    it('normalizes valid public IDs and rejects unsafe IDs', () => {
        expect(validateSnapshotId(' ABCDEF0123 ')).toBe('abcdef0123');
        expect(() => validateSnapshotId('cb_public_123')).toThrow(
            'Invalid Carbon Badge snapshot ID',
        );
        expect(() => validateSnapshotId('abc/def')).toThrow(
            'Invalid Carbon Badge snapshot ID',
        );
        expect(() => validateSnapshotId('')).toThrow(
            'Invalid Carbon Badge snapshot ID',
        );
    });

    it('builds the cheap published-snapshot endpoint', () => {
        const endpoint = buildCarbonBadgeSnapshotEndpoint(
            new URL('https://app.cometweb.io/api'),
            'ABCDEF0123',
            'https://publisher.test',
        );

        expect(endpoint.pathname).toBe('/api/public/carbon-badge/id/abcdef0123');
        expect(endpoint.searchParams.get('source')).toBe('badge');
        expect(endpoint.searchParams.get('badge_origin')).toBe(
            'https://publisher.test',
        );
    });
});
