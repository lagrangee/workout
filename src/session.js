// @ts-nocheck

import { addDays, deepClone, isValidUtcInstant, localDate, opaqueKey } from "./util.js";
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
  const existing = state.sessions.find((item) => item.scheduled_date === date);
  if (existing) {
    if ((kind === "start" && existing.status === "in_progress") || (kind === "skip" && existing.status === "skipped")) return { session: existing, replay: true };
    return { error: { code: "session_state_conflict", message: "A different action cannot be applied to this Session" } };
  }
  const { slot } = resolveSlot(state, date);
  const sessionKey = opaqueKey("sess");
  const session = {
    session_key: sessionKey,
    scheduled_workout_key: scheduledWorkoutKey(state, date),
    scheduled_date: date,
    timezone_at_session: state.timezone,
    title: slot.title,
    status: kind === "skip" ? "skipped" : "in_progress",
    snapshot: expandForSession(slot),
    completion_results: [],
    training_intervals: [],
    session_rpe: null,
    note: null,
    skip_reason: kind === "skip" ? skipReason : null,
    exercise_feedback: [],
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
  // Kept local to avoid making the mutation route depend on a mutable plan
  // object after the snapshot has been captured.
  const snapshot = {
    title: slot.title, start_time: slot.start_time, estimated_duration_min: slot.estimated_duration_min,
    blocks: [], completion_items: [], exercise_occurrence_keys: [],
  };
  slot.blocks.forEach((block, blockIndex) => {
    const blockKey = opaqueKey(`sb${blockIndex + 1}`);
    const snapshotBlock = { block_key: blockKey, title: block.title, exercises: [] };
    block.exercises.forEach((exercise, exerciseIndex) => {
      const occurrenceKey = opaqueKey(`eo${blockIndex + 1}${exerciseIndex + 1}`);
      snapshot.exercise_occurrence_keys.push(occurrenceKey);
      const snapshotExercise = { exercise_occurrence_key: occurrenceKey, exercise_key: exercise.exercise_key, name: exercise.name, category: exercise.category, side_mode: exercise.side_mode, sets: [] };
      exercise.sets.forEach((set, setIndex) => {
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

/** @param {any} state @param {any} session @param {any} record @param {Date} now @param {string} mode */
export function replaceRecord(state, session, record, now, mode = "replace") {
  if (session.status === "skipped") {
    if (record.completion_results.length || record.training_intervals.length || record.session_rpe !== null || record.exercise_feedback.length) return { error: { code: "invalid_skipped_record", message: "A skipped Session can only correct its note and skip reason until restart" } };
  }
  const targetMode = session.status === "in_progress" ? "in_progress" : "terminal";
  const errors = validateSessionRecord(record, session, now.toISOString(), targetMode);
  if (errors.length) return { error: { code: "invalid_session_record", message: "The Session Record is invalid", details: errors } };
  if (session.status === "in_progress") {
    const existingOpen = session.training_intervals.find((interval) => interval.ended_at === null);
    const submittedOpen = record.training_intervals.find((interval) => interval.ended_at === null);
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
  const session = state.sessions.find((item) => item.session_key === sessionKey);
  if (!session) return { error: { code: "not_found", message: "Session not found" } };
  if (session.status !== "in_progress") return { error: { code: "session_state_conflict", message: "Only an in-progress Session can end" } };
  if (!payload || typeof payload !== "object" || Object.keys(payload).some((key) => !["record", "ended_at"].includes(key))) return { error: { code: "invalid_request", message: "End requires record and ended_at" } };
  if (!isValidUtcInstant(payload.ended_at)) return { error: { code: "invalid_request", message: "ended_at must be an RFC 3339 UTC instant" } };
  const difference = Date.parse(payload.ended_at) - now.getTime();
  if (difference > 5 * 60 * 1000) return { error: { code: "invalid_request", message: "ended_at cannot be more than five minutes in the future" } };
  const open = session.training_intervals.find((interval) => interval.ended_at === null);
  if (!open || Date.parse(payload.ended_at) <= Date.parse(open.started_at)) return { error: { code: "invalid_session_record", message: "ended_at must close the open interval" } };
  const proposed = deepClone(payload.record);
  if (!proposed || !Array.isArray(proposed.training_intervals)) return { error: { code: "invalid_session_record", message: "End requires the complete Session Record" } };
  const proposedOpen = proposed.training_intervals.find((interval) => interval.interval_key === open.interval_key);
  if (!proposedOpen) return { error: { code: "invalid_session_record", message: "End record must include the open interval" } };
  proposedOpen.ended_at = payload.ended_at;
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

/** @param {any} state @param {string} sessionKey @param {Date} now @param {string} command */
export function continueOrRestart(state, sessionKey, now, command) {
  const session = state.sessions.find((item) => item.session_key === sessionKey);
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

/** @param {any} session */
export function sessionDetail(session) {
  return {
    ...sessionSummary(session),
    scheduled_workout_key: session.scheduled_workout_key,
    timezone_at_session: session.timezone_at_session,
    note: session.note,
    skip_reason: session.skip_reason,
    snapshot: deepClone(session.snapshot),
    completion_results: deepClone(session.completion_results),
    training_intervals: deepClone(session.training_intervals),
    exercise_feedback: deepClone(session.exercise_feedback),
    created_at: session.created_at,
  };
}

/** @param {any} state @param {string} sessionKey */
export function findSession(state, sessionKey) { return state.sessions.find((item) => item.session_key === sessionKey) ?? null; }
