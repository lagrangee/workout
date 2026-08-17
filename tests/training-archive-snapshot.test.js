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
