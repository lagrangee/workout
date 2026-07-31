# Coach Agent Wire Catalog v1

## Authority

This catalog is the exact v1 response-shape authority for Coach JSON routes.
Every listed property is required; nullable properties use `| null`, arrays
remain present when empty, and v1 producers emit no undeclared properties.
JSON Schema 2020-12 resources at `/api/coach/v1/schemas` are generated from
these types and golden-tested against route responses. Additive fields require
updating this catalog; breaking changes require `/v2/`.

`LocalDate`, `Instant`, `OpaqueKey`, and `SourceRef` are strings formatted as
specified in the main Coach contract. `Weekday` is
`monday|tuesday|wednesday|thursday|friday|saturday|sunday`.

## Shared Types

```text
Envelope = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant
}

Resistance = null | {
  mode: bodyweight|external_weight|assisted_weight,
  load_kg: number|null,
  quantity: integer|null
}

Target = { metric: reps|duration_sec, min: integer, max: integer }
Set = {
  set_key: OpaqueKey, target: Target, resistance: Resistance,
  target_rir: integer|null, target_rpe: number|null,
  tempo: null|{ eccentric_sec: integer|null, bottom_hold_sec: integer|null,
                concentric_sec: integer|null, top_hold_sec: integer|null },
  rest_after_sec: integer|null, target_incline_percent: number|null
}
ExerciseOccurrence = {
  exercise_occurrence_key: OpaqueKey, exercise_key: string, name: string,
  category: strength|endurance|mobility|recovery,
  side_mode: none|left_right, sets: Set[]
}
Block = { block_key: OpaqueKey, title: string, exercises: ExerciseOccurrence[] }
Prescription = {
  prescription_ref: OpaqueKey, title: string, start_time: string|null,
  estimated_duration_min: integer, blocks: Block[]
}
WeekSlot = null | { kind: rest } | { kind: workout, prescription: Prescription }
WeeklyTemplate = {
  monday: WeekSlot, tuesday: WeekSlot, wednesday: WeekSlot,
  thursday: WeekSlot, friday: WeekSlot, saturday: WeekSlot, sunday: WeekSlot
}
```

Set validation, Resistance combinations, ranges, and Completion Item expansion
follow the Coach projection of the canonical rules in Plan Update Package v1.

## Manifest, Overview, and Plan

```text
Manifest = Envelope & {
  metric_semantics_version: 1,
  athlete: { display_name: string, timezone: string },
  unit_conventions: {
    resistance: kg_per_implement, incline: percent
  },
  updated_at: { plan: Instant|null, training: Instant|null },
  training_version: integer,
  data_coverage: {
    first_plan_date: LocalDate|null, first_session_date: LocalDate|null,
    latest_session_date: LocalDate|null, session_count: integer,
    in_progress_session_count: integer, data_as_of: Instant,
    current_local_date: LocalDate, current_date_may_be_incomplete: boolean
  },
  links: {
    overview: string, plan: string, schedule: string, sessions: string,
    progress: string, exercise: string, schemas: string
  }
}

PlanSummary = {
  effective_from: LocalDate, title_by_weekday: { [Weekday]: string|null },
  workout_day_count: integer, rest_day_count: integer
}

PlanResponse = Envelope & {
  current: null|{ effective_from: LocalDate, week: WeeklyTemplate },
  future: { effective_from: LocalDate, week: WeeklyTemplate }[]
}

OverviewResponse = Envelope & {
  metric_semantics_version: 1,
  athlete: { display_name: string, timezone: string },
  coverage: Manifest.data_coverage,
  updated_at: Manifest.updated_at,
  training_version: integer,
  current_plan: PlanSummary|null,
  next_plan: PlanSummary|null,
  period: Period,
  metrics: MetricSet,
  current_streak: StreakMetric,
  recent_sessions: SessionSummary[]
}
```

No plan is represented by `current: null`, `future: []`, and nullable overview
summaries. Multiple future templates remain ordered by `effective_from ASC`.

## Schedule

```text
ScheduleEntry = {
  date: LocalDate, weekday: Weekday, kind: workout|rest|no_plan,
  title: string|null, estimated_duration_min: integer|null,
  prescription_ref: OpaqueKey|null, session_key: OpaqueKey|null,
  is_due: boolean, is_overdue_unstarted: boolean, source_ref: SourceRef
}

ScheduleResponse = Envelope & {
  from: LocalDate, to: LocalDate, timezone: string,
  entries: ScheduleEntry[],
  prescriptions: { [prescription_ref: OpaqueKey]: Prescription }
}
```

Without `expand=prescription`, `prescriptions` is `{}`. Rest and no-plan entries
have nullable workout fields. Expanded workout entries resolve exactly one key
in the deduplicated `prescriptions` object.

## Sessions

