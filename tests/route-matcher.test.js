import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRegistrationProposal,
  haversineDistanceM,
  matchActivity,
  MATCHER_VERSION,
} from "../skills/workout/scripts/route-matcher.mjs";

const route = {
  route_key: "香山鸡腿线",
  sport_types: [102, 104],
  distance_range_km: [10, 14],
  direction_signatures: {
    forward: {
      start: { lat: 39.99, lon: 116.18 },
      anchor: { lat: 39.991, lon: 116.181 },
      anchor_distance_m: 300,
      start_radius_m: 150,
      anchor_radius_m: 100,
    },
    reverse: {
      start: { lat: 40, lon: 116.19 },
      anchor: { lat: 39.9998, lon: 116.1898 },
      anchor_distance_m: 300,
      start_radius_m: 150,
      anchor_radius_m: 100,
    },
  },
};

/** @param {{ lat: number, lon: number }} start @param {number} distanceM */
function points(start, distanceM = 12_230) {
  const result = [
    { ...start, distance_m: 0 },
    { lat: start.lat + 0.001, lon: start.lon + 0.001, distance_m: 300 },
  ];
  if (distanceM > 500) {
    result.push({ lat: start.lat + 0.0098, lon: start.lon + 0.0098, distance_m: distanceM - 200 });
  }
  result.push({ lat: start.lat + 0.01, lon: start.lon + 0.01, distance_m: distanceM });
  return result;
}

function reversePoints(distanceM = 12_230) {
  return [
    { lat: 40, lon: 116.19, distance_m: 0 },
    { lat: 39.9998, lon: 116.1898, distance_m: 300 },
    { lat: 39.991, lon: 116.181, distance_m: distanceM - 300 },
    { lat: 39.99, lon: 116.18, distance_m: distanceM },
  ];
}

test("matches one direction from the starting GPS range", () => {
  const result = matchActivity({
    points: points({ lat: 39.9905, lon: 116.1805 }),
    routes: { schema_version: 1, routes: [route] },
    sport_type: 102,
  });

  assert.equal(result.matcher_version, MATCHER_VERSION);
  assert.equal(result.status, "matched");
  assert.equal(result.route_key, "香山鸡腿线");
  assert.equal(result.route_direction, "forward");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.registration_proposal, null);
});

test("records reverse direction when the reverse endpoint matches", () => {
  const result = matchActivity({
    points: reversePoints(),
    routes: [route],
    sport_type: 104,
  });

  assert.equal(result.status, "matched");
  assert.equal(result.route_direction, "reverse");
});

test("rejects a short activity even when its start is close", () => {
  const result = matchActivity({
    points: points({ lat: 39.99, lon: 116.18 }, 300),
    routes: [route],
    sport_type: 102,
  });

  assert.equal(result.status, "unmatched");
  assert.equal(result.route_key, null);
});

test("does not choose between multiple matching directions", () => {
  const loopRoute = {
    ...route,
    direction_signatures: {
      forward: route.direction_signatures.forward,
      reverse: { ...route.direction_signatures.forward },
    },
  };
  const result = matchActivity({
    points: points({ lat: 39.99, lon: 116.18 }),
    routes: [loopRoute],
    sport_type: 102,
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.route_key, null);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.registration_proposal, null);
});

test("proposes direction signatures from the observed endpoints and 200m anchors", () => {
  const activityPoints = points({ lat: 39.5, lon: 116.5 }, 12_230);
  const result = matchActivity({
    points: activityPoints,
    routes: [],
    sport_type: 102,
  });

  assert.equal(result.status, "unmatched");
  assert.equal(result.route_key, null);
  assert.deepEqual(result.registration_proposal, {
    sport_types: [102],
    distance_range_km: [11.01, 13.45],
    direction_signatures: {
      forward: {
        start: { lat: 39.5, lon: 116.5 },
        anchor: { lat: 39.501, lon: 116.501 },
        anchor_distance_m: 200,
        start_radius_m: 150,
        anchor_radius_m: 100,
      },
      reverse: {
        start: { lat: 39.51, lon: 116.51 },
        anchor: { lat: 39.5098, lon: 116.5098 },
        anchor_distance_m: 200,
        start_radius_m: 150,
        anchor_radius_m: 100,
      },
    },
  });
});

test("does not propose a new route for a short activity", () => {
  const proposal = buildRegistrationProposal({
    points: points({ lat: 39.99, lon: 116.18 }, 300),
    sport_type: 102,
  });

  assert.equal(proposal, null);
});

test("falls back to haversine distance when FIT points have no cumulative distance", () => {
  const fallbackRoute = {
    route_key: route.route_key,
    sport_types: route.sport_types,
    distance_range_km: [18, 22],
    direction_signatures: {
      forward: {
        start: { lat: 39.99, lon: 116.18 },
        anchor: { lat: 39.99, lon: 116.28 },
        anchor_distance_m: 8_500,
        start_radius_m: 150,
        anchor_radius_m: 1_000,
      },
    },
  };
  const result = matchActivity({
    points: [
      { lat: 39.99, lon: 116.18 },
      { lat: 39.99, lon: 116.28 },
      { lat: 40.09, lon: 116.28 },
    ],
    routes: [fallbackRoute],
    sport_type: 102,
  });

  assert.ok(haversineDistanceM({ lat: 39.99, lon: 116.18 }, { lat: 39.99, lon: 116.28 }) > 8_000);
  assert.equal(result.status, "matched");
});
