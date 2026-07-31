# Workout Tracker MVP Specification

Label: ready-for-agent

## Problem Statement

Two Athletes need one small, reliable place to follow the current repeating
training plan, record what they actually completed, continue a workout later
the same day, correct mistakes, and share training history with a ChatGPT
Coach Agent. The app must stay focused on prescribed training execution and
data, without turning into a coaching, goal, route, watch, or social product.

## Solution

Build an online-only, mobile-first Workout Tracker for exactly two isolated
Athletes. The Worker handles the two-user application session, a Worker serves the app and API,
and D1 stores plans, snapshots, Sessions, corrections, metrics, Coach Shares,
and Athlete Export data. The normal Plan is read-only; a ChatGPT Agent prepares
strict weekly JSON that the Athlete pastes into a simple update flow. The
approved one-item execution flow makes today’s prescribed work fast to record,
while the Agent-facing Coach API exposes the complete, privacy-filtered history.

## User Stories

1. As an Athlete, I want to sign in with my configured email so that only my isolated training data is available.
2. As an Athlete, I want my display name and timezone to be stored so that dates and schedule boundaries match my life.
3. As an Athlete, I want to see today’s workout, Rest Day, or no-plan state so that I know what the app expects today.
4. As an Athlete, I want to start only today’s non-rest Scheduled Workout so that Sessions cannot be created for the wrong date.
5. As an Athlete, I want to skip today’s workout with an optional reason so that an intentional skip is preserved.
6. As an Athlete, I want to see a one-item focus view so that recording one prescribed item does not feel like filling a spreadsheet.
7. As an Athlete, I want previous and next controls plus a clickable global progress list so that I can navigate freely without losing my place.
8. As an Athlete, I want prescribed values prefilled so that ordinary completion takes one tap.
9. As an Athlete, I want to adjust only relevant repetitions, duration, resistance, RIR, or side values so that unusual results remain recordable without empty forms.
10. As an Athlete, I want prescribed and adjusted actual values shown together so that I can recognize what changed.
11. As an Athlete, I want to mark a result complete even when it misses the target so that performed work is not confused with target compliance.
12. As an Athlete, I want to end a workout with RPE guidance from 0 to 10 so that I can choose an understandable effort rating.
13. As an Athlete, I want unfinished Completion Items listed before saving so that I know exactly what remains.
14. As an Athlete, I want an open Session note on the end screen so that I can record context without hunting for a hidden field.
15. As an Athlete, I want to continue an in-progress or same-day partial Session so that training split across time periods keeps one snapshot and history record.
16. As an Athlete, I want gaps between Training Intervals excluded from duration so that reported training time reflects active work.
17. As an Athlete, I want optional Exercise Feedback attached to one exercise occurrence so that a weak movement can be described without per-set complexity.
18. As an Athlete, I want to correct a Session or one Completion Item later so that mistaken values do not require deleting the Session.
19. As an Athlete, I want completed work summarized in Today so that returning later immediately shows what is done.
20. As an Athlete, I want a read-only weekly Plan view so that the current prescription cannot be accidentally edited by hand.
21. As an Athlete, I want to paste Agent-generated weekly JSON so that plan changes remain deliberate and reviewable.
22. As an Athlete, I want invalid JSON to show simple copyable Agent-facing errors so that the Agent can repair the package without exposing technical diff detail.
23. As an Athlete, I want a complete human-readable future week preview so that I can confirm the resulting plan before it applies.
24. As an Athlete, I want plan revisions to begin tomorrow or later and apply atomically so that today’s execution is never changed retroactively.
25. As an Athlete, I want revision precedence to be deterministic so that overlapping future updates never make an older plan reappear unexpectedly.
26. As an Athlete, I want Completion Rate, streak, duration, Strength Training Days, RPE, and Exercise Progress to use clear Athlete-local date rules so that metrics are trustworthy.
27. As an Athlete, I want a complete JSON Athlete Export so that I retain a portable copy of my history and plan.
28. As an Athlete, I want to create and copy a permanent Coach Share from another authenticated device so that my ChatGPT Coach Agent can read my data.
29. As an Athlete, I want to revoke or regenerate a Coach Share immediately so that an old bearer capability stops working.
30. As a Coach Agent, I want a self-describing README and machine-readable schema catalog so that I can discover the API without undocumented assumptions.
31. As a Coach Agent, I want full history through stable pagination and explicit data coverage so that I do not silently analyze only a recent window.
32. As a Coach Agent, I want snapshot-scoped Completion Item references, safe source references, and metric evidence so that my explanations can point to precise records without exposing secrets.
33. As an operator, I want application sessions, Worker routing, D1 indexes, cache bypass, and log redaction defined before deployment so that the two-Athlete app does not have an accidental bypass.
34. As an operator, I want D1 Time Travel and manual Athlete Export recovery documented so that a simple Free-plan deployment still has a rehearsed recovery path.
35. As an operator, I want the source published in a private GitHub repository so that implementation history and deployment configuration remain restricted to the project owners.
36. As an operator, I want pull-request checks and default-branch Cloudflare deployment automated with GitHub Actions so that only validated changes reach `workout.lagrangee.xyz`.

