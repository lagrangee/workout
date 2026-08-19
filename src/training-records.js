// @ts-nocheck

import { addDays, dateRange, dateSpan, isValidLocalDate, localDate } from "./util.js";
import { scheduleEntry } from "./plan.js";
import { SOURCE_STATUSES, containsSensitiveText, normalizeTimezone, safeAerobicActivity } from "./training-archive.js";
import { routeLink } from "./route-registry.js";

export const RECORD_SCHEMA_VERSION = 1;
export const DAILY_HUB_KIND = "daily-hub";
export const WORKOUT_SESSION_KIND = "workout-session";
export const WORKOUT_TABLE_KIND = "workout-table";

const WORKOUT_SESSION_STATUSES = Object.freeze(["planned", "in_progress", "completed", "partial", "abandoned", "skipped"]);

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

const WORKOUT_DETAIL_ALIASES = Object.freeze({
  schema_version: ["schema_version", "record_schema_version", "session_schema_version"],
  plan_id: ["plan_id", "planId"],
  plan_revision_key: ["plan_revision_key", "planRevisionKey"],
  scheduled_workout_key: ["scheduled_workout_key", "scheduledWorkoutKey"],
  snapshot: ["snapshot", "plan_snapshot", "planSnapshot"],
  completion_items: ["completion_items", "completionItems"],
  completion_results: ["completion_results", "completionResults"],
  set_results: ["set_results", "setResults"],
  training_intervals: ["training_intervals", "trainingIntervals", "intervals"],
  exercise_feedback: ["exercise_feedback", "exerciseFeedback", "feedback"],
  actual_training_data: ["actual_training_data", "actualTrainingData", "actual_training", "actualTraining"],
  training_version: ["training_version", "trainingVersion"],
  session_rpe: ["session_rpe", "sessionRpe"],
  note: ["note", "notes"],
  skip_reason: ["skip_reason", "skipReason"],
});

/**
 * Keep the useful, non-sensitive part of a Workout detail response. This is
 * intentionally an allow-list of known detail sections rather than a raw
 * source payload copy.
 * @param {unknown} value
 * @param {number} depth
 * @returns {any}
 */
function safeWorkoutDetailValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return containsSensitiveText(value) ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 10) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 1000).map((item) => safeWorkoutDetailValue(item, depth + 1));
  }
  if (typeof value !== "object") return null;
  const entries = Object.entries(value)
    .filter(([key]) => !/(?:token|credential|password|secret|gps|telemetry|sensor|raw[_ -]?fit)/i.test(key))
    .slice(0, 500)
    .map(([key, child]) => [key, safeWorkoutDetailValue(child, depth + 1)]);
  return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * Normalize the detail sections returned by Workout Session reads for the
 * private local JSON sidecar and the human-readable note.
 * @param {Record<string, any>} session
 * @returns {Record<string, any>}
 */
export function normalizeWorkoutSessionDetails(session) {
  const nested = session?.details && typeof session.details === "object" && !Array.isArray(session.details) ? session.details : {};
  const details = {};
  for (const [canonical, aliases] of Object.entries(WORKOUT_DETAIL_ALIASES)) {
    const candidate = aliases.map((alias) => session?.[alias] ?? nested?.[alias]).find((value) => value !== undefined);
    if (candidate === undefined) continue;
    const safe = safeWorkoutDetailValue(candidate);
    if (safe !== null) details[canonical] = safe;
  }
  return details;
}

/** @param {string} localDateValue @param {string} sessionKey */
export function workoutSessionRelativePath(localDateValue, sessionKey) {
  const date = requiredLocalDate(localDateValue, "local_date");
  return `workout/sessions/${date}--${fileComponent(requiredReference(sessionKey, "session_key"))}`;
}

/** @param {string} localDateValue @param {string} sessionKey */
export function workoutSessionDataPath(localDateValue, sessionKey) {
  const date = requiredLocalDate(localDateValue, "local_date");
  return `data/workout/${date}--${fileComponent(requiredReference(sessionKey, "session_key"))}`;
}

/** @param {string} value */
function yamlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

