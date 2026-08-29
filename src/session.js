// @ts-check

import { addDays, deepClone, isRecord, isValidUtcInstant, localDate, opaqueKey } from "./util.js";
import { completionFraction, resolveSlot, scheduledWorkoutKey, sessionSummary, trainingDuration } from "./plan.js";
import { validateSessionRecord } from "./validation.js";

/** @param {any} state @param {string} date @param {Date} now */
function assertTodayWorkout(state, date, now) {
  const today = localDate(now, state.timezone);
  if (date !== today) return { code: "session_date_not_today", message: "A Session can only be created for today's Scheduled Workout" };
  const { slot } = resolveSlot(state, date);
  if (!slot || slot.kind !== "workout") return { code: "scheduled_workout_unavailable", message: "Today is not a non-rest Scheduled Workout" };
  return null;
}

/** @param {any} session */
function freshRecord(session) {
  return {
    record_schema_version: 1,
    completion_results: deepClone(session.completion_results),
    training_intervals: deepClone(session.training_intervals),
    session_rpe: session.session_rpe,
    note: session.note,
    exercise_feedback: deepClone(session.exercise_feedback),
    skip_reason: session.skip_reason,
  };
}

/** @param {any} state @param {string} date @param {Date} now @param {string} kind @param {string|null} skipReason */
export function createSession(state, date, now, kind, skipReason = null) {
  const invalid = assertTodayWorkout(state, date, now);
  if (invalid) return { error: invalid };
  const existing = state.sessions.find(/** @param {any} item */ (item) => item.scheduled_date === date);
  if (existing) {
    if ((kind === "start" && existing.status === "in_progress") || (kind === "skip" && existing.status === "skipped")) return { session: existing, replay: true };
    return { error: { code: "session_state_conflict", message: "A different action cannot be applied to this Session" } };
  }
  const { revision, slot } = resolveSlot(state, date);
  const sessionKey = opaqueKey("sess");
  const session = {
    session_key: sessionKey,
    plan_id: `plan_${state.athlete_key}`,
    plan_revision_key: revision.revision_key,
    scheduled_workout_key: scheduledWorkoutKey(state, date),
    scheduled_date: date,
    local_date: date,
    timezone_at_session: state.timezone,
    title: slot.title,
    status: kind === "skip" ? "skipped" : "in_progress",
    snapshot: expandForSession(slot),
    completion_results: /** @type {any[]} */ ([]),
    training_intervals: /** @type {any[]} */ ([]),
    session_rpe: null,
    note: null,
    skip_reason: kind === "skip" ? skipReason : null,
    exercise_feedback: /** @type {any[]} */ ([]),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  if (kind === "start") session.training_intervals.push({ interval_key: opaqueKey("ti"), started_at: now.toISOString(), ended_at: null });
  state.sessions.push(session);
  state.training_version += 1;
  return { session };
}

/** @param {any} slot */
function expandForSession(slot) {
  if (slot.blocks.some(/** @param {any} block */ (block) => block.exercises.some(/** @param {any} exercise */ (exercise) => exercise.exercise_id))) return expandCanonicalForSession(slot);
  // Kept local to avoid making the mutation route depend on a mutable plan
  // object after the snapshot has been captured.
  /** @type {any} */
  const snapshot = {
    title: slot.title, start_time: slot.start_time, estimated_duration_min: slot.estimated_duration_min,
    blocks: /** @type {any[]} */ ([]), completion_items: /** @type {any[]} */ ([]), exercise_occurrence_keys: /** @type {string[]} */ ([]),
  };
  slot.blocks.forEach(/** @param {any} block @param {number} blockIndex */ (block, blockIndex) => {
    const blockKey = opaqueKey(`sb${blockIndex + 1}`);
    const snapshotBlock = { block_key: blockKey, title: block.title, exercises: /** @type {any[]} */ ([]) };
    block.exercises.forEach(/** @param {any} exercise @param {number} exerciseIndex */ (exercise, exerciseIndex) => {
      const occurrenceKey = opaqueKey(`eo${blockIndex + 1}${exerciseIndex + 1}`);
      snapshot.exercise_occurrence_keys.push(occurrenceKey);
      const snapshotExercise = { exercise_occurrence_key: occurrenceKey, exercise_key: exercise.exercise_key, name: exercise.name, category: exercise.category, side_mode: exercise.side_mode, sets: /** @type {any[]} */ ([]) };
      exercise.sets.forEach(/** @param {any} set @param {number} setIndex */ (set, setIndex) => {
        const setKey = opaqueKey(`ps${blockIndex + 1}${exerciseIndex + 1}${setIndex + 1}`);
        snapshotExercise.sets.push({ set_key: setKey, ...deepClone(set) });
        for (const side of exercise.side_mode === "left_right" ? ["left", "right"] : ["none"]) snapshot.completion_items.push({ completion_item_key: opaqueKey(`ci${snapshot.completion_items.length + 1}`), exercise_occurrence_key: occurrenceKey, set_key: setKey, side, target: deepClone(set.target), resistance: deepClone(set.resistance) });
      });
      snapshotBlock.exercises.push(snapshotExercise);
    });
    snapshot.blocks.push(snapshotBlock);
  });
  return snapshot;
}

/** @param {any} slot */
function expandCanonicalForSession(slot) {
  /** @type {any} */
  const snapshot = {
    schema_version: 2,
    title: slot.title,
    start_time: slot.start_time,
    estimated_duration_min: slot.estimated_duration_min,
    blocks: /** @type {any[]} */ ([]),
    completion_items: /** @type {any[]} */ ([]),
    exercise_occurrence_keys: /** @type {string[]} */ ([]),
  };
  slot.blocks.forEach(/** @param {any} block @param {number} blockIndex */ (block, blockIndex) => {
    const blockKey = opaqueKey(`sb${blockIndex + 1}`);
    const snapshotBlock = { block_key: blockKey, title: block.title, exercises: /** @type {any[]} */ ([]) };
    block.exercises.forEach(/** @param {any} exercise @param {number} exerciseIndex */ (exercise, exerciseIndex) => {
      const occurrenceKey = exercise.occurrence_key;
      snapshot.exercise_occurrence_keys.push(occurrenceKey);
      const snapshotExercise = {
        exercise_occurrence_key: occurrenceKey,
        occurrence_key: occurrenceKey,
        exercise_id: exercise.exercise_id,
        name: exercise.name,
        definition_version: exercise.definition_version,
        category: exercise.category,
        execution_mode: exercise.execution_mode,
        sets: /** @type {any[]} */ ([]),
      };
      exercise.sets.forEach(/** @param {any} set */ (set) => {
        const setKey = set.set_id;
        const snapshotSet = { set_key: setKey, ...deepClone(set) };
        snapshotExercise.sets.push(snapshotSet);
        const sides = exercise.execution_mode === "none" ? ["none"] : exercise.execution_mode === "bilateral" ? ["both"] : ["left", "right"];
        sides.forEach(/** @param {string} side */ (side) => snapshot.completion_items.push({
          completion_item_key: opaqueKey(`ci${snapshot.completion_items.length + 1}`),
          exercise_occurrence_key: occurrenceKey,
          occurrence_key: occurrenceKey,
          set_id: setKey,
          set_key: setKey,
          set_ordinal: set.ordinal,
          side,
          target: deepClone(set.target),
          resistance: canonicalResistanceForSnapshot(set),
          resistance_mode: set.resistance_mode,
          resistance_kg: set.resistance_kg,
          tempo: set.tempo,
          rest_after_sec: set.rest_after_sec,
        }));
      });
      snapshotBlock.exercises.push(snapshotExercise);
    });
    snapshot.blocks.push(snapshotBlock);
  });
  return snapshot;
}

/** @param {any} set */
function canonicalResistanceForSnapshot(set) {
  if (set?.resistance_mode === "bodyweight") return { mode: "bodyweight" };
  if (set?.resistance_mode === "external_load") return { mode: "external_load", load_kg: set.resistance_kg, quantity: 1 };
  return null;
}

/** @param {any} state @param {any} session @param {any} record @param {Date} now @param {string} mode */
export function replaceRecord(state, session, record, now, mode = "replace") {
  if (isCanonicalSession(session) && record?.record_schema_version !== 2) return { error: { code: "invalid_session_record", message: "Canonical Sessions require Session Record schema_version 2", details: [{ path: "/record_schema_version", message: "must equal integer 2 for a canonical Session" }] } };
  if (isCanonicalSession(session)) return replaceCanonicalRecord(state, session, record, now, mode);
  if (session.status === "skipped") {
    if (record.completion_results.length || record.training_intervals.length || record.session_rpe !== null || record.exercise_feedback.length) return { error: { code: "invalid_skipped_record", message: "A skipped Session can only correct its note and skip reason until restart" } };
  }
  const existingOpen = session.training_intervals.find(/** @param {any} interval */ (interval) => interval.ended_at === null);
  if (session.status === "in_progress" && !existingOpen) return { error: { code: "session_state_conflict", message: "Resume the paused Session before recording a Completion Item" } };
  const targetMode = session.status === "skipped" ? "skipped" : session.status === "in_progress" ? "in_progress" : "terminal";
  const errors = validateSessionRecord(record, session, now.toISOString(), targetMode);
  if (errors.length) return { error: { code: "invalid_session_record", message: "The Session Record is invalid", details: errors } };
  if (session.status === "in_progress") {
    const submittedOpen = record.training_intervals.find(/** @param {any} interval */ (interval) => interval.ended_at === null);
    if (!existingOpen || !submittedOpen || submittedOpen.interval_key !== existingOpen.interval_key) return { error: { code: "invalid_session_record", message: "The open interval is server-owned and must be preserved" } };
  }
  session.completion_results = deepClone(record.completion_results);
  session.training_intervals = deepClone(record.training_intervals);
  session.session_rpe = session.status === "in_progress" || session.status === "skipped" ? null : record.session_rpe;
  session.note = record.note;
  session.exercise_feedback = deepClone(record.exercise_feedback);
  session.skip_reason = session.status === "skipped" ? record.skip_reason : null;
  if (session.status !== "in_progress" && session.status !== "skipped") session.status = completionFraction(session) === 1 ? "completed" : "partial";
  session.updated_at = now.toISOString();
  state.training_version += 1;
  return { session };
}

/** @param {any} state @param {string} sessionKey @param {any} payload @param {Date} now */
export function endSession(state, sessionKey, payload, now) {
  const session = state.sessions.find(/** @param {any} item */ (item) => item.session_key === sessionKey);
  if (!session) return { error: { code: "not_found", message: "Session not found" } };
  if (session.status !== "in_progress") return { error: { code: "session_state_conflict", message: "Only an in-progress Session can end" } };
  if (!payload || typeof payload !== "object" || Object.keys(payload).some((key) => !["record", "ended_at"].includes(key))) return { error: { code: "invalid_request", message: "End requires record and ended_at" } };
  if (!isValidUtcInstant(payload.ended_at)) return { error: { code: "invalid_request", message: "ended_at must be an RFC 3339 UTC instant" } };
  const difference = Date.parse(payload.ended_at) - now.getTime();
  if (difference > 5 * 60 * 1000) return { error: { code: "invalid_request", message: "ended_at cannot be more than five minutes in the future" } };
  const open = session.training_intervals.find(/** @param {any} interval */ (interval) => interval.ended_at === null);
  if (open && Date.parse(payload.ended_at) <= Date.parse(open.started_at)) return { error: { code: "invalid_session_record", message: "ended_at must close the open interval" } };
  if (!isRecord(payload.record) || !Array.isArray(payload.record.training_intervals)) return { error: { code: "invalid_session_record", message: "End requires the complete Session Record" } };
  const proposed = deepClone(payload.record);
  if (open) {
    const proposedOpen = proposed.training_intervals.find(/** @param {any} interval */ (interval) => interval.interval_key === open.interval_key);
    if (!proposedOpen) return { error: { code: "invalid_session_record", message: "End record must include the open interval" } };
    proposedOpen.ended_at = payload.ended_at;
  }
  if (isCanonicalSession(session) && proposed.record_schema_version !== 2) return { error: { code: "invalid_session_record", message: "Canonical Sessions require Session Record schema_version 2", details: [{ path: "/record_schema_version", message: "must equal integer 2 for a canonical Session" }] } };
  if (isCanonicalSession(session)) return replaceCanonicalRecord(state, session, proposed, now, "terminal");
  const errors = validateSessionRecord(proposed, session, now.toISOString(), "terminal");
  if (errors.length) return { error: { code: "invalid_session_record", message: "The final Session Record is invalid", details: errors } };
  session.completion_results = deepClone(proposed.completion_results);
  session.training_intervals = deepClone(proposed.training_intervals);
  session.session_rpe = proposed.session_rpe;
  session.note = proposed.note;
  session.exercise_feedback = deepClone(proposed.exercise_feedback);
  session.skip_reason = null;
  session.status = completionFraction(session) === 1 ? "completed" : "partial";
  session.updated_at = now.toISOString();
  state.training_version += 1;
  return { session };
}

/** @param {any} state @param {string} sessionKey @param {Date} now @param {string|null} closeAt */
export function pauseSession(state, sessionKey, now, closeAt = null) {
  const session = state.sessions.find(/** @param {any} item */ (item) => item.session_key === sessionKey);
  if (!session) return { error: { code: "not_found", message: "Session not found" } };
  if (session.status !== "in_progress") return { error: { code: "session_state_conflict", message: "Only an in-progress Session can pause" } };
  const open = session.training_intervals.find(/** @param {any} interval */ (interval) => interval.ended_at === null);
  if (!open) return { session, replay: true };
  const requested = closeAt === null ? now.getTime() : Date.parse(closeAt);
  if (!Number.isFinite(requested)) return { error: { code: "invalid_request", message: "close_at must be an RFC 3339 UTC instant" } };
  const startedAt = Date.parse(open.started_at);
  if (closeAt !== null && requested > now.getTime()) return { error: { code: "invalid_request", message: "close_at cannot be in the future" } };
  const endAt = closeAt === null ? Math.max(startedAt + 1, requested) : requested;
  if (endAt <= startedAt) return { error: { code: "invalid_request", message: "close_at must be after the open interval start" } };
  open.ended_at = new Date(endAt).toISOString();
  session.updated_at = now.toISOString();
  state.training_version += 1;
  return { session };
}

/** @param {any} state @param {string} sessionKey @param {Date} now */
export function resumeSession(state, sessionKey, now) {
  const session = state.sessions.find(/** @param {any} item */ (item) => item.session_key === sessionKey);
  if (!session) return { error: { code: "not_found", message: "Session not found" } };
  if (session.status !== "in_progress") return { error: { code: "session_state_conflict", message: "Only an in-progress Session can resume" } };
  const today = localDate(now, state.timezone);
  if (session.scheduled_date !== today) return { error: { code: "session_date_not_today", message: "Only today's Session can resume" } };
  const open = session.training_intervals.find(/** @param {any} interval */ (interval) => interval.ended_at === null);
  if (open) return { session, replay: true };
  session.training_intervals.push({ interval_key: opaqueKey("ti"), started_at: now.toISOString(), ended_at: null });
  session.updated_at = now.toISOString();
  state.training_version += 1;
  return { session };
}

/** @param {any} state @param {string} sessionKey @param {Date} now @param {string} command */
export function continueOrRestart(state, sessionKey, now, command) {
  const session = state.sessions.find(/** @param {any} item */ (item) => item.session_key === sessionKey);
  if (!session) return { error: { code: "not_found", message: "Session not found" } };
  const today = localDate(now, state.timezone);
  if (session.scheduled_date !== today) return { error: { code: "session_date_not_today", message: "Only today's Session can continue or restart" } };
  if (command === "continue" && session.status !== "partial") return { error: { code: "session_state_conflict", message: "Only a same-day partial Session can continue" } };
  if (command === "restart" && session.status !== "skipped") return { error: { code: "session_state_conflict", message: "Only a skipped Session can restart" } };
  session.status = "in_progress";
  session.skip_reason = null;
  session.session_rpe = null;
  session.training_intervals.push({ interval_key: opaqueKey("ti"), started_at: now.toISOString(), ended_at: null });
  session.updated_at = now.toISOString();
  state.training_version += 1;
  return { session };
}

/**
 * Close sessions whose scheduled local date has passed without treating a
 * missing explicit end command as athlete confirmation of completion.
 *
 * @param {any} state
 * @param {Date} now
 */
export function normalizeExpiredSessions(state, now) {
  const today = localDate(now, state.timezone);
  const normalized = [];
  for (const session of state.sessions) {
    if (session.status !== "in_progress" || session.scheduled_date >= today) continue;
    const openIntervals = session.training_intervals.filter(/** @param {any} interval */ (interval) => interval.ended_at === null);
    const endAt = expiredSessionEndAt(session, openIntervals, now);
    for (const interval of openIntervals) interval.ended_at = endAt;
    session.status = "partial";
    session.updated_at = now.toISOString();
    normalized.push(session);
  }
  if (normalized.length) state.training_version += normalized.length;
  return { normalized_count: normalized.length, session_keys: normalized.map((session) => session.session_key) };
}

/** @param {any} session @param {any[]} openIntervals @param {Date} now */
function expiredSessionEndAt(session, openIntervals, now) {
  const starts = openIntervals.map((interval) => Date.parse(interval.started_at)).filter(Number.isFinite);
  const latestStart = starts.length ? Math.max(...starts) : now.getTime() - 1000;
  const activityTimes = [Date.parse(session.updated_at), ...session.training_intervals.map(/** @param {any} interval */ (interval) => Date.parse(interval.ended_at)).filter(Number.isFinite)].filter(Number.isFinite);
  const activity = activityTimes.length ? Math.max(...activityTimes) : latestStart + 1000;
  const bounded = Math.min(activity, now.getTime());
  return new Date(Math.max(latestStart + 1000, bounded)).toISOString();
}

/** @param {any} session */
export function sessionDetail(session) {
  return {
    ...sessionSummary(session),
    scheduled_workout_key: session.scheduled_workout_key,
    plan_id: session.plan_id ?? null,
    plan_revision_key: session.plan_revision_key ?? null,
    local_date: session.local_date ?? session.scheduled_date,
    timezone_at_session: session.timezone_at_session,
    note: session.note,
    skip_reason: session.skip_reason,
    snapshot: deepClone(session.snapshot),
    completion_results: deepClone(session.completion_results),
    set_results: session.set_results ? deepClone(session.set_results) : undefined,
    training_intervals: deepClone(session.training_intervals),
    exercise_feedback: deepClone(session.exercise_feedback),
    created_at: session.created_at,
  };
}

/** @param {any} state @param {string} sessionKey */
export function findSession(state, sessionKey) { return state.sessions.find(/** @param {any} item */ (item) => item.session_key === sessionKey) ?? null; }

/** @param {any} session */
function isCanonicalSession(session) {
  return session?.snapshot?.schema_version === 2 || session?.snapshot?.blocks?.some(/** @param {any} block */ (block) => block.exercises?.some(/** @param {any} exercise */ (exercise) => exercise.exercise_id));
}

/** @param {any} state @param {any} session @param {any} record @param {Date} now @param {string} mode */
function replaceCanonicalRecord(state, session, record, now, mode) {
  if (session.status === "skipped" && (record.set_results.length || record.training_intervals.length || record.session_rpe !== null || record.exercise_feedback.length)) return { error: { code: "invalid_skipped_record", message: "A skipped Session can only correct its note and skip reason until restart" } };
  const existingOpen = session.training_intervals.find(/** @param {any} interval */ (interval) => interval.ended_at === null);
  if (session.status === "in_progress" && mode === "in_progress" && !existingOpen) return { error: { code: "session_state_conflict", message: "Resume the paused Session before recording a Set Result" } };
  const errors = validateSessionRecord(record, session, now.toISOString(), mode === "replace" ? session.status === "in_progress" ? "in_progress" : session.status === "skipped" ? "skipped" : "terminal" : mode);
  if (errors.length) return { error: { code: "invalid_session_record", message: "The canonical Session Record is invalid", details: errors } };
  if (session.status === "in_progress" && mode === "in_progress") {
    const submittedOpen = record.training_intervals.find(/** @param {any} interval */ (interval) => interval.ended_at === null);
    if (!existingOpen || !submittedOpen || submittedOpen.interval_key !== existingOpen.interval_key) return { error: { code: "invalid_session_record", message: "The open interval is server-owned and must be preserved" } };
  }
  const setResults = record.set_results.map(/** @param {any} result */ (result) => ({ ...deepClone(result), ...normalizedResultResistance(result.resistance), completed: result.status === "completed" }));
  session.set_results = setResults;
  session.completion_results = deepClone(setResults);
  session.training_intervals = deepClone(record.training_intervals);
  session.session_rpe = session.status === "in_progress" || session.status === "skipped" ? null : record.session_rpe;
  session.note = record.note;
  session.exercise_feedback = deepClone(record.exercise_feedback);
  session.skip_reason = session.status === "skipped" ? record.skip_reason : null;
  if (mode === "terminal") session.status = completionFraction(session) === 1 ? "completed" : "partial";
  session.updated_at = now.toISOString();
  state.training_version += 1;
  return { session };
}

/** @param {any} resistance */
function normalizedResultResistance(resistance) {
  if (resistance === null || resistance?.mode === "bodyweight") return { resistance_mode: resistance?.mode === "bodyweight" ? "bodyweight" : null, resistance_kg: null };
  if (resistance?.mode === "external_load") {
    const value = resistance.unit === "lb" ? resistance.value * 0.45359237 : resistance.value;
    return { resistance_mode: "external_load", resistance_kg: Math.round(value * 100000) / 100000 };
  }
  return { resistance_mode: null, resistance_kg: null };
}
