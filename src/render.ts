import type { BadgeData, BadgeTheme } from './types';
import { SCORE_MODEL_ID_COMETWEB_BANDS_V1 } from './types';
import { clamp } from './utils';

const DEFAULT_EVIDENCE_URL = 'https://cometweb.io/carbon-badge';
const ALLOWED_EVIDENCE_ORIGINS = new Set([
    'https://cometweb.io',
    'https://app.cometweb.io',
]);
const SCORE_CLASS_MAP: Record<string, string> = {
    'A+': 'grade-aplus',
    A: 'grade-a',
    B: 'grade-b',
    C: 'grade-c',
    D: 'grade-d',
    F: 'grade-f',
};

export interface BadgeViewModel {
    ariaLabel: string;
    verified: boolean;
}

/** Cache / local estimate must never mint a Verified claim. */
export interface RenderTrust {
    allowVerified: boolean;
}

function formatMeasuredDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    try {
        const locale =
            typeof navigator !== 'undefined' && navigator.language
                ? navigator.language
                : 'en';
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
    const measuredAt = Date.parse(data.measuredAt);
    const validUntil = Date.parse(data.validUntil);
    const now = Date.now();
    return (
        Number.isFinite(measuredAt) &&
        Number.isFinite(validUntil) &&
        measuredAt <= now &&
        validUntil > now
    );
}

/**
 * Evidence URL must be HTTPS, credential-free, on an allowlisted origin,
 * and (when a publicId is known) bound to `/carbon-badge/{publicId}` with
 * no query or fragment.
 */
export function trustedEvidenceUrl(
    raw: string | null | undefined,
    publicId: string | null = null,
): URL | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:') return null;
        if (url.username || url.password) return null;
        if (!ALLOWED_EVIDENCE_ORIGINS.has(url.origin)) return null;

        if (publicId) {
            const expectedPath = `/carbon-badge/${encodeURIComponent(publicId.toLowerCase())}`;
            if (url.pathname.toLowerCase() !== expectedPath) return null;
            if (url.search || url.hash) return null;
        }

        return url;
    } catch {
        return null;
    }
}

