// @ts-nocheck

import { addDays, dateSpan, isValidLocalDate, localDate } from "./util.js";

export const COROS_SPORT_TYPES = Object.freeze({
  100: "outdoor_run",
  101: "indoor_run",
  102: "trail_run",
  104: "hike",
  200: "cycling",
});

export const SOURCE_STATUSES = Object.freeze(["complete", "none", "partial", "error"]);

const SUMMARY_FIELDS = [
  "duration_sec",
  "total_duration_sec",
  "distance_km",
  "average_heart_rate_bpm",
  "max_heart_rate_bpm",
  "calories_kcal",
  "training_load",
  "aerobic_te",
  "anaerobic_te",
  "training_focus",
  "perceived_effort",
];

/** @param {unknown} value @returns {number|null} */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value @returns {string|null} */
function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** @param {unknown} value @returns {string|null} */
export function containsSensitiveText(value) {
  return typeof value === "string" && /(?:bearer|agent\s+token|coach\s+share|credential|password|secret|raw[_ -]?fit|gps|telemetry|sensor|export|\/Users\/|\/private\/|\/var\/|[A-Za-z]:\\|\.fit\b)/i.test(value);
}

/** @param {unknown} value @returns {string|null} */
function redactedStringOrNull(value) {
  const text = stringOrNull(value);
  if (!text) return null;
  if (containsSensitiveText(text)) return null;
  return text;
}

/** @param {unknown} value @returns {string|null} */
function safeTimezoneOrNull(value) {
  try { return normalizeTimezone(value); } catch { return null; }
}

/** @param {unknown} value @returns {string} */
export function normalizeTimezone(value) {
  const text = stringOrNull(value) ?? "UTC";
  if (containsSensitiveText(text) || text.startsWith("/") || text.includes("\\")) throw new Error("timezone must be a valid non-sensitive IANA timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: text }).format();
  } catch {
    throw new Error("timezone must be a valid non-sensitive IANA timezone");
  }
  return text;
}

/** @param {unknown} value @returns {string|null} */
function instantOrNull(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** @param {unknown} value @returns {string} */
function sourceStatus(value) {
  const status = value ?? "complete";
  if (!SOURCE_STATUSES.includes(status)) throw new Error(`Unsupported Training Archive source_status: ${String(status)}`);
  return status;
}

/** @param {unknown} value @returns {number} */
export function normalizeSportType(value) {
  const sportType = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(sportType) || !Object.hasOwn(COROS_SPORT_TYPES, sportType)) throw new Error(`Unsupported COROS aerobic sport type: ${String(value)}`);
  return sportType;
}

/** @param {unknown} value @returns {any} */
function safeMetricValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return redactedStringOrNull(value);
  if (typeof value === "boolean") return value;
  return null;
}

/** @param {unknown} value @returns {Record<string, any>} */
function safeSportMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const blocked = /(gps|coordinate|track|telemetry|sensor|fit|token|credential|url|export|raw)/i;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.test(key))
    .map(([key, metric]) => [key, safeMetricValue(metric)])
    .filter(([, metric]) => metric !== null));
}

/** @param {Record<string, any>|null|undefined} raw @returns {any} */
export function normalizeActivitySummary(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = Object.fromEntries(SUMMARY_FIELDS.map((field) => {
    const candidate = value[field] ?? value[field.replaceAll("_", "")];
    if (["training_focus", "perceived_effort"].includes(field)) return [field, redactedStringOrNull(candidate)];
    return [field, numberOrNull(candidate)];
  }));
  result.sport_metrics = safeSportMetrics(value.sport_metrics);
  return result;
}

/** @param {Record<string, any>|null|undefined} raw @param {string} activityRef @returns {any} */
function normalizeFitArtifact(raw, activityRef) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const status = value.status ?? value.fit_status ?? "partial";
  if (!["complete", "partial", "error"].includes(status)) throw new Error(`Unsupported FIT status for ${activityRef}: ${String(status)}`);
  const hasCandidatePath = Object.hasOwn(value, "relative_path");
  const candidatePath = stringOrNull(value.relative_path);
  if (hasCandidatePath && (!candidatePath || candidatePath.startsWith("/") || candidatePath.includes("\\") || /(?:\.\.|\/Users\/|\/private\/|\/var\/)/i.test(candidatePath))) {
    throw new Error(`FIT relative_path must be a safe archive-relative path for ${activityRef}`);
  }
  const relativePath = candidatePath ?? `data/coros/${encodeURIComponent(activityRef)}.fit`;
  return {
    relative_path: relativePath,
    status,
    mime_type: "application/octet-stream",
    bytes: numberOrNull(value.bytes),
  };
}

/**
 * Normalize one provider activity into the local Training Archive envelope.
 * The normalizer intentionally drops raw provider payloads, GPS and telemetry.
 * @param {Record<string, any>} raw
 * @param {{ timezone: string, targetDate?: string, dataAsOf?: string|null, updatedAt?: string }} context
 */
