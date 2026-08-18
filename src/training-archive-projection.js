// @ts-nocheck

import { isRecord, isValidLocalDate, isValidUtcInstant } from "./util.js";
import {
  COROS_SPORT_TYPES,
  SOURCE_STATUSES,
  containsSensitiveText,
  normalizeSportType,
  normalizeTimezone,
  publishAerobicProjection,
  safeAerobicActivity,
} from "./training-archive.js";

export const MAX_AEROBIC_SYNC_BODY_BYTES = 256 * 1024;

const PROJECTION_KEYS = [
  "schema_version",
  "publication_key",
  "source_ref",
  "target_date",
  "timezone",
  "source_status",
  "source_statuses",
  "workout_source_status",
  "source_data_as_of",
  "data_as_of",
  "activities",
  "routes",
];
const SOURCE_STATUS_KEYS = ["workout", "coros"];
const ACTIVITY_KEYS = [
  "schema_version",
  "activity_ref",
  "source_ref",
  "local_date",
  "timezone",
  "started_at",
  "ended_at",
  "sport_type",
  "sport_name",
  "source_status",
  "data_as_of",
  "updated_at",
  "summary",
  "route_key",
  "route_direction",
  "route_match_status",
  "fit_status",
];
const ROUTE_KEYS = ["schema_version", "route_key", "route_name", "sport_types", "distance_range_km"];
const SUMMARY_KEYS = [
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
  "sport_metrics",
];
const NUMERIC_SUMMARY_KEYS = new Set([
  "duration_sec",
  "total_duration_sec",
  "distance_km",
  "average_heart_rate_bpm",
  "max_heart_rate_bpm",
  "calories_kcal",
  "training_load",
  "aerobic_te",
  "anaerobic_te",
]);
const ACTIVITY_STATUSES = new Set(["matched", "registered", "unmatched", "ambiguous", "ignored", "error"]);
const FIT_STATUSES = new Set(["complete", "partial", "error"]);
const MAX_ACTIVITIES = 200;
const MAX_ROUTES = 200;
const MAX_REFERENCE_LENGTH = 200;

function projectionError(message) {
  const error = new Error(message);
  error.code = "invalid_projection";
  return error;
}

function assertRecord(value, label) {
  if (!isRecord(value)) throw projectionError(`${label} must be an object`);
  return value;
}

function assertExactKeys(value, allowed, label) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw projectionError(`${label} contains unsupported fields`);
  }
}

function assertSchemaVersion(value, label) {
  if (value !== 1) throw projectionError(`${label}.schema_version must be 1`);
}

function safeReference(value, label, { required = true } = {}) {
  if (value === null && !required) return null;
  if (typeof value !== "string" || !value.trim() || value.length > MAX_REFERENCE_LENGTH || containsSensitiveText(value)) {
    throw projectionError(`${label} must be a safe reference`);
  }
  if (value !== value.trim()) throw projectionError(`${label} must not contain surrounding whitespace`);
  const reference = value.trim();
  if (reference.includes("\\") || reference.includes("\u0000") || /(?:^|\/)(?:\.\.?)(?:\/|$)/.test(reference)) {
    throw projectionError(`${label} must not contain a path`);
  }
  return reference;
}

function safeText(value, label, { required = true, max = MAX_REFERENCE_LENGTH } = {}) {
  if (value === null && !required) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max || containsSensitiveText(value)) throw projectionError(`${label} must be safe text`);
  if (value !== value.trim()) throw projectionError(`${label} must not contain surrounding whitespace`);
  return value.trim();
}

