# Carbon Badge reference

[Back to the quick start](../README.md)

## Attributes

| Attribute     | Default                         | Description |
|---------------|---------------------------------|-------------|
| `url`         | current page URL                | Page to measure (API mode). Canonicalized: fragment + tracking/auth query stripped |
| `mode`        | `api`                           | `api` — CometWeb public API; `estimate` — client-side SWDM v4 lite |
| `variant` | `default` | `default` card, `compact` strip or `minimal` transparent footer. Unknown values use the default card. Changes apply without a new measurement. |
| `theme`       | `dark`                          | Allowlisted: `dark` or `light` |
| `cache-ttl`   | `720`                           | Client cache TTL in minutes (12 h default). Key includes URL/mode/api-url/green-host/schema |
| `api-url`     | `https://app.cometweb.io/api`   | Override API base URL |
| `api-key`     | —                               | Optional Bearer header. **Does not raise public rate limits** today — treat as future/private endpoint only |
| `green-host`  | `false`                         | Set `"true"` in `estimate` mode when the host is green-powered |

## Modes

- **`api`** — fetches `GET /public/carbon-badge`. Invalid/empty payloads render **N/D**. A remote `url` never falls back to estimating the host page.
- **`estimate`** — measures transfer with the Performance Resource Timing API, then applies a simplified SWDM v4 formula in the browser. It has different coverage from a server analysis; no accuracy percentage is guaranteed. `green-host` is a caller-supplied assertion, not a Green Web Foundation lookup. Missing transfer may show **partial** status (not a silent 500 KB “measurement”).

Cheap published snapshot read (server): `GET /api/public/carbon-badge/id/{public_id}` — no HTTP re-scan.

### Footer label

| Condition | Footer text |
|-----------|-------------|
| API returns `verified: true` (embed origin matches the measured URL) | **Verified by CometWeb** |
| Estimate mode, or API `verified: false` / missing | **Powered by CometWeb** |

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
| `cometweb:badge-load` | Data rendered (`detail`: url, co2Grams, score, cleanerThan, pageWeightKb, greenHost, source, status, formulaId, measuredAt) |
| `cometweb:badge-error` | Measurement failed (`detail`: url) |

```js
document.querySelector('cometweb-carbon-badge')
  ?.addEventListener('cometweb:badge-load', (e) => {
    console.log(e.detail.score, e.detail.co2Grams, e.detail.status);
  });
```
