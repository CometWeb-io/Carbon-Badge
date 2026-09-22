# Carbon Badge Evidence-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the published snapshot the owner-first Carbon Badge path while preserving explicit live API and local estimate modes.

**Architecture:** Add a validated snapshot transport path to the existing Web Component, preserve snapshot provenance in normalized data and cache identity, and move owner-facing labels into the pure renderer. Keep backend behavior out of this package because the public snapshot endpoint already exists in Insight.

**Tech Stack:** TypeScript, Rollup, Vitest, Playwright, npm, existing CometWeb public snapshot API.

**Spec:** `docs/superpowers/specs/2026-09-22-carbon-badge-evidence-first-design.md`

## Global Constraints

- `snapshot` is the owner-first mode; `api` and `estimate` remain explicit compatibility modes.
- A snapshot ID must match lowercase hexadecimal `[a-f0-9]{1,64}` before endpoint construction.
- `Verified by CometWeb` requires a ready published snapshot and trusted HTTPS evidence.
- Stale, revoked, unknown, missing, or malformed measurements never render a letter.
- No runtime dependency is added to the published package.
- Public repository changes are staged only; commit and push require explicit approval.

## Review Focus

- A supplied snapshot ID must never be treated as a URL or interpolated unsafely; test invalid IDs and path encoding.
- An explicit `mode="api"` must override the snapshot default; test this compatibility rule.
- A snapshot response with `measurement_source=published_snapshot` must retain `public_id`, date, and source through cache and reload.
- An expired or revoked snapshot must render N/D and never Verified, including a cached response.
- A missing snapshot must not fall back to URL scanning or local host estimation; test the request count and final state.

### Task 1: Snapshot contract and pure transport

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api-client.ts`
- Create: `src/__tests__/snapshot-client.test.ts`

**Interfaces:**
- `BadgeMode` includes `'snapshot'`.
- `CacheKeyParts` includes `snapshotId: string | null`.
- `APIResponse` includes `public_id?: string`.
- `validateSnapshotId(raw: string): string` returns the normalized ID or throws `Invalid Carbon Badge snapshot ID`.
- `buildCarbonBadgeSnapshotEndpoint(apiBase: URL, snapshotId: string, badgeOrigin: string): URL` returns `/public/carbon-badge/id/{id}` with `source=badge` and `badge_origin`.

- [x] Write failing tests for valid/invalid IDs, encoded path construction, and origin query parameters.
- [x] Run `npm test -- --run src/__tests__/snapshot-client.test.ts` and confirm the new exports fail.
- [x] Implement the helpers and add the snapshot mode/type fields.
- [x] Run the focused test and `npm run typecheck`.

### Task 2: Snapshot normalization, cache identity, and lifecycle selection

**Files:**
- Modify: `src/normalize.ts`
- Modify: `src/cache.ts`
- Modify: `src/badge.ts`
- Modify: `src/__tests__/cache.test.ts`
- Modify: `src/__tests__/badge-events.test.ts`

**Interfaces:**
- `BadgeData.publicId: string | null` is preserved from `public_id`.
- `parseApiResponse()` accepts a requested snapshot ID and rejects a mismatching returned ID.
- `buildCacheKey()` includes snapshot identity.
- `snapshot-id` selects snapshot mode only when `mode` is omitted; explicit `mode` wins.
- Snapshot mode calls the ID endpoint and never calls the URL endpoint or local estimator.

- [x] Add failing tests for default snapshot selection, explicit API override, mismatch rejection, and no fallback.
- [x] Implement snapshot identity in normalization and cache keys.
- [x] Implement endpoint selection in `loadData()`/`fetchFromAPI()` while keeping request timeout and retry behavior.
- [x] Run badge, normalize, cache, and full unit tests.

### Task 3: Owner-first rendering and accessibility

**Files:**
- Modify: `src/render.ts`
- Modify: `src/badge.ts`
- Modify: `src/styles.ts`
- Modify: `src/__tests__/render.test.ts`
- Modify: `e2e/api-status.spec.ts`

**Interfaces:**
- Snapshot-ready markup includes `Measured <localized date>` and a stable evidence link.
- Snapshot-ready markup may show Verified only when the full evidence contract passes.
- Snapshot stale/revoked/unknown/missing states use the existing N/D/retry contract.
- `badge-load` event detail includes `mode` and `publicId`.

- [x] Add failing renderer tests for snapshot date, source label, and evidence trust.
- [x] Implement compact owner-facing snapshot copy without changing live/estimate copy unexpectedly.
- [x] Add keyboard/focus and accessible name assertions to E2E.
- [x] Run renderer tests and Playwright.

### Task 4: Owner integration docs and release gates

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `src/index.ts`
- Modify: `e2e/fixtures/api.html`
- Modify: `e2e/lifecycle.spec.ts`

**Interfaces:**
- README makes snapshot the canonical owner snippet and documents live/estimate as secondary modes.
- Package entrypoint examples use the new snapshot contract.
- E2E fixture covers a published snapshot response and a missing snapshot response.

- [x] Replace owner-first install examples and document snapshot freshness/provenance.
- [x] Add build output and E2E fixture coverage for snapshot mode.
- [x] Run `npm run typecheck`, `npm run typecheck:test`, `npm test`, `npm run clean && NODE_ENV=production npm run build`, `npm run pack:consumer`, `npm run security:audit`, `npm --silent run sbom`, and `npm run test:e2e`.
- [x] Run `git diff --check`, stage intended files, and report that commit/push remain pending approval.

## Self-Review

- The spec has one deliverable: owner-first snapshot consumption in the existing package; no new dashboard or backend subsystem is smuggled into this change.
- Snapshot path, cache identity, rendering, events, docs, and E2E each have an owning task.
- No task depends on an undefined function or a backend change outside this repository.
- The five highest-risk input classes are explicitly assigned tests in Tasks 1–3.
