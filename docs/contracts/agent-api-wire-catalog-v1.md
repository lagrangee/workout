# Agent API Wire Catalog v1

```text
SourceStatus = complete | none | partial | error
SportType = 100 | 101 | 102 | 104 | 200
LocalDate = "YYYY-MM-DD"
Instant = RFC3339 instant
IanaTimezone = string
```

## Agent access metadata

The authenticated App status response is:

```text
AgentAccessStatus = {
  active: boolean,
  created_at: Instant|null,
  rotated_at: Instant|null,
  revoked_at: Instant|null
}
```

The create/rotate response is:

```text
AgentAccessCreated = AgentAccessStatus & {
  token: string,
  copy_available: true
}
```

`token` is response-only. It is absent from status, revocation, serialized
Athlete state, D1 indexes, logs, exports, and MCP configuration committed to
the repository.

## Agent manifest

```text
AgentManifest = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  athlete: { display_name: string, timezone: IanaTimezone },
  timezone: IanaTimezone,
  unit_conventions: { resistance: "kg_per_implement", incline: "percent" },
  schema_catalog_url: string,
  updated_at: { plan: Instant|null, training: Instant|null },
  training_version: integer,
  archive_version: integer,
  query_rules: object,
  links: { overview: string, plan: string, schedule: string, sessions: string,
           progress: string, exercise: string, plan_update_validate: string,
           plan_update_apply: string, plan_update_batch_validate: string,
           plan_update_batch_apply: string, planned_day_move_validate: string,
           planned_day_move_apply: string, aerobic_sync: string, schemas: string,
           aerobic_activities: string, aerobic_activity: string,
           daily_context: string, routes: string, route: string,
           route_history: string },
  endpoints: object,
  capabilities: ["read", "plan:write", "plan-batch:write", "planned-day:move", "aerobic:write"]
}
```

All link values are token-free relative Agent API paths. `capabilities` names
the personal Token scope; resource availability is still controlled by the
versioned API contract.

The endpoint catalog includes the non-mutating validation operation:

```text
plan_update_validate: {
  method: "POST",
  path: "/api/agent/v1/plan-updates/validate",
  parameters: { package_text: { type: "string", content: "Plan Update Package v2 JSON" } },
  rules: { mutates: false, strict_package: true }
},
plan_update_apply: {
  method: "POST",
  path: "/api/agent/v1/plan-updates/apply",
  parameters: {
    package_text: { type: "string", content: "Plan Update Package v2 JSON" },
    package_digest: { type: "string", format: "sha256" },
    base_plan_digest: { type: "string", format: "sha256" },
    confirmed: { type: "boolean", const: true },
    idempotency_key: { type: "string", location: "header", name: "Idempotency-Key" }
  },
  rules: { mutates: true, requires_confirmation: true, idempotent: true, idempotency_window_hours: 24, strict_package: true }
},
plan_update_batch_validate: {
  method: "POST",
  path: "/api/agent/v1/plan-update-batches/validate",
  parameters: { batch_text: { type: "string", content: "Plan Update Batch v1 JSON" } },
  rules: { mutates: false, strict_batch: true, minimum_updates: 2, maximum_updates: 4 }
},
plan_update_batch_apply: {
  method: "POST",
  path: "/api/agent/v1/plan-update-batches/apply",
  parameters: {
    batch_text: { type: "string", content: "Plan Update Batch v1 JSON" },
    batch_digest: { type: "string", format: "sha256" },
    base_plan_digest: { type: "string", format: "sha256" },
    confirmed: { type: "boolean", const: true },
    idempotency_key: { type: "string", location: "header", name: "Idempotency-Key" }
  },
  rules: { mutates: true, requires_confirmation: true, idempotent: true, idempotency_window_hours: 24, strict_batch: true, atomic: true }
},
aerobic_sync: {
  method: "POST",
  path: "/api/agent/v1/aerobic/sync",
  parameters: {
    projection: { type: "object", content: "AerobicProjectionV1" },
    idempotency_key: { type: "string", location: "header", name: "Idempotency-Key" }
  },
  rules: { mutates: true, idempotent: true, idempotency_window_hours: 24, strict_projection: true, excludes_raw_fit_gps: true }
}
```

