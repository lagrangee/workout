# Training Archive Wire Catalog v1

## Authority

This catalog defines the local Markdown and COROS detail shapes used by
Training Archive v1. It is not a COROS API schema and it is not accepted by
Workout plan or Session write APIs.

Known absence uses `null` in the stable envelope. Provider-native metrics are
kept in a sanitized map with their source field names; a normalized metric is
emitted only when its unit and semantic meaning are recorded in the field
catalog. The current lap field catalog is
[`coros-field-catalog-v2.md`](coros-field-catalog-v2.md).

## Shared types

```text
LocalDate = "YYYY-MM-DD"
Instant = RFC3339 instant
SourceStatus = complete | none | partial | error
SportType = 100 | 101 | 102 | 104 | 200
StructuredError = {
  source: string,
  code: string,
  message: string,
  activity_ref: string|null
}
```

## Two-stage sync receipt

The local receipt is stored at `.sync/training-archive/YYYY-MM-DD.json`. It is
the observable boundary for one user-facing `sync data` operation; local
archive and cloud publication are separate stages and use the same stable
`publication_key` on retries.

```text
SyncReceiptV1 = {
  schema_version: 1,
  sync_ref: string,
  publication_key: string,
  target_date: LocalDate,
  timezone: string,
  captured_at: Instant,
  data_as_of: Instant|null,
  source_data_as_of: { workout: Instant|null, coros: Instant|null },
  source_status: { workout: SourceStatus, coros: SourceStatus },
  status: SourceStatus,
  local_archive: {
    status: SourceStatus,
    write_status: complete|error,
    written_paths: string[],
    fit_bytes: number,
    reused: boolean
  },
  cloud_publication: {
    status: SourceStatus,
    published_count: number,
    attempts: number,
    retryable: boolean,
    idempotency_key: string|null
  },
  records_written: { daily_hubs: number, workout_sessions: number, activities: number },
  records_published: { activities: number },
  privacy_evidence: {
    status: "passed"|"failed",
    checked_at: Instant,
    scope: "safe_cloud_projection",
    omitted_fields: string[],
    violations: string[]
  },
  pending_artifacts: [{ kind: fit, activity_ref: string, relative_path: string, status: partial|error }],
  errors: StructuredError[]
}
```

`none` means a configured source read succeeded and returned no in-scope
records. A missing source adapter is `error`. A failed cloud stage retains a
safe pending projection for the next sync; a failed FIT keeps its activity JSON
and retries only the missing local artifact when the source exposes its FIT
reader. Neither retry duplicates activity identities or publishes raw FIT/GPS.

## Safe aerobic projection

```text
AerobicProjectionV1 = {
  schema_version: 1,
  publication_key: string,
  source_ref: string,
  target_date: LocalDate,
  timezone: string,
  source_status: SourceStatus,
  source_statuses: { workout: SourceStatus, coros: SourceStatus },
  workout_source_status: SourceStatus,
  source_data_as_of: { workout: Instant|null, coros: Instant|null },
  data_as_of: Instant|null,
  activities: SafeAerobicActivity[],
  routes: SafeRouteProjection[]
}
```

The preferred local-runner cloud publication boundary accepts only
`{ projection: AerobicProjectionV1 }` at
`POST /api/agent/v1/aerobic/sync`, authenticated by the existing Agent Token
and `Idempotency-Key`. It rejects unknown fields, provider payloads, raw
FIT/GPS/coordinate fields, unsupported sport types, invalid Athlete-local
dates, and route assignments that do not reference a projected route. The
response is a safe publication receipt with the target date, source statuses,
published count, aggregate read-model counts, and the resulting
`archive_version`. A successful publication increments `archive_version`
exactly once and leaves Workout-owned `training_version` unchanged. It is a
cloud stage inside `sync data`, not a second user-facing publish operation.

The browser/compatibility adapter is
`POST /api/private/records/aerobic/sync`, which accepts the same projection and
uses the existing private Athlete session. Both endpoints share the same
strict domain validator and D1 mutation; choosing the Agent path does not
create a second publication implementation.

The local Node runner prefers `WORKOUT_AGENT_API_ORIGIN` and
`WORKOUT_AGENT_TOKEN` from the owner-only `~/.config/workout-agent/agent.env`
configuration (or the equivalent `WORKOUT_AGENT_CONFIG_FILE`). It may fall
back to obtaining an application session through the normal `/api/auth/login`
endpoint using process-local
`WORKOUT_APPLICATION_ORIGIN`, `WORKOUT_SYNC_EMAIL`, and
`WORKOUT_SYNC_PASSWORD`, or a short-lived `WORKOUT_SYNC_SESSION_COOKIE`.
All credentials are transport inputs only: they are never persisted in the
Training Archive receipt or sent to COROS/D1 as source data. If no authenticated
boundary is available, the receipt must remain local-success/cloud-error.

