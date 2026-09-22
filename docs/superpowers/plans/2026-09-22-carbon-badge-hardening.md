# Carbon Badge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Carbon Badge fail closed and auditable across measurement, status freshness, URL/auth handling, SSR, caching, rendering, tests, packaging, and CI.

**Architecture:** Keep the public package dependency-free at runtime, but split pure concerns into small modules: utilities, estimator, URL/normalization, cache, and a thin Web Component adapter. The component will only render a score for a current, usable measurement; all other states render N/D with explicit status. CI will test the package as a consumer and will not fetch an unpinned server from npm during E2E.

**Tech Stack:** TypeScript, Rollup, Vitest, Playwright, npm lockfile, GitHub Actions.

**Spec:** `/Users/maciejzet/.codex/attachments/914a0d44-2fe9-4145-9d10-74eb82eba782/Pasted text.txt`

## Global Constraints

- No runtime dependency is added to the published package.
- No measurement fallback may fabricate a page weight or a CO₂ value.
- `revoked` and `unknown` never render a score; expired `validUntil` becomes `stale`.
- `Verified by CometWeb` requires `verified === true`, `status === ready`, and an allowlisted evidence origin.
- Formula provenance is preserved; missing `formula_id` remains `null`.
- Authenticated requests may only target the trusted default API origin; HTML `api-key` is publishable, never a secret.
- Public repository commits and pushes require explicit user approval.

## Review Focus

- A Node import with no DOM globals must resolve without evaluating `HTMLElement` unsafely; covered by the SSR package smoke test.
- A page with no measurable timing and no DOM estimate must be N/D rather than a score; covered by estimator and component tests.
- A response marked revoked, unknown, or expired must not display a stale score; covered by normalizer and API E2E tests.
- A credential-bearing URL or authenticated request to an arbitrary API origin must be rejected; covered by canonicalization and request tests.
- Partial Resource Timing must be reported as partial and never silently promoted to ready; covered by estimator metadata tests.

---

### Task 1: Establish honest pure utilities and type contracts

**Files:**
- Create: `src/utils.ts`
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Modify: `src/__tests__/utils.test.ts`

**Interfaces:**
- Produces `escapeHtml(value: string): string`, `clamp(value: number, min: number, max: number): number`, and `toFiniteNumberOrNull(value: unknown): number | null` from production code.
- Produces `CacheEntry.expiresAt` and a bumped cache schema for later cache work.
- Produces `FORMULA_ID_SWDM_V4_LITE_FIRST_LOAD_V1` for the estimator.

- [ ] **Step 1: Replace copied utility tests with imports from production.**
- [ ] **Step 2: Run `npm test -- src/__tests__/utils.test.ts` and confirm the test fails because `src/utils.ts` does not exist.**
- [ ] **Step 3: Move the three implementations into `src/utils.ts` and update `normalize.ts`/`badge.ts` imports.**
- [ ] **Step 4: Run `npm test -- src/__tests__/utils.test.ts` and the full `npm test`; expected result is PASS.**

### Task 2: Correct SWDM first-load estimator and fail-closed measurement

**Files:**
- Modify: `src/estimator.ts`
- Modify: `src/types.ts`
- Modify: `src/__tests__/estimator.test.ts`
- Modify: `README.md`
- Modify: `docs/reference.md` when present

**Interfaces:**
- `estimateCO2Detailed()` returns `co2Grams: null`, `score: null`, `status: unknown`, and `formulaId: null` when no bytes are measurable.
- Resource Timing results expose `measuredResourceCount`, `unknownResourceCount`, and `coverageRatio` through `EstimateResult` without changing the published runtime dependency surface.
- First-load constants use decimal GB and SWDM v4 Lite first-load identifier `swdm-v4-lite-first-load-v1`.

- [ ] **Step 1: Add failing tests for decimal GB math, the 0.059 network constant, unknown measurement, and partial timing coverage.**
- [ ] **Step 2: Run the estimator test file and confirm failures against the old 0.071/GiB/fabricated-fallback behavior.**
- [ ] **Step 3: Implement the corrected constants, decimal conversion, explicit coverage metadata, and zero-byte fail-closed result.**
- [ ] **Step 4: Keep DOM size as an explicitly partial estimate only when it exists; return zero bytes when both timing and DOM paths fail.**
- [ ] **Step 5: Run estimator tests, full unit tests, and typecheck.**
- [ ] **Step 6: Update methodology docs to call the model a first-load lite approximation and document that full visitor/cache ratios are not implemented.**

