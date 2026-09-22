/**
 * @cometweb/carbon-badge — Main Web Component
 *
 * Attributes: url, mode ("api"|"estimate"), theme ("dark"|"light"),
 *   cache-ttl, api-url, api-key, green-host
 *
 * Honest Operator: missing CO₂ → N/D (never A+ from 0); remote URL never
 * falls back to host-page estimate; cache keys include mode/api/green/schema.
 */

import type {
    BadgeData,
    BadgeTheme,
    BadgeMode,
    ScoreLetter,
    APIResponse,
} from './types';
import {
    getCached,
    isCacheValid,
    setCache,
    clearExpired,
    buildCacheKey,
} from './cache';
import { estimateCO2Detailed, co2ToScore } from './estimator';
import { getStyleSheet, getStyles } from './styles';
import {
    canonicalizeBadgeUrl,
    parseApiResponse,
    normalizeBadgeData,
    cloneBadgeData,
} from './normalize';
import {
    API_TIMEOUT_MS,
    DEFAULT_API_URL,
    MAX_RETRIES,
    buildCarbonBadgeEndpoint,
    buildCarbonBadgeSnapshotEndpoint,
    isRetryableHttpStatus,
    parseRetryAfter,
    validateSnapshotId,
    validateApiUrl,
} from './api-client';
import {
    buildBadgeMarkup,
    buildLoadingMarkup,
    buildUnknownMarkup,
} from './render';

const DEFAULT_CACHE_TTL = 720; // 12 hours in minutes
const LOG_PREFIX = '[CometWeb Carbon Badge]';
const ALLOWED_THEMES = new Set<BadgeTheme>(['dark', 'light']);

function currentPageUrl(): string {
    try {
        return typeof location !== 'undefined' ? location.href : '';
    } catch {
        return '';
    }
}

function samePageAsLocation(canonical: string): boolean {
    const page = canonicalizeBadgeUrl(currentPageUrl());
    return Boolean(page && page === canonical);
}

const HTMLElementBase: typeof HTMLElement =
    typeof HTMLElement === 'undefined'
        ? (class {} as unknown as typeof HTMLElement)
        : HTMLElement;

export class CometWebCarbonBadge extends HTMLElementBase {
    private shadow: ShadowRoot;
    private data: BadgeData | null = null;
    private retryCount = 0;
    private dataSource: BadgeData['source'] = 'api';
    private _loadId = 0;
    private _abort: AbortController | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    private _estimateTimer: ReturnType<typeof setTimeout> | null = null;
    private _retryTimer: ReturnType<typeof setTimeout> | null = null;
    private _inFlight = false;
    private _forceNext = false;

    // --- Public API (getters return copies — CB-06) ---

    get badgeData(): BadgeData | null {
        return this.data ? cloneBadgeData(this.data) : null;
    }
    get co2Grams(): number | null {
        return this.data?.co2Grams ?? null;
    }
    get score(): ScoreLetter | null {
        return this.data?.score ?? null;
    }
    get cleanerThan(): number | null {
        return this.data?.cleanerThan ?? null;
    }
    get pageWeightKb(): number | null {
        return this.data?.pageWeightKb ?? null;
    }
    get measurementStatus(): BadgeData['status'] | null {
        return this.data?.status ?? null;
    }

    reload(options?: { force?: boolean }): void {
        this.retryCount = 0;
        this.data = null;
        this._forceNext = options?.force === true;
        this._loadId++;
        this.clearRetryTimer();
        this.abortInFlight();
        this.renderLoading();
        this.scheduleLoad();
    }

