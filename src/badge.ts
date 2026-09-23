/**
 * @cometweb/carbon-badge — Main Web Component
 *
 * Attributes: url, snapshot-id, mode, theme, cache-ttl, green-host
 *
 * Honest Operator: missing CO₂ → N/D; remote URL never falls back to host-page
 * estimate; public identity strips query by default; API origin is pinned.
 */

import type {
    BadgeData,
    BadgeTheme,
    BadgeMode,
    ScoreLetter,
    APIResponse,
    MeasurementSource,
    RetrievalSource,
} from './types';
    import {
    getFreshCached,
    setCache,
    clearExpiredOnce,
    buildCacheKey,
} from './cache';
import { estimateCO2Detailed, initializeResourceTiming } from './estimator';
import { getStyleSheet, getStyles } from './styles';
import {
    canonicalizeBadgeUrl,
    parseApiResponse,
    normalizeBadgeData,
    cloneBadgeData,
    sanitizeAllowedQueryKeys,
} from './normalize';
import {
    API_TIMEOUT_MS,
    DEFAULT_API_URL,
    MAX_RETRIES,
    buildCarbonBadgeEndpoint,
    buildCarbonBadgeSnapshotEndpoint,
    calculateRetryDelay,
    fetchSingleFlight,
    isRetryableHttpStatus,
    parseRetryAfter,
    validateSnapshotId,
    validateApiUrl,
} from './api-client';
import {
    mountBadge,
    mountLoading,
    mountUnknown,
} from './render';
import { waitForPageQuiescence } from './page-quiescence';

