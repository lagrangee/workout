// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeCorosActivity, publishAerobicProjection } from "../src/training-archive.js";
import { syncTrainingArchive } from "../src/training-archive-sync.js";

const firstNow = new Date("2026-08-17T08:00:00.000Z");

function activity(overrides = {}) {
  return {
    labelId: "coros-reliable-1",
    sportType: 100,
    startedAt: "2026-08-16T02:00:00.000Z",
    endedAt: "2026-08-16T02:35:00.000Z",
    summary: {
      duration_sec: 2100,
      distance_km: 5.25,
      average_heart_rate_bpm: 142,
      calories_kcal: null,
      sport_metrics: { average_pace_sec_per_km: 400 },
    },
    ...overrides,
  };
}

function syncOptions(archiveDir, overrides = {}) {
  return {
    archiveDir,
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-16",
    now: firstNow,
    workoutSource: { read: async () => ({ source_status: "none", data_as_of: null, sessions: [] }) },
    corosSource: { read: async () => ({ source_status: "complete", data_as_of: "2026-08-16T23:59:00.000Z", activities: [activity()] }) },
    publish: async () => ({ status: "complete", published_count: 1 }),
    ...overrides,
  };
}

test("ticket 02 keeps a local success and retries only the missing cloud publication", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-retry-"));
  let sourceReads = 0;
  let publishCalls = 0;
  try {
    const sources = {
      workoutSource: { read: async () => { sourceReads += 1; return { source_status: "none", data_as_of: null, sessions: [] }; } },
      corosSource: { read: async () => { sourceReads += 1; return { source_status: "complete", data_as_of: "2026-08-16T23:59:00.000Z", activities: [activity()] }; } },
    };
    const first = await syncTrainingArchive(syncOptions(archiveDir, {
      ...sources,
      publish: async () => {
        publishCalls += 1;
        const error = new Error("D1 temporarily unavailable");
        error.code = "d1_unavailable";
        throw error;
      },
    }));

    assert.equal(first.local_archive.status, "complete");
    assert.equal(first.cloud_publication.status, "error");
    assert.equal(first.cloud_publication.retryable, true);
    assert.equal(first.records_written.activities, 1);
    assert.equal(first.records_published.activities, 0);

    const second = await syncTrainingArchive(syncOptions(archiveDir, {
      ...sources,
      now: new Date("2026-08-17T09:00:00.000Z"),
      publish: async (projection, context) => {
        publishCalls += 1;
        assert.equal(projection.publication_key, "training-archive:2026-08-16");
        assert.equal(context.idempotency_key, "training-archive:2026-08-16");
        return { status: "complete", published_count: projection.activities.length };
      },
    }));

    assert.equal(sourceReads, 2, "the cloud-only retry must not reread either source");
    assert.equal(publishCalls, 2);
    assert.equal(second.local_archive.status, "complete");
    assert.equal(second.local_archive.reused, true);
    assert.equal(second.cloud_publication.status, "complete");
    assert.equal(second.cloud_publication.retried, true);
    assert.equal(second.records_written.activities, 0);
    assert.equal(second.records_published.activities, 1);

    const daily = await readFile(join(archiveDir, "daily/2026-08-16.md"), "utf8");
    assert.equal((daily.match(/\[\[data\/coros\/2026-08-16-coros-reliable-1\]\]/g) || []).length, 1);
    const syncDir = await readdir(join(archiveDir, ".sync", "training-archive"));
    assert.deepEqual(syncDir, ["2026-08-16.json"]);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 02 exposes FIT/detail/lap partial state without inventing missing values", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-partial-"));
  let projection;
  try {
    const receipt = await syncTrainingArchive(syncOptions(archiveDir, {
      workoutSource: { read: async () => { throw Object.assign(new Error("Workout source unavailable"), { code: "workout_unavailable" }); } },
      corosSource: { read: async () => ({
        source_status: "partial",
        data_as_of: "2026-08-16T23:59:00.000Z",
        errors: [{ code: "detail_lap_partial", message: "detail/lap response incomplete" }],
        activities: [activity({
          detail_status: "partial",
          lap_status: "partial",
          fit_status: "error",
          fit_error: { code: "fit_download_failed", message: "FIT download failed" },
          summary: { duration_sec: null, distance_km: null, average_heart_rate_bpm: null, calories_kcal: null, sport_metrics: {} },
        })],
      }) },
      publish: async (value) => { projection = value; return { status: "complete", published_count: 1 }; },
    }));

    assert.equal(receipt.status, "partial");
    assert.equal(receipt.source_status.workout, "error");
    assert.equal(receipt.source_status.coros, "partial");
    assert.equal(receipt.local_archive.status, "partial");
    assert.equal(receipt.cloud_publication.status, "complete");
    assert.equal(receipt.records_written.activities, 1);
    assert.equal(receipt.records_published.activities, 1);
    assert.equal(projection.source_status, "partial");
    assert.deepEqual(projection.source_statuses, { workout: "error", coros: "partial" });
    assert.equal(projection.activities[0].source_status, "partial");
    assert.equal(projection.activities[0].fit_status, "error");
    assert.equal(projection.activities[0].summary.distance_km, null);
    assert.equal(projection.activities[0].summary.average_heart_rate_bpm, null);

    const activityRecord = await readFile(join(archiveDir, "data/coros/2026-08-16-coros-reliable-1.json"), "utf8");
    const daily = await readFile(join(archiveDir, "daily/2026-08-16.md"), "utf8");
    assert.match(activityRecord, /"fit_file"/);
    assert.match(activityRecord, /"status": "error"/);
    assert.doesNotMatch(activityRecord, /raw_fit|gps|telemetry/);
    assert.doesNotMatch(daily, /0\.00 km/);
    assert.match(daily, /Workout source unavailable/);
    assert.match(daily, /FIT download failed/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 02 publishes a successful none result without creating duplicate projections", async () => {
  const state = {
    aerobic_activities: [],
    aerobic_projection: { schema_version: 1, source_status: "none", activity_count: 0 },
  };
  const projection = {
    schema_version: 1,
    publication_key: "training-archive:2026-08-16",
    source_status: "none",
    source_statuses: { workout: "none", coros: "none" },
    activities: [],
  };
  const first = publishAerobicProjection(state, projection, firstNow);
  const second = publishAerobicProjection(state, projection, firstNow);

  assert.equal(first.status, "none");
  assert.equal(second.status, "none");
  assert.equal(state.aerobic_activities.length, 0);
  assert.equal(state.aerobic_projection.source_status, "none");
  assert.deepEqual(state.aerobic_projection.source_statuses, { workout: "none", coros: "none" });
});

