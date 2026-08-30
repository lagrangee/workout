// @ts-check

import { deepClone, WEEKDAYS } from "./util.js";
import { resolveExercise } from "./exercise-registry.js";
import { initializePlannedDays } from "./planned-days.js";

const EXERCISE_CATEGORIES = new Set(["strength", "endurance", "mobility", "recovery"]);

/**
 * Build the one-time SQL cutover for one Athlete. The input is already the
 * canonical domain shape; this module deliberately does not repair legacy
 * Exercise IDs, ranges, side modes, or result shapes.
 *
 * @param {any} state
 * @param {{ now?: string, rollbackRef?: string|null, sourceStateRevision?: number|null }} [options]
 */
export function buildCanonicalRebuildSql(state, options = {}) {
  validateRebuildState(state);
  state = deepClone(state);
  initializePlannedDays(state);
  const now = options.now ?? new Date().toISOString();
  const rollbackRef = options.rollbackRef ?? null;
  const sourceStateRevision = options.sourceStateRevision ?? state.__d1StateRevision ?? null;
  const planId = `plan_${state.athlete_key}`;
  // Wrangler's remote D1 file execution is the transaction boundary. D1
  // rejects explicit BEGIN/COMMIT statements in imported SQL files, while
  // keeping the file execution atomic when it fails.
  const statements = [
    `DELETE FROM planned_days WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM plan_changes WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM session_intervals WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM exercise_feedback WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM session_notes WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM set_results WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM completion_items WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM session_exercises WHERE session_key IN (SELECT session_key FROM sessions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM sessions WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM plan_sets WHERE revision_key IN (SELECT revision_key FROM plan_revisions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM plan_exercises WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM plan_slots WHERE revision_key IN (SELECT revision_key FROM plan_revisions WHERE athlete_key = ${sql(state.athlete_key)});`,
    `DELETE FROM plan_revisions WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM plans WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM session_date_guard WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM plan_revision_index WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM session_exercise_index WHERE athlete_key = ${sql(state.athlete_key)};`,
    `DELETE FROM session_index WHERE athlete_key = ${sql(state.athlete_key)};`,
    `INSERT INTO plans (plan_id, athlete_key, name, created_at) VALUES (${sql(planId)}, ${sql(state.athlete_key)}, 'Workout Plan', ${sql(firstPlanCreatedAt(state))});`,
  ];
  for (const revision of state.plan_revisions ?? []) {
    statements.push(`INSERT INTO plan_revisions (plan_id, athlete_key, revision_key, revision_sequence, effective_from, created_at) VALUES (${sql(planId)}, ${sql(state.athlete_key)}, ${sql(revision.revision_key)}, ${integer(revision.revision_sequence)}, ${sql(revision.effective_from)}, ${sql(revision.created_at)});`);
    for (const weekday of WEEKDAYS) {
      const slot = revision.week[weekday];
      const kind = slot === null ? "no_plan" : slot?.kind === "rest" ? "rest" : "workout";
      statements.push(`INSERT INTO plan_slots (revision_key, weekday, kind, title, start_time, estimated_duration_min, recording_source, recording_sport_type, recording_route_key) VALUES (${sql(revision.revision_key)}, ${sql(weekday)}, ${sql(kind)}, ${sql(slot?.kind === "workout" ? slot.title : null)}, ${sql(slot?.kind === "workout" ? slot.start_time : null)}, ${numberOrNull(slot?.kind === "workout" ? slot.estimated_duration_min : null)}, ${sql(slot?.kind === "workout" ? slot.recording_intent?.source ?? null : null)}, ${numberOrNull(slot?.kind === "workout" ? slot.recording_intent?.sport_type ?? null : null)}, ${sql(slot?.kind === "workout" ? slot.recording_intent?.route_key ?? null : null)});`);
      if (slot?.kind !== "workout") continue;
      /** @type {any[]} */ (slot.blocks).forEach((block, blockIndex) => /** @type {any[]} */ (block.exercises).forEach((exercise, exerciseIndex) => {
        statements.push(`INSERT INTO plan_exercises (revision_key, athlete_key, weekday, block_ordinal, block_title, exercise_ordinal, occurrence_key, exercise_id, execution_mode, name_snapshot, definition_version, category) VALUES (${sql(revision.revision_key)}, ${sql(state.athlete_key)}, ${sql(weekday)}, ${integer(blockIndex + 1)}, ${sql(block.title)}, ${integer(exerciseIndex + 1)}, ${sql(exercise.occurrence_key)}, ${sql(exercise.exercise_id)}, ${sql(exercise.execution_mode)}, ${sql(exercise.name)}, ${integer(exercise.definition_version)}, ${sql(exercise.category)});`);
        for (const set of exercise.sets) statements.push(planSetSql(revision.revision_key, exercise.occurrence_key, set));
      }));
    }
  }
  for (const change of state.plan_changes ?? []) {
    statements.push(`INSERT INTO plan_changes (change_key, athlete_key, change_sequence, change_type, created_at, source_date, target_date) VALUES (${sql(change.change_key)}, ${sql(state.athlete_key)}, ${integer(change.change_sequence)}, ${sql(change.change_type)}, ${sql(change.created_at)}, ${sql(change.source_date)}, ${sql(change.target_date)});`);
  }
  for (const day of state.planned_days ?? []) {
    statements.push(`INSERT INTO planned_days (athlete_key, planned_date, kind, prescription_revision_key, prescription_weekday, change_key, version, moved_from_date, moved_to_date) VALUES (${sql(state.athlete_key)}, ${sql(day.date)}, ${sql(day.kind)}, ${sql(day.prescription_revision_key)}, ${sql(day.prescription_weekday)}, ${sql(day.change_key)}, ${integer(day.version)}, ${sql(day.moved_from_date)}, ${sql(day.moved_to_date)});`);
  }
  for (const session of state.sessions ?? []) {
    if (!session.plan_id || !session.plan_revision_key) throw new Error(`Canonical Session ${session.session_key} requires plan_id and plan_revision_key`);
    statements.push(`INSERT INTO sessions (athlete_key, session_key, plan_id, plan_revision_key, scheduled_date, timezone_at_session, title, status, created_at, updated_at, scheduled_workout_key, local_date, start_time, estimated_duration_min) VALUES (${sql(state.athlete_key)}, ${sql(session.session_key)}, ${sql(session.plan_id)}, ${sql(session.plan_revision_key)}, ${sql(session.scheduled_date)}, ${sql(session.timezone_at_session)}, ${sql(session.title)}, ${sql(session.status)}, ${sql(session.created_at)}, ${sql(session.updated_at)}, ${sql(session.scheduled_workout_key)}, ${sql(session.local_date ?? session.scheduled_date)}, ${sql(session.snapshot.start_time)}, ${numberOrNull(session.snapshot.estimated_duration_min)});`);
    /** @type {any[]} */ (session.snapshot.blocks).forEach((block, blockIndex) => /** @type {any[]} */ (block.exercises).forEach((exercise, exerciseIndex) => {
      const occurrenceKey = exercise.exercise_occurrence_key ?? exercise.occurrence_key;
      statements.push(`INSERT INTO session_exercises (session_key, occurrence_key, block_ordinal, block_title, exercise_ordinal, exercise_id, name_snapshot, definition_version, execution_mode, category) VALUES (${sql(session.session_key)}, ${sql(occurrenceKey)}, ${integer(blockIndex + 1)}, ${sql(block.title)}, ${integer(exerciseIndex + 1)}, ${sql(exercise.exercise_id)}, ${sql(exercise.name)}, ${integer(exercise.definition_version)}, ${sql(exercise.execution_mode)}, ${sql(exercise.category)});`);
    }));
    for (const item of session.snapshot.completion_items) statements.push(completionItemSql(session.session_key, item));
    const results = Array.isArray(session.set_results) && session.set_results.length > 0 ? session.set_results : (session.completion_results ?? []);
    for (const result of results) statements.push(setResultSql(session.session_key, result));
    for (const interval of session.training_intervals ?? []) statements.push(`INSERT INTO session_intervals (session_key, interval_key, started_at, ended_at) VALUES (${sql(session.session_key)}, ${sql(interval.interval_key)}, ${sql(interval.started_at)}, ${sql(interval.ended_at)});`);
    for (const feedback of session.exercise_feedback ?? []) statements.push(`INSERT INTO exercise_feedback (session_key, occurrence_key, text) VALUES (${sql(session.session_key)}, ${sql(feedback.exercise_occurrence_key)}, ${sql(feedback.text)});`);
    statements.push(`INSERT INTO session_notes (session_key, note, skip_reason, session_rpe) VALUES (${sql(session.session_key)}, ${sql(session.note)}, ${sql(session.skip_reason)}, ${numberOrNull(session.session_rpe)});`);
  }
  const persistedState = { ...state, plan_revisions: [], planned_days: [], plan_changes: [], sessions: [] };
  // The converter keeps the exact v1 document in the review artifact, and
  // --apply copies the private archive before this SQL runs. Do not embed the
  // raw duplicate in state_json: D1 limits one SQL statement to 100 KB, while
  // the relational canonical rows retain the migrated Workout facts.
  delete persistedState.legacy_workout_v1;
  delete persistedState.__d1StateRevision;
  statements.push(`UPDATE athlete_state SET state_json = ${sql(JSON.stringify(persistedState))}, updated_at = ${sql(now)}, state_revision = state_revision + 1 WHERE athlete_key = ${sql(state.athlete_key)};`);
  statements.push(`INSERT INTO workout_storage_cutover (athlete_key, canonical_version, rebuilt_at, source_state_revision, rollback_ref) VALUES (${sql(state.athlete_key)}, 1, ${sql(now)}, ${numberOrNull(sourceStateRevision)}, ${sql(rollbackRef)}) ON CONFLICT(athlete_key) DO UPDATE SET canonical_version = excluded.canonical_version, rebuilt_at = excluded.rebuilt_at, source_state_revision = excluded.source_state_revision, rollback_ref = excluded.rollback_ref;`);
  return `${statements.join("\n")}\n`;
}

