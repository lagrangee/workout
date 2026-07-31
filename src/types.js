// @ts-check

/** @typedef {"reps" | "duration_sec"} Metric */

/** @typedef {{ metric: Metric, min: number, max: number }} Target */

/** @typedef {"bodyweight" | "external_weight" | "assisted_weight"} ResistanceMode */

/** @typedef {{ mode: ResistanceMode, load_kg: number | null, quantity: number | null } | null} Resistance */

/** @typedef {{ eccentric_sec: number | null, bottom_hold_sec: number | null, concentric_sec: number | null, top_hold_sec: number | null } | null} Tempo */

/** @typedef {{ target: Target, resistance: Resistance, target_rir: number | null, target_rpe: number | null, tempo: Tempo, rest_after_sec: number | null, target_incline_percent: number | null }} PlanSet */

/** @typedef {"strength" | "endurance" | "mobility" | "recovery"} ExerciseCategory */

/** @typedef {"none" | "left_right"} SideMode */

/** @typedef {{ exercise_key: string, name: string, category: ExerciseCategory, side_mode: SideMode, sets: PlanSet[] }} PlanExercise */

/** @typedef {{ title: string, exercises: PlanExercise[] }} PlanBlock */

/** @typedef {{ kind: "workout", title: string, start_time: string | null, estimated_duration_min: number, blocks: PlanBlock[] }} WorkoutSlot */

/** @typedef {{ kind: "rest" }} RestSlot */

/** @typedef {WorkoutSlot | RestSlot | null} WeeklySlot */

/** @typedef {{ monday: WeeklySlot, tuesday: WeeklySlot, wednesday: WeeklySlot, thursday: WeeklySlot, friday: WeeklySlot, saturday: WeeklySlot, sunday: WeeklySlot }} Week */

/** @typedef {{ revision_key: string, revision_sequence: number, created_at: string, effective_from: string, week: Week }} PlanRevision */

/** @typedef {{ set_key: string } & PlanSet} SnapshotSet */

/** @typedef {{ exercise_occurrence_key: string, exercise_key: string, name: string, category: ExerciseCategory, side_mode: SideMode, sets: SnapshotSet[] }} SnapshotExercise */

/** @typedef {{ block_key: string, title: string, exercises: SnapshotExercise[] }} SnapshotBlock */

/** @typedef {"none" | "left" | "right"} Side */

/** @typedef {{ completion_item_key: string, exercise_occurrence_key: string, set_key: string, side: Side, target: Target, resistance: Resistance }} CompletionItem */

/** @typedef {{ title: string, start_time: string | null, estimated_duration_min: number, blocks: SnapshotBlock[], completion_items: CompletionItem[], exercise_occurrence_keys: string[] }} SessionSnapshot */

/** @typedef {{ metric: Metric, value: number }} Actual */

/** @typedef {{ completion_item_key: string, completed: true, actual: Actual, resistance: Resistance, rir: number | null, completed_at: string }} CompletionResult */

/** @typedef {{ interval_key: string, started_at: string, ended_at: string | null }} TrainingInterval */

/** @typedef {"in_progress" | "completed" | "partial" | "skipped"} SessionStatus */

/** @typedef {{ exercise_occurrence_key: string, text: string }} ExerciseFeedback */

/** @typedef {{ session_key: string, scheduled_workout_key: string | null, scheduled_date: string, timezone_at_session: string, title: string, status: SessionStatus, snapshot: SessionSnapshot, completion_results: CompletionResult[], training_intervals: TrainingInterval[], session_rpe: number | null, note: string | null, skip_reason: string | null, exercise_feedback: ExerciseFeedback[], created_at: string, updated_at: string }} WorkoutSession */

/** @typedef {{ athlete_key: string, email: string, display_name: string, timezone: string, plan_revisions: PlanRevision[], sessions: WorkoutSession[] }} AthleteState */

/** @typedef {{ DB?: unknown, ASSETS?: unknown, STORE?: unknown, ENVIRONMENT?: string, PRODUCTION_HOST?: string, PUBLIC_ORIGIN?: string, DEFAULT_TIMEZONE?: string, ATHLETE_A_EMAIL?: string, ATHLETE_B_EMAIL?: string, ATHLETE_A_DISPLAY_NAME?: string, ATHLETE_B_DISPLAY_NAME?: string, LOCAL_AUTH?: string, AUTH_A_PASSWORD?: string, AUTH_B_PASSWORD?: string, AUTH_SESSION_SECRET?: string }} WorkerEnv */

/** @typedef {{ waitUntil(promise: Promise<unknown>): void, passThroughOnException(): void }} WorkerExecutionContext */

export {};
