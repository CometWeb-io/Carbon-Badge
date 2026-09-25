/** Public page identity never contains credentials, query parameters or a fragment. */
export function canonicalizeBadgeUrl(raw: string): string | null {
    try {
        const url = new URL((raw || '').trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        url.search = '';
        url.hash = '';
        if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
        return url.toString();
    } catch {
        return null;
    }
}
