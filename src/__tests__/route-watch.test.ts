import { afterEach, expect, it, vi } from 'vitest';
import { watchDocumentRoute } from '../route-watch';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('shares one timer and removes it only after the final subscriber leaves', () => {
    vi.useFakeTimers();
    const location = { href: 'https://example.com/' };
    vi.stubGlobal('location', location);
    const a = vi.fn(), b = vi.fn();
    const stopA = watchDocumentRoute(a), stopB = watchDocumentRoute(b);
    expect(vi.getTimerCount()).toBe(1);
    location.href = 'https://example.com/?route=2';
    vi.advanceTimersByTime(1_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    location.href += '#anchor';
    window.dispatchEvent(new Event('hashchange'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1_000);
    expect(b).toHaveBeenCalledTimes(2);
    stopB(); stopB();
    expect(vi.getTimerCount()).toBe(0);
    const stopC = watchDocumentRoute(a);
    window.dispatchEvent(new Event('popstate'));
    expect(a).toHaveBeenCalledTimes(1);
    stopC();
});

it('does not lose other subscribers when a route callback reconnects itself', () => {
    vi.useFakeTimers();
    const location = { href: 'https://example.com/' };
    vi.stubGlobal('location', location);
    let stopA: () => void;
    const a = vi.fn(() => { stopA(); stopA = watchDocumentRoute(a); });
    const b = vi.fn();
    stopA = watchDocumentRoute(a);
    const stopB = watchDocumentRoute(b);
    location.href += '#route';
    window.dispatchEvent(new Event('popstate'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    stopA(); stopB();
});
