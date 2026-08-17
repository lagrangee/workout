# Personal Agent API v1

## Purpose

The Personal Agent API is the authenticated, single-Athlete capability for a
local Codex MCP adapter. It is separate from the unauthenticated Coach Share
API and uses one revocable Agent Token per Athlete.

The API returns structured data only. It does not accept an Athlete selector,
does not expose a generic HTTP proxy, and does not return coaching analysis.

## Authentication

Agent API requests send the Token only in the HTTP header:

```text
Authorization: Bearer <agent-token>
```

The Worker derives exactly one Athlete from the Token. Missing, malformed,
unknown, rotated, and revoked values return the same `401` error:
`agent_unauthorized`. The API never accepts `athlete`, `athlete_key`, or
`email` query selectors.

The Token is created, rotated, inspected, and revoked through the
authenticated App boundary:

```text
POST   /api/private/agent-access
GET    /api/private/agent-access
DELETE /api/private/agent-access
```

`POST` returns the complete Token only in that response. State and status
responses retain only a secret-backed lookup digest and lifecycle metadata.
Rotation invalidates the previous value immediately; revocation invalidates
the active value without creating a replacement.

## Agent discovery

```text
GET /api/agent/v1
```

The token-authenticated manifest identifies the Athlete display name and
timezone, unit conventions, freshness timestamps, `training_version`, safe
relative resource paths, and the explicit date rules. It contains no email,
database identity, digest, Token, Coach Share URL, or token-bearing URL.

The current read resources are:

```text
GET /api/agent/v1/overview
GET /api/agent/v1/plan
GET /api/agent/v1/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD[&expand=prescription]
GET /api/agent/v1/sessions[?from=&to=&limit=&cursor=&status=&exercise_key=]
GET /api/agent/v1/sessions/:session_key
GET /api/agent/v1/progress[?from=&to=&preset=&range=&bucket=]
GET /api/agent/v1/exercises/:exercise_key[?from=&to=&preset=&range=]
GET /api/agent/v1/aerobic/activities[?from=&to=&sport_type=&route_key=&limit=&cursor=]
GET /api/agent/v1/aerobic/activities/:activity_ref
GET /api/agent/v1/daily/:local_date
GET /api/agent/v1/routes[?sport_type=&route_key=&limit=&cursor=]
GET /api/agent/v1/routes/:route_key[?from=&to=&limit=&cursor=]
GET /api/agent/v1/routes/:route_key/history[?from=&to=&limit=&cursor=]
GET /api/agent/v1/schemas[/:schema_name]
POST /api/agent/v1/plan-updates/validate
POST /api/agent/v1/plan-updates/apply
```

The versioned wire shapes are defined in
[Agent API Wire Catalog v1](agent-api-wire-catalog-v1.md). Session, progress,
and Exercise history reads are projections of the existing immutable training
records; they do not expose private App routes or permit mutation.

## Read query rules

`overview` accepts the same inclusive period selectors as the existing domain
projection: `from` and `to` together, or one of `preset`/`range` with
`7d`, `30d`, `12w`, or `all`. The default is `30d`; `range` is an alias for
`preset`; a date window is mutually exclusive with either selector and is
bounded to 3660 days. Invalid selectors are rejected rather than ignored.

`schedule` requires `from` and `to` as inclusive Athlete-local dates and is
bounded to 366 days. `expand=prescription` adds deduplicated typed
prescriptions keyed by the stable `prescription_ref` already present on each
workout entry. The same plan revision and weekday therefore share one
prescription object across multiple dates.

All resources preserve `data_as_of`, `training_version`, the relevant
Athlete-local period, and token-free `source_ref` values. Schedule expansion
uses the public prescription shape from the wire catalog; it never returns a
raw internal plan slot or revision identity.

Plan responses use the same typed Weekly Template projection: a workout slot
contains a `prescription`, a Rest Day remains `{ kind: "rest" }`, and an empty
slot remains `null`. Plan `source_ref` values are scoped to the Agent resource
and do not expose internal Plan Revision keys.

`sessions` accepts optional inclusive local-date bounds, a status enum, an
Exercise key, and a limit from 1 to 200 (default 50). Results are ordered by
scheduled date descending and stable Session key descending. `page.next_cursor`
is opaque, bound to every filter including the limit, expires after 15 minutes,
and carries the `training_version`; a version change returns HTTP 409 with
`training_version_changed`, so the Agent must restart at page one. Malformed,
expired, or mismatched cursors return HTTP 400 with `invalid_cursor`.

