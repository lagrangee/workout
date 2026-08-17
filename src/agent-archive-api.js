// @ts-nocheck

import { base64UrlDecode, base64UrlEncode, dateSpan, isValidLocalDate, localDate } from "./util.js";
import { SOURCE_STATUSES, containsSensitiveText, normalizeSportType, safeAerobicActivity } from "./training-archive.js";
import { dailyHubModel } from "./training-records.js";
import { routeDetailModel, routeListModel } from "./training-routes.js";

const AGENT_PREFIX = "/api/agent/v1";
export const AGENT_ARCHIVE_LIMIT = 200;
export const AGENT_CURSOR_TTL_MS = 15 * 60 * 1000;
export const AGENT_ARCHIVE_SCHEMA_NAMES = Object.freeze([
  "aerobic_activity_index",
  "aerobic_activity_detail",
  "daily_context",
  "route_index",
  "route_detail",
  "route_history",
  "schema_catalog",
]);

export function archiveSource(state) {
  const projection = state.aerobic_projection ?? {};
  const activities = archiveActivities(state);
  const sourceStatus = SOURCE_STATUSES.includes(projection.source_status) ? projection.source_status : (activities.length ? "complete" : "none");
  const sourceStatuses = projection.source_statuses && typeof projection.source_statuses === "object"
    ? { workout: SOURCE_STATUSES.includes(projection.source_statuses.workout) ? projection.source_statuses.workout : "none", coros: SOURCE_STATUSES.includes(projection.source_statuses.coros) ? projection.source_statuses.coros : sourceStatus }
    : { workout: "none", coros: sourceStatus };
  return {
    source_status: sourceStatus,
    source_statuses: sourceStatuses,
    data_as_of: safeInstant(projection.data_as_of),
    updated_at: safeInstant(projection.updated_at),
    activity_count: activities.length,
  };
}

function archiveActivities(state) {
  return (state.aerobic_activities ?? []).flatMap((activity) => {
    try { return [safeAerobicActivity(activity)]; } catch { return []; }
  });
}

function safeInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function archivePeriod(from, to, timezone, now) {
  const currentDate = localDate(now, timezone);
  const includesCurrentDate = Boolean(from && to && from <= currentDate && currentDate <= to);
  return {
    from: from ?? null,
    to: to ?? null,
    timezone,
    includes_from: Boolean(from),
    includes_to: Boolean(to),
    includes_current_date: includesCurrentDate,
    current_date_may_be_incomplete: includesCurrentDate,
  };
}

function archiveFilters(url, { allowRouteKey = true } = {}) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if ((from === null) !== (to === null) || (from !== null && (!isValidLocalDate(from) || !isValidLocalDate(to) || from > to || (dateSpan(from, to) ?? Infinity) > 3660))) {
    return { error: { code: "invalid_period", field: from === null ? "from" : "to", message: "from and to must be valid inclusive local dates within 3660 days and supplied together" } };
  }
  let sportType = null;
  const rawSportType = url.searchParams.get("sport_type");
  if (rawSportType !== null) {
    try { sportType = normalizeSportType(rawSportType); } catch { return { error: { code: "invalid_request", field: "sport_type", message: "sport_type is unsupported" } }; }
  }
  let routeKey = null;
  if (allowRouteKey && url.searchParams.has("route_key")) {
    routeKey = safeAgentRouteKey(url.searchParams.get("route_key"));
    if (!routeKey) return { error: { code: "invalid_request", field: "route_key", message: "route_key must be a safe non-empty route identity" } };
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > AGENT_ARCHIVE_LIMIT)) {
    return { error: { code: "invalid_request", field: "limit", message: `limit must be an integer between 1 and ${AGENT_ARCHIVE_LIMIT}` } };
  }
  return { from, to, sport_type: sportType, route_key: routeKey, limit };
}

