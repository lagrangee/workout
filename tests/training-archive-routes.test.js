// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncTrainingArchive } from "../src/training-archive-sync.js";

const now = new Date("2026-08-17T08:00:00.000Z");

const route = {
  route_key: "香山鸡腿线",
  route_name: "香山鸡腿线",
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

function points(start, distanceM = 12_230) {
  return [
    { ...start, distance_m: 0 },
    { lat: start.lat + 0.001, lon: start.lon + 0.001, distance_m: 300 },
    { lat: start.lat + 0.0098, lon: start.lon + 0.0098, distance_m: distanceM - 200 },
    { lat: start.lat + 0.01, lon: start.lon + 0.01, distance_m: distanceM },
  ];
}

function activity(overrides = {}) {
  return {
    labelId: "coros-route-1",
    sportType: 102,
    startedAt: "2026-08-16T02:00:00.000Z",
    endedAt: "2026-08-16T04:00:00.000Z",
    fit_status: "complete",
    fit_points: points({ lat: 39.9905, lon: 116.1805 }),
    summary: { duration_sec: 7200, distance_km: 12.23, average_heart_rate_bpm: 148, calories_kcal: 800, sport_metrics: {} },
    ...overrides,
  };
}

function options(archiveDir, activityValue, extra = {}) {
  return {
    archiveDir,
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-16",
    now,
    workoutSource: { read: async () => ({ source_status: "none", data_as_of: null, sessions: [] }) },
    corosSource: { read: async () => ({ source_status: "complete", data_as_of: "2026-08-16T23:59:00.000Z", activities: [activityValue] }) },
    publish: async (projection) => ({ status: "complete", published_count: projection.activities.length }),
    ...extra,
  };
}

test("sync assigns a unique existing route and writes a linked route record with history", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-route-sync-"));
  try {
    await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(join(archiveDir, "config"), { recursive: true }).then(() => writeFile(join(archiveDir, "config/routes.json"), JSON.stringify({ schema_version: 1, routes: [route] }))));
    const receipt = await syncTrainingArchive(options(archiveDir, activity()));
    const record = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-route-1.json"), "utf8"));
    const note = await readFile(join(archiveDir, "data/coros/2026-08-16-coros-route-1.md"), "utf8");
    const routeNote = await readFile(join(archiveDir, "routes/香山鸡腿线.md"), "utf8");
    assert.equal(record.route_key, "香山鸡腿线");
    assert.equal(record.route_direction, "forward");
    assert.match(note, /\[\[routes\/香山鸡腿线\]\]/);
    assert.match(routeNote, /kind: route/);
    assert.match(routeNote, /coros-route-1/);
    assert.equal(receipt.route_assignments.matched, 1);
    assert.equal(receipt.route_assignments.ambiguous, 0);
    assert.doesNotMatch(JSON.stringify(record), /39\.99|116\.18/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("sync leaves unmatched, ambiguous, and indoor activities without invented routes", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-route-sync-"));
  try {
    await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(join(archiveDir, "config"), { recursive: true }).then(() => writeFile(join(archiveDir, "config/routes.json"), JSON.stringify({ schema_version: 1, routes: [route, { ...route, route_key: "相同起点", route_name: "相同起点", direction_signatures: { forward: route.direction_signatures.forward } }] }))));
    const unmatchedReceipt = await syncTrainingArchive(options(archiveDir, activity({ labelId: "coros-unmatched", fit_points: points({ lat: 39.5, lon: 116.5 }) })));
    const ambiguousReceipt = await syncTrainingArchive(options(archiveDir, activity({ labelId: "coros-ambiguous" })));
    const indoorReceipt = await syncTrainingArchive(options(archiveDir, activity({ labelId: "coros-indoor", sportType: 101, fit_points: points({ lat: 39.9905, lon: 116.1805 }), route_key: "must-not-attach" })));
    assert.equal(unmatchedReceipt.route_assignments.unmatched, 1);
    assert.equal(ambiguousReceipt.route_assignments.ambiguous, 1);
    assert.equal(indoorReceipt.route_assignments.ignored, 1);
    const unmatched = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-unmatched.json"), "utf8"));
    const ambiguous = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-ambiguous.json"), "utf8"));
    const indoor = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-indoor.json"), "utf8"));
    assert.equal(unmatched.route_key, null);
    assert.equal(unmatched.route_direction, null);
    assert.equal(ambiguous.route_key, null);
    assert.equal(ambiguous.route_direction, null);
    assert.equal(indoor.route_key, null);
    assert.equal(indoor.route_direction, null);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("sync registers a new route only after an explicit route name", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-route-sync-"));
  try {
    const receipt = await syncTrainingArchive(options(archiveDir, activity({ labelId: "coros-new-route", fit_points: points({ lat: 39.5, lon: 116.5 }) }), { routeName: "西山环线" }));
    const registry = JSON.parse(await readFile(join(archiveDir, "config/routes.json"), "utf8"));
    const record = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-new-route.json"), "utf8"));
    assert.equal(registry.routes.length, 1);
    assert.equal(registry.routes[0].route_key, "西山环线");
    assert.equal(record.route_key, "西山环线");
    assert.equal(record.route_direction, "forward");
    assert.equal(receipt.route_assignments.registered, 1);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("route history keeps prior dates and stays idempotent across reruns", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-route-history-"));
  try {
    await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(join(archiveDir, "config"), { recursive: true }).then(() => writeFile(join(archiveDir, "config/routes.json"), JSON.stringify({ schema_version: 1, routes: [route] }))));
    await syncTrainingArchive(options(archiveDir, activity({ labelId: "coros-route-old", startedAt: "2026-08-15T02:00:00.000Z", endedAt: "2026-08-15T04:00:00.000Z" }), { targetDate: "2026-08-15" }));
    await syncTrainingArchive(options(archiveDir, activity({ labelId: "coros-route-new" }), { targetDate: "2026-08-16" }));
    await syncTrainingArchive(options(archiveDir, activity({ labelId: "coros-route-new" }), { targetDate: "2026-08-16" }));
    const routeNote = await readFile(join(archiveDir, "routes/香山鸡腿线.md"), "utf8");
    const historyLines = routeNote.split("\n").filter((line) => line.includes(" · "));
    assert.equal(historyLines.filter((line) => line.includes("coros-route-old")).length, 1);
    assert.equal(historyLines.filter((line) => line.includes("coros-route-new")).length, 1);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});
