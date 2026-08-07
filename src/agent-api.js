// @ts-nocheck

import { WEEKDAYS, canonicalJson, deepClone, dateRange, dateSpan, isValidLocalDate, localDate } from "./util.js";
import { scheduleEntry } from "./plan.js";
import { coachOverview, prescriptionProjection } from "./coach.js";

const AGENT_PREFIX = "/api/agent/v1";

/** @param {any} state @param {Date} now */
export function agentManifest(state, now) {
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    athlete: { display_name: state.display_name, timezone: state.timezone },
    timezone: state.timezone,
    unit_conventions: { resistance: "kg_per_implement", incline: "percent" },
    updated_at: {
      plan: state.plan_revisions.at(-1)?.created_at ?? null,
      training: state.sessions.at(-1)?.updated_at ?? null,
    },
    training_version: state.training_version,
    query_rules: {
      timezone: state.timezone,
      date_format: "YYYY-MM-DD",
      date_ranges_inclusive: true,
      overview: { default_period: "30d", selectors: ["preset", "range"], values: ["7d", "30d", "12w", "all"], from_to_must_be_together: true, preset_range_mutually_exclusive: true, from_to_conflicts_with_selector: true, max_days: 3660 },
      schedule_range_required: true,
      max_days: { schedule: 366 },
    },
    links: {
      overview: `${AGENT_PREFIX}/overview`,
      plan: `${AGENT_PREFIX}/plan`,
      schedule: `${AGENT_PREFIX}/schedule`,
    },
    endpoints: {
      overview: { method: "GET", path: `${AGENT_PREFIX}/overview`, parameters: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", preset: ["7d", "30d", "12w", "all"], range: ["7d", "30d", "12w", "all"] } },
      plan: { method: "GET", path: `${AGENT_PREFIX}/plan`, parameters: {} },
      schedule: { method: "GET", path: `${AGENT_PREFIX}/schedule`, parameters: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", expand: ["prescription"] }, rules: { from_to_required: true, max_days: 366 } },
    },
  };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function agentOverview(state, url, now) {
  return { ...coachOverview(state, url, now), source_ref: "overview" };
}

/** @param {any} state @param {Date} now */
export function agentPlan(state, now) {
  const today = localDate(now, state.timezone);
  const current = state.plan_revisions.filter((revision) => revision.effective_from <= today).sort((left, right) => right.revision_sequence - left.revision_sequence)[0] ?? null;
  const future = state.plan_revisions
    .filter((revision) => revision.effective_from > today && state.plan_revisions.filter((candidate) => candidate.effective_from <= revision.effective_from).sort((left, right) => right.revision_sequence - left.revision_sequence)[0]?.revision_key === revision.revision_key)
    .sort((left, right) => left.effective_from.localeCompare(right.effective_from));
  const firstEffective = state.plan_revisions.slice().sort((left, right) => left.effective_from.localeCompare(right.effective_from))[0]?.effective_from ?? null;
  const project = (revision) => ({ effective_from: revision.effective_from, week: Object.fromEntries(WEEKDAYS.map((day) => { const slot = revision.week[day] ?? null; return [day, slot?.kind === "workout" ? { kind: "workout", prescription: prescriptionProjection(slot, `plan:${revision.effective_from}:${day}`, safePrescriptionKeys(`agent_plan_${revision.effective_from}_${day}`)) } : deepClone(slot)]; })) });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    timezone: state.timezone,
    training_version: state.training_version,
    source_ref: "plan",
    current: current ? { ...project(current), source_ref: "plan:current" } : null,
    future: future.map((revision) => ({ ...project(revision), source_ref: `plan:future:${revision.effective_from}` })),
    next_effective_from: future[0]?.effective_from ?? null,
    first_effective_from: firstEffective,
    pending_count: future.length,
  };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function agentSchedule(state, url, now) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const span = from && to ? dateSpan(from, to) : null;
  if (!from || !to || !isValidLocalDate(from) || !isValidLocalDate(to) || from > to || span === null || span > 366) {
    return { error: { code: "invalid_period", field: !from ? "from" : !to ? "to" : "to", message: "Schedule requires an inclusive from/to range of at most 366 days" } };
  }
  const expandValue = url.searchParams.get("expand");
  if (url.searchParams.has("expand") && expandValue !== "prescription") return { error: { code: "invalid_request", field: "expand", message: "expand must be prescription" } };
  const expand = expandValue === "prescription";
  const prescriptions = {};
  const entries = dateRange(from, to).map((date) => {
    const raw = scheduleEntry(state, date, now, true);
    const prescriptionRef = raw.kind === "workout" ? stablePrescriptionRef(raw.prescription, raw.weekday) : null;
    if (expand && prescriptionRef && raw.prescription) prescriptions[prescriptionRef] = prescriptionProjection(raw.prescription, prescriptionRef, safePrescriptionKeys(`agent_schedule_${raw.weekday}_${stableFingerprint(raw.prescription)}`));
    return {
      date: raw.date,
      weekday: raw.weekday,
      kind: raw.kind,
      title: raw.title,
      module_count: raw.module_count,
      estimated_duration_min: raw.estimated_duration_min,
      prescription_ref: prescriptionRef,
      session_key: raw.session_key,
      is_due: raw.is_due,
      is_overdue_unstarted: raw.is_overdue_unstarted,
      source_ref: `schedule:${date}:${raw.kind}`,
    };
  });
  const currentDate = localDate(now, state.timezone);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    from,
    to,
    timezone: state.timezone,
    period: { from, to, timezone: state.timezone, includes_from: true, includes_to: true, includes_current_date: from <= currentDate && currentDate <= to, current_date_may_be_incomplete: from <= currentDate && currentDate <= to },
    training_version: state.training_version,
    entries,
    prescriptions,
  };
}