export function normalizeCorosActivity(raw, context) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("COROS activity must be an object");
  const timezone = normalizeTimezone(context.timezone);
  const activityRef = redactedStringOrNull(raw.activity_ref ?? raw.activityRef ?? raw.labelId);
  if (!activityRef) throw new Error("COROS activity needs labelId/activity_ref");
  const sportType = normalizeSportType(raw.sport_type ?? raw.sportType);
  const sportName = COROS_SPORT_TYPES[sportType];
  const startedAt = instantOrNull(raw.started_at ?? raw.startedAt ?? raw.startTime);
  const endedAt = instantOrNull(raw.ended_at ?? raw.endedAt ?? raw.endTime);
  const localDate = stringOrNull(raw.local_date) ?? (startedAt ? localDateFromInstant(startedAt, timezone) : context.targetDate);
  if (!localDate || !isValidLocalDate(localDate)) throw new Error(`COROS activity ${activityRef} needs an Athlete-local date`);
  const routeKey = sportType === 101 ? null : redactedStringOrNull(raw.route_key ?? raw.routeKey);
  const routeDirection = routeKey && ["forward", "reverse"].includes(raw.route_direction ?? raw.routeDirection) ? (raw.route_direction ?? raw.routeDirection) : null;
  const fitFile = normalizeFitArtifact(raw.fit_file ?? raw.fitFile ?? { fit_status: raw.fit_status }, activityRef);
  const status = sourceStatus(raw.source_status ?? raw.sourceStatus ?? context.sourceStatus);
  const dataAsOf = instantOrNull(raw.data_as_of ?? raw.dataAsOf) ?? instantOrNull(context.dataAsOf) ?? null;
  return {
    schema_version: 1,
    field_catalog_version: 1,
    provider: "coros",
    kind: "coros-activity",
    activity_ref: activityRef,
    source_ref: `coros:activity:${activityRef}`,
    sport_type: sportType,
    sport_name: sportName,
    local_date: localDate,
    timezone,
    started_at: startedAt,
    ended_at: endedAt,
    route_key: routeKey,
    route_direction: routeDirection,
    fit_file: fitFile,
    source_status: status,
    data_as_of: dataAsOf,
    updated_at: instantOrNull(context.updatedAt) ?? dataAsOf,
    summary: normalizeActivitySummary(raw.summary ?? raw),
    provider_shape: { mode: numberOrNull(raw.provider_shape?.mode), sub_mode: numberOrNull(raw.provider_shape?.sub_mode), columns: [], sport_data_details_present: Boolean(raw.provider_shape?.sport_data_details_present) },
    lap_groups: [],
  };
}

function localDateFromInstant(instant, timezone) {
  try { return localDate(new Date(instant), timezone); } catch { return null; }
}

/** @param {any} activity */
export function safeAerobicActivity(activity) {
  const normalized = normalizeCorosActivity(activity, { timezone: activity.timezone ?? "UTC", targetDate: activity.local_date, dataAsOf: activity.data_as_of, updatedAt: activity.updated_at });
  return {
    schema_version: 1,
    activity_ref: normalized.activity_ref,
    source_ref: normalized.source_ref,
    local_date: normalized.local_date,
    timezone: normalized.timezone,
    started_at: normalized.started_at,
    ended_at: normalized.ended_at,
    sport_type: normalized.sport_type,
    sport_name: normalized.sport_name,
    source_status: normalized.source_status,
    data_as_of: normalized.data_as_of,
    updated_at: normalized.updated_at,
    summary: normalized.summary,
    route_key: normalized.route_key,
    route_direction: normalized.route_direction,
    fit_status: normalized.fit_file?.status ?? null,
  };
}

/** @param {any} state @param {any} projection @param {Date} now */
export function publishAerobicProjection(state, projection, now = new Date()) {
  if (!projection || typeof projection !== "object" || !Array.isArray(projection.activities)) throw new Error("Aerobic projection needs an activities array");
  const existing = new Map();
  for (const activity of state.aerobic_activities ?? []) {
    const safe = safeAerobicActivity(activity);
    existing.set(safe.source_ref, safe);
  }
  const safeActivities = projection.activities.map(safeAerobicActivity);
  for (const safe of safeActivities) existing.set(safe.source_ref, safe);
  const sourceStatuses = projectionSourceStatuses(projection, safeActivities);
  const aggregateStatus = aggregateSourceStatus([sourceStatuses.workout, sourceStatuses.coros]);
  state.aerobic_activities = [...existing.values()].sort(compareActivities);
  state.aerobic_projection = {
    schema_version: 1,
    source_status: aggregateStatus,
    source_statuses: sourceStatuses,
    data_as_of: instantOrNull(projection.data_as_of) ?? null,
    updated_at: now.toISOString(),
    activity_count: state.aerobic_activities.length,
    publication_key: redactedStringOrNull(projection.publication_key),
  };
  return {
    status: aggregateStatus,
    published_count: safeActivities.length,
    updated_at: state.aerobic_projection.updated_at,
    source_statuses: sourceStatuses,
  };
}

