// @ts-nocheck

import { deepClone, WEEKDAYS } from "./util.js";
import { resolveExercise } from "./exercise-registry.js";

const SIDE_ORDER = Object.freeze({ none: 0, both: 1, left: 2, right: 3 });
const RESULT_STATUSES = new Set(["completed", "partial", "skipped"]);

/** @param {unknown} value @param {string} field */
function requiredPositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer`);
  return number;
}

/**
 * Assemble the canonical Plan from independent D1 rows. The stored
 * name_snapshot is deliberately retained here; current-plan adapters resolve
 * the registry's current formal name at projection time.
 *
 * @param {{ plan?: any, revisions?: any[], slots?: any[], exercises?: any[], sets?: any[] }} rows
 */
export function assembleCanonicalPlan(rows) {
  const revisions = (rows.revisions ?? []).slice().sort((left, right) => left.revision_sequence - right.revision_sequence).map((revision) => {
    const revisionSlots = new Map((rows.slots ?? []).filter((slot) => slot.revision_key === revision.revision_key).map((slot) => [slot.weekday, slot]));
    const week = Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, assemblePlanSlot(revision, weekday, revisionSlots.get(weekday), rows.exercises ?? [], rows.sets ?? [])]));
    return {
      revision_key: revision.revision_key,
      revision_sequence: revision.revision_sequence,
      created_at: revision.created_at,
      effective_from: revision.effective_from,
      week,
    };
  });
  return {
    plan: rows.plan ? { plan_id: rows.plan.plan_id, athlete_key: rows.plan.athlete_key, name: rows.plan.name, created_at: rows.plan.created_at } : null,
    revisions,
  };
}

/** @param {any} revision @param {string} weekday @param {any} slot @param {any[]} exerciseRows @param {any[]} setRows */
function assemblePlanSlot(revision, weekday, slot, exerciseRows, setRows) {
  if (!slot || slot.kind !== "workout") return slot?.kind === "rest" ? { kind: "rest" } : null;
  const exercises = exerciseRows
    .filter((exercise) => exercise.revision_key === revision.revision_key && exercise.weekday === weekday)
    .sort((left, right) => left.block_ordinal - right.block_ordinal || left.exercise_ordinal - right.exercise_ordinal)
    .map((exercise) => ({
      occurrence_key: exercise.occurrence_key,
      exercise_id: exercise.exercise_id,
      execution_mode: exercise.execution_mode,
      name: exercise.name_snapshot,
      definition_version: Number(exercise.definition_version),
      sets: setRows
        .filter((set) => set.revision_key === revision.revision_key && set.occurrence_key === exercise.occurrence_key)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map(assemblePlanSet),
    }));
  const blocks = [];
  for (const exerciseRow of exerciseRows.filter((candidate) => candidate.revision_key === revision.revision_key && candidate.weekday === weekday).sort((left, right) => left.block_ordinal - right.block_ordinal || left.exercise_ordinal - right.exercise_ordinal)) {
    let block = blocks.at(-1);
    if (!block || block.block_ordinal !== exerciseRow.block_ordinal) {
      block = { block_ordinal: exerciseRow.block_ordinal, title: exerciseRow.block_title, exercises: [] };
      blocks.push(block);
    }
    block.exercises.push(exercises.find((exercise) => exercise.occurrence_key === exerciseRow.occurrence_key));
  }
  return {
    kind: "workout",
    title: slot.title,
    start_time: slot.start_time,
    estimated_duration_min: slot.estimated_duration_min,
    ...(assembleRecordingIntent(slot) ? { recording_intent: assembleRecordingIntent(slot) } : {}),
    blocks: blocks.map(({ title, exercises: blockExercises }) => ({ title, exercises: blockExercises })),
  };
}

/** @param {any} slot */
function assembleRecordingIntent(slot) {
  if (slot.recording_source == null && slot.recording_sport_type == null && slot.recording_route_key == null) return null;
  if (slot.recording_source !== "coros" || ![100, 102, 104, 200].includes(Number(slot.recording_sport_type)) || typeof slot.recording_route_key !== "string" || !slot.recording_route_key.trim()) {
    throw new Error("Plan Slot recording intent is inconsistent");
  }
  return { schema_version: 1, source: "coros", sport_type: Number(slot.recording_sport_type), route_key: slot.recording_route_key };
}

/** @param {any} value */
function assemblePlanSet(value) {
  return {
    set_id: value.set_id,
    ordinal: requiredPositiveInteger(value.ordinal, "Plan Set ordinal"),
    target: { metric: value.target_metric, value: Number(value.target_value) },
    resistance_mode: value.resistance_mode ?? null,
    resistance_kg: value.resistance_kg == null ? null : Number(value.resistance_kg),
    tempo: value.tempo ?? null,
    rest_after_sec: value.rest_after_sec == null ? null : Number(value.rest_after_sec),
  };
}

/**
 * Assemble one canonical Session from independent snapshot/result rows.
 * No field in the Session snapshot is resolved from the mutable current Plan
 * or the current registry.
 *
 * @param {{ session: any, exercises?: any[], completionItems?: any[], results?: any[], intervals?: any[], notes?: any, feedback?: any[] }} rows
 */
export function assembleCanonicalSession(rows) {
  const exerciseRows = (rows.exercises ?? []).filter((exercise) => exercise.session_key === rows.session.session_key).sort((left, right) => left.block_ordinal - right.block_ordinal || left.exercise_ordinal - right.exercise_ordinal);
  const itemRows = (rows.completionItems ?? []).filter((item) => item.session_key === rows.session.session_key);
  const itemsByOccurrence = groupBy(itemRows, (item) => item.occurrence_key);
  const exercises = exerciseRows.map((exercise) => {
    const items = (itemsByOccurrence.get(exercise.occurrence_key) ?? []).slice().sort(compareCompletionItems);
    const setRows = new Map();
    for (const item of items) {
      const current = setRows.get(item.set_id);
      if (!current || compareCompletionItems(item, current) < 0) setRows.set(item.set_id, item);
    }
    return {
      exercise_occurrence_key: exercise.occurrence_key,
      occurrence_key: exercise.occurrence_key,
      exercise_id: exercise.exercise_id,
      name: exercise.name_snapshot,
      definition_version: Number(exercise.definition_version),
      execution_mode: exercise.execution_mode,
      sets: [...setRows.values()].sort(compareCompletionItems).map((item) => ({
        set_key: item.set_id,
        set_id: item.set_id,
        ordinal: requiredPositiveInteger(item.set_ordinal, "Session Snapshot Set ordinal"),
        target: { metric: item.target_metric, value: Number(item.target_value) },
        resistance_mode: item.resistance_mode ?? null,
        resistance_kg: item.resistance_kg == null ? null : Number(item.resistance_kg),
        resistance: resistanceProjection(item.resistance_mode, item.resistance_kg),
        tempo: item.tempo ?? null,
        rest_after_sec: item.rest_after_sec == null ? null : Number(item.rest_after_sec),
      })),
    };
  });
  const blocks = [];
  for (const exerciseRow of exerciseRows) {
    let block = blocks.at(-1);
    if (!block || block.block_ordinal !== exerciseRow.block_ordinal) {
      block = { block_ordinal: exerciseRow.block_ordinal, block_key: `sb${exerciseRow.block_ordinal}`, title: exerciseRow.block_title, exercises: [] };
      blocks.push(block);
    }
    block.exercises.push(exercises.find((exercise) => exercise.exercise_occurrence_key === exerciseRow.occurrence_key));
  }
  const snapshotItems = itemRows.slice().sort(compareCompletionItems).map((item) => ({
    completion_item_key: item.completion_item_key,
    exercise_occurrence_key: item.occurrence_key,
    occurrence_key: item.occurrence_key,
    set_key: item.set_id,
    set_id: item.set_id,
    set_ordinal: requiredPositiveInteger(item.set_ordinal, "Completion Item Set ordinal"),
    side: item.side,
    target: { metric: item.target_metric, value: Number(item.target_value) },
    resistance_mode: item.resistance_mode ?? null,
    resistance_kg: item.resistance_kg == null ? null : Number(item.resistance_kg),
    resistance: resistanceProjection(item.resistance_mode, item.resistance_kg),
    tempo: item.tempo ?? null,
    rest_after_sec: item.rest_after_sec == null ? null : Number(item.rest_after_sec),
  }));
  const itemOrder = new Map(snapshotItems.map((item, index) => [item.completion_item_key, index]));
  const completionResults = (rows.results ?? []).filter((result) => result.session_key === rows.session.session_key).slice().sort((left, right) => (itemOrder.get(left.completion_item_key) ?? Number.MAX_SAFE_INTEGER) - (itemOrder.get(right.completion_item_key) ?? Number.MAX_SAFE_INTEGER)).map(assembleSetResult);
  const note = rows.notes ?? {};
  const snapshot = {
    schema_version: 2,
    title: rows.session.title,
    start_time: rows.session.start_time ?? findStartTime(rows.session, rows.intervals ?? []),
    estimated_duration_min: rows.session.estimated_duration_min == null ? null : Number(rows.session.estimated_duration_min),
    blocks: blocks.map(({ block_key, title, exercises: blockExercises }) => ({ block_key, title, exercises: blockExercises })),
    completion_items: snapshotItems,
    exercise_occurrence_keys: exercises.map((exercise) => exercise.exercise_occurrence_key),
  };
  return {
    session_key: rows.session.session_key,
    plan_id: rows.session.plan_id ?? null,
    plan_revision_key: rows.session.plan_revision_key ?? null,
    scheduled_workout_key: rows.session.scheduled_workout_key ?? `sw_${rows.session.athlete_key}_${rows.session.scheduled_date}`,
    scheduled_date: rows.session.scheduled_date,
    local_date: rows.session.local_date ?? rows.session.scheduled_date,
    timezone_at_session: rows.session.timezone_at_session,
    title: rows.session.title,
    status: rows.session.status,
    snapshot,
    completion_results: completionResults,
    set_results: deepClone(completionResults),
    training_intervals: (rows.intervals ?? []).filter((interval) => interval.session_key === rows.session.session_key).slice().sort((left, right) => left.started_at.localeCompare(right.started_at)).map((interval) => ({ interval_key: interval.interval_key, started_at: interval.started_at, ended_at: interval.ended_at })),
    session_rpe: note.session_rpe == null ? null : Number(note.session_rpe),
    note: note.note ?? null,
    skip_reason: note.skip_reason ?? null,
    exercise_feedback: (rows.feedback ?? []).filter((feedback) => feedback.session_key === rows.session.session_key).map((feedback) => ({ exercise_occurrence_key: feedback.occurrence_key, text: feedback.text })),
    created_at: rows.session.created_at,
    updated_at: rows.session.updated_at,
  };
}

/** @param {any} value */
function assembleSetResult(value) {
  if (!RESULT_STATUSES.has(value.status)) throw new Error("Set Result status must be completed, partial, or skipped");
  return {
    completion_item_key: value.completion_item_key,
    status: value.status,
    actual: value.actual_metric && value.actual_value != null ? { metric: value.actual_metric, value: Number(value.actual_value) } : null,
    resistance_mode: value.resistance_mode ?? null,
    resistance_kg: value.resistance_kg == null ? null : Number(value.resistance_kg),
    resistance: resistanceProjection(value.resistance_mode, value.resistance_kg),
    rir: value.rir == null ? null : Number(value.rir),
    note: value.note ?? null,
    completed_at: value.completed_at ?? null,
    completed: value.status === "completed",
  };
}

/** @param {string|null|undefined} mode @param {number|null|undefined} load */
export function resistanceProjection(mode, load) {
  if (mode === "bodyweight") return { mode: "bodyweight" };
  if (mode === "external_load") return { mode: "external_load", load_kg: load == null ? null : Number(load), quantity: 1 };
  return null;
}

/**
 * Rebuild the Workout-owned state projections from canonical D1 rows while
 * preserving unrelated archive/authentication fields from the base record.
 * `canonical_present` is intentionally returned as a separate marker so a
 * caller can distinguish an empty canonical dataset from a missing migration.
 *
 * @param {any} base
 * @param {{ plan?: any, revisions?: any[], slots?: any[], exercises?: any[], sets?: any[], sessions?: any[], sessionExercises?: any[], completionItems?: any[], results?: any[], intervals?: any[], notes?: any[], feedback?: any[] }} rows
 */
export function assembleCanonicalState(base, rows) {
  const planRows = rows.revisions?.length || rows.sessions?.length || rows.plan ? rows : null;
  if (!planRows) return { state: deepClone(base), canonical_present: false };
  const plan = assembleCanonicalPlan(rows);
  const notes = new Map((rows.notes ?? []).map((note) => [note.session_key, note]));
  const sessions = (rows.sessions ?? []).map((session) => assembleCanonicalSession({
    session,
    exercises: rows.sessionExercises,
    completionItems: rows.completionItems,
    results: rows.results,
    intervals: rows.intervals,
    notes: notes.get(session.session_key),
    feedback: rows.feedback,
  }));
  const state = deepClone(base);
  state.plan_revisions = plan.revisions;
  state.sessions = sessions;
  return { state, canonical_present: true, plan: plan.plan };
}

/**
 * Produce history for one stable global Exercise identity. The snapshots'
 * names are retained as display history; registry resolution is used only for
 * the current formal name.
 *
 * @param {any[]} sessions @param {string} exerciseId @param {{ from?: string|null, to?: string|null }} [period]
 */
export function assembleExerciseHistory(sessions, exerciseId, period = {}) {
  const matching = sessions.filter((session) => (session.status === "completed" || session.status === "partial") && (!period.from || session.scheduled_date >= period.from) && (!period.to || session.scheduled_date <= period.to));
  const series = { none: [], both: [], left: [], right: [] };
  const observations = [];
  const names = new Map();
  for (const session of matching) {
    const exercises = session.snapshot.blocks.flatMap((block) => block.exercises).filter((exercise) => exercise.exercise_id === exerciseId);
    for (const exercise of exercises) {
      const name = names.get(exercise.name) ?? { name: exercise.name, first_date: session.scheduled_date, last_date: session.scheduled_date, definition_versions: new Set([exercise.definition_version]) };
      name.first_date = name.first_date < session.scheduled_date ? name.first_date : session.scheduled_date;
      name.last_date = name.last_date > session.scheduled_date ? name.last_date : session.scheduled_date;
      name.definition_versions.add(exercise.definition_version);
      names.set(exercise.name, name);
      const sets = [];
      for (const result of session.completion_results) {
        const item = session.snapshot.completion_items.find((candidate) => candidate.completion_item_key === result.completion_item_key && candidate.exercise_occurrence_key === exercise.exercise_occurrence_key);
        if (!item) continue;
        const observation = { completion_item_key: result.completion_item_key, set_id: item.set_id ?? item.set_key, set_ordinal: item.set_ordinal ?? null, side: item.side, target: item.target, tempo: item.tempo ?? null, rest_after_sec: item.rest_after_sec ?? null, status: result.status ?? (result.completed ? "completed" : "partial"), actual: result.actual, resistance_mode: result.resistance_mode ?? result.resistance?.mode ?? null, resistance_kg: result.resistance_kg ?? result.resistance?.load_kg ?? null, resistance: result.resistance, total_external_kg: (result.resistance_mode ?? result.resistance?.mode) === "external_load" ? (result.resistance_kg ?? result.resistance?.load_kg ?? null) : null, rir: result.rir ?? null, note: result.note ?? null, completed_at: result.completed_at ?? null };
        sets.push(observation);
        (series[item.side] ??= []).push({ session_key: session.session_key, scheduled_date: session.scheduled_date, exercise_id: exerciseId, exercise_name: exercise.name, definition_version: exercise.definition_version, ...observation });
      }
      if (sets.length) observations.push({ session_key: session.session_key, scheduled_date: session.scheduled_date, exercise_id: exerciseId, exercise_name: exercise.name, definition_version: exercise.definition_version, source_ref: `session:${session.scheduled_date}:${session.session_key}`, sets, total_reps: sumActual(sets, "reps"), total_duration_sec: sumActual(sets, "duration_sec") });
    }
  }
  for (const values of Object.values(series)) values.sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date) || left.session_key.localeCompare(right.session_key) || left.completion_item_key.localeCompare(right.completion_item_key));
  observations.sort((left, right) => left.scheduled_date.localeCompare(right.scheduled_date) || left.session_key.localeCompare(right.session_key));
  const current = resolveExercise(exerciseId);
  return {
    exercise_id: exerciseId,
    current_name: current?.name ?? exerciseId,
    display_name_history: [...names.values()].sort((left, right) => left.first_date.localeCompare(right.first_date)).map((entry) => ({ name: entry.name, first_date: entry.first_date, last_date: entry.last_date, definition_versions: [...entry.definition_versions].sort((left, right) => left - right) })),
    performed_session_count: new Set(observations.map((observation) => observation.session_key)).size,
    observations,
    series,
  };
}

/** @param {any[]} values @param {string} metric */
function sumActual(values, metric) {
  const numbers = values.filter((value) => value.actual?.metric === metric && Number.isFinite(value.actual.value)).map((value) => value.actual.value);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

/** @param {any} session @param {any[]} intervals */
function findStartTime(session, intervals) { return intervals.filter((interval) => interval.session_key === session.session_key).sort((left, right) => left.started_at.localeCompare(right.started_at))[0]?.started_at ?? session.created_at; }

/** @param {any[]} values @param {(value:any)=>string} key */
function groupBy(values, key) {
  const result = new Map();
  for (const value of values) { const group = key(value); if (!result.has(group)) result.set(group, []); result.get(group).push(value); }
  return result;
}

/** @param {any} left @param {any} right */
function compareCompletionItems(left, right) {
  return Number(left.set_ordinal ?? 0) - Number(right.set_ordinal ?? 0) || String(left.set_id).localeCompare(String(right.set_id)) || (SIDE_ORDER[left.side] ?? 99) - (SIDE_ORDER[right.side] ?? 99) || String(left.completion_item_key).localeCompare(String(right.completion_item_key));
}
