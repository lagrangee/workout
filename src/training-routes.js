// @ts-nocheck

import { dateSpan, isValidLocalDate } from "./util.js";
import { SOURCE_STATUSES, containsSensitiveText, normalizeSportType, safeAerobicActivity } from "./training-archive.js";

const ROUTE_LIMIT = 200;
const HISTORY_LIMIT = 200;
const CORE_SUMMARY_FIELDS = [
  "distance_km",
  "duration_sec",
  "average_heart_rate_bpm",
  "max_heart_rate_bpm",
  "calories_kcal",
  "training_load",
  "aerobic_te",
  "anaerobic_te",
];

function safeRouteKey(value) {
  if (typeof value !== "string" || !value.trim() || containsSensitiveText(value)) return null;
  const key = value.trim();
  return key.includes("/") || key.includes("\\") ? null : key;
}

function safeRouteName(value, routeKey) {
  if (typeof value !== "string" || !value.trim() || containsSensitiveText(value)) return routeKey;
  return value.trim().slice(0, 120);
}

function safeSportTypes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    try { return [normalizeSportType(item)]; } catch { return []; }
  }))].sort((left, right) => left - right);
}

function safeDistanceRange(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [minimum, maximum] = value.map(Number);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum) return null;
  return [minimum, maximum];
}

function projectionStatus(state) {
  const projection = state.aerobic_projection ?? {};
  return SOURCE_STATUSES.includes(projection.source_status) ? projection.source_status : "none";
}

function projectionDataAsOf(state) {
  const value = state.aerobic_projection?.data_as_of;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function normalizedActivities(state) {
  return (state.aerobic_activities ?? []).flatMap((activity) => {
    try { return [safeAerobicActivity(activity)]; } catch { return []; }
  });
}

function routeRecords(state) {
  const byKey = new Map();
  for (const route of Array.isArray(state.routes) ? state.routes : []) {
    const routeKey = safeRouteKey(route?.route_key);
    if (!routeKey) continue;
    byKey.set(routeKey, {
      route_key: routeKey,
      route_name: safeRouteName(route.route_name ?? route.name, routeKey),
      sport_types: safeSportTypes(route.sport_types),
      distance_range_km: safeDistanceRange(route.distance_range_km),
    });
  }
  for (const activity of normalizedActivities(state)) {
    const routeKey = safeRouteKey(activity.route_key);
    if (!routeKey || byKey.has(routeKey)) continue;
    byKey.set(routeKey, { route_key: routeKey, route_name: routeKey, sport_types: [], distance_range_km: null });
  }
  return [...byKey.values()];
}

function completeSum(values) {
  if (!values.length || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  return values.reduce((total, value) => total + value, 0);
}

function historyForRoute(state, routeKey, url = null) {
  const params = url?.searchParams;
  for (const key of params?.keys?.() ?? []) if (!["from", "to", "limit"].includes(key)) return { error: { code: "invalid_request", message: `Unsupported query parameter: ${key}` } };
  const from = params?.get("from") ?? null;
  const to = params?.get("to") ?? null;
  if ((from && !to) || (!from && to) || (from && (!isValidLocalDate(from) || !isValidLocalDate(to) || from > to || (dateSpan(from, to) ?? Infinity) > 3660))) {
    return { error: { code: "invalid_period", message: "from and to must be valid inclusive local dates within 3660 days" } };
  }
  const rawLimit = params?.get("limit");
  const limit = rawLimit === null || rawLimit === undefined ? HISTORY_LIMIT : Number(rawLimit);
  if (rawLimit !== null && rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > HISTORY_LIMIT)) {
    return { error: { code: "invalid_request", message: `limit must be an integer between 1 and ${HISTORY_LIMIT}` } };
  }
  const activities = normalizedActivities(state)
    .filter((activity) => activity.route_key === routeKey)
    .filter((activity) => !from || (activity.local_date >= from && activity.local_date <= to))
    .sort(compareActivities)
    .slice(0, limit);
  return { from, to, limit, activities };
}

function historyRow(activity) {
  const summary = activity.summary ?? {};
  return {
    activity_ref: activity.activity_ref,
    source_ref: activity.source_ref,
    local_date: activity.local_date,
    timezone: activity.timezone,
    started_at: activity.started_at,
    ended_at: activity.ended_at,
    sport_type: activity.sport_type,
    sport_name: activity.sport_name,
    route_key: activity.route_key,
    route_direction: activity.route_direction,
    source_status: activity.source_status,
    sync_status: activity.source_status,
    data_as_of: activity.data_as_of,
    summary: Object.fromEntries(CORE_SUMMARY_FIELDS.map((field) => [field, summary[field] ?? null])),
  };
}

function routeItem(route, activities) {
  const history = activities.filter((activity) => activity.route_key === route.route_key).sort(compareActivities);
  const distances = history.map((activity) => activity.summary?.distance_km);
  const durations = history.map((activity) => activity.summary?.duration_sec);
  return {
    ...route,
    activity_count: history.length,
    total_distance_km: completeSum(distances),
    total_duration_sec: completeSum(durations),
    latest_activity: history[0] ? historyRow(history[0]) : null,
  };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function routeListModel(state, url, now = new Date()) {
  for (const key of url.searchParams.keys()) if (!["sport_type", "limit"].includes(key)) return { error: { code: "invalid_request", message: `Unsupported query parameter: ${key}` } };
  const rawSportType = url.searchParams.get("sport_type");
  let sportType = null;
  if (rawSportType !== null) {
    try { sportType = normalizeSportType(rawSportType); } catch { return { error: { code: "invalid_request", message: "sport_type is unsupported" } }; }
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? ROUTE_LIMIT : Number(rawLimit);
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > ROUTE_LIMIT)) return { error: { code: "invalid_request", message: `limit must be an integer between 1 and ${ROUTE_LIMIT}` } };
  const activities = normalizedActivities(state);
  const items = routeRecords(state)
    .filter((route) => sportType === null || !route.sport_types.length || route.sport_types.includes(sportType))
    .map((route) => routeItem(route, activities))
    .sort((left, right) => (right.latest_activity?.local_date ?? "").localeCompare(left.latest_activity?.local_date ?? "") || left.route_key.localeCompare(right.route_key))
    .slice(0, limit);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: projectionDataAsOf(state),
    source_status: projectionStatus(state),
    source_ref: "route-records",
    filters: { sport_type: sportType, limit },
    page: { limit, next_cursor: null },
    items,
  };
}

