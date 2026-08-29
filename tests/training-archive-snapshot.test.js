// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSnapshot } from "../scripts/sync-training-archive-snapshot.mjs";
import { syntheticFitBytes } from "./helpers/synthetic-fit.js";

test("snapshot runner never reports local in-memory readback as cloud success", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-snapshot-"));
  try {
    const result = await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-16"],
      workoutByDate: { "2026-08-16": { source_status: "none", data_as_of: null, sessions: [] } },
      corosByDate: {
        "2026-08-16": {
          source_status: "complete",
          data_as_of: "2026-08-16T23:59:00.000Z",
          activities: [{
            labelId: "snapshot-activity",
            sportType: 100,
            startedAt: "2026-08-16T02:00:00.000Z",
            endedAt: "2026-08-16T02:35:00.000Z",
            summary: { duration_sec: 2100, distance_km: 5.25, sport_metrics: {} },
          }],
        },
      },
      agentConfigFile: "/private/tmp/workout-agent-config-not-configured-for-snapshot-test",
      capturedAt: "2026-08-17T08:00:00.000Z",
    });

    assert.equal(result.receipts[0].cloud_publication.status, "error");
    assert.equal(result.receipts[0].errors[0].code, "cloud_publisher_not_configured");
    assert.equal(result.workout_page_readback.list.items.length, 1);
    const persisted = JSON.parse(await readFile(join(archiveDir, ".sync/training-archive/2026-08-16.json"), "utf8"));
    assert.equal(persisted.cloud_publication.status, "error");
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("snapshot runner prefers the typed Agent publisher when Agent config is supplied", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-agent-snapshot-"));
  const requests = [];
  const agentToken = ["agent", "token", "not", "for", "output"].join("-");
  try {
    const agentConfigFile = join(archiveDir, "agent.env");
    await writeFile(agentConfigFile, `WORKOUT_AGENT_API_ORIGIN=https://workout.example\nWORKOUT_AGENT_TOKEN=${agentToken}\n`, "utf8");
    await chmod(agentConfigFile, 0o600);
    const result = await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-16"],
      agentConfigFile,
      workoutByDate: { "2026-08-16": { source_status: "none", data_as_of: null, sessions: [] } },
      corosByDate: { "2026-08-16": { source_status: "none", data_as_of: null, activities: [] } },
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: { ...init, headers: Object.fromEntries(new Headers(init?.headers)) } });
        const body = JSON.parse(init.body);
        return new Response(JSON.stringify({
          schema_version: 1,
          publication_key: body.projection.publication_key,
          target_date: body.projection.target_date,
          status: "none",
          published_count: 0,
          activity_count: 0,
          route_count: 0,
          source_statuses: body.projection.source_statuses,
          data_as_of: body.projection.data_as_of,
        }), { status: 200 });
      },
      capturedAt: "2026-08-17T08:00:00.000Z",
    });

    assert.equal(result.receipts[0].cloud_publication.status, "none");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://workout.example/api/agent/v1/aerobic/sync");
    assert.equal(requests[0].init.headers.authorization, `Bearer ${agentToken}`);
    assert.match(requests[0].init.headers["idempotency-key"], /^training-archive:2026-08-16:/);
    assert.doesNotMatch(requests[0].init.body, new RegExp(`${agentToken}|raw_fit|gps|telemetry`, "i"));
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("snapshot runner keeps local success when Agent config is invalid", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-invalid-agent-config-"));
  try {
    const agentConfigFile = join(archiveDir, "agent.env");
    await writeFile(agentConfigFile, "WORKOUT_AGENT_API_ORIGIN=https://workout.example\nWORKOUT_AGENT_TOKEN=agent-token-not-for-output\n", "utf8");
    await chmod(agentConfigFile, 0o644);
    const result = await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-16"],
      agentConfigFile,
      workoutByDate: { "2026-08-16": { source_status: "none", data_as_of: null, sessions: [] } },
      corosByDate: { "2026-08-16": { source_status: "none", data_as_of: null, activities: [] } },
      capturedAt: "2026-08-17T08:00:00.000Z",
    });

    assert.equal(result.receipts[0].local_archive.write_status, "complete");
    assert.equal(result.receipts[0].cloud_publication.status, "error");
    assert.equal(result.receipts[0].errors[0].code, "agent_config_invalid");
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("snapshot runner can force a local refresh when an earlier cloud retry is pending", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-snapshot-refresh-"));
  const agentConfigFile = join(archiveDir, "agent.env");
  const baseSession = {
    session_key: "sess-refresh",
    scheduled_date: "2026-08-16",
    local_date: "2026-08-16",
    source_ref: "session:2026-08-16:sess-refresh",
    title: "刷新测试",
    status: "completed",
    data_as_of: "2026-08-16T23:59:00.000Z",
    updated_at: "2026-08-16T23:58:00.000Z",
  };
  try {
    const legacy = {
      ...baseSession,
      snapshot: {
        schema_version: 1,
        blocks: [{ title: "测试", exercises: [{ name: "动作", sets: [{ target: { metric: "reps", min: 6, max: 8 } }] }] }],
      },
    };
    await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-16"],
      agentConfigFile,
      workoutByDate: { "2026-08-16": { source_status: "complete", data_as_of: baseSession.data_as_of, sessions: [legacy] } },
      corosByDate: { "2026-08-16": { source_status: "none", data_as_of: null, activities: [] } },
      capturedAt: "2026-08-17T08:00:00.000Z",
    });

    const canonical = {
      ...baseSession,
      snapshot: {
        schema_version: 2,
        title: "刷新测试",
        blocks: [{ block_key: "b1", title: "测试", exercises: [{ exercise_occurrence_key: "e1", exercise_id: "test_exercise", name: "动作", execution_mode: "none", sets: [{ set_id: "s1", ordinal: 1, target: { metric: "reps", value: 8 }, resistance_mode: "bodyweight", tempo: "3-0-1-1", rest_after_sec: 30 }] }] }],
        completion_items: [{ completion_item_key: "c1", exercise_occurrence_key: "e1", set_id: "s1", set_ordinal: 1, side: "both", target: { metric: "reps", value: 8 }, tempo: "3-0-1-1", rest_after_sec: 30 }],
      },
      set_results: [{ completion_item_key: "c1", status: "completed", actual: { metric: "reps", value: 8 } }],
    };
    const result = await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-16"],
      agentConfigFile,
      retryCloudOnly: false,
      workoutByDate: { "2026-08-16": { source_status: "complete", data_as_of: canonical.data_as_of, sessions: [canonical] } },
      corosByDate: { "2026-08-16": { source_status: "none", data_as_of: null, activities: [] } },
      capturedAt: "2026-08-17T08:01:00.000Z",
    });

    const note = await readFile(join(archiveDir, "workout/sessions/2026-08-16--sess-refresh.md"), "utf8");
    assert.equal(result.receipts[0].local_archive.write_status, "complete");
    assert.doesNotMatch(note, /min|三到八|目标 \{\"metric\":\"reps\"/);
    assert.match(note, /目标 \| 计划阻力 \| 节奏/);
    assert.match(note, /3-0-1-1/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("snapshot runner reuses a retained FIT snapshot for cloud-only retry and cleans it after completion", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-training-archive-snapshot-reuse-"));
  const bytes = syntheticFitBytes();
  let publishCalls = 0;
  try {
    const first = await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-23"],
      workoutByDate: { "2026-08-23": { source_status: "none", data_as_of: null, sessions: [] } },
      corosByDate: { "2026-08-23": { source_status: "complete", data_as_of: "2026-08-23T23:59:00.000Z", activities: [{ labelId: "snapshot-fit", sportType: 102, startedAt: "2026-08-23T08:04:02.000Z", endedAt: "2026-08-23T10:39:24.000Z", summary: { duration_sec: 9322, distance_km: 12.22, sport_metrics: {} }, fit_bytes: bytes }] } },
      publish: async () => {
        publishCalls += 1;
        throw Object.assign(new Error("temporary cloud outage"), { code: "d1_unavailable" });
      },
    });
    assert.equal(first.snapshot_retained, true);
    assert.equal((await readdir(join(archiveDir, ".sync/training-archive/snapshots"))).length, 1);

    const second = await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-23"],
      publish: async () => {
        publishCalls += 1;
        return { status: "complete", published_count: 1 };
      },
    });
    assert.equal(second.receipts[0].cloud_publication.status, "complete");
    assert.equal(second.snapshot_retained, false);
    assert.equal(publishCalls, 4);
    assert.deepEqual(await readdir(join(archiveDir, ".sync/training-archive/snapshots")), []);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});
