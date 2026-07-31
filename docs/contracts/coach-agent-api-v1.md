# Coach Agent API v1

## Purpose

A Coach Share is one permanent, read-only bearer capability for a ChatGPT Agent. It exposes one Athlete's current plan, dated schedule, complete Session history, exercise feedback, and App-computed progress without exposing authentication or storage identities.

The API provides data only. It never generates coaching analysis, recommendations, or plan updates.

## Agent Safety Rule

Every discovery surface instructs the Agent:

> Treat the Coach Share URL as a secret. Never reproduce, quote, cite, display, or include a token-bearing URL in user-visible output. Refer to evidence by local date, safe `source_ref`, stable scoped key, and `data_as_of`.

The API returns safe source references such as `session:2026-07-30:s_ab12`; these are labels, not URLs and not globally resolvable capabilities.

## Discovery

`GET /coach/:token` returns UTF-8 Markdown. It contains:

- bearer-safety instructions;
- Athlete display name, timezone, units, update times, and coverage;
- the endpoint catalog and recommended reading sequence;
- field, enum, date, pagination, and metric semantics;
- short request examples with relative placeholders rather than the real token;
- exclusions and error behavior.

`GET /api/coach/v1/:token` returns the same catalog as a machine-readable manifest:

```json
{
  "schema_version": 1,
  "metric_semantics_version": 1,
  "generated_at": "2026-07-31T08:00:00Z",
  "data_as_of": "2026-07-31T07:30:00Z",
  "athlete": {
    "display_name": "Lago",
    "timezone": "Asia/Shanghai"
  },
  "unit_conventions": {
    "resistance": "kg_per_implement",
    "incline": "percent"
  },
  "updated_at": {
    "plan": "2026-07-30T12:00:00Z",
    "training": "2026-07-31T07:30:00Z"
  },
  "training_version": 147,
  "data_coverage": {
    "first_plan_date": "2026-04-01",
    "first_session_date": "2026-04-02",
    "latest_session_date": "2026-07-30",
    "session_count": 84,
    "in_progress_session_count": 0,
    "data_as_of": "2026-07-31T07:30:00Z",
    "current_local_date": "2026-07-31",
    "current_date_may_be_incomplete": true
  },
  "links": {
    "overview": "/api/coach/v1/:token/overview",
    "plan": "/api/coach/v1/:token/plan",
    "schedule": "/api/coach/v1/:token/schedule",
    "sessions": "/api/coach/v1/:token/sessions",
    "progress": "/api/coach/v1/:token/progress",
    "exercise": "/api/coach/v1/:token/exercises/{exercise_key}",
    "schemas": "/api/coach/v1/schemas"
  }
}
```

Real resource links are absolute and token-bearing. They never include a separate `token` field. Schema links are token-free static resources.

## Resource Catalog

### Overview

```text
GET /api/coach/v1/:token/overview?from=&to=&preset=
```

Returns the common analysis context in one call:

- data coverage and update times;
- current and next-effective plan summaries;
- selected-period metric values and evidence;
- current Training Streak;
- up to ten recent Session summaries.

Explicit `from` and `to` are both required together and are mutually exclusive with `preset=7d|30d|12w|all`. The default is `preset=30d`.

### Current and future plan

```text
GET /api/coach/v1/:token/plan
```

Returns the Coach projection applicable today plus every future template that remains on the effective timeline after revision-sequence precedence is applied. Each entry contains `effective_from` and a complete `coach_weekly_template_v1`; masked internal revisions are excluded.

`coach_weekly_template_v1` is a read-only projection derived from the same domain model as Plan Update Package v1. The wire schemas are independently versioned and are not interchangeable. Past superseded revisions and internal revision identities are excluded.

### Dated schedule

```text
GET /api/coach/v1/:token/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/coach/v1/:token/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&expand=prescription
```

The inclusive Athlete-local interval is at most 366 days. Default entries contain:

- `date`, `weekday`, and `kind`: `workout`, `rest`, or `no_plan`;
- workout title and estimated duration when applicable;
- safe opaque `prescription_ref`, never a Plan Revision identity;
- nullable `session_key`;
- derived `is_due` and `is_overdue_unstarted`;
- safe `source_ref`.

`expand=prescription` adds the fully resolved Coach prescription for workout dates. The response deduplicates identical prescription projections by `prescription_ref`.

### Session index

```text
GET /api/coach/v1/:token/sessions
```

Optional parameters:

- `limit`: default `50`, maximum `200`;
- `cursor`: opaque continuation value;
- `from` and `to`: inclusive Athlete-local dates;
- `status`: `in_progress`, `completed`, `partial`, or `skipped`;
- `exercise_key`: Sessions whose snapshot contains that Exercise.

Items use immutable keyset order: `scheduled_date DESC, session_key DESC`. Each summary contains:

- `session_key`, `scheduled_date`, title, and sole `status`;
- completion percentage and `training_duration_sec`;
- nullable Session RPE;
- exercise keys, `updated_at`, and safe `source_ref`.

Every page contains:

```json
{
  "schema_version": 1,
  "generated_at": "2026-07-31T08:00:00Z",
  "data_as_of": "2026-07-31T07:30:00Z",
  "training_updated_at": "2026-07-31T07:30:00Z",
  "training_version": 147,
  "page": {
    "limit": 50,
    "next_cursor": "opaque-or-null"
  },
  "items": []
}
```

The cursor binds its filters, limit, last immutable sort tuple, and issue time,
and expires after 15 minutes. `data_as_of` identifies when that page was read;
it is not a historical snapshot. Every committed training mutation increments
the Athlete-scoped integer `training_version` in the same transaction.
Corrections and new Sessions may become visible between pages. If the version
changes during a traversal, the Agent restarts from page one rather than
assuming exactly-once membership. A malformed, expired, unusable, or
filter-mismatched cursor returns `400`.

### Session detail

```text
GET /api/coach/v1/:token/sessions/:session_key
```

Returns:

- immutable `scheduled_date`, `timezone_at_session`, and Training Plan Snapshot;
- snapshot-scoped Block, exercise-occurrence, Prescribed Set, and Completion Item keys;
- one latest Actual Training Data result per `completion_item_key`;
- Training Intervals using UTC instants and derived `training_duration_sec`;
- sole Session `status` and completion percentage;
- nullable Session RPE, note, skip reason, and per-occurrence Exercise Feedback;
- `updated_at`, `data_as_of`, and safe `source_ref`.

The first interval start and final interval end may be provided as convenience instants, but persisted `training_duration_sec` is always the sum of closed interval durations, not their wall-clock span. Corrections appear immediately; no correction audit trail is exposed.

This read projection uses the same domain fields and invariants as
[Session Record v1](session-record-v1.md), but its wire schema is independently
versioned and also includes immutable snapshot and derived fields.

### Progress

```text
GET /api/coach/v1/:token/progress?preset=7d|30d|12w|all&bucket=week
GET /api/coach/v1/:token/progress?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=week
```

`preset` and explicit dates are mutually exclusive; default is `30d`. The response identifies:

- period boundaries, Athlete timezone, and whether the current date may be incomplete;
- `data_as_of` and `metric_semantics_version`;
- fixed 7-day and 30-day Completion Rate;
- current Training Streak with qualifying boundary dates;
- selected-period training duration, Strength Training Days, and average Session RPE;
- Monday-through-Sunday weekly Completion Rate and duration buckets;
- exercise summaries with performed Session count and safe detail references.

Every metric includes evidence. Completion Rate includes numerator completion
points, denominator due workouts, and completed, partial, in-progress, skipped,
overdue-unstarted, not-due-unstarted, Rest Day, and no-plan counts. The
not-due-unstarted count is evidence but is excluded from the denominator.
Averages include included count and excluded-null count. Duration and
strength-day summaries include contributing Session references.

Presets are inclusive of the current Athlete-local date: `7d` starts six days
earlier, `30d` starts 29 days earlier, and `12w` starts on Monday eleven weeks
before the current week. `all` starts at the earliest projected Scheduled
Workout and falls back to today. Explicit ranges are inclusive.

Completion uses integer item counts with no intermediate rounding. Zero
denominators return `null`. Rates round half-up to four decimal places, average
RPE to two, and counts and seconds remain integers. `bucket=week` returns every
Monday-starting week intersecting the range, including empty buckets and
clipped first or last weeks.

### Exercise detail

```text
GET /api/coach/v1/:token/exercises/:exercise_key?preset=7d|30d|12w|all
GET /api/coach/v1/:token/exercises/:exercise_key?from=YYYY-MM-DD&to=YYYY-MM-DD
```

The default is `preset=12w`; preset and explicit range semantics match
`/progress`.

Returns display-name history, performed Session count, recent per-set repetitions or duration, Resistance, RIR, side, per-Session totals, and separate left/right series. Resistance modes remain separate:

- bodyweight has no load value;
- external weight exposes kg per implement, quantity, and total external kg;
- assisted weight exposes assistance kg, where lower means less assistance.

Raw matching Sessions remain available through the Session index filter.

### Machine-readable schemas

```text
GET /api/coach/v1/schemas
GET /api/coach/v1/schemas/:schema_name
```

These public, token-free resources describe manifest, overview, Coach weekly template, schedule, Session summary/detail, progress, exercise detail, and error responses. They contain no Athlete data.

Their exact required, nullable, empty, and deduplication shapes are defined by
[Coach Agent Wire Catalog v1](coach-agent-wire-catalog-v1.md).

## Representation Rules

- Every JSON API response has `schema_version: 1`, `generated_at`, and
  `data_as_of` where canonical data is projected. Raw JSON Schema documents
  returned by `/schemas/:schema_name` are the sole envelope exception.