```text
SafeRouteProjection = {
  schema_version: 1,
  route_key: string,
  route_name: string,
  sport_types: SportType[],
  distance_range_km: [number, number]|null
}
```

## Obsidian daily Hub and Workout Session records

Every `daily/YYYY-MM-DD.md` is a date-scoped `daily-hub` record. Its YAML
frontmatter is equivalent to:

```yaml
kind: daily-hub
legacy_kind: training-day
schema_version: 1
local_date: "2026-08-16"
timezone: "Asia/Shanghai"
captured_at: "2026-08-17T09:00:00+08:00"
updated_at: "2026-08-17T09:00:00+08:00"
source_status_workout: "complete"
source_status_coros: "complete"
data_as_of_workout: "2026-08-16T23:59:00Z"
data_as_of_coros: "2026-08-16T23:59:00Z"
relation_policy: same_local_date_context_only
workout_session_keys: []
workout_sessions: []
coros_activity_refs: []
coros_activities: []
```

`workout_session_keys` and `coros_activity_refs` are machine identity fields;
the two link arrays are navigation projections. The lists are never merged by
date. A missing source keeps its status and freshness as `none`, `partial`, or
`error` and does not become a fabricated zero.

The body has stable headings:

```text
## 无氧训练
## 有氧训练
## 当日汇总
## 限制与待补
```

Daily analysis is not a required section. Weekly analysis is stored in a
separate `weekly/YYYY-Www.md` file.

The daily Hub is only the date-scoped navigation/context record; one Workout
Session is the user-readable projection of one Workout-authoritative event.
Every Workout Session written by the local stage has one
`workout/sessions/YYYY-MM-DD--<session_key>.md` record and one private detail
sidecar at `data/workout/YYYY-MM-DD--<session_key>.json`:

```yaml
kind: workout-session
schema_version: 1
source: workout
source_id: "sess-2026-08-16"
source_ref: "session:2026-08-16:sess-2026-08-16"
session_key: "sess-2026-08-16"
local_date: "2026-08-16"
timezone: "Asia/Shanghai"
source_status: "complete"
data_as_of: "2026-08-16T23:59:00Z"
updated_at: "2026-08-17T09:00:00Z"
scheduled_workout_key: "sw_athlete-a_2026-08-16"
plan_id: "plan_athlete-a"
plan_revision_key: "rev-2026-08-01"
exercise_ids:
  - "dead_bug"
title: "下肢力量"
status: "completed"
completion_fraction: 1
training_duration_sec: 3600
session_rpe: 7
daily_hub: "[[daily/2026-08-16]]"
```

`workout/index.md` is a derived table/Base view over `kind =
"workout-session"` Properties. It may sort and filter by date, status, title,
duration, source status, and links, but does not contain independently editable
facts.

When the source Session contains the canonical Training Plan Snapshot v2, the
Markdown body also renders one table for every snapshotted Exercise occurrence.
Each row is one Completion Item and includes the Set ordinal, side, fixed
target, planned resistance, tempo, rest, actual metric/value, actual kg
resistance, result status (`completed`, `partial`, `skipped`), RIR, and the
Set Result note. The snapshot keeps the global `exercise_id`, frozen formal
name, and `definition_version`; the table never resolves a historical Session
through the current registry name. Missing actuals remain visibly absent and
are not converted to zero. Exercise Feedback and the Session note are rendered
as separate sections. The private JSON sidecar retains the same typed detail
without raw COROS payloads, GPS/FIT data, or credentials.

The record graph deliberately has no COROS field on a Workout Session and no
Workout field on a COROS Activity Archive. `relation_policy:
same_local_date_context_only` is the default contract for same-date
coexistence. A Scheduled Workout may separately own an explicit Recording
Intent whose source, sport type, and route key are compared by the Calendar
read model. That comparison emits evidence status only; it does not add a
cross-source identifier or merge the records.

## COROS activity archive

Each `data/coros/YYYY-MM-DD-<activity_ref>.json` has this stable envelope:

