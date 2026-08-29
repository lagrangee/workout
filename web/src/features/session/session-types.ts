export type SessionStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "partial"
  | "abandoned"
  | "skipped";

export type CompletionStatus = "completed" | "partial" | "skipped";
export type ExecutionMode = "none" | "bilateral" | "per_side" | "alternating";
export type RawSessionSide = "none" | "both" | "left" | "right";
export type SessionSide = RawSessionSide | "alternating";
export type ResistanceMode =
  | "bodyweight"
  | "external_load"
  | "external_weight"
  | "assisted_weight";

export interface TargetValue {
  metric: string;
  value?: number;
  min?: number;
  max?: number;
  target_rir?: number | null;
  target_rpe?: number | null;
  target_incline_percent?: number | null;
}

export interface ActualValue {
  metric: string;
  value: number;
}

export interface TempoPhases {
  eccentric_sec?: number | null;
  bottom_hold_sec?: number | null;
  concentric_sec?: number | null;
  top_hold_sec?: number | null;
}

export type TempoValue = string | TempoPhases | null;

/**
 * Read-side resistance projection. It deliberately accepts both the legacy
 * `load_kg` shape and the canonical write-side `value` shape because Session
 * details and pending record inputs cross that boundary in the UI.
 */
export interface ResistanceValue {
  mode: ResistanceMode;
  load_kg?: number | null;
  value?: number | null;
  unit?: string;
  quantity?: number | null;
}

export type CanonicalResistanceInput =
  | { mode: "bodyweight" }
  | { mode: "external_load"; value: number; unit: "kg" | "lb" }
  | null;

export type LegacyResistanceInput =
  | { mode: "bodyweight"; load_kg: null; quantity: null }
  | {
      mode: "external_weight" | "assisted_weight";
      load_kg: number | null;
      quantity: number;
    }
  | null;

export interface SnapshotSet {
  set_key?: string;
  set_id?: string;
  ordinal?: number;
  target: TargetValue;
  resistance?: ResistanceValue | null;
  resistance_mode?: ResistanceMode | null;
  resistance_kg?: number | null;
  tempo?: TempoValue;
  rest_after_sec?: number | null;
  target_rir?: number | null;
  target_rpe?: number | null;
  target_incline_percent?: number | null;
}

export interface SnapshotExercise {
  exercise_occurrence_key?: string;
  occurrence_key?: string;
  exercise_key?: string;
  exercise_id?: string;
  name?: string;
  execution_mode?: ExecutionMode;
  side_mode?: "none" | "left_right";
  sets?: SnapshotSet[];
}

export interface SnapshotBlock {
  block_key?: string;
  title?: string;
  exercises?: SnapshotExercise[];
}

export interface CompletionItem {
  completion_item_key: string;
  exercise_occurrence_key: string;
  occurrence_key?: string;
  set_key: string;
  set_id?: string;
  set_ordinal?: number | null;
  side?: RawSessionSide;
  target: TargetValue;
  resistance?: ResistanceValue | null;
  resistance_mode?: ResistanceMode | null;
  resistance_kg?: number | null;
  tempo?: TempoValue;
  rest_after_sec?: number | null;
}

export interface DisplayCompletionItem extends Omit<CompletionItem, "side"> {
  side?: SessionSide;
  alternating?: boolean;
  completion_item_keys?: string[];
}

export interface SessionSnapshot {
  schema_version?: number;
  title?: string;
  start_time?: string | null;
  estimated_duration_min?: number | null;
  blocks?: SnapshotBlock[];
  completion_items?: CompletionItem[];
  exercise_occurrence_keys?: string[];
}

/**
 * The server's read model projects canonical and legacy results through the
 * same `completion_results` array. Optional compatibility fields keep that
 * read model distinct from the exact record-input types below.
 */
export interface SessionCompletionResult {
  completion_item_key: string;
  status?: CompletionStatus;
  completed?: boolean;
  actual?: ActualValue | null;
  resistance?: ResistanceValue | null;
  resistance_mode?: ResistanceMode | null;
  resistance_kg?: number | null;
  rir?: number | null;
  note?: string | null;
  completed_at?: string | null;
}

export interface TrainingInterval {
  interval_key: string;
  started_at: string;
  ended_at: string | null;
}

export interface ExerciseFeedback {
  exercise_occurrence_key: string;
  text: string;
}

export interface SessionDetail extends Record<string, unknown> {
  session_key: string;
  status: SessionStatus;
  snapshot: SessionSnapshot;
  completion_results: SessionCompletionResult[];
  set_results?: SessionCompletionResult[];
  training_intervals: TrainingInterval[];
  session_rpe: number | null;
  note: string | null;
  skip_reason: string | null;
  exercise_feedback: ExerciseFeedback[];
  scheduled_date?: string;
  title?: string;
  updated_at?: string;
  completion_fraction?: number;
  training_duration_sec?: number;
}

export interface ItemContext {
  block: SnapshotBlock | null;
  exercise: SnapshotExercise | null;
  set: SnapshotSet | null;
  setNumber: number | null;
}

export interface LegacyCompletionResultInput {
  completion_item_key: string;
  completed: true;
  actual: ActualValue;
  resistance: LegacyResistanceInput;
  rir: number | null;
  completed_at: string;
}

export interface CanonicalSetResultInput {
  completion_item_key: string;
  status: CompletionStatus;
  actual: ActualValue | null;
  resistance: CanonicalResistanceInput;
  rir: number | null;
  note: string | null;
  completed_at: string | null;
}

export interface SessionRecordCommon {
  training_intervals: TrainingInterval[];
  session_rpe: number | null;
  note: string | null;
  exercise_feedback: ExerciseFeedback[];
  skip_reason: string | null;
}

export interface LegacySessionRecordInput extends SessionRecordCommon {
  record_schema_version: 1;
  completion_results: LegacyCompletionResultInput[];
}

export interface CanonicalSessionRecordInput extends SessionRecordCommon {
  record_schema_version: 2;
  set_results: CanonicalSetResultInput[];
}

export type SessionRecordInput = LegacySessionRecordInput | CanonicalSessionRecordInput;

export interface CompleteItemInput {
  actualValue: number | string;
  resistanceLoad?: number | string | null;
  rir?: number | string | null;
  completedAt: string;
}

export interface SessionRecordOverrides {
  results?: SessionCompletionResult[];
  trainingIntervals?: TrainingInterval[];
  sessionRpe?: number | null;
  note?: string | null;
  exerciseFeedback?: ExerciseFeedback[];
  skipReason?: string | null;
}

export interface EndSessionInput {
  record: SessionRecordInput;
  ended_at: string;
}