## Implementation Decisions

- **Domain model:** Use the domain vocabulary in `CONTEXT.md`: Athlete, Current Plan, Plan Revision, Weekly Template, Scheduled Workout, Training Plan Snapshot, Workout Session, Session Status, Training Interval, Prescribed Set, Completion Item, Actual Training Data, Exercise Feedback, Session RPE, and Athlete Export.
- **Plan input:** Use a strict seven-slot Plan Update Package v1 with explicit `sets[]`, typed targets, structured Resistance, future-only `effective_from`, duplicate-key rejection, unknown-field rejection, no-op rejection, and atomic application.
- **Initial seed:** Use [`seed/workout-tracker-weekly-seed.json`](../../seed/workout-tracker-weekly-seed.json) as the first weekly package, effective `2026-08-01` in `Asia/Shanghai`. It keeps the brief's App-managed strength/mobility/core work, leaves Thursday as no-plan and Sunday as Rest Day, and excludes running/endurance telemetry, route context, conditions, prose instructions, and symptom fields.
- **Session lifecycle:** Enforce exactly one Session per Athlete/date, statuses `in_progress|completed|partial|skipped`, explicit start/skip/end/continue/restart transitions, server-derived terminal status, and immutable snapshot identity.
- **Session record:** Use a full replacement Session Record v1. Ordinary auto-save does not close an interval; explicit end does. Terminal corrections can rederive status and duration without changing the snapshot. Every mutating POST uses a 24-hour Athlete-scoped idempotency key.
- **Frontend:** Build a React + Vite mobile-first app shell with Today, Plan, Progress, and Settings surfaces. Use reusable execution-item, progress-navigation, end-session, correction, JSON-update bottom-sheet, Coach Share, and export components. Keep the approved prototype’s restrained warm-neutral visual direction and one-item focus interaction.
- **Private API:** Derive Athlete identity only from a verified Worker-signed application session. Private route responses use stable JSON envelopes, no-store headers, and Athlete-scoped queries; cross-Athlete resources are indistinguishable `404`s.
- **Coach API:** Provide permanent bearer README, manifest, overview, plan, schedule, sessions, progress, exercise, and token-free schema resources. Use the exact Coach Agent Wire Catalog v1, monotonic `training_version` for pagination restart detection, safe `source_ref`, and no token-bearing URLs in Agent-visible output.
- **Coach Share security:** Generate 256-bit tokens with Web Crypto. Store only HMAC lookup digest plus AES-GCM ciphertext, nonce, key versions, and Athlete/share-bound AAD. Create/regenerate responses never store or return the plaintext token; only authenticated GET can return the copyable URL.
- **Export:** Provide one full-history JSON download with an independent Athlete Export Wire Catalog v1, consistent `data_as_of`, no CSV or restore/import flow, and an explicit pre-download capacity error for the MVP delivery bound.
- **Cloudflare topology:** Use one Worker with Static Assets and one D1 database at `workout.lagrangee.xyz`. Keep Coach routes public and protect `/app` and `/api/private` with signed application sessions. Disable `workers.dev`, Preview URLs, caching, and token-bearing logs before production.
- **Source control and delivery:** Publish the complete project to a private GitHub repository owned by the configured GitHub account. Pull requests run the repository's `release-check`; only the default branch may run the production Wrangler deploy. Cloudflare credentials and production identifiers are GitHub Actions secrets or environment values, never committed files. The exact repository owner/name is a deployment input and must be confirmed before repository creation or push.
- **Recovery and retention:** Retain history without an application-level 90-day cutoff. Use D1 Free Time Travel plus manual Athlete Export; do not add scheduled R2 backup or restore UI.
- **Scope quality:** Accessibility auditing and WCAG acceptance are explicitly outside this MVP. The two approved prototypes are the visual and interaction references; no additional design-system ticket is required.

