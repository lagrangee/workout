// @ts-check

/** @typedef {"reps" | "duration_sec"} Metric */

/** @typedef {{ metric: Metric, min: number, max: number }} Target */

/** @typedef {{ metric: "reps" | "duration_sec", value: number }} CanonicalTarget */
/** @typedef {{ mode: "bodyweight" } | { mode: "external_load", value: number, unit: "kg" | "lb" } | null} CanonicalResistanceInput */
/** @typedef {{ set_id: string, ordinal: number, target: CanonicalTarget, resistance_mode: "bodyweight" | "external_load" | null, resistance_kg: number | null, tempo: string | null, rest_after_sec: number | null }} CanonicalPrescribedSet */
/** @typedef {{ occurrence_key: string, exercise_id: string, execution_mode: "none" | "bilateral" | "per_side" | "alternating", name: string, definition_version: number, sets: CanonicalPrescribedSet[] }} CanonicalExercisePrescription */
/** @typedef {{ completion_item_key: string, status: "completed" | "partial" | "skipped", actual: CanonicalTarget | null, resistance: CanonicalResistanceInput, rir: number | null, note: string | null, completed_at: string | null }} CanonicalSetResult */

/** @typedef {{ mode: "bodyweight" } | { mode: "external_load", load_kg: number | null, quantity: 1 } | null} CanonicalResistanceProjection */
/** @typedef {{ set_key: string, set_id: string, ordinal: number, target: CanonicalTarget, resistance_mode: "bodyweight" | "external_load" | null, resistance_kg: number | null, resistance: CanonicalResistanceProjection, tempo: string | null, rest_after_sec: number | null }} CanonicalSnapshotSet */
/** @typedef {{ exercise_occurrence_key: string, occurrence_key: string, exercise_id: string, name: string, definition_version: number, execution_mode: "none" | "bilateral" | "per_side" | "alternating", sets: CanonicalSnapshotSet[] }} CanonicalSnapshotExercise */
/** @typedef {{ completion_item_key: string, exercise_occurrence_key: string, occurrence_key: string, set_key: string, set_id: string, set_ordinal: number | null, side: "none" | "both" | "left" | "right", target: CanonicalTarget, resistance_mode: "bodyweight" | "external_load" | null, resistance_kg: number | null, resistance: CanonicalResistanceProjection, tempo: string | null, rest_after_sec: number | null }} CanonicalCompletionItem */
/** @typedef {{ schema_version: 2, title: string, start_time: string | null, estimated_duration_min: number | null, blocks: { block_key: string, title: string, exercises: CanonicalSnapshotExercise[] }[], completion_items: CanonicalCompletionItem[], exercise_occurrence_keys: string[] }} CanonicalSessionSnapshot */
/** @typedef {{ session_key: string, plan_id: string | null, plan_revision_key: string | null, scheduled_workout_key: string | null, scheduled_date: string, local_date: string, timezone_at_session: string, title: string, status: "planned" | "in_progress" | "completed" | "partial" | "abandoned" | "skipped", snapshot: CanonicalSessionSnapshot, completion_results: CanonicalSetResult[], set_results: CanonicalSetResult[], training_intervals: TrainingInterval[], session_rpe: number | null, note: string | null, skip_reason: string | null, exercise_feedback: ExerciseFeedback[], created_at: string, updated_at: string }} CanonicalWorkoutSession */

/** @typedef {"bodyweight" | "external_weight" | "assisted_weight"} ResistanceMode */

/** @typedef {{ mode: ResistanceMode, load_kg: number | null, quantity: number | null } | null} Resistance */

/** @typedef {{ eccentric_sec: number | null, bottom_hold_sec: number | null, concentric_sec: number | null, top_hold_sec: number | null } | null} Tempo */

/** @typedef {{ target: Target, resistance: Resistance, target_rir: number | null, target_rpe: number | null, tempo: Tempo, rest_after_sec: number | null, target_incline_percent: number | null }} PlanSet */

/** @typedef {"strength" | "endurance" | "mobility" | "recovery"} ExerciseCategory */

/** @typedef {"none" | "left_right"} SideMode */

/** @typedef {{ exercise_key: string, name: string, category: ExerciseCategory, side_mode: SideMode, sets: PlanSet[] }} PlanExercise */

/** @typedef {{ title: string, exercises: PlanExercise[] }} PlanBlock */

