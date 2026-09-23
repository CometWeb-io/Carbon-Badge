import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForPageQuiescence } from '../page-quiescence';

describe('waitForPageQuiescence', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves quickly when document is already complete', async () => {
        vi.stubGlobal('document', { readyState: 'complete' });
        const controller = new AbortController();
        await expect(
            waitForPageQuiescence(controller.signal, 10, 200),
        ).resolves.toBeUndefined();
    });

    it('rejects when aborted during quiet wait', async () => {
        vi.stubGlobal('document', { readyState: 'complete' });
        const controller = new AbortController();
        const pending = waitForPageQuiescence(controller.signal, 5_000, 5_000);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects when the overall deadline elapses before load', async () => {
        vi.stubGlobal('document', { readyState: 'loading' });
        const add = vi.fn();
        const remove = vi.fn();
        vi.stubGlobal('window', {
            addEventListener: add,
            removeEventListener: remove,
        });
        const controller = new AbortController();
        await expect(
            waitForPageQuiescence(controller.signal, 10, 20),
        ).rejects.toThrow(/deadline/i);
    });
});
