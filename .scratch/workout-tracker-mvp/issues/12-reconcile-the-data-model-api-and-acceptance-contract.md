# Reconcile the data model, API, and acceptance contract

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 14, 15

## Question

Given all resolved product decisions and Cloudflare facts, what canonical entities, invariants, endpoint behaviors, error cases, and testable acceptance criteria replace the contradictory or underspecified parts of the source brief?

## Comments

- Reconcile the accepted, modified, and deferred findings in [Coach Agent API review disposition](../../../docs/reviews/coach-agent-api-review-disposition.md), including explicit Completion Item references, time semantics, flexible metric windows and evidence, independent wire schemas, data coverage, safe source references, and the deliberate relaxation of snapshot-consistent pagination.
- Treat [Athlete Export v1](../../../docs/contracts/athlete-export-v1.md) as the canonical portability contract; align shared domain projections without coupling its wire schema to Plan Update Package or Coach API.
- Human confirmation: Plan prescriptions use explicit `sets[]`; Coach Share tokens use a recoverable encrypted value plus a separate keyed lookup digest and token-scoped rate limiting; the production Plan Seed remains a later deployment input; MVP recovery relies on D1 Free Time Travel plus manual Athlete Export rather than a custom automated backup system.

## Answer

The reconciled implementation authority is
[Workout Tracker MVP Implementation Contract](../spec.md), with canonical
language in [CONTEXT.md](../../../CONTEXT.md). It replaces source-brief
contradictions with:

- one Athlete-isolated Current Plan and immutable full-week revisions, explicit
  Prescribed Sets, deterministic dated projections, immutable Session
  snapshots, sole Session status, and interval-derived duration;
- a unique Session per Athlete/date, explicit transition and replay rules,
  24-hour POST idempotency, full-replacement correction semantics, and the
  exact [Session Record v1](../../../docs/contracts/session-record-v1.md);
- strict, atomic [Plan Update Package v1](../../../docs/contracts/plan-update-package-v1.md)
  with revision-sequence precedence and future-only application;
- exact independent Coach and Export wire contracts:
  [Coach API](../../../docs/contracts/coach-agent-api-v1.md),
  [Coach Wire Catalog](../../../docs/contracts/coach-agent-wire-catalog-v1.md),
  [Athlete Export](../../../docs/contracts/athlete-export-v1.md), and
  [Export Wire Catalog](../../../docs/contracts/athlete-export-wire-catalog-v1.md);
- Athlete-local metric windows, rounding, zero-denominator, weekly bucket, and
  evidence rules; encrypted recoverable Coach tokens with rotation metadata;
  best-effort location-scoped throttling; and bounded full-export delivery.

The contract ends with 30 testable release criteria spanning identity
isolation, plan precedence, execution and correction, metrics, Agent discovery,
secret handling, Cloudflare bypass prevention, quota behavior, recovery, and
forbidden-feature scans. Link checks, all embedded JSON examples, whitespace
checks, and an independent contradiction audit completed successfully.