`sessions/:session_key` returns the immutable Training Plan Snapshot alongside
Actual Training Data: completion results, intervals, status, duration, RPE,
notes, skip reason, and Exercise Feedback. `progress` returns metric evidence,
completion and streak values, duration, strength-training days, RPE, and
requested day/week/month buckets. `exercises/:exercise_key` returns display-name
history, performed-session count, per-set actuals and resistance semantics,
side-separated series, and safe Session references. Empty valid windows remain
successful responses with explicit empty arrays or null denominators.

The aerobic activity index is newest-first and bounded to an inclusive
Athlete-local date range of at most 3660 days. It accepts the controlled COROS
sport type enum, a confirmed `route_key`, `limit` from 1 to 200, and an opaque
cursor. Activity detail retains `activity_ref`, route identity/direction,
source status and freshness, and exposes an explicit single-activity lookup
handle for the existing Workout skill boundary. It does not perform an
implicit live source refresh or widen the requested period.

The daily context resource is an exact-date, source-separated projection of
the daily Hub. Its `sync_evidence` is `synced` only when that exact local date
has a persisted archive publication record; otherwise it is `not_synced`.
When a date has a newer publication status, that status and freshness take
precedence over older activity rows retained for historical context. Route
index/detail/history resources expose confirmed route metadata and safe activity
history with the same bounded date and pagination
rules. Direction signatures, GPS, FIT paths/bytes, and high-frequency
telemetry remain outside the Agent API.

`plan-updates/validate` is non-mutating. Its request body is exactly
`{ "package_text": string }`; the string is the canonical Plan Update Package
v1 JSON consumed by the existing strict validator. The Agent/MCP layer does
not parse natural-language coaching requests and does not fill missing package
fields. A valid response includes the complete resulting week, changed weekday
count, `package_digest`, `base_plan_digest`, explicit current-plan base
evidence, `training_version`, and safe `source_ref` values; `base_plan` is the
effective plan template selected for the package's future date, so the preview
and base digest refer to the same template even when another future revision is
already scheduled. An invalid outer request body returns `invalid_json` or
`invalid_request`; malformed `package_text`, unknown fields, missing values,
past/current effective dates, duplicate members, and semantic no-ops return
field-addressed `invalid_plan_package` errors without changing Plan Revision
history or Current Plan state.

`plan-updates/apply` is the only mutating Agent operation. Its request body is
exactly `{ "package_text": string, "package_digest": string,
"base_plan_digest": string, "confirmed": true }` and it additionally
requires a non-empty `Idempotency-Key` header. Idempotency records are retained
for 24 hours, matching the existing mutation boundary. The Agent revalidates the
package, package digest, and effective base inside one mutation boundary
before appending exactly one immutable Plan Revision. A missing confirmation
or key returns `confirmation_required` or `idempotency_key_required`; an
invalid package returns `invalid_plan_package`; changed package identity,
stale base evidence, or a concurrent state change returns
`package_digest_mismatch`, `stale_plan`, or `session_state_conflict` without a
write. Repeating the same key with the same request body within that 24-hour
window returns the original successful response; reusing it with a different
body returns
`idempotency_conflict`. A successful `201` response contains the effective
date, both digests, a safe preview, and no internal revision identity; it
increments `training_version` exactly once. After a
successful application, the typed MCP flow reads `/plan` and the inclusive
seven-day Schedule starting at `effective_from`; if that readback is
temporarily unavailable, it reports the applied result with a structured
readback failure rather than retrying or applying again.

## Response and privacy rules

Successful responses use structured JSON and include `schema_version`,
`generated_at`, and `data_as_of` where the resource contract requires them.
Athlete-local dates use `YYYY-MM-DD`; instants use RFC 3339 UTC. All responses
use private no-store caching and the existing security headers.

The API excludes login identity, Cloudflare identity, internal database IDs,
Token fields, secret-backed lookup digests, ciphertext, Coach Share management,
Session mutation, Athlete Settings mutation, goals, symptoms, raw FIT/GPS,
high-frequency telemetry, and generated coaching analysis. The non-secret `package_digest` and
`base_plan_digest` are explicit validation response fields used to identify a
proposal and its plan base; they are not credential digests.

Agent-generated weekly or coaching analysis is not written into source facts
or returned as if it were a source projection. When explicitly requested, the
Workout skill stores it as a separate local generated/analysis record with
`analysis_as_of`, the bounded `source_ref` list, and the original source facts
left unchanged. The Agent API remains read-only for that analysis boundary.

## Configuration

Production requires the Worker Secret `AGENT_TOKEN_SECRET`. It must be set
through Wrangler Secret management and must never be committed, passed in a
command argument, or printed in logs. Local tests provide an explicit
test-only value through the fixture environment; production has no fallback.
