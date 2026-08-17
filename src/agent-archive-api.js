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
  const dateProjection = state.aerobic_date_projections?.[date] ?? null;
  const activities = archiveActivities(state).filter((activity) => activity.local_date === date);
  const sessions = (Array.isArray(state.sessions) ? state.sessions : []).filter((session) => (session.scheduled_date ?? session.local_date) === date);
  const sourceStatuses = {
    workout: dateProjection ? safeStatus(dateProjection.source_statuses?.workout) : (sessions.length ? statusFromValues(sessions.map((session) => session.source_status ?? "complete")) : "none"),
    coros: dateProjection ? safeStatus(dateProjection.source_statuses?.coros) : (activities.length ? statusFromValues(activities.map((activity) => activity.source_status)) : "none"),
  };
  const latestSessionUpdated = (dateProjection ? [safeInstant(dateProjection.source_data_as_of?.workout)] : sessions.map((session) => safeInstant(session.data_as_of ?? session.updated_at))).filter(Boolean).sort().at(-1) ?? null;
  const latestActivityAsOf = (dateProjection ? [safeInstant(dateProjection.source_data_as_of?.coros)] : activities.map((activity) => activity.data_as_of)).filter(Boolean).sort().at(-1) ?? null;
  const hub = dailyHubModel({
    targetDate: date,
    timezone: state.timezone,
    now,
    workout: { source_status: sourceStatuses.workout, data_as_of: latestSessionUpdated, sessions },
    coros: { source_status: sourceStatuses.coros, data_as_of: latestActivityAsOf, activities },
    activities,
    errors: [],
  });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: latestActivityAsOf ?? latestSessionUpdated,
    source_status: hub.source_status,
    source_statuses: hub.source_status,
    source_ref: `agent:daily:${date}`,
    local_date: date,
    timezone: state.timezone,
    sync_evidence: dateProjection ? "synced" : "not_synced",
    context: hub,
  };
}

function statusFromValues(values) {
  const statuses = values.filter((value) => SOURCE_STATUSES.includes(value));
  if (!statuses.length || statuses.every((value) => value === "none")) return "none";
  if (statuses.some((value) => value === "error") && statuses.some((value) => value === "complete" || value === "partial")) return "partial";
  if (statuses.some((value) => value === "partial")) return "partial";
  if (statuses.some((value) => value === "error")) return "error";
  return "complete";
}