/**
 * Normalize the source Workout Session into the Obsidian record Properties
 * contract. It intentionally has no COROS fields: a same-date aerobic record
 * is contextual, not an inferred relation.
 *
 * @param {Record<string, any>} session
 * @param {{ timezone: string, dataAsOf?: string|null, sourceStatus?: string, includeDetails?: boolean }} context
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
  const details = context.includeDetails === true ? normalizeWorkoutSessionDetails(session) : {};
  const canonicalSnapshot = details.snapshot?.schema_version === 2 ? details.snapshot : null;
  const exerciseIds = canonicalSnapshot
    ? [...new Set(canonicalSnapshot.blocks?.flatMap((block) => block.exercises?.map((exercise) => exercise.exercise_id).filter(Boolean)) ?? [])]
    : [];
  const planId = session.plan_id ?? session.planId ?? details.plan_id ?? null;
  const planRevisionKey = session.plan_revision_key ?? session.planRevisionKey ?? details.plan_revision_key ?? null;
  const scheduledWorkoutKey = session.scheduled_workout_key ?? session.scheduledWorkoutKey ?? details.scheduled_workout_key ?? null;
  const completionFraction = boundedFraction(session.completion_fraction ?? session.completionFraction);
  const duration = numberOrNull(session.training_duration_sec ?? session.trainingDurationSec);
  if (duration !== null && duration < 0) throw new Error("training_duration_sec must be non-negative");
  const rpe = numberOrNull(session.session_rpe ?? session.sessionRpe);
  if (rpe !== null && (rpe < 0 || rpe > 10)) throw new Error("session_rpe must be between 0 and 10");
  const normalizedSourceStatus = sourceStatus(context.sourceStatus ?? session.source_status ?? session.sourceStatus);
  const record = {
    kind: WORKOUT_SESSION_KIND,
    schema_version: RECORD_SCHEMA_VERSION,
    source: "workout",
    source_id: sessionKey,
    source_ref: sourceRef,
    session_key: sessionKey,
    local_date: localDateValue,
    timezone,
    source_status: normalizedSourceStatus,
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
      source_status: normalizedSourceStatus,
      data_as_of: dataAsOf,
      updated_at: updatedAt ?? dataAsOf,
      title,
      scheduled_workout_key: scheduledWorkoutKey,
      plan_id: planId,
      plan_revision_key: planRevisionKey,
      exercise_ids: exerciseIds,
      status,
      completion_fraction: completionFraction,
      training_duration_sec: duration,
      session_rpe: rpe,
    },
    links: {
      daily_hub: `[[daily/${localDateValue}]]`,
    },
  };
  if (Object.keys(details).length > 0) record.details = details;
  return record;
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
  const workoutLinks = sessions.map((record) => `[[${workoutSessionRelativePath(record.local_date, record.session_key)}]]`);
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
      workout_sessions: sessions.map((record) => `[[${workoutSessionRelativePath(record.local_date, record.session_key)}]]`),
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
      workout_sessions: sessions.map((record) => `[[${workoutSessionRelativePath(record.local_date, record.session_key)}]]`),
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
      links: { ...record.links, daily_hub: `[[daily/${record.local_date}]]`, record: `[[${workoutSessionRelativePath(record.local_date, record.session_key)}]]` },
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
    `local_date: ${yamlValue(hub.local_date)}`,
    `timezone: ${yamlValue(hub.timezone)}`,
    `captured_at: ${yamlValue(hub.captured_at)}`,
    `updated_at: ${yamlValue(hub.updated_at)}`,
    `source_status_workout: ${yamlValue(hub.source_status.workout)}`,
    `source_status_coros: ${yamlValue(hub.source_status.coros)}`,
    `data_as_of_workout: ${yamlValue(hub.data_as_of.workout)}`,
    `data_as_of_coros: ${yamlValue(hub.data_as_of.coros)}`,
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
  const detailSections = renderWorkoutDetailSections(record.details);
  return [
    "---",
    `kind: ${WORKOUT_SESSION_KIND}`,
    `schema_version: ${RECORD_SCHEMA_VERSION}`,
    "source: workout",
    `source_id: ${JSON.stringify(record.source_id)}`,
    `source_ref: ${JSON.stringify(record.source_ref)}`,
    `session_key: ${JSON.stringify(record.session_key)}`,
    `local_date: ${yamlValue(record.local_date)}`,
    `timezone: ${yamlValue(record.timezone)}`,
    `source_status: ${yamlValue(record.source_status)}`,
    `data_as_of: ${yamlValue(record.data_as_of)}`,
    `updated_at: ${yamlValue(record.updated_at)}`,
    `scheduled_workout_key: ${yamlValue(record.properties.scheduled_workout_key)}`,
    `plan_id: ${yamlValue(record.properties.plan_id)}`,
    `plan_revision_key: ${yamlValue(record.properties.plan_revision_key)}`,
    "exercise_ids:",
    listYaml(record.properties.exercise_ids ?? []),
    `title: ${yamlValue(record.properties.title)}`,
    `status: ${yamlValue(record.properties.status)}`,
    `completion_fraction: ${record.properties.completion_fraction ?? "null"}`,
    `training_duration_sec: ${record.properties.training_duration_sec ?? "null"}`,
    `session_rpe: ${record.properties.session_rpe ?? "null"}`,
    `daily_hub: ${yamlValue(record.links.daily_hub)}`,
    "---",
    "",
    "## Workout Session",
    `- 日期：${record.local_date}`,
    `- 状态：${record.properties.status}`,
    `- 完成率：${record.properties.completion_fraction == null ? "—" : record.properties.completion_fraction}`,
    `- 训练时长：${record.properties.training_duration_sec == null ? "—" : `${record.properties.training_duration_sec} 秒`}`,
    `- 来源：${record.source_ref}`,
    "",
    ...detailSections,
    detailSections.length ? "" : "- 当前归档没有完整 Session 详情；下一次 sync data 会补齐。",
    "此记录是 Workout authoritative Session 的本地只读投影；不要在此处改写计划或执行结果。",
    "",
  ].join("\n");
}

/** @param {any} details @returns {string[]} */
function renderWorkoutDetailSections(details) {
  if (!details || typeof details !== "object") return [];
  if (details.snapshot?.schema_version === 2) return renderCanonicalWorkoutDetailSections(details);
  const lines = [];
  const snapshot = details.snapshot;
  if (snapshot && typeof snapshot === "object") {
    lines.push("## 训练计划");
    const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
    for (const [blockIndex, block] of blocks.entries()) {
      const blockTitle = block?.title ?? block?.name ?? `训练块 ${blockIndex + 1}`;
      lines.push(`### ${blockTitle}`);
      const exercises = Array.isArray(block?.exercises) ? block.exercises : [];
      for (const [exerciseIndex, exercise] of exercises.entries()) {
        const name = exercise?.name ?? exercise?.title ?? exercise?.exercise_key ?? `动作 ${exerciseIndex + 1}`;
        lines.push(`- **${name}**`);
        const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
        for (const [setIndex, set] of sets.entries()) {
          const target = formatDetailValue(set?.target ?? set?.prescription ?? set?.goal);
          const resistance = formatDetailValue(set?.resistance ?? set?.load ?? set?.weight);
          const parts = [`第 ${setIndex + 1} 组`];
          if (target) parts.push(`目标 ${target}`);
          if (resistance) parts.push(`阻力 ${resistance}`);
          if (set?.tempo) parts.push(`节奏 ${formatDetailValue(set.tempo)}`);
          if (set?.rest_sec ?? set?.restSec ?? set?.rest_after_sec ?? set?.restAfterSec) parts.push(`休息 ${set.rest_sec ?? set.restSec ?? set.rest_after_sec ?? set.restAfterSec} 秒`);
          lines.push(`  - ${parts.join(" · ")}`);
        }
      }
    }
    if (!blocks.length) lines.push("- 计划结构未提供。");
    if (snapshot.title || snapshot.start_time || snapshot.estimated_duration_min) {
      const planMeta = [snapshot.title, snapshot.start_time ? `开始 ${snapshot.start_time}` : null, snapshot.estimated_duration_min ? `预计 ${snapshot.estimated_duration_min} 分钟` : null].filter(Boolean);
      lines.splice(1, 0, `- 计划：${planMeta.join(" · ")}`);
    }
    lines.push("");
  }
  const completionItems = Array.isArray(details.completion_items)
    ? details.completion_items
    : (Array.isArray(snapshot?.completion_items) ? snapshot.completion_items : []);
  if (completionItems.length) {
    lines.push("## 完成项目");
    for (const [index, item] of completionItems.entries()) {
      const key = item?.completion_item_key ?? item?.set_key ?? `项目 ${index + 1}`;
      const target = formatDetailValue(item?.target);
      const side = item?.side && item.side !== "none" ? ` · ${item.side}` : "";
      lines.push(`- ${key}${side}${target ? `：目标 ${target}` : ""}`);
    }
    lines.push("");
  }
  const completionResults = Array.isArray(details.completion_results) ? details.completion_results : [];
  if (completionResults.length) {
    lines.push("## 完成结果");
    for (const [index, result] of completionResults.entries()) {
      const key = result?.completion_item_key ?? result?.set_key ?? `项目 ${index + 1}`;
      const actual = formatDetailValue(result?.actual ?? result?.value ?? result?.result);
      const completed = result?.completed === false ? "未完成" : "已完成";
      lines.push(`- ${key}：${completed}${actual ? ` · 实际 ${actual}` : ""}`);
    }
    lines.push("");
  }
  const feedback = Array.isArray(details.exercise_feedback) ? details.exercise_feedback : [];
  if (feedback.length) {
    lines.push("## 动作反馈");
    for (const item of feedback) {
      const key = item?.exercise_key ?? item?.exercise_occurrence_key ?? item?.name ?? item?.exercise ?? "动作";
      const note = item?.note ?? item?.feedback ?? item?.comment ?? item?.text ?? formatDetailValue(item);
      lines.push(`- ${key}：${note ?? "—"}`);
    }
    lines.push("");
  }
  const intervals = Array.isArray(details.training_intervals) ? details.training_intervals : [];
  if (intervals.length) {
    lines.push("## 训练区间");
    for (const [index, interval] of intervals.entries()) {
      const start = interval?.started_at ?? interval?.startedAt ?? "—";
      const end = interval?.ended_at ?? interval?.endedAt ?? "—";
      lines.push(`- 区间 ${index + 1}：${start} → ${end}`);
    }
    lines.push("");
  }
  for (const [key, label] of [["actual_training_data", "实际训练数据"], ["training_version", "训练版本"], ["note", "Session 备注"], ["skip_reason", "跳过原因"]]) {
    if (details[key] === undefined) continue;
    lines.push(`## ${label}`);
    lines.push(`- ${formatDetailValue(details[key]) ?? "—"}`);
    lines.push("");
  }
  return lines;
}