/** @param {any} state */
export function validateRebuildState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Rebuild input must be one Athlete state object");
  for (const field of ["athlete_key", "email", "timezone"]) if (typeof state[field] !== "string" || !state[field].trim()) throw new Error(`Rebuild input requires ${field}`);
  if (!Array.isArray(state.plan_revisions) || !Array.isArray(state.sessions)) throw new Error("Rebuild input must contain plan_revisions and sessions arrays");
  const revisionKeys = new Set();
  for (const revision of state.plan_revisions) {
    if (!revision?.revision_key || revisionKeys.has(revision.revision_key)) throw new Error("Plan Revision keys must be unique");
    revisionKeys.add(revision.revision_key);
    if (!revision.week || typeof revision.week !== "object") throw new Error(`Plan Revision ${revision.revision_key} is not canonical`);
    for (const weekday of WEEKDAYS) {
      if (!Object.hasOwn(revision.week, weekday)) throw new Error(`Plan Revision ${revision.revision_key} is missing ${weekday}`);
      const slot = revision.week[weekday];
      if (!slot || slot.kind !== "workout") continue;
      for (const block of slot.blocks ?? []) for (const exercise of block.exercises ?? []) {
        if (!exercise.exercise_id || !exercise.occurrence_key || !Array.isArray(exercise.sets)) throw new Error(`Plan Revision ${revision.revision_key} contains a non-canonical Exercise`);
        const definition = resolveExercise(exercise.exercise_id);
        if (!definition || definition.status !== "active") throw new Error(`Plan Revision ${revision.revision_key} references an inactive or unknown Exercise ${exercise.exercise_id}`);
        if (exercise.definition_version !== definition.definition_version) throw new Error(`Plan Revision ${revision.revision_key} has a stale Exercise definition version for ${exercise.exercise_id}`);
        if (!EXERCISE_CATEGORIES.has(exercise.category)) throw new Error(`Plan Revision ${revision.revision_key} requires a frozen Exercise category for ${exercise.exercise_id}`);
        for (const set of exercise.sets) if (!set.set_id || !set.target || set.target.value == null) throw new Error(`Plan Revision ${revision.revision_key} contains a non-canonical Set`);
      }
    }
  }
  const sessionKeys = new Set();
  for (const session of state.sessions) {
    if (!session?.session_key || sessionKeys.has(session.session_key)) throw new Error("Session keys must be unique");
    sessionKeys.add(session.session_key);
    if (session.snapshot?.schema_version !== 2) throw new Error(`Session ${session.session_key} is not a canonical Snapshot v2`);
    if (!session.plan_revision_key || !revisionKeys.has(session.plan_revision_key)) throw new Error(`Session ${session.session_key} references an unknown Plan Revision`);
    if (!Array.isArray(session.snapshot.completion_items)) throw new Error(`Session ${session.session_key} is missing Completion Items`);
    for (const block of session.snapshot.blocks ?? []) for (const exercise of block.exercises ?? []) {
      if (!resolveExercise(exercise.exercise_id)) throw new Error(`Session ${session.session_key} references an unknown Exercise ${exercise.exercise_id}`);
      if (!EXERCISE_CATEGORIES.has(exercise.category)) throw new Error(`Session ${session.session_key} requires a frozen Exercise category for ${exercise.exercise_id}`);
    }
  }
  return true;
}

