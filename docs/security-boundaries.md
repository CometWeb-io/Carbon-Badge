# Security boundaries

The badge displays a modelled estimate from browser timing or a public provider. It does not verify domain ownership, certify environmental claims or measure physical energy use.

| Boundary | Enforcement | Regression evidence |
| --- | --- | --- |
| Host attributes and page URL | HTTP(S) only, no credentials or control characters, 2048-character limit, query/fragment removal | `public-contract.test.ts`, `free-mode.test.ts` |
| Public provider response | Pinned API origin, redirect rejection, 64 KiB decoded-body limit, timeout and finite numeric validation | `api-client.test.ts`, `quality-hardening.test.ts` |
| Published result lifecycle | Subject/ID matching, known source/model, explicit timezone, valid calendar and freshness, network revalidation | `normalize.test.ts`, `public-contract.spec.ts`, `restore-and-force.spec.ts` |
| Host storage | Local mode never uses storage; published snapshots bypass localStorage; only badge-owned legacy keys are removed | `cache.test.ts`, `free-embed.spec.ts` |
| Multiple subscribers | Shared GETs isolate request options; the last subscriber cancels the request; disconnect prevents late rendering | `api-client.test.ts`, `modular.spec.ts` |
| Distribution | Source/lock digests, complete module graph and artifact hashes, exact-source consumer and installer checks | `generate-sri.test.mjs`, `pack:consumer`, `test:marketing` |

Rendering uses DOM text and attributes. Proof links are bound to an allowlisted HTTPS origin and the public measurement ID. A placement signal from an embedding page does not establish domain ownership. A digest or SRI value establishes byte integrity, not the truth of a carbon estimate.

Browser timing exposes completed entries. Cached, missing or overflowing timing withholds the grade; unfinished requests and future lazy loads cannot be reconstructed. The reported window and observed transfer describe the bounded observation. Local observations have no known document-wide transfer upper bound. The badge's own download is included when visible in timing.

HTTP revalidation respects a provider's revocation response, but cannot make an offline provider available or guarantee its consent implementation. Expiry and persisted browser restoration trigger a recheck. API failures keep the result unavailable instead of falling back to an unrelated local grade.

An entry-script SRI value does not cover imported chunks. Use the single-file SDK when one SRI must cover all runtime JavaScript; otherwise host the complete immutable module graph and verify every artifact before delivery.

Tests cover the stated contracts with controlled fixtures. They do not establish production capacity, complete browser observability, independent certification or a formal ASVS assessment. Report suspected security issues through [SECURITY.md](../SECURITY.md).