/** @param {any} details @returns {string[]} */
function renderCanonicalWorkoutDetailSections(details) {
  const snapshot = details.snapshot;
  const items = Array.isArray(details.completion_items) ? details.completion_items : (snapshot.completion_items ?? []);
  const resultValues = Array.isArray(details.set_results) && details.set_results.length ? details.set_results : (details.completion_results ?? []);
  const results = new Map(resultValues.map((result) => [result.completion_item_key, result]));
  const lines = ["## 训练计划", `- 计划快照：${snapshot.schema_version}`, `- 训练标题：${snapshot.title ?? "—"}`, `- 执行模式和左右结果均按 Session 创建时的快照保存。`, ""];
  for (const [blockIndex, block] of (snapshot.blocks ?? []).entries()) {
    lines.push(`### ${markdownCell(block?.title ?? `训练块 ${blockIndex + 1}`)}`);
    for (const [exerciseIndex, exercise] of (block?.exercises ?? []).entries()) {
      const exerciseTitle = exercise?.name ?? exercise?.exercise_id ?? `动作 ${exerciseIndex + 1}`;
      const mode = formatExecutionMode(exercise?.execution_mode);
      lines.push(`#### ${markdownCell(exerciseTitle)} · \`${markdownCell(exercise?.exercise_id ?? "—")}\` · ${mode}`);
      lines.push("| 组 | 侧别 | 目标 | 计划阻力 | 节奏 | 休息 | 实际 | 实际阻力 | 状态 | RIR | 备注 |");
      lines.push("| ---: | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | --- |");
      const exerciseItems = items.filter((item) => (item.exercise_occurrence_key ?? item.occurrence_key) === (exercise.exercise_occurrence_key ?? exercise.occurrence_key));
      for (const [itemIndex, item] of exerciseItems.entries()) {
        const set = (exercise.sets ?? []).find((candidate) => (candidate.set_id ?? candidate.set_key) === (item.set_id ?? item.set_key));
        const result = results.get(item.completion_item_key);
        const target = item.target ?? set?.target;
        const plannedResistance = item.resistance ?? canonicalResistanceFromFields(item.resistance_mode, item.resistance_kg) ?? set?.resistance;
        const actual = result?.actual ?? null;
        const actualResistance = result?.resistance ?? canonicalResistanceFromFields(result?.resistance_mode, result?.resistance_kg);
        lines.push(`| ${item.set_ordinal ?? set?.ordinal ?? itemIndex + 1} | ${markdownCell(item.side ?? "—")} | ${markdownCell(formatCanonicalTarget(target))} | ${markdownCell(formatCanonicalResistance(plannedResistance))} | ${markdownCell(item.tempo ?? set?.tempo ?? "—")} | ${item.rest_after_sec ?? set?.rest_after_sec ?? "—"} 秒 | ${markdownCell(formatCanonicalActual(actual))} | ${markdownCell(formatCanonicalResistance(actualResistance))} | ${formatResultStatus(result?.status)} | ${result?.rir ?? "—"} | ${markdownCell(result?.note ?? "—")} |`);
      }
      if (!exerciseItems.length) lines.push("| — | — | — | — | — | — | — | — | 未记录 | — | — |");
      lines.push("");
    }
  }
  if (!(snapshot.blocks ?? []).length) lines.push("- 计划结构未提供。", "");
  if (details.note !== undefined || details.session_rpe !== undefined || details.skip_reason !== undefined) {
    lines.push("## Session 结果");
    if (details.session_rpe !== undefined) lines.push(`- RPE：${details.session_rpe ?? "—"}`);
    if (details.note !== undefined) lines.push(`- 备注：${markdownCell(details.note ?? "—")}`);
    if (details.skip_reason !== undefined) lines.push(`- 跳过原因：${markdownCell(details.skip_reason ?? "—")}`);
    lines.push("");
  }
  const feedback = Array.isArray(details.exercise_feedback) ? details.exercise_feedback : [];
  if (feedback.length) {
    lines.push("## 动作反馈");
    for (const item of feedback) lines.push(`- ${markdownCell(item.exercise_occurrence_key ?? "动作")}：${markdownCell(item.text ?? "—")}`);
    lines.push("");
  }
  const intervals = Array.isArray(details.training_intervals) ? details.training_intervals : [];
  if (intervals.length) {
    lines.push("## 训练区间");
    for (const [index, interval] of intervals.entries()) lines.push(`- 区间 ${index + 1}：${interval?.started_at ?? "—"} → ${interval?.ended_at ?? "—"}`);
    lines.push("");
  }
  return lines;
}