/** @param {any} state */
function firstPlanCreatedAt(state) { return /** @type {any[]} */ (state.plan_revisions).slice().sort((left, right) => left.revision_sequence - right.revision_sequence)[0]?.created_at ?? new Date().toISOString(); }

/** @param {string} revisionKey @param {string} occurrenceKey @param {any} set */
function planSetSql(revisionKey, occurrenceKey, set) {
  return `INSERT INTO plan_sets (revision_key, occurrence_key, set_id, ordinal, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec) VALUES (${sql(revisionKey)}, ${sql(occurrenceKey)}, ${sql(set.set_id)}, ${integer(set.ordinal)}, ${sql(set.target.metric)}, ${integer(set.target.value)}, ${sql(set.resistance_mode)}, ${numberOrNull(set.resistance_kg)}, ${sql(set.tempo)}, ${numberOrNull(set.rest_after_sec)});`;
}

/** @param {string} sessionKey @param {any} item */
function completionItemSql(sessionKey, item) {
  return `INSERT INTO completion_items (session_key, completion_item_key, occurrence_key, set_id, side, target_metric, target_value, resistance_mode, resistance_kg, tempo, rest_after_sec, set_ordinal) VALUES (${sql(sessionKey)}, ${sql(item.completion_item_key)}, ${sql(item.exercise_occurrence_key ?? item.occurrence_key)}, ${sql(item.set_id ?? item.set_key)}, ${sql(item.side)}, ${sql(item.target.metric)}, ${integer(item.target.value)}, ${sql(item.resistance_mode ?? item.resistance?.mode)}, ${numberOrNull(item.resistance_kg ?? item.resistance?.load_kg)}, ${sql(item.tempo)}, ${numberOrNull(item.rest_after_sec ?? item.rest_sec)}, ${numberOrNull(item.set_ordinal)});`;
}

/** @param {string} sessionKey @param {any} result */
function setResultSql(sessionKey, result) {
  return `INSERT INTO set_results (session_key, completion_item_key, status, actual_metric, actual_value, resistance_mode, resistance_kg, rir, note, completed_at) VALUES (${sql(sessionKey)}, ${sql(result.completion_item_key)}, ${sql(result.status)}, ${sql(result.actual?.metric)}, ${numberOrNull(result.actual?.value)}, ${sql(result.resistance_mode ?? result.resistance?.mode)}, ${numberOrNull(result.resistance_kg ?? result.resistance?.load_kg)}, ${numberOrNull(result.rir)}, ${sql(result.note)}, ${sql(result.completed_at)});`;
}

/** @param {unknown} value */
function numberOrNull(value) { return value === null || value === undefined ? "NULL" : Number.isFinite(Number(value)) ? String(Number(value)) : "NULL"; }
/** @param {unknown} value */
function integer(value) { if (!Number.isInteger(value)) throw new Error("Canonical rebuild requires integer values"); return String(value); }
/** @param {unknown} value */
function sql(value) { if (value === null || value === undefined) return "NULL"; return `'${String(value).replaceAll("'", "''")}'`; }
