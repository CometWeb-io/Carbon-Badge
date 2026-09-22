# Changelog

All notable changes to `@cometweb/carbon-badge` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Fixed
- Rollup now completes without `--forceExit`, so build lifecycle problems are not masked.
- Node/SSR imports no longer evaluate the Web Component against missing browser globals.
- Missing timing/DOM measurement now renders N/D instead of a fabricated 500 KiB estimate.
- Expired, revoked, unknown, partial, malformed, and untrusted API data are handled explicitly.
- Cache entries now carry their own expiry and respect server `valid_until`.
- Constructable Stylesheet fallback, retry timer cleanup, full body timeout, and origin validation are covered.
- Snapshot responses now require published-snapshot provenance, valid runtime status, and dated freshness fields; malformed or mismatched payloads fail closed.
- Credential-bearing URLs are never retained in error state or error events, and non-transient HTTP failures no longer trigger duplicate retries.

### Changed
- Published snapshot mode is now the owner-first embed path; live API and local estimate remain explicit secondary modes.
- Snapshot rendering exposes measurement date and public provenance, and restricts the Verified footer to published snapshots.
- Package metadata now points at the canonical `CometWeb-io/Carbon-Badge` repository.
- Estimate mode uses `swdm-v4-lite-first-load-v1` with decimal GB and the documented SWDM v4 intensities.
- `api-key` is documented as a publishable/scoped token; authenticated requests cannot target arbitrary API origins.
- CI now runs dependency audit, test/E2E typecheck, package-consumer smoke, and a lockfile-owned static server.
- Transport and rendering are split into pure, directly tested modules; the component remains the lifecycle adapter.
- Security workflow adds CodeQL, dependency review, CycloneDX SBOM artifacts, and package provenance attestation on `main`.
- Bundle size is now measured in CI; current ESM/UMD output is approximately 8 KB gzip with an 8.5 KB regression budget.
- `happy-dom`, Vitest, Terser, and transitive toolchain dependencies were updated to audited versions.

---

## [1.0.8] — 2026-09-10

### Fixed
- **CB-01** — missing / non-finite `co2_grams` → **N/D** (never A+ from `0` fallback).
- **CB-02** — `tabindex` only in `connectedCallback` (safe `createElement` after `define`).
- **CB-04** — API failure never falls back to host-page estimate for a remote `url`.
- **CB-05** — cache key `cwb:v2:{url}|{mode}|{apiHash}|{green}|schema`; `reload({force:true})`.
- **CB-07** — no “% of web” without a real benchmark; local estimate keeps `cleanerThan: null`.
- **CB-11** — debounced init, `disconnectedCallback` + abort, single-flight loads.
- **CB-14** — URL canonicalize strips `#fragment` and tracking/auth query params.

### Added
- `registerCarbonBadge()`, `parseApiResponse` / `canonicalizeBadgeUrl`, measurement `status` / `formulaId` fields.
- Host `width:100%; max-width:320px` (CB-15).

### Changed
- Evidence link defaults to `https://cometweb.io/carbon-badge` (not Ecology marketing alone).

---

## [1.0.7] — 2026-09-09

### Fixed
- **Honest grade bands** — display letter is always derived from `co2ToScore` (A+ &lt;0.10 … A &lt;0.20 …) so a divergent API/cached letter cannot show e.g. **A @ 0.29g**.
- **Verified footer** — shows **Verified by CometWeb** only when API `verified:true`; otherwise **Powered by CometWeb**.
- **Accessibility** — light-theme highlight contrast (AA), focus-visible rings, host `tabindex=-1` (no double tab stop), larger Retry hit target, stronger loading/footer contrast, `prefers-reduced-motion` transitions narrowed.
- **429 retries** — pass `loadId` through backoff and keep loading aria feedback.

### Changed
- Docs/CDN pins and `repository.url` → `MaciejZet/CometWeb-Carbon_Badge` (was wrong org path).

---

## [1.0.6] — 2026-04-10

### Changed
- Version bump / lockfile sync for npm publish.

---

## [1.0.5] — 2026-03-23

### Fixed
- **CORS error with `api.cometweb.io`** — the default API URL pointed to `https://api.cometweb.io/api` which does not exist, causing `Cross-Origin Request Blocked` errors in browsers. Changed default to `https://app.cometweb.io/api`.

### Changed
- **Removed multi-URL fallback mechanism** — the `apiUrls` getter (array with fallback) has been simplified back to a single `apiUrl` getter. The fallback to `api.cometweb.io` was never useful since that host doesn't resolve.
- **Simplified `fetchFromAPI`** — removed the loop-based fallback logic, returning to a straightforward single-endpoint fetch with retry and estimate fallback.
- **`adoptedStyleSheets` instead of inline `<style>`** — CSS is now parsed once per theme and shared via `CSSStyleSheet` + `adoptedStyleSheets`, eliminating duplicate style strings on every render cycle.
- **Removed i18n scaffolding** — `STRINGS` dictionary and `t()` interpolation method removed; all UI strings are now inlined (English only). Reduces bundle size with no functional change.
- **`escapeHtml` only on dynamic data** — static labels no longer pass through `escapeHtml()`; only API/user-supplied values (CO₂, score, percentage) are escaped.
- **Module-level constants** — `SCORE_CLASS_MAP` and `LOG_PREFIX` extracted from methods to module scope, avoiding per-call object allocation.
- **Terser optimization** — enabled `toplevel`, `module`, and increased compression passes to 3. Bundle size reduced from ~5.2 KB to **4.6 KB gzipped** (ESM).

---

## [1.0.4] — 2026-03-17