## Testing Decisions

- The primary test seam is the local Cloudflare Worker HTTP boundary backed by a local D1 fixture. Tests exercise external request/response behavior, not internal implementation details.
- Contract integration tests cover private identity isolation, Plan Update Package validation/application, Session transitions, Session Record replacement, idempotency, correction, metric boundaries, Coach Share revocation, pagination, schema conformance, and Athlete Export relationships.
- A focused browser smoke suite at the accepted 375-pixel viewport covers the Today one-item flow, previous/next/progress jump behavior, partial continuation, end-screen unfinished list/RPE/note, and the Plan JSON bottom-sheet paste → error/preview → confirm flow.
- Data fixtures must cover two Athletes, no plan, Rest Day, no-plan date, heterogeneous sets, left/right expansion, split intervals, partial/completed/skipped Sessions, timezone boundaries, overlapping revisions, corrections, and empty metric denominators.
- Cloudflare acceptance checks run only after local tests: application session validation, private path protection, public Coach routes, `workers_dev`/Preview bypass prevention, cache headers, log redaction, D1 indexes, quotas, and recovery rehearsal.
- There is no existing runtime test prior art; the resolved prototypes, JSON examples, wire catalogs, and 30-item acceptance contract are the fixture and behavior sources for the first test suite.

## Out of Scope

No offline queue or offline editing; no ad-hoc Sessions; no manual plan editor; no file-level JSON import/export; no AI or automatic plan generation; no goals, routes, coaching analysis, or route background; no watch import or Endurance Telemetry; no symptom/body-part system; no social or household dashboard; no registration, invitations, administrator UI, coach account, expiring share, analytics, visitor logs, CSV, restore/import workflow, or dedicated accessibility audit.

## Further Notes

This specification is the implementation handoff synthesized from the accepted
conversation decisions. The detailed canonical contracts below remain part of
the same spec: they define exact routes, fields, invariants, errors, security
headers, Cloudflare constraints, and release acceptance criteria. Local
Markdown is authoritative. Implementation may begin locally, but production
deployment remains gated on two exact Athlete emails, two independent password
Secrets, application session verification, custom-domain routing, and quota
checks.

## Authority and Scope

This contract consolidates the accepted MVP decisions and replaces contradictory behavior in the source brief. `CONTEXT.md` owns domain language; the linked wire contracts own their respective public representations. Earlier ticket text remains decision history, but this document is the implementation handoff.

The App is an online-only, mobile-first training-plan execution and recording system for exactly two independently authenticated Athletes. It manages each Athlete's current repeating plan, dated schedule, prescribed-work execution, corrections, progress, Coach Share, settings, and JSON export.

The MVP has no offline queue, ad-hoc training, manual plan editor, AI, coaching analysis, goals, routes, watch import, Endurance Telemetry, symptom system, social surface, household dashboard, registration, administrator UI, or dedicated accessibility audit/WCAG acceptance criterion.

## Identity and Isolation

- The application admits only two configured email identities using independent
  passwords stored as Cloudflare Worker Secrets.