`aerobic_sync` returns the same safe publication receipt as the private
application-session sync boundary. It is the preferred write transport for the
local runner; the private endpoint remains the browser/compatibility adapter.
Both paths call the same domain projection validator and D1 mutation. A
successful response includes the resulting `archive_version`; the mutation
increments that version once and leaves `training_version` unchanged.

## Read resources

The first read resources use these versioned projections:

```text
AgentOverview = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  metric_semantics_version: 1,
  athlete: { display_name: string, timezone: IanaTimezone },
  coverage: object,
  updated_at: { plan: Instant|null, training: Instant|null },
  training_version: integer,
  current_plan: object|null,
  next_plan: object|null,
  period: Period,
  metrics: object,
  current_streak: object,
  recent_sessions: object[],
  source_ref: "overview"
}

AgentPlan = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  timezone: IanaTimezone,
  training_version: integer,
  source_ref: "plan",
  current: PlanProjection|null,
  future: PlanProjection[],
  next_effective_from: LocalDate|null,
  first_effective_from: LocalDate|null,
  pending_count: integer
}

PlanProjection = { effective_from: LocalDate, week: WeeklyTemplate, source_ref: string }

WeeklyTemplate = {
  monday: WeekSlot, tuesday: WeekSlot, wednesday: WeekSlot,
  thursday: WeekSlot, friday: WeekSlot, saturday: WeekSlot, sunday: WeekSlot
}

WeekSlot = null | { kind: "rest" } | { kind: "workout", prescription: Prescription }

AgentSchedule = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  from: LocalDate,
  to: LocalDate,
  timezone: IanaTimezone,
  period: Period,
  training_version: integer,
  entries: ScheduleEntry[],
  prescriptions: { [prescription_ref: string]: Prescription }
}

AgentSessionIndex = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  training_updated_at: Instant|null,
  training_version: integer,
  period: SessionPeriod,
  page: { limit: integer, next_cursor: string|null },
  items: SessionSummary[],
  source_ref: "sessions"
}

SessionSummary = {
  session_key: string,
  scheduled_date: LocalDate,
  local_date: LocalDate,
  title: string,
  status: "planned"|"in_progress"|"completed"|"partial"|"abandoned"|"skipped",
  completion_fraction: number,
  training_duration_sec: integer,
  session_rpe: number|null,
  exercise_ids: string[],
  exercise_keys: string[], # deprecated legacy alias; canonical clients use exercise_ids
  updated_at: Instant,
  source_ref: string
}

SessionPeriod = {
  from: LocalDate|null,
  to: LocalDate|null,
  timezone: IanaTimezone,
  includes_from: boolean,
  includes_to: boolean,
  includes_current_date: boolean,
  current_date_may_be_incomplete: boolean
}

AgentSessionDetail = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  session_key: string,
  plan_id: string|null,
  plan_revision_key: string|null,
  scheduled_date: LocalDate,
  local_date: LocalDate,
  timezone_at_session: IanaTimezone,
  title: string,
  status: "planned"|"in_progress"|"completed"|"partial"|"abandoned"|"skipped",
  completion_fraction: number,
  training_duration_sec: integer,
  session_rpe: number|null,
  note: string|null,
  skip_reason: string|null,
  snapshot: CanonicalSessionSnapshotV2,
  completion_results: SetResult[],
  set_results: SetResult[],
  training_intervals: object[],
  exercise_feedback: object[],
  updated_at: Instant,
  training_version: integer,
  source_ref: string
}

AgentProgress = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  metric_semantics_version: 1,
  period: Period,
  completion_rate_7d: object,
  completion_rate_30d: object,
  current_streak: object,
  metrics: object,
  bucket: "day"|"week"|"month",
  buckets: object[],
  week_buckets: object[],
  exercises: object[],
  training_version: integer,
  source_ref: "progress"
}

AgentExerciseHistory = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  period: Period,
  exercise_id: string,
  current_name: string,
  display_name_history: object[],
  performed_session_count: integer,
  observations: object[],
  series: { none: object[], both: object[], left: object[], right: object[] },
  training_version: integer,
  source_ref: string
}

AgentPlanUpdateValidation = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  training_version: integer,
  source_ref: "plan-update:validation",
  valid: true,
  package_digest: string,
  base_plan_digest: string,
  base_plan: { effective_from: LocalDate|null, through_date: LocalDate|null,
               week: object|null, source_ref: "plan:base" },
  preview: {
    effective_from: LocalDate,
    week: object,
    changed_weekday_slot_count: integer,
    source_ref: "plan-update:preview"
  }
}

AgentPlanUpdateApplication = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  training_version: integer,
  source_ref: "plan-update:application",
  applied: true,
  effective_from: LocalDate,
  package_digest: string,
  base_plan_digest: string,
  preview: {
    effective_from: LocalDate,
    week: object,
    changed_weekday_slot_count: integer,
    source_ref: "plan-update:preview"
  }
}

AgentPlanUpdateBatchValidation = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  training_version: integer,
  source_ref: "plan-update-batch:validation",
  valid: true,
  batch_digest: string,
  base_plan_digest: string,
  base_plan: { updates: object[], source_ref: "plan-update-batch:base" },
  preview: { from: LocalDate, to: LocalDate, update_count: integer,
             updates: object[], resulting_schedule: object,
             source_ref: "plan-update-batch:preview" }
}

AgentPlanUpdateBatchApplication = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  training_version: integer,
  source_ref: "plan-update-batch:application",
  applied: true,
  from: LocalDate,
  to: LocalDate,
  update_count: integer,
  batch_digest: string,
  base_plan_digest: string,
  preview: object
}

PlannedDayMove = { source_date: LocalDate, target_date: LocalDate }

AgentPlannedDayMoveValidation = {
  schema_version: 1, generated_at: Instant, data_as_of: Instant,
  training_version: integer, source_ref: "planned-day-move:validation",
  valid: true, move_digest: string, base_plan_digest: string,
  base_plan: object,
  preview: { operation: "move", source_date: LocalDate, target_date: LocalDate,
             before: object, after: object, affected_dates: LocalDate[],
             source_ref: "planned-day-move:preview" }
}

AgentPlannedDayMoveApplication = {
  schema_version: 1, generated_at: Instant, data_as_of: Instant,
  training_version: integer, source_ref: "planned-day-move:application",
  applied: true, source_date: LocalDate, target_date: LocalDate,
  change_key: string, move_digest: string, base_plan_digest: string,
  preview: object
}

ScheduleEntry = {
  date: LocalDate,
  weekday: string,
  kind: "workout"|"rest"|"no_plan",
  title: string|null,
  module_count: integer|null,
  estimated_duration_min: integer|null,
  prescription_ref: string|null,
  session_key: string|null,
  is_due: boolean,
  is_overdue_unstarted: boolean,
  source_ref: string
}

Prescription = {
  prescription_ref: string,
  title: string,
  start_time: string|null,
  estimated_duration_min: integer,
  blocks: object[]
}

CanonicalSessionSnapshotV2 = {
  schema_version: 2,
  title: string,
  start_time: string|null,
  estimated_duration_min: integer|null,
  blocks: CanonicalBlock[],
  completion_items: CompletionItem[],
  exercise_occurrence_keys: string[]
}

CanonicalBlock = {
  block_key: string,
  title: string,
  exercises: CanonicalExercise[]
}

CanonicalExercise = {
  exercise_occurrence_key: string,
  occurrence_key: string,
  exercise_id: string,
  name: string,
  definition_version: integer,
  category: "strength"|"endurance"|"mobility"|"recovery",
  execution_mode: "none"|"bilateral"|"per_side"|"alternating",
  sets: CanonicalSet[]
}

CanonicalSet = {
  set_key: string,
  set_id: string,
  ordinal: integer,
  target: { metric: "reps"|"duration_sec", value: integer },
  resistance_mode: "bodyweight"|"external_load"|null,
  resistance_kg: number|null,
  tempo: string|null,
  rest_after_sec: integer|null
}

CompletionItem = {
  completion_item_key: string,
  exercise_occurrence_key: string,
  occurrence_key: string,
  set_key: string,
  set_id: string,
  set_ordinal: integer|null,
  side: "none"|"both"|"left"|"right",
  target: { metric: "reps"|"duration_sec", value: integer },
  resistance_mode: "bodyweight"|"external_load"|null,
  resistance_kg: number|null,
  tempo: string|null,
  rest_after_sec: integer|null
}

SetResult = {
  completion_item_key: string,
  status: "completed"|"partial"|"skipped",
  actual: { metric: "reps"|"duration_sec", value: integer }|null,
  resistance_mode: "bodyweight"|"external_load"|null,
  resistance_kg: number|null,
  rir: integer|null,
  note: string|null,
  completed_at: Instant|null
}

Period = {
  from: LocalDate,
  to: LocalDate,
  timezone: IanaTimezone,
  includes_from: true,
  includes_to: true,
  includes_current_date: boolean,
  current_date_may_be_incomplete: boolean
}

AgentAerobicActivityIndex = {
  schema_version: 1,
  archive_version: integer,
  generated_at: Instant,
  data_as_of: Instant|null,
  source_status: SourceStatus,
  source_statuses: { workout: SourceStatus, coros: SourceStatus },
  source_ref: "agent:aerobic-activities",
  timezone: IanaTimezone,
  period: SessionPeriod,
  filters: { from: LocalDate|null, to: LocalDate|null, sport_type: SportType|null, route_key: string|null, limit: integer },
  page: { limit: integer, next_cursor: string|null },
  items: SafeAerobicActivity[]
}

SafeAerobicActivity = {
  schema_version: 1,
  activity_ref: string,
  source_ref: string,
  local_date: LocalDate,
  timezone: IanaTimezone,
  started_at: Instant|null,
  ended_at: Instant|null,
  sport_type: SportType,
  sport_name: string,
  source_status: SourceStatus,
  data_as_of: Instant|null,
  updated_at: Instant|null,
  route_key: string|null,
  route_direction: forward|reverse|null,
  route_match_status: matched|registered|unmatched|ambiguous|ignored|error,
  fit_status: complete|partial|error|null,
  summary: object,
  lookup: { activity_ref: string, source_ref: string, scope: "single_activity", explicit: true }
}

AgentAerobicActivityDetail = AgentAerobicActivityIndex without `period`,
`filters`, and `page`, with one SafeAerobicActivity and an explicit lookup
handle. It does not include `fit_file`, GPS, or provider export URLs.

AgentDailyContext = {
  schema_version: 1,
  archive_version: integer,
  generated_at: Instant,
  data_as_of: Instant|null,
  source_status: { workout: SourceStatus, coros: SourceStatus },
  source_statuses: { workout: SourceStatus, coros: SourceStatus },
  source_ref: string,
  local_date: LocalDate,
  timezone: IanaTimezone,
  sync_evidence: "synced"|"not_synced",
  context: object
}

AgentRouteIndex = {
  schema_version: 1,
  archive_version: integer,
  generated_at: Instant,
  data_as_of: Instant|null,
  source_status: SourceStatus,
  source_statuses: { workout: SourceStatus, coros: SourceStatus },
  source_ref: "agent:routes",
  filters: object,
  page: { limit: integer, next_cursor: string|null },
  items: object[]
}

AgentRouteDetail = {
  schema_version: 1,
  archive_version: integer,
  generated_at: Instant,
  data_as_of: Instant|null,
  source_status: SourceStatus,
  source_statuses: { workout: SourceStatus, coros: SourceStatus },
  source_ref: string,
  route_key: string,
  route_name: string,
  sport_types: integer[],
  distance_range_km: [number, number]|null,
  activity_count: integer,
  total_distance_km: number|null,
  total_duration_sec: number|null,
  history_period: { from: LocalDate|null, to: LocalDate|null },
  page: { limit: integer, next_cursor: string|null },
  history: object[]
}
```

