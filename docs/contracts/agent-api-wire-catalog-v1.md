# Agent API Wire Catalog v1

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
  updated_at: { plan: Instant|null, training: Instant|null },
  training_version: integer,
  query_rules: object,
  links: { overview: string, plan: string, schedule: string, sessions: string,
           progress: string, exercise: string, plan_update_validate: string,
           plan_update_apply: string },
  endpoints: object,
  capabilities: ["read", "plan:write"]
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
  parameters: { package_text: { type: "string", content: "Plan Update Package v1 JSON" } },
  rules: { mutates: false, strict_package: true }
},
plan_update_apply: {
  method: "POST",
  path: "/api/agent/v1/plan-updates/apply",
  parameters: {
    package_text: { type: "string", content: "Plan Update Package v1 JSON" },
    package_digest: { type: "string", format: "sha256" },
    base_plan_digest: { type: "string", format: "sha256" },
    confirmed: { type: "boolean", const: true },
    idempotency_key: { type: "string", location: "header", name: "Idempotency-Key" }
  },
  rules: { mutates: true, requires_confirmation: true, idempotent: true, strict_package: true }
}
```

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
  title: string,
  status: "in_progress"|"completed"|"partial"|"skipped",
  completion_fraction: number,
  training_duration_sec: integer,
  session_rpe: number|null,
  exercise_keys: string[],
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
  scheduled_date: LocalDate,
  timezone_at_session: IanaTimezone,
  title: string,
  status: "in_progress"|"completed"|"partial"|"skipped",
  completion_fraction: number,
  training_duration_sec: integer,
  session_rpe: number|null,
  note: string|null,
  skip_reason: string|null,
  snapshot: object,
  completion_results: object[],
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
  exercise_key: string,
  display_name_history: object[],
  performed_session_count: integer,
  observations: object[],
  series: { none: object[], left: object[], right: object[] },
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
  base_plan: { effective_from: LocalDate|null, week: object|null, source_ref: "plan:base" },
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
    week: WeeklyTemplate,
    changed_weekday_slot_count: integer,
    source_ref: "plan-update:preview"
  }
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

Period = {
  from: LocalDate,
  to: LocalDate,
  timezone: IanaTimezone,
  includes_from: true,
  includes_to: true,
  includes_current_date: boolean,
  current_date_may_be_incomplete: boolean
}
```

`Prescription.blocks` contains typed block, exercise, and set objects with
scoped `block_key`, `exercise_occurrence_key`, and `set_key` values. It does
not contain `revision_key`, `scheduled_workout_key`, Athlete identifiers, or
database identities. A schedule response may leave `prescriptions` empty when
`expand` is absent; entries still carry their safe stable reference.

Session index cursors are opaque and must be sent back byte-for-byte. They are
bound to `from`, `to`, `status`, `exercise_key`, and `limit`, expire after 15
minutes, and include `training_version`. If that version changes, traversal
must stop and restart from page one; the API returns
`training_version_changed` with HTTP 409. The index has stable newest-first
ordering by `(scheduled_date, session_key)` and does not promise a
cross-page snapshot.

Progress evidence keeps empty denominators explicit (`value: null` where a
rate has no due workouts), and period responses mark a window containing the
Athlete's current local date as potentially incomplete. Exercise observations
retain the per-set actual metric, resistance mode and quantities, RIR, side,
and safe `session:<date>:<session_key>` references; `series.none`, `series.left`,
and `series.right` never merge sides.

Plan Update validation and application reuse [Plan Update Package v1](plan-update-package-v1.md)
as their canonical package contract. The MCP tools accept a structured
`package` object and serialize it to the Agent request's exact `package_text`
field; the Worker then runs the strict text validator. The response digest is
over the canonical package value and the base-plan digest is over the public
effective base evidence selected for the package's future date. This is the
template the preview compares against, including an already-effective future
revision when one wins at that date. Validation is non-mutating. Application
requires the same package and both digest values, an explicit `confirmed: true`,
and an `Idempotency-Key` header; it rechecks all evidence in the atomic
mutation boundary and appends one immutable revision. A successful application
does not expose its revision key. The MCP adapter then reads the Current Plan
and the affected seven-day Schedule as readback evidence.

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
