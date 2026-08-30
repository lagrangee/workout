// @ts-check

import { addDays, canonicalJson, deepClone, localDate, opaqueKey, sha256Hex, weekdayKey } from "./util.js";

export const PLANNED_DAY_STORAGE_VERSION = 1;

/** @param {any} state */
function nextChangeSequence(state) {
  return Math.max(0, ...(state.plan_changes ?? []).map((/** @type {any} */ change) => Number(change.change_sequence) || 0)) + 1;
}

/** @param {any} state @param {any} revision @param {string} changeKey */
function revisionDays(state, revision, changeKey) {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(revision.effective_from, offset);
    const weekday = weekdayKey(date);
    const slot = revision.week[weekday] ?? null;
    return {
      date,
      kind: slot?.kind === "workout" ? "workout" : slot?.kind === "rest" ? "rest" : "no_plan",
      prescription_revision_key: slot?.kind === "workout" ? revision.revision_key : null,
      prescription_weekday: slot?.kind === "workout" ? weekday : null,
      change_key: changeKey,
      version: 1,
      moved_from_date: null,
      moved_to_date: null,
    };
  });
}

/**
 * Upgrade legacy in-memory state into the dated plan model. Each historical
 * weekly write owns exactly seven Athlete-local dates; later writes win on an
 * overlapping date. D1 performs the same backfill in migration 0013.
 * @param {any} state
 */
export function initializePlannedDays(state) {
  if (state.plan_day_storage_version === PLANNED_DAY_STORAGE_VERSION) {
    state.planned_days ??= [];
    state.plan_changes ??= [];
    return;
  }
  state.planned_days = [];
  state.plan_changes = [];
  const revisions = (state.plan_revisions ?? []).slice().sort((/** @type {any} */ left, /** @type {any} */ right) => left.revision_sequence - right.revision_sequence);
  for (const revision of revisions) {
    const changeKey = `legacy_${revision.revision_key}`;
    state.plan_changes.push({
      change_key: changeKey,
      change_sequence: nextChangeSequence(state),
      change_type: "weekly_write",
      created_at: revision.created_at,
      source_date: null,
      target_date: null,
    });
    for (const day of revisionDays(state, revision, changeKey)) upsertPlannedDay(state, day);
  }
  state.plan_day_storage_version = PLANNED_DAY_STORAGE_VERSION;
}

/** @param {any} state @param {any} day */
function upsertPlannedDay(state, day) {
  const index = state.planned_days.findIndex((/** @type {any} */ candidate) => candidate.date === day.date);
  if (index === -1) state.planned_days.push(day);
  else state.planned_days[index] = day;
  state.planned_days.sort((/** @type {any} */ left, /** @type {any} */ right) => left.date.localeCompare(right.date));
}

/** @param {any} state @param {any} revision @param {Date} now */
export function appendWeeklyPlannedDays(state, revision, now = new Date()) {
  initializePlannedDays(state);
  const changeKey = opaqueKey("plan_change");
  state.plan_changes.push({
    change_key: changeKey,
    change_sequence: nextChangeSequence(state),
    change_type: "weekly_write",
    created_at: now.toISOString(),
    source_date: null,
    target_date: null,
  });
  for (const incoming of revisionDays(state, revision, changeKey)) {
    const existing = state.planned_days.find((/** @type {any} */ candidate) => candidate.date === incoming.date);
    upsertPlannedDay(state, { ...incoming, version: (existing?.version ?? 0) + 1 });
  }
  return changeKey;
}

/** @param {any} state @param {string} date */
export function plannedDayRecord(state, date) {
  if (state.plan_day_storage_version !== PLANNED_DAY_STORAGE_VERSION) initializePlannedDays(state);
  return state.planned_days.find((/** @type {any} */ candidate) => candidate.date === date) ?? null;
}

/** @param {any} state @param {string} date */
export function resolvePlannedDay(state, date) {
  const day = plannedDayRecord(state, date);
  if (!day || day.kind === "no_plan") return { day, revision: null, slot: null };
  if (day.kind === "rest") return { day, revision: null, slot: { kind: "rest" } };
  const revision = (state.plan_revisions ?? []).find((/** @type {any} */ candidate) => candidate.revision_key === day.prescription_revision_key) ?? null;
  const slot = revision?.week?.[day.prescription_weekday] ?? null;
  if (!revision || slot?.kind !== "workout") throw new Error(`Planned Day ${date} references a missing workout prescription`);
  return { day, revision, slot };
}

/** @param {any} state @param {string} date */
function evidenceForDate(state, date) {
  const { day, slot } = resolvePlannedDay(state, date);
  return {
    date,
    kind: day?.kind ?? "no_plan",
    version: day?.version ?? 0,
    change_key: day?.change_key ?? null,
    prescription_revision_key: day?.prescription_revision_key ?? null,
    prescription_weekday: day?.prescription_weekday ?? null,
    prescription: slot?.kind === "workout" ? deepClone(slot) : null,
    moved_from_date: day?.moved_from_date ?? null,
    moved_to_date: day?.moved_to_date ?? null,
  };
}