```text
SessionSummary = {
  session_key: OpaqueKey, scheduled_date: LocalDate, title: string,
  status: in_progress|completed|partial|skipped,
  completion_fraction: number, training_duration_sec: integer,
  session_rpe: integer|null, exercise_keys: string[],
  updated_at: Instant, source_ref: SourceRef
}

SessionIndexResponse = Envelope & {
  training_updated_at: Instant|null, training_version: integer,
  page: { limit: integer, next_cursor: string|null },
  items: SessionSummary[]
}

CompletionResult = {
  completion_item_key: OpaqueKey, actual: {
    metric: reps|duration_sec, value: integer
  },
  resistance: Resistance, rir: integer|null, completed_at: Instant
}
TrainingInterval = {
  interval_key: OpaqueKey, started_at: Instant, ended_at: Instant|null
}
ExerciseFeedback = {
  exercise_occurrence_key: OpaqueKey, text: string
}
CompletionItem = {
  completion_item_key: OpaqueKey, set_key: OpaqueKey,
  side: none|left|right, target: Target
}
SessionDetailResponse = Envelope & {
  session_key: OpaqueKey, scheduled_date: LocalDate,
  timezone_at_session: string, title: string,
  status: in_progress|completed|partial|skipped,
  completion_fraction: number, training_duration_sec: integer,
  session_rpe: integer|null, note: string|null, skip_reason: string|null,
  snapshot: {
    blocks: Block[], completion_items: CompletionItem[]
  },
  completion_results: CompletionResult[],
  training_intervals: TrainingInterval[],
  exercise_feedback: ExerciseFeedback[],
  updated_at: Instant, source_ref: SourceRef
}
```

The result, interval, RPE, note, skip-reason, and feedback constraints are those
in Session Record v1. An in-progress detail has one open interval; terminal and
skipped details do not.

## Progress

```text
Period = {
  from: LocalDate, to: LocalDate, timezone: string,
  current_date_may_be_incomplete: boolean
}
CompletionEvidence = {
  completion_points: number, due_workouts: integer,
  completed: integer, partial: integer, in_progress: integer, skipped: integer,
  overdue_unstarted: integer, not_due_unstarted: integer,
  rest_days: integer, no_plan_days: integer
}
RateMetric = { value: number|null, evidence: CompletionEvidence }
CountMetric = { value: integer, session_refs: SourceRef[] }
DurationMetric = { value_sec: integer, session_refs: SourceRef[] }
AverageRpeMetric = {
  value: number|null, included_count: integer, excluded_null_count: integer
}
StreakMetric = {
  value: integer, first_qualifying_date: LocalDate|null,
  last_qualifying_date: LocalDate|null
}
MetricSet = {
  completion_rate: RateMetric, training_duration: DurationMetric,
  strength_training_days: CountMetric, average_session_rpe: AverageRpeMetric
}
WeekBucket = {
  week_start: LocalDate, week_end: LocalDate,
  included_from: LocalDate, included_to: LocalDate, metrics: MetricSet
}
ExerciseSummary = {
  exercise_key: string, current_name: string,
  performed_session_count: integer, detail_ref: SourceRef
}
ProgressResponse = Envelope & {
  metric_semantics_version: 1, period: Period,
  completion_rate_7d: RateMetric, completion_rate_30d: RateMetric,
  current_streak: StreakMetric, metrics: MetricSet,
  week_buckets: WeekBucket[], exercises: ExerciseSummary[]
}
```

## Exercise Detail and Errors

```text
ExerciseSetObservation = {
  completion_item_key: OpaqueKey, set_key: OpaqueKey,
  side: none|left|right, actual: {
    metric: reps|duration_sec, value: integer
  },
  resistance: Resistance, total_external_kg: number|null,
  assistance_kg: number|null, rir: integer|null
}
ExerciseSessionObservation = {
  session_key: OpaqueKey, scheduled_date: LocalDate,
  source_ref: SourceRef, sets: ExerciseSetObservation[],
  total_reps: integer|null, total_duration_sec: integer|null,
  highest_external_load_kg_per_implement: number|null,
  highest_external_total_kg: number|null,
  lowest_assistance_kg_per_implement: number|null
}
ExerciseSeriesPoint = {
  session_key: OpaqueKey, scheduled_date: LocalDate,
  completion_item_key: OpaqueKey, actual: {
    metric: reps|duration_sec, value: integer
  },
  resistance: Resistance, rir: integer|null
}
ExerciseDetailResponse = Envelope & {
  period: Period, exercise_key: string,
  display_name_history: {
    name: string, first_date: LocalDate, last_date: LocalDate
  }[],
  performed_session_count: integer,
  observations: ExerciseSessionObservation[],
  series: {
    none: ExerciseSeriesPoint[],
    left: ExerciseSeriesPoint[],
    right: ExerciseSeriesPoint[]
  }
}

ErrorResponse = {
  schema_version: 1, generated_at: Instant,
  error: { code: string, message: string, details: unknown[] }
}
```

Observations are ordered by `scheduled_date ASC, session_key ASC`; set order
matches the snapshot. Incompatible totals are `null`. A scoped Exercise with no
observations in the selected range returns `200` with `observations: []`; an
unknown scoped `exercise_key` returns `404`.

`total_external_kg` is `load_kg × quantity`; it is not multiplied by
repetitions. Assistance exposes the per-implement assistance value, where lower
means less assistance. The three series contain the same completed set
observations partitioned by side and ordered by date, Session, then set.

## Schema Resources

```text
SchemaIndexResponse = {
  schema_version: 1, generated_at: Instant,
  schemas: {
    name: manifest|overview|weekly_template|plan|schedule|session_index|
          session_detail|progress|exercise_detail|error,
    href: string, json_schema_draft: "2020-12"
  }[]
}
```

The index uses the order shown above. `weekly_template` is the reusable schema
referenced by `plan` and expanded `schedule`. Each `href` returns the named JSON
Schema 2020-12 document directly, with required `$schema`, `$id`, `title`, and
`type` members; it is not wrapped in an API envelope.
