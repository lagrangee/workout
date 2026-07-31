// @ts-nocheck

import { addDays, dateRange, localDate, mondayOf, roundHalfUp } from "./util.js";
import { completionFraction, scheduleEntry, sessionSummary } from "./plan.js";

/** @param {any} state @param {string} from @param {string} to @param {Date} now */
export function metricSet(state, from, to, now = new Date()) {
  const dates = dateRange(from, to);
  const entries = dates.map((date) => scheduleEntry(state, date, now));
  const sessions = state.sessions.filter((session) => session.scheduled_date >= from && session.scheduled_date <= to);
  const trainingSessions = sessions.filter((session) => session.status === "completed" || session.status === "partial");
  const dueEntries = entries.filter((entry) => entry.kind === "workout" && entry.is_due);
  const completed = sessions.filter((session) => session.status === "completed").length;
  const partial = sessions.filter((session) => session.status === "partial").length;
  const inProgress = sessions.filter((session) => session.status === "in_progress").length;
  const skipped = sessions.filter((session) => session.status === "skipped").length;
  const overdueUnstarted = entries.filter((entry) => entry.is_overdue_unstarted).length;
  const notDueUnstarted = entries.filter((entry) => entry.kind === "workout" && !entry.is_due && !entry.session_key).length;
  const restDays = entries.filter((entry) => entry.kind === "rest").length;
  const noPlanDays = entries.filter((entry) => entry.kind === "no_plan").length;
  const points = dueEntries.reduce((sum, entry) => {
    const session = sessions.find((item) => item.scheduled_date === entry.date);
    return sum + (session ? completionFraction(session) : 0);
  }, 0);
  const sessionRefs = trainingSessions.map((session) => `session:${session.scheduled_date}:${session.session_key}`);
  const duration = Math.round(trainingSessions.reduce((sum, session) => sum + session.training_intervals.reduce((total, interval) => interval.ended_at ? total + (Date.parse(interval.ended_at) - Date.parse(interval.started_at)) / 1000 : total, 0), 0));
  const strengthDates = new Set();
  for (const session of trainingSessions) {
    const strengthOccurrences = new Set(session.snapshot.blocks.flatMap((block) => block.exercises.filter((exercise) => exercise.category === "strength").map((exercise) => exercise.exercise_occurrence_key)));
    const strengthItems = new Set(session.snapshot.completion_items.filter((item) => strengthOccurrences.has(item.exercise_occurrence_key)).map((item) => item.completion_item_key));
    if (session.completion_results.some((result) => strengthItems.has(result.completion_item_key))) strengthDates.add(session.scheduled_date);
  }
  const rpes = trainingSessions.map((session) => session.session_rpe).filter((rpe) => rpe !== null);
  return {
    completion_rate: {
      value: dueEntries.length ? roundHalfUp(points / dueEntries.length, 4) : null,
      evidence: { completion_points: roundHalfUp(points, 4), due_workouts: dueEntries.length, completed, partial, in_progress: inProgress, skipped, overdue_unstarted: overdueUnstarted, not_due_unstarted: notDueUnstarted, rest_days: restDays, no_plan_days: noPlanDays },
    },
    training_duration: { value_sec: duration, session_refs: sessionRefs },
    strength_training_days: { value: strengthDates.size, session_refs: trainingSessions.filter((session) => strengthDates.has(session.scheduled_date)).map((session) => `session:${session.scheduled_date}:${session.session_key}`) },
    average_session_rpe: { value: rpes.length ? roundHalfUp(rpes.reduce((sum, value) => sum + value, 0) / rpes.length, 2) : null, included_count: rpes.length, excluded_null_count: trainingSessions.length - rpes.length },
  };
}

/** @param {any} state @param {string} today */
export function streakMetric(state, today) {
  let cursor = today;
  let value = 0;
  let first = null;
  let last = null;
  for (let count = 0; count < 370; count += 1) {
    const entry = scheduleEntry(state, cursor, new Date(`${today}T12:00:00Z`));
    if (entry.kind !== "workout") { cursor = addDays(cursor, -1); continue; }
    const session = state.sessions.find((item) => item.scheduled_date === cursor);
    if (cursor === today && session?.status === "in_progress") { cursor = addDays(cursor, -1); continue; }
    if (session && session.status === "completed" && completionFraction(session) === 1) { value += 1; first = cursor; last ??= cursor; cursor = addDays(cursor, -1); continue; }
    break;
  }
  return { value, first_qualifying_date: first, last_qualifying_date: last };
}

/** @param {any} state @param {Date} now @param {string|undefined} from @param {string|undefined} to @param {string|undefined} preset */
export function resolvePeriod(state, now, from, to, preset) {
  const today = localDate(now, state.timezone);
  if ((from && !to) || (!from && to)) return { error: { code: "invalid_period", message: "from and to must be provided together" } };
  if ((from || to) && preset) return { error: { code: "invalid_period", message: "preset and explicit dates are mutually exclusive" } };
  if (from && to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return { error: { code: "invalid_period", message: "from and to must be valid inclusive local dates" } };
    return { from, to };
  }
  if (preset === "7d") return { from: addDays(today, -6), to: today };
  if (preset === "30d" || !preset) return { from: addDays(today, -29), to: today };
  if (preset === "12w") return { from: addDays(mondayOf(today), -77), to: today };
  if (preset === "all") {
    const first = state.plan_revisions.map((revision) => revision.effective_from).sort()[0];
    return { from: first ?? today, to: today };
  }
  return { error: { code: "invalid_period", message: "unsupported period preset" } };
}