test("ticket 02 bounds cloud publication attempts and redacts private source errors", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-privacy-"));
  let publishCalls = 0;
  try {
    const receipt = await syncTrainingArchive(syncOptions(archiveDir, {
      maxPublicationAttempts: 2,
      workoutSource: { read: async () => ({ source_status: "complete", data_as_of: "2026-08-16T23:59:00.000Z", sessions: [] }) },
      corosSource: { read: async () => ({
        source_status: "error",
        errors: [{ code: "coros_failed", message: "Bearer secret-token at /Users/clawd/private-vault/activity.fit GPS payload" }],
        activities: [],
      }) },
      publish: async () => {
        publishCalls += 1;
        throw Object.assign(new Error("Agent Token abc at /Users/clawd/private-vault"), { code: "d1_failed" });
      },
    }));

    assert.equal(publishCalls, 2);
    assert.equal(receipt.cloud_publication.status, "error");
    assert.equal(receipt.cloud_publication.attempts, 2);
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /secret-token|Agent Token abc|\/Users\/clawd\/private-vault|activity\.fit|GPS payload/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 02 retries only a missing FIT artifact without rereading sources", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-fit-retry-"));
  let sourceReads = 0;
  let fitReads = 0;
  try {
    const first = await syncTrainingArchive(syncOptions(archiveDir, {
      corosSource: { read: async () => ({
        source_status: "partial",
        data_as_of: "2026-08-16T23:59:00.000Z",
        activities: [activity({ fit_status: "error", fit_error: { code: "fit_download_failed", message: "temporary FIT failure" } })],
      }) },
      publish: async () => ({ status: "complete", published_count: 1 }),
    }));
    assert.deepEqual(first.pending_artifacts.map((item) => item.kind), ["fit"]);

    const second = await syncTrainingArchive(syncOptions(archiveDir, {
      workoutSource: { read: async () => { throw new Error("workout source must not be reread"); } },
      corosSource: {
        read: async () => { sourceReads += 1; throw new Error("COROS source must not be reread"); },
        readFit: async () => { fitReads += 1; return new Uint8Array([1, 2, 3]); },
      },
      publish: async () => { throw new Error("cloud publication was already complete"); },
      now: new Date("2026-08-17T09:00:00.000Z"),
    }));

    assert.equal(sourceReads, 0);
    assert.equal(fitReads, 1);
    assert.deepEqual(second.pending_artifacts, []);
    assert.equal(second.records_written.activities, 0);
    assert.equal(second.local_archive.reused, true);
    assert.equal(JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-reliable-1.json"), "utf8")).fit_file.status, "complete");
    assert.deepEqual([...await readFile(join(archiveDir, "data/coros/2026-08-16-coros-reliable-1.fit"))], [1, 2, 3]);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 02 treats an absent source adapter as error rather than none", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-source-error-"));
  try {
    const receipt = await syncTrainingArchive(syncOptions(archiveDir, {
      workoutSource: undefined,
      corosSource: { read: async () => ({ source_status: "none", data_as_of: null, activities: [] }) },
      publish: async () => ({ status: "none", published_count: 0 }),
    }));
    assert.equal(receipt.source_status.workout, "error");
    assert.equal(receipt.status, "error");
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 02 preserves a previous complete activity when a rerun is partial", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-preserve-"));
  try {
    const options = syncOptions(archiveDir, {
      publish: async () => ({ status: "complete", published_count: 1 }),
    });
    await syncTrainingArchive(options);
    const rerun = await syncTrainingArchive({
      ...options,
      corosSource: { read: async () => ({
        source_status: "partial",
        data_as_of: "2026-08-16T23:59:00.000Z",
        activities: [activity({ summary: { distance_km: null, duration_sec: null, average_heart_rate_bpm: null, calories_kcal: null, sport_metrics: {} } })],
      }) },
    });
    assert.equal(rerun.records_written.activities, 0);
    const record = JSON.parse(await readFile(join(archiveDir, "data/coros/2026-08-16-coros-reliable-1.json"), "utf8"));
    assert.equal(record.summary.distance_km, 5.25);
    assert.equal(rerun.cloud_publication.status, "complete");
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("ticket 02 rejects unsafe timezone and FIT paths instead of repairing them", async () => {
  await assert.rejects(
    syncTrainingArchive(syncOptions("/tmp/training-archive-validation", { timezone: "/Users/clawd/private-vault" })),
    /timezone must be a valid/
  );
  assert.throws(() => normalizeCorosActivity(activity({ fit_file: { status: "partial", relative_path: "/Users/clawd/private-vault/activity.fit" } }), {
    timezone: "Asia/Shanghai",
    targetDate: "2026-08-16",
  }), /FIT relative_path must be a safe/);
});
