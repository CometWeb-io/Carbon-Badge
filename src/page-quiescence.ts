/**
 * Wait until the document has finished loading and Resource Timing is quiet
 * long enough to capture late first-load assets — bounded by a single deadline.
 */

function timeoutError(): Error {
    return new Error('Page did not become measurable before deadline');
}

export async function waitForPageQuiescence(
    signal: AbortSignal,
    quietMs = 500,
    maxWaitMs = 2_500,
): Promise<void> {
    const started = performance.now();
    const remaining = (): number =>
        Math.max(0, maxWaitMs - (performance.now() - started));

    if (typeof document !== 'undefined' && document.readyState !== 'complete') {
        await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timer);
                window.removeEventListener('load', onLoad);
                signal.removeEventListener('abort', onAbort);
            };

            const onLoad = () => {
                cleanup();
                resolve();
            };

            const onAbort = () => {
                cleanup();
                reject(new DOMException('Measurement aborted', 'AbortError'));
            };

            const timer = setTimeout(() => {
                cleanup();
                reject(timeoutError());
            }, remaining());

            window.addEventListener('load', onLoad, { once: true });
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
        });
    }

    const hardRemaining = remaining();
    if (hardRemaining <= 0) throw timeoutError();

    await new Promise<void>((resolve, reject) => {
        let quietTimer: ReturnType<typeof setTimeout>;
        let hardTimer: ReturnType<typeof setTimeout>;
        let observer: PerformanceObserver | null = null;

        const cleanup = () => {
            clearTimeout(quietTimer);
            clearTimeout(hardTimer);
            observer?.disconnect();
            signal.removeEventListener('abort', onAbort);
        };

        const done = () => {
            cleanup();
            resolve();
        };

        const onAbort = () => {
            cleanup();
            reject(new DOMException('Measurement aborted', 'AbortError'));
        };

        const onHardTimeout = () => {
            cleanup();
            reject(timeoutError());
        };

        try {
            observer = new PerformanceObserver(() => {
                clearTimeout(quietTimer);
                quietTimer = setTimeout(done, quietMs);
            });
            observer.observe({ type: 'resource', buffered: true });
        } catch {
            /* PerformanceObserver unavailable */
        }

        quietTimer = setTimeout(done, Math.min(quietMs, hardRemaining));
        hardTimer = setTimeout(onHardTimeout, hardRemaining);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
}