export function evidenceHref(
    raw: string | null | undefined,
    publicId: string | null = null,
): string {
    if (publicId) {
        const bound = trustedEvidenceUrl(raw, publicId);
        if (bound) return bound.href;
        return new URL(
            `/carbon-badge/${encodeURIComponent(publicId.toLowerCase())}`,
            'https://cometweb.io',
        ).href;
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

function isVerifiedSnapshot(
    data: BadgeData,
    trust: RenderTrust,
): boolean {
    if (!trust.allowVerified) return false;
    return (
        data.verified === true &&
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

function subtitleFor(data: BadgeData): { text: string; highlight?: string } {
    if (data.status === 'stale') {
        return { text: 'Stale measurement — refresh required' };
    }
    if (data.status === 'partial') {
        return { text: 'Partial measurement — grade withheld' };
    }
    if (data.source === 'published_snapshot') {
        const measuredDate = formatMeasuredDate(data.measuredAt);
        return {
            text: measuredDate
                ? `Measured ${measuredDate}`
                : 'Published snapshot',
        };
    }
    if (data.cleanerThan !== null && Number.isFinite(data.cleanerThan)) {
        return {
            text: 'Cleaner than ',
            highlight: `${clamp(data.cleanerThan, 0, 100)}%`,
        };
    }
    if (data.source === 'estimate') {
        return {
            text: data.estimatePartial
                ? 'Local estimate (partial)'
                : 'Local SWDM v4 estimate',
        };
    }
    return { text: 'Estimated page-load footprint' };
}

export function badgeViewModel(
    data: BadgeData,
    trust: RenderTrust = { allowVerified: false },
): BadgeViewModel {
    const co2Grams = data.co2Grams as number;
    const score = data.score as NonNullable<BadgeData['score']>;
    const ariaCo2 = co2Grams < 0.01 ? 'less than 0.01' : co2Grams.toFixed(2);
    return {
        verified: isVerifiedSnapshot(data, trust),
        ariaLabel: `Carbon footprint: ${ariaCo2}g CO₂e per visit, CometWeb Score ${score}`,
    };
}

export function mountLoading(
    root: ShadowRoot | Element,
    label = 'Calculating carbon footprint…',
    options: { keepStyles?: boolean } = {},
): void {
    clearRoot(root, options);
    const status = element('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': label,
    });
    const badge = element('div', { class: 'cw-badge loading' });
    badge.append(
        element('div', { class: 'cw-grade grade-unknown', 'aria-hidden': 'true' }, '…'),
    );
    const content = element('div', { class: 'cw-content' });
    content.append(
        element('div', { class: 'cw-title' }, 'Measuring…'),
        element('div', { class: 'cw-subtitle' }, 'Estimating page-load footprint'),
        element('div', { class: 'cw-footer', 'aria-hidden': 'true' }, 'Powered by CometWeb'),
    );
    badge.append(content);
    status.append(badge);
    root.append(status);
}

export function mountUnknown(
    root: ShadowRoot | Element,
    reason: string,
    options: { keepStyles?: boolean } = {},
): void {
    clearRoot(root, options);
    const status = element('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Carbon footprint not available',
    });
    const badge = element('div', { class: 'cw-badge error' });
    badge.append(
        element('div', { class: 'cw-grade grade-unknown', 'aria-hidden': 'true' }, 'N/D'),
    );
    const content = element('div', { class: 'cw-content' });
    content.append(
        element('div', { class: 'cw-title' }, 'Not available'),
        element('div', { class: 'cw-subtitle' }, reason),
    );
    const actions = element('div', { class: 'cw-error-actions' });
    actions.append(
        element(
            'button',
            {
                type: 'button',
                class: 'cw-retry-btn',
                'aria-label': 'Retry carbon measurement',
            },
            'Retry',
        ),
    );
    content.append(
        actions,
        element('div', { class: 'cw-footer', 'aria-hidden': 'true' }, 'Powered by CometWeb'),
    );
    badge.append(content);
    status.append(badge);
    root.append(status);
}

export function mountBadge(
    root: ShadowRoot | Element,
    data: BadgeData,
    theme: BadgeTheme,
    options: { keepStyles?: boolean; trust?: RenderTrust } = {},
): BadgeViewModel {
    const trust = options.trust ?? { allowVerified: false };
    const model = badgeViewModel(data, trust);
    const co2Grams = data.co2Grams as number;
    const score = data.score as NonNullable<BadgeData['score']>;
    const scoreClass = SCORE_CLASS_MAP[score] || 'grade-unknown';
    const co2Display = co2Grams < 0.01 ? '<0.01' : co2Grams.toFixed(2);
    const footerLabel = model.verified
        ? 'Verified by CometWeb'
        : 'Powered by CometWeb';
    const href = evidenceHref(data.evidenceUrl, data.publicId);
    const subtitle = subtitleFor(data);

    clearRoot(root, options);

    const status = element('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': model.ariaLabel,
    });
    const link = element('a', {
        class: `cw-badge ${theme}`,
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `${model.ariaLabel} — CometWeb (opens in new tab)`,
    });
    link.append(
        element('div', { class: `cw-grade ${scoreClass}`, 'aria-hidden': 'true' }, score),
    );

    const content = element('div', { class: 'cw-content' });
    const title = element('div', { class: 'cw-title' }, `${co2Display}g CO₂e `);
    title.append(element('small', {}, '/ visit'));

    const subtitleEl = element('div', { class: 'cw-subtitle' }, subtitle.text);
    if (subtitle.highlight) {
        subtitleEl.append(
            element('span', { class: 'cw-highlight' }, subtitle.highlight),
            document.createTextNode(' of modelled cohort'),
        );
    }

    content.append(
        title,
        subtitleEl,
        element(
            'div',
            { class: 'cw-score-model', 'aria-hidden': 'true' },
            `CometWeb Score ${score}`,
        ),
        element('div', { class: 'cw-footer', 'aria-hidden': 'true' }, footerLabel),
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
    trust: RenderTrust = { allowVerified: true },
): BadgeViewModel & { markup: string } {
    const host = document.createElement('div');
    const model = mountBadge(host, data, theme, { trust });
    return { ...model, markup: host.innerHTML };
}
