/**
 * Wait until the document has finished loading and Resource Timing is quiet
 * long enough to capture late first-load assets without waiting forever.
 */

export async function waitForPageQuiescence(
    signal: AbortSignal,
    quietMs = 500,
    maxWaitMs = 2_500,
): Promise<void> {
    if (typeof document !== 'undefined' && document.readyState !== 'complete') {
        await new Promise<void>((resolve, reject) => {
            const onLoad = () => {
                cleanup();
                resolve();
            };
            const onAbort = () => {
                cleanup();
                reject(new DOMException('Measurement aborted', 'AbortError'));
            };
            const cleanup = () => {
                window.removeEventListener('load', onLoad);
                signal.removeEventListener('abort', onAbort);
            };
            window.addEventListener('load', onLoad, { once: true });
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
        });
    }

    await new Promise<void>((resolve) => {
        let quietTimer: ReturnType<typeof setTimeout>;
        let hardTimer: ReturnType<typeof setTimeout>;
        let observer: PerformanceObserver | null = null;

        const done = () => {
            clearTimeout(quietTimer);
            clearTimeout(hardTimer);
            observer?.disconnect();
            signal.removeEventListener('abort', onAbort);
            resolve();
        };
        const onAbort = () => done();

        try {
            observer = new PerformanceObserver(() => {
                clearTimeout(quietTimer);
                quietTimer = setTimeout(done, quietMs);
            });
            observer.observe({ type: 'resource', buffered: true });
        } catch {
            /* PerformanceObserver unavailable */
        }

        quietTimer = setTimeout(done, quietMs);
        hardTimer = setTimeout(done, maxWaitMs);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) done();
    });
}