/** @param {any} slot @param {string} weekday */
function stablePrescriptionRef(slot, weekday) { return `prescription:${weekday}:${stableFingerprint(slot)}`; }

/** @param {any} value */
function stableFingerprint(value) {
  let hash = 2166136261;
  for (const character of canonicalJson(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** @param {any} state @param {string} pathname @param {URL} url @param {Date} now */
export function agentResource(state, pathname, url, now) {
  if (pathname === `${AGENT_PREFIX}/overview`) return agentOverview(state, url, now);
  if (pathname === `${AGENT_PREFIX}/plan`) return agentPlan(state, now);
  if (pathname === `${AGENT_PREFIX}/schedule`) return agentSchedule(state, url, now);
  return { error: { code: "not_found", message: "Resource not found" } };
}

/** @param {string} pathname @param {URL} url */
export function agentQueryError(pathname, url) {
  const allowed = pathname === AGENT_PREFIX ? [] : pathname === `${AGENT_PREFIX}/overview` ? ["from", "to", "preset", "range"] : pathname === `${AGENT_PREFIX}/plan` ? [] : pathname === `${AGENT_PREFIX}/schedule` ? ["from", "to", "expand"] : [];
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) return { code: "invalid_request", field: key, message: `Unsupported query parameter: ${key}` };
    if (seen.has(key)) return { code: "invalid_request", field: key, message: `Query parameter may only be provided once: ${key}` };
    seen.add(key);
  }
  return null;
}

/** @param {string} prefix */
function safePrescriptionKeys(prefix) {
  return {
    block: (blockIndex) => `${prefix}_b${blockIndex + 1}`,
    exercise: (blockIndex, exerciseIndex) => `${prefix}_e${blockIndex + 1}_${exerciseIndex + 1}`,
    set: (blockIndex, exerciseIndex, setIndex) => `${prefix}_s${blockIndex + 1}_${exerciseIndex + 1}_${setIndex + 1}`,
  };
}