- Every `/api/private/*` request validates the signed session HMAC, version,
  issued and expiry time claims. The session email is trimmed, Unicode
  NFKC-normalized, and lowercased before lookup; deployment rejects duplicate
  normalized mappings. The result maps to exactly one Athlete.
- Private endpoints never accept an Athlete identifier. Every query and mutation is scoped from the verified identity.
- Athlete A can never read, infer, mutate, export, or share Athlete B's data.
- The two identity mappings are provisioned as deployment data. There is no sign-up, invitation, or identity-editing workflow.
- Athlete Settings contain only `display_name` and IANA `timezone`.

`display_name` is trimmed, required, non-unique, and 1–50 characters; its initial value is the configured login email's local part. `timezone` is a required valid IANA name and initially defaults to `Asia/Shanghai`. Changing timezone is allowed during an active Session because that Session retains `timezone_at_session`; it affects current and future boundaries but never rebuckets historical Sessions. Before accepting a change, the server compares the effective revision for the current instant under both timezones and rejects the change if the revision would differ; this prevents both premature roll-forward and rollback.

## Canonical Model

### Plan

An Athlete has one conceptual Current Plan and zero or more immutable Plan Revisions. No revision means the Athlete currently has no plan.

Each Plan Revision stores:

- an internal identity and Athlete relationship;
- immutable `effective_from`, `created_at`, and complete Weekly Template;
- a monotonically ordered revision sequence used for precedence and exposed
  only in Athlete Export, never Coach API or normal App UI.

The complete Weekly Template has seven required Monday-through-Sunday slots. Each slot is exactly one of:

- a workout;
- an explicit Rest Day;
- `null`, meaning no plan.

The template effective on a date is the highest revision sequence whose `effective_from` is on or before that date. A later-confirmed revision replaces the prior timeline from its own `effective_from` onward, so an older future revision can never reappear after it. A midweek revision changes only dates on or after `effective_from`. Templates repeat indefinitely until superseded, while every revision remains in internal history.

Plan Update Package v1 is the sole creation and update mechanism. Its exact wire contract is [Plan Update Package v1](../../docs/contracts/plan-update-package-v1.md). The App stores no free-text plan instructions, progression rules, conditions, goals, or coaching notes.

The optional production Plan Seed uses the same package and remains deployment input supplied later. It may create only the designated Athlete's first revision. The other Athlete starts without a revision.

### Scheduled Workout

A Scheduled Workout is a deterministic Athlete-local date projection from Plan Revisions, not an owner of execution status. The projection yields a workout, Rest Day, or no-plan day. A no-plan day has no Scheduled Workout record.

At most one Scheduled Workout exists per Athlete-local date. Multiple training modes are Blocks within that workout. Scheduled start time is display-only and never makes a workout overdue during its own date.

Historical projections use the revision effective on their dates. Future projections can change until their dates are protected by a Workout Session snapshot.

### Exercise Prescription and Completion Items

A workout contains ordered Blocks; a Block contains ordered exercise occurrences. An exercise occurrence has:

- stable Athlete-scoped `exercise_key` and display name;
- category: `strength`, `endurance`, `mobility`, or `recovery`;
- side mode: `none` or `left_right`;
- one or more explicit prescribed `sets`.

Each set has exactly one repetitions or duration target and may carry structured Resistance, target RIR, target RPE, tempo, rest, or treadmill incline where applicable. Heterogeneous targets such as `5 / 5 / 4 / 4` are represented by four set entries.

On snapshot creation, a set with `side_mode: none` becomes one Completion Item. A set with `side_mode: left_right` becomes separate left and right Completion Items. Block headings, rest periods, and display text are never Completion Items.

### Workout Session

A Workout Session belongs to exactly one Athlete and one non-rest Scheduled Workout. It is created only by starting or skipping today's Scheduled Workout; past and future Sessions cannot be created.

The sole Session status is:

- `in_progress`;
- `completed`;
- `partial`;
- `skipped`.

There is no second public `outcome` field. `completed` requires 100 percent completion. Ending below 100 percent derives `partial`. `skipped` is allowed only before any Training Interval or Actual Training Data exists.

