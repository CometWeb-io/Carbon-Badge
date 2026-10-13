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
import { watchDocumentRoute } from './route-watch';

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
    private _shadow: ShadowRoot;
    private _data: BadgeData | null = null;
    private _effectivePublished = false;
    private _measurementSource: MeasurementSource = 'api';
    private _retrievalSource: RetrievalSource = 'network';
    private _loadId = 0;
    private _abort: AbortController | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    private _forceNext = false;
    private _stopRouteWatch: (() => void) | null = null;
    private _expiryTimer: ReturnType<typeof setTimeout> | null = null;
    private _visibilityObserver: IntersectionObserver | null = null;
    private _visible = false;
    private _lastReason = 'Measurement unavailable';
    private readonly _onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted) this.reload({ force: true });
    };

    get badgeData(): BadgeData | null {
        return this._data ? cloneBadgeData(this._data) : null;
    }
    get co2Grams(): number | null {
        return this._data?.co2Grams ?? null;
    }
    get score(): ScoreLetter | null {
        return this._data?.score ?? null;
    }
    get cleanerThan(): number | null {
        return this._data?.cleanerThan ?? null;
    }
    get pageWeightKb(): number | null {
        return this._data?.pageWeightKb ?? null;
    }
    get pageWeightKiB(): number | null { return this._data?.pageWeightKiB ?? null; }
    get pageWeightKB(): number | null { return this._data?.pageWeightKB ?? null; }
    get measurementStatus(): BadgeData['status'] | null {
        return this._data?.status ?? null;
    }

    reload(options?: { force?: boolean }): void {
        this._data = null;
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
        this._shadow = this.attachShadow({ mode: 'open' });
        try {
            this._shadow.adoptedStyleSheets = [getStyleSheet(this._theme)];
        } catch {
            /* SSR / no Constructable Stylesheets */
        }
    }

    private get _rawTargetUrl(): string {
        return this.getAttribute('url') || currentPageUrl();
    }

    private get _snapshotId(): string | null {
        const value = this.getAttribute('snapshot-id')?.trim();
        return value || null;
    }

    private get _canonicalTargetUrl(): string | null {
        return canonicalizeBadgeUrl(this._rawTargetUrl);
    }

    private get _mode(): BadgeMode | null {
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

    private get _theme(): BadgeTheme {
        const t = this.getAttribute('theme') as BadgeTheme;
        return ALLOWED_THEMES.has(t) ? t : 'dark';
    }
    private get _language(): BadgeLanguage {
        const language = this.closest('[lang]')?.getAttribute('lang') || document.documentElement.lang || navigator.language;
        return language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
    }

    private get _cacheTtl(): number {
        const raw = this.getAttribute('cache-ttl');
        if (raw === null) return DEFAULT_CACHE_TTL;
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) return DEFAULT_CACHE_TTL;
        return Math.min(value, MAX_CACHE_TTL);
    }

    private get _greenHost(): boolean {
        return this.getAttribute('green-host') === 'true';
    }

    connectedCallback() {
        window.addEventListener('pageshow', this._onPageShow);
        this._data = null;
        this._visible = false;
        this.renderLoading();
        this.scheduleLoad();
    }

    disconnectedCallback() {
        window.removeEventListener('pageshow', this._onPageShow);
        this._stopRouteWatch?.();
        this._stopRouteWatch = null;
        if (this._expiryTimer) clearTimeout(this._expiryTimer);
        this._expiryTimer = null;
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
            if (!this._data) this.renderLoading();
            else if (this._data.status === 'ready') this.renderBadge();
            else this.renderUnknown(this._lastReason, this._data);
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
        this._effectivePublished = false;

        const mode = this._mode;
        this._visibilityObserver?.disconnect();
        this._visibilityObserver = null;
        this._stopRouteWatch?.();
        this._stopRouteWatch = null;
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

        if (mode === 'snapshot' && !this._snapshotId) {
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
            this._stopRouteWatch = watchDocumentRoute(() => this.reload());
        }

        const force = this._forceNext;
        this._forceNext = false;

        const canonical = this._canonicalTargetUrl;
        if (mode !== 'snapshot' && !canonical) {
            this.renderUnknown('Invalid or missing URL');
            return;
        }

        if (mode === 'snapshot') {
            try {
                validateSnapshotId(this._snapshotId || '');
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
                canonicalUrl: canonical || '', snapshotId: this._snapshotId, mode,
                cacheTtl: this._cacheTtl, greenHost: this._greenHost, force,
                badgeOrigin: typeof location === 'undefined' ? '' : location.origin,
            }, controller.signal, label => {
                if (loadId === this._loadId && this.isConnected) this.renderLoading(label);
            });
            if (controller.signal.aborted || loadId !== this._loadId || !this.isConnected) return;
            if ('reason' in result) { this.renderUnknown(result.reason); return; }
            this._data = result.data;
            this._measurementSource = result.data.source || 'api';
            this._retrievalSource = result.retrievalSource;
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
        this._measurementSource = 'estimate';
        this._retrievalSource = 'local';

        try {
            await waitForPageQuiescence(controller.signal);
            if (loadId !== this._loadId || !this.isConnected) return;

            const { data } = estimateCO2Detailed(this._greenHost);
            data.url = canonical;
            this._data = data;
            this._measurementSource = 'estimate';
            this._retrievalSource = 'local';
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
                const { data } = estimateCO2Detailed(this._greenHost);
                this.renderUnknown('Page did not become quiet; grade withheld', { ...data, co2Grams: null, score: null, cleanerThan: null, status: 'partial', reasonCode: 'quiescence-timeout', transferUpperBoundBytes: null, estimatePartial: true });
            }
        } finally {
            if (this._abort === controller) this._abort = null;
        }
    }

    private dispatchBadgeEvent() {
        if (!this._data) return;
        const d = cloneBadgeData(this._data);
        this.dispatchEvent(
            new CustomEvent('cometweb:badge-load', {
                bubbles: true,
                composed: true,
                detail: {
                    ...d,
                    source: this._measurementSource,
                    measurementSource: this._measurementSource,
                    retrievalSource: this._retrievalSource,
                    published: this._effectivePublished,
                    originMatched: this._retrievalSource === 'network' ? d.originMatched : null,
                    mode: this._mode,

                },
            }),
        );
    }

    private updateStyles(): void {
        const supportsSheets =
            'adoptedStyleSheets' in this._shadow &&
            typeof CSSStyleSheet !== 'undefined' &&
            'replaceSync' in CSSStyleSheet.prototype;

        if (supportsSheets) {
            try {
                this._shadow.adoptedStyleSheets = [getStyleSheet(this._theme)];
                this._shadow.querySelector('style[data-cw-theme]')?.remove();
                return;
            } catch { /* Fall back to the host-provided style nonce. */ }
        }

        let style = this._shadow.querySelector<HTMLStyleElement>(
            'style[data-cw-theme]',
        );
        if (!style) {
            style = document.createElement('style');
            style.dataset.cwTheme = '';
            this._shadow.prepend(style);
        }
        style.nonce = this.nonce;
        style.textContent = getStyles(this._theme);
    }

    private renderLoading(label = 'Calculating carbon footprint\u2026') {
        this.updateStyles();
        mountLoading(this._shadow, label, { keepStyles: true, language: this._language });
    }

    private renderBadge() {
        const normalized = normalizeBadgeData(this._data);
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
        this._data = normalized;
        this.updateStyles();
        const model = mountBadge(this._shadow, normalized, this._theme, {
            keepStyles: true,
            language: this._language,
            trust: {
                allowPublished: this._retrievalSource === 'network',
            },
        });
        this._effectivePublished = model.published;
        if (this._expiryTimer) clearTimeout(this._expiryTimer);
        const expires = normalized.validUntil ? Date.parse(normalized.validUntil) : NaN;
        if (Number.isFinite(expires)) this._expiryTimer = setTimeout(() => {
            if (this.isConnected) this.reload({ force: true });
        }, Math.min(Math.max(expires - Date.now(), 0), 2_147_483_647));
        this.dispatchBadgeEvent();
    }

    private renderUnknown(reason: string, measurement?: BadgeData) {
        this._lastReason = reason;
        if (this._expiryTimer) clearTimeout(this._expiryTimer);
        this._effectivePublished = false;
        this._data = measurement ?? {
            url: this._canonicalTargetUrl || '',
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
        mountUnknown(this._shadow, reason, { keepStyles: true, data: this._data, language: this._language });
        this.dispatchEvent(
            new CustomEvent('cometweb:badge-error', {
                bubbles: true,
                composed: true,
                detail: {
                    url: this._data.url,
                    mode: this._mode,
                    reason,
                    reasonCode: this._data.reasonCode,
                    status: this._data.status,
                    measurementSource: this._data.source,
                    retrievalSource: this._data.source ? this._retrievalSource : null,
                    factorSetId: this._data.factorSetId,
                    measurementWindowStartMs: this._data.measurementWindowStartMs,
                    measurementWindowEndMs: this._data.measurementWindowEndMs,
                    pageWeightKB: this._data.pageWeightKB,
                    pageWeightKiB: this._data.pageWeightKiB,
                    measuredResourceCount: this._data.measuredResourceCount,
                    unknownResourceCount: this._data.unknownResourceCount,
                    observableResourceRatio: this._data.observableResourceRatio,
                    networkTransferBytes: this._data.networkTransferBytes,
                    modelledResourceBytes: this._data.modelledResourceBytes,
                    encodedBodyBytes: this._data.encodedBodyBytes,
                    cachedBodyBytes: this._data.cachedBodyBytes,
                    transferUpperBoundBytes: this._data.transferUpperBoundBytes,
                },
            }),
        );
        this.bindRetry();
    }

    private bindRetry() {
        const btn =
            this._shadow.querySelector<HTMLButtonElement>('.cw-retry-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                if (btn.dataset.cwAction === 'reload-document') {
                    window.location.reload();
                    return;
                }
                this.renderLoading();
                this.reload({ force: true });
                const status = this._shadow.querySelector<HTMLElement>('[role="status"]');
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
