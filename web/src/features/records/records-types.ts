export type RecordsTab = "overview" | "strength" | "aerobic";
export type ProgressRange = "current" | "previous" | "all";
export type RouteOrigin = "list" | "activity";
export type ScheduleKind = "workout" | "rest" | "no_plan";
export type SourceStatus = "complete" | "none" | "partial" | "error";
export type AerobicSportType = 100 | 101 | 102 | 104 | 200;
export type RouteDirection = "forward" | "reverse" | null;
export type RouteMatchStatus = "matched" | "registered" | "unmatched" | "ambiguous" | "ignored" | "error";
export type FitStatus = "complete" | "partial" | "error" | null;

export interface RecordsOverviewDay {
  local_date: string;
  schedule_kind: ScheduleKind;
  workout_session_count: number;
  workout_session_keys: string[];
  aerobic_activity_count: number;
  activity_refs: string[];
  aerobic_summary: Record<string, unknown>;
  relation_policy: "same_local_date_context_only";
}

export interface RecordsOverviewResponse {
  schema_version: 1;
  generated_at: string;
  period: { from: string; to: string; timezone: string };
  source_statuses: { workout: SourceStatus; coros: SourceStatus };
  relation_policy: "same_local_date_context_only";
  workout: { source: "workout"; session_count: number; table: Record<string, unknown> };
  aerobic: { source: "coros"; activity_count: number; source_status: SourceStatus };
  days: RecordsOverviewDay[];
}

export interface ExerciseProgressItem {
  exercise_key: string;
  current_name: string;
  performed_session_count: number;
}

export interface ProgressResponse {
  metric_semantics_version: 1;
  period: { from: string; to: string };
  metrics: {
    completion_rate: { value: number | null };
    training_duration: { value_sec: number };
    strength_training_days: { value: number };
    average_session_rpe: { value: number | null; included_count: number };
  };
  current_streak: { value: number };
  exercises: ExerciseProgressItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asProgressResponse(value: unknown): ProgressResponse | null {
  if (!isRecord(value)) return null;
  if (value.metric_semantics_version !== 1 || !isRecord(value.period) || !isRecord(value.metrics)
    || !isRecord(value.current_streak) || !Array.isArray(value.exercises)) return null;
  const completionRate = value.metrics.completion_rate;
  const trainingDuration = value.metrics.training_duration;
  const strengthTrainingDays = value.metrics.strength_training_days;
  const averageSessionRpe = value.metrics.average_session_rpe;
  if (!isRecord(completionRate) || !isRecord(trainingDuration) || !isRecord(strengthTrainingDays)
    || !isRecord(averageSessionRpe)) return null;
  const numberOrNull = (candidate: unknown): candidate is number | null => (
    candidate === null || (typeof candidate === "number" && Number.isFinite(candidate))
  );
  const finiteNumber = (candidate: unknown): candidate is number => typeof candidate === "number" && Number.isFinite(candidate);
  if (typeof value.period.from !== "string" || typeof value.period.to !== "string"
    || !numberOrNull(completionRate.value) || !finiteNumber(trainingDuration.value_sec)
    || !finiteNumber(strengthTrainingDays.value) || !numberOrNull(averageSessionRpe.value)
    || !finiteNumber(averageSessionRpe.included_count) || !finiteNumber(value.current_streak.value)) return null;
  const exercises = value.exercises.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.exercise_key !== "string" || typeof candidate.current_name !== "string"
      || !finiteNumber(candidate.performed_session_count)) return [];
    return [{
      exercise_key: candidate.exercise_key,
      current_name: candidate.current_name,
      performed_session_count: candidate.performed_session_count,
    }];
  });
  if (exercises.length !== value.exercises.length) return null;
  return {
    metric_semantics_version: 1,
    period: { from: value.period.from, to: value.period.to },
    metrics: {
      completion_rate: { value: completionRate.value },
      training_duration: { value_sec: trainingDuration.value_sec },
      strength_training_days: { value: strengthTrainingDays.value },
      average_session_rpe: { value: averageSessionRpe.value, included_count: averageSessionRpe.included_count },
    },
    current_streak: { value: value.current_streak.value },
    exercises,
  };
}

export interface ExerciseSetObservation {
  side?: string;
  actual?: {
    value?: string | number | null;
    metric?: string | null;
  } | null;
}

export interface ExerciseObservation {
  session_key?: string;
  scheduled_date?: string;
  sets?: ExerciseSetObservation[];
}

export interface ExerciseDetailResponse {
  exercise_key: string;
  current_name?: string;
  performed_session_count?: number;
  observations?: ExerciseObservation[];
}

export interface AerobicSummary {
  duration_sec: number | null;
  distance_km: number | null;
  average_heart_rate_bpm: number | null;
  calories_kcal: number | null;
}

export interface AerobicActivity {
  schema_version: 1;
  activity_ref: string;
  source_ref: string;
  local_date: string;
  timezone: string;
  started_at: string | null;
  ended_at: string | null;
  sport_type: AerobicSportType;
  sport_name: string;
  source_status: SourceStatus;
  data_as_of: string | null;
  updated_at: string | null;
  summary: AerobicSummary;
  route_key: string | null;
  route_direction: RouteDirection;
  route_match_status: RouteMatchStatus;
  fit_status: FitStatus;
}

export interface AerobicListResponse {
  schema_version: 1;
  generated_at: string;
  data_as_of: string | null;
  timezone: string;
  source_status: SourceStatus;
  source_statuses: { workout: SourceStatus; coros: SourceStatus };
  source_ref: "aerobic-records";
  filters: { from: string | null; to: string | null; sport_type: AerobicSportType | null; limit: number };
  page: { limit: number; next_cursor: null };
  items: AerobicActivity[];
}

export interface AerobicDetailResponse extends AerobicActivity {
  generated_at: string;
  source_statuses: { workout: SourceStatus; coros: SourceStatus };
}

export interface RouteHistoryActivity {
  activity_ref: string;
  source_ref: string;
  local_date: string;
  timezone: string;
  started_at: string | null;
  ended_at: string | null;
  sport_type: AerobicSportType;
  sport_name: string;
  route_key: string;
  route_direction: RouteDirection;
  source_status: SourceStatus;
  sync_status: SourceStatus;
  data_as_of: string | null;
  summary: AerobicSummary;
}

export interface RouteItem {
  route_key: string;
  route_name: string;
  sport_types: AerobicSportType[];
  distance_range_km: [number, number] | null;
  activity_count: number;
  total_distance_km: number | null;
  total_duration_sec: number | null;
  latest_activity: RouteHistoryActivity | null;
}

export interface RoutesListResponse {
  schema_version: 1;
  generated_at: string;
  data_as_of: string | null;
  source_status: SourceStatus;
  source_ref: "route-records";
  filters: { sport_type: AerobicSportType | null; limit: number };
  page: { limit: number; next_cursor: null };
  items: RouteItem[];
}

export interface RouteDetailResponse extends RouteItem {
  schema_version: 1;
  generated_at: string;
  data_as_of: string | null;
  source_status: SourceStatus;
  source_ref: string;
  history: RouteHistoryActivity[];
  history_period: { from: string | null; to: string | null };
  page: { limit: number; next_cursor: null };
}
