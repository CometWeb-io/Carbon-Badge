# CometWeb Carbon Badge

Web component that shows estimated **CO₂e per page view**, its source and measurement status. It has zero runtime dependencies, light/dark themes, three visual variants and a bundle of about **8 KB gzipped** with a CI size budget.

![A page or API result becomes a carbon estimate with its method and status; missing data stays N/D.](docs/media/overview.svg)

[![MIT](https://img.shields.io/badge/license-MIT-034C32)](LICENSE)

The badge uses [CometWeb](https://cometweb.io) and documents a **SWDM v4 first-load lite approximation**. It is not a full visitor/cache model, an ESG certificate or a claim of a web-wide percentile. Product page: [cometweb.io/carbon-badge](https://cometweb.io/carbon-badge).

## Owner-first embed

For a website owner, use a published CometWeb snapshot. It is a cheap, stable read for visitors: it does not start a scan, the result is dated and the proof link points to the published measurement.

Prefer an immutable, versioned asset with Subresource Integrity. After
`npm run build && npm run sri`, copy the `esm.sri` value from
`dist/release-manifest.json` into the `integrity` attribute. Do not hotlink an
unversioned `/scripts/cometweb-carbon-badge.esm.js` path in production embeds.

```html
<script
  type="module"
  src="https://cometweb.io/scripts/carbon-badge/1.0.9/cometweb-carbon-badge.esm.js"
  integrity="sha384-<from dist/release-manifest.json esm.sri>"
  crossorigin="anonymous"></script>
<cometweb-carbon-badge
  snapshot-id="<published_public_id>"
  theme="light">
</cometweb-carbon-badge>
```

Replace `<published_public_id>` with the lowercase hexadecimal public ID from the published CometWeb ecology snapshot. Keep `mode` unset: a `snapshot-id` automatically selects snapshot mode. Use live `api` mode only when you explicitly want URL-based measurement on the visitor path.

Snapshot results include their measurement date, freshness deadline, method, formula ID, status and evidence URL. Expired, revoked, missing or partial data is never labelled as verified and never becomes a trustworthy letter grade.

## See the component

| Light | Dark | No measurement |
| :---: | :---: | :---: |
| ![Light theme: pale green grade tile, emissions value and subtle attribution.](docs/media/badge-light.png) | ![Dark theme: solid dark green surface and pale green grade tile.](docs/media/badge-dark.png) | ![Unavailable measurement: N/D with a Retry button.](docs/media/badge-unavailable.png) |

These are component screenshots with synthetic fixture data, not measurements of a live website.

## Choose a look

| Variant | Light | Dark |
| --- | --- | --- |
| `default` — card | ![Default light card](docs/media/badge-light.png) | ![Default dark card](docs/media/badge-dark.png) |
| `compact` — small strip | ![Compact light strip](docs/media/badge-compact-light.png) | ![Compact dark strip](docs/media/badge-compact-dark.png) |
| `minimal` — footer signature | ![Minimal light signature](docs/media/badge-minimal-light.png) | ![Minimal dark signature](docs/media/badge-minimal-dark.png) |

```html
<cometweb-carbon-badge variant="compact" theme="light" mode="estimate"></cometweb-carbon-badge>
<cometweb-carbon-badge variant="minimal" theme="dark" mode="estimate"></cometweb-carbon-badge>
```

Omit `variant` for the default card. All variants retain the estimate, source/status and attribution. `minimal` has a transparent background: use the light theme on a light surface and dark on a dark surface. Changing the variant does not fetch a new measurement.

## Install and add it to a page

The code in this repository is version **1.0.9**. Build it locally when you need the exact behavior documented here:

```bash
git clone https://github.com/CometWeb-io/Carbon-Badge.git
cd Carbon-Badge
npm ci
npm run build
```

Copy `dist/cometweb-carbon-badge.esm.js` to your site's public assets, for example `/vendor/`, then add:

```html
<script type="module" src="/vendor/cometweb-carbon-badge.esm.js"></script>
<cometweb-carbon-badge theme="light" mode="estimate"></cometweb-carbon-badge>
```

For a bundler, install the built package (`npm install /path/to/Carbon-Badge`) and use `import '@cometweb/carbon-badge';`.

## Choose a mode

| Mode | Data source | Setup |
| --- | --- | --- |
| `snapshot` | Published CometWeb measurement | Set `snapshot-id`; recommended owner path |
| `estimate` | Current page's browser transfer data and simplified SWDM v4 calculation | Explicitly set `mode="estimate"` |
| `api` (default) | CometWeb public carbon-badge endpoint | Network access; optionally set `url` |

An unavailable measurement displays **N/D**, not a made-up A+ score. A remote URL in API mode never falls back to estimating the host page. API mode is an external service dependency; the component's MIT license does not guarantee service availability.

## Common options

```html
<cometweb-carbon-badge
  snapshot-id="<published_public_id>"
  variant="compact"
  theme="light">
</cometweb-carbon-badge>
```

`green-host` is a self-declared hosting assertion in estimate mode. It is not checked against a registry and **does not change the local letter grade**. Letter grades are fixed product bands; a percentile appears only when supplied by the API.

| Attribute | Default | Description |
| --- | --- | --- |
| `url` | current page URL | Page to measure in API mode; public identity is origin + pathname (query stripped by default) |
| `snapshot-id` | — | Published CometWeb public ID; selects snapshot mode when `mode` is omitted |
| `mode` | `api` or `snapshot` with ID | `snapshot` — published result; `api` — live public API; `estimate` — client-side SWDM v4 first-load lite |
| `variant` | `default` | `default` card, `compact` strip or `minimal` transparent signature; changes do not reload data |
| `theme` | `dark` | Allowlisted: `dark` or `light` |
| `cache-ttl` | `720` | Client cache TTL in minutes for API/estimate mode, capped by the server `valid_until` deadline |
| `green-host` | `false` | Set `"true"` in estimate mode when the host is green-powered |
| `allow-query` | — | Optional comma-separated query keys to keep in public URL identity (default: strip all query) |

`api-url` / `api-key` are not public attributes. The badge talks only to `https://app.cometweb.io/api`.

## Modes and provenance

- **`snapshot`** fetches `GET /public/carbon-badge/id/{public_id}`. It never starts a URL scan. Invalid, missing, mismatching, malformed, stale, partial or revoked snapshots render **N/D**. The client requires the response to identify the same published snapshot with valid measurement and freshness dates.
- **`api`** fetches `GET /public/carbon-badge`. Invalid or empty payloads render **N/D**. A remote `url` never falls back to estimating the host page.
- **`estimate`** waits for page quiescence, measures transfer with Resource Timing, then applies `swdm-v4-lite-first-load-v1`. DOM size is never used as a carbon score. Missing timing renders **N/D**.

Cheap published snapshot read on the server: `GET /api/public/carbon-badge/id/{public_id}` — no HTTP re-scan.

### Footer label

| Condition | Footer text |
| --- | --- |
| Published snapshot returns `verified: true`, `status: ready`, a public ID, fresh dates, and an evidence URL bound to `/carbon-badge/{publicId}` on an allowlisted CometWeb origin | **Verified by CometWeb** |
| Estimate mode, stale/partial/revoked/unknown result, or untrusted/missing evidence | **Powered by CometWeb** |

## Scoring and methodology

Letters are the **CometWeb Carbon Score** (`carbon-badge-bands-v1`) — product bands, not the public Digital Carbon Rating Scale.

| CometWeb Score | CO₂e / visit | Meaning |
| --- | ---: | --- |
| A+ | < 0.10 g | Exceptionally clean |
| A | < 0.20 g | Very clean |
| B | < 0.40 g | Band B |
| C | < 0.70 g | Band C |
| D | < 1.00 g | Band D |
| F | ≥ 1.00 g | High emissions |

```text
CO₂e = data_GB × (E_operational + E_embodied) × grid_intensity

E_operational = 0.055 × (1 − greenHostingFactor) + 0.059 + 0.080 kWh/GB
E_embodied = 0.012 + 0.013 + 0.081 kWh/GB
grid_intensity = 494 gCO₂e/kWh
```

`data_GB` uses `bytes / 1,000,000,000`. In estimate mode, `green-host="true"` is recorded as a self-declared assertion but does not change `greenHostingFactor` (always 0 in local estimate mode). See the [full reference](docs/reference.md) for the complete contract.

## Events

| Event | When |
| --- | --- |
| `cometweb:badge-load` | Data rendered (`detail`: url, co2Grams, score, measurementSource, retrievalSource, status, formulaId, scoreModelId, …) |
| `cometweb:badge-error` | Measurement failed (`detail`: sanitized `url`, `mode`, `reason`, `status`) |

```js
document.querySelector('cometweb-carbon-badge')
  ?.addEventListener('cometweb:badge-load', (event) => {
    console.log(event.detail.score, event.detail.co2Grams, event.detail.status);
  });
```

## Build and test

```bash
npm ci
npm run build
npm test
npm run typecheck
npm run typecheck:test
npm run clean && NODE_ENV=production npm run build
npm run size:check
npm run security:audit
npm run pack:consumer
npm run test:e2e
npm pack --dry-run
```

Pull requests also run CodeQL and dependency review. Pushes to `main` produce a CycloneDX SBOM and an attested package artifact; the workflow does not publish to npm automatically.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

[MIT license](LICENSE) · [Changelog](CHANGELOG.md) · [Product page](https://cometweb.io/carbon-badge)
