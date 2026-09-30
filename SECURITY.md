# Security Policy

## Supported versions

Security fixes are applied to the latest published release of
`@cometweb/carbon-badge` on npm. Older CDN paths under
`/scripts/carbon-badge/<version>/` are immutable; upgrade the embed URL rather
than expecting in-place patches of historical artefacts.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Email **hello@cometweb.io** with:

- affected package version / CDN URL / git SHA
- reproduction steps or a minimal PoC
- impact assessment (integrity of Verified claims, XSS, supply chain, etc.)

We aim to acknowledge within **3 business days** and to provide a status update
within **10 business days**. Coordinated disclosure is preferred.

## Trust boundary notes

- `Verified by CometWeb` requires a fresh network response from a published
  snapshot. Host-page `localStorage` cache entries are never treated as proof.
- Self-declared `green-host` does not improve local estimate grades.
- Server-side URL measurement (SSRF controls) lives in the CometWeb Insight API,
  not in this client package.