function safeAgentRouteKey(value) {
  if (typeof value !== "string" || !value.trim() || containsSensitiveText(value)) return null;
  const key = value.trim();
  return key.length <= 120 && !/[\\/<>:"|?*#\[\]\u0000-\u001f]/.test(key) ? key : null;
}

function archiveActivityIndexItem(activity) {
  return {
    ...activity,
    lookup: { activity_ref: activity.activity_ref, source_ref: activity.source_ref, scope: "single_activity", explicit: true },
  };
}

function archiveCursor(resource, filters, offset, state, now) {
  return encodeAgentCursor({ resource, filters: JSON.stringify(filters), offset, issued_at: now.getTime(), training_version: state.training_version });
}

function archiveCursorOffset(value, resource, filters, state, now) {
  if (!value) return { offset: 0 };
  let cursor;
  try { cursor = JSON.parse(new TextDecoder().decode(base64UrlDecode(value))); } catch { return cursorError(); }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || cursor.resource !== resource || cursor.filters !== JSON.stringify(filters) || cursor.training_version !== state.training_version || !Number.isInteger(cursor.offset) || cursor.offset < 0 || !Number.isInteger(cursor.issued_at) || cursor.issued_at > now.getTime() || now.getTime() - cursor.issued_at > AGENT_CURSOR_TTL_MS) return cursorError();
  return { offset: cursor.offset };
}

function encodeAgentCursor(value) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function cursorError() {
  return { error: { code: "invalid_cursor", field: "cursor", message: "Cursor is malformed, expired, or does not match the filters" } };
}

function pageArchiveItems(items, resource, filters, state, now, cursorValue) {
  const cursor = archiveCursorOffset(cursorValue, resource, filters, state, now);
  if (cursor.error) return cursor;
  const pageItems = items.slice(cursor.offset, cursor.offset + filters.limit);
  const nextOffset = cursor.offset + pageItems.length;
  return {
    items: pageItems,
    page: { limit: filters.limit, next_cursor: nextOffset < items.length ? archiveCursor(resource, filters, nextOffset, state, now) : null },
  };
}

export function agentAerobicActivities(state, url, now) {
  const filters = archiveFilters(url);
  if (filters.error) return filters;
  const source = archiveSource(state);
  const activities = archiveActivities(state)
    .filter((activity) => (!filters.from || activity.local_date >= filters.from) && (!filters.to || activity.local_date <= filters.to))
    .filter((activity) => filters.sport_type === null || activity.sport_type === filters.sport_type)
    .filter((activity) => filters.route_key === null || activity.route_key === filters.route_key)
    .sort(compareArchiveActivities)
    .map(archiveActivityIndexItem);
  const page = pageArchiveItems(activities, "aerobic_activities", filters, state, now, url.searchParams.get("cursor"));
  if (page.error) return page;
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: source.data_as_of,
    source_status: source.source_status,
    source_statuses: source.source_statuses,
    source_ref: "agent:aerobic-activities",
    timezone: state.timezone,
    period: archivePeriod(filters.from, filters.to, state.timezone, now),
    filters,
    page: page.page,
    items: page.items,
  };
}

export function agentAerobicActivityDetail(state, activityRef, now) {
  const activity = archiveActivities(state).find((candidate) => candidate.activity_ref === activityRef);
  if (!activity) return { error: { code: "not_found", message: "Aerobic activity not found" } };
  const source = archiveSource(state);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: activity.data_as_of ?? source.data_as_of,
    source_status: activity.source_status,
    source_statuses: source.source_statuses,
    source_ref: activity.source_ref,
    ...activity,
    lookup: { activity_ref: activity.activity_ref, source_ref: activity.source_ref, scope: "single_activity", explicit: true, local_archive: "request-through-workout-skill-boundary" },
  };
}

export function agentDailyContext(state, date, now) {
  if (!isValidLocalDate(date)) return { error: { code: "invalid_request", field: "local_date", message: "local_date must be a valid YYYY-MM-DD date" } };
  const source = archiveSource(state);
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const latestSessionUpdated = sessions.map((session) => safeInstant(session.updated_at)).filter(Boolean).sort().at(-1) ?? null;
  const hub = dailyHubModel({
    targetDate: date,
    timezone: state.timezone,
    now,
    workout: { source_status: sessions.length ? "complete" : "none", data_as_of: latestSessionUpdated, sessions },
    coros: { source_status: source.source_statuses.coros, data_as_of: source.data_as_of, activities: archiveActivities(state) },
    activities: archiveActivities(state),
    errors: [],
  });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: source.data_as_of ?? latestSessionUpdated,
    source_status: hub.source_status,
    source_statuses: hub.source_status,
    source_ref: `agent:daily:${date}`,
    local_date: date,
    timezone: state.timezone,
    context: hub,
  };
}

