// @ts-check

import { addDays, canonicalJson, dateRange, dateSpan, deepClone, localDate, opaqueKey, WEEKDAYS, weekdayKey } from "./util.js";
import { validatePlanPackage } from "./validation.js";

/** @param {any} state @param {string} date */
export function effectiveRevision(state, date) {
  return state.plan_revisions
    .filter(/** @param {any} revision */ (revision) => revision.effective_from <= date)
    .sort(/** @param {any} left @param {any} right */ (left, right) => right.revision_sequence - left.revision_sequence)[0] ?? null;
}

/** @param {any} state @param {string} date */
export function resolveSlot(state, date) {
  const revision = effectiveRevision(state, date);
  return { revision, slot: revision ? revision.week[weekdayKey(date)] : null };
}

/** @param {any} slot @param {string} prefix */
export function expandSnapshot(slot, prefix = "snap") {
  if (!slot || slot.kind !== "workout") return null;
  /** @type {any} */
  const snapshot = {
    title: slot.title,
    start_time: slot.start_time,
    estimated_duration_min: slot.estimated_duration_min,
    blocks: /** @type {any[]} */ ([]),
    completion_items: /** @type {any[]} */ ([]),
    exercise_occurrence_keys: /** @type {string[]} */ ([]),
  };
  slot.blocks.forEach(/** @param {any} block @param {number} blockIndex */ (block, blockIndex) => {
    const blockKey = opaqueKey(`${prefix}b${blockIndex + 1}`);
    const snapshotBlock = { block_key: blockKey, title: block.title, exercises: /** @type {any[]} */ ([]) };
    block.exercises.forEach(/** @param {any} exercise @param {number} exerciseIndex */ (exercise, exerciseIndex) => {
      const exerciseOccurrenceKey = opaqueKey(`${prefix}e${blockIndex + 1}${exerciseIndex + 1}`);
      snapshot.exercise_occurrence_keys.push(exerciseOccurrenceKey);
      const snapshotExercise = {
        exercise_occurrence_key: exerciseOccurrenceKey,
        exercise_key: exercise.exercise_key,
        name: exercise.name,
        category: exercise.category,
        side_mode: exercise.side_mode,
        sets: /** @type {any[]} */ ([]),
      };
      exercise.sets.forEach(/** @param {any} set @param {number} setIndex */ (set, setIndex) => {
        const setKey = opaqueKey(`${prefix}s${blockIndex + 1}${exerciseIndex + 1}${setIndex + 1}`);
        const snapshotSet = { set_key: setKey, ...deepClone(set) };
        snapshotExercise.sets.push(snapshotSet);
        const sides = exercise.side_mode === "left_right" ? ["left", "right"] : ["none"];
        sides.forEach(/** @param {string} side */ (side) => snapshot.completion_items.push({
          completion_item_key: opaqueKey(`${prefix}c${snapshot.completion_items.length + 1}`),
          exercise_occurrence_key: exerciseOccurrenceKey,
          set_key: setKey,
          side,
          target: deepClone(set.target),
          resistance: deepClone(set.resistance),
        }));
      });
      snapshotBlock.exercises.push(snapshotExercise);
    });
    snapshot.blocks.push(snapshotBlock);
  });
  return snapshot;
}

/** @param {any} state @param {string} date */
export function scheduledWorkoutKey(state, date) {
  const { revision, slot } = resolveSlot(state, date);
  return revision && slot ? `sw_${state.athlete_key}_${date}` : null;
}

/** @param {any} state @param {string} date @param {Date} now */
export function scheduleEntry(state, date, now = new Date()) {
  const { revision, slot } = resolveSlot(state, date);
  const session = state.sessions.find(/** @param {any} item */ (item) => item.scheduled_date === date) ?? null;
  if (!revision || slot === null) return {
    date, weekday: weekdayKey(date), kind: "no_plan", title: null, estimated_duration_min: null,
    prescription_ref: null, scheduled_workout_key: null, session_key: null,
    is_due: false, is_overdue_unstarted: false, source_ref: `schedule:${date}:no_plan`, revision_key: null,
  };
  if (slot.kind === "rest") return {
    date, weekday: weekdayKey(date), kind: "rest", title: null, estimated_duration_min: null,
    prescription_ref: null, scheduled_workout_key: null, session_key: null,
    is_due: false, is_overdue_unstarted: false, source_ref: `schedule:${date}:rest`, revision_key: revision.revision_key,
  };
  const currentDate = localDate(now, state.timezone);
  const isToday = date === currentDate;
  const isPast = date < currentDate;
  const isDue = Boolean(session) || isPast;
  return {
    date, weekday: weekdayKey(date), kind: "workout", title: slot.title, estimated_duration_min: slot.estimated_duration_min,
    prescription_ref: `prescription:${revision.revision_key}:${weekdayKey(date)}`, scheduled_workout_key: scheduledWorkoutKey(state, date),
    session_key: session?.session_key ?? null,
    is_due: isDue, is_overdue_unstarted: isPast && !session,
    source_ref: `schedule:${date}:${revision.revision_key}`, revision_key: revision.revision_key,
    prescription: deepClone(slot),
  };
}

