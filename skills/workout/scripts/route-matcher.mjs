#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ lat: number, lon: number }} Coordinate */
/** @typedef {{ lat: number, lon: number, distance_m: number|null }} NormalizedPoint */
/** @typedef {{ start: Coordinate, anchor: Coordinate, anchor_distance_m?: number, start_radius_m?: number, anchor_radius_m?: number }} RouteDirectionSignature */
/** @typedef {{ route_key: string, sport_types?: number[], distance_range_km?: number[], start_radius_m?: number, anchor_radius_m?: number, direction_signatures: { forward?: RouteDirectionSignature, reverse?: RouteDirectionSignature } }} RouteRecord */
/** @typedef {RouteRecord[] | { schema_version?: number, routes: RouteRecord[] }} RouteRegistry */
/** @typedef {{ route: RouteRecord, direction: "forward"|"reverse", start: Coordinate, anchor: Coordinate, anchor_distance_m: number, start_radius_m: number, anchor_radius_m: number, distance_range_km: [number, number]|null }} DistanceIndexEntry */
/** @typedef {{ buckets: Map<number, DistanceIndexEntry[]>, unbounded: DistanceIndexEntry[] }} DistanceIndex */
/** @typedef {{ sport_types?: number[], distance_range_km: [number, number], direction_signatures: { forward: RouteDirectionSignature, reverse: RouteDirectionSignature } }} RouteRegistrationProposal */

export const MATCHER_VERSION = "route-matcher-v1";

const EARTH_RADIUS_M = 6_371_008.8;
/** @type {Array<"forward"|"reverse">} */
const DIRECTIONS = ["forward", "reverse"];
const DEFAULT_START_RADIUS_M = 150;
const DEFAULT_ANCHOR_DISTANCE_M = 200;
const DEFAULT_ANCHOR_RADIUS_M = 100;
const DISTANCE_BUCKET_KM = 1;
const MIN_ROUTE_REGISTRATION_DISTANCE_KM = 1;
const NEW_ROUTE_DISTANCE_TOLERANCE_RATIO = 0.1;

/** @param {unknown} value */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {Record<string, unknown>|null|undefined} point */
function coordinateFromPoint(point) {
  const lat = numberOrNull(point?.lat ?? point?.latitude);
  const lon = numberOrNull(point?.lon ?? point?.longitude);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  return { lat, lon };
}