### Task 3: Harden URL identity, API normalization, freshness, and evidence trust

**Files:**
- Modify: `src/normalize.ts`
- Modify: `src/types.ts`
- Modify: `src/__tests__/normalize.test.ts`
- Create or modify: `src/__tests__/trust.test.ts` if evidence helpers are extracted

**Interfaces:**
- `canonicalizeBadgeUrl(raw: string): string | null` rejects credentials, non-http schemes, and sensitive query keys; it strips only known tracking parameters and preserves semantic `key`/`ref` parameters.
- `parseApiResponse()` rejects `revoked`/`unknown`, turns expired `valid_until` into `stale`, and preserves missing `formula_id` as `null`.
- `normalizeBadgeData()` keeps malformed `cleanerThan` as `null` instead of converting it to `0`.
- Evidence validation allowlists `https://cometweb.io` and `https://app.cometweb.io` origins.

- [ ] **Step 1: Add failing tests for credential URLs, sensitive query names, semantic `key`/`ref`, revoked/unknown/expired statuses, missing formula IDs, malformed benchmarks, and untrusted evidence URLs.**
- [ ] **Step 2: Run normalize tests and confirm the expected failures.**
- [ ] **Step 3: Implement canonicalization and status/freshness invariants.**
- [ ] **Step 4: Extract or add the evidence-origin validator and make normalization preserve provenance.**
- [ ] **Step 5: Run normalization, cache, and full unit tests.**

### Task 4: Make cache entries self-expiring and lifecycle-safe

**Files:**
- Modify: `src/cache.ts`
- Modify: `src/types.ts`
- Modify: `src/badge.ts`
- Modify: `src/__tests__/cache.test.ts`

**Interfaces:**
- `setCache(key, data, ttlMinutes)` stores `expiresAt` as the minimum of local TTL and server `validUntil`.
- `isCacheValid(key)` validates the stored deadline and rejects future timestamps, stale/revoked/unknown data, malformed entries, and old schemas.
- `clearExpired()` uses each entry’s own deadline and no longer applies the mounting badge’s TTL to unrelated cache entries.

- [ ] **Step 1: Add failing tests for independent TTLs, server validity deadlines, malformed/future timestamps, and revoked cache data.**
- [ ] **Step 2: Run cache tests and confirm failure.**
- [ ] **Step 3: Implement schema v3 entries with `expiresAt`; keep legacy cleanup bounded to the package prefix.**
- [ ] **Step 4: Update badge calls and remove per-instance TTL cleanup from `connectedCallback()`.**
- [ ] **Step 5: Run cache, badge, and full unit tests.**

### Task 5: Harden Web Component SSR, API transport, retries, rendering, and CSS fallback

**Files:**
- Modify: `src/badge.ts`
- Modify: `src/styles.ts`
- Modify: `src/index.ts`
- Modify: `src/__tests__/badge-events.test.ts`
- Create: `src/__tests__/ssr-import.test.ts`

**Interfaces:**
- `CometWebCarbonBadge` extends a safe fallback base when `HTMLElement` is absent; `registerCarbonBadge()` guards both `HTMLElement` and `customElements`.
- Authenticated requests require HTTPS/localhost and the trusted default API origin; no Bearer token is sent to arbitrary `api-url` values.
- `badge_origin` uses `window.location.origin`.
- API timeout remains active through `response.json()` and validation; Retry-After supports seconds/date with a 30-second cap and timers are cleared on disconnect.
- `theme` changes only update styles; visual-only attributes do not trigger data loads.
- Rendering uses a `<style>` fallback when adopted stylesheets are unavailable, and `Verified` is only shown for fresh verified allowlisted evidence.
- ARIA CO₂ text matches the visible `<0.01` representation.