/** @typedef {{ schema_version: 1, source: "coros", sport_type: 100 | 102 | 104 | 200, route_key: string }} RecordingIntent */
/** @typedef {{ kind: "workout", title: string, start_time: string | null, estimated_duration_min: number, recording_intent?: RecordingIntent, blocks: PlanBlock[] }} WorkoutSlot */

/** @typedef {{ kind: "rest" }} RestSlot */

/** @typedef {WorkoutSlot | RestSlot | null} WeeklySlot */

/** @typedef {{ monday: WeeklySlot, tuesday: WeeklySlot, wednesday: WeeklySlot, thursday: WeeklySlot, friday: WeeklySlot, saturday: WeeklySlot, sunday: WeeklySlot }} Week */

/** @typedef {{ revision_key: string, revision_sequence: number, created_at: string, effective_from: string, week: Week }} PlanRevision */

/** @typedef {{ set_key: string } & PlanSet} SnapshotSet */

/** @typedef {{ exercise_occurrence_key: string, exercise_key: string, name: string, category: ExerciseCategory, side_mode: SideMode, sets: SnapshotSet[] }} SnapshotExercise */

/** @typedef {{ block_key: string, title: string, exercises: SnapshotExercise[] }} SnapshotBlock */

/** @typedef {"none" | "left" | "right"} Side */

/** @typedef {{ completion_item_key: string, exercise_occurrence_key: string, set_key: string, side: Side, target: Target, resistance: Resistance }} CompletionItem */

/** @typedef {{ schema_version?: number, title: string, start_time: string | null, estimated_duration_min: number | null, blocks: SnapshotBlock[], completion_items: CompletionItem[], exercise_occurrence_keys: string[] }} SessionSnapshot */

/** @typedef {{ metric: Metric, value: number }} Actual */

/** @typedef {{ completion_item_key: string, completed: true, actual: Actual, resistance: Resistance, rir: number | null, completed_at: string }} CompletionResult */

/** @typedef {{ interval_key: string, started_at: string, ended_at: string | null }} TrainingInterval */

/** @typedef {"in_progress" | "completed" | "partial" | "skipped"} SessionStatus */

/** @typedef {{ exercise_occurrence_key: string, text: string }} ExerciseFeedback */

/** @typedef {{ session_key: string, scheduled_workout_key: string | null, scheduled_date: string, local_date?: string, plan_id?: string | null, plan_revision_key?: string | null, timezone_at_session: string, title: string, status: SessionStatus, snapshot: SessionSnapshot, completion_results: CompletionResult[], set_results?: CanonicalSetResult[], training_intervals: TrainingInterval[], session_rpe: number | null, note: string | null, skip_reason: string | null, exercise_feedback: ExerciseFeedback[], created_at: string, updated_at: string }} WorkoutSession */

/** @typedef {{ token_digest: string, created_at: string, rotated_at: string | null, revoked_at: string | null }} AgentAccess */

/** @typedef {{ athlete_key: string, email: string, display_name: string, timezone: string, plan_revisions: PlanRevision[], sessions: WorkoutSession[], agent_access: AgentAccess | null }} AthleteState */

/** @typedef {{ DB?: unknown, ASSETS?: unknown, STORE?: unknown, ENVIRONMENT?: string, PRODUCTION_HOST?: string, PUBLIC_ORIGIN?: string, DEFAULT_TIMEZONE?: string, ATHLETE_A_EMAIL?: string, ATHLETE_B_EMAIL?: string, ATHLETE_A_DISPLAY_NAME?: string, ATHLETE_B_DISPLAY_NAME?: string, LOCAL_AUTH?: string, AUTH_A_PASSWORD?: string, AUTH_B_PASSWORD?: string, AUTH_SESSION_SECRET?: string, AUTH_LOGIN_LIMIT?: string | number, AUTH_LOGIN_CLIENT_LIMIT?: string | number, AUTH_LOGIN_WINDOW_SECONDS?: string | number, AUTH_LOGIN_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success?: boolean }> | { success?: boolean } }, AUTH_LOGIN_CLIENT_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success?: boolean }> | { success?: boolean } }, SECURITY_EVENT_SINK?: ((event: Record<string, unknown>) => void) | { emit(event: Record<string, unknown>): void }, AGENT_TOKEN_SECRET?: string }} WorkerEnv */

/** @typedef {{ waitUntil(promise: Promise<unknown>): void, passThroughOnException(): void }} WorkerExecutionContext */

export {};
