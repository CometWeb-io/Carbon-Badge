import type { BadgeData, BadgeTheme } from './types';
import { SCORE_MODEL_ID_COMETWEB_BANDS_V1, FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1 } from './types';
import { clamp } from './utils';
import { hasInvalidFreshness, normalizeBadgeData, timestampMs } from './normalize';
import { co2ToScore } from './estimator';
import { translate, type BadgeLanguage } from './locale';
import { trustedEvidenceUrl, canonicalizeBadgeUrl } from './url';
export { trustedEvidenceUrl } from './url';

const DEFAULT_EVIDENCE_URL = 'https://cometweb.io/carbon-badge';
const SCORE_CLASS_MAP: Record<string, string> = {
    'A+': 'grade-aplus',
    A: 'grade-a',
    B: 'grade-b',
    C: 'grade-c',
    D: 'grade-d',
    F: 'grade-f',
};

function measuredSubject(raw: string): string {
    try { const url = new URL(raw); return url.host + (url.pathname === '/' ? '' : url.pathname); } catch { return 'This page'; }
}

export interface BadgeViewModel {
    ariaLabel: string;
    published: boolean;
}

/** Cache / local estimate cannot establish published provenance. */
export interface RenderTrust {
    allowPublished: boolean;
}

function formatMeasuredDate(value: string | null, locale: BadgeLanguage): string | null {
    if (!value) return null;
    const date = new Date(timestampMs(value));
    if (!Number.isFinite(date.getTime())) return null;
    try {
        return new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
        }).format(date);
    } catch {
        return value.slice(0, 10);
    }
}

function hasFreshSnapshotProvenance(data: BadgeData): boolean {
    if (!data.measuredAt || !data.validUntil) return false;
    const measuredAt = timestampMs(data.measuredAt);
    const validUntil = timestampMs(data.validUntil);
    const now = Date.now();
    return (
        Number.isFinite(measuredAt) &&
        Number.isFinite(validUntil) &&
        measuredAt <= now &&
        validUntil > now &&
        !hasInvalidFreshness(data.measuredAt, data.validUntil, now, true)
    );
}


