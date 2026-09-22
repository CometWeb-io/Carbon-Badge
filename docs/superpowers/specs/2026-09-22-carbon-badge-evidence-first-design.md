# Carbon Badge Evidence-First Design

## Outcome

Make the Carbon Badge a trustworthy owner-facing product while preserving a
small, dependency-free web component for agencies and developers. The primary
embed path is a published CometWeb measurement snapshot; live API and local
estimate remain explicit secondary modes.

## Audience and success criteria

The website owner is the primary user. An owner should be able to paste one
short snippet, understand what the badge means without reading methodology
documentation, and reach a stable public proof of the displayed result.
Agencies need a repeatable snapshot identity for client reports. Developers
need a typed component, predictable API selection, and observable lifecycle
events.

Success means:

- snapshot embeds do not trigger a remote scan per visitor;
- a displayed letter is always derived from a finite CO2 value and a usable
  status;
- the badge exposes freshness and provenance without claiming certification;
- stale, revoked, unknown, or invalid data renders N/D;
- the current `api` and `estimate` integrations remain backward compatible;
- package output remains dependency-free at runtime and under 5 KB gzipped.

## Product contract

### Explicit modes

`BadgeMode` becomes `snapshot | api | estimate`.

- `snapshot`: fetches `GET /public/carbon-badge/id/{public_id}`. A valid
  `snapshot-id` selects this mode when `mode` is omitted. The endpoint is a
  cheap read and never starts an HTTP measurement.
- `api`: keeps the current URL-based live public endpoint for developer and
  agency integrations.
- `estimate`: measures the embedding document locally and labels the result as
  a first-load lite estimate.

`snapshot-id` is validated as the existing public-id contract: lowercase
  hexadecimal, 1–64 characters. It is never interpolated into a URL without
  validation or escaping.

### Snapshot data

`BadgeData.publicId` is preserved when supplied by the API. The component also
keeps `measurement_source`, `measurement_method`, `measured_at`, `valid_until`,
`formula_id`, `status`, and `evidence_url` so a snapshot cannot be rendered as
an anonymous current score.

### Rendering states

- loading: neutral progress state with an accessible live region;
- ready snapshot: CO2, grade, “Measured <date>”, and a proof link;
- ready live/API: CO2, grade, and “Estimated page-load footprint”;
- partial estimate/API: score may render only with a visible partial label and
  no Verified footer;
- stale: N/D or an explicitly stale state, never Verified;
- revoked/unknown/unusable: N/D and retry action.

`Verified by CometWeb` requires `verified === true`, `status === ready`, a
trusted HTTPS evidence origin, and a published snapshot source. API responses
without a snapshot source may still be usable but use `Powered by CometWeb`.

### Owner embed

The canonical owner snippet is:

```html
<script type="module" src="https://cometweb.io/scripts/cometweb-carbon-badge.esm.js"></script>
<cometweb-carbon-badge snapshot-id="<public_id>" theme="light"></cometweb-carbon-badge>
```

The README must explain that `public_id` comes from a published CometWeb
ecology snapshot and that live URL mode is not the recommended owner path.

## Architecture

- `api-client.ts` owns URL validation, endpoint construction, and retry parsing.
- `normalize.ts` owns API-to-domain conversion and status/freshness rules.
- `render.ts` owns pure markup and provenance-aware labels.
- `cache.ts` owns per-entry TTL and cache identity, including snapshot IDs.
- `badge.ts` owns only custom-element lifecycle, fetch orchestration, event
  dispatch, and Shadow DOM mounting.

No backend changes are required in this package: the Insight backend already
exposes the public snapshot read path. This package must consume that endpoint
without silently falling back to the URL-scanning endpoint.

## Privacy and security

- snapshot requests send only the validated public ID, `source=badge`, and the
  embedding origin;
- authenticated requests remain restricted to the trusted CometWeb API origin;
- URL-mode canonicalization rejects credentials and sensitive query parameters;
- local cache keys include mode, snapshot identity, API base, green-host flag,
  and schema;
- no private credential is promised in HTML; `api-key` remains publishable and
  scoped if used at all.

## Verification

Add unit tests for snapshot-id validation, endpoint selection, source/provenance
normalization, date rendering, stale/revoked behavior, cache identity, and
backward-compatible API mode. Add browser E2E coverage for a ready snapshot,
stale snapshot, missing snapshot, and explicit mode override. Re-run typecheck,
build, package consumer smoke, audit, SBOM, and Playwright before staging.
