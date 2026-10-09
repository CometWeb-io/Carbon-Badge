# Carbon Badge reference

[Back to the quick start](../README.md)

## Distribution entries

`@cometweb/carbon-badge/embed` registers the component as an ESM side effect with no public named exports. It supports all badge modes, but loads API parsing, HTTP/retry and cache code only when an explicit network mode becomes visible. Local mode never imports that module or accesses storage. `@cometweb/carbon-badge/api` exposes the client/parser without loading UI; it supports ESM and CommonJS. The root package keeps its existing named exports and registration behavior in one ESM or UMD file.

Self-host the entire `dist/embed/` directory under an immutable version path, retaining its names and relative structure. Every module needs a JavaScript MIME type and, when cross-origin, CORS and Timing-Allow-Origin headers. CSP `script-src` must allow the module origin; `connect-src` must allow the API origin only for network modes. A bundler must retain dynamic imports to preserve lazy loading. Prefer the single-file SDK for classic scripts or a policy requiring one SRI to cover the whole runtime.

An embed module load has a separate 8-second deadline before API work begins. Missing, blocked or timed-out chunks render N/D; they never trigger a local-grade fallback. Disconnecting or changing attributes cancels the measurement continuation and retry delay. Native `import()` cannot abort the chunk's asset request; a late module may finish loading but cannot start the cancelled API call or render its grade. The existing 8-second HTTP/body timeout then applies independently per request, with bounded retries.

The release manifest retains its legacy root ESM/UMD fields and adds API formats, the embed graph (static and dynamic imports), initial/optional file lists, and an `artifacts` array with SHA-256, SRI, byte count and gzip byte count for every JavaScript file. **Entry SRI does not verify imported chunks in the browser**; artifact hashes allow release/package verification, not a transitive browser integrity claim. CI totals the full static-import closure for the 10,500 B initial embed budget and all embed modules for the 15,000 B full-network budget. SDK formats each retain 13,800 B limits; API formats each have 3,500 B limits. Sizes are gzip level 9 per file; HTTP headers, JSON responses and uncompressed parsing costs are separate.

Build-artifact browser tests cover the split graph, CORS and SRI. `test:e2e:source` skips these cases; it is a development check, not the release gate.

## Attributes

| Attribute     | Default                         | Description |
|---------------|---------------------------------|-------------|
| `url`         | current page URL                | Page to measure (API mode). Public identity is **origin + pathname** — all query parameters and fragments are always stripped |
| `snapshot-id` | —                               | Published CometWeb public ID; selects snapshot mode when `mode` is omitted |
| `mode`        | `estimate` or `snapshot` with ID     | `snapshot` — published result; `api` — CometWeb public API; `estimate` — client-side SWDM v4 lite |
| `variant`     | `default`                       | `default` card, `compact` strip or `minimal` transparent footer. Unknown values use the default card. Changes apply without a new measurement. |
| `theme`       | `dark`                          | Allowlisted: `dark` or `light` |
| `cache-ttl`   | `720`                           | Client cache TTL for cacheable API responses only. Published snapshots and `Cache-Control: no-store` bypass local storage. |
| `green-host` | `false` | Legacy; ignored in local mode |
| `lang` | inherited at connection | `pl` or `en`, otherwise English; attribute changes rerender only |
| `loading` | lazy in API/snapshot | Fetch within 200 px of the viewport; `eager` bypasses visibility waiting |
| `nonce` | — | Host CSP nonce for fallback style |

`snapshot-id` cannot be combined with `mode="api"` or `mode="estimate"`. That conflict shows **N/D** without a request or local grade. Omit `mode` or use `mode="snapshot"` for a published ID. A blank `snapshot-id` also shows **N/D**.

`api-url` and `api-key` are **not** part of the public Web Component API. The runtime always uses `https://app.cometweb.io/api` (loopback allowed only for local development builds). Secrets must never appear in HTML attributes — proxy through your backend if private endpoints are required.

## Modes

