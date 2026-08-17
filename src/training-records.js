// @ts-nocheck

import { addDays, dateRange, dateSpan, isValidLocalDate, localDate } from "./util.js";
import { scheduleEntry } from "./plan.js";
import { SOURCE_STATUSES, containsSensitiveText, normalizeTimezone, safeAerobicActivity } from "./training-archive.js";
import { routeLink } from "./route-registry.js";

export const RECORD_SCHEMA_VERSION = 1;
export const DAILY_HUB_KIND = "daily-hub";
export const WORKOUT_SESSION_KIND = "workout-session";
export const WORKOUT_TABLE_KIND = "workout-table";

const WORKOUT_SESSION_STATUSES = Object.freeze(["in_progress", "completed", "partial", "skipped"]);

/** @param {unknown} value @returns {string|null} */
function stringOrNull(value) {
  if (typeof value !== "string" || !value.trim() || containsSensitiveText(value)) return null;
  return value.trim();
}

/** @param {unknown} value @returns {number|null} */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value @returns {string|null} */
function instantOrNull(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** @param {unknown} value @param {string} field @returns {string} */
function requiredReference(value, field) {
  const reference = stringOrNull(value);
  if (!reference || reference.includes("/") || reference.includes("\\")) throw new Error(`${field} must be a safe reference`);
  return reference;
}

/** @param {unknown} value @param {string} field @returns {string} */
function requiredLocalDate(value, field) {
  if (typeof value !== "string" || !isValidLocalDate(value)) throw new Error(`${field} must be a valid local date`);
  return value;
}

/** @param {unknown} value @param {string} field @returns {string} */
function sourceStatus(value, field = "source_status") {
  const status = value ?? "complete";
  if (!SOURCE_STATUSES.includes(status)) throw new Error(`${field} must be a supported source status`);
  return status;
}

/** @param {unknown} value @returns {number|null} */
function boundedFraction(value) {
  if (value === null || value === undefined) return null;
  const number = numberOrNull(value);
  if (number === null || number < 0 || number > 1) throw new Error("completion_fraction must be between 0 and 1");
  return number;
}

/**
 * Normalize the source Workout Session into the Obsidian record Properties
 * contract. It intentionally has no COROS fields: a same-date aerobic record
 * is contextual, not an inferred relation.
 *
 * @param {Record<string, any>} session
 * @param {{ timezone: string, dataAsOf?: string|null, sourceStatus?: string }} context
 */
export function normalizeWorkoutSessionRecord(session, context = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) throw new Error("Workout Session must be an object");
  const sessionKey = requiredReference(session.session_key ?? session.sessionKey, "session_key");
  const localDateValue = requiredLocalDate(session.scheduled_date ?? session.local_date, "scheduled_date");
  const status = session.status;
  if (!WORKOUT_SESSION_STATUSES.includes(status)) throw new Error("status must be a supported Workout Session status");
  const timezone = normalizeTimezone(context.timezone ?? session.timezone_at_session ?? session.timezone ?? "UTC");
  const sourceRef = requiredReference(session.source_ref ?? session.sourceRef ?? `session:${localDateValue}:${sessionKey}`, "source_ref");
  const updatedAt = instantOrNull(session.updated_at ?? session.updatedAt);
  const dataAsOf = instantOrNull(context.dataAsOf ?? session.data_as_of ?? session.dataAsOf) ?? updatedAt;
  const title = stringOrNull(session.title) ?? "Workout Session";
  const completionFraction = boundedFraction(session.completion_fraction ?? session.completionFraction);
  const duration = numberOrNull(session.training_duration_sec ?? session.trainingDurationSec);
  if (duration !== null && duration < 0) throw new Error("training_duration_sec must be non-negative");
  const rpe = numberOrNull(session.session_rpe ?? session.sessionRpe);
  if (rpe !== null && (rpe < 0 || rpe > 10)) throw new Error("session_rpe must be between 0 and 10");
  return {
    kind: WORKOUT_SESSION_KIND,
    schema_version: RECORD_SCHEMA_VERSION,
    source: "workout",
    source_id: sessionKey,
    source_ref: sourceRef,
    session_key: sessionKey,
    local_date: localDateValue,
    timezone,
    source_status: sourceStatus(context.sourceStatus ?? session.source_status ?? session.sourceStatus),
    data_as_of: dataAsOf,
    updated_at: updatedAt ?? dataAsOf,
    title,
    properties: {
      kind: WORKOUT_SESSION_KIND,
      schema_version: RECORD_SCHEMA_VERSION,
      source: "workout",
      source_id: sessionKey,
      source_ref: sourceRef,
      local_date: localDateValue,
      timezone,
      source_status: sourceStatus(context.sourceStatus ?? session.source_status ?? session.sourceStatus),
      data_as_of: dataAsOf,
      updated_at: updatedAt ?? dataAsOf,
      title,
      status,
      completion_fraction: completionFraction,
      training_duration_sec: duration,
      session_rpe: rpe,
    },
    links: {
      daily_hub: `[[daily/${localDateValue}]]`,
    },
  };
}

