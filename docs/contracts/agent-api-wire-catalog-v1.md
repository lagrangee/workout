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
  links: { overview: string, plan: string, schedule: string },
  endpoints: object,
  capabilities: ["read", "plan:write"]
}
```

All link values are token-free relative Agent API paths. `capabilities` names
the personal Token scope; resource availability is still controlled by the
versioned API contract.

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

## Errors

```text
Error = { error: { code: string, message: string, details: object[] } }
```

Authentication failures use HTTP `401` and `agent_unauthorized`. Unsupported
methods use `405`; invalid selectors or request values use `400`; an absent
resource uses `404`; missing production configuration uses `503`.

`Instant` is an RFC 3339 UTC string. `IanaTimezone` is an IANA timezone name.
Unknown or inapplicable values are explicit `null`.
