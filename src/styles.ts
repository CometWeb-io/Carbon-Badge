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
    --cw-text-light: #FFFFFF;
    --cw-accent: #05F29B;
    --cw-action: #04C27C;
    --cw-highlight-light: #047857;
    --cw-gray: #A1A1AA;
    --cw-border: rgba(255,255,255,0.08);
    --cw-font: 'Nunito Sans','Segoe UI',system-ui,-apple-system,sans-serif;
    font-family: var(--cw-font);
  }
  .cw-badge {
    display: flex;
    align-items: center;
    width: 100%;
    max-width: 320px;
    padding: 16px 16px 20px;
    border-radius: 14px;
    text-decoration: none;
    transition: transform 0.25s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s ease, border-color 0.25s ease, opacity 0.25s ease;
    cursor: pointer;
    position: relative;
    box-sizing: border-box;
    border: 1px solid transparent;
    line-height: 1.4;
  }
  .cw-badge.error {
    cursor: default;
  }
  .cw-badge:focus-visible {
    outline: 3px solid var(--cw-accent);
    outline-offset: 3px;
  }
  .cw-grade {
    width: 52px;
    height: 52px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 26px;
    margin-right: 16px;
    flex-shrink: 0;
    transition: transform 0.25s ease, box-shadow 0.25s ease;
  }
  .cw-content {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }
  .cw-title {
    font-size: 17px;
    font-weight: 800;
    line-height: 1.2;
    margin-bottom: 4px;
    letter-spacing: -0.01em;
    display: flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
  }
  .cw-title small { font-size: 0.75em; font-weight: 600; opacity: 0.7; }
  .cw-subtitle {
    font-size: 13px;
    font-weight: 500;
    opacity: 0.8;
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cw-footer {
    position: absolute;
    bottom: 8px;
    right: 14px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.75;
    transition: opacity 0.25s ease, color 0.25s ease;
  }
  .grade-aplus { background: linear-gradient(135deg,#059669,#047857); color: #fff; }
  .grade-a { background: linear-gradient(135deg,#10b981,#059669); color: #fff; }
  .grade-b { background: linear-gradient(135deg,#34d399,#059669); color: #064e3b; }
  .grade-c { background: linear-gradient(135deg,#fbbf24,#d97706); color: #78350f; }
  .grade-d { background: linear-gradient(135deg,#f97316,#ea580c); color: #fff; }
  .grade-f { background: linear-gradient(135deg,#ef4444,#dc2626); color: #fff; }
  .grade-unknown { background: #52525b; color: rgba(255,255,255,0.9); }
  .cw-badge.loading .cw-grade { animation: cw-pulse 1.5s ease-in-out infinite; }
  .cw-badge.loading .cw-title,.cw-badge.loading .cw-subtitle { opacity: 0.5; }
  @keyframes cw-pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .cw-badge.loading .cw-grade { animation: none; }
    .cw-badge,.cw-grade,.cw-footer,.cw-retry-btn { transition: none; }
  }
  .cw-error-actions { margin-top: 4px; }
  .cw-retry-btn {
    position: relative;
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 6px;
    min-height: 44px;
    min-width: 44px;
    padding: 8px 14px;
    font-size: 12px;
    font-family: inherit;
    color: inherit;
    cursor: pointer;
    opacity: 0.85;
    transition: opacity 0.2s ease;
  }
  .cw-retry-btn:hover { opacity: 1; }
  .cw-retry-btn:focus-visible {
    outline: 3px solid var(--cw-accent);
    outline-offset: 2px;
    opacity: 1;
  }
`;

const THEME_STYLES: Record<BadgeTheme, string> = {
  dark: `
    .cw-badge {
      background: linear-gradient(180deg,rgba(39,39,42,0.6),rgba(24,24,27,0.95));
      border: 1px solid var(--cw-border);
      color: var(--cw-text-light);
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -1px rgba(0,0,0,0.06),inset 0 1px 0 rgba(255,255,255,0.05);
      backdrop-filter: blur(8px);
    }
    .cw-badge .grade-aplus,.cw-badge .grade-a {
      background: linear-gradient(135deg,var(--cw-accent),var(--cw-action));
      color: #000;
      box-shadow: 0 4px 12px rgba(5,242,155,0.15);
      text-shadow: 0 1px 0 rgba(255,255,255,0.2);
    }
    .cw-badge .grade-b { background: linear-gradient(135deg,#6ee7b7,#34d399); color: #064e3b; }
    .cw-badge .cw-subtitle { color: var(--cw-gray); }
    .cw-highlight { color: var(--cw-accent); font-weight: 600; }
    .cw-badge:hover, .cw-badge:focus-visible {
      transform: translateY(-2px);
      border-color: rgba(5,242,155,0.3);
      box-shadow: 0 12px 30px -10px rgba(0,0,0,0.5),0 0 20px rgba(5,242,155,0.05);
    }
    .cw-badge:hover .cw-grade, .cw-badge:focus-visible .cw-grade { transform: scale(1.05); box-shadow: 0 8px 20px rgba(5,242,155,0.4); }
    .cw-badge:hover .cw-footer, .cw-badge:focus-visible .cw-footer { opacity: 0.9; color: var(--cw-accent); }
  `,
  light: `
    .cw-badge { background: #fff; border: 1px solid #E4E4E7; color: #18181B; box-shadow: 0 2px 10px rgba(0,0,0,0.03); }
    .cw-badge .cw-subtitle { color: #52525B; }
    .cw-highlight { color: var(--cw-highlight-light); font-weight: 600; }
    .cw-badge:hover, .cw-badge:focus-visible { border-color: var(--cw-highlight-light); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); transform: translateY(-2px); }
    .cw-badge:hover .cw-footer, .cw-badge:focus-visible .cw-footer { opacity: 0.9; color: var(--cw-highlight-light); }
  `,
};

export function getStyles(theme: BadgeTheme): string {
  return BASE_STYLES + (THEME_STYLES[theme] || THEME_STYLES.dark);
}