/** @param {any} state @param {Date} now @param {string|undefined} from @param {string|undefined} to @param {string|undefined} preset */
export function progressModel(state, now, from, to, preset) {
  const period = resolvePeriod(state, now, from, to, preset);
  if (period.error) return period;
  const today = localDate(now, state.timezone);
  const makeMetric = (start, end) => metricSet(state, start, end, now);
  const metrics = makeMetric(period.from, period.to);
  const buckets = [];
  for (let weekStart = mondayOf(period.from); weekStart <= period.to; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    const includedFrom = period.from > weekStart ? period.from : weekStart;
    const includedTo = period.to < weekEnd ? period.to : weekEnd;
    buckets.push({ week_start: weekStart, week_end: weekEnd, included_from: includedFrom, included_to: includedTo, metrics: makeMetric(includedFrom, includedTo) });
  }
  const exercises = exerciseKeys(state).map((exerciseKey) => ({ exercise_key: exerciseKey, current_name: latestExerciseName(state, exerciseKey), performed_session_count: state.sessions.filter((session) => (session.status === "completed" || session.status === "partial") && session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_key === exerciseKey && session.completion_results.some((result) => result.exercise_occurrence_key === exercise.exercise_occurrence_key)))).length, detail_ref: `exercise:${exerciseKey}` }));
  return {
    metric_semantics_version: 1,
    period: { ...period, timezone: state.timezone, current_date_may_be_incomplete: period.to >= today },
    completion_rate_7d: makeMetric(addDays(today, -6), today).completion_rate,
    completion_rate_30d: makeMetric(addDays(today, -29), today).completion_rate,
    current_streak: streakMetric(state, today),
    metrics,
    week_buckets: buckets,
    exercises,
    data_as_of: now.toISOString(),
  };
}

/** @param {any} state */
function exerciseKeys(state) {
  return [...new Set(state.sessions.flatMap((session) => session.snapshot.blocks.flatMap((block) => block.exercises.map((exercise) => exercise.exercise_key))))].sort();
}
/** @param {any} state @param {string} key */
function latestExerciseName(state, key) {
  const occurrence = state.sessions.flatMap((session) => session.snapshot.blocks.flatMap((block) => block.exercises)).find((exercise) => exercise.exercise_key === key);
  return occurrence?.name ?? key;
}

/** @param {any} state @param {string} exerciseKey @param {Date} now @param {string|undefined} from @param {string|undefined} to @param {string|undefined} preset */
export function exerciseDetail(state, exerciseKey, now, from, to, preset) {
  const period = resolvePeriod(state, now, from, to, preset ?? "12w");
  if (period.error) return period;
  const matching = state.sessions.filter((session) => (session.status === "completed" || session.status === "partial") && session.scheduled_date >= period.from && session.scheduled_date <= period.to);
  const observations = [];
  const series = { none: [], left: [], right: [] };
  let exists = false;
  for (const session of matching) {
    const occurrences = session.snapshot.blocks.flatMap((block) => block.exercises).filter((exercise) => exercise.exercise_key === exerciseKey);
    if (!occurrences.length) continue;
    exists = true;
    const sets = [];
    for (const occurrence of occurrences) {
      for (const result of session.completion_results.filter((item) => item.exercise_occurrence_key === occurrence.exercise_occurrence_key)) {
        const item = session.snapshot.completion_items.find((candidate) => candidate.completion_item_key === result.completion_item_key);
        if (!item) continue;
        const observation = { completion_item_key: result.completion_item_key, set_key: item.set_key, side: item.side, actual: result.actual, resistance: result.resistance, total_external_kg: result.resistance?.mode === "external_weight" ? (result.resistance.load_kg === null ? null : result.resistance.load_kg * result.resistance.quantity) : null, assistance_kg: result.resistance?.mode === "assisted_weight" ? result.resistance.load_kg : null, rir: result.rir };
        sets.push(observation);
        series[item.side].push({ session_key: session.session_key, scheduled_date: session.scheduled_date, completion_item_key: result.completion_item_key, actual: result.actual, resistance: result.resistance, rir: result.rir });
      }
    }
    observations.push({ session_key: session.session_key, scheduled_date: session.scheduled_date, source_ref: `session:${session.scheduled_date}:${session.session_key}`, sets, total_reps: sumMetric(sets, "reps"), total_duration_sec: sumMetric(sets, "duration_sec"), highest_external_load_kg_per_implement: maxValue(sets, (set) => set.resistance?.mode === "external_weight" ? set.resistance.load_kg : null), highest_external_total_kg: maxValue(sets, (set) => set.total_external_kg), lowest_assistance_kg_per_implement: minValue(sets, (set) => set.assistance_kg) });
  }
  if (!exists) return { error: { code: "not_found", message: "Exercise not found" } };
  for (const side of ["none", "left", "right"]) series[side].sort(sortObservation);
  observations.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.session_key.localeCompare(b.session_key));
  return { period: { ...period, timezone: state.timezone, current_date_may_be_incomplete: period.to >= localDate(now, state.timezone) }, exercise_key: exerciseKey, display_name_history: [{ name: latestExerciseName(state, exerciseKey), first_date: observations[0]?.scheduled_date ?? period.from, last_date: observations.at(-1)?.scheduled_date ?? period.to }], performed_session_count: observations.length, observations, series };
}

function sumMetric(sets, metric) { const values = sets.filter((set) => set.actual.metric === metric).map((set) => set.actual.value); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; }
function maxValue(values, getter) { const numbers = values.map(getter).filter((value) => value !== null); return numbers.length ? Math.max(...numbers) : null; }
function minValue(values, getter) { const numbers = values.map(getter).filter((value) => value !== null); return numbers.length ? Math.min(...numbers) : null; }
function sortObservation(a, b) { return a.scheduled_date.localeCompare(b.scheduled_date) || a.session_key.localeCompare(b.session_key) || a.completion_item_key.localeCompare(b.completion_item_key); }