function safePathSegment(value, label) {
  const segment = safeReference(value, label);
  if (/[\\/<>:"|?*#\[\]\u0000-\u001f]/.test(segment)) throw projectionError(`${label} must be a safe path segment`);
  return segment;
}

function safeInstant(value, label, { required = false } = {}) {
  if (value === null && !required) return null;
  if (typeof value !== "string" || !isValidUtcInstant(value)) throw projectionError(`${label} must be a UTC instant or null`);
  return new Date(value).toISOString();
}

function safeStatus(value, label) {
  if (!SOURCE_STATUSES.includes(value)) throw projectionError(`${label} is unsupported`);
  return value;
}

function safeNullableNumber(value, label) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw projectionError(`${label} must be a finite number or null`);
  return value;
}

function safeMetrics(value, label, depth = 0) {
  assertRecord(value, label);
  if (depth > 3 || Object.keys(value).length > 50) throw projectionError(`${label} is too deeply nested`);
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof key !== "string" || key.length > 80 || /(?:gps|coordinate|location|latitude|longitude|(?:^|_)lat(?:_|$)|(?:^|_)lon(?:_|$)|track|polyline|geometry|point|telemetry|sensor|fit(?:_file)?|token|credential|url|export|raw)/i.test(key)) {
      throw projectionError(`${label} contains a private field`);
    }
    if (child === null || typeof child === "boolean") {
      result[key] = child;
    } else if (typeof child === "number" && Number.isFinite(child)) {
      result[key] = child;
    } else if (typeof child === "string") {
      if (child.length > 500 || containsSensitiveText(child)) throw projectionError(`${label}.${key} contains private text`);
      result[key] = child;
    } else if (isRecord(child)) {
      result[key] = safeMetrics(child, `${label}.${key}`, depth + 1);
    } else {
      throw projectionError(`${label}.${key} has an unsupported value`);
    }
  }
  return result;
}

function safeSummary(value, label) {
  const summary = assertRecord(value, label);
  assertExactKeys(summary, SUMMARY_KEYS, label);
  const normalized = {};
  for (const key of SUMMARY_KEYS) {
    const child = summary[key];
    if (key === "sport_metrics") {
      normalized[key] = safeMetrics(child, `${label}.${key}`);
    } else if (NUMERIC_SUMMARY_KEYS.has(key)) {
      normalized[key] = safeNullableNumber(child, `${label}.${key}`);
    } else {
      normalized[key] = child === null ? null : safeText(child, `${label}.${key}`, { max: 200 });
    }
  }
  return normalized;
}

function safeRoute(value, label) {
  const route = assertRecord(value, label);
  assertExactKeys(route, ROUTE_KEYS, label);
  assertSchemaVersion(route.schema_version, label);
  const routeKey = safePathSegment(route.route_key, `${label}.route_key`);
  const routeName = safeText(route.route_name, `${label}.route_name`, { max: 120 });
  if (!Array.isArray(route.sport_types) || route.sport_types.length > Object.keys(COROS_SPORT_TYPES).length) throw projectionError(`${label}.sport_types must be a bounded array`);
  const sportTypes = route.sport_types.map((value, index) => {
    let normalized;
    try { normalized = normalizeSportType(value); } catch { throw projectionError(`${label}.sport_types[${index}] is unsupported`); }
    if (value !== normalized) throw projectionError(`${label}.sport_types[${index}] must use a normalized enum value`);
    return normalized;
  });
  if (new Set(sportTypes).size !== sportTypes.length) throw projectionError(`${label}.sport_types must not contain duplicates`);
  const sortedSportTypes = [...sportTypes].sort((left, right) => left - right);
  if (sortedSportTypes.some((value, index) => value !== sportTypes[index])) throw projectionError(`${label}.sport_types must be sorted`);
  let distanceRange = null;
  if (route.distance_range_km !== null) {
    if (!Array.isArray(route.distance_range_km) || route.distance_range_km.length !== 2) throw projectionError(`${label}.distance_range_km must contain two numbers or null`);
    const minimum = safeNullableNumber(route.distance_range_km[0], `${label}.distance_range_km[0]`);
    const maximum = safeNullableNumber(route.distance_range_km[1], `${label}.distance_range_km[1]`);
    if (minimum === null || maximum === null || minimum < 0 || maximum < minimum) throw projectionError(`${label}.distance_range_km is invalid`);
    distanceRange = [minimum, maximum];
  }
  return { schema_version: 1, route_key: routeKey, route_name: routeName, sport_types: sportTypes, distance_range_km: distanceRange };
}

