# Carbon Badge reference

[Back to the quick start](../README.md)

## Attributes

| Attribute     | Default                         | Description |
|---------------|---------------------------------|-------------|
| `url`         | current page URL                | Page to measure (API mode). Public identity is **origin + pathname** — all query parameters are stripped by default |
| `snapshot-id` | —                               | Published CometWeb public ID; selects snapshot mode when `mode` is omitted |
| `mode`        | `api` or `snapshot` with ID     | `snapshot` — published result; `api` — CometWeb public API; `estimate` — client-side SWDM v4 lite |
| `variant`     | `default`                       | `default` card, `compact` strip or `minimal` transparent footer. Unknown values use the default card. Changes apply without a new measurement. |
| `theme`       | `dark`                          | Allowlisted: `dark` or `light` |
| `cache-ttl`   | `720`                           | Client cache TTL in minutes (12 h default). Key includes URL/mode/api/green-host/schema |
| `green-host`  | `false`                         | Set `"true"` in `estimate` mode when the host is green-powered |

`api-url` and `api-key` are **not** part of the public Web Component API. The runtime always uses `https://app.cometweb.io/api` (loopback allowed only for local development builds). Secrets must never appear in HTML attributes — proxy through your backend if private endpoints are required.

## Modes

- **`snapshot`** — fetches `GET /public/carbon-badge/id/{public_id}`. It never starts a URL scan. The response must identify the requested published snapshot, include a known `status`, a measurable `url`, and valid `measured_at` / `valid_until` dates. Missing, mismatching, stale, partial or revoked snapshots render **N/D**.
- **`api`** — fetches `GET /public/carbon-badge`. Responses without `status` or `url`, or with mismatched URL identity, render **N/D**. A remote `url` never falls back to estimating the host page.
- **`estimate`** — waits for page load + a short Resource Timing quiet period, measures transfer, then applies a simplified SWDM v4 formula. DOM size is **never** used as a carbon score input. Missing timing yields **N/D**.

Cheap published snapshot read (server): `GET /api/public/carbon-badge/id/{public_id}` — no HTTP re-scan.

### Footer label

| Condition | Footer text |
|-----------|-------------|
| Published snapshot returns `verified: true`, `status: ready`, a public ID, fresh dates, and an evidence URL bound to `/carbon-badge/{publicId}` on an allowlisted CometWeb origin | **Verified by CometWeb** |
| Estimate mode, stale/partial/revoked/unknown result, or untrusted/missing evidence | **Powered by CometWeb** |

Percentile (“% of modelled cohort”) is shown only when the API provides a real `cleaner_than` / benchmark — never invented.

## Scoring

Letters are the **CometWeb Carbon Score** (`carbon-badge-bands-v1`). They are product bands, **not** the public [Digital Carbon Rating Scale](https://sustainablewebdesign.org/digital-carbon-ratings/).

| CometWeb Score | CO₂e / visit | Meaning |
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

In `estimate` mode, `green-host="true"` sets `greenHostingFactor = 1` (removes the data-centre operational term). Network, user device, and embodied terms stay full intensity.

## Events

| Event | When |
|-------|------|
| `cometweb:badge-load` | Data rendered (`detail`: url, co2Grams, score, measurementSource, retrievalSource, status, formulaId, scoreModelId, …) |
| `cometweb:badge-error` | Measurement failed (`detail`: sanitized `url`, `mode`, `reason`, `status`) |

```js
document.querySelector('cometweb-carbon-badge')
  ?.addEventListener('cometweb:badge-load', (e) => {
    console.log(e.detail.score, e.detail.measurementSource, e.detail.retrievalSource);
  });
```
