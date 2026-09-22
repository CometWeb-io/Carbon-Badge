# @cometweb/carbon-badge

Web component that shows **CO₂e per page view** for the current page (or a URL you pass in). Bundle is about **8 KB gzipped**, zero runtime dependencies, with a CI size budget to prevent silent growth.

Uses [CometWeb](https://cometweb.io) and a documented **SWDM v4 first-load lite approximation**. It is not the full SWDM v4 visitor/cache model. Product page: [cometweb.io/carbon-badge](https://cometweb.io/carbon-badge).

Current release: **1.0.8** (fail-closed honesty: no measurement → **N/D**, never a letter from empty/`0` fallback).

## Owner-first embed

For a website owner, use a published CometWeb snapshot. It is a cheap,
stable read for visitors: it does not start a scan, the displayed result is
dated, and the proof link points to the published measurement.

```html
<script type="module" src="https://cometweb.io/scripts/cometweb-carbon-badge.esm.js"></script>
<cometweb-carbon-badge
  snapshot-id="<published_public_id>"
  theme="light">
</cometweb-carbon-badge>
```

Replace `<published_public_id>` with the lowercase hexadecimal public ID from
the published CometWeb ecology snapshot. Keep `mode` unset: a `snapshot-id`
automatically selects snapshot mode. Use live `api` mode only when you
explicitly want URL-based measurement on the visitor path.

Snapshot results include their measurement date, freshness deadline, method,
formula ID, status, and evidence URL. Expired, revoked, missing, or partial
data is never labelled as verified and never becomes a trustworthy letter
grade.

## Install

### Self-host (recommended in production)

Download the ESM build and serve it from your origin:

```html
<script type="module" src="https://cometweb.io/scripts/cometweb-carbon-badge.esm.js"></script>

<cometweb-carbon-badge theme="dark"></cometweb-carbon-badge>
```

Verify in DevTools: `customElements.get('cometweb-carbon-badge')`.

### CDN (pin the version)

```html
<script type="module" src="https://unpkg.com/@cometweb/carbon-badge@1.0.8/dist/cometweb-carbon-badge.esm.js"></script>

<cometweb-carbon-badge theme="dark"></cometweb-carbon-badge>
```

Prefer self-host if the pinned CDN build is unavailable.

### npm

```bash
npm install @cometweb/carbon-badge@1.0.8
```

```js
import '@cometweb/carbon-badge';
// or: import { registerCarbonBadge } from '@cometweb/carbon-badge';
```

```html
<cometweb-carbon-badge
  snapshot-id="<published_public_id>"
  theme="light"
></cometweb-carbon-badge>
```

## Attributes

| Attribute     | Default                         | Description |
|---------------|---------------------------------|-------------|
| `url`         | current page URL                | Page to measure (API mode). Credential-bearing URLs are rejected; known tracking parameters are stripped |
| `snapshot-id` | —                              | Published CometWeb public ID; selects cheap, stable snapshot mode when `mode` is omitted |
| `mode`        | `api` or `snapshot` with ID    | `snapshot` — published result; `api` — live public API; `estimate` — client-side SWDM v4 first-load lite |
| `theme`       | `dark`                          | Allowlisted: `dark` or `light` |
| `cache-ttl`   | `720`                           | Client cache TTL in minutes for API/estimate mode (12 h default), capped by the server `valid_until` deadline |
| `api-url`     | `https://app.cometweb.io/api`   | Override API base URL; HTTPS is required except localhost |
| `api-key`     | —                               | Optional **publishable/scoped** Bearer token. Never put a private secret in HTML; authenticated requests are restricted to the trusted default API origin |
| `green-host`  | `false`                         | Set `"true"` in `estimate` mode when the host is green-powered |

## Modes

- **`snapshot`** — fetches `GET /public/carbon-badge/id/{public_id}`. It never starts a URL scan. Invalid, missing, mismatching, malformed, stale, partial, or revoked snapshots render **N/D**. The client requires the response to identify the same published snapshot with a valid measurement date and freshness deadline. This is the recommended owner path.
- **`api`** — fetches `GET /public/carbon-badge`. Invalid/empty payloads render **N/D**. A remote `url` never falls back to estimating the host page.
- **`estimate`** — measures transfer with the Performance Resource Timing API, then applies `swdm-v4-lite-first-load-v1` in the browser. It uses decimal GB and the SWDM v4 first-load intensities; it does not implement visitor/cache ratios or Green Web Foundation lookup. DOM size is explicitly `partial`; if neither timing nor DOM measurement is available, the result is **N/D**.

Cheap published snapshot read (server): `GET /api/public/carbon-badge/id/{public_id}` — no HTTP re-scan.

### Footer label

| Condition | Footer text |
|-----------|-------------|
| Published snapshot returns `verified: true`, `status: ready`, a public ID, valid current `measured_at`/`valid_until` dates, and an evidence URL on an allowlisted CometWeb origin | **Verified by CometWeb** |
| Estimate mode, stale/partial/revoked/unknown result, or untrusted/missing evidence | **Powered by CometWeb** |

Percentile (“% of web”) is shown only when the API provides a real `cleaner_than` / benchmark — never invented.

## Scoring

Letter grades are fixed public badge bands (not Insight Ecology UI thresholds):

| Score | CO₂e / visit | Meaning |
|-------|--------------|---------|
| A+    | &lt; 0.10 g  | Exceptionally clean |
| A     | &lt; 0.20 g  | Very clean |
| B     | &lt; 0.40 g  | Cleaner than average |
| C     | &lt; 0.70 g  | Average |
| D     | &lt; 1.00 g  | Above average |
| F     | ≥ 1.00 g     | High emissions |

Sales promise (honest): *estimated page-load footprint — with date, method, and a link to the result* — not ESG certification and not a fake web-wide percentile.

## Methodology

SWDM v4 first-load lite approximation (Green Web Foundation / sustainablewebdesign.org):

```
CO₂e = data_GB × (E_operational + E_embodied) × grid_intensity

E_operational = 0.055 × hosting_factor + 0.059 + 0.080 kWh/GB
E_embodied = 0.012 + 0.013 + 0.081 kWh/GB
grid_intensity = 494 gCO₂e/kWh
```

`data_GB` uses `bytes / 1,000,000,000`. In `estimate` mode, `green-host="true"` scales only the data-centre operational term (×0.3). Network, user device, and embodied terms stay full intensity. Full SWDM v4 visitor/cache ratios are not claimed by this package.

## Events

| Event | When |
|-------|------|
| `cometweb:badge-load` | Data rendered (`detail`: url, co2Grams, score, cleanerThan, pageWeightKb, greenHost, source, mode, publicId, status, formulaId, measuredAt, verified, measuredResourceCount, unknownResourceCount, coverageRatio) |
| `cometweb:badge-error` | Measurement failed (`detail`: sanitized `url`, `mode`, `reason`, `status`) |

```js
document.querySelector('cometweb-carbon-badge')
  ?.addEventListener('cometweb:badge-load', (e) => {
    console.log(e.detail.score, e.detail.co2Grams, e.detail.status);
  });
```

## Build / test (maintainers)

```bash
npm ci
npm test
npm run typecheck
npm run typecheck:test
npm run clean && NODE_ENV=production npm run build
npm run size:check
npm run security:audit
npm --silent run sbom > carbon-badge-sbom.cdx.json
npm run pack:consumer
npm run test:e2e
npm pack --dry-run
```

Pull requests also run CodeQL and dependency review. Pushes to `main` produce a
CycloneDX SBOM and an attested package artifact; the workflow does not publish
to npm automatically.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## License

MIT © [CometWeb](https://cometweb.io)
