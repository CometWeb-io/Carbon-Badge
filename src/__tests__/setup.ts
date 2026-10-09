import { beforeEach, vi } from 'vitest';

// The DOM simulator has no viewport geometry; lazy visibility is exercised by Playwright.
beforeEach(() => vi.stubGlobal('IntersectionObserver', undefined));

// Block real network calls globally. Tests override per-scenario with mockResolvedValueOnce.
vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('[test] Unmocked fetch — add mockFetch.mockResolvedValueOnce(...)')),
);
