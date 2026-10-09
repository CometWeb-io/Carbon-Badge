import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRemoteMeasurement, type RemoteOptions } from '../remote';
import { clearInFlightRequests } from '../api-client';
import { resetCleanupFlag } from '../cache';

const options: RemoteOptions = { canonicalUrl: 'https://example.com/', snapshotId: 'abcdef', mode: 'snapshot', cacheTtl: 720, greenHost: false, force: false, badgeOrigin: 'https://example.com' };
const response = (status: number, length?: string) => ({ ok: status === 200, status, headers: new Headers(length ? { 'Content-Length': length } : {}), text: async () => '{}' });
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetCleanupFlag(); });
afterEach(() => { clearInFlightRequests(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('aborts retry backoff on disconnect and does not send another request', async () => {
    const fetch = vi.fn(async () => response(429)); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const retried = vi.fn(() => controller.abort());
    await expect(loadRemoteMeasurement(options, controller.signal, retried)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(retried).toHaveBeenCalledWith('Retrying after rate limit…');
});

it('keeps the HTTP retry budget bounded', async () => {
    const fetch = vi.fn(async () => response(503)); vi.stubGlobal('fetch', fetch);
    const result = loadRemoteMeasurement(options, new AbortController().signal, vi.fn());
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ reason: 'Unable to load measurement' });
    expect(fetch).toHaveBeenCalledTimes(4);
});

it('rejects an oversized response without retries', async () => {
    const fetch = vi.fn(async () => response(200, '65537')); vi.stubGlobal('fetch', fetch);
    const onRetry = vi.fn();
    expect(await loadRemoteMeasurement(options, new AbortController().signal, onRetry)).toEqual({ reason: 'Measurement response too large' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
});

it('does not touch host storage or fetch for an already aborted caller', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const controller = new AbortController(); controller.abort();
    await expect(loadRemoteMeasurement({ ...options, mode: 'api' }, controller.signal, vi.fn())).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    read.mockRestore();
});