`Prescription.blocks` contains typed block, exercise, and set objects with
scoped `block_key`, `exercise_occurrence_key`, and `set_key` values. It does
not contain `revision_key`, `scheduled_workout_key`, Athlete identifiers, or
database identities. A schedule response may leave `prescriptions` empty when
`expand` is absent; entries still carry their safe stable reference.

Session index cursors are opaque, versioned, HMAC-SHA-256-protected, and must
be sent back byte-for-byte. They are bound to the Athlete, Agent Session
resource, `from`, `to`, `status`, `exercise_id`, `limit`, immutable sort
position, issue time, and `training_version`, and expire after 15 minutes. A
malformed, tampered, old-format, cross-resource, expired, or mismatched value
returns `invalid_cursor` with HTTP 400. If the signed training version changes, traversal
must stop and restart from page one; the API returns
`training_version_changed` with HTTP 409. The index has stable newest-first
ordering by `(scheduled_date, session_key)` and does not promise a
cross-page snapshot.

Archive index and route-history cursors are likewise opaque, versioned,
HMAC-SHA-256-protected values and must be sent back byte-for-byte. They bind
the Athlete, resource, every Archive selector, `limit`, traversal position,
and `archive_version`, and expire after 15 minutes. Malformed, tampered,
old-version, expired, or mismatched values—including a cursor issued before an
Archive publication—return `invalid_cursor` with HTTP 400 and require a restart
from page one. Workout-only `training_version` changes do not invalidate
Archive traversal.

