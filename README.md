# @cometweb/carbon-badge

Web component that shows **CO₂e per page view** for the current page (or a URL you pass in). Bundle is under **5 KB gzipped**, zero runtime dependencies.

Uses [CometWeb](https://cometweb.io) and the **Sustainable Web Design Model v4** (SWDM v4). Product page: [cometweb.io/carbon-badge](https://cometweb.io/carbon-badge).

Current release: **1.0.7**.

## Install

### CDN (pin the version)

```html
<script type="module" src="https://unpkg.com/@cometweb/carbon-badge@1.0.7/dist/cometweb-carbon-badge.esm.js"></script>

<cometweb-carbon-badge theme="dark"></cometweb-carbon-badge>
```

### Lazy-load the script

Load the module only when the badge approaches the viewport (keeps it off the critical path):

```html
<cometweb-carbon-badge theme="dark"></cometweb-carbon-badge>

<script>
  (function () {
    var el = document.querySelector('cometweb-carbon-badge');
    if (!el) return;
    var src = 'https://unpkg.com/@cometweb/carbon-badge@1.0.7/dist/cometweb-carbon-badge.esm.js';
    var io = new IntersectionObserver(function (entries) {
      var e = entries[0];
      if (!e.isIntersecting) return;
      io.disconnect();
      var s = document.createElement('script');
      s.type = 'module';
      s.src = src;
      document.body.appendChild(s);
    }, { rootMargin: '200px', threshold: 0 });
    io.observe(el);
  })();
</script>
<link rel="preconnect" href="https://unpkg.com" crossorigin />
```

### npm

```bash
npm install @cometweb/carbon-badge@1.0.7
```

```js
import '@cometweb/carbon-badge';
```

```html
<cometweb-carbon-badge
  url="https://your-site.com"
  theme="dark"
  mode="estimate"
></cometweb-carbon-badge>
```

## Attributes

| Attribute     | Default                         | Description |
|---------------|---------------------------------|-------------|
| `url`         | current page URL                | Page to measure |
| `mode`        | `api`                           | `api` — CometWeb public API; `estimate` — client-side SWDM v4 lite |
| `theme`       | `dark`                          | `dark` or `light` |
| `cache-ttl`   | `720`                           | Client cache TTL in minutes (12 h default) |
| `api-url`     | `https://app.cometweb.io/api`   | Override API base URL |
| `api-key`     | —                               | Optional Bearer token for higher rate limits. Stored as an HTML attribute — treat it as public; prefer short-lived tokens |
| `green-host`  | `false`                         | Set `"true"` in `estimate` mode when the host is green-powered |

## Modes

- **`api`** — fetches `GET /public/carbon-badge`. Letter grade on the badge is always mapped from measured grams with the bands below (same as `co2ToScore`), even if a cached payload carries a different letter.
- **`estimate`** — measures transfer with the Performance Resource Timing API, then applies a simplified SWDM v4 formula in the browser. Expect roughly **20–30%** variance vs a full server analysis; there is no Green Web Foundation lookup unless you set `green-host`.

### Footer label

| Condition | Footer text |
|-----------|-------------|
| API returns `verified: true` (embed origin matches the measured URL) | **Verified by CometWeb** |
| Estimate mode, or API `verified: false` / missing | **Powered by CometWeb** |

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

## Methodology

SWDM v4 hybrid form (Green Web Foundation / sustainablewebdesign.org):

```
CO₂e = (E_dc × CI) + (E_net × CI) + (E_user × CI) + (E_embodied × CI)
```

In `estimate` mode, `green-host="true"` scales only the data-centre term (×0.3). Network, user device, and embodied terms stay full intensity.

## Events

| Event | When |
|-------|------|
| `cometweb:badge-load` | Data rendered (`detail`: url, co2Grams, score, cleanerThan, pageWeightKb, greenHost, source) |
| `cometweb:badge-error` | Measurement failed (`detail`: url) |

```js
document.querySelector('cometweb-carbon-badge')
  ?.addEventListener('cometweb:badge-load', (e) => {
    console.log(e.detail.score, e.detail.co2Grams);
  });
```

## Build / test (maintainers)

```bash
npm ci
npm test
npm run typecheck
npm run clean && NODE_ENV=production npm run build
```

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## License

MIT © [CometWeb](https://cometweb.io)