function safeActivity(value, targetDate, timezone, routeKeys, label) {
  const activity = assertRecord(value, label);
  assertExactKeys(activity, ACTIVITY_KEYS, label);
  assertSchemaVersion(activity.schema_version, label);
  const activityRef = safePathSegment(activity.activity_ref, `${label}.activity_ref`);
  if (activity.source_ref !== `coros:activity:${activityRef}`) throw projectionError(`${label}.source_ref is inconsistent`);
  if (activity.local_date !== targetDate || !isValidLocalDate(activity.local_date)) throw projectionError(`${label}.local_date must equal target_date`);
  if (activity.timezone !== timezone) throw projectionError(`${label}.timezone must equal the Athlete timezone`);
  const startedAt = safeInstant(activity.started_at, `${label}.started_at`);
  const endedAt = safeInstant(activity.ended_at, `${label}.ended_at`);
  const sportType = (() => {
    try { return normalizeSportType(activity.sport_type); } catch { throw projectionError(`${label}.sport_type is unsupported`); }
  })();
  if (activity.sport_type !== sportType || activity.sport_name !== COROS_SPORT_TYPES[sportType]) throw projectionError(`${label}.sport_type must use the controlled COROS enum`);
  const sourceStatus = safeStatus(activity.source_status, `${label}.source_status`);
  const dataAsOf = safeInstant(activity.data_as_of, `${label}.data_as_of`);
  const updatedAt = safeInstant(activity.updated_at, `${label}.updated_at`);
  const summary = safeSummary(activity.summary, `${label}.summary`);
  const routeKey = activity.route_key === null ? null : safePathSegment(activity.route_key, `${label}.route_key`);
  const routeDirection = activity.route_direction === null ? null : safeText(activity.route_direction, `${label}.route_direction`, { max: 20 });
  const routeMatchStatus = activity.route_match_status;
  if (!ACTIVITY_STATUSES.has(routeMatchStatus)) throw projectionError(`${label}.route_match_status is unsupported`);
  const fitStatus = activity.fit_status === null ? null : safeText(activity.fit_status, `${label}.fit_status`, { max: 20 });
  if (fitStatus !== null && !FIT_STATUSES.has(fitStatus)) throw projectionError(`${label}.fit_status is unsupported`);
  if (sportType === 101 && (routeKey !== null || routeDirection !== null || routeMatchStatus !== "ignored")) throw projectionError(`${label} indoor activity must not have a route`);
  if (routeKey !== null && !routeKeys.has(routeKey)) throw projectionError(`${label}.route_key is not in the route projection`);
  if (routeKey === null && routeDirection !== null) throw projectionError(`${label}.route_direction needs a route_key`);
  if (routeKey !== null && !["matched", "registered"].includes(routeMatchStatus)) throw projectionError(`${label}.route_match_status is inconsistent with route_key`);
  if (routeKey === null && ["matched", "registered"].includes(routeMatchStatus)) throw projectionError(`${label}.route_match_status needs a route_key`);
  if (routeDirection !== null && !["forward", "reverse"].includes(routeDirection)) throw projectionError(`${label}.route_direction is unsupported`);
  return safeAerobicActivity({
    ...activity,
    activity_ref: activityRef,
    source_ref: `coros:activity:${activityRef}`,
    local_date: targetDate,
    timezone,
    started_at: startedAt,
    ended_at: endedAt,
    sport_type: sportType,
    sport_name: COROS_SPORT_TYPES[sportType],
    source_status: sourceStatus,
    data_as_of: dataAsOf,
    updated_at: updatedAt,
    summary,
    route_key: routeKey,
    route_direction: routeDirection,
    route_match_status: routeMatchStatus,
    fit_status: fitStatus,
  });
}

function aggregateStatus(statuses) {
  if (!statuses.length || statuses.every((status) => status === "none")) return "none";
  if (statuses.every((status) => status === "complete" || status === "none")) return "complete";
  if (statuses.some((status) => status === "partial") || statuses.some((status) => status === "error" && statuses.some((other) => other === "complete" || other === "partial"))) return "partial";
  return "error";
}

/**
 * Validate and canonicalize the only write shape accepted by the private
 * aerobic projection endpoint. This boundary intentionally accepts the safe
 * projection produced by the local sync orchestrator, never a provider payload.
 */