export function agentRoutes(state, url, now) {
  const filters = archiveFilters(url);
  if (filters.error) return filters;
  const sourceUrl = new URL(url.href);
  for (const key of ["route_key", "cursor", "from", "to"]) sourceUrl.searchParams.delete(key);
  sourceUrl.searchParams.set("limit", String(AGENT_ARCHIVE_LIMIT));
  const base = routeListModel(state, sourceUrl, now);
  if (base.error) return base;
  const items = base.items.filter((route) => filters.route_key === null || route.route_key === filters.route_key);
  const page = pageArchiveItems(items, "routes", filters, state, now, url.searchParams.get("cursor"));
  if (page.error) return page;
  return { ...base, source_statuses: archiveSource(state).source_statuses, source_ref: "agent:routes", filters, page: page.page, items: page.items };
}

function agentRouteHistoryResource(state, routeKey, url, now, resourceName) {
  const filters = archiveFilters(url);
  if (filters.error) return filters;
  const sourceUrl = new URL(url.href);
  for (const key of ["cursor", "sport_type", "route_key"]) sourceUrl.searchParams.delete(key);
  sourceUrl.searchParams.set("limit", String(AGENT_ARCHIVE_LIMIT));
  const base = routeDetailModel(state, routeKey, now, sourceUrl);
  if (base.error) return base;
  const historyFilters = { from: filters.from, to: filters.to, sport_type: filters.sport_type, route_key: routeKey, limit: filters.limit };
  const history = base.history.filter((activity) => filters.sport_type === null || activity.sport_type === filters.sport_type);
  const page = pageArchiveItems(history, resourceName, historyFilters, state, now, url.searchParams.get("cursor"));
  if (page.error) return page;
  const source = archiveSource(state);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: source.data_as_of,
    source_status: source.source_status,
    source_statuses: source.source_statuses,
    source_ref: `agent:route:${routeKey}:${resourceName === "route_history" ? "history" : "detail"}`,
    route_key: base.route_key,
    route_name: base.route_name,
    sport_types: base.sport_types,
    distance_range_km: base.distance_range_km,
    activity_count: base.activity_count,
    total_distance_km: base.total_distance_km,
    total_duration_sec: base.total_duration_sec,
    history_period: base.history_period,
    page: page.page,
    history: page.items,
  };
}

export function agentRouteDetail(state, routeKey, url, now) {
  return agentRouteHistoryResource(state, routeKey, url, now, "route_detail");
}

export function agentRouteHistory(state, routeKey, url, now) {
  return agentRouteHistoryResource(state, routeKey, url, now, "route_history");
}

function compareArchiveActivities(left, right) {
  return (right.started_at ?? `${right.local_date}T00:00:00.000Z`).localeCompare(left.started_at ?? `${left.local_date}T00:00:00.000Z`) || right.activity_ref.localeCompare(left.activity_ref);
}

export function agentSchemaCatalog(now) {
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    schemas: AGENT_ARCHIVE_SCHEMA_NAMES.map((name) => ({ name, href: `${AGENT_PREFIX}/schemas/${name}`, json_schema_draft: "2020-12" })),
  };
}

export function agentSchemaResource(name, now) {
  if (!AGENT_ARCHIVE_SCHEMA_NAMES.includes(name)) return { error: { code: "not_found", message: "Schema not found" } };
  if (name === "schema_catalog") return agentSchemaCatalog(now);
  const required = ["schema_version", "generated_at", "data_as_of", "source_status", "source_ref"];
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://workout.lagrangee.xyz/agent-schemas/${name}.json`,
    title: `Workout Agent ${name}`,
    type: "object",
    required,
    properties: Object.fromEntries(required.map((field) => [field, { type: field === "schema_version" ? "integer" : "string" }])),
    additionalProperties: true,
  };
}
