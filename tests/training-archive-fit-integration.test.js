// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFitActivity } from "../src/fit-decoder.js";
import { normalizeRouteRecord, writeRouteRegistry } from "../src/route-registry.js";
import { syncTrainingArchive } from "../src/training-archive-sync.js";
import { buildRegistrationProposal } from "../skills/workout/scripts/route-matcher.mjs";
import { SYNTHETIC_FIT_ACTIVITY, syntheticFitBytes } from "./helpers/synthetic-fit.js";

test("sync decodes the public synthetic FIT before route matching and keeps GPS local", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-fit-integration-"));
  try {
    const bytes = syntheticFitBytes();
    const decoded = decodeFitActivity(bytes);
    const proposal = buildRegistrationProposal({ points: decoded.points, distance_m: decoded.metrics.distance_m, sport_type: SYNTHETIC_FIT_ACTIVITY.sport_type });
    assert.ok(proposal);
    await writeRouteRegistry(archiveDir, {
      schema_version: 1,
      routes: [normalizeRouteRecord({
        route_key: "测试轨迹",
        route_name: "测试轨迹",
        sport_types: [SYNTHETIC_FIT_ACTIVITY.sport_type],
        distance_range_km: proposal.distance_range_km,
        direction_signatures: proposal.direction_signatures,
      })],
    });

    let published;
    const receipt = await syncTrainingArchive({
      archiveDir,
      timezone: "Asia/Shanghai",
      targetDate: "2024-01-15",
      now: new Date("2024-01-16T00:00:00.000Z"),
      workoutSource: { read: async () => ({ source_status: "none", data_as_of: null, sessions: [] }) },
      corosSource: { read: async () => ({
        source_status: "complete",
        data_as_of: "2024-01-15T23:59:00.000Z",
        activities: [{
          labelId: "synthetic-activity",
          sportType: SYNTHETIC_FIT_ACTIVITY.sport_type,
          startedAt: SYNTHETIC_FIT_ACTIVITY.start_at,
          endedAt: SYNTHETIC_FIT_ACTIVITY.end_at,
          summary: { duration_sec: SYNTHETIC_FIT_ACTIVITY.duration_sec, distance_km: SYNTHETIC_FIT_ACTIVITY.distance_m / 1_000, sport_metrics: {} },
          fit_bytes: bytes,
        }],
      }) },
      publish: async (projection) => {
        published = projection;
        return { status: "complete", published_count: projection.activities.length };
      },
    });

    const record = JSON.parse(await readFile(join(archiveDir, "data/coros/2024-01-15-synthetic-activity.json"), "utf8"));
    assert.equal(receipt.phases.source_read.status, "complete");
    assert.equal(receipt.phases.fit_decode.status, "complete");
    assert.equal(receipt.phases.local_archive.status, "complete");
    assert.equal(receipt.phases.cloud_publish.status, "complete");
    assert.equal(record.route_key, "测试轨迹");
    assert.equal(record.fit_file.decode_status, "complete");
    assert.equal(published.activities[0].route_key, "测试轨迹");
    assert.doesNotMatch(JSON.stringify(published), /gps|latitude|longitude|\.fit|fit_file/i);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("a FIT decode failure keeps the downloaded artifact and summary but skips route matching", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-fit-failure-"));
  try {
    const receipt = await syncTrainingArchive({
      archiveDir,
      timezone: "Asia/Shanghai",
      targetDate: "2026-08-23",
      now: new Date("2026-08-24T00:00:00.000Z"),
      workoutSource: { read: async () => ({ source_status: "none", data_as_of: null, sessions: [] }) },
      corosSource: { read: async () => ({
        source_status: "complete",
        data_as_of: "2026-08-23T23:59:00.000Z",
        activities: [{
          labelId: "bad-fit",
          sportType: 102,
          startedAt: "2026-08-23T08:04:02.000Z",
          endedAt: "2026-08-23T10:39:24.000Z",
          summary: { duration_sec: 9322, distance_km: 12.22, sport_metrics: {} },
          fit_bytes: new Uint8Array([0, 1, 2, 3, 4]),
        }],
      }) },
      publish: async (projection) => ({ status: "complete", published_count: projection.activities.length }),
    });

    const record = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-23-bad-fit.json"), "utf8"));
    assert.equal(receipt.status, "partial");
    assert.equal(receipt.phases.fit_decode.status, "partial");
    assert.equal(receipt.route_assignments.error, 1);
    assert.equal(record.route_key, null);
    assert.equal(record.route_match_status, "error");
    assert.equal(record.fit_file.status, "complete");
    assert.equal(record.fit_file.decode_status, "error");
    assert.equal(record.summary.distance_km, 12.22);
    assert.match(JSON.stringify(receipt.errors), /fit_invalid_signature/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});
