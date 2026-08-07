// @ts-nocheck

import { deepClone, dateRange, dateSpan, isValidLocalDate, localDate } from "./util.js";
import { planModel, scheduleEntry } from "./plan.js";
import { coachOverview, coachPrescription } from "./coach.js";

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
  const plan = planModel(state, now);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    timezone: state.timezone,
    training_version: state.training_version,
    source_ref: "plan",
    current: plan.current ? { ...plan.current, source_ref: "plan:current" } : null,
    future: plan.future.map((revision) => ({ ...revision, source_ref: `plan:future:${revision.effective_from}` })),
    next_effective_from: plan.next_effective_from,
    first_effective_from: plan.first_effective_from,
    pending_count: plan.pending_count,
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
  if (expandValue && expandValue !== "prescription") return { error: { code: "invalid_request", field: "expand", message: "expand must be prescription" } };
  const expand = expandValue === "prescription";
  const prescriptions = {};
  const entries = dateRange(from, to).map((date) => {
    const raw = scheduleEntry(state, date, now, expand);
    const prescriptionRef = raw.prescription_ref;
    if (expand && prescriptionRef && raw.prescription) prescriptions[prescriptionRef] = coachPrescription(raw.prescription, raw.revision_key, raw.weekday);
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

/** @param {any} state @param {string} pathname @param {URL} url @param {Date} now */
export function agentResource(state, pathname, url, now) {
  if (pathname === `${AGENT_PREFIX}/overview`) return agentOverview(state, url, now);
  if (pathname === `${AGENT_PREFIX}/plan`) return agentPlan(state, now);
  if (pathname === `${AGENT_PREFIX}/schedule`) return agentSchedule(state, url, now);
  return { error: { code: "not_found", message: "Resource not found" } };
}