/** @param {string} activityRef @param {string} date */
export function corosActivityPath(activityRef, date) {
  return `data/coros/${date}-${fileComponent(requiredReference(activityRef, "activity_ref"))}`;
}

/** @param {string} value */
export function fileComponent(value) {
  return encodeURIComponent(value).replaceAll("%", "_");
}

/** @param {unknown[]} values @returns {number|null} */
function completeSum(values) {
  if (!values.length || values.some((value) => numberOrNull(value) === null)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

/** @param {any[]} activities @returns {string} */
function aggregateActivityStatus(activities) {
  if (!activities.length) return "none";
  if (activities.some((activity) => activity.source_status === "error")) return "error";
  if (activities.some((activity) => activity.source_status === "partial")) return "partial";
  return "complete";
}

/** @param {any[]} activities @returns {string|null} */
function latestDataAsOf(activities) {
  const values = activities.map((activity) => activity.data_as_of).filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return values.length ? values.sort().at(-1) : null;
}

/**
 * Compact date-level aerobic read model used by Calendar. It has no activity
 * rows and never carries a Workout Session reference.
 *
 * @param {any} state
 * @param {string} date
 * @param {Date} now
 */
export function compactAerobicSummary(state, date, now = new Date()) {
  requiredLocalDate(date, "date");
  const activities = (state.aerobic_activities ?? []).map(safeAerobicActivity).filter((activity) => activity.local_date === date);
  return {
    schema_version: RECORD_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    local_date: date,
    source: "coros",
    source_status: aggregateActivityStatus(activities),
    data_as_of: latestDataAsOf(activities),
    activity_count: activities.length,
    distance_km: completeSum(activities.map((activity) => activity.summary?.distance_km)),
    duration_sec: completeSum(activities.map((activity) => activity.summary?.duration_sec)),
    records_href: `/app#records-aerobic-${date}`,
  };
}

/**
 * Build the date Hub. The two source lists are deliberately separate in both
 * machine refs and links; there is no paired event or cross-source join.
 *
 * @param {{ targetDate: string, timezone: string, now?: Date, workout?: any, coros?: any, activities?: any[] }} input
 */
export function dailyHubModel(input) {
  const targetDate = requiredLocalDate(input.targetDate, "targetDate");
  const timezone = normalizeTimezone(input.timezone);
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  const workout = input.workout ?? { source_status: "none", data_as_of: null, sessions: [] };
  const coros = input.coros ?? { source_status: "none", data_as_of: null };
  const errors = Array.isArray(input.errors) ? input.errors.filter((error) => error && typeof error.message === "string") : [];
  const sessions = (workout.sessions ?? [])
    .map((session) => normalizeWorkoutSessionRecord(session, { timezone, dataAsOf: workout.data_as_of, sourceStatus: workout.source_status }))
    .filter((session) => session.local_date === targetDate);
  const activities = (input.activities ?? []).map(safeAerobicActivity).filter((activity) => activity.local_date === targetDate);
  const workoutLinks = sessions.map((record) => record.links.daily_hub.replace(`[[daily/${targetDate}]]`, `[[workout/sessions/${record.session_key}]]`));
  const aerobicLinks = activities.map((activity) => `[[${corosActivityPath(activity.activity_ref, targetDate)}]]`);
  const workoutStatus = sourceStatus(workout.source_status ?? "none", "workout.source_status");
  const corosStatus = sourceStatus(coros.source_status ?? aggregateActivityStatus(activities), "coros.source_status");
  const durationValues = sessions.map((record) => record.properties.training_duration_sec);
  return {
    kind: DAILY_HUB_KIND,
    schema_version: RECORD_SCHEMA_VERSION,
    local_date: targetDate,
    timezone,
    captured_at: now.toISOString(),
    updated_at: now.toISOString(),
    source_status: { workout: workoutStatus, coros: corosStatus },
    data_as_of: { workout: instantOrNull(workout.data_as_of), coros: instantOrNull(coros.data_as_of) },
    relation_policy: "same_local_date_context_only",
    machine_refs: {
      workout_session_keys: sessions.map((record) => record.session_key),
      activity_refs: activities.map((activity) => activity.activity_ref),
      route_keys: [...new Set(activities.map((activity) => activity.route_key).filter(Boolean))],
    },
    links: {
      workout_sessions: sessions.map((record) => `[[workout/sessions/${record.session_key}]]`),
      coros_activities: aerobicLinks,
      routes: [...new Set(activities.map((activity) => routeLink(activity.route_key)).filter(Boolean))],
    },
    summary: {
      workout: {
        session_count: sessions.length,
        statuses: sessions.map((record) => record.properties.status),
        duration_sec: completeSum(durationValues),
      },
      coros: {
        activity_count: activities.length,
        distance_km: completeSum(activities.map((activity) => activity.summary?.distance_km)),
        duration_sec: completeSum(activities.map((activity) => activity.summary?.duration_sec)),
        source_status: corosStatus,
      },
    },
    errors,
    properties: {
      kind: DAILY_HUB_KIND,
      schema_version: RECORD_SCHEMA_VERSION,
      local_date: targetDate,
      timezone,
      source_status_workout: workoutStatus,
      source_status_coros: corosStatus,
      data_as_of_workout: instantOrNull(workout.data_as_of),
      data_as_of_coros: instantOrNull(coros.data_as_of),
      workout_sessions: sessions.map((record) => `[[workout/sessions/${record.session_key}]]`),
      coros_activities: aerobicLinks,
      routes: [...new Set(activities.map((activity) => routeLink(activity.route_key)).filter(Boolean))],
      relation_policy: "same_local_date_context_only",
    },
  };
}

/** @param {any} state @param {string|undefined} from @param {string|undefined} to @param {Date} now */
export function workoutTableModel(state, from, to, now = new Date()) {
  const today = localDate(now, state.timezone);
  const start = from ?? addDays(today, -29);
  const end = to ?? today;
  if (!isValidLocalDate(start) || !isValidLocalDate(end) || start > end || (dateSpan(start, end) ?? Infinity) > 3660) throw new Error("Workout table period is invalid");
  const rows = (state.sessions ?? [])
    .filter((session) => session.scheduled_date >= start && session.scheduled_date <= end)
    .map((session) => normalizeWorkoutSessionRecord(session, { timezone: state.timezone }))
    .sort((left, right) => right.local_date.localeCompare(left.local_date) || right.session_key.localeCompare(left.session_key));
  return {
    kind: WORKOUT_TABLE_KIND,
    schema_version: RECORD_SCHEMA_VERSION,
    source: "workout",
    derived_from: "workout-session-properties",
    generated_at: now.toISOString(),
    period: { from: start, to: end, timezone: normalizeTimezone(state.timezone) },
    columns: ["local_date", "status", "title", "completion_fraction", "training_duration_sec", "source_status", "links"],
    rows: rows.map((record) => ({
      ...record,
      links: { ...record.links, daily_hub: `[[daily/${record.local_date}]]`, record: `[[workout/sessions/${record.session_key}]]` },
    })),
  };
}

/** @param {any} state @param {string|undefined} from @param {string|undefined} to @param {Date} now */
export function recordsOverviewModel(state, from, to, now = new Date()) {
  const today = localDate(now, state.timezone);
  const start = from ?? addDays(today, -29);
  const end = to ?? today;
  if (!isValidLocalDate(start) || !isValidLocalDate(end) || start > end || (dateSpan(start, end) ?? Infinity) > 3660) return { error: { code: "invalid_period", message: "from and to must be valid inclusive local dates within 3660 days" } };
  const dates = dateRange(start, end);
  const activities = (state.aerobic_activities ?? []).map(safeAerobicActivity);
  const sessionRows = (state.sessions ?? []).map((session) => normalizeWorkoutSessionRecord(session, { timezone: state.timezone }));
  const rangedSessions = sessionRows.filter((session) => session.local_date >= start && session.local_date <= end);
  const days = dates.map((date) => {
    const entry = scheduleEntry(state, date, now, false);
    const sessions = rangedSessions.filter((session) => session.local_date === date);
    const dayActivities = activities.filter((activity) => activity.local_date === date);
    return {
      local_date: date,
      schedule_kind: entry.kind,
      workout_session_count: sessions.length,
      workout_session_keys: sessions.map((session) => session.session_key),
      aerobic_activity_count: dayActivities.length,
      activity_refs: dayActivities.map((activity) => activity.activity_ref),
      aerobic_summary: compactAerobicSummary(state, date, now),
      relation_policy: "same_local_date_context_only",
    };
  });
  const projection = state.aerobic_projection ?? {};
  const status = projection.source_statuses?.coros ?? projection.source_status ?? (activities.length ? "complete" : "none");
  return {
    schema_version: RECORD_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    period: { from: start, to: end, timezone: normalizeTimezone(state.timezone) },
    source_statuses: {
      workout: rangedSessions.length ? "complete" : "none",
      coros: sourceStatus(status, "aerobic_projection.source_status"),
    },
    relation_policy: "same_local_date_context_only",
    workout: { source: "workout", session_count: rangedSessions.length, table: workoutTableModel(state, start, end, now) },
    aerobic: { source: "coros", activity_count: activities.filter((activity) => activity.local_date >= start && activity.local_date <= end).length, source_status: sourceStatus(status) },
    days,
  };
}

/** @param {any} hub */
export function dailyHubNote(hub) {
  const workoutLinks = hub.links.workout_sessions;
  const aerobicLinks = hub.links.coros_activities;
  const workoutKeys = hub.machine_refs.workout_session_keys;
  const activityRefs = hub.machine_refs.activity_refs;
  const routeKeys = hub.machine_refs.route_keys ?? [];
  const routeLinks = hub.links.routes ?? [];
  const distance = hub.summary.coros.distance_km;
  const duration = hub.summary.coros.duration_sec;
  return [
    "---",
    `kind: ${DAILY_HUB_KIND}`,
    "legacy_kind: training-day",
    `schema_version: ${RECORD_SCHEMA_VERSION}`,
    `date: ${hub.local_date}`,
    `local_date: ${hub.local_date}`,
    `timezone: ${JSON.stringify(hub.timezone)}`,
    `captured_at: ${JSON.stringify(hub.captured_at)}`,
    `updated_at: ${JSON.stringify(hub.updated_at)}`,
    "source_status:",
    `  workout: ${JSON.stringify(hub.source_status.workout)}`,
    `  coros: ${JSON.stringify(hub.source_status.coros)}`,
    "data_as_of:",
    `  workout: ${JSON.stringify(hub.data_as_of.workout)}`,
    `  coros: ${JSON.stringify(hub.data_as_of.coros)}`,
    `relation_policy: ${hub.relation_policy}`,
    "workout_session_keys:",
    listYaml(workoutKeys),
    "workout_sessions:",
    listYaml(workoutLinks),
    "coros_activity_refs:",
    listYaml(activityRefs),
    "coros_activities:",
    listYaml(aerobicLinks),
    "route_keys:",
    listYaml(routeKeys),
    "routes:",
    listYaml(routeLinks),
    "---",
    "",
    "## 无氧训练",
    workoutLinks.length ? workoutLinks.map((link, index) => `- Workout Session：${workoutKeys[index]}`).join("\n") : "- 暂无 Workout Session 归档。",
    "",
    "## 有氧训练",
    aerobicLinks.length ? aerobicLinks.map((link, index) => `- COROS Activity：${activityRefs[index]}`).join("\n") : "- 暂无 COROS aerobic activity。",
    "",
    "## 路线",
    routeLinks.length ? routeLinks.map((link, index) => `- Route：${routeKeys[index] ?? link}`).join("\n") : "- 暂无已确认路线。",
    "",
    "## 当日汇总",
    `- Workout Session：${hub.summary.workout.session_count} 次 · ${hub.summary.workout.duration_sec == null ? "—" : `${hub.summary.workout.duration_sec} 秒`}`,
    `- COROS 有氧：${hub.summary.coros.activity_count} 次 · ${distance == null ? "—" : `${distance} km`} · ${duration == null ? "—" : `${duration} 秒`}`,
    "",
    "## 限制与待补",
    hub.errors.length ? hub.errors.map((error) => `- ${error.source ?? "source"}: ${error.message}`).join("\n") : (hub.source_status.workout === "error" || hub.source_status.coros === "error" ? "- source 读取失败；缺失事实保持 null，等待下一次 sync data。" : "- 同一 local date 仅提供上下文链接，不表示两类训练属于同一事件。"),
    "",
  ].join("\n");
}

/** @param {any} record */
export function workoutSessionNote(record) {
  return [
    "---",
    `kind: ${WORKOUT_SESSION_KIND}`,
    `schema_version: ${RECORD_SCHEMA_VERSION}`,
    "source: workout",
    `source_id: ${JSON.stringify(record.source_id)}`,
    `source_ref: ${JSON.stringify(record.source_ref)}`,
    `session_key: ${JSON.stringify(record.session_key)}`,
    `local_date: ${record.local_date}`,
    `timezone: ${JSON.stringify(record.timezone)}`,
    `source_status: ${JSON.stringify(record.source_status)}`,
    `data_as_of: ${JSON.stringify(record.data_as_of)}`,
    `updated_at: ${JSON.stringify(record.updated_at)}`,
    `title: ${JSON.stringify(record.properties.title)}`,
    `status: ${record.properties.status}`,
    `completion_fraction: ${record.properties.completion_fraction ?? "null"}`,
    `training_duration_sec: ${record.properties.training_duration_sec ?? "null"}`,
    `session_rpe: ${record.properties.session_rpe ?? "null"}`,
    `daily_hub: ${record.links.daily_hub}`,
    "---",
    "",
    "## Workout Session",
    `- 日期：${record.local_date}`,
    `- 状态：${record.properties.status}`,
    `- 完成率：${record.properties.completion_fraction == null ? "—" : record.properties.completion_fraction}`,
    `- 训练时长：${record.properties.training_duration_sec == null ? "—" : `${record.properties.training_duration_sec} 秒`}`,
    `- 来源：${record.source_ref}`,
    "",
    "此记录是 Workout authoritative Session 的本地只读投影；不要在此处改写计划或执行结果。",
    "",
  ].join("\n");
}

export function workoutIndexNote() {
  return [
    "---",
    `kind: ${WORKOUT_TABLE_KIND}`,
    `schema_version: ${RECORD_SCHEMA_VERSION}`,
    "source: workout",
    "view_type: derived",
    "derived_from: workout-session-properties",
    "---",
    "",
    "# Workout Sessions",
    "",
    "此表由 Workout Session 记录的 Obsidian Properties 派生，不是第二份手工事实表。",
    "",
    "```dataview",
    "TABLE local_date AS 日期, status AS 状态, title AS 训练, completion_fraction AS 完成率, training_duration_sec AS 时长, source_status AS 来源状态, file.link AS 记录",
    'FROM "workout/sessions"',
    'WHERE kind = "workout-session"',
    "SORT local_date DESC",
    "```",
    "",
  ].join("\n");
}

/** @param {any[]} values */
function listYaml(values) {
  return values.length ? values.map((value) => `  - ${typeof value === "string" && value.startsWith("[[") ? value : JSON.stringify(value)}`).join("\n") : "  []";
}