```text
CorosActivityArchiveV1 = {
  schema_version: 1,
  field_catalog_version: 2,
  provider: "coros",
  activity_ref: string,
  sport_type: SportType,
  sport_name: outdoor_run|indoor_run|trail_run|hike|cycling,
  local_date: LocalDate,
  started_at: Instant|null,
  ended_at: Instant|null,
  route_key: string|null,
  route_direction: forward|reverse|null,
  route_match_status: matched|registered|unmatched|ambiguous|ignored|error,
  fit_file: FitArtifact|null,
  summary: ActivitySummary,
  provider_shape: ProviderLapShape,
  lap_groups: LapGroup[],
  lap_field_warnings: string[]
}
```

`activity_ref` comes from COROS `labelId`. It is an activity key, never a
route key. `route_direction` is only meaningful when `route_key` is present;
it records whether the activity matched the configured forward or reverse
start of that route.

`route_match_status` is a derived assignment result. `matched` is a unique
configured match, `registered` is an explicitly confirmed new route,
`unmatched` has no safe assignment, `ambiguous` has multiple candidates,
`ignored` is indoor activity, and `error` means assignment failed. Only
`matched` and `registered` may carry a `route_key`.

```text
FitArtifact = {
  relative_path: string,
  status: complete|partial|error,
  mime_type: "application/octet-stream",
  bytes: number|null
}
```

`relative_path` points to the byte-preserved sidecar under
`data/coros/`. A missing or failed FIT download is represented by its status;
it is not silently treated as an empty file.

The generated Obsidian activity note projects this artifact into three local
Properties: `fit_status`, `fit_path` (the same safe relative path), and
`fit_file` (a wikilink only for `complete`, otherwise `null`). These note-only
links never enter the safe cloud activity envelope.

### Activity summary

```text
ActivitySummary = {
  duration_sec: number|null,
  total_duration_sec: number|null,
  distance_km: number|null,
  average_heart_rate_bpm: number|null,
  max_heart_rate_bpm: number|null,
  calories_kcal: number|null,
  training_load: number|null,
  aerobic_te: number|null,
  anaerobic_te: number|null,
  training_focus: string|null,
  perceived_effort: string|null,
  sport_metrics: object
}
```

`sport_metrics` is namespaced by the sport family. Examples are:

```text
running: {
  average_pace_sec_per_km,
  moving_average_pace_sec_per_km,
  adjusted_pace_sec_per_km,
  best_kilometer_pace_sec_per_km,
  average_cadence_spm,
  average_stride_length_m,
  average_power_w
}

hiking: {
  average_speed_kmh,
  moving_average_speed_kmh,
  best_kilometer_speed_kmh,
  elevation_gain_m,
  elevation_loss_m
}

cycling: {
  average_speed_kmh,
  moving_average_speed_kmh,
  max_speed_kmh,
  average_cadence_rpm,
  average_power_w,
  normalized_power_w,
  intensity_factor
}
```

Only fields observed with a confirmed unit are populated in this normalized
summary. An inapplicable value remains `null`.

## Provider lap shape

The observed COROS response has `mode`, `subMode`, `columns`, `lapGroups`, and
an optional `sportDataDetails` object. The archive retains the safe structural
parts needed to explain the source data:

```text
ProviderLapShape = {
  mode: number|null,
  sub_mode: number|null,
  columns: { name: string, label: string|null }[],
  sport_data_details_present: boolean
}
```

### Lap groups

COROS may return separate 1 km, 500 m, 1 mile, interval, and total groups for
one activity. They remain separate to prevent duplicate or incomparable rows.

```text
LapGroup = {
  group_type: number|string|null,
  lap_distance_raw: number|null,
  laps: Lap[]
}

Lap = {
  lap_index: integer,
  provider_metrics: object,
  normalized_metrics: object
}
```

`provider_metrics` contains filtered fields such as `distance`, `time`,
`totalLength`, `avgPace`, `avgSpeedV2`, `avgHr`, `maxHr`, `elevGain`, and
sport-specific fields returned by the selected sport type. It excludes
coordinates, route URLs, raw sensor streams, and export payloads.

`normalized_metrics` is deliberately sparse. It may contain verified values
such as `distance_m`, `duration_sec`, `average_heart_rate_bpm`,
`elevation_gain_m`, and the sport-specific pace/speed fields. An unverified
provider field remains in `provider_metrics` and is not silently converted.
`lap_field_warnings` contains sorted additive provider keys that are retained
in JSON but excluded from the Markdown table. The bridge forwards upstream
responses without guaranteeing a stable provider schema; therefore, adding a
new normalized field requires a catalog update and a new
`field_catalog_version`, while an unknown additive field must not be inferred
from a similarly named field.

## COROS activity Markdown projection