    static get observedAttributes() {
        return [
            'url',
            'snapshot-id',
            'mode',
            'theme',
            'cache-ttl',
            'api-url',
            'api-key',
            'green-host',
        ];
    }

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: 'open' });
        // Do NOT set tabindex in constructor — breaks createElement after define (CB-02).
        try {
            this.shadow.adoptedStyleSheets = [getStyleSheet(this.theme)];
        } catch {
            /* SSR / no Constructable Stylesheets */
        }
    }

    // --- Attribute helpers ---

    private get rawTargetUrl(): string {
        return this.getAttribute('url') || currentPageUrl();
    }

    private get snapshotId(): string | null {
        const value = this.getAttribute('snapshot-id')?.trim();
        return value || null;
    }

    private get canonicalTargetUrl(): string | null {
        return canonicalizeBadgeUrl(this.rawTargetUrl);
    }

    private get mode(): BadgeMode {
        const m = this.getAttribute('mode');
        if (m === 'estimate') return 'estimate';
        if (m === 'api') return 'api';
        return this.snapshotId ? 'snapshot' : 'api';
    }

    private get theme(): BadgeTheme {
        const t = this.getAttribute('theme') as BadgeTheme;
        return ALLOWED_THEMES.has(t) ? t : 'dark';
    }

    private get cacheTtl(): number {
        const val = this.getAttribute('cache-ttl');
        const n = val ? parseInt(val, 10) : DEFAULT_CACHE_TTL;
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL;
    }

    private get apiUrl(): string {
        const configured = this.getAttribute('api-url');
        return (configured?.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
    }

    private get apiKey(): string | null {
        const value = this.getAttribute('api-key')?.trim();
        return value || null;
    }

    private get greenHost(): boolean {
        return this.getAttribute('green-host') === 'true';
    }

    private cacheKeyFor(canonicalUrl: string): string {
        return buildCacheKey({
            canonicalUrl,
            snapshotId: this.snapshotId,
            mode: this.mode,
            apiUrl: this.apiUrl,
            greenHost: this.greenHost,
        });
    }

    // --- Lifecycle ---

    connectedCallback() {
        if (!this.hasAttribute('tabindex')) {
            this.setAttribute('tabindex', '-1');
        }
        this.renderLoading();
        clearExpired();
        this.scheduleLoad();
    }

    disconnectedCallback() {
        this.abortInFlight();
        if (this._scheduleTimer) {
            clearTimeout(this._scheduleTimer);
            this._scheduleTimer = null;
        }
        if (this._estimateTimer) {
            clearTimeout(this._estimateTimer);
            this._estimateTimer = null;
        }
        this.clearRetryTimer();
        this._loadId++;
        this._inFlight = false;
    }

    attributeChangedCallback(
        name: string,
        oldValue: string | null,
        newValue: string | null,
    ) {
        if (!this.isConnected || oldValue === newValue) return;
        if (name === 'theme') {
            this.updateStyles();
            return;
        }
        this._loadId++;
        this.retryCount = 0;
        this.clearRetryTimer();
        this.abortInFlight();
        this.scheduleLoad();
    }

    /** Debounce connected + attributeChanged into a single load (CB-11). */
    private scheduleLoad() {
        if (this._scheduleTimer) clearTimeout(this._scheduleTimer);
        this._scheduleTimer = setTimeout(() => {
            this._scheduleTimer = null;
            void this.loadData();
        }, 0);
    }

    private abortInFlight() {
        if (this._abort) {
            this._abort.abort();
            this._abort = null;
        }
    }

    private clearRetryTimer(): void {
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
    }

    private scheduleRetry(delay: number, callback: () => void): void {
        this.clearRetryTimer();
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            callback();
        }, Math.min(Math.max(delay, 0), 30_000));
    }

    // --- Data loading ---

    private async loadData() {
        if (!this.isConnected) return;

        const loadId = ++this._loadId;
        this.retryCount = 0;
        const force = this._forceNext;
        this._forceNext = false;

        const mode = this.mode;
        const canonical = this.canonicalTargetUrl;
        if (mode !== 'snapshot' && !canonical) {
            this.renderUnknown('Invalid or missing URL');
            return;
        }

        if (mode === 'snapshot') {
            try {
                validateSnapshotId(this.snapshotId || '');
            } catch {
                this.renderUnknown('Invalid snapshot ID');
                return;
            }
        }

        const cacheKey = this.cacheKeyFor(canonical || '');
        const cacheEnabled = this.apiKey === null && mode !== 'snapshot';

        if (cacheEnabled && !force && isCacheValid(cacheKey)) {
            const cached = normalizeBadgeData(getCached(cacheKey));
            if (cached && cached.co2Grams !== null) {
                if (loadId !== this._loadId || !this.isConnected) return;
                // Keep the measurement source intact for provenance-aware rendering;
                // `dataSource` separately records that this render came from cache.
                this.data = cached;
                this.dataSource = 'cache';
                this.renderBadge();
                return;
            }
        }

        if (mode === 'estimate') {
            if (!canonical) {
                this.renderUnknown('Invalid or missing URL');
                return;
            }
            this.runEstimate(canonical, loadId);
            return;
        }

        await this.fetchFromAPI(canonical || '', cacheKey, loadId);
    }

    /**
     * Local estimate only for the current page (or explicit estimate mode).
     * Never used as silent fallback for a remote `url` (CB-04).
     */
    private runEstimate(canonical: string, loadId = this._loadId) {
        if (!samePageAsLocation(canonical) && this.getAttribute('url')) {
            // Explicit remote url in estimate mode: still only measure *this* document —
            // show unknown rather than mis-label host weight as the remote URL.
            if (loadId === this._loadId && this.isConnected) {
                console.warn(
                    LOG_PREFIX,
                    'Estimate mode measures the current page only; remote url cannot be estimated locally.',
                );
                this.renderUnknown('Local estimate requires the current page');
            }
            return;
        }

        if (this._estimateTimer) clearTimeout(this._estimateTimer);
        this._estimateTimer = setTimeout(() => {
            this._estimateTimer = null;
            if (loadId !== this._loadId || !this.isConnected) return;
            try {
                const { data } = estimateCO2Detailed(this.greenHost);
                data.url = canonical;
                this.data = data;
                this.dataSource = 'estimate';
                if (data.co2Grams === null) {
                    this.renderUnknown('Measurement unavailable');
                } else {
                    if (this.apiKey === null) {
                        setCache(this.cacheKeyFor(canonical), data, this.cacheTtl);
                    }
                    this.renderBadge();
                }
            } catch {
                this.renderError();
            }
        }, 0);
    }

    private async fetchFromAPI(
        canonical: string,
        cacheKey: string,
        loadId = this._loadId,
    ) {
        if (this._inFlight && loadId === this._loadId) {
            // Single-flight: a newer schedule already bumped _loadId
        }
        this.abortInFlight();
        const controller = new AbortController();
        this._abort = controller;
        this._inFlight = true;
        const cacheEnabled = this.apiKey === null && this.mode !== 'snapshot';

        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
        try {
            const apiUrl = validateApiUrl(this.apiUrl, this.apiKey);
            let badgeOrigin = '';
            try {
                badgeOrigin = window.location.origin;
            } catch {
                /* SSR */
            }
            const endpoint =
                this.mode === 'snapshot'
                    ? buildCarbonBadgeSnapshotEndpoint(
                          apiUrl,
                          this.snapshotId || '',
                          badgeOrigin,
                      )
                    : buildCarbonBadgeEndpoint(apiUrl, canonical, badgeOrigin);

            const headers: Record<string, string> = {
                Accept: 'application/json',
            };
            if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

            const requestInit: RequestInit = {
                headers,
                signal: controller.signal,
                ...(this.mode === 'snapshot' ? { cache: 'no-store' } : {}),
            };
            const response = await fetch(endpoint, requestInit);

            if (loadId !== this._loadId || !this.isConnected) return;

            if (response.status === 429) {
                const retryAfter = parseRetryAfter(
                    response.headers.get('Retry-After'),
                );
                const delay =
                    retryAfter > 0
                        ? retryAfter
                        : Math.min(1000 * Math.pow(2, this.retryCount), 30000);

                if (this.retryCount < MAX_RETRIES) {
                    this.retryCount++;
                    this.renderLoading('Retrying after rate limit…');
                    this.scheduleRetry(delay, () => {
                        if (loadId !== this._loadId) return;
                        void this.fetchFromAPI(canonical, cacheKey, loadId);
                    });
                    return;
                }

                console.warn(LOG_PREFIX, 'API rate limited; showing N/D.');
                this.renderUnknown('Rate limited — try again later');
                return;
            }

            if (!response.ok) {
                if (!isRetryableHttpStatus(response.status)) {
                    this.renderUnknown(
                        response.status === 404 && this.mode === 'snapshot'
                            ? 'Published snapshot not found'
                            : 'Measurement unavailable',
                    );
                    return;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            // Timeout covers body + validate (CB-12)
            const apiData = (await response.json()) as APIResponse;
            if (loadId !== this._loadId || !this.isConnected) return;

            const parsed = parseApiResponse(apiData, {
                requestedUrl: canonical,
                requestedSnapshotId: this.mode === 'snapshot' ? this.snapshotId : null,
            });
            if (!parsed) {
                this.renderUnknown('No usable measurement');
                return;
            }

            this.data = parsed;
            this.dataSource = parsed.source;
            if (cacheEnabled) setCache(cacheKey, parsed, this.cacheTtl);
            this.retryCount = 0;
            this.renderBadge();
        } catch (error) {
            if (loadId !== this._loadId || !this.isConnected) return;
            const isAbort =
                error instanceof DOMException && error.name === 'AbortError';
            if (isAbort) {
                console.warn(LOG_PREFIX, 'API request timed out.');
            }

            // Network / HTTP errors: limited retry then N/D — never host-page estimate (CB-04).
            if (this.retryCount < 1 && !isAbort) {
                this.retryCount++;
                this.renderLoading('Retrying…');
                this.scheduleRetry(400, () => {
                    if (loadId !== this._loadId) return;
                    void this.fetchFromAPI(canonical, cacheKey, loadId);
                });
                return;
            }

            // CB-04: never fall back to host-page estimate for API failures.
            this.renderUnknown(
                isAbort ? 'Request timed out' : 'Unable to load measurement',
            );
        } finally {
            clearTimeout(timeoutId);
            if (this._abort === controller) this._abort = null;
            this._inFlight = false;
        }
    }

    // --- Events ---

    private dispatchBadgeEvent() {
        if (!this.data) return;
        const d = cloneBadgeData(this.data);
        this.dispatchEvent(
            new CustomEvent('cometweb:badge-load', {
                bubbles: true,
                composed: true,
                detail: {
                    url: d.url,
                    co2Grams: d.co2Grams,
                    score: d.score,
                    cleanerThan: d.cleanerThan,
                    pageWeightKb: d.pageWeightKb,
                    greenHost: d.greenHost,
                    source: this.dataSource,
                    status: d.status,
                    formulaId: d.formulaId,
                    measuredAt: d.measuredAt,
                    verified: d.verified,
                    measuredResourceCount: d.measuredResourceCount,
                    unknownResourceCount: d.unknownResourceCount,
                    coverageRatio: d.coverageRatio,
                    mode: this.mode,
                    publicId: d.publicId,
                },
            }),
        );
    }

    // --- Render methods ---

    private updateStyles() {
        try {
            this.shadow.adoptedStyleSheets = [getStyleSheet(this.theme)];
        } catch {
            /* ignore */
        }
    }

    private setMarkup(markup: string): void {
        const supportsSheets =
            'adoptedStyleSheets' in this.shadow &&
            typeof CSSStyleSheet !== 'undefined' &&
            'replaceSync' in CSSStyleSheet.prototype;
        this.updateStyles();
        this.shadow.innerHTML = supportsSheets
            ? markup
            : `<style>${getStyles(this.theme)}</style>${markup}`;
    }

    private renderLoading(label = 'Calculating carbon footprint\u2026') {
        this.setMarkup(buildLoadingMarkup(label));
    }

    private renderBadge() {
        const normalized = normalizeBadgeData(this.data);
        if (!normalized || normalized.co2Grams === null || !normalized.score) {
            this.renderUnknown('No usable measurement');
            return;
        }
        this.data = normalized;
        this.setMarkup(buildBadgeMarkup(normalized, this.theme).markup);
        this.dispatchBadgeEvent();
    }

    /** Honest N/D — never invent A+ from missing data (CB-01). */
    private renderUnknown(reason: string) {
        this.data = {
            url: this.canonicalTargetUrl || '',
            publicId: null,
            co2Grams: null,
            score: null,
            cleanerThan: null,
            pageWeightKb: null,
            greenHost: null,
            verified: false,
            timestamp: Date.now(),
            status: 'unknown',
            source: 'api',
            formulaId: null,
            measurementMethod: null,
            measuredAt: null,
            validUntil: null,
            evidenceUrl: null,
        };
        this.setMarkup(buildUnknownMarkup(reason));
        this.dispatchEvent(
            new CustomEvent('cometweb:badge-error', {
                bubbles: true,
                composed: true,
                detail: {
                    url: this.canonicalTargetUrl || '',
                    mode: this.mode,
                    reason,
                    status: 'unknown',
                },
            }),
        );
        this.bindRetry();
    }

    private renderError() {
        this.renderUnknown('Unable to calculate');
    }

    private bindRetry() {
        const btn = this.shadow.querySelector<HTMLButtonElement>('.cw-retry-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                this.retryCount = 0;
                this.renderLoading();
                this.reload({ force: true });
                this.focus();
            });
        }
    }
}

/** SSR-safe registration (CB-03). */
export function registerCarbonBadge(): typeof CometWebCarbonBadge | null {
    if (
        typeof HTMLElement === 'undefined' ||
        typeof customElements === 'undefined'
    ) {
        return null;
    }
    if (!customElements.get('cometweb-carbon-badge')) {
        customElements.define('cometweb-carbon-badge', CometWebCarbonBadge);
    }
    return CometWebCarbonBadge;
}
