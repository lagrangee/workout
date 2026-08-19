// @ts-check

import { deepClone, localDate, dateRange } from "./util.js";
import { resolveSlot, scheduleEntry, effectiveRevision, trainingDuration, completionFraction } from "./plan.js";

/** @typedef {import("./types.js").AthleteState} AthleteState */
/** @typedef {import("./types.js").PlanRevision} PlanRevision */
/** @typedef {import("./types.js").WorkoutSession} WorkoutSession */
/** @typedef {import("./types.js").SnapshotBlock} SnapshotBlock */
/** @typedef {import("./types.js").SnapshotExercise} SnapshotExercise */
/** @typedef {import("./types.js").CompletionItem} CompletionItem */

/** @param {AthleteState} state @param {Date} now */
export function athleteExport(state, now) {
  if (state.sessions.length > 10000) return { error: { code: "export_capacity_exceeded", message: "This export exceeds the 10,000 Session delivery bound" }, status: 503 };
  const dataAsOf = now.toISOString();
  const today = localDate(now, state.timezone);
  const revisions = state.plan_revisions.map(/** @param {PlanRevision} revision */ (revision) => ({ revision_key: revision.revision_key, revision_sequence: revision.revision_sequence, created_at: revision.created_at, effective_from: revision.effective_from, week: deepClone(revision.week) }));
  const firstPlan = state.plan_revisions.map((revision) => revision.effective_from).sort()[0];
  const schedule = firstPlan ? dateRange(firstPlan, today).map((date) => exportSchedule(state, date, now)).filter(Boolean) : [];
  const sessions = state.sessions.slice().sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.session_key.localeCompare(b.session_key)).map(exportSession);
  const result = { athlete_export_schema_version: 1, generated_at: dataAsOf, data_as_of: dataAsOf, timezone: state.timezone, counts: { plan_revisions: revisions.length, scheduled_workouts: schedule.length, sessions: sessions.length }, athlete: { display_name: state.display_name, timezone: state.timezone, unit_conventions: { resistance: "kg_per_implement", incline: "percent" } }, plan_revisions: revisions, scheduled_workouts: schedule, sessions };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 20 * 1024 * 1024) return { error: { code: "export_capacity_exceeded", message: "This export exceeds the 20 MiB delivery bound" }, status: 503 };
  return { value: result, status: 200 };
}

/** @param {AthleteState} state @param {string} date @param {Date} now */
function exportSchedule(state, date, now) {
  const entry = scheduleEntry(state, date, now);
  if (entry.kind === "no_plan") return null;
  const revision = effectiveRevision(state, date);
  return { scheduled_workout_key: entry.scheduled_workout_key ?? `sw_${state.athlete_key}_${date}`, scheduled_date: date, kind: entry.kind, revision_key: revision.revision_key, prescription: entry.kind === "workout" ? deepClone(entry.prescription) : null, session_key: entry.session_key, is_overdue_unstarted: entry.is_overdue_unstarted };
}

/** @param {WorkoutSession} session */
function exportSession(session) {
  if (session.snapshot?.schema_version === 2) return exportCanonicalSession(session);
  const snapshot = {
    title: session.snapshot.title,
    start_time: session.snapshot.start_time,
    estimated_duration_min: session.snapshot.estimated_duration_min,
    blocks: session.snapshot.blocks.map(/** @param {SnapshotBlock} block */ (block) => ({ block_key: block.block_key, title: block.title, exercises: block.exercises.map(/** @param {SnapshotExercise} exercise */ (exercise) => ({ exercise_occurrence_key: exercise.exercise_occurrence_key, exercise_key: exercise.exercise_key, name: exercise.name, category: exercise.category, side_mode: exercise.side_mode, sets: exercise.sets.map((set) => ({ set_key: set.set_key, target: set.target, resistance: set.resistance, target_rir: set.target_rir, target_rpe: set.target_rpe, tempo: set.tempo, rest_after_sec: set.rest_after_sec, target_incline_percent: set.target_incline_percent })) })) })),
    completion_items: session.snapshot.completion_items.map(/** @param {CompletionItem} item */ (item) => ({ completion_item_key: item.completion_item_key, exercise_occurrence_key: item.exercise_occurrence_key, set_key: item.set_key, side: item.side, target: item.target })),
  };
  return { session_key: session.session_key, scheduled_workout_key: session.scheduled_workout_key, scheduled_date: session.scheduled_date, timezone_at_session: session.timezone_at_session, title: session.title, status: session.status, completion_fraction: completionFraction(session), training_duration_sec: Math.round(trainingDuration(session)), session_rpe: session.session_rpe, note: session.note, skip_reason: session.skip_reason, snapshot, completion_results: session.completion_results.map((result) => ({ completion_item_key: result.completion_item_key, actual: result.actual, resistance: result.resistance, rir: result.rir, completed_at: result.completed_at })), training_intervals: deepClone(session.training_intervals), exercise_feedback: deepClone(session.exercise_feedback), created_at: session.created_at, updated_at: session.updated_at };
}

/** @param {WorkoutSession} session */
function exportCanonicalSession(session) {
  return {
    session_key: session.session_key,
    scheduled_workout_key: session.scheduled_workout_key,
    scheduled_date: session.scheduled_date,
    local_date: session.local_date ?? session.scheduled_date,
    timezone_at_session: session.timezone_at_session,
    plan_id: session.plan_id ?? null,
    plan_revision_key: session.plan_revision_key ?? null,
    title: session.title,
    status: session.status,
    completion_fraction: completionFraction(session),
    training_duration_sec: Math.round(trainingDuration(session)),
    session_rpe: session.session_rpe,
    note: session.note,
    skip_reason: session.skip_reason,
    snapshot: deepClone(session.snapshot),
    completion_results: deepClone(session.completion_results),
    set_results: deepClone(session.set_results ?? session.completion_results),
    training_intervals: deepClone(session.training_intervals),
    exercise_feedback: deepClone(session.exercise_feedback),
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}