/** @param {any} state @param {Date} now */
export function todayModel(state, now = new Date()) {
  const date = localDate(now, state.timezone);
  const entry = scheduleEntry(state, date, now);
  const session = entry.session_key ? state.sessions.find(/** @param {any} item */ (item) => item.session_key === entry.session_key) ?? null : null;
  return { date, timezone: state.timezone, entry, session: session ? sessionSummary(session) : null };
}

/** @param {any} session */
export function completionFraction(session) {
  const total = session.snapshot.completion_items.length;
  if (!total) return 0;
  const completed = session.completion_results.length;
  return completed / total;
}

/** @param {any} session */
export function trainingDuration(session) {
  return session.training_intervals.reduce(/** @param {number} total @param {any} interval */ (total, interval) => interval.ended_at ? total + Math.max(0, (Date.parse(interval.ended_at) - Date.parse(interval.started_at)) / 1000) : total, 0);
}

/** @param {any} session */
export function sessionSummary(session) {
  return {
    session_key: session.session_key,
    scheduled_date: session.scheduled_date,
    title: session.title,
    status: session.status,
    completion_fraction: completionFraction(session),
    training_duration_sec: Math.round(trainingDuration(session)),
    session_rpe: session.session_rpe,
    exercise_keys: [...new Set(session.snapshot.blocks.flatMap(/** @param {any} block */ (block) => block.exercises.map(/** @param {any} exercise */ (exercise) => exercise.exercise_key)))],
    updated_at: session.updated_at,
    source_ref: `session:${session.scheduled_date}:${session.session_key}`,
  };
}

/** @param {any} state @param {Date} now */
export function planModel(state, now = new Date()) {
  const today = localDate(now, state.timezone);
  const current = effectiveRevision(state, today);
  const future = state.plan_revisions
    .filter(/** @param {any} revision */ (revision) => revision.effective_from > today && effectiveRevision(state, revision.effective_from)?.revision_key === revision.revision_key)
    .sort(/** @param {any} left @param {any} right */ (left, right) => left.effective_from.localeCompare(right.effective_from))
    .map(/** @param {any} revision */ (revision) => ({ effective_from: revision.effective_from, week: deepClone(revision.week) }));
  return {
    current: current ? { effective_from: current.effective_from, week: deepClone(current.week) } : null,
    future,
    next_effective_from: future[0]?.effective_from ?? null,
    pending_count: future.length,
    timezone: state.timezone,
  };
}

/** @param {any} state @param {string|undefined} from @param {string|undefined} to @param {Date} now */
export function scheduleModel(state, from, to, now = new Date()) {
  const today = localDate(now, state.timezone);
  const start = from ?? addDays(today, -6);
  const end = to ?? today;
  const span = dateSpan(start, end);
  if (span === null || span > 366) return { error: { code: "invalid_period", message: "Schedule requires a valid inclusive range of at most 366 days" } };
  return dateRange(start, end).map((date) => scheduleEntry(state, date, now));
}

/** @param {any} state @param {any} packageValue @param {Date} now */
export function packagePreview(state, packageValue, now = new Date()) {
  const previous = effectiveRevision(state, packageValue.effective_from)?.week ?? Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
  const changed = WEEKDAYS.filter((day) => canonicalJson(previous[day]) !== canonicalJson(packageValue.week[day])).length;
  return { effective_from: packageValue.effective_from, week: deepClone(packageValue.week), changed_weekday_slot_count: changed };
}

/** @param {any} state @param {string} text @param {Date} now */
export function validatePlanForState(state, text, now = new Date()) {
  const today = localDate(now, state.timezone);
  const result = validatePlanPackage(text, today);
  if (!result.ok) return result;
  /** @type {any} */
  const value = result.value;
  const current = effectiveRevision(state, value.effective_from);
  if (current && canonicalJson(current.week) === canonicalJson(value.week)) return { ok: false, errors: [{ path: "/week", message: "This package does not change the effective template" }] };
  return { ok: true, value, preview: packagePreview(state, value, now) };
}

/** @param {any} state @param {any} packageValue @param {Date} now */
export function appendPlanRevision(state, packageValue, now = new Date()) {
  const revision = {
    revision_key: opaqueKey("rev"),
    revision_sequence: Math.max(0, ...state.plan_revisions.map(/** @param {any} item */ (item) => item.revision_sequence)) + 1,
    created_at: now.toISOString(),
    effective_from: packageValue.effective_from,
    week: deepClone(packageValue.week),
  };
  state.plan_revisions.push(revision);
  state.plan_revisions.sort(/** @param {any} left @param {any} right */ (left, right) => left.revision_sequence - right.revision_sequence);
  return revision;
}