Session creation captures an immutable Training Plan Snapshot with snapshot-scoped keys for every Block, exercise occurrence, and Completion Item. The owning Athlete, Scheduled Workout date and relationship, `timezone_at_session`, and snapshot never change.

### Training Intervals and Time

Starting, continuing, or restarting opens one Training Interval. Only an explicit
`end` command closes it; ordinary record auto-save does not. Intervals:

- use RFC 3339 UTC instants;
- require `ended_at > started_at`;
- never overlap;
- require exactly one open interval while `in_progress` and none otherwise.

Persisted `training_duration_sec` is the sum of closed interval durations. While one interval is open, the UI may display the closed sum plus the live difference from its start to now. Wall-clock gaps between separate training periods are excluded. A cross-midnight interval remains owned by the immutable Scheduled Workout date and `timezone_at_session`.

### Actual Training Data

Latest canonical data contains:

- one optional result per snapshotted Completion Item;
- Training Intervals;
- optional Session RPE and Session note;
- at most one optional Exercise Feedback per snapshotted exercise occurrence;
- optional skip reason only while skipped.

Every result references exactly one `completion_item_key`; array position, name, set number, side, or `exercise_key` is not relational identity. A completed item means the prescribed unit was performed and recorded, even when its actual value missed the target. Unattempted work remains incomplete.

Results may contain actual repetitions or duration, structured Resistance, RIR, completion time, and side inherited from the snapshot. There are no pain, distance, elevation, pace, heart-rate, incline-actual, symptom, or free-exercise fields.

Actual Training Data remains correctable indefinitely. The latest values replace earlier values without an audit trail. Corrections immediately rederive completion percentage, terminal status, progress, Coach API output, and export.

Session RPE is `null` while in progress or skipped and may be `0–10` only for completed or partial Sessions. Skip reason is `null` outside skipped status.

The exact authenticated mutation shape is
[Session Record v1](../../docs/contracts/session-record-v1.md).

### Continue and Restart

- Ending an in-progress Session is the only pause boundary: it closes the
  interval and produces `partial` when work remains. Same-day `continue` opens
  a new interval. There is no separate pause state or route.
- A same-day partial Session may continue in place, preserving its snapshot and actuals and opening a new interval.
- A skipped Session may restart on its Scheduled Workout date, preserving its snapshot, clearing the skip reason, changing to `in_progress`, and opening its first interval.
- Completed Sessions and past partial Sessions cannot continue, but their recorded data remains correctable.

No ad-hoc Session or unprescribed result can be created. Substitutions and extra work may appear only in the Session note and do not compensate for incomplete prescribed work.

## Default Recording Behavior

The UI pre-fills rather than presenting empty grids:

- exact targets use their prescribed value;
- ranges use the previous in-range actual for the same exercise and side, otherwise the lower bound;
- target RIR is prefilled;
- Resistance uses the previous same-exercise, same-side, same-mode value when available;
- notes and Exercise Feedback remain optional.

“Complete” accepts these defaults. “Adjust” reveals only fields relevant to that Completion Item. A result below its target can still be completed; `RIR = 0`, Session RPE, and notes carry the effort context.

## Derived Metrics

All date windows and weekly buckets use the Athlete timezone. Weeks are Monday through Sunday.

- A workout becomes due immediately when started or skipped, or at the next local midnight when still unstarted.
- Today's unstarted workout is excluded. An overdue unstarted workout contributes zero.
- Completion Rate is the sum of each due workout's completion fraction divided by the number of due non-rest workouts.
- Training Streak counts consecutive scheduled training dates completed at 100 percent. Rest and no-plan dates are neutral; partial, skipped, and any past-date Session below 100 percent break it. A current-date in-progress Session neither extends nor breaks the prior streak until it is ended or its date passes.
- Training duration, Strength Training Days, average Session RPE, and Exercise Progress use terminal completed or partial Sessions only.
- A Strength Training Day is a date with at least one completed strength Completion Item and counts once.
- An exercise is performed in a Session when at least one of its Completion Items is completed.
- Resistance trends remain separate for bodyweight, external weight, and assisted weight.

