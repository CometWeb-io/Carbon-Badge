import type { BadgeTheme } from './types';

const styleCache = new Map<BadgeTheme, CSSStyleSheet>();

export function getStyleSheet(theme: BadgeTheme): CSSStyleSheet {
  const cached = styleCache.get(theme);
  if (cached) return cached;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(getStyles(theme));
  styleCache.set(theme, sheet);
  return sheet;
}

const BASE_STYLES = `
  :host {
    display: inline-block;
    width: 100%;
    max-width: 320px;
    --cw-accent: #047857;
    --cw-font: 'Nunito Sans','Segoe UI',system-ui,-apple-system,sans-serif;
    font-family: var(--cw-font);
  }
  .cw-badge {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    padding: 14px;
    border: 1px solid #dce4df;
    border-radius: 10px;
    box-sizing: border-box;
    background: #fff;
    color: #202923;
    text-decoration: none;
    line-height: 1.45;
  }
  a.cw-badge { transition: border-color 0.15s ease; }
  a.cw-badge:hover { border-color: var(--cw-accent); }
  .cw-badge:focus-visible, .cw-retry-btn:focus-visible {
    outline: 2px solid var(--cw-accent);
    outline-offset: 3px;
  }
  .cw-grade {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: 7px;
    font-size: 21px;
    font-weight: 650;
    line-height: 1;
  }
  .cw-content { flex: 1; min-width: 0; }
  .cw-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
    font-size: 16px;
    font-weight: 650;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .cw-title small { font-size: 12px; font-weight: 400; color: #59665e; }
  .cw-subtitle { margin-top: 3px; font-size: 12px; color: #59665e; overflow-wrap: anywhere; }
  .cw-score-model { margin-top: 4px; font-size: 10px; font-weight: 600; color: #4a5750; letter-spacing: 0.01em; }
  .cw-highlight { font-weight: 600; color: var(--cw-accent); }
  .cw-footer { margin-top: 7px; font-size: 10px; font-weight: 400; color: #66736a; line-height: 1.4; }
  .grade-aplus, .grade-a { background: #e0f3e8; color: #14613d; }
  .grade-b { background: #edf2d9; color: #4d621d; }
  .grade-c { background: #fff1cf; color: #805608; }
  .grade-d { background: #ffeadb; color: #984717; }
  .grade-f { background: #fce4e3; color: #a12f2a; }
  .grade-unknown { background: #edf0ee; color: #59665e; font-size: 16px; }
  .cw-badge.loading .cw-grade { animation: cw-pulse 1.5s ease-in-out infinite; }
  @keyframes cw-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
  .cw-error-actions { margin-top: 8px; }
  .cw-retry-btn {
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 6px;
    min-height: 44px;
    min-width: 44px;
    padding: 8px 12px;
    font: inherit;
    font-size: 12px;
    color: inherit;
    cursor: pointer;
  }
  :host([variant="compact"]) .cw-badge {
    align-items: center;
    padding: 10px 12px;
    gap: 10px;
    border-radius: 6px;
  }
  :host([variant="compact"]) .cw-grade {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    font-size: 16px;
  }
  :host([variant="compact"]) .cw-title { font-size: 14px; }
  :host([variant="compact"]) .cw-subtitle { font-size: 11px; margin-top: 1px; }
  :host([variant="compact"]) .cw-footer { margin-top: 3px; }
  :host([variant="minimal"]) .cw-badge {
    background: transparent;
    border-color: transparent;
    border-radius: 4px;
    padding: 8px;
    gap: 8px;
  }
  :host([variant="minimal"]) .cw-grade {
    background: transparent;
    width: 24px;
    height: 24px;
    font-size: 16px;
    border: 1px solid currentColor;
    border-radius: 50%;
    box-sizing: border-box;
    margin-top: 1px;
  }
  :host([variant="minimal"]) .cw-title { font-size: 14px; font-weight: 500; }
  :host([variant="minimal"]) .cw-subtitle { font-size: 11px; margin-top: 1px; }
  :host([variant="minimal"]) .cw-footer { margin-top: 3px; }
  :host([variant="minimal"]) a.cw-badge:hover .cw-title { text-decoration: underline; text-underline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) {
    .cw-badge.loading .cw-grade { animation: none; }
    a.cw-badge { transition: none; }
  }
`;

const THEME_STYLES: Record<BadgeTheme, string> = {
  light: '',
  dark: `
    :host { --cw-accent: #8ad8ad; }
    .cw-badge { background: #19231d; border-color: #39483f; color: #f0f5f2; }
    .cw-subtitle, .cw-title small { color: #b5c4ba; }
    .cw-footer { color: #a0b2a6; }
    .grade-aplus, .grade-a { background: #254a35; color: #a3e6bd; }
    .grade-b { background: #3d4926; color: #d3e7a1; }
    .grade-c { background: #524324; color: #f7d68b; }
    .grade-d { background: #543a2a; color: #fac39b; }
    .grade-f { background: #512e2e; color: #f5b4b0; }
    .grade-unknown { background: #303e35; color: #bfcdc4; }
  `,
};

export function getStyles(theme: BadgeTheme): string {
  return BASE_STYLES + (THEME_STYLES[theme] ?? THEME_STYLES.dark);
}