Progress evidence keeps empty denominators explicit (`value: null` where a
rate has no due workouts), and period responses mark a window containing the
Athlete's current local date as potentially incomplete. Exercise observations
retain the per-set actual metric, canonical resistance, RIR, side, and safe
`session:<date>:<session_key>` references; `series.none`, `series.both`,
`series.left`, and `series.right` never merge sides.

Plan Update validation and application reuse [Plan Update Package v2](plan-update-package-v2.md)
as their canonical package contract. The MCP tools accept a structured
`package` object and serialize it to the Agent request's exact `package_text`
field. MCP and Worker reuse one portable structural definition, so exact
members, required values, nullable resistance, and decimal four-phase tempo
have identical acceptance at both interfaces. Athlete-local dates, Registry
membership, Exercise capabilities, ordered/unique identities, and trimming
remain Worker-owned semantic decisions. The Worker then runs the strict text
validator. The response digest is
over the canonical package value and the base-plan digest is over the public
effective base evidence selected for the package's future date. This is the
template the preview compares against, including an already-effective future
revision when one wins at that date. Validation is non-mutating. Application
requires the same package and both digest values, an explicit `confirmed: true`,
and an `Idempotency-Key` header. Idempotency records are retained for 24 hours.
The Worker rechecks all evidence in the atomic mutation boundary, increments
`training_version` once, and appends one immutable revision. A successful
application does not expose its revision key. The MCP adapter then reads the
Current Plan and the affected seven-day Schedule as readback evidence and
checks that the returned plan date/content and schedule dates match the
application.

Plan Update Batch validation and application reuse
[Plan Update Batch v1](plan-update-batch-v1.md). The MCP tools accept a
structured `batch`, serialize it to `batch_text`, and preserve the same
preview-before-confirmation boundary. The Worker simulates members in order,
commits all revisions in one mutation, and increments `training_version` once.
MCP readback checks every effective date and the full inclusive batch Schedule.

## Errors

```text
Error = { error: { code: string, message: string, details: object[] } }
```

Authentication failures use HTTP `401` and `agent_unauthorized`. Unsupported
methods use `405`; invalid selectors or request values use `400`; an absent
resource uses `404`; stale package/base evidence, an idempotency conflict, or
a concurrent state change uses `409`; missing production configuration uses
`503`.

`Instant` is an RFC 3339 UTC string. `IanaTimezone` is an IANA timezone name.
Unknown or inapplicable values are explicit `null`.