Metric responses provide value plus evidence counts, period boundaries, timezone, `data_as_of`, and `metric_semantics_version: 1`. A semantic calculation change requires incrementing that version.

Presets are inclusive of the Athlete's current local date: `7d` begins six
days earlier, `30d` begins 29 days earlier, and `12w` begins on Monday eleven
weeks before the current week. `all` begins on the earliest projected
Scheduled Workout date and falls back to today when none exists. Explicit
ranges are inclusive.

Completion fractions are computed from integer completed and prescribed
Completion Item counts without intermediate rounding. A rate or average with a
zero denominator is `null`. Completion fractions and rates round half-up to
four decimal places; average RPE rounds half-up to two; durations and counts
are integers. Weekly output contains every Monday-starting bucket intersecting
the range, including empty and clipped boundary weeks. Exercise detail defaults
to `12w`.

## Authenticated App Routes

All responses are JSON and `Cache-Control: no-store` unless the export contract specifies download headers. Errors use a stable `{ error: { code, message, details } }` envelope without internal details.

### Reading

```text
GET  /api/private/me
PUT  /api/private/settings
GET  /api/private/today
GET  /api/private/plan
GET  /api/private/schedule?from=&to=&expand=prescription
GET  /api/private/sessions?from=&to=&status=&exercise_key=&cursor=
GET  /api/private/sessions/:session_key
GET  /api/private/progress?from=&to=&preset=&bucket=week
GET  /api/private/exercises/:exercise_key?from=&to=&preset=
```

`from` and `to` are inclusive Athlete-local dates. Presets and explicit ranges are mutually exclusive. List pagination uses immutable `scheduled_date DESC, session_key DESC` keyset order.

`GET /plan` returns the template effective today plus every future template
that remains on the precedence-resolved timeline. The normal banner surfaces
the next effective date and a count of any additional pending templates.

### Executing and Correcting

```text
POST /api/private/scheduled-workouts/:date/start
POST /api/private/scheduled-workouts/:date/skip
PUT  /api/private/sessions/:session_key/record
POST /api/private/sessions/:session_key/end
POST /api/private/sessions/:session_key/continue
POST /api/private/sessions/:session_key/restart
```

`PUT .../record` idempotently replaces the editable latest record—Completion Item results, intervals, Session RPE, note, Exercise Feedback, and applicable skip reason—without accepting immutable fields. The server validates and writes the whole request atomically. The MVP uses last successful write wins and has no offline merge or optimistic-lock UI.

There is a database uniqueness constraint on `(athlete_id, scheduled_date)`.
Calling `start` again on that date while its Session is `in_progress`, or
`skip` again while it is `skipped`, returns `200` with the existing Session and
does not create another interval or row. A different action against an
existing Session returns `409`.

Every mutating `POST` requires `Idempotency-Key`. For 24 hours, a key is scoped
to Athlete, method, and target path. An identical raw UTF-8 request-body digest
returns the stored original status and response; reuse with a different body
digest returns `409`. `PUT` and `DELETE` are intrinsically idempotent. Plan
validation is read-only and does not require a key.

`start`, `continue`, `restart`, Coach Share create, and Coach Share regenerate
accept exactly `{}`. `skip` accepts exactly
`{ "skip_reason": string|null }`. `end` uses Session Record v1. Plan apply and
validate accept exactly `{ "package_text": string }`.

`end` closes the open interval at its supplied instant and atomically saves the supplied final record, deriving completed or partial. State-invalid actions return `409`; malformed or invariant-breaking data returns `400`; unknown Athlete-scoped resources return `404`.

Allowed status transitions are:

| Command | From | To |
| --- | --- | --- |
| `start` | no Session | `in_progress` |
| `start` replay | `in_progress` | unchanged; return existing Session |
| `skip` | no Session | `skipped` |
| `skip` replay | `skipped` | unchanged; return existing Session |
| `end` | `in_progress` | derived `completed` or `partial` |
| `continue` | same-date `partial` | `in_progress` |
| `restart` | same-date `skipped` | `in_progress` |
| `PUT record` | `in_progress`, `completed`, `partial`, `skipped` | unchanged except terminal completion is rederived |

