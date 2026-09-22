import type { BadgeData, BadgeTheme } from './types';
import { clamp, escapeHtml } from './utils';

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

export interface BadgeMarkup {
    markup: string;
    ariaLabel: string;
    verified: boolean;
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

export function trustedEvidenceUrl(raw: string | null | undefined): URL | null {
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol === 'https:' && ALLOWED_EVIDENCE_ORIGINS.has(url.origin)) {
            return url;
        }
    } catch {
        /* invalid evidence URL */
    }
    return null;
}

export function evidenceHref(raw: string | null | undefined): string {
    return trustedEvidenceUrl(raw)?.href || DEFAULT_EVIDENCE_URL;
}

export function buildLoadingMarkup(label = 'Calculating carbon footprint…'): string {
    const safeLabel = escapeHtml(label);
    return `
      <div role="status" aria-live="polite" aria-label="${safeLabel}">
        <div class="cw-badge loading">
          <div class="cw-grade grade-unknown" aria-hidden="true">…</div>
          <div class="cw-content">
            <div class="cw-title">Measuring…</div>
            <div class="cw-subtitle">Estimating page-load footprint</div>
            <div class="cw-footer" aria-hidden="true">Powered by CometWeb</div>
          </div>
        </div>
      </div>
    `;
}

export function buildUnknownMarkup(reason: string): string {
    const safeReason = escapeHtml(reason);
    return `
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
}

export function buildBadgeMarkup(
    data: BadgeData,
    theme: BadgeTheme,
): BadgeMarkup {
    const co2Grams = data.co2Grams as number;
    const score = data.score as NonNullable<BadgeData['score']>;
    const scoreClass = SCORE_CLASS_MAP[score] || 'grade-unknown';
    const co2Display =
        co2Grams < 0.01 ? '&lt;0.01' : escapeHtml(co2Grams.toFixed(2));
    const safeScore = escapeHtml(score);
    const verified =
        data.verified === true &&
        data.status === 'ready' &&
        data.source === 'published_snapshot' &&
        data.publicId !== null &&
        hasFreshSnapshotProvenance(data) &&
        trustedEvidenceUrl(data.evidenceUrl) !== null;
    const footerLabel = verified ? 'Verified by CometWeb' : 'Powered by CometWeb';

    let subtitleHtml: string;
    if (data.status === 'stale') {
        subtitleHtml = 'Stale measurement — refresh required';
    } else if (data.status === 'partial') {
        subtitleHtml = 'Partial measurement';
    } else if (data.source === 'published_snapshot') {
        const measuredDate = formatMeasuredDate(data.measuredAt);
        subtitleHtml = measuredDate
            ? `Measured ${escapeHtml(measuredDate)}`
            : 'Published snapshot';
    } else if (data.cleanerThan !== null && Number.isFinite(data.cleanerThan)) {
        const pct = escapeHtml(String(clamp(data.cleanerThan, 0, 100)));
        subtitleHtml = `Cleaner than <span class="cw-highlight">${pct}%</span> of web`;
    } else if (data.source === 'estimate') {
        subtitleHtml = data.estimatePartial
            ? 'Local estimate (partial)'
            : 'Local SWDM v4 estimate';
    } else {
        subtitleHtml = 'Estimated page-load footprint';
    }

    const ariaCo2 = co2Grams < 0.01 ? 'less than 0.01' : co2Grams.toFixed(2);
    const ariaLabel = `Carbon footprint: ${ariaCo2}g CO₂e per visit, score ${score}`;
    const safeAria = escapeHtml(ariaLabel);
    const href = escapeHtml(evidenceHref(data.evidenceUrl));

    return {
        verified,
        ariaLabel,
        markup: `
      <div role="status" aria-live="polite" aria-label="${safeAria}">
        <a class="cw-badge ${theme}"
           href="${href}"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="${safeAria} — CometWeb (opens in new tab)">
          <div class="cw-grade ${scoreClass}" aria-hidden="true">${safeScore}</div>
          <div class="cw-content">
            <div class="cw-title">${co2Display}g CO₂e <small>/ visit</small></div>
            <div class="cw-subtitle">${subtitleHtml}</div>
            <div class="cw-footer" aria-hidden="true">${footerLabel}</div>
          </div>
        </a>
      </div>
    `,
    };
}