function safeStatus(value) {
  return SOURCE_STATUSES.includes(value) ? value : "none";
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
  const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
  const nullableInstant = nullable({ type: "string", format: "date-time" });
  const nullableNumber = nullable({ type: "number" });
  const nullableString = nullable({ type: "string" });
  const sourceStatus = { type: "string", enum: [...SOURCE_STATUSES] };
  const sportType = { type: "integer", enum: [100, 101, 102, 104, 200] };
  const sourceStatuses = objectSchema({ workout: sourceStatus, coros: sourceStatus }, ["workout", "coros"]);
  const page = objectSchema({ limit: { type: "integer", minimum: 1, maximum: AGENT_ARCHIVE_LIMIT }, next_cursor: nullable({ type: "string" }) }, ["limit", "next_cursor"]);
  const period = objectSchema({
    from: nullable({ type: "string", format: "date" }),
    to: nullable({ type: "string", format: "date" }),
    timezone: { type: "string" },
    includes_from: { type: "boolean" },
    includes_to: { type: "boolean" },
    includes_current_date: { type: "boolean" },
    current_date_may_be_incomplete: { type: "boolean" },
  });
  const summary = objectSchema({
    duration_sec: nullableNumber,
    total_duration_sec: nullableNumber,
    distance_km: nullableNumber,
    average_heart_rate_bpm: nullableNumber,
    max_heart_rate_bpm: nullableNumber,
    calories_kcal: nullableNumber,
    training_load: nullableNumber,
    aerobic_te: nullableNumber,
    anaerobic_te: nullableNumber,
    training_focus: nullableString,
    perceived_effort: nullableString,
    sport_metrics: { type: "object", additionalProperties: true },
  });
  const activityProperties = {
    schema_version: { type: "integer", const: 1 },
    activity_ref: { type: "string" },
    source_ref: { type: "string" },
    local_date: { type: "string", format: "date" },
    timezone: { type: "string" },
    started_at: nullableInstant,
    ended_at: nullableInstant,
    sport_type: sportType,
    sport_name: { type: "string" },
    source_status: sourceStatus,
    data_as_of: nullableInstant,
    updated_at: nullableInstant,
    summary,
    route_key: nullableString,
    route_direction: nullable({ type: "string", enum: ["forward", "reverse"] }),
    route_match_status: { type: "string", enum: ["matched", "registered", "unmatched", "ambiguous", "ignored", "error"] },
    fit_status: nullable({ type: "string", enum: ["complete", "partial", "error"] }),
  };
  const activityRequired = Object.keys(activityProperties);
  const activityLookup = objectSchema({
    activity_ref: { type: "string" },
    source_ref: { type: "string" },
    scope: { const: "single_activity" },
    local_archive: nullableString,
  }, ["activity_ref", "source_ref", "scope"]);
  const activityItem = objectSchema({ ...activityProperties, lookup: activityLookup }, [...activityRequired, "lookup"]);
  const filters = objectSchema({
    from: nullable({ type: "string", format: "date" }),
    to: nullable({ type: "string", format: "date" }),
    sport_type: nullable(sportType),
    route_key: nullableString,
    limit: { type: "integer", minimum: 1, maximum: AGENT_ARCHIVE_LIMIT },
  });
  const routeFilter = objectSchema({
    from: nullable({ type: "string", format: "date" }),
    to: nullable({ type: "string", format: "date" }),
    sport_type: nullable(sportType),
    route_key: nullableString,
    limit: { type: "integer", minimum: 1, maximum: AGENT_ARCHIVE_LIMIT },
  });
  const routeHistorySummary = objectSchema({
    distance_km: nullableNumber,
    duration_sec: nullableNumber,
    average_heart_rate_bpm: nullableNumber,
    max_heart_rate_bpm: nullableNumber,
    calories_kcal: nullableNumber,
    training_load: nullableNumber,
    aerobic_te: nullableNumber,
    anaerobic_te: nullableNumber,
  });
  const routeHistoryRow = objectSchema({
    activity_ref: { type: "string" },
    source_ref: { type: "string" },
    local_date: { type: "string", format: "date" },
    timezone: { type: "string" },
    started_at: nullableInstant,
    ended_at: nullableInstant,
    sport_type: sportType,
    sport_name: { type: "string" },
    route_key: { type: "string" },
    route_direction: nullable({ type: "string", enum: ["forward", "reverse"] }),
    source_status: sourceStatus,
    sync_status: sourceStatus,
    data_as_of: nullableInstant,
    summary: routeHistorySummary,
  });
  const routeProperties = {
    route_key: { type: "string" },
    route_name: { type: "string" },
    sport_types: { type: "array", items: sportType, uniqueItems: true },
    distance_range_km: nullable({ type: "array", prefixItems: [{ type: "number", minimum: 0 }, { type: "number", minimum: 0 }], minItems: 2, maxItems: 2 }),
    activity_count: { type: "integer", minimum: 0 },
    total_distance_km: nullableNumber,
    total_duration_sec: nullableNumber,
  };
  const routeIndexItem = objectSchema({ ...routeProperties, latest_activity: nullable(routeHistoryRow) });
  const routeHistoryPeriod = objectSchema({ from: nullable({ type: "string", format: "date" }), to: nullable({ type: "string", format: "date" }) });
  const hubStatus = sourceStatuses;
  const hubDataAsOf = objectSchema({ workout: nullableInstant, coros: nullableInstant });
  const hub = objectSchema({
    kind: { const: "daily-hub" },
    schema_version: { type: "integer", const: 1 },
    local_date: { type: "string", format: "date" },
    timezone: { type: "string" },
    captured_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    source_status: hubStatus,
    data_as_of: hubDataAsOf,
    relation_policy: { const: "same_local_date_context_only" },
    machine_refs: objectSchema({
      workout_session_keys: { type: "array", items: { type: "string" } },
      activity_refs: { type: "array", items: { type: "string" } },
      route_keys: { type: "array", items: { type: "string" } },
    }),
    links: objectSchema({
      workout_sessions: { type: "array", items: { type: "string" } },
      coros_activities: { type: "array", items: { type: "string" } },
      routes: { type: "array", items: { type: "string" } },
    }),
    summary: objectSchema({
      workout: objectSchema({ session_count: { type: "integer", minimum: 0 }, statuses: { type: "array", items: { type: "string" } }, duration_sec: nullableNumber }),
      coros: objectSchema({ activity_count: { type: "integer", minimum: 0 }, distance_km: nullableNumber, duration_sec: nullableNumber, source_status: sourceStatus }),
    }),
    errors: { type: "array", items: { type: "object", additionalProperties: true } },
    properties: { type: "object", additionalProperties: true },
  });
  let properties;
  let required;
  if (name === "aerobic_activity_index") {
    properties = { schema_version: { type: "integer", const: 1 }, generated_at: { type: "string", format: "date-time" }, data_as_of: nullableInstant, source_status: sourceStatus, source_statuses: sourceStatuses, source_ref: { const: "agent:aerobic-activities" }, timezone: { type: "string" }, period, filters, page, items: { type: "array", items: activityItem } };
    required = Object.keys(properties);
  } else if (name === "aerobic_activity_detail") {
    properties = { schema_version: { type: "integer", const: 1 }, generated_at: { type: "string", format: "date-time" }, data_as_of: nullableInstant, source_status: sourceStatus, source_statuses: sourceStatuses, source_ref: { type: "string" }, ...activityProperties, lookup: activityLookup };
    required = Object.keys(properties);
  } else if (name === "daily_context") {
    properties = { schema_version: { type: "integer", const: 1 }, generated_at: { type: "string", format: "date-time" }, data_as_of: nullableInstant, source_status: sourceStatuses, source_statuses: sourceStatuses, source_ref: { type: "string" }, local_date: { type: "string", format: "date" }, timezone: { type: "string" }, sync_evidence: { type: "string", enum: ["synced", "not_synced"] }, context: hub };
    required = Object.keys(properties);
  } else if (name === "route_index") {
    properties = { schema_version: { type: "integer", const: 1 }, generated_at: { type: "string", format: "date-time" }, data_as_of: nullableInstant, source_status: sourceStatus, source_statuses: sourceStatuses, source_ref: { const: "agent:routes" }, filters: routeFilter, page, items: { type: "array", items: routeIndexItem } };
    required = Object.keys(properties);
  } else {
    properties = { schema_version: { type: "integer", const: 1 }, generated_at: { type: "string", format: "date-time" }, data_as_of: nullableInstant, source_status: sourceStatus, source_statuses: sourceStatuses, source_ref: { type: "string" }, ...routeProperties, history_period: routeHistoryPeriod, page, history: { type: "array", items: routeHistoryRow } };
    required = Object.keys(properties);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://workout.lagrangee.xyz/agent-schemas/${name}.json`,
    title: `Workout Agent ${name}`,
    type: "object",
    required,
    properties,
    additionalProperties: false,
  };
}

function objectSchema(properties, required = Object.keys(properties)) {
  return { type: "object", required, properties, additionalProperties: false };
}
