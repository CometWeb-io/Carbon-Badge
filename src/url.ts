/** Public page identity never contains credentials, query parameters or a fragment. */
export function canonicalizeBadgeUrl(raw: string): string | null {
    try {
        if (typeof raw !== 'string' || raw.length > 4_096) return null;
        const url = new URL((raw || '').trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        url.search = '';
        url.hash = '';
        if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
        const canonical = url.toString();
        return canonical.length <= 4_096 ? canonical : null;
    } catch {
        return null;
    }
}

const ALLOWED_EVIDENCE_ORIGINS = new Set(['https://cometweb.io', 'https://app.cometweb.io']);

/**
 * Evidence URL must be HTTPS, credential-free, on an allowlisted origin,
 * and (when a publicId is known) bound to `/carbon-badge/{publicId}` with
 * no query or fragment.
 */
export function trustedEvidenceUrl(
    raw: string | null | undefined,
    publicId: string | null = null,
): URL | null {
    if (!raw || typeof raw !== 'string' || raw.length > 4_096) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return null;
        if (url.username || url.password || url.search || url.hash) return null;
        if (!ALLOWED_EVIDENCE_ORIGINS.has(url.origin)) return null;

        if (publicId) {
            const expectedPath = `/carbon-badge/${encodeURIComponent(publicId.toLowerCase())}`;
            if (url.pathname !== expectedPath) return null;
        }

        return url;
    } catch {
        return null;
    }
}

const SNAPSHOT_ID_PATTERN = /^[a-f0-9]{1,64}$/i;

export function validateSnapshotId(raw: string): string {
    if (typeof raw !== 'string' || raw.length > 64) throw new Error('Invalid Carbon Badge snapshot ID');
    const snapshotId = raw.trim().toLowerCase();
    if (!SNAPSHOT_ID_PATTERN.test(snapshotId)) {
        throw new Error('Invalid Carbon Badge snapshot ID');
    }
    return snapshotId;
}
