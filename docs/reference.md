# Carbon Badge reference

[Back to the quick start](../README.md)

## Attributes

| Attribute     | Default                         | Description |
|---------------|---------------------------------|-------------|
| `url`         | current page URL                | Page to measure (API mode). Canonicalized: fragment + tracking/auth query stripped |
| `snapshot-id` | —                               | Published CometWeb public ID; selects snapshot mode when `mode` is omitted |
| `mode`        | `api` or `snapshot` with ID     | `snapshot` — published result; `api` — CometWeb public API; `estimate` — client-side SWDM v4 lite |
| `variant`     | `default`                       | `default` card, `compact` strip or `minimal` transparent footer. Unknown values use the default card. Changes apply without a new measurement. |
| `theme`       | `dark`                          | Allowlisted: `dark` or `light` |
| `cache-ttl`   | `720`                           | Client cache TTL in minutes (12 h default). Key includes URL/mode/api-url/green-host/schema |
| `api-url`     | `https://app.cometweb.io/api`   | Override API base URL |
| `api-key`     | —                               | Optional Bearer header. **Does not raise public rate limits** today — treat as future/private endpoint only |
| `green-host`  | `false`                         | Set `"true"` in `estimate` mode when the host is green-powered |

## Modes

- **`snapshot`** — fetches `GET /public/carbon-badge/id/{public_id}`. It never starts a URL scan. The response must identify the requested published snapshot, have a valid runtime status, and include valid `measured_at` and `valid_until` dates. Missing, mismatching, stale, partial or revoked snapshots render **N/D**.
- **`api`** — fetches `GET /public/carbon-badge`. Invalid/empty payloads render **N/D**. A remote `url` never falls back to estimating the host page.
- **`estimate`** — measures transfer with the Performance Resource Timing API, then applies a simplified SWDM v4 formula in the browser. It has different coverage from a server analysis; no accuracy percentage is guaranteed. `green-host` is a caller-supplied assertion, not a Green Web Foundation lookup. Missing transfer may show **partial** status (not a silent 500 KB “measurement”).

Cheap published snapshot read (server): `GET /api/public/carbon-badge/id/{public_id}` — no HTTP re-scan.

### Footer label

| Condition | Footer text |
|-----------|-------------|
| Published snapshot returns `verified: true`, `status: ready`, a public ID, fresh `measured_at`/`valid_until` dates and an allowlisted HTTPS evidence URL | **Verified by CometWeb** |
| Estimate mode, stale/partial/revoked/unknown result, or untrusted/missing evidence | **Powered by CometWeb** |

Percentile (“% of web”) is shown only when the API provides a real `cleaner_than` / benchmark — never invented.

## Scoring

Letter grades are fixed public badge bands (not Insight Ecology UI thresholds):

| Score | CO₂e / visit | Meaning |
|-------|--------------|---------|
| A+    | &lt; 0.10 g  | Exceptionally clean |
| A     | &lt; 0.20 g  | Very clean |
| B     | &lt; 0.40 g  | Band B |
| C     | &lt; 0.70 g  | Band C |
| D     | &lt; 1.00 g  | Band D |
| F     | ≥ 1.00 g     | High emissions |

Sales promise (honest): *estimated page-load footprint — with date, method, and a link to the result* — not ESG certification and not a fake web-wide percentile.

## Methodology

SWDM v4 hybrid form (Green Web Foundation / sustainablewebdesign.org):

```
CO₂e = (E_dc × CI) + (E_net × CI) + (E_user × CI) + (E_embodied × CI)
```

In `estimate` mode, `green-host="true"` scales only the data-centre term (×0.3). Network, user device, and embodied terms stay full intensity.

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
