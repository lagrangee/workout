// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSnapshot } from "../scripts/sync-training-archive-snapshot.mjs";

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
  try {
    const result = await runSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-16"],
      agentApiOrigin: "https://workout.example",
      agentToken: "agent-token-not-for-output",
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
    assert.equal(requests[0].init.headers.authorization, "Bearer agent-token-not-for-output");
    assert.match(requests[0].init.headers["idempotency-key"], /^training-archive:2026-08-16:/);
    assert.doesNotMatch(requests[0].init.body, /agent-token-not-for-output|raw_fit|gps|telemetry/i);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});