const DEFAULT_CACHE_TTL = 720; // 12 hours in minutes
const MAX_CACHE_TTL = 1_440; // 24 hours
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
    private effectiveVerified = false;
    private measurementSource: MeasurementSource = 'api';
    private retrievalSource: RetrievalSource = 'network';
    private _loadId = 0;
    private _abort: AbortController | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    private _retryTimer: ReturnType<typeof setTimeout> | null = null;
    private _forceNext = false;

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
            'green-host',
            'allow-query',
        ];
    }

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: 'open' });
        try {
            this.shadow.adoptedStyleSheets = [getStyleSheet(this.theme)];
        } catch {
            /* SSR / no Constructable Stylesheets */
        }
    }

    private get rawTargetUrl(): string {
        return this.getAttribute('url') || currentPageUrl();
    }

    private get snapshotId(): string | null {
        const value = this.getAttribute('snapshot-id')?.trim();
        return value || null;
    }

    private get allowedQueryKeys(): string[] {
        const raw = this.getAttribute('allow-query')?.trim();
        if (!raw) return [];
        return sanitizeAllowedQueryKeys(
            raw.split(',').map((key) => key.trim()),
        );
    }

    private get canonicalTargetUrl(): string | null {
        return canonicalizeBadgeUrl(this.rawTargetUrl, this.allowedQueryKeys);
    }

    private get mode(): BadgeMode | null {
        const raw = this.getAttribute('mode')?.trim();
        if (!raw) {
            return this.snapshotId ? 'snapshot' : 'api';
        }
        if (raw === 'estimate' || raw === 'api' || raw === 'snapshot') {
            return raw;
        }
        return null;
    }

    private get theme(): BadgeTheme {
        const t = this.getAttribute('theme') as BadgeTheme;
        return ALLOWED_THEMES.has(t) ? t : 'dark';
    }

    private get cacheTtl(): number {
        const raw = this.getAttribute('cache-ttl');
        if (raw === null) return DEFAULT_CACHE_TTL;
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) return DEFAULT_CACHE_TTL;
        return Math.min(value, MAX_CACHE_TTL);
    }

    private get apiUrl(): string {
        return DEFAULT_API_URL.replace(/\/+$/, '');
    }

    private get greenHost(): boolean {
        return this.getAttribute('green-host') === 'true';
    }

    private cacheKeyFor(canonicalUrl: string, mode: BadgeMode): string {
        return buildCacheKey({
            canonicalUrl,
            snapshotId: this.snapshotId,
            mode,
            apiUrl: this.apiUrl,
            greenHost: this.greenHost,
        });
    }

    connectedCallback() {
        if (!this.hasAttribute('tabindex')) {
            this.setAttribute('tabindex', '-1');
        }
        this.renderLoading();
        clearExpiredOnce();
        this.scheduleLoad();
    }

    disconnectedCallback() {
        this.abortInFlight();
        if (this._scheduleTimer) {
            clearTimeout(this._scheduleTimer);
            this._scheduleTimer = null;
        }
        this.clearRetryTimer();
        this._loadId++;
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
        this.reload({ force: name === 'cache-ttl' });
    }

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

    private async loadData() {
        if (!this.isConnected) return;

        const loadId = ++this._loadId;
        this.retryCount = 0;
        const force = this._forceNext;
        this._forceNext = false;
        this.effectiveVerified = false;

        const mode = this.mode;
        if (!mode) {
            this.renderUnknown('Invalid badge mode');
            return;
        }

        if (mode === 'snapshot' && !this.snapshotId) {
            this.renderUnknown('Missing snapshot ID');
            return;
        }

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

        const cacheKey = this.cacheKeyFor(canonical || '', mode);
        const cacheEnabled = mode !== 'snapshot';

        if (cacheEnabled && !force) {
            const cached = normalizeBadgeData(
                getFreshCached(cacheKey, this.cacheTtl),
            );
            if (cached && cached.co2Grams !== null) {
                if (loadId !== this._loadId || !this.isConnected) return;
                this.data = cached;
                this.measurementSource = cached.source || 'api';
                this.retrievalSource = 'cache';
                this.renderBadge();
                return;
            }
        }

        if (mode === 'estimate') {
            if (!canonical) {
                this.renderUnknown('Invalid or missing URL');
                return;
            }
            await this.runEstimate(canonical, loadId);
            return;
        }

        await this.fetchFromAPI(canonical || '', cacheKey, loadId, mode);
    }

    private async runEstimate(canonical: string, loadId = this._loadId) {
        if (!samePageAsLocation(canonical) && this.getAttribute('url')) {
            if (loadId === this._loadId && this.isConnected) {
                console.warn(
                    LOG_PREFIX,
                    'Estimate mode measures the current page only; remote url cannot be estimated locally.',
                );
                this.renderUnknown('Local estimate requires the current page');
            }
            return;
        }

        this.abortInFlight();
        const controller = new AbortController();
        this._abort = controller;

        try {
            await waitForPageQuiescence(controller.signal);
            if (loadId !== this._loadId || !this.isConnected) return;

            const { data } = estimateCO2Detailed(this.greenHost);
            data.url = canonical;
            this.data = data;
            this.measurementSource = 'estimate';
            this.retrievalSource = 'local';
            if (data.co2Grams === null) {
                this.renderUnknown('Measurement unavailable');
            } else {
                setCache(this.cacheKeyFor(canonical, 'estimate'), data, this.cacheTtl);
                this.renderBadge();
            }
        } catch (error) {
            if (loadId !== this._loadId || !this.isConnected) return;
            const isAbort =
                error instanceof DOMException && error.name === 'AbortError';
            if (!isAbort) this.renderError();
        } finally {
            if (this._abort === controller) this._abort = null;
        }
    }

    private async fetchFromAPI(
        canonical: string,
        cacheKey: string,
        loadId = this._loadId,
        mode: BadgeMode = 'api',
    ) {
        this.abortInFlight();
        const controller = new AbortController();
        this._abort = controller;
        const cacheEnabled = mode !== 'snapshot';

        try {
            const apiUrl = validateApiUrl(this.apiUrl);
            let badgeOrigin = '';
            try {
                badgeOrigin = window.location.origin;
            } catch {
                /* SSR */
            }
            const endpoint =
                mode === 'snapshot'
                    ? buildCarbonBadgeSnapshotEndpoint(
                          apiUrl,
                          this.snapshotId || '',
                          badgeOrigin,
                      )
                    : buildCarbonBadgeEndpoint(apiUrl, canonical, badgeOrigin);

            const flightKey = endpoint.toString();
            const response = await fetchSingleFlight(
                flightKey,
                {
                    headers: { Accept: 'application/json' },
                    cache: mode === 'snapshot' ? 'no-cache' : 'default',
                },
                API_TIMEOUT_MS,
            );

            // Instance disconnected / superseded — shared flight may still finish.
            if (controller.signal.aborted) return;
            if (loadId !== this._loadId || !this.isConnected) return;

            if (!response.ok) {
                if (isRetryableHttpStatus(response.status)) {
                    const retryAfter = parseRetryAfter(response.retryAfter);
                    const delay = calculateRetryDelay(
                        this.retryCount,
                        retryAfter,
                    );

                    if (this.retryCount < MAX_RETRIES) {
                        this.retryCount++;
                        this.renderLoading(
                            response.status === 429
                                ? 'Retrying after rate limit…'
                                : 'Retrying…',
                        );
                        this.scheduleRetry(delay, () => {
                            if (loadId !== this._loadId) return;
                            void this.fetchFromAPI(
                                canonical,
                                cacheKey,
                                loadId,
                                mode,
                            );
                        });
                        return;
                    }

                    if (response.status === 429) {
                        console.warn(LOG_PREFIX, 'API rate limited; showing N/D.');
                        this.renderUnknown('Rate limited — try again later');
                        return;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                this.renderUnknown(
                    response.status === 404 && mode === 'snapshot'
                        ? 'Published snapshot not found'
                        : 'Measurement unavailable',
                );
                return;
            }

            let apiData: APIResponse;
            try {
                apiData = JSON.parse(response.bodyText) as APIResponse;
            } catch {
                this.renderUnknown('Malformed API response');
                return;
            }
            if (loadId !== this._loadId || !this.isConnected) return;

            const parsed = parseApiResponse(apiData, {
                requestedUrl: canonical,
                requestedSnapshotId:
                    mode === 'snapshot' ? this.snapshotId : null,
                allowedQueryKeys: this.allowedQueryKeys,
            });
            if (!parsed) {
                this.renderUnknown('No usable measurement');
                return;
            }

            this.data = parsed;
            this.measurementSource = parsed.source || 'api';
            this.retrievalSource = 'network';
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

            if (this.retryCount < 1 && !isAbort) {
                this.retryCount++;
                this.renderLoading('Retrying…');
                this.scheduleRetry(
                    calculateRetryDelay(this.retryCount - 1),
                    () => {
                        if (loadId !== this._loadId) return;
                        void this.fetchFromAPI(
                            canonical,
                            cacheKey,
                            loadId,
                            mode,
                        );
                    },
                );
                return;
            }

            this.renderUnknown(
                isAbort ? 'Request timed out' : 'Unable to load measurement',
            );
        } finally {
            if (this._abort === controller) this._abort = null;
        }
    }

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
                    source: this.measurementSource,
                    measurementSource: this.measurementSource,
                    retrievalSource: this.retrievalSource,
                    status: d.status,
                    formulaId: d.formulaId,
                    scoreModelId: d.scoreModelId,
                    measuredAt: d.measuredAt,
                    verified: this.effectiveVerified,
                    backendVerified: d.verified,
                    measuredResourceCount: d.measuredResourceCount,
                    unknownResourceCount: d.unknownResourceCount,
                    observableResourceRatio: d.observableResourceRatio,
                    coverageRatio: d.coverageRatio,
                    mode: this.mode,
                    publicId: d.publicId,
                },
            }),
        );
    }

    private updateStyles(): void {
        const supportsSheets =
            'adoptedStyleSheets' in this.shadow &&
            typeof CSSStyleSheet !== 'undefined' &&
            'replaceSync' in CSSStyleSheet.prototype;

        if (supportsSheets) {
            this.shadow.adoptedStyleSheets = [getStyleSheet(this.theme)];
            this.shadow
                .querySelector('style[data-cw-theme]')
                ?.remove();
            return;
        }

        let style = this.shadow.querySelector<HTMLStyleElement>(
            'style[data-cw-theme]',
        );
        if (!style) {
            style = document.createElement('style');
            style.dataset.cwTheme = '';
            this.shadow.prepend(style);
        }
        style.textContent = getStyles(this.theme);
    }

    private prepareShadow(keepStyles: boolean): { keepStyles: boolean } {
        const supportsSheets =
            'adoptedStyleSheets' in this.shadow &&
            typeof CSSStyleSheet !== 'undefined' &&
            'replaceSync' in CSSStyleSheet.prototype;
        this.updateStyles();
        if (supportsSheets) {
            return { keepStyles: false };
        }
        let style = this.shadow.querySelector<HTMLStyleElement>(
            'style[data-cw-theme]',
        );
        if (!style) {
            style = document.createElement('style');
            style.dataset.cwTheme = '';
            this.shadow.prepend(style);
        }
        style.textContent = getStyles(this.theme);
        return { keepStyles };
    }

    private renderLoading(label = 'Calculating carbon footprint\u2026') {
        const opts = this.prepareShadow(true);
        mountLoading(this.shadow, label, opts);
    }

    private renderBadge() {
        const normalized = normalizeBadgeData(this.data);
        if (
            !normalized ||
            normalized.co2Grams === null ||
            !normalized.score ||
            normalized.status === 'partial' ||
            normalized.status === 'stale'
        ) {
            this.renderUnknown(
                normalized?.status === 'partial'
                    ? 'Partial measurement — grade withheld'
                    : 'No usable measurement',
            );
            return;
        }
        this.data = normalized;
        const opts = this.prepareShadow(true);
        const model = mountBadge(this.shadow, normalized, this.theme, {
            ...opts,
            trust: {
                allowVerified: this.retrievalSource === 'network',
            },
        });
        this.effectiveVerified = model.verified;
        this.dispatchBadgeEvent();
    }

    private renderUnknown(reason: string) {
        this.effectiveVerified = false;
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
            source: null,
            formulaId: null,
            scoreModelId: null,
            measurementMethod: null,
            measuredAt: null,
            validUntil: null,
            evidenceUrl: null,
        };
        const opts = this.prepareShadow(true);
        mountUnknown(this.shadow, reason, opts);
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
        const btn =
            this.shadow.querySelector<HTMLButtonElement>('.cw-retry-btn');
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

/** SSR-safe registration (CB-03). Returns the registered constructor. */
export function registerCarbonBadge(): CustomElementConstructor | null {
    if (
        typeof HTMLElement === 'undefined' ||
        typeof customElements === 'undefined'
    ) {
        return null;
    }
    initializeResourceTiming();
    const existing = customElements.get('cometweb-carbon-badge');
    if (existing) return existing;
    customElements.define('cometweb-carbon-badge', CometWebCarbonBadge);
    return CometWebCarbonBadge;
}