Every other transition returns `409`.

Missing or invalid application sessions return `401`; a valid but unmapped identity returns `403`; Worker or D1 quota/service failures return `503`. None of these responses includes authentication claims, internal identities, SQL, stack traces, or quota-account metadata.

### Plan Updates

```text
GET  /api/private/plan
GET  /api/private/plan/update-package
POST /api/private/plan-updates/validate
POST /api/private/plan-updates/apply
```

The validate and apply requests wrap the pasted text as `package_text`, allowing malformed inner JSON to receive useful parse errors. Validation returns either all discoverable path-addressed errors or a human-readable full-week preview, `effective_from`, and changed-weekday-slot count. Apply revalidates the same text and commits one revision atomically. A no-op cannot be applied.

### Coach Share and Export

```text
GET    /api/private/coach-share
POST   /api/private/coach-share
POST   /api/private/coach-share/regenerate
DELETE /api/private/coach-share
GET    /api/private/export
```

Coach Share behavior is defined by [Coach Agent API v1](../../docs/contracts/coach-agent-api-v1.md) and its [Wire Catalog](../../docs/contracts/coach-agent-wire-catalog-v1.md). Export behavior is defined by [Athlete Export v1](../../docs/contracts/athlete-export-v1.md) and its [Wire Catalog](../../docs/contracts/athlete-export-wire-catalog-v1.md).

## Coach Share Security

- A token contains 256 bits of cryptographically secure entropy and is encoded as unpadded base64url.
- D1 stores a unique HMAC-SHA-256 lookup digest plus AES-GCM ciphertext and nonce. Separate Worker secrets protect lookup and encryption.
- Each row stores digest and encryption key versions. AES-GCM uses a fresh
  random 96-bit nonce and AAD binding the Athlete key, share key, and key
  version. Rotation retains readable prior keys until an atomic re-encryption
  and digest reindex finishes.
- Plaintext tokens are never stored. Authenticated copy decrypts only the active Athlete-owned token.
- Share lookup computes the digest before the indexed D1 query. Revocation is checked on every request.
- Create, revoke, and regenerate are atomic; at most one active share exists per Athlete.
- Public share routes never redirect. Invalid, revoked, regenerated, malformed, and unknown scoped resources are indistinguishable `404`s.
- A Workers Rate Limiting binding applies a best-effort threshold of 120
  requests per 60 seconds per token digest in each Cloudflare location. It
  stores no visitor history, does not key solely by IP, and is not an exact
  global counter.
- Worker caching is disabled for the gateway. All private and Coach responses explicitly send `Cache-Control: no-store`.
- Workers invocation logs are disabled. Application logs, traces, analytics, and errors never include raw paths, request URLs, tokens, ciphertext, or share digests.

The recoverable-token choice is recorded in [Store Recoverable Coach Share Tokens Safely](../../docs/adr/0003-store-recoverable-coach-share-tokens-safely.md).

## Cloudflare Deployment

Production is one Cloudflare Worker with Static Assets and one D1 database on `workout.lagrangee.xyz`.

- The Worker protects `/app` and `/api/private` with an HttpOnly signed session Cookie.
- Coach README and JSON routes remain public bearer surfaces.
- Shared static assets contain no private data.
- The Worker validates application sessions at the private API origin.
- `workers_dev: false` and `preview_urls: false` prevent bypass hosts.
- The custom domain is the sole production Worker entrypoint.
- GitHub Actions runs `npm run release-check` for pull requests and does not deploy production from a pull request.
- A push to the default branch deploys through Wrangler using least-privilege GitHub Actions permissions, concurrency protection, and secret-backed `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` values.
- The deployment job verifies the custom domain route and records the deployed version or URL; failed checks or deploys fail the workflow visibly.
- Deployment remains blocked until the two exact emails, two independent password Secrets, and the session-signing Secret are configured and both login paths are verified; quotas and the custom-host bypass are also rechecked.