### Fixed
- **Race condition in `loadData()`** — rapid attribute changes (e.g. `url` updated via JS) could trigger multiple concurrent fetches whose results would overwrite `this.data` in arbitrary order. A `_loadId` counter is now incremented on every `loadData()` call; stale fetches and estimate timeouts silently discard their result if a newer load has already started.

### Changed
- **`estimator.ts` fallback logging** — silent `catch {}` blocks in `measurePageWeight()` now emit `console.warn` when the Performance Resource Timing API is unavailable or DOM size estimation fails, making unexpected fallbacks visible in DevTools.
- **Removed `lang` attribute** — Polish (`pl`) language support was listed in the README and present in `test.html` but was never implemented in code (`observedAttributes` did not include `lang`). All references removed to avoid misleading consumers.

---

## [1.0.3] — 2026-03-17

### Security
- **API key moved to `Authorization` header** — previously `api_key` was appended as a URL query parameter, making it visible in browser history, server access logs, and network proxies. It is now sent as `Authorization: Bearer <key>` in the request header.

### Fixed
- **`type="button"` on retry button** — the retry button in error state lacked an explicit type, risking unintended form submission in environments that wrap the badge in a `<form>`. Fixed.
- **`tabindex="0"` on host element** — `this.focus()` after retry had no effect because the custom element host was not focusable. The host now receives `tabindex="0"` at construction time (only if not already set), restoring keyboard focus correctly after retry.
- **`setTimeout` delay in `runEstimate` reduced to 0ms** — the previous 100ms arbitrary delay is now `0ms` (single macrotask deferral). The purpose remains: allow the loading state to paint before estimation runs. A comment documents this intent.

### Changed
- **Source maps** — now enabled in non-production builds (`NODE_ENV !== 'production'`) for easier debugging. Production builds remain without source maps.
- **`drop_console`** — changed from `true` (drops all console calls) to `['log']` (drops only `console.log`). `console.warn` and `console.error` are preserved in the production bundle for operational diagnostics.
- **`cache.ts` error handling** — silent `catch {}` blocks in `setCache()` and `clearExpired()` now emit `console.warn` with the underlying error, making localStorage quota issues and access-denied errors visible during debugging.

### Added
- **Public `reload()` method** — allows forcing a fresh data fetch from JavaScript without DOM manipulation: `document.querySelector('cometweb-carbon-badge').reload()`.

---

## [1.0.2] — 2026-03-17

### Security
- **GDPR/RODO — removed Google Fonts CDN** — the `@import url('https://fonts.googleapis.com/...')` call has been removed from the component styles. Previously every page visitor's IP address was sent to Google servers without consent, which violates GDPR (cf. LG München I ruling, 2022). The component now uses a system font stack: `'Nunito Sans', 'Segoe UI', system-ui, -apple-system, sans-serif` — if the host page already loads Nunito Sans it will be used; otherwise the browser falls back to system fonts with no external request.

### Added
- **`CustomEvent 'cometweb:badge-load'`** — dispatched on the host element (bubbles, composed) after badge data is successfully rendered. Detail: `{ url, co2Grams, score, cleanerThan, pageWeightKb, greenHost, source: 'api' | 'cache' | 'estimate' }`. Enables GDPR-friendly integration with analytics tools (GA4, Plausible, etc.) without collecting personal data.
- **`CustomEvent 'cometweb:badge-error'`** — dispatched when the badge fails to load data. Detail: `{ url }`.
- **Public getters** on the custom element: `badgeData`, `co2Grams`, `score`, `cleanerThan`, `pageWeightKb` — allows reading badge state from JavaScript after load.

---

## [1.0.1] — 2026-03-12

### Security
- **XSS protection** — all dynamic values rendered inside the Shadow DOM are now HTML-escaped via `escapeHtml()` before insertion (`&`, `<`, `>`, `"`, `'`)
- **API timeout** — fetch requests are cancelled after 5 seconds using `AbortController`; the badge gracefully falls back to client-side estimate mode on timeout
- **Score whitelist** — API-returned score is validated against `ALLOWED_SCORES = ['A+','A','B','C','D','F']`; any unexpected value defaults to `F`

### Added
- `toFiniteNumber(value, fallback)` — safe numeric conversion that prevents `NaN`/`Infinity` from reaching the UI
- `clamp(value, min, max)` — ensures `cleanerThan` is always within `[0, 100]`
- `source=badge` query parameter sent to the API for backend analytics (identifies badge widget traffic)
- Handling of HTTP 429 (rate limit) responses — logs a warning and falls back to estimate mode
- `eco_badge_eligible` and `eco_badge_threshold_grams` optional fields added to the `APIResponse` TypeScript type

### Changed
- Upgraded terser plugin from `rollup-plugin-terser` to the official `@rollup/plugin-terser ^0.4.4`
- `drop_console: true` in production build — console statements are stripped from the published bundle
- `rollup` upgraded to `^4.28.0`, `typescript` to `^5.7.0`

### Fixed
- Prevented potential UI glitches from negative or non-finite CO₂ values (`Math.max(0, ...)`)
- Timeout error now correctly identified via `error.name === 'AbortError'` across browsers

---

## [1.0.0] — 2026-02

### Added
- Initial release of `@cometweb/carbon-badge` Web Component
- Shadow DOM encapsulation with `dark` / `light` themes
- `api` mode — fetches live CO₂e data from the CometWeb public API
- `estimate` mode — client-side calculation via Performance Resource Timing API
- SWDM v4 Hybrid Model for emissions calculation
- Attributes: `url`, `mode`, `theme`, `lang`, `cache-ttl`, `api-url`, `api-key`, `green-host`
- Scoring scale: A+ / A / B / C / D / F
- Polish (`pl`) and English (`en`) i18n support
- ESM and UMD builds with TypeScript declarations
