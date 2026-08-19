// @ts-nocheck

import { addDays, dateRange, dateSpan, isValidLocalDate, localDate, mondayOf, roundHalfUp } from "./util.js";
import { completionFraction, scheduleEntry, sessionSummary } from "./plan.js";
import { assembleExerciseHistory } from "./canonical-assembler.js";
import { resolveExercise } from "./exercise-registry.js";

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
    const strengthOccurrences = new Set(session.snapshot.blocks.flatMap((block) => block.exercises.filter((exercise) => exercise.category === "strength" || exercise.exercise_id).map((exercise) => exercise.exercise_occurrence_key)));
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

/** @param {any} state @param {Date} now @param {string|undefined} from @param {string|undefined} to @param {string|undefined} preset @param {string|undefined} range */
export function resolvePeriod(state, now, from, to, preset, range) {
  const today = localDate(now, state.timezone);
  if (preset !== undefined && range !== undefined) return { error: { code: "invalid_period", field: "range", message: "range and preset are mutually exclusive" } };
  const selector = range ?? preset;
  const selectorField = range !== undefined ? "range" : "preset";
  if ((range !== undefined && !range) || (range === undefined && preset !== undefined && !preset)) return { error: { code: "invalid_period", field: selectorField, message: "period selector must not be empty" } };
  const hasFrom = from !== undefined;
  const hasTo = to !== undefined;
  if (hasFrom !== hasTo) return { error: { code: "invalid_period", field: hasFrom ? "to" : "from", message: "from and to must be provided together" } };
  if ((hasFrom || hasTo) && selector) return { error: { code: "invalid_period", field: selectorField, message: "from/to and a preset or range are mutually exclusive" } };
  if (hasFrom && hasTo) {
    if (!isValidLocalDate(from)) return { error: { code: "invalid_period", field: "from", message: "from must be a valid local date" } };
    if (!isValidLocalDate(to)) return { error: { code: "invalid_period", field: "to", message: "to must be a valid local date" } };
    if (from > to) return { error: { code: "invalid_period", field: "from", message: "from must not be after to" } };
    if (dateSpan(from, to) > 3660) return { error: { code: "invalid_period", field: "to", message: "The selected period cannot exceed 3660 days" } };
    return { from, to };
  }
  if (selector === "7d") return { from: addDays(today, -6), to: today };
  if (selector === "30d" || !selector) return { from: addDays(today, -29), to: today };
  if (selector === "12w") return { from: addDays(mondayOf(today), -77), to: today };
  if (selector === "all") {
    const first = state.plan_revisions.map((revision) => revision.effective_from).sort()[0];
    return { from: first ?? today, to: today };
  }
  return { error: { code: "invalid_period", field: selectorField, message: "unsupported period preset or range" } };
}

/** @param {any} state @param {Date} now @param {string|undefined} from @param {string|undefined} to @param {string|undefined} preset @param {string} bucket @param {string|undefined} range */
export function progressModel(state, now, from, to, preset, bucket = "week", range) {
  const period = resolvePeriod(state, now, from, to, preset, range);
  if (period.error) return period;
  if (![
    "day", "week", "month",
  ].includes(bucket)) return { error: { code: "invalid_request", field: "bucket", message: "bucket must be day, week, or month" } };
  const today = localDate(now, state.timezone);
  const makeMetric = (start, end) => metricSet(state, start, end, now);
  const metrics = makeMetric(period.from, period.to);
  const buckets = progressBuckets(period, bucket, makeMetric);
  const weekBuckets = progressBuckets(period, "week", makeMetric).map(({ from, to, is_partial, week_start, week_end, included_from, included_to, metrics: bucketMetrics }) => ({ week_start, week_end, included_from, included_to, is_partial, metrics: bucketMetrics }));
  const canonical = state.sessions.some((session) => session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_id)));
  const exercises = exerciseKeys(state).map((exerciseKey) => {
    const performedSessionCount = state.sessions.filter((session) => (session.status === "completed" || session.status === "partial") && session.scheduled_date >= period.from && session.scheduled_date <= period.to && session.snapshot.blocks.some((block) => block.exercises.some((exercise) => (exercise.exercise_id ?? exercise.exercise_key) === exerciseKey && session.completion_results.some((result) => session.snapshot.completion_items.some((item) => item.completion_item_key === result.completion_item_key && item.exercise_occurrence_key === (exercise.exercise_occurrence_key ?? exercise.occurrence_key)))))).length;
    return canonical ? { exercise_id: exerciseKey, exercise_key: exerciseKey, current_name: latestExerciseName(state, exerciseKey), performed_session_count: performedSessionCount, detail_ref: `exercise:${exerciseKey}` } : { exercise_key: exerciseKey, current_name: latestExerciseName(state, exerciseKey), performed_session_count: performedSessionCount, detail_ref: `exercise:${exerciseKey}` };
  });
  return {
    metric_semantics_version: 1,
    period: periodContext(period, state.timezone, today),
    completion_rate_7d: makeMetric(addDays(today, -6), today).completion_rate,
    completion_rate_30d: makeMetric(addDays(today, -29), today).completion_rate,
    current_streak: streakMetric(state, today),
    metrics,
    bucket,
    buckets,
    week_buckets: weekBuckets,
    exercises,
    data_as_of: now.toISOString(),
  };
}

