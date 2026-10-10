const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let observedUrl = '';

function checkRoute(): void {
    const nextUrl = location.href;
    if (nextUrl === observedUrl) return;
    observedUrl = nextUrl;
    for (const callback of [...subscribers]) callback();
}

/** One observer per module/document; never patch the host's History methods. */
export function watchDocumentRoute(callback: () => void): () => void {
    subscribers.add(callback);
    if (timer === null) {
        observedUrl = location.href;
        window.addEventListener('popstate', checkRoute);
        window.addEventListener('hashchange', checkRoute);
        // shortcut: background tabs throttle polling; SPA hosts can call reload() immediately.
        timer = setInterval(checkRoute, 1_000);
    }
    return () => {
        subscribers.delete(callback);
        if (subscribers.size || timer === null) return;
        clearInterval(timer);
        timer = null;
        window.removeEventListener('popstate', checkRoute);
        window.removeEventListener('hashchange', checkRoute);
    };
}