export function evidenceHref(
    raw: string | null | undefined,
    publicId: string | null = null,
): string {
    if (publicId) {
        const bound = trustedEvidenceUrl(raw, publicId);
        if (bound) return bound.href;
        return DEFAULT_EVIDENCE_URL;
    }
    return trustedEvidenceUrl(raw)?.href || DEFAULT_EVIDENCE_URL;
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
        node.setAttribute(name, value);
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function clearRoot(
    root: ShadowRoot | Element,
    options: { keepStyles?: boolean } = {},
): void {
    const keepStyle = options.keepStyles
        ? root.querySelector('style[data-cw-theme]')
        : null;

    while (root.firstChild) {
        root.removeChild(root.firstChild);
    }
    if (keepStyle) root.appendChild(keepStyle);
}

function isPublishedSnapshot(
    data: BadgeData,
    trust: RenderTrust,
): boolean {
    if (!trust.allowPublished) return false;
    return (
        data.status === 'ready' &&
        data.source === 'published_snapshot' &&
        data.publicId !== null &&
        Boolean(data.formulaId) &&
        Boolean(data.measurementMethod) &&
        data.scoreModelId === SCORE_MODEL_ID_COMETWEB_BANDS_V1 &&
        hasFreshSnapshotProvenance(data) &&
        trustedEvidenceUrl(data.evidenceUrl, data.publicId) !== null
    );
}

function subtitleFor(data: BadgeData, published: boolean, language: BadgeLanguage): { text: string; highlight?: string } {
    if (data.status === 'stale') {
        return { text: 'Stale measurement — refresh required' };
    }
    if (data.status === 'partial') {
        return { text: 'Partial measurement — grade withheld' };
    }
    if (published) {
        const measuredDate = formatMeasuredDate(data.measuredAt, language);
        return {
            text: (measuredDate ? `${translate('Measured', language)} ${measuredDate}` : translate('Published snapshot', language)) +
                (typeof location !== 'undefined' && data.url !== canonicalizeBadgeUrl(location.href)
                    ? translate('; result for another page', language) : ''),
        };
    }
    if (data.cleanerThan !== null && Number.isFinite(data.cleanerThan)) {
        return {
            text: 'Cleaner than ',
            highlight: `${new Intl.NumberFormat(language).format(clamp(data.cleanerThan, 0, 100))}%`,
        };
    }
    if (data.source === 'estimate' && data.formulaId === FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1) {
        return {
            text: data.estimatePartial
                ? 'Local estimate (partial)'
                : 'Observed-transfer SWDM v4 estimate',
        };
    }
    return { text: 'Estimated page-load footprint' };
}

export function measurementReason(data: BadgeData | null): string {
    if (data?.reasonCode === 'document-url-changed') return 'Document URL changed; first-load grade withheld';
    if (data?.reasonCode === 'cache-outside-first-load') return 'Cached load; first-load grade withheld';
    if (data?.status === 'revoked') return 'Measurement revoked';
    if (data?.status === 'stale') return 'Stale measurement — refresh required';
    return data?.status === 'partial' ? 'Partial measurement — grade withheld' : 'No usable measurement';
}

/** Extra digits near a threshold keep the displayed value inside its letter band. */
function formatGrams(grams: number, language: BadgeLanguage): string {
    const format = (value: number, digits: number) => new Intl.NumberFormat(language, {
        minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false,
    }).format(value);
    if (grams < 0.01) return '<' + format(0.01, 2);
    let digits = 2, display = format(grams, digits);
    while (digits < 6 && co2ToScore(Number(display.replace(',', '.'))) !== co2ToScore(grams)) display = format(grams, ++digits);
    return co2ToScore(Number(display.replace(',', '.'))) === co2ToScore(grams) ? display : '<' + format(grams, 2);
}

export function badgeViewModel(
    data: BadgeData,
    trust: RenderTrust = { allowPublished: false },
    language: BadgeLanguage = 'en',
): BadgeViewModel {
    const co2Grams = data.co2Grams as number;
    const score = data.score as NonNullable<BadgeData['score']>;
    const display = formatGrams(co2Grams, language);
    const ariaCo2 = display.startsWith('<') ? `${translate('less than', language)} ${display.slice(1)}` : display;
    return {
        published: isPublishedSnapshot(data, trust),
        ariaLabel: `${measuredSubject(data.url)}: ${translate('estimated', language)} ${ariaCo2}g CO₂e ${translate(data.measurementScope === 'document-first-load' ? 'per first document load' : 'per page load', language)}, ${translate('CometWeb Score', language)} ${score}`,
    };
}

export function mountLoading(
    root: ShadowRoot | Element,
    label = 'Calculating carbon footprint…',
    options: { keepStyles?: boolean; language?: BadgeLanguage } = {},
): void {
    const language = options.language ?? 'en';
    clearRoot(root, options);
    const status = element('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': translate(label, language),
        lang: language,
    });
    const badge = element('div', { class: 'cw-badge loading' });
    badge.append(
        element('div', { class: 'cw-grade grade-unknown', 'aria-hidden': 'true' }, '…'),
    );
    const content = element('div', { class: 'cw-content' });
    content.append(
        element('div', { class: 'cw-title' }, translate(label === 'Calculating carbon footprint…' ? 'Measuring…' : label, language)),
        element('div', { class: 'cw-subtitle' }, translate('Estimating page-load footprint', language)),
        element('div', { class: 'cw-footer', 'aria-hidden': 'true' }, translate('Powered by CometWeb', language)),
    );
    badge.append(content);
    status.append(badge);
    root.append(status);
}

