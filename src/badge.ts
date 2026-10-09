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
    MeasurementSource,
    RetrievalSource,
} from './types';
import { estimateCO2Detailed, initializeResourceTiming } from './estimator';
import { getStyleSheet, getStyles } from './styles';
import {
    canonicalizeBadgeUrl,
    normalizeBadgeData,
    cloneBadgeData,
} from './normalize';
import { validateSnapshotId } from './url';
import {
    mountBadge,
    mountLoading,
    mountUnknown,
    measurementReason,
} from './render';
import { waitForPageQuiescence } from './page-quiescence';
import type { BadgeLanguage } from './locale';

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
    private effectivePublished = false;
    private measurementSource: MeasurementSource = 'api';
    private retrievalSource: RetrievalSource = 'network';
    private _loadId = 0;
    private _abort: AbortController | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    private _forceNext = false;
    private _routeTimer: ReturnType<typeof setInterval> | null = null;
    private _expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private _visibilityObserver: IntersectionObserver | null = null;
    private _visible = false;
    private lastReason = 'Measurement unavailable';

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
    get pageWeightKiB(): number | null { return this.data?.pageWeightKiB ?? null; }
    get pageWeightKB(): number | null { return this.data?.pageWeightKB ?? null; }
    get measurementStatus(): BadgeData['status'] | null {
        return this.data?.status ?? null;
    }

    reload(options?: { force?: boolean }): void {
        this.data = null;
        this._forceNext = options?.force === true;
        this._loadId++;
        if (this._expiryTimer) clearTimeout(this._expiryTimer);
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
            'lang',
            'nonce',
            'loading',
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

    private get canonicalTargetUrl(): string | null {
        return canonicalizeBadgeUrl(this.rawTargetUrl);
    }

    private get mode(): BadgeMode | null {
        const raw = this.getAttribute('mode')?.trim();
        if (!raw) {
            return this.hasAttribute('snapshot-id') ? 'snapshot' : 'estimate';
        }
        if (raw !== 'estimate' && raw !== 'api' && raw !== 'snapshot') {
            return null;
        }
        // A published ID must never be silently ignored for a live or local grade.
        if (this.hasAttribute('snapshot-id') && raw !== 'snapshot') {
            return null;
        }
        return raw;
    }

    private get theme(): BadgeTheme {
        const t = this.getAttribute('theme') as BadgeTheme;
        return ALLOWED_THEMES.has(t) ? t : 'dark';
    }
    private get language(): BadgeLanguage {
        const language = this.closest('[lang]')?.getAttribute('lang') || document.documentElement.lang || navigator.language;
        return language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
    }

    private get cacheTtl(): number {
        const raw = this.getAttribute('cache-ttl');
        if (raw === null) return DEFAULT_CACHE_TTL;
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) return DEFAULT_CACHE_TTL;
        return Math.min(value, MAX_CACHE_TTL);
    }

    private get greenHost(): boolean {
        return this.getAttribute('green-host') === 'true';
    }

    connectedCallback() {
        this.data = null;
        this._visible = false;
        this.renderLoading();
        this.scheduleLoad();
    }

    disconnectedCallback() {
        if (this._routeTimer) clearInterval(this._routeTimer);
        if (this._expiryTimer) clearTimeout(this._expiryTimer);
        this._routeTimer = this._expiryTimer = null;
        this._visibilityObserver?.disconnect();
        this._visibilityObserver = null;
        this.abortInFlight();
        if (this._scheduleTimer) {
            clearTimeout(this._scheduleTimer);
            this._scheduleTimer = null;
        }
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
        if (name === 'nonce') { this.updateStyles(); return; }
        if (name === 'lang') {
            if (!this.data) this.renderLoading();
            else if (this.data.status === 'ready') this.renderBadge();
            else this.renderUnknown(this.lastReason, this.data);
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

    private async loadData() {
        if (!this.isConnected) return;

        const loadId = ++this._loadId;
        const force = this._forceNext;
        this._forceNext = false;
        this.effectivePublished = false;

        const mode = this.mode;
        this._visibilityObserver?.disconnect();
        this._visibilityObserver = null;
        if (this._routeTimer) clearInterval(this._routeTimer);
        this._routeTimer = null;
        if (!mode) {
            const rawMode = this.getAttribute('mode')?.trim();
            if (
                this.hasAttribute('snapshot-id') &&
                (rawMode === 'api' || rawMode === 'estimate')
            ) {
                console.warn(
                    LOG_PREFIX,
                    'snapshot-id cannot be combined with mode=api or mode=estimate; omit mode for snapshot, or remove snapshot-id.',
                );
                this.renderUnknown('Conflicting mode and snapshot-id');
                return;
            }
            this.renderUnknown('Invalid badge mode');
            return;
        }

        if (mode === 'snapshot' && !this.snapshotId) {
            this.renderUnknown('Missing snapshot ID');
            return;
        }
        if (mode !== 'estimate' && !this._visible && this.getAttribute('loading') !== 'eager' && typeof IntersectionObserver !== 'undefined') {
            this.renderLoading('Waiting until visible…');
            this._visibilityObserver = new IntersectionObserver(entries => {
                if (loadId !== this._loadId || !this.isConnected || !entries.some(entry => entry.isIntersecting)) return;
                this._visible = true;
                this._visibilityObserver?.disconnect();
                this._visibilityObserver = null;
                this.scheduleLoad();
            }, { rootMargin: '200px' });
            this._visibilityObserver.observe(this);
            return;
        }
        if (mode === 'estimate') {
            let observedUrl = currentPageUrl();
            // shortcut: 1 s polling can be delayed by background throttling; use reload() for immediate updates.
            this._routeTimer = setInterval(() => {
                const nextUrl = currentPageUrl();
                if (nextUrl !== observedUrl) { observedUrl = nextUrl; this.reload(); }
            }, 1_000);
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

        if (mode === 'estimate') {
            if (!canonical) {
                this.renderUnknown('Invalid or missing URL');
                return;
            }
            await this.runEstimate(canonical, loadId);
            return;
        }

        this.abortInFlight();
        const controller = new AbortController();
        this._abort = controller;
        try {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let abortModule: () => void = () => {};
            const interrupted = new Promise<never>((_resolve, reject) => {
                abortModule = () => reject(new Error('Module load aborted'));
                controller.signal.addEventListener('abort', abortModule, { once: true });
                timer = setTimeout(() => reject(new Error('Module load timed out')), 8_000);
                if (controller.signal.aborted) abortModule();
            });
            let runtime;
            // shortcut: native import cannot abort its asset fetch; cancellation stops API work and rendering.
            try { runtime = await Promise.race([import('./remote'), interrupted]); }
            finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abortModule); }
            const { loadRemoteMeasurement } = runtime;
            if (controller.signal.aborted || loadId !== this._loadId || !this.isConnected) return;
            const result = await loadRemoteMeasurement({
                canonicalUrl: canonical || '', snapshotId: this.snapshotId, mode,
                cacheTtl: this.cacheTtl, greenHost: this.greenHost, force,
                badgeOrigin: typeof location === 'undefined' ? '' : location.origin,
            }, controller.signal, label => {
                if (loadId === this._loadId && this.isConnected) this.renderLoading(label);
            });
            if (controller.signal.aborted || loadId !== this._loadId || !this.isConnected) return;
            if ('reason' in result) { this.renderUnknown(result.reason); return; }
            this.data = result.data;
            this.measurementSource = result.data.source || 'api';
            this.retrievalSource = result.retrievalSource;
            this.renderBadge();
        } catch {
            if (!controller.signal.aborted && loadId === this._loadId && this.isConnected) this.renderUnknown('Unable to load measurement');
        } finally {
            if (this._abort === controller) this._abort = null;
        }
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
        this.measurementSource = 'estimate';
        this.retrievalSource = 'local';

        try {
            await waitForPageQuiescence(controller.signal);
            if (loadId !== this._loadId || !this.isConnected) return;

            const { data } = estimateCO2Detailed(this.greenHost);
            data.url = canonical;
            this.data = data;
            this.measurementSource = 'estimate';
            this.retrievalSource = 'local';
            if (data.co2Grams === null) {
                this.renderUnknown(
                    measurementReason(data),
                    data,
                );
            } else {
                this.renderBadge();
            }
        } catch (error) {
            if (loadId !== this._loadId || !this.isConnected) return;
            const isAbort =
                error instanceof DOMException && error.name === 'AbortError';
            if (!isAbort) {
                const { data } = estimateCO2Detailed(this.greenHost);
                this.renderUnknown('Page did not become quiet; grade withheld', { ...data, co2Grams: null, score: null, cleanerThan: null, status: 'partial', reasonCode: 'quiescence-timeout', transferUpperBoundBytes: null, estimatePartial: true });
            }
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
                    published: this.effectivePublished,
                    originMatched: this.retrievalSource === 'network' ? d.originMatched : null,
                    measuredResourceCount: d.measuredResourceCount,
                    pageWeightKB: d.pageWeightKB,
                    pageWeightKiB: d.pageWeightKiB,
                    factorSetId: d.factorSetId,
                    measurementWindowStartMs: d.measurementWindowStartMs,
                    measurementWindowEndMs: d.measurementWindowEndMs,
                    unknownResourceCount: d.unknownResourceCount,
                    observableResourceRatio: d.observableResourceRatio,
                    coverageRatio: d.coverageRatio,
                    reasonCode: d.reasonCode,
                    measurementScope: d.measurementScope,
                    networkTransferBytes: d.networkTransferBytes,
                    encodedBodyBytes: d.encodedBodyBytes,
                    cachedBodyBytes: d.cachedBodyBytes,
                    transferUpperBoundBytes: d.transferUpperBoundBytes,
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
            try {
                this.shadow.adoptedStyleSheets = [getStyleSheet(this.theme)];
                this.shadow.querySelector('style[data-cw-theme]')?.remove();
                return;
            } catch { /* Fall back to the host-provided style nonce. */ }
        }

        let style = this.shadow.querySelector<HTMLStyleElement>(
            'style[data-cw-theme]',
        );
        if (!style) {
            style = document.createElement('style');
            style.dataset.cwTheme = '';
            this.shadow.prepend(style);
        }
        style.nonce = this.nonce;
        style.textContent = getStyles(this.theme);
    }

    private renderLoading(label = 'Calculating carbon footprint\u2026') {
        this.updateStyles();
        mountLoading(this.shadow, label, { keepStyles: true, language: this.language });
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
                measurementReason(normalized),
                normalized ?? undefined,
            );
            return;
        }
        this.data = normalized;
        this.updateStyles();
        const model = mountBadge(this.shadow, normalized, this.theme, {
            keepStyles: true,
            language: this.language,
            trust: {
                allowPublished: this.retrievalSource === 'network',
            },
        });
        this.effectivePublished = model.published;
        if (this._expiryTimer) clearTimeout(this._expiryTimer);
        const expires = normalized.validUntil ? Date.parse(normalized.validUntil) : NaN;
        if (Number.isFinite(expires)) this._expiryTimer = setTimeout(() => {
            if (this.isConnected) this.reload({ force: true });
        }, Math.min(Math.max(expires - Date.now(), 0), 2_147_483_647));
        this.dispatchBadgeEvent();
    }

    private renderUnknown(reason: string, measurement?: BadgeData) {
        this.lastReason = reason;
        if (this._expiryTimer) clearTimeout(this._expiryTimer);
        this.effectivePublished = false;
        this.data = measurement ?? {
            url: this.canonicalTargetUrl || '',
            publicId: null,
            co2Grams: null,
            score: null,
            cleanerThan: null,
            pageWeightKb: null,
            greenHost: null,
            originMatched: null,
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
        this.updateStyles();
        mountUnknown(this.shadow, reason, { keepStyles: true, data: this.data, language: this.language });
        this.dispatchEvent(
            new CustomEvent('cometweb:badge-error', {
                bubbles: true,
                composed: true,
                detail: {
                    url: this.data.url,
                    mode: this.mode,
                    reason,
                    reasonCode: this.data.reasonCode,
                    status: this.data.status,
                    measurementSource: this.data.source,
                    retrievalSource: this.data.source ? this.retrievalSource : null,
                    factorSetId: this.data.factorSetId,
                    measurementWindowStartMs: this.data.measurementWindowStartMs,
                    measurementWindowEndMs: this.data.measurementWindowEndMs,
                    pageWeightKB: this.data.pageWeightKB,
                    pageWeightKiB: this.data.pageWeightKiB,
                    measuredResourceCount: this.data.measuredResourceCount,
                    unknownResourceCount: this.data.unknownResourceCount,
                    observableResourceRatio: this.data.observableResourceRatio,
                    networkTransferBytes: this.data.networkTransferBytes,
                    encodedBodyBytes: this.data.encodedBodyBytes,
                    cachedBodyBytes: this.data.cachedBodyBytes,
                    transferUpperBoundBytes: this.data.transferUpperBoundBytes,
                },
            }),
        );
        this.bindRetry();
    }

    private bindRetry() {
        const btn =
            this.shadow.querySelector<HTMLButtonElement>('.cw-retry-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                this.renderLoading();
                this.reload({ force: true });
                const status = this.shadow.querySelector<HTMLElement>('[role="status"]');
                if (status) { status.tabIndex = -1; status.focus(); }
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
    const existing = customElements.get('cometweb-carbon-badge');
    if (existing) return existing;
    initializeResourceTiming();
    customElements.define('cometweb-carbon-badge', CometWebCarbonBadge);
    return CometWebCarbonBadge;
}