The Obsidian activity note carries `projection_version: 2`. Each lap group is
rendered as its own Markdown table so 1 km, 5 km, 10 km, interval, and total
groups are not mixed. The trail-run table uses the COROS app labels `距离`,
`时间`, `累计时间`, `上升`, `下降`, `平均心率`, `最大心率`, `步频`, `步幅`,
`平均配速`, `等效配速`, `垂直速度`, and `跑步功率`. Provider-only fields stay
in the JSON sidecar until their catalog entry is confirmed. Markdown is a
readable projection; the sanitized JSON sidecar remains the complete local
provider record.

## FIT trajectory evidence

The FIT sidecar is provider evidence, not a stable COROS API schema. For route
matching, the observed record messages expose timestamped
`position_lat`/`position_long` points and may also expose `distance`,
`altitude`/`enhanced_altitude`, `speed`/`enhanced_speed`, heart rate, cadence,
and power. Session and lap messages provide activity boundaries. FIT protocol
definitions and developer fields must be parsed from each file; readers must
not assume that every activity has the same fields or sampling rate.

Route matching is a derived analysis result. The v1 matcher reads GPS points
and cumulative distance from FIT, then compares the first point and an early
trajectory anchor with the configured forward/reverse reference signatures and
the activity with the total-distance range. The default early anchor is the
point around 200 m after the activity start. It returns `matched`, `ambiguous`,
or `unmatched`, plus `route_key` and the activity-level
`route_direction` only for a unique match. `labelId` remains an activity key.

The standalone matcher indexes route distance ranges in coarse 1 km buckets
before checking the configured spatial signatures. It accepts a normalized points JSON document
so FIT decoding remains a separate provider-file concern:

```text
ActivityPoints = {
  sport_type: integer|null,
  distance_m: number|null,
  points: [{ lat: number, lon: number, distance_m: number|null }]
}
```

For an eligible `unmatched` activity, the result may include:

```text
RouteRegistrationProposal = {
  sport_types: integer[]|absent,
  distance_range_km: [number, number],
  direction_signatures: {
    forward: {
      start: { lat: number, lon: number },
      anchor: { lat: number, lon: number },
      anchor_distance_m: number,
      start_radius_m: number,
      anchor_radius_m: number
    },
    reverse: {
      start: { lat: number, lon: number },
      anchor: { lat: number, lon: number },
      anchor_distance_m: number,
      start_radius_m: number,
      anchor_radius_m: number
    }
  }
}
```

The sync flow asks the Athlete for the route name before persisting this
proposal. The first observed endpoint plus the point around 200 m later form
`forward`; the last endpoint plus the point around 200 m before the finish
form `reverse`. The initial distance range uses a 10% tolerance.
`ambiguous` results have no registration proposal.

## Private route read model

The private route views are safe projections for the Workout page and a
private Agent API. They are Athlete-scoped and exclude GPS, direction
signatures, raw FIT, FIT paths, and high-frequency telemetry:

```text
RouteIndexItem = {
  route_key: string,
  route_name: string,
  sport_types: integer[],
  distance_range_km: [number, number]|null,
  activity_count: integer,
  total_distance_km: number|null,
  total_duration_sec: number|null,
  latest_activity: SafeRouteHistoryRow|null
}

SafeRouteHistoryRow = {
  activity_ref: string,
  source_ref: string,
  local_date: LocalDate,
  timezone: string,
  started_at: Instant|null,
  ended_at: Instant|null,
  sport_type: SportType,
  sport_name: string,
  route_key: string,
  route_direction: forward|reverse|null,
  source_status: SourceStatus,
  sync_status: SourceStatus,
  data_as_of: Instant|null,
  summary: ActivitySummary
}
```

Route detail adds `history: SafeRouteHistoryRow[]` with bounded `from`, `to`,
and `limit` filters. The route index and detail include `data_as_of`,
`source_status`, and a stable `source_ref` for provenance.

Its route registry is `config/routes.json` and its implementation is
[`route-matcher.mjs`](../../skills/workout/scripts/route-matcher.mjs). The
program has no network or archive write side effect.

## Weekly Markdown

Every `weekly/YYYY-Www.md` includes:

```yaml
kind: training-week
schema_version: 1
week: 2026-W33
timezone: Asia/Shanghai
analysis_as_of: 2026-08-23T09:00:00+08:00
daily_inputs: []
```

The body separates source facts, derived comparisons, hypotheses, and
recommendations. A weekly note is generated only by an explicit manual
analysis request.

## Compatibility

Readers must preserve unrecognized provider metric names inside
`provider_metrics` and ignore unknown additive envelope fields. A change to a
stable field's meaning, type, unit, or relationship requires a new archive
schema version.
