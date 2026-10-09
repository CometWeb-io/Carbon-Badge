# Changelog

## 2.0.2 — Unreleased

- Add `/embed` as an ESM side-effect entry with lazy API/cache loading and `/api` as UI-free ESM/CommonJS helpers; keep the root SDK and its named exports compatible.
- Bound optional module loading to 8 seconds, withhold the grade on chunk failure and stop API/render continuations after cancellation. Native module asset fetches cannot themselves be aborted.
- Package the complete embed graph; record every JavaScript artifact's hash/SRI and check static-import closure size (10,500 B), complete embed size (15,000 B) and API formats (3,500 B) in CI. Entry SRI does not transitively verify imported chunks.
- Require the full Resource Timing quiet window; deadline results remain partial and ungraded.
- Separate network transfer, encoded body and cached body bytes; cache observations withhold the first-load grade.
- Withhold grades after document/SPA URL changes, preserve API lifecycle diagnostics and reject invalid freshness.
- Show the measured host/path and warn when a published snapshot belongs to another page, retaining the publication date.
- Bind release manifests to source/lock digests and reject dirty or mismatched CI provenance.
- Add PL/EN formatting, minimum 12 px supporting text, forced colors and nonce-based fallback styles; test themes/variants at 200% zoom, RTL, axe and strict CSP.
- Keep shadow controls reachable by keyboard on WebKit; avoid a forced negative host tabindex and focus the loading status after a retry.
- Recheck results at expiry, invalidate local grades on SPA URL changes, and defer API/snapshot requests until near the viewport.
- Isolate shared GETs by options, reference-count subscribers, bound decoded bodies to 65536 bytes and apply the timeout through body reading; reject redirects.
- Add explicit local KB/KiB, elapsed observation window, packaged factor-set metadata and a provider response schema; migrate badge-owned cache to schema 8 with version/model identity.
- Preserve the letter band when formatting near thresholds; reject impossible calendar dates and sanitize proof links on every lifecycle path.
- Generate the release manifest before CI consumer verification and build publication manifests in production mode.
- Minify only allowlisted private methods/state and remove redundant cache/style checks; preserve public getters, events, CSP and lifecycle semantics.
- Increase the gzip ceiling from 10,500 to 13,800 B for correctness, localization, accessibility and request/lifecycle safeguards; retain a hard CI limit and zero runtime dependencies.
- Refresh vulnerable development transitive dependencies; no runtime dependency added.

## [2.0.1] — Hosted CDN artifact; npm unpublished

The ESM artifact is hosted on cometweb.io with SHA-256 `4c33a3a1f0c06deab2be8a44231fb29bf80fec471e8461e8cad727e606a5e540`. The source candidate reconstructs those bytes, but no 2.x npm release or corresponding public source commit exists yet. It remains immutable; 2.0.2 is a separate candidate.

### Breaking
- Local estimation is the default; `url` alone no longer requests a server scan. Use explicit `mode="api"` only for an intentional service dependency.
- Remove `allow-query` and `sanitizeAllowedQueryKeys`; query parameters and fragments are always stripped.
- Replace `BadgeData.verified` and event `verified`/`backendVerified` with `originMatched` (placement only) and event `published` (snapshot provenance). No ownership verification is claimed.
- Cache schema v7 invalidates API results with the old scan-source alias; local estimates do not read or write localStorage.

### Fixed
- Published API snapshots and `Cache-Control: no-store` responses bypass local storage, so a later load observes publication revocation.
- Unrecognized or malformed `measurement_source` now renders N/D instead of silently becoming `api`; absent fields retain the legacy API fallback.
- `cometweb_scan` remains distinct from `published_snapshot`; live scan results cannot show published attribution or link to a snapshot proof page.
- Conflicting `snapshot-id` with `mode="api"` or `mode="estimate"` now fails closed; a blank `snapshot-id` no longer falls back to a local estimate.
- Missing navigation timing, invalid resource sizes and overflow cannot produce a grade.
- Incomplete estimates retain resource visibility counts and link back to the free tool.
- Show the measured hostname and improve dark-theme supporting text contrast.
- Never manufacture a proof URL when the API omits one; published provenance uses “Published by CometWeb”.

### Distribution
- Free installation does not depend on npm publication or Insight availability. Build and verify the pinned self-hosted artifact before offering installation code.

## [1.0.9] — 2026-09-23

### Security
- Single-flight shares an immutable HTTP envelope (not a one-shot `Response`) and aborts hangers with a real `AbortSignal` timeout.
- Expired / incomplete published snapshots fail closed to N/D (never a letter).
- `Verified by CometWeb` requires formula ID, measurement method, score model id, freshness and bound evidence — and **only** from a fresh network response (host `localStorage` cannot mint Verified).
- Explicit `mode="snapshot"` without `snapshot-id` fails closed (no silent API downgrade).
- `allow-query` drops sensitive keys and uses the same allowlist for request/response identity.
- Self-declared `green-host` no longer improves local estimate grades; partial Resource Timing / buffer overflow withholds the letter.
- Publish workflow matches CI gates; npm audit / dependency-review fail on **moderate**.
- Added `SECURITY.md` and Dependabot for npm + GitHub Actions.

### Fixed
- Attribute changes clear stale on-screen measurements and show loading.
- Cache TTL downgrade is honoured against existing entries; invalid `cache-ttl` values are rejected.
- Page quiescence is bounded by a single deadline that includes `window.load`.
- Out-of-range `cleaner_than` / negative page weight are rejected instead of clamped.
- Error/N/D payloads set `source: null` (attempted path stays on `mode`).

### Changed
- Package version **1.0.9** (do not overwrite CDN `1.0.8` artefacts).
- Cache schema bumped to **v5**; owned key index avoids full `localStorage` scans on cleanup.
- Live shadow DOM is mounted with `createElement` (no live `innerHTML` assignment).
- Release pipeline emits `dist/release-manifest.json` (SRI + sha256) alongside the npm tarball.
- Gzip size budget raised to **10.5 KB** to absorb trust/timeout hardening without splitting the estimator entry yet.

## [1.0.10] — 2026-09-30

First release published to npm after 1.0.6. Git tag `v1.0.9` was not accepted by the registry.

### Security
- `scripts/serve-static.mjs` refuses symlinks and requires `realpath` containment under the serve root (closes in-tree symlink LFI against the Playwright static server).

### Fixed
- `snapshot-id` combined with `mode="api"` or `mode="estimate"` fails closed (N/D) instead of silently ignoring the published id.
- README embed uses the published 1.0.10 asset and a hash from the production build.
- Bundle size claim aligned to the measured ~10 KB gzip production ESM (was a stale ~8 KB figure).
- Declared `engines.node` as `>=22` (Vitest 5 / CI Node 24); removed stale committed `bun.lock` that failed `bun install --frozen-lockfile` while CI uses `npm ci`.

## [Unreleased]

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