/** @param {Record<string, unknown>} start */
function coordinateFromStart(start) {
  const coordinate = coordinateFromPoint(start);
  if (!coordinate) {
    throw new Error("Each route direction needs a valid start.lat and start.lon");
  }
  return coordinate;
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** @param {Coordinate} first @param {Coordinate} second */
export function haversineDistanceM(first, second) {
  const lat1 = (first.lat * Math.PI) / 180;
  const lat2 = (second.lat * Math.PI) / 180;
  const deltaLat = lat2 - lat1;
  const deltaLon = ((second.lon - first.lon) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** @param {Array<Record<string, unknown>>} points @returns {NormalizedPoint[]} */
function normalizePoints(points) {
  if (!Array.isArray(points)) throw new Error("Activity points must be an array");

  return points.flatMap((point) => {
    const coordinate = coordinateFromPoint(point);
    if (!coordinate) return [];
    return [{
      ...coordinate,
      distance_m: numberOrNull(point.distance_m ?? point.distanceM),
    }];
  });
}

/** @param {NormalizedPoint[]} points @returns {Array<NormalizedPoint & { cumulative_distance_m: number }>} */
function cumulativePoints(points) {
  const hasProviderDistance = points.every((point, index) => {
    const previousDistance = points[index - 1]?.distance_m;
    return point.distance_m !== null && (
      index === 0 || (previousDistance !== null && previousDistance !== undefined && point.distance_m >= previousDistance)
    );
  });
  if (hasProviderDistance) {
    const origin = points[0]?.distance_m ?? 0;
    return points.map((point) => {
      const distance = point.distance_m;
      if (distance === null) throw new Error("Provider distance became invalid during normalization");
      return { ...point, cumulative_distance_m: distance - origin };
    });
  }

  let total = 0;
  return points.map((point, index) => {
    if (index > 0) total += haversineDistanceM(points[index - 1], point);
    return { ...point, cumulative_distance_m: total };
  });
}

/** @param {NormalizedPoint[]} points @param {number} targetDistanceM @returns {Coordinate|null} */
function pointAtDistance(points, targetDistanceM) {
  if (targetDistanceM < 0) return null;
  const withCumulative = cumulativePoints(points);
  const last = withCumulative.at(-1);
  if (!last || last.cumulative_distance_m < targetDistanceM) return null;
  let closest = withCumulative[0];
  let closestError = Math.abs(closest.cumulative_distance_m - targetDistanceM);
  for (const point of withCumulative) {
    const error = Math.abs(point.cumulative_distance_m - targetDistanceM);
    if (error < closestError) {
      closest = point;
      closestError = error;
    }
  }
  return { lat: closest.lat, lon: closest.lon };
}

/** @param {NormalizedPoint[]} points @param {number|null|undefined} explicitDistanceM */
function activityDistanceM(points, explicitDistanceM) {
  if (explicitDistanceM !== null && explicitDistanceM !== undefined) {
    const distance = numberOrNull(explicitDistanceM);
    if (distance !== null && distance >= 0) return distance;
  }

  return cumulativePoints(points).at(-1)?.cumulative_distance_m ?? 0;
}

/** @param {RouteRecord} route @returns {[number, number]|null} */
function routeDistanceRange(route) {
  const range = route?.distance_range_km;
  if (range === undefined || range === null) return null;
  if (!Array.isArray(range) || range.length !== 2) {
    throw new Error(`Route ${route?.route_key ?? "<unknown>"} has an invalid distance_range_km`);
  }
  const minimum = numberOrNull(range[0]);
  const maximum = numberOrNull(range[1]);
  if (minimum === null || maximum === null || minimum < 0 || maximum < minimum) {
    throw new Error(`Route ${route?.route_key ?? "<unknown>"} has an invalid distance_range_km`);
  }
  return [minimum, maximum];
}

/** @param {RouteRecord} route @returns {Array<{ direction: "forward"|"reverse", start: Coordinate, anchor: Coordinate, anchor_distance_m: number, start_radius_m: number, anchor_radius_m: number }>} */
function routeDirections(route) {
  const signatures = route?.direction_signatures;
  if (!signatures || typeof signatures !== "object") {
    throw new Error(`Route ${route?.route_key ?? "<unknown>"} needs forward/reverse direction_signatures`);
  }

  const result = DIRECTIONS.flatMap((direction) => {
    const spec = signatures[direction];
    if (spec === null || spec === undefined) return [];
    const anchorDistanceM = numberOrNull(spec.anchor_distance_m) ?? DEFAULT_ANCHOR_DISTANCE_M;
    return [{
      direction,
      start: coordinateFromStart(spec.start),
      anchor: coordinateFromStart(spec.anchor),
      anchor_distance_m: anchorDistanceM,
      start_radius_m: numberOrNull(spec.start_radius_m ?? route.start_radius_m) ?? DEFAULT_START_RADIUS_M,
      anchor_radius_m: numberOrNull(spec.anchor_radius_m ?? route.anchor_radius_m) ?? DEFAULT_ANCHOR_RADIUS_M,
    }];
  });
  if (result.length === 0) throw new Error(`Route ${route?.route_key ?? "<unknown>"} needs a forward or reverse direction`);
  return result;
}

/** @param {RouteRecord} route @param {number|null} sportType */
function routeMatchesSport(route, sportType) {
  if (sportType === null || sportType === undefined || route.sport_types === undefined) return true;
  if (!Array.isArray(route.sport_types)) {
    throw new Error(`Route ${route.route_key ?? "<unknown>"} has an invalid sport_types`);
  }
  return route.sport_types.includes(sportType);
}

/** @param {RouteRegistry} registry @returns {RouteRecord[]} */
function registryRoutes(registry) {
  const routes = Array.isArray(registry) ? registry : registry?.routes;
  if (!Array.isArray(routes)) throw new Error("Route registry must contain a routes array");
  return routes;
}

/** @param {number} distanceKm */
function distanceBucket(distanceKm) {
  return Math.floor(distanceKm / DISTANCE_BUCKET_KM);
}

/** @param {RouteRegistry} registry @returns {DistanceIndex} */
function buildDistanceIndex(registry) {
  /** @type {DistanceIndex} */
  const index = { buckets: new Map(), unbounded: [] };

  for (const route of registryRoutes(registry)) {
    if (typeof route?.route_key !== "string" || route.route_key.length === 0) {
      throw new Error("Each route needs a non-empty route_key");
    }
    const distanceRange = routeDistanceRange(route);
    for (const directionSpec of routeDirections(route)) {
      const entry = {
        route,
        direction: directionSpec.direction,
        start: directionSpec.start,
        anchor: directionSpec.anchor,
        anchor_distance_m: directionSpec.anchor_distance_m,
        start_radius_m: directionSpec.start_radius_m,
        anchor_radius_m: directionSpec.anchor_radius_m,
        distance_range_km: distanceRange,
      };
      if (distanceRange === null) {
        index.unbounded.push(entry);
        continue;
      }
      const firstBucket = distanceBucket(distanceRange[0]);
      const lastBucket = distanceBucket(distanceRange[1]);
      for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
        const entries = index.buckets.get(bucket) ?? [];
        entries.push(entry);
        index.buckets.set(bucket, entries);
      }
    }
  }
  return index;
}

/** @param {DistanceIndex} index @param {number} distanceKm @returns {DistanceIndexEntry[]} */
function selectDistanceCandidates(index, distanceKm) {
  const entries = [...(index.buckets.get(distanceBucket(distanceKm)) ?? []), ...index.unbounded];
  return entries.filter((entry) => {
    const range = entry.distance_range_km;
    return range === null || (distanceKm >= range[0] && distanceKm <= range[1]);
  });
}

/**
 * Build a user-confirmation proposal from an otherwise unmatched activity.
 * The observed start and end become the two direction starts.
 * @param {{ points: Array<Record<string, unknown>>, distance_m?: number|null, sport_type?: number|null }} input
 * @returns {RouteRegistrationProposal|null}
 */
export function buildRegistrationProposal({ points, distance_m: explicitDistanceM = null, sport_type: sportType = null }) {
  const normalizedPoints = normalizePoints(points);
  if (normalizedPoints.length < 2) return null;

  const totalDistanceM = activityDistanceM(normalizedPoints, explicitDistanceM);
  const totalDistanceKm = totalDistanceM / 1000;
  if (totalDistanceKm < MIN_ROUTE_REGISTRATION_DISTANCE_KM) return null;

  const firstPoint = normalizedPoints[0];
  const lastPoint = normalizedPoints.at(-1);
  if (!lastPoint) return null;
  const tolerance = totalDistanceKm * NEW_ROUTE_DISTANCE_TOLERANCE_RATIO;
  const forwardAnchor = pointAtDistance(normalizedPoints, DEFAULT_ANCHOR_DISTANCE_M);
  const reverseAnchor = pointAtDistance(normalizedPoints, totalDistanceM - DEFAULT_ANCHOR_DISTANCE_M);
  if (!forwardAnchor || !reverseAnchor) return null;
  /** @type {RouteRegistrationProposal} */
  const proposal = {
    distance_range_km: /** @type {[number, number]} */ ([round(Math.max(0, totalDistanceKm - tolerance)), round(totalDistanceKm + tolerance)]),
    direction_signatures: {
      forward: { start: { lat: firstPoint.lat, lon: firstPoint.lon }, anchor: forwardAnchor, anchor_distance_m: DEFAULT_ANCHOR_DISTANCE_M, start_radius_m: DEFAULT_START_RADIUS_M, anchor_radius_m: DEFAULT_ANCHOR_RADIUS_M },
      reverse: { start: { lat: lastPoint.lat, lon: lastPoint.lon }, anchor: reverseAnchor, anchor_distance_m: DEFAULT_ANCHOR_DISTANCE_M, start_radius_m: DEFAULT_START_RADIUS_M, anchor_radius_m: DEFAULT_ANCHOR_RADIUS_M },
    },
  };
  if (sportType !== null && sportType !== undefined) proposal.sport_types = [sportType];
  return proposal;
}

/**
 * @param {{ points: Array<Record<string, unknown>>, routes: RouteRegistry, distance_m?: number|null, sport_type?: number|null }} input
 */
export function matchActivity({ points, routes, distance_m: explicitDistanceM = null, sport_type: sportType = null }) {
  const normalizedPoints = normalizePoints(points);
  if (normalizedPoints.length === 0) {
    return {
      matcher_version: MATCHER_VERSION,
      status: "unmatched",
      route_key: null,
      route_direction: null,
      candidates: [],
      registration_proposal: null,
      evidence: { point_count: 0, total_distance_m: null, first_point: null, last_point: null },
    };
  }

  const firstPoint = normalizedPoints[0];
  const totalDistanceM = activityDistanceM(normalizedPoints, explicitDistanceM);
  const totalDistanceKm = totalDistanceM / 1000;
  const distanceIndex = buildDistanceIndex(routes);
  const candidates = [];

  for (const entry of selectDistanceCandidates(distanceIndex, totalDistanceKm)) {
    if (!routeMatchesSport(entry.route, sportType)) continue;
    const startDistanceM = haversineDistanceM(firstPoint, entry.start);
    if (startDistanceM > entry.start_radius_m) continue;
    const activityAnchor = pointAtDistance(normalizedPoints, entry.anchor_distance_m);
    if (!activityAnchor) continue;
    const anchorDistanceM = haversineDistanceM(activityAnchor, entry.anchor);
    if (anchorDistanceM > entry.anchor_radius_m) continue;
    candidates.push({
      route_key: entry.route.route_key,
      route_direction: entry.direction,
      start_distance_m: round(startDistanceM),
      anchor_distance_m: round(anchorDistanceM),
      total_distance_m: round(totalDistanceM),
    });
  }

  const status = candidates.length === 1 ? "matched" : candidates.length > 1 ? "ambiguous" : "unmatched";
  const match = status === "matched" ? candidates[0] : null;
  const registrationProposal = status === "unmatched"
    ? buildRegistrationProposal({ points, distance_m: explicitDistanceM, sport_type: sportType })
    : null;
  const lastPoint = normalizedPoints.at(-1);
  return {
    matcher_version: MATCHER_VERSION,
    status,
    route_key: match?.route_key ?? null,
    route_direction: match?.route_direction ?? null,
    candidates,
    registration_proposal: registrationProposal,
    evidence: {
      point_count: normalizedPoints.length,
      total_distance_m: round(totalDistanceM),
      first_point: firstPoint,
      last_point: lastPoint ?? null,
    },
  };
}

function usage() {
  return "Usage: node skills/workout/scripts/route-matcher.mjs --routes routes.json --points activity-points.json [--pretty]";
}

/** @param {string[]} argv @returns {Map<string, string|boolean>} */
function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--pretty") {
      args.set("pretty", true);
    } else if (value === "--routes" || value === "--points") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(usage());
      args.set(value.slice(2), next);
      index += 1;
    } else {
      throw new Error(usage());
    }
  }
  if (!args.has("routes") || !args.has("points")) throw new Error(usage());
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const routesPath = args.get("routes");
  const pointsPath = args.get("points");
  if (typeof routesPath !== "string" || typeof pointsPath !== "string") throw new Error(usage());
  const routes = JSON.parse(await readFile(resolve(routesPath), "utf8"));
  const activity = JSON.parse(await readFile(resolve(pointsPath), "utf8"));
  const points = Array.isArray(activity) ? activity : activity.points;
  const result = matchActivity({
    points,
    routes,
    distance_m: Array.isArray(activity) ? null : activity.distance_m,
    sport_type: Array.isArray(activity) ? null : activity.sport_type,
  });
  process.stdout.write(`${JSON.stringify(result, null, args.has("pretty") ? 2 : 0)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