export function normalizeAerobicProjectionForSync(value, athleteTimezone) {
  const projection = assertRecord(value, "projection");
  assertExactKeys(projection, PROJECTION_KEYS, "projection");
  assertSchemaVersion(projection.schema_version, "projection");
  if (!isValidLocalDate(projection.target_date)) throw projectionError("projection.target_date is invalid");
  const targetDate = projection.target_date;
  const publicationKey = safeReference(projection.publication_key, "projection.publication_key");
  const sourceRef = safeReference(projection.source_ref, "projection.source_ref");
  if (publicationKey !== `training-archive:${targetDate}` || sourceRef !== publicationKey) throw projectionError("projection publication identity is inconsistent");
  if (typeof projection.timezone !== "string" || projection.timezone !== projection.timezone.trim()) throw projectionError("projection.timezone must be an explicit IANA timezone");
  const timezone = normalizeTimezone(projection.timezone);
  if (timezone !== normalizeTimezone(athleteTimezone)) throw projectionError("projection.timezone must equal the Athlete timezone");
  const sourceStatus = safeStatus(projection.source_status, "projection.source_status");
  const sourceStatuses = assertRecord(projection.source_statuses, "projection.source_statuses");
  assertExactKeys(sourceStatuses, SOURCE_STATUS_KEYS, "projection.source_statuses");
  const normalizedSourceStatuses = {
    workout: safeStatus(sourceStatuses.workout, "projection.source_statuses.workout"),
    coros: safeStatus(sourceStatuses.coros, "projection.source_statuses.coros"),
  };
  const workoutSourceStatus = safeStatus(projection.workout_source_status, "projection.workout_source_status");
  if (workoutSourceStatus !== normalizedSourceStatuses.workout) throw projectionError("projection.workout_source_status is inconsistent");
  const sourceDataAsOf = assertRecord(projection.source_data_as_of, "projection.source_data_as_of");
  assertExactKeys(sourceDataAsOf, SOURCE_STATUS_KEYS, "projection.source_data_as_of");
  const normalizedSourceDataAsOf = {
    workout: safeInstant(sourceDataAsOf.workout, "projection.source_data_as_of.workout"),
    coros: safeInstant(sourceDataAsOf.coros, "projection.source_data_as_of.coros"),
  };
  const dataAsOf = safeInstant(projection.data_as_of, "projection.data_as_of");
  if (!Array.isArray(projection.routes) || projection.routes.length > MAX_ROUTES) throw projectionError("projection.routes must be a bounded array");
  const routes = projection.routes.map((route, index) => safeRoute(route, `projection.routes[${index}]`));
  const routeKeys = new Set(routes.map((route) => route.route_key));
  if (routeKeys.size !== routes.length) throw projectionError("projection.routes must not contain duplicate route_key values");
  if (!Array.isArray(projection.activities) || projection.activities.length > MAX_ACTIVITIES) throw projectionError("projection.activities must be a bounded array");
  const activities = projection.activities.map((activity, index) => safeActivity(activity, targetDate, timezone, routeKeys, `projection.activities[${index}]`));
  const activityRefs = new Set(activities.map((activity) => activity.activity_ref));
  if (activityRefs.size !== activities.length) throw projectionError("projection.activities must not contain duplicate activity_ref values");
  const expectedStatus = aggregateStatus([normalizedSourceStatuses.workout, normalizedSourceStatuses.coros]);
  if (sourceStatus !== expectedStatus) throw projectionError("projection.source_status is inconsistent");
  return {
    schema_version: 1,
    publication_key: publicationKey,
    source_ref: sourceRef,
    target_date: targetDate,
    timezone,
    source_status: sourceStatus,
    source_statuses: normalizedSourceStatuses,
    workout_source_status: workoutSourceStatus,
    source_data_as_of: normalizedSourceDataAsOf,
    data_as_of: dataAsOf,
    activities,
    routes,
  };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
export function syncAerobicProjection(state, rawBody, now = new Date()) {
  let body;
  try { body = JSON.parse(rawBody); } catch { return { error: { code: "invalid_json", message: "Request body must be valid JSON" }, status: 400, persist: false }; }
  if (!isRecord(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "projection")) return { error: { code: "invalid_projection", message: "Request body must contain one projection" }, status: 400, persist: false };
  let projection;
  try { projection = normalizeAerobicProjectionForSync(body.projection, state.timezone); } catch (error) {
    return { error: { code: "invalid_projection", message: "The aerobic projection is invalid" }, status: 400, persist: false };
  }
  const published = publishAerobicProjection(state, projection, now);
  return {
    body: {
      schema_version: 1,
      publication_key: projection.publication_key,
      target_date: projection.target_date,
      status: published.status,
      published_count: published.published_count,
      activity_count: state.aerobic_activities.length,
      route_count: state.routes.length,
      source_statuses: published.source_statuses,
      data_as_of: state.aerobic_projection.data_as_of,
    },
    status: 200,
    persist: true,
  };
}
