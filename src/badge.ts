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
import { getStyleSheet } from './styles';
import {
    canonicalizeBadgeUrl,
    parseApiResponse,
    normalizeBadgeData,
    cloneBadgeData,
    clamp,
} from './normalize';

const DEFAULT_API_URL = 'https://app.cometweb.io/api';
const DEFAULT_CACHE_TTL = 720; // 12 hours in minutes
const MAX_RETRIES = 3;
const API_TIMEOUT_MS = 8000;
const LOG_PREFIX = '[CometWeb Carbon Badge]';
const DEFAULT_EVIDENCE_URL = 'https://cometweb.io/carbon-badge';
const SCORE_CLASS_MAP: Record<string, string> = {
    'A+': 'grade-aplus',
    A: 'grade-a',
    B: 'grade-b',
    C: 'grade-c',
    D: 'grade-d',
    F: 'grade-f',
};
const ALLOWED_THEMES = new Set<BadgeTheme>(['dark', 'light']);

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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

export class CometWebCarbonBadge extends HTMLElement {
    private shadow: ShadowRoot;
    private data: BadgeData | null = null;
    private retryCount = 0;
    private dataSource: BadgeData['source'] = 'api';
    private _loadId = 0;
    private _abort: AbortController | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    private _estimateTimer: ReturnType<typeof setTimeout> | null = null;
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
        this.abortInFlight();
        this.renderLoading();
        this.scheduleLoad();
    }

    static get observedAttributes() {
        return [
            'url',
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

    private get canonicalTargetUrl(): string | null {
        return canonicalizeBadgeUrl(this.rawTargetUrl);
    }

    private get mode(): BadgeMode {
        const m = this.getAttribute('mode');
        return m === 'estimate' ? 'estimate' : 'api';
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
        return this.getAttribute('api-key');
    }

    private get greenHost(): boolean {
        return this.getAttribute('green-host') === 'true';
    }

    private cacheKeyFor(canonicalUrl: string): string {
        return buildCacheKey({
            canonicalUrl,
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
        clearExpired(this.cacheTtl);
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
        this._loadId++;
        this._inFlight = false;
    }

    attributeChangedCallback() {
        if (this.isConnected) {
            this.scheduleLoad();
        }
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

    // --- Data loading ---

    private async loadData() {
        if (!this.isConnected) return;

        const loadId = ++this._loadId;
        const force = this._forceNext;
        this._forceNext = false;

        const canonical = this.canonicalTargetUrl;
        if (!canonical) {
            this.renderUnknown('Invalid or missing URL');
            return;
        }

        const cacheKey = this.cacheKeyFor(canonical);

        if (!force && isCacheValid(cacheKey, this.cacheTtl)) {
            const cached = normalizeBadgeData(getCached(cacheKey));
            if (cached && cached.co2Grams !== null) {
                if (loadId !== this._loadId || !this.isConnected) return;
                this.data = { ...cached, source: 'cache' };
                this.dataSource = 'cache';
                this.renderBadge();
                return;
            }
        }

        if (this.mode === 'estimate') {
            this.runEstimate(canonical, loadId);
            return;
        }

        await this.fetchFromAPI(canonical, cacheKey, loadId);
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
                setCache(this.cacheKeyFor(canonical), data);
                this.renderBadge();
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

        try {
            const params = new URLSearchParams({ url: canonical });
            params.set('source', 'badge');
            try {
                params.set('badge_origin', window.location.hostname);
            } catch {
                /* SSR */
            }

            const headers: Record<string, string> = {
                Accept: 'application/json',
            };
            if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

            const timeoutId = setTimeout(
                () => controller.abort(),
                API_TIMEOUT_MS,
            );

            let response: Response;
            try {
                response = await fetch(
                    `${this.apiUrl}/public/carbon-badge?${params}`,
                    { headers, signal: controller.signal },
                );
            } finally {
                clearTimeout(timeoutId);
            }

            if (loadId !== this._loadId || !this.isConnected) return;

            if (response.status === 429) {
                const retryAfter = parseInt(
                    response.headers.get('Retry-After') || '0',
                    10,
                );
                const delay =
                    retryAfter > 0
                        ? retryAfter * 1000
                        : Math.min(1000 * Math.pow(2, this.retryCount), 30000);

                if (this.retryCount < MAX_RETRIES) {
                    this.retryCount++;
                    this.renderLoading('Retrying after rate limit…');
                    setTimeout(() => {
                        if (loadId !== this._loadId) return;
                        void this.fetchFromAPI(canonical, cacheKey, loadId);
                    }, delay);
                    return;
                }

                console.warn(LOG_PREFIX, 'API rate limited; showing N/D.');
                this.renderUnknown('Rate limited — try again later');
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Timeout covers body + validate (CB-12)
            const apiData = (await response.json()) as APIResponse;
            if (loadId !== this._loadId || !this.isConnected) return;

            const parsed = parseApiResponse(apiData, {
                requestedUrl: canonical,
            });
            if (!parsed) {
                this.renderUnknown('No usable measurement');
                return;
            }

            this.data = parsed;
            this.dataSource = parsed.source;
            setCache(cacheKey, parsed);
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
                setTimeout(() => {
                    if (loadId !== this._loadId) return;
                    void this.fetchFromAPI(canonical, cacheKey, loadId);
                }, 400);
                return;
            }

            // CB-04: never fall back to host-page estimate for API failures.
            this.renderUnknown(
                isAbort ? 'Request timed out' : 'Unable to load measurement',
            );
        } finally {
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

    private renderLoading(label = 'Calculating carbon footprint\u2026') {
        this.updateStyles();
        const safeLabel = escapeHtml(label);
        this.shadow.innerHTML = `
      <div role="status" aria-live="polite" aria-label="${safeLabel}">
        <div class="cw-badge loading">
          <div class="cw-grade grade-unknown" aria-hidden="true">\u2026</div>
          <div class="cw-content">
            <div class="cw-title">Measuring\u2026</div>
            <div class="cw-subtitle">Estimating page-load footprint</div>
            <div class="cw-footer" aria-hidden="true">Powered by CometWeb</div>
          </div>
        </div>
      </div>
    `;
    }

    private evidenceHref(): string {
        const fromData = this.data?.evidenceUrl;
        if (fromData && /^https?:\/\//i.test(fromData)) return fromData;
        return DEFAULT_EVIDENCE_URL;
    }

    private renderBadge() {
        const normalized = normalizeBadgeData(this.data);
        if (!normalized || normalized.co2Grams === null || !normalized.score) {
            this.renderUnknown('No usable measurement');
            return;
        }
        this.data = normalized;

        const co2Grams = normalized.co2Grams;
        const score = normalized.score;
        const scoreClass = SCORE_CLASS_MAP[score] || 'grade-unknown';
        const co2Display =
            co2Grams < 0.01 ? '&lt;0.01' : escapeHtml(co2Grams.toFixed(2));
        const safeScore = escapeHtml(score);
        const isVerified = normalized.verified === true;
        const footerLabel = isVerified
            ? 'Verified by CometWeb'
            : 'Powered by CometWeb';

        let subtitleHtml: string;
        if (
            normalized.cleanerThan !== null &&
            Number.isFinite(normalized.cleanerThan)
        ) {
            const pct = escapeHtml(
                String(clamp(normalized.cleanerThan, 0, 100)),
            );
            subtitleHtml = `Cleaner than <span class="cw-highlight">${pct}%</span> of web`;
        } else if (normalized.source === 'estimate') {
            subtitleHtml = normalized.estimatePartial
                ? 'Local estimate (partial)'
                : 'Local SWDM v4 estimate';
        } else {
            subtitleHtml = 'Estimated page-load footprint';
        }

        const aria = `Carbon footprint: ${co2Grams.toFixed(2)}g CO\u2082e per visit, score ${score}`;
        const safeAria = escapeHtml(aria);
        const href = escapeHtml(this.evidenceHref());

        this.updateStyles();
        this.shadow.innerHTML = `
      <div role="status" aria-live="polite" aria-label="${safeAria}">
        <a class="cw-badge ${this.theme}"
           href="${href}"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="${safeAria} — CometWeb (opens in new tab)">
          <div class="cw-grade ${scoreClass}" aria-hidden="true">${safeScore}</div>
          <div class="cw-content">
            <div class="cw-title">${co2Display}g CO\u2082e <small>/ visit</small></div>
            <div class="cw-subtitle">${subtitleHtml}</div>
            <div class="cw-footer" aria-hidden="true">${footerLabel}</div>
          </div>
        </a>
      </div>
    `;
        this.dispatchBadgeEvent();
    }

    /** Honest N/D — never invent A+ from missing data (CB-01). */
    private renderUnknown(reason: string) {
        this.data = {
            url: this.canonicalTargetUrl || this.rawTargetUrl || '',
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
        this.updateStyles();
        const safeReason = escapeHtml(reason);
        this.shadow.innerHTML = `
      <div role="status" aria-live="polite" aria-label="Carbon footprint not available">
        <div class="cw-badge error">
          <div class="cw-grade grade-unknown" aria-hidden="true">N/D</div>
          <div class="cw-content">
            <div class="cw-title">Not available</div>
            <div class="cw-subtitle">${safeReason}</div>
            <div class="cw-error-actions">
              <button type="button" class="cw-retry-btn" aria-label="Retry carbon measurement">Retry</button>
            </div>
            <div class="cw-footer" aria-hidden="true">Powered by CometWeb</div>
          </div>
        </div>
      </div>
    `;
        this.dispatchEvent(
            new CustomEvent('cometweb:badge-error', {
                bubbles: true,
                composed: true,
                detail: {
                    url: this.canonicalTargetUrl || this.rawTargetUrl,
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
    if (typeof customElements === 'undefined') return null;
    if (!customElements.get('cometweb-carbon-badge')) {
        customElements.define('cometweb-carbon-badge', CometWebCarbonBadge);
    }
    return CometWebCarbonBadge;
}