function periodContext(period, timezone, today) {
  const includesCurrentDate = period.from <= today && today <= period.to;
  return { ...period, timezone, includes_from: true, includes_to: true, includes_current_date: includesCurrentDate, current_date_may_be_incomplete: includesCurrentDate };
}

function progressBuckets(period, bucket, makeMetric) {
  const result = [];
  let cursor = bucketStart(period.from, bucket);
  while (cursor <= period.to) {
    const end = bucketEnd(cursor, bucket);
    const includedFrom = period.from > cursor ? period.from : cursor;
    const includedTo = period.to < end ? period.to : end;
    const item = { from: includedFrom, to: includedTo, is_partial: includedFrom !== cursor || includedTo !== end, metrics: makeMetric(includedFrom, includedTo) };
    if (bucket === "week") Object.assign(item, { week_start: cursor, week_end: end, included_from: includedFrom, included_to: includedTo });
    if (bucket === "month") Object.assign(item, { month_start: cursor, month_end: end });
    result.push(item);
    cursor = nextBucketStart(cursor, bucket);
  }
  return result;
}

function bucketStart(date, bucket) {
  if (bucket === "day") return date;
  if (bucket === "week") return mondayOf(date);
  return `${date.slice(0, 7)}-01`;
}
function bucketEnd(date, bucket) {
  if (bucket === "day") return date;
  if (bucket === "week") return addDays(date, 6);
  return addDays(nextMonthStart(date), -1);
}
function nextBucketStart(date, bucket) {
  if (bucket === "day") return addDays(date, 1);
  if (bucket === "week") return addDays(date, 7);
  return nextMonthStart(date);
}
function nextMonthStart(date) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-01`;
}

/** @param {any} state */
function exerciseKeys(state) {
  return [...new Set(state.sessions.flatMap((session) => session.snapshot.blocks.flatMap((block) => block.exercises.map((exercise) => exercise.exercise_id ?? exercise.exercise_key).filter(Boolean))))].sort();
}
/** @param {any} state @param {string} key */
function latestExerciseName(state, key) {
  if (resolveExercise(key)) return resolveExercise(key).name;
  const occurrence = state.sessions.slice().sort((left, right) => right.scheduled_date.localeCompare(left.scheduled_date) || right.updated_at.localeCompare(left.updated_at)).flatMap((session) => session.snapshot.blocks.flatMap((block) => block.exercises)).find((exercise) => exercise.exercise_key === key);
  return occurrence?.name ?? key;
}

/** @param {any} state @param {string} exerciseKey @param {Date} now @param {string|undefined} from @param {string|undefined} to @param {string|undefined} preset @param {string|undefined} range */
export function exerciseDetail(state, exerciseKey, now, from, to, preset, range) {
  const period = resolvePeriod(state, now, from, to, preset ?? (range === undefined && from === undefined && to === undefined ? "12w" : undefined), range);
  if (period.error) return period;
  if (state.sessions.some((session) => session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_id === exerciseKey)))) return canonicalExerciseDetail(state, exerciseKey, now, period);
  const matching = state.sessions.filter((session) => (session.status === "completed" || session.status === "partial") && session.scheduled_date >= period.from && session.scheduled_date <= period.to);
  const observations = [];
  const series = { none: [], left: [], right: [] };
  let exists = state.sessions.some((session) => session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_key === exerciseKey)));
  for (const session of matching) {
    const occurrences = session.snapshot.blocks.flatMap((block) => block.exercises).filter((exercise) => exercise.exercise_key === exerciseKey);
    if (!occurrences.length) continue;
    const sets = [];
    for (const occurrence of occurrences) {
      for (const result of session.completion_results) {
        const item = session.snapshot.completion_items.find((candidate) => candidate.completion_item_key === result.completion_item_key && candidate.exercise_occurrence_key === occurrence.exercise_occurrence_key);
        if (!item) continue;
        const observation = { completion_item_key: result.completion_item_key, set_key: item.set_key, side: item.side, actual: result.actual, resistance: result.resistance, total_external_kg: result.resistance?.mode === "external_weight" ? (result.resistance.load_kg === null ? null : result.resistance.load_kg * result.resistance.quantity) : null, assistance_kg: result.resistance?.mode === "assisted_weight" ? result.resistance.load_kg : null, rir: result.rir };
        sets.push(observation);
        series[item.side].push({ session_key: session.session_key, scheduled_date: session.scheduled_date, completion_item_key: result.completion_item_key, actual: result.actual, resistance: result.resistance, rir: result.rir });
      }
    }
    if (sets.length) observations.push({ session_key: session.session_key, scheduled_date: session.scheduled_date, source_ref: `session:${session.scheduled_date}:${session.session_key}`, sets, total_reps: sumMetric(sets, "reps"), total_duration_sec: sumMetric(sets, "duration_sec"), highest_external_load_kg_per_implement: maxValue(sets, (set) => set.resistance?.mode === "external_weight" ? set.resistance.load_kg : null), highest_external_total_kg: maxValue(sets, (set) => set.total_external_kg), lowest_assistance_kg_per_implement: minValue(sets, (set) => set.assistance_kg) });
  }
  if (!exists) return { error: { code: "not_found", message: "Exercise not found" } };
  for (const side of ["none", "left", "right"]) series[side].sort(sortObservation);
  observations.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || a.session_key.localeCompare(b.session_key));
  return { period: periodContext(period, state.timezone, localDate(now, state.timezone)), exercise_key: exerciseKey, display_name_history: exerciseNameHistory(state, exerciseKey), performed_session_count: observations.length, observations, series };
}

/** @param {any} state @param {string} exerciseId @param {Date} now @param {any} period */
function canonicalExerciseDetail(state, exerciseId, now, period) {
  const history = assembleExerciseHistory(state.sessions, exerciseId, { from: period.from, to: period.to });
  if (!history.display_name_history.length) return { error: { code: "not_found", message: "Exercise not found" } };
  const observations = history.observations.map((observation) => ({
    ...observation,
    sets: observation.sets.map((set) => ({ ...set, set_key: set.set_id, total_external_kg: set.total_external_kg })),
  }));
  return { period: periodContext(period, state.timezone, localDate(now, state.timezone)), exercise_id: exerciseId, exercise_key: exerciseId, current_name: history.current_name, display_name_history: history.display_name_history, performed_session_count: history.performed_session_count, observations, series: history.series };
}

function exerciseNameHistory(state, exerciseKey) {
  const entries = new Map();
  for (const session of state.sessions) for (const block of session.snapshot.blocks) for (const exercise of block.exercises) if (exercise.exercise_key === exerciseKey) {
    const current = entries.get(exercise.name) ?? { name: exercise.name, first_date: session.scheduled_date, last_date: session.scheduled_date };
    current.first_date = current.first_date < session.scheduled_date ? current.first_date : session.scheduled_date;
    current.last_date = current.last_date > session.scheduled_date ? current.last_date : session.scheduled_date;
    entries.set(exercise.name, current);
  }
  return [...entries.values()].sort((left, right) => left.first_date.localeCompare(right.first_date));
}

function sumMetric(sets, metric) { const values = sets.filter((set) => set.actual.metric === metric).map((set) => set.actual.value); return values.length ? values.reduce((sum, value) => sum + value, 0) : null; }
function maxValue(values, getter) { const numbers = values.map(getter).filter((value) => value !== null); return numbers.length ? Math.max(...numbers) : null; }
function minValue(values, getter) { const numbers = values.map(getter).filter((value) => value !== null); return numbers.length ? Math.min(...numbers) : null; }
function sortObservation(a, b) { return a.scheduled_date.localeCompare(b.scheduled_date) || a.session_key.localeCompare(b.session_key) || a.completion_item_key.localeCompare(b.completion_item_key); }