- [ ] **Step 1: Add failing Node-environment import coverage and component tests for API-origin rejection, body timeout, retry cleanup, theme-only changes, CSS fallback, stale/revoked rendering, and ARIA threshold text.**
- [ ] **Step 2: Run the focused tests and confirm they fail for the current implementation.**
- [ ] **Step 3: Add the safe HTMLElement base and registration guards.**
- [ ] **Step 4: Add validated API URL/header construction, origin semantics, and full-operation timeout.**
- [ ] **Step 5: Store/clear retry timers and limit Retry-After.**
- [ ] **Step 6: Route markup through a style-aware render helper and update rendering invariants.**
- [ ] **Step 7: Run all unit tests and the SSR import smoke test.**

### Task 6: Strengthen browser E2E and package-consumer validation

**Files:**
- Modify: `e2e/lifecycle.spec.ts`
- Create: `e2e/api-status.spec.ts`
- Create: `scripts/package-consumer-smoke.mjs`
- Modify: `package.json`
- Modify: `playwright.config.ts`

**Interfaces:**
- E2E fixtures exercise estimate unknown, deterministic API ready, revoked, stale, malformed, and timeout states.
- Playwright starts a package-owned server dependency instead of `npx --yes serve`.
- `npm run pack:consumer` packs the built artifact into a clean temporary consumer, checks ESM import in Node, and confirms package metadata files are usable.

- [ ] **Step 1: Add exact assertions for API response data and status-specific UI, replacing the digit-or-N/D assertion.**
- [ ] **Step 2: Run E2E and confirm new tests fail or expose the current behavior.**
- [ ] **Step 3: Add a lockfile-owned static server dependency or replace the server with a Node script in the repo.**
- [ ] **Step 4: Implement the consumer smoke script and npm script.**
- [ ] **Step 5: Run build, pack consumer, and all E2E tests.**

### Task 7: Typecheck tests, remove build masking, and harden CI/security gates

**Files:**
- Create: `tsconfig.test.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `package-lock.json`

**Interfaces:**
- `npm run typecheck:test` covers source, Vitest tests, Playwright tests/config, and smoke scripts where TypeScript applies.
- `npm run security:audit` runs `npm audit --audit-level=high`.
- CI runs audit, production build without `--forceExit`, both typechecks, unit/E2E tests, package consumer smoke, and pack integrity with read-only permissions.
- Dependency updates are made only after verifying advisory applicability and lockfile resolution; no blind `npm audit fix --force`.

- [ ] **Step 1: Add the test tsconfig and failing typecheck:test script.**
- [ ] **Step 2: Run it and fix actual test/config type errors.**
- [ ] **Step 3: Remove `--forceExit`, add security/package scripts, and update dependencies only to verified fixed versions.**
- [ ] **Step 4: Run `npm ci`, audit, both typechecks, tests, build, pack, consumer smoke, and E2E.**
- [ ] **Step 5: Update Actions versions only if the repository’s supported GitHub Actions/runtime path verifies cleanly; otherwise document the exact blocker in the final report.**

### Task 8: Final documentation and release-readiness verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/reference.md` when present

**Interfaces:**
- Documentation describes the actual fail-closed states, lite first-load formula identifier, URL/privacy behavior, publishable nature of `api-key`, evidence trust rules, and package-consumer verification.

- [ ] **Step 1: Search docs for stale claims: full SWDM v4, invented fallback, arbitrary verification, private API key, and unqualified “Verified”.**
- [ ] **Step 2: Update those claims with the implemented contracts and release notes.**
- [ ] **Step 3: Run the complete verification matrix from a clean install.**
- [ ] **Step 4: Inspect `git diff`, `git status`, and `git diff --check`; stage nothing and do not commit/push.**

## Self-Review

- Spec coverage: findings 1–16 are covered by Tasks 1–5; findings 17–22 are covered by Tasks 6–7; finding 23 is covered by Task 5. The final architecture also extracts API URL/retry transport and pure markup rendering, leaving the Web Component as lifecycle orchestration rather than an untestable rewrite.
- Placeholder scan: no unresolved implementation placeholders are part of the plan.
- Type consistency: cache API changes are defined before badge integration; the new formula constant and consumer script are named explicitly.
- Review focus: all five high-risk inputs have named tests in their owning tasks.
