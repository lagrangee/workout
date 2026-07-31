# Coach Agent API Review Disposition

## Adopt

- Immutable snapshot-scoped keys for blocks, exercise occurrences, and Completion Items; Actual Training Data references `completion_item_key`.
- One contradiction-free public Session status representation.
- Explicit Scheduled Date, Session timezone snapshot, UTC Training Intervals, cross-midnight ownership, and duration defined as the sum of intervals rather than their wall-clock span.
- Arbitrary `from`/`to` metric windows in addition to presets, metric evidence breakdowns, and `metric_semantics_version`.
- Independently versioned Coach output and Plan Update Package input wire schemas.
- Manifest data coverage, schedule summary-by-default with optional prescription expansion, safe non-URL source references, `/overview`, and machine-readable schemas.
- README instruction that an Agent must never reproduce, cite, or display token-bearing URLs.
- Strong bearer protections: high entropy, no redirects, edge-cache bypass, path redaction, safe response headers, and immediate revocation.

## Adopt with Modification

- Pagination remains stable keyset pagination with filters, immutable sort
  fields, and `data_as_of`, but does not promise snapshot-consistent
  exactly-once traversal under concurrent edits. Scheduled Date is immutable
  and concurrency is negligible; an Athlete-scoped monotonic
  `training_version` tells the Agent when to restart.
- Resistance is narrower than the review proposal: bodyweight, external weight, or assisted weight only; all numeric values are kg per implement with quantity.
- Schedule projections use safe opaque prescription references rather than exposing Plan Revision identity.

## Reconciled in the MVP Contract

- Cross-device copy uses a 256-bit token stored as AES-GCM ciphertext plus a separate HMAC-SHA-256 lookup digest; plaintext is never stored.
- A Workers Rate Limiting binding applies a best-effort threshold of 120
  requests per 60 seconds per token digest in each Cloudflare location and
  retains no visitor history; it is not an exact global counter.
- Plan prescriptions use explicit `sets[]`, and each snapshotted Prescribed Set expands deterministically into Completion Items.
- The production Plan Seed remains deployment input rather than hard-coded application content.
- Recovery uses D1 Free Time Travel plus manual Athlete Export; MVP adds no scheduled R2 backup or restore surface.

## Separate Product Decision

- Ad-hoc Sessions are not adopted implicitly. See [Decide whether the MVP records ad-hoc Sessions](../../.scratch/workout-tracker-mvp/issues/15-decide-whether-mvp-records-ad-hoc-sessions.md).