/** @param {any} state @param {{source_date:string,target_date:string}} move @param {Date} now */
export function validatePlannedDayMove(state, move, now = new Date()) {
  const today = localDate(now, state.timezone);
  const errors = [];
  if (!move || typeof move !== "object" || Array.isArray(move) || Object.keys(move).sort().join("|") !== "source_date|target_date") errors.push({ path: "/", message: "Move requires only source_date and target_date" });
  const sourceDate = move?.source_date;
  const targetDate = move?.target_date;
  if (typeof sourceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) errors.push({ path: "/source_date", message: "source_date must be YYYY-MM-DD" });
  if (typeof targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) errors.push({ path: "/target_date", message: "target_date must be YYYY-MM-DD" });
  if (errors.length) return { ok: false, errors };
  if (sourceDate === targetDate) errors.push({ path: "/target_date", message: "target_date must differ from source_date" });
  if (sourceDate < addDays(today, -1)) errors.push({ path: "/source_date", message: "Only yesterday, today, or a future Planned Day may be moved" });
  if (targetDate < today) errors.push({ path: "/target_date", message: "target_date must be today or later" });
  const source = evidenceForDate(state, sourceDate);
  const target = evidenceForDate(state, targetDate);
  if (source.kind !== "workout") errors.push({ path: "/source_date", message: "source_date must contain a workout" });
  if (!new Set(["rest", "no_plan"]).has(target.kind)) errors.push({ path: "/target_date", message: "target_date must be a Rest Day or no-plan day" });
  if ((state.sessions ?? []).some((/** @type {any} */ session) => session.scheduled_date === sourceDate)) errors.push({ path: "/source_date", message: "A Planned Day with a Workout Session cannot be moved" });
  if ((state.sessions ?? []).some((/** @type {any} */ session) => session.scheduled_date === targetDate)) errors.push({ path: "/target_date", message: "A target date with a Workout Session cannot be replaced" });
  if (errors.length) return { ok: false, errors };
  const afterSource = { ...deepClone(target), date: sourceDate, moved_from_date: null, moved_to_date: targetDate };
  const afterTarget = { ...deepClone(source), date: targetDate, moved_from_date: sourceDate, moved_to_date: null };
  return {
    ok: true,
    value: { source_date: sourceDate, target_date: targetDate },
    base: { training_version: state.training_version, source, target },
    preview: {
      operation: "move",
      source_date: sourceDate,
      target_date: targetDate,
      before: { source, target },
      after: { source: afterSource, target: afterTarget },
      affected_dates: [sourceDate, targetDate],
    },
  };
}

/** @param {any} state @param {{source_date:string,target_date:string}} move @param {Date} now */
export async function plannedDayMoveDigests(state, move, now = new Date()) {
  const validation = validatePlannedDayMove(state, move, now);
  if (!validation.ok) return validation;
  return {
    ...validation,
    move_digest: await sha256Hex(canonicalJson(validation.value)),
    base_plan_digest: await sha256Hex(canonicalJson({ owner: state.athlete_key, base_plan: validation.base })),
  };
}

/** @param {any} state @param {{source_date:string,target_date:string}} move @param {Date} now */
export function applyPlannedDayMove(state, move, now = new Date()) {
  const validation = validatePlannedDayMove(state, move, now);
  if (!validation.ok) return validation;
  initializePlannedDays(state);
  const sourceIndex = state.planned_days.findIndex((/** @type {any} */ day) => day.date === move.source_date);
  const targetIndex = state.planned_days.findIndex((/** @type {any} */ day) => day.date === move.target_date);
  const source = state.planned_days[sourceIndex];
  const target = state.planned_days[targetIndex] ?? {
    date: move.target_date,
    kind: "no_plan",
    prescription_revision_key: null,
    prescription_weekday: null,
    version: 0,
  };
  const changeKey = opaqueKey("plan_change");
  const movedSource = {
    ...deepClone(target),
    date: move.source_date,
    change_key: changeKey,
    version: (source?.version ?? 0) + 1,
    moved_from_date: null,
    moved_to_date: move.target_date,
  };
  const movedTarget = {
    ...deepClone(source),
    date: move.target_date,
    change_key: changeKey,
    version: (target?.version ?? 0) + 1,
    moved_from_date: move.source_date,
    moved_to_date: null,
  };
  if (sourceIndex === -1) upsertPlannedDay(state, movedSource); else state.planned_days[sourceIndex] = movedSource;
  if (targetIndex === -1) upsertPlannedDay(state, movedTarget); else state.planned_days[targetIndex] = movedTarget;
  state.planned_days.sort((/** @type {any} */ left, /** @type {any} */ right) => left.date.localeCompare(right.date));
  const change = {
    change_key: changeKey,
    change_sequence: nextChangeSequence(state),
    change_type: "day_move",
    created_at: now.toISOString(),
    source_date: move.source_date,
    target_date: move.target_date,
  };
  state.plan_changes.push(change);
  state.training_version += 1;
  return { ok: true, change, preview: validation.preview };
}