- **`snapshot`** — fetches `GET /public/carbon-badge/id/{public_id}`. It never starts a URL scan. The response must identify the requested published snapshot, include a known `status`, a measurable `url`, valid `measured_at` / `valid_until` dates, `formula_id`, `measurement_method`, and `score_model_id` matching `carbon-badge-bands-v1`. Missing, mismatching, stale, partial, expired or revoked snapshots render **N/D**.
- **`api`** — fetches `GET /public/carbon-badge`. Responses without `status` or `url`, or with mismatched URL identity, render **N/D**. A remote `url` never falls back to estimating the host page. Published results are fetched again on each load to respect revocation.
- URL mode removes all query parameters. For a backend snapshot whose identity includes a semantic query, use `snapshot-id`; a query-free URL request will not select it.
- **`cometweb_scan`** — a source returned by the API for a scan; it never grants published-snapshot attribution or a snapshot proof link on its own.
- Unknown, empty or null `measurement_source` values fail closed to **N/D**. The `api` fallback applies only when the field is absent from a legacy response.
- **`estimate`** — waits for page load + a short Resource Timing quiet period, measures transfer, then applies a simplified SWDM v4 formula. DOM size is **never** used as a carbon score input. Partial Resource Timing (unknown transfer sizes) withholds the letter. Missing timing yields **N/D**.
- **Attribute conflict** — `snapshot-id` together with `mode="api"` or `mode="estimate"` fails closed to **N/D** (`Conflicting mode and snapshot-id`). Omit `mode` to use the published snapshot, or omit `snapshot-id` for api/estimate.

Cheap published snapshot read (server): `GET /api/public/carbon-badge/id/{public_id}` — no HTTP re-scan.

### Footer label

| Condition | Footer text |
|-----------|-------------|
| Published snapshot returns `status: ready` over the **network**, a public ID, `formula_id`, `measurement_method`, `score_model_id === carbon-badge-bands-v1`, fresh dates, and an evidence URL bound to `/carbon-badge/{publicId}` on an allowlisted CometWeb origin | **Published by CometWeb** |
| Cache hit, estimate mode, stale/partial/revoked/unknown result, or untrusted/missing evidence | **Powered by CometWeb** |

Percentile (“% of modelled cohort”) is shown only when the API provides a real `cleaner_than` / benchmark — never invented.

## Scoring