/** @param {string[]} statuses @returns {string} */
function aggregateSourceStatus(statuses) {
  const filtered = statuses.filter((status) => SOURCE_STATUSES.includes(status));
  if (!filtered.length || filtered.every((status) => status === "none")) return "none";
  if (filtered.every((status) => status === "complete" || status === "none")) return "complete";
  if (filtered.some((status) => status === "partial") || filtered.some((status) => status === "error" && filtered.some((other) => other === "complete" || other === "partial"))) return "partial";
  return "error";
}

/** @param {any} projection @returns {{ workout: string, coros: string }} */
function projectionSourceStatuses(projection, safeActivities = []) {
  const supplied = projection.source_statuses && typeof projection.source_statuses === "object" ? projection.source_statuses : {};
  const sourceStatusValue = typeof projection.source_status === "string" ? projection.source_status : projection.source_status?.coros;
  const inferredCorosStatus = safeActivities.some((activity) => activity.source_status === "error")
    ? "error"
    : (safeActivities.some((activity) => activity.source_status === "partial") ? "partial" : (safeActivities.length ? "complete" : "none"));
  return {
    workout: sourceStatus(supplied.workout ?? projection.workout_source_status ?? "none"),
    coros: sourceStatus(supplied.coros ?? sourceStatusValue ?? inferredCorosStatus),
  };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function aerobicListModel(state, url, now = new Date()) {
  const filters = parseAerobicFilters(url);
  if (filters.error) return filters;
  const source = state.aerobic_projection ?? { source_status: state.aerobic_activities?.length ? "complete" : "none", data_as_of: null };
  const items = (state.aerobic_activities ?? []).map(safeAerobicActivity)
    .filter((activity) => (!filters.from || activity.local_date >= filters.from) && (!filters.to || activity.local_date <= filters.to) && (filters.sportType === null || activity.sport_type === filters.sportType))
    .sort(compareActivities)
    .slice(0, filters.limit);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: source.data_as_of,
    timezone: safeTimezoneOrNull(state.timezone) ?? "UTC",
    source_status: source.source_status,
    source_statuses: source.source_statuses ?? { workout: "none", coros: source.source_status },
    source_ref: "aerobic-records",
    filters: { from: filters.from, to: filters.to, sport_type: filters.sportType, limit: filters.limit },
    page: { limit: filters.limit, next_cursor: null },
    items,
  };
}

/** @param {any} state @param {string} activityRef @param {Date} now */
export function aerobicDetailModel(state, activityRef, now = new Date()) {
  const activity = (state.aerobic_activities ?? []).find((candidate) => candidate.activity_ref === activityRef);
  if (!activity) return { error: { code: "not_found", message: "Aerobic activity not found" } };
  const safe = safeAerobicActivity(activity);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: safe.data_as_of,
    source_statuses: state.aerobic_projection?.source_statuses ?? { workout: "none", coros: safe.source_status },
    ...safe,
  };
}

/** @param {URL} url */
function parseAerobicFilters(url) {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const month = url.searchParams.get("month");
  if ((fromParam && !toParam) || (!fromParam && toParam) || (month && (fromParam || toParam))) return { error: { code: "invalid_period", message: "from and to must be supplied together, and month cannot be combined with them" } };
  let from = fromParam;
  let to = toParam;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return { error: { code: "invalid_period", message: "month must be YYYY-MM" } };
    from = `${month}-01`;
    const [year, monthNumber] = month.split("-").map(Number);
    const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
    to = addDays(nextMonth.toISOString().slice(0, 10), -1);
  }
  if ((from && !isValidLocalDate(from)) || (to && !isValidLocalDate(to)) || (from && to && from > to) || (from && to && (dateSpan(from, to) ?? Infinity) > 3660)) return { error: { code: "invalid_period", message: "from and to must be valid inclusive local dates within 3660 days" } };
  const rawSportType = url.searchParams.get("sport_type");
  let sportType = null;
  if (rawSportType !== null) {
    try { sportType = normalizeSportType(rawSportType); } catch { return { error: { code: "invalid_request", message: "sport_type is unsupported" } }; }
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 200 : Number(rawLimit);
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 200)) return { error: { code: "invalid_request", message: "limit must be an integer between 1 and 200" } };
  return { from, to, sportType, limit };
}

/** @param {any} left @param {any} right */
function compareActivities(left, right) {
  const leftInstant = left.started_at ?? `${left.local_date}T00:00:00.000Z`;
  const rightInstant = right.started_at ?? `${right.local_date}T00:00:00.000Z`;
  return rightInstant.localeCompare(leftInstant) || right.activity_ref.localeCompare(left.activity_ref);
}
