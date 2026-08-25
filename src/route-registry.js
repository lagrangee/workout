// @ts-nocheck

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistrationProposal, MATCHER_VERSION, matchActivity } from "../skills/workout/scripts/route-matcher.mjs";
import { COROS_SPORT_TYPES, containsSensitiveText, normalizeSportType } from "./training-archive.js";
import { writeAtomicFile } from "./atomic-file.js";

export const ROUTE_REGISTRY_SCHEMA_VERSION = 1;
export const ROUTE_REGISTRY_RELATIVE_PATH = "config/routes.json";
export const ROUTE_MATCH_STATUSES = Object.freeze(["matched", "registered", "unmatched", "ambiguous", "ignored", "error"]);

function safeRouteKey(value) {
  if (typeof value !== "string" || !value.trim() || containsSensitiveText(value)) return null;
  const key = value.trim();
  if (key.length > 120 || /[\\/<>:"|?*#\[\]\u0000-\u001f]/.test(key)) return null;
  return key;
}

function routeName(value, fallback) {
  if (typeof value !== "string" || !value.trim() || containsSensitiveText(value)) return fallback;
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
  return Number.isFinite(minimum) && Number.isFinite(maximum) && minimum >= 0 && maximum >= minimum ? [minimum, maximum] : null;
}

function safeCoordinate(value) {
  const lat = Number(value?.lat);
  const lon = Number(value?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

function safeSignature(value) {
  if (!value || typeof value !== "object") return null;
  const start = safeCoordinate(value.start);
  const anchor = safeCoordinate(value.anchor);
  if (!start || !anchor) return null;
  const anchorDistance = Number(value.anchor_distance_m);
  const startRadius = Number(value.start_radius_m);
  const anchorRadius = Number(value.anchor_radius_m);
  return {
    start,
    anchor,
    anchor_distance_m: Number.isFinite(anchorDistance) && anchorDistance >= 0 ? anchorDistance : 200,
    start_radius_m: Number.isFinite(startRadius) && startRadius >= 0 ? startRadius : 150,
    anchor_radius_m: Number.isFinite(anchorRadius) && anchorRadius >= 0 ? anchorRadius : 100,
  };
}

export function normalizeRouteRecord(value, { requireSignature = true } = {}) {
  const routeKey = safeRouteKey(value?.route_key);
  if (!routeKey) throw new Error("route_key must be a safe non-empty route identity");
  const signatures = {};
  for (const direction of ["forward", "reverse"]) {
    const signature = safeSignature(value?.direction_signatures?.[direction]);
    if (signature) signatures[direction] = signature;
  }
  if (requireSignature && !Object.keys(signatures).length) throw new Error(`Route ${routeKey} needs a direction signature`);
  return {
    route_key: routeKey,
    route_name: routeName(value?.route_name ?? value?.name, routeKey),
    sport_types: safeSportTypes(value?.sport_types),
    distance_range_km: safeDistanceRange(value?.distance_range_km),
    direction_signatures: signatures,
  };
}

export function normalizeRouteRegistry(value) {
  const routes = Array.isArray(value) ? value : value?.routes;
  if (routes === undefined) return { schema_version: ROUTE_REGISTRY_SCHEMA_VERSION, routes: [] };
  if (!Array.isArray(routes)) throw new Error("Route registry must contain a routes array");
  const unique = new Map();
  for (const route of routes) {
    const normalized = normalizeRouteRecord(route);
    unique.set(normalized.route_key, normalized);
  }
  return { schema_version: ROUTE_REGISTRY_SCHEMA_VERSION, routes: [...unique.values()] };
}

export async function readRouteRegistry(archiveDir) {
  const path = join(archiveDir, ROUTE_REGISTRY_RELATIVE_PATH);
  try {
    return { path, exists: true, registry: normalizeRouteRegistry(JSON.parse(await readFile(path, "utf8"))) };
  } catch (error) {
    if (error?.code === "ENOENT") return { path, exists: false, registry: { schema_version: ROUTE_REGISTRY_SCHEMA_VERSION, routes: [] } };
    throw error;
  }
}

export async function writeRouteRegistry(archiveDir, registry) {
  const normalized = normalizeRouteRegistry(registry);
  const path = join(archiveDir, ROUTE_REGISTRY_RELATIVE_PATH);
  await mkdir(join(archiveDir, "config"), { recursive: true });
  await writeAtomicFile(path, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return path;
}

function routeKeyFromName(value) {
  const key = safeRouteKey(value);
  if (!key) throw new Error("route name must produce a safe route_key");
  return key;
}

function pointsForActivity(raw) {
  for (const value of [raw?.fit_points, raw?.fitPoints, raw?.route_points, raw?.routePoints, raw?.fit?.points, raw?.route?.points, raw?.points]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function activityDistanceM(raw, points) {
  const explicit = Number(raw?.distance_m ?? raw?.distanceM);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const distanceKm = Number(raw?.summary?.distance_km ?? raw?.distance_km);
  if (Number.isFinite(distanceKm) && distanceKm >= 0) return distanceKm * 1000;
  return null;
}

function activitySportType(raw) {
  const value = Number(raw?.sport_type ?? raw?.sportType);
  return Number.isInteger(value) && Object.hasOwn(COROS_SPORT_TYPES, value) ? value : null;
}

function confirmationForActivity(options, activityRef) {
  const confirmations = options?.routeConfirmations;
  const specific = confirmations && typeof confirmations === "object" && !Array.isArray(confirmations) ? confirmations[activityRef] : null;
  if (specific && typeof specific === "object") return specific;
  if (typeof options?.routeName === "string") return { route_name: options.routeName, route_key: options.routeKey };
  return null;
}

/**
 * Match an outdoor activity against the human-maintained registry. The matcher
 * sees temporary FIT points only; callers persist the sanitized assignment.
 */
export function assignRoute({ raw, activityRef, registry, options = {} }) {
  const sportType = activitySportType(raw);
  if (sportType === 101) return { status: "ignored", route_key: null, route_direction: null, matcher_version: MATCHER_VERSION, registration_proposal: null };
  const routes = registry?.routes ?? [];
  const explicitKey = safeRouteKey(raw?.route_key ?? raw?.routeKey);
  if (explicitKey && routes.some((route) => route.route_key === explicitKey)) {
    return { status: "matched", route_key: explicitKey, route_direction: ["forward", "reverse"].includes(raw?.route_direction ?? raw?.routeDirection) ? (raw.route_direction ?? raw.routeDirection) : null, matcher_version: MATCHER_VERSION, registration_proposal: null };
  }
  const points = pointsForActivity(raw);
  if (points.length < 2) return { status: "unmatched", route_key: null, route_direction: null, matcher_version: MATCHER_VERSION, registration_proposal: null };
  const result = matchActivity({ points, routes, distance_m: activityDistanceM(raw, points), sport_type: sportType });
  if (result.status === "matched") return { ...result, registration_proposal: null };
  if (result.status !== "unmatched" || !result.registration_proposal) return result;
  const confirmation = confirmationForActivity(options, activityRef);
  if (!confirmation) return result;
  const requestedKey = confirmation.route_key ?? confirmation.routeKey ?? confirmation.route_name ?? confirmation.name;
  const newKey = routeKeyFromName(requestedKey);
  if (routes.some((route) => route.route_key === newKey)) return { ...result, status: "ambiguous", registration_proposal: null, error: "route_key_already_exists" };
  const proposal = result.registration_proposal;
  const created = normalizeRouteRecord({
    route_key: newKey,
    route_name: confirmation.route_name ?? confirmation.name ?? requestedKey,
    sport_types: proposal.sport_types,
    distance_range_km: proposal.distance_range_km,
    direction_signatures: proposal.direction_signatures,
  });
  registry.routes.push(created);
  return { ...result, status: "registered", route_key: newKey, route_direction: "forward", registration_proposal: null, registered_route: created };
}

/** @param {any} route */
export function safeRouteProjection(route) {
  const normalized = normalizeRouteRecord(route, { requireSignature: false });
  return {
    schema_version: 1,
    route_key: normalized.route_key,
    route_name: normalized.route_name,
    sport_types: normalized.sport_types,
    distance_range_km: normalized.distance_range_km,
  };
}

export function routeLink(routeKey) {
  const key = safeRouteKey(routeKey);
  return key ? `[[routes/${key}]]` : null;
}

export function routeFilePath(archiveDir, routeKey) {
  const key = safeRouteKey(routeKey);
  if (!key) throw new Error("route_key must be safe before building a route path");
  return join(archiveDir, "routes", `${key}.md`);
}