Letters are the **CometWeb Carbon Score** (`carbon-badge-bands-v1`). They are product bands, **not** the public [Digital Carbon Rating Scale](https://sustainablewebdesign.org/digital-carbon-ratings/).

| CometWeb Score | CO₂e / page load | Meaning |
|-------|--------------|---------|
| A+    | &lt; 0.10 g  | Exceptionally clean |
| A     | &lt; 0.20 g  | Very clean |
| B     | &lt; 0.40 g  | Band B |
| C     | &lt; 0.70 g  | Band C |
| D     | &lt; 1.00 g  | Band D |
| F     | ≥ 1.00 g     | High emissions |

Sales promise (honest): *estimated page-load footprint — with date, method, and a link to the result* — not ESG certification and not a claim of Digital Carbon Rating equivalence.

## Methodology

SWDM v4 hybrid form (Green Web Foundation / sustainablewebdesign.org):

```
CO₂e = data_GB × (E_operational + E_embodied) × grid_intensity
E_operational = 0.055 × (1 − greenHostingFactor) + 0.059 + 0.080 kWh/GB
E_embodied = 0.012 + 0.013 + 0.081 kWh/GB
grid_intensity = 494 gCO₂e/kWh
```

In `estimate` mode, `green-host="true"` is ignored and does not change `greenHostingFactor` (always 0 in local estimate mode). Network, user device, and embodied terms stay full intensity.

## Privacy and trust

URL query parameters and fragments are never retained in badge identity, requests, cache keys or event URLs. The removed `allow-query` attribute is ignored. The page pathname is still visible to an explicitly selected remote API: never use those modes for private pages.

“Published” describes the source of a snapshot, not domain ownership, independent verification or certification. `originMatched` only reports an API placement check; it is `null` when absent or not obtained over the network. No missing proof URL is manufactured from a public ID.

## Events

| Event | When |
|-------|------|
| `cometweb:badge-load` | Data rendered (`detail`: url, co2Grams, score, measurementSource, retrievalSource, status, formulaId, scoreModelId, published, originMatched, …) |
| `cometweb:badge-error` | Measurement failed (`detail`: sanitized `url`, `mode`, `reason`, `status`, resource visibility counts) |

```js
document.querySelector('cometweb-carbon-badge')
  ?.addEventListener('cometweb:badge-load', (e) => {
    console.log(e.detail.score, e.detail.measurementSource, e.detail.retrievalSource);
  });
```

## First-load observation contract (2.0.2 candidate)

`measurementScope: document-first-load` covers browser-visible navigation and resource entries. It is not a complete user session, a return-visit model or physical energy measurement. `networkTransferBytes` uses `transferSize` only; `encodedBodyBytes` is separate. A zero transfer with a visible encoded body is a cache hit; a transfer smaller than that body is a conditional revalidation. `cachedBodyBytes` reports the body served from cache, never network transfer. Either case withholds the first-load letter (`cache-outside-first-load`).

`networkTransferBytes` is a lower bound when timing is incomplete. `transferUpperBoundBytes` is null when resources are unobservable or history overflowed; counts cannot establish a byte upper bound. Local `pageWeightKiB` uses 1024 bytes and `pageWeightKB` uses 1000. `pageWeightKb` retains its rounded legacy binary value. API `page_weight_kb` remains an opaque legacy unit until the provider contract is confirmed; explicit KB/KiB fields are null for that source.

A changed document URL, including a query-only SPA transition, produces `stale` / `document-url-changed`. Changes after initialization include fragments. A late embed compares the navigation entry's URL as well; hash-only routing before initialization cannot be reconstructed. The component does not monkey-patch the host's history API. Local mode checks for URL changes every second; call `reload()` for immediate invalidation. Its next observation withholds a new route grade.

A hard quiescence deadline produces `partial` / `quiescence-timeout`. API lifecycle states survive in `badgeData`, `measurementStatus` and the error event with null grams and score. Unknown statuses and mismatched subjects are rejected. Explicit malformed/future/inverted dates withhold the grade; expired results retain `stale`. Legacy non-published API responses may omit dates and cannot gain a publication label. Published snapshots require a complete fresh time window.

Snapshot IDs identify the measured subject independently of the embedding page. All variants show that subject's host and pathname without query/fragment. A snapshot displayed on another page, including another path on the same host, has a visible warning. “Published by CometWeb” is vendor attribution, not ownership, independent verification or certification.

`allow-query` is ignored in 2.x, including credential-like keys. The same query-free identity applies to local comparison, API request and response, cache keys and public events. Local and snapshot modes never use localStorage; only an explicitly selected API mode may cache a cacheable non-published response.

Release manifests include the source commit, dirty-state flag, source-tree and lockfile digests, build mode, Node version and exact artifact hashes/SRI. A dirty local candidate is not attributable to its base commit alone. CI refuses a dirty or mismatched checkout. Production 2.0.1 remains immutable; 2.0.2 is unpublished until separately released.

The first-load formula is checked against a golden matrix generated independently with `@tgwf/co2@0.19.0`, `new co2({ model: "swd", version: 4 }).perByte(bytes, false)`. The fixture records the npm integrity and explicit scope. It tests calculation parity only; it does not prove browser timing completeness or physical accuracy. Regenerate in a temporary directory with the pinned package, never with an unpinned library default. No oracle library is shipped to visitors.

## Model and cache identity

The local factor set is `swdm-v4-global-494-v1`. [model-factors.json](model-factors.json) records coefficients, decimal GB, review date and source. The source does not pin a grid dataset year, so `gridDataYear` is null. No regional intensity or confidence range is invented. Local measurement windows use elapsed document milliseconds, not wall-clock timestamps. The cutoff does not describe an entire visitor session.

Cache schema 8 includes package version, score-model ID and factor-set ID in its namespace and removes older badge-owned schemas. It never clears unrelated host storage. Non-published cached results omit proof URLs; fresh network results retain their validated URL. Published snapshots bypass storage entirely. Unknown cached sources/statuses/models cannot receive a letter. Network expiry forces a recheck while connected; disconnect cancels timers and subscriptions.

See [api-response.schema.json](api-response.schema.json) for the provider contract. Runtime checks also enforce subject identity, safe URLs, timestamp ordering and current freshness. The schema alone cannot validate those relationships, backend scan policy, revocation propagation or scientific accuracy.