/** @param {any} state @param {string} routeKey @param {Date} now @param {URL|null} url */
export function routeDetailModel(state, routeKey, now = new Date(), url = null) {
  const safeKey = safeRouteKey(routeKey);
  if (!safeKey) return { error: { code: "not_found", message: "Route not found" } };
  const route = routeRecords(state).find((candidate) => candidate.route_key === safeKey);
  if (!route) return { error: { code: "not_found", message: "Route not found" } };
  const result = historyForRoute(state, safeKey, url);
  if (result.error) return result;
  const item = routeItem(route, normalizedActivities(state));
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: projectionDataAsOf(state),
    source_status: projectionStatus(state),
    source_ref: `route:${safeKey}`,
    ...item,
    history: result.activities.map(historyRow),
    history_period: { from: result.from, to: result.to },
    page: { limit: result.limit, next_cursor: null },
  };
}

/** @param {any} state @param {string} routeKey @param {Date} now @param {URL|null} url */
export function routeHistoryModel(state, routeKey, now = new Date(), url = null) {
  const detail = routeDetailModel(state, routeKey, now, url);
  if (detail.error) return detail;
  return {
    schema_version: detail.schema_version,
    generated_at: detail.generated_at,
    data_as_of: detail.data_as_of,
    source_status: detail.source_status,
    source_ref: `${detail.source_ref}:history`,
    route_key: detail.route_key,
    history: detail.history,
    history_period: detail.history_period,
    page: detail.page,
  };
}

function compareActivities(left, right) {
  return right.local_date.localeCompare(left.local_date)
    || (right.started_at ?? "").localeCompare(left.started_at ?? "")
    || right.activity_ref.localeCompare(left.activity_ref);
}
