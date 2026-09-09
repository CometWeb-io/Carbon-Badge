/**
 * @cometweb/carbon-badge — Main Web Component
 *
 * Attributes: url, mode ("api"|"estimate"), theme ("dark"|"light"),
 *   cache-ttl, api-url, api-key, green-host
 */

import type { BadgeData, BadgeTheme, BadgeMode, ScoreLetter, APIResponse } from './types';
import { getCached, isCacheValid, setCache, clearExpired } from './cache';
import { estimateCO2, co2ToScore } from './estimator';
import { getStyleSheet } from './styles';

const DEFAULT_API_URL = 'https://app.cometweb.io/api';
const DEFAULT_CACHE_TTL = 720; // 12 hours in minutes
const MAX_RETRIES = 3;
const API_TIMEOUT_MS = 5000;
const LOG_PREFIX = '[CometWeb Carbon Badge]';
const SCORE_CLASS_MAP: Record<string, string> = {
    'A+': 'grade-aplus', 'A': 'grade-a', 'B': 'grade-b',
    'C': 'grade-c', 'D': 'grade-d', 'F': 'grade-f',
};

function toFiniteNumber(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


export class CometWebCarbonBadge extends HTMLElement {
    private shadow: ShadowRoot;
    private data: BadgeData | null = null;
    private retryCount = 0;
    private dataSource: 'cache' | 'api' | 'estimate' = 'api';
    private _loadId = 0;

    // --- Public API ---

    get badgeData(): BadgeData | null { return this.data; }
    get co2Grams(): number | null { return this.data?.co2Grams ?? null; }
    get score(): ScoreLetter | null { return this.data?.score ?? null; }
    get cleanerThan(): number | null { return this.data?.cleanerThan ?? null; }
    get pageWeightKb(): number | null { return this.data?.pageWeightKb ?? null; }

    reload(): void {
        this.retryCount = 0;
        this.data = null;
        this._loadId++;
        this.renderLoading();
        this.loadData();
    }

    static get observedAttributes() {
        return ['url', 'mode', 'theme', 'cache-ttl', 'api-url', 'api-key', 'green-host'];
    }

    constructor() {
        super();
        this.shadow = this.attachShadow({ mode: 'open' });
        this.shadow.adoptedStyleSheets = [getStyleSheet(this.theme)];
        // Programmatic focus only (retry) — avoid a second tab stop beside the inner <a>/<button>
        if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1');
    }

    // --- Attribute helpers ---

    private get targetUrl(): string {
        return this.getAttribute('url') || (typeof location !== 'undefined' ? location.href : '');
    }

    private get mode(): BadgeMode {
        return (this.getAttribute('mode') as BadgeMode) || 'api';
    }

    private get theme(): BadgeTheme {
        return (this.getAttribute('theme') as BadgeTheme) || 'dark';
    }


    private get cacheTtl(): number {
        const val = this.getAttribute('cache-ttl');
        return val ? parseInt(val, 10) : DEFAULT_CACHE_TTL;
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

    // --- Lifecycle ---

    connectedCallback() {
        this.renderLoading();
        clearExpired(this.cacheTtl);
        this.loadData();
    }

    attributeChangedCallback() {
        if (this.isConnected) {
            this.loadData();
        }
    }

    // --- Data loading ---

    private async loadData() {
        const loadId = ++this._loadId;
        const url = this.targetUrl;

        if (!url) {
            this.renderError();
            return;
        }

        if (isCacheValid(url, this.cacheTtl)) {
            const cached = getCached(url);
            if (cached) {
                if (loadId !== this._loadId) return;
                this.data = {
                    ...cached,
                    score: co2ToScore(Math.max(0, toFiniteNumber(cached.co2Grams, 0))),
                    verified: cached.verified === true,
                };
                this.dataSource = 'cache';
                this.renderBadge();
                return;
            }
        }

        if (this.mode === 'estimate') {
            this.runEstimate(loadId);
        } else {
            await this.fetchFromAPI(url, loadId);
        }
    }

    private runEstimate(loadId = this._loadId) {
        try {
            // Defer by one task to allow the loading render to paint before heavy estimation
            setTimeout(() => {
                if (loadId !== this._loadId) return;
                this.data = estimateCO2(this.greenHost);
                this.dataSource = 'estimate';
                setCache(this.targetUrl, this.data);
                this.renderBadge();
            }, 0);
        } catch {
            this.renderError();
        }
    }

    private async fetchFromAPI(url: string, loadId = this._loadId) {
        try {
            const params = new URLSearchParams({ url });
            params.set('source', 'badge');
            try {
                params.set('badge_origin', window.location.hostname);
            } catch { /* SSR / non-browser — skip */ }
            // api_key is sent via Authorization header, not URL, to avoid exposure in logs/history

            const headers: Record<string, string> = { 'Accept': 'application/json' };
            if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

            const response = await fetch(
                `${this.apiUrl}/public/carbon-badge?${params}`,
                { headers, signal: controller.signal },
            ).finally(() => clearTimeout(timeoutId));

            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After') || '0', 10);
                const delay = retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(1000 * Math.pow(2, this.retryCount), 30000);

                if (this.retryCount < MAX_RETRIES) {
                    this.retryCount++;
                    this.renderLoading('Retrying after rate limit…');
                    setTimeout(() => this.fetchFromAPI(url, loadId), delay);
                    return;
                }

                console.warn(LOG_PREFIX, 'API rate limited, falling back to estimate mode.');
                this.runEstimate(loadId);
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const apiData: APIResponse = await response.json();
            if (loadId !== this._loadId) return;

            const co2Grams = Math.max(0, toFiniteNumber(apiData.co2_grams, 0));
            // Letter bands are SoT in co2ToScore / README — do not trust a divergent API letter.
            const score = co2ToScore(co2Grams);

            this.data = {
                url: apiData.url,
                co2Grams,
                score,
                cleanerThan: clamp(toFiniteNumber(apiData.cleaner_than, 0), 0, 100),
                pageWeightKb: Math.max(0, toFiniteNumber(apiData.page_weight_kb, 0)),
                greenHost: apiData.green_host,
                verified: apiData.verified === true,
                timestamp: Date.now(),
            };
            this.dataSource = 'api';

            setCache(url, this.data);
            this.retryCount = 0;
            this.renderBadge();
        } catch (error) {
            if (loadId !== this._loadId) return;
            const isAbort = error instanceof DOMException && error.name === 'AbortError';
            if (isAbort) {
                console.warn(LOG_PREFIX, 'API request timed out, falling back to estimate mode.');
            }

            if (this.retryCount < MAX_RETRIES) {
                this.retryCount++;
                this.runEstimate(loadId);
            } else {
                this.renderError();
            }
        }
    }

    // --- Events ---

    private dispatchBadgeEvent() {
        if (!this.data) return;
        this.dispatchEvent(new CustomEvent('cometweb:badge-load', {
            bubbles: true,
            composed: true,
            detail: {
                url: this.data.url,
                co2Grams: this.data.co2Grams,
                score: this.data.score,
                cleanerThan: this.data.cleanerThan,
                pageWeightKb: this.data.pageWeightKb,
                greenHost: this.data.greenHost,
                source: this.dataSource,
            },
        }));
    }

    // --- Render methods ---

    private updateStyles() {
        this.shadow.adoptedStyleSheets = [getStyleSheet(this.theme)];
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
            <div class="cw-subtitle">Powered by CometWeb</div>
          </div>
        </div>
      </div>
    `;
    }

    private renderBadge() {
        if (!this.data) return;

        const co2Grams = Math.max(0, toFiniteNumber(this.data.co2Grams, 0));
        // Reconcile letter to published bands even for cached payloads.
        const score = co2ToScore(co2Grams);
        this.data.score = score;
        const cleanerThan = clamp(toFiniteNumber(this.data.cleanerThan, 0), 0, 100);
        const scoreClass = SCORE_CLASS_MAP[score] || 'grade-unknown';
        const co2Display = co2Grams < 0.01 ? '&lt;0.01' : escapeHtml(co2Grams.toFixed(2));
        const safeScore = escapeHtml(score);
        const safeCleanerThan = escapeHtml(cleanerThan.toString());
        const isVerified = this.data.verified === true;
        const footerLabel = isVerified ? 'Verified by CometWeb' : 'Powered by CometWeb';
        const aria = `Carbon footprint: ${co2Grams.toFixed(2)}g CO\u2082e per visit, score ${score}`;
        const safeAria = escapeHtml(aria);

        this.updateStyles();
        this.shadow.innerHTML = `
      <div role="status" aria-live="polite" aria-label="${safeAria}">
        <a class="cw-badge ${this.theme}"
           href="https://cometweb.io/insight/ecology"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="${safeAria} — CometWeb (opens in new tab)">
          <div class="cw-grade ${scoreClass}" aria-hidden="true">${safeScore}</div>
          <div class="cw-content">
            <div class="cw-title">${co2Display}g CO\u2082e <small>/ visit</small></div>
            <div class="cw-subtitle">
              Cleaner than <span class="cw-highlight">${safeCleanerThan}%</span> of web
            </div>
          </div>
          <div class="cw-footer" aria-hidden="true">${footerLabel}</div>
        </a>
      </div>
    `;
        this.dispatchBadgeEvent();
    }

    private renderError() {
        this.updateStyles();
        this.shadow.innerHTML = `
      <div role="status" aria-live="polite" aria-label="Carbon footprint calculation failed">
        <div class="cw-badge error">
          <div class="cw-grade grade-f" aria-hidden="true">!</div>
          <div class="cw-content">
            <div class="cw-title">Unable to calculate</div>
            <div class="cw-error-actions">
              <button type="button" class="cw-retry-btn" aria-label="Retry carbon measurement">Retry</button>
            </div>
          </div>
          <div class="cw-footer" aria-hidden="true">Powered by CometWeb</div>
        </div>
      </div>
    `;
        this.dispatchEvent(new CustomEvent('cometweb:badge-error', {
            bubbles: true,
            composed: true,
            detail: { url: this.targetUrl },
        }));

        const btn = this.shadow.querySelector<HTMLButtonElement>('.cw-retry-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                this.retryCount = 0;
                this.renderLoading();
                this.loadData();
                // Return focus to the badge host so keyboard users don't lose context
                this.focus();
            });
        }
    }

}