## Recovery and Retention

Training history and revisions are retained without an application-level cutoff. MVP recovery uses D1 Free Time Travel's seven-day recovery window plus Athlete-triggered full JSON Export. It has no scheduled R2 backup, restore UI, or custom backup workflow. Production recovery is an operator action and must be rehearsed without using live Athlete data.

## Acceptance Contract

1. Only the two configured application identities can authenticate; each resolves to one isolated Athlete.
2. Cross-Athlete resource keys and request tampering return `404` and reveal no existence.
3. One Athlete may have no plan; another may have one Current Plan with immutable revision history.
4. A strict seven-slot package with a future `effective_from` applies atomically; invalid, oversized, unknown-field, duplicate-key, and no-op packages create no revision.
5. A midweek revision preserves earlier weekday projections and changes later dates by the new weekday slots; a later-confirmed earlier-effective revision masks any older future revision from that date onward.
6. A heterogeneous four-set prescription produces four ordered set targets; `2 sets × left_right` produces four Completion Items.
7. Starting or skipping is allowed only for today's non-rest Scheduled Workout and captures one immutable snapshot.
8. Every actual result resolves to one snapshot Completion Item; forbidden unprescribed results are rejected.
9. Completing work below target preserves its actual value and still counts that item as performed.
10. Ending at 100 percent derives completed; ending below 100 percent derives partial; skip is impossible after work starts.
11. Same-day partial continue and skipped restart reuse the Session and snapshot; past partial and completed Sessions cannot continue.
12. Split training creates non-overlapping intervals and excludes gaps from `training_duration_sec`.
13. Terminal corrections immediately rederive status and every dependent App, Coach, and Export projection without altering the snapshot.
14. Refreshing or using another online device returns the last successful server state; loss of network shows failure and creates no offline draft promise.
15. Rest Days require no Session and are metric-neutral; no-plan dates produce no Scheduled Workout.
16. Completion Rate, streak, duration, Strength Training Days, RPE, and exercise evidence match the stated Athlete-local semantics at midnight and range boundaries.
17. Timezone changes never relabel existing Session dates and are rejected when the timezone change would select a different effective revision for the current instant.
18. The accepted one-item mobile execution and bottom-sheet Plan Update prototypes remain the interaction requirements at 375-pixel width.
19. Athlete Export passes relationship, consistency, size-bound, stable-key, privacy, and concurrent-correction tests in its contract.
20. Coach README, manifest, overview, plan, schedule, sessions, progress, exercise, and schema resources are Agent-discoverable and expose all history without a 90-day cap.
21. Coach pagination returns stable keyset pages; if advertised monotonic `training_version` changes during traversal, the Agent is instructed to restart rather than assume snapshot consistency.
22. Coach metrics match authenticated metrics for identical Athlete, timezone, period, data, and semantic version.
23. Token copy works across authenticated devices while D1 contains no plaintext token.
24. Revocation and regeneration invalidate the old capability immediately; all invalid-token cases are indistinguishable.
25. Share and private responses bypass caches, cannot mutate through public routes, and emit no token-bearing URL to configured logs or traces.
26. `workout.lagrangee.xyz` is the only production Worker hostname; direct `workers.dev` and Preview URL requests cannot reach the App.
27. D1 indexes cover Athlete/date, revision effective date, Session date, exercise lookup, and Coach digest lookup without unbounded scans.
28. Free-plan usage and Worker/D1 quotas are verified before deployment; quota exhaustion produces a visible service error without corrupting data.
29. A Time Travel recovery rehearsal and a full Athlete Export verification succeed before production acceptance.
30. A forbidden-feature scan finds no offline queue, telemetry, symptom system, ad-hoc Session, manual plan editor, AI, goal, route, coach dashboard, CSV, or restore/import workflow.
31. The confirmed GitHub repository is private, contains the intended source without secrets, pull-request `release-check` is green, and a default-branch GitHub Actions run deploys the Worker through Wrangler to `workout.lagrangee.xyz` using secret-backed credentials without exposing them in logs.