/** @param {any} target @returns {string} */
function formatCanonicalTarget(target) {
  if (!target || target.value == null) return "—";
  return `${target.value} ${target.metric === "duration_sec" ? "秒" : target.metric === "reps" ? "次" : target.metric}`;
}

/** @param {any} actual @returns {string} */
function formatCanonicalActual(actual) { return actual ? formatCanonicalTarget(actual) : "—"; }

/** @param {any} resistance @returns {string} */
function formatCanonicalResistance(resistance) {
  if (!resistance) return "—";
  const mode = resistance.mode ?? resistance.resistance_mode;
  if (mode === "bodyweight") return "自重";
  if (mode === "external_load") {
    const load = resistance.load_kg ?? resistance.resistance_kg;
    return load == null ? "外部负重（未记录重量）" : `${load} kg`;
  }
  return "—";
}

/** @param {any} mode @returns {string} */
function formatExecutionMode(mode) {
  return ({ none: "不分左右", bilateral: "双侧", per_side: "左右分别", alternating: "左右交替" }[mode] ?? "模式未记录");
}

/** @param {any} status @returns {string} */
function formatResultStatus(status) {
  return ({ completed: "已完成", partial: "部分完成", skipped: "已跳过" }[status] ?? "未记录");
}

/** @param {any} mode @param {any} load @returns {any} */
function canonicalResistanceFromFields(mode, load) {
  if (!mode) return null;
  return mode === "bodyweight" ? { mode } : { mode, load_kg: load ?? null, quantity: 1 };
}

/** @param {any} value @returns {string} */
function markdownCell(value) { return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " "); }

/** @param {any} value @returns {string|null} */
function formatDetailValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return null; }
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
  return values.length ? values.map((value) => `  - ${yamlValue(value)}`).join("\n") : "  []";
}
