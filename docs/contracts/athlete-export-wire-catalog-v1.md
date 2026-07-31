# Athlete Export Wire Catalog v1

## Authority

This catalog defines the exact v1 full-export shape. Every property is
required; known absence uses `null`, arrays remain present when empty, and v1
producers emit no undeclared properties. `LocalDate`, `Instant`, and
`ExportKey` are strings. Export keys are opaque, stable for the same Athlete,
and resolve only inside that Athlete's successive exports.

The types below are independently versioned even where their field meanings
match Plan Update Package or Coach API.

## Plan Types

```text
Resistance = null | {
  mode: bodyweight|external_weight|assisted_weight,
  load_kg: number|null, quantity: integer|null
}
Target = { metric: reps|duration_sec, min: integer, max: integer }
PlanSet = {
  target: Target, resistance: Resistance, target_rir: integer|null,
  target_rpe: number|null,
  tempo: null|{ eccentric_sec: integer|null, bottom_hold_sec: integer|null,
                concentric_sec: integer|null, top_hold_sec: integer|null },
  rest_after_sec: integer|null, target_incline_percent: number|null
}
PlanExercise = {
  exercise_key: string, name: string,
  category: strength|endurance|mobility|recovery,
  side_mode: none|left_right, sets: PlanSet[]
}
PlanBlock = { title: string, exercises: PlanExercise[] }
Workout = {
  kind: workout, title: string, start_time: string|null,
  estimated_duration_min: integer, blocks: PlanBlock[]
}
WeekSlot = null | { kind: rest } | Workout
Week = {
  monday: WeekSlot, tuesday: WeekSlot, wednesday: WeekSlot,
  thursday: WeekSlot, friday: WeekSlot, saturday: WeekSlot, sunday: WeekSlot
}
PlanRevision = {
  revision_key: ExportKey, revision_sequence: integer,
  created_at: Instant, effective_from: LocalDate, week: Week
}
```

All ranges and combinations follow Plan Update Package v1. `revision_sequence`
starts at 1 and strictly increases.

## Schedule and Snapshot Types

```text
ScheduledWorkout = {
  scheduled_workout_key: ExportKey, scheduled_date: LocalDate,
  kind: workout|rest, revision_key: ExportKey,
  prescription: Workout|null, session_key: ExportKey|null,
  is_overdue_unstarted: boolean
}

SnapshotSet = PlanSet & { set_key: ExportKey }
SnapshotExercise = {
  exercise_occurrence_key: ExportKey, exercise_key: string, name: string,
  category: strength|endurance|mobility|recovery,
  side_mode: none|left_right, sets: SnapshotSet[]
}
SnapshotBlock = {
  block_key: ExportKey, title: string, exercises: SnapshotExercise[]
}
CompletionItem = {
  completion_item_key: ExportKey, exercise_occurrence_key: ExportKey,
  set_key: ExportKey, side: none|left|right, target: Target
}
TrainingPlanSnapshot = {
  title: string, start_time: string|null, estimated_duration_min: integer,
  blocks: SnapshotBlock[], completion_items: CompletionItem[]
}
```

A Rest Day has `prescription: null` and no Session. No-plan dates are absent
from `scheduled_workouts`.

## Session Types

```text
CompletionResult = {
  completion_item_key: ExportKey,
  actual: { metric: reps|duration_sec, value: integer },
  resistance: Resistance, rir: integer|null, completed_at: Instant
}
TrainingInterval = {
  interval_key: ExportKey, started_at: Instant, ended_at: Instant|null
}
ExerciseFeedback = {
  exercise_occurrence_key: ExportKey, text: string
}
Session = {
  session_key: ExportKey, scheduled_workout_key: ExportKey,
  scheduled_date: LocalDate, timezone_at_session: string, title: string,
  status: in_progress|completed|partial|skipped,
  completion_fraction: number, training_duration_sec: integer,
  session_rpe: integer|null, note: string|null, skip_reason: string|null,
  snapshot: TrainingPlanSnapshot,
  completion_results: CompletionResult[],
  training_intervals: TrainingInterval[],
  exercise_feedback: ExerciseFeedback[],
  created_at: Instant, updated_at: Instant
}
```

The validation and state combinations are those in Session Record v1. Only
latest corrected values are exported.

## Top-Level Export

```text
AthleteExportV1 = {
  athlete_export_schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  timezone: string,
  counts: {
    plan_revisions: integer,
    scheduled_workouts: integer,
    sessions: integer
  },
  athlete: {
    display_name: string,
    timezone: string,
    unit_conventions: {
      resistance: kg_per_implement,
      incline: percent
    }
  },
  plan_revisions: PlanRevision[],
  scheduled_workouts: ScheduledWorkout[],
  sessions: Session[]
}
```

Collections use `revision_sequence ASC`, `scheduled_date ASC`, and
`scheduled_date ASC, session_key ASC` respectively. With no plan or history,
all counts are zero and all collections are empty. Relationships and counts
must resolve exactly.