export function mountUnknown(
    root: ShadowRoot | Element,
    reason: string,
    options: { keepStyles?: boolean; data?: BadgeData; language?: BadgeLanguage } = {},
): void {
    const language = options.language ?? 'en';
    clearRoot(root, options);
    const status = element('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': `${translate(measuredSubject(options.data?.url || ''), language)}: ${translate('carbon footprint not available', language)}`,
        lang: language,
    });
    const badge = element('div', { class: 'cw-badge error' });
    badge.append(
        element('div', { class: 'cw-grade grade-unknown', 'aria-hidden': 'true' }, 'N/D'),
    );
    const content = element('div', { class: 'cw-content' });
    if (options.data?.url) content.append(element('div', { class: 'cw-host' }, measuredSubject(options.data.url)));
    content.append(
        element('div', { class: 'cw-title' }, translate('Not available', language)),
        element('div', { class: 'cw-subtitle' }, translate(reason, language)),
    );
    const measured = options.data?.measuredResourceCount;
    const unknown = options.data?.unknownResourceCount;
    if (measured !== undefined && unknown !== undefined) {
        const visibility = unknown === 0 && options.data?.estimatePartial
            ? `${measured} ${translate('resource sizes visible', language)}; ${translate('timing history incomplete', language)}`
            : `${measured} ${translate('of', language)} ${measured + unknown} ${translate('resource sizes visible', language)}`;
        content.append(element('div', { class: 'cw-subtitle' }, visibility));
    }
    if (typeof options.data?.networkTransferBytes === 'number') content.append(element('div', { class: 'cw-subtitle' },
        `${translate('Observed transfer', language)} ≥ ${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(options.data.networkTransferBytes / 1000)} KB`));
    const actions = element('div', { class: 'cw-error-actions' });
    actions.append(
        element(
            'button',
            {
                type: 'button',
                class: 'cw-retry-btn',
                'aria-label': translate('Retry carbon measurement', language),
            },
            translate('Retry', language),
        ),
    );
    content.append(
        actions,
        element('a', { class: 'cw-footer', href: DEFAULT_EVIDENCE_URL, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Carbon Badge — CometWeb (${translate('opens in new tab', language)})` }, translate('Powered by CometWeb', language)),
    );
    badge.append(content);
    status.append(badge);
    root.append(status);
}

export function mountBadge(
    root: ShadowRoot | Element,
    data: BadgeData,
    theme: BadgeTheme,
    options: { keepStyles?: boolean; trust?: RenderTrust; language?: BadgeLanguage } = {},
): BadgeViewModel {
    const language = options.language ?? 'en';
    const normalized = normalizeBadgeData(data);
    if (!normalized || normalized.status !== 'ready' || normalized.co2Grams === null) {
        mountUnknown(root, measurementReason(normalized), { ...options, data: normalized ?? undefined });
        return { published: false, ariaLabel: translate('carbon footprint not available', language) };
    }
    data = normalized;
    const trust = options.trust ?? { allowPublished: false };
    const model = badgeViewModel(data, trust, language);
    const co2Grams = data.co2Grams as number;
    const score = data.score as NonNullable<BadgeData['score']>;
    const scoreClass = SCORE_CLASS_MAP[score] || 'grade-unknown';
    const co2Display = formatGrams(co2Grams, language);
    const footerLabel = model.published
        ? 'Published by CometWeb'
        : 'Powered by CometWeb';
    const href = model.published
        ? evidenceHref(data.evidenceUrl, data.publicId)
        : DEFAULT_EVIDENCE_URL;
    const subtitle = subtitleFor(data, model.published, language);

    clearRoot(root, options);

    const status = element('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': model.ariaLabel,
        lang: language,
    });
    const link = element('a', {
        class: `cw-badge ${theme}`,
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `${model.ariaLabel} — CometWeb (${translate('opens in new tab', language)})`,
    });
    link.append(
        element('div', { class: `cw-grade ${scoreClass}`, 'aria-hidden': 'true' }, score),
    );

    const content = element('div', { class: 'cw-content' });
    const title = element('div', { class: 'cw-title' }, `${co2Display}g CO₂e `);
    title.append(element('small', {}, `/ ${translate(data.measurementScope === 'document-first-load' ? 'first load' : 'load', language)}`));

    const subtitleEl = element('div', { class: 'cw-subtitle' }, translate(subtitle.text, language));
    if (subtitle.highlight) {
        subtitleEl.append(
            element('span', { class: 'cw-highlight' }, subtitle.highlight),
            document.createTextNode(translate(' of modelled cohort', language)),
        );
    }

    content.append(
        element('div', { class: 'cw-host' }, measuredSubject(data.url)),
        title,
        subtitleEl,
        element(
            'div',
            { class: 'cw-score-model', 'aria-hidden': 'true' },
            `${translate('CometWeb Score', language)} ${score}`,
        ),
        element('div', { class: 'cw-footer', 'aria-hidden': 'true' }, translate(footerLabel, language)),
    );
    link.append(content);
    status.append(link);
    root.append(status);
    return model;
}

/** @deprecated Prefer {@link mountLoading} — kept for string snapshot tests. */
export function buildLoadingMarkup(
    label = 'Calculating carbon footprint…',
): string {
    const host = document.createElement('div');
    mountLoading(host, label);
    return host.innerHTML;
}

/** @deprecated Prefer {@link mountUnknown} — kept for string snapshot tests. */
export function buildUnknownMarkup(reason: string): string {
    const host = document.createElement('div');
    mountUnknown(host, reason);
    return host.innerHTML;
}

/** @deprecated Prefer {@link mountBadge} — kept for string snapshot tests. */
export function buildBadgeMarkup(
    data: BadgeData,
    theme: BadgeTheme,
    trust: RenderTrust = { allowPublished: true },
): BadgeViewModel & { markup: string } {
    const host = document.createElement('div');
    const model = mountBadge(host, data, theme, { trust });
    return { ...model, markup: host.innerHTML };
}