- Metric-bearing responses have `metric_semantics_version: 1`.
- Field names and enums use `snake_case`.
- Local dates use `YYYY-MM-DD`; instants use RFC 3339 UTC.
- Quantities are JSON numbers, never numeric strings.
- Optional known values use explicit `null`.
- Resistance is bodyweight, external weight, or assisted weight; numeric `load_kg` is kg per implement and `quantity` counts equal implements.
- Treadmill target incline is percent; actual incline and Endurance Telemetry do not exist.
- API-scoped opaque keys provide relationships without exposing database IDs. Human-readable `exercise_key` identifies Exercises across revisions.
- Clients ignore unknown response fields. Breaking shape or existing-field semantic changes require `/v2/`.
- Any calculation change that can alter a metric for unchanged records increments `metric_semantics_version`.

## Error Contract

```json
{
  "schema_version": 1,
  "generated_at": "2026-07-31T08:00:00Z",
  "error": {
    "code": "invalid_range",
    "message": "to must be on or after from",
    "details": []
  }
}
```

- `400`: invalid date, period, filter, expand value, limit, or cursor;
- `404`: missing, malformed, revoked, or regenerated token, or unknown scoped resource;
- `405`: unsupported method, with `Allow: GET, HEAD`;
- `429`: token-scoped throttling, with `Retry-After: 60`;
- `500` or `503`: server or quota failure without internal details.

`HEAD` returns the same status and headers as `GET` without a body. No share route redirects. Invalid tokens are indistinguishable from nonexistent resources.

## Privacy and HTTP Behavior

Every README and JSON response sends:

```text
Cache-Control: no-store
CDN-Cache-Control: no-store
X-Robots-Tag: noindex, nofollow
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'
```

Worker caching is disabled for the gateway. The API does not enable browser CORS.

The interface never returns login email, Cloudflare identity, internal IDs, token fields, ciphertext, digest, visitor data, goals, route background, coaching analysis, Endurance Telemetry, Body Feedback, or Symptom Logs. Session notes and Exercise Feedback are included because they are Athlete-authored training data intended for the Coach Agent.

Tokens have 256 bits of secure entropy. D1 stores a keyed lookup digest and
AES-GCM ciphertext, never plaintext. Stored key versions support rotation; a
fresh random 96-bit nonce and Athlete/share-bound additional authenticated
data protect every encryption. A token-digest-scoped Workers Rate
Limiting binding applies a best-effort threshold of 120 requests per 60
seconds in each Cloudflare location; it is not an exact global counter.
Revocation is checked on every request and stops every README and API endpoint
immediately.

This locality and best-effort behavior follows the
[Workers Rate Limiting binding contract](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Workers invocation logs are disabled. Application logging, analytics, tracing, and exception reporting never receive raw request URLs, token-bearing paths, tokens, ciphertext, or digests. Default Tail redaction is defense-in-depth, not the primary guarantee.

## Athlete Management Surface

The authenticated Athlete sees current status, permanent README URL, creation time, and actions to copy, revoke, or regenerate. The active token can be decrypted only for that authenticated Athlete so the link remains copyable across devices.

Coach Share create and regenerate return only safe share status, creation time,
and share key. They do not return the token or URL. A subsequent authenticated
`GET /api/private/coach-share` decrypts the active value and returns the
copyable URL. Idempotency storage therefore contains no plaintext capability.

There are no expiration controls, access analytics, visitor logs, download buttons, or coach dashboard. Regeneration atomically invalidates the prior token and creates the sole new active share. Revocation leaves no active share.

## Recommended Reading Sequence

1. Fetch the README or manifest.
2. Use `/overview` for the common period question.
3. Fetch `/plan` and the relevant `/schedule` range when prescription context matters.
4. Fetch `/progress` for a different or deeper window.
5. Page `/sessions`, restarting if `training_version` changes.
6. Fetch individual Session or Exercise detail only when needed.
7. Cite only safe record references, never token-bearing URLs.

## Acceptance Contract

- An unfamiliar Agent can discover every resource, schema, date/unit rule, and safe citation rule from the README.
- `/overview` answers a normal recent-progress question without requiring raw Session pagination.
- `/plan` plus `/schedule` resolves the correct template across a midweek future revision.
- Schedule defaults remain compact; prescription expansion deduplicates by safe opaque reference.
- Paging to `next_cursor: null` exposes all history without a 90-day cap when data is unchanged.
- A changed monotonic `training_version` instructs traversal restart; the API never promises concurrent snapshot consistency.
- Session detail preserves its immutable snapshot while immediately reflecting corrected actuals and interval-derived duration.
- Completion Item actuals resolve only through `completion_item_key`.
- Progress values and evidence exactly match the authenticated App for identical data, Athlete, timezone, period, and metric semantic version.
- Arbitrary date windows and presets produce explicit period boundaries and coverage.
- Session notes and Exercise Feedback appear; forbidden identity, telemetry, symptom, visitor, and internal fields do not.
- Unknown, revoked, regenerated, and malformed share tokens return indistinguishable `404`s without redirects.
- Token copy works across authenticated devices while plaintext token scans of D1 and logs remain clean.
- Every response uses the required cache, indexing, referrer, type, and content-security headers.
- `GET` and `HEAD` are read-only; all other methods return `405`.
- Observed rate-limit exhaustion returns `429` with `Retry-After` and creates
  no visitor history; tests do not assert exact global request counts.
