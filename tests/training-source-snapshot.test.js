// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourceSnapshot, removeSourceSnapshot, stageSourceSnapshot } from "../src/training-source-snapshot.js";
import { syntheticFitBytes } from "./helpers/synthetic-fit.js";

test("source snapshot persists normalized data and FIT artifacts, then restores them without rereading live sources", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-source-snapshot-"));
  try {
    const bytes = syntheticFitBytes();
    const staged = await stageSourceSnapshot({
      archiveDir,
      timezone: "Asia/Shanghai",
      dates: ["2026-08-23"],
      capturedAt: "2026-08-24T00:00:00.000Z",
      workoutByDate: { "2026-08-23": { source_status: "none", data_as_of: null, sessions: [] } },
      corosByDate: { "2026-08-23": { source_status: "complete", data_as_of: "2026-08-23T23:59:00.000Z", credentials: "must-not-persist", raw_mcp_envelope: { bearer_token: "must-not-persist" }, activities: [{ labelId: "fixture", fit_bytes: bytes, agent_token: "must-not-persist" }] } },
    });

    const manifestText = await readFile(join(staged.root, "manifest.json"), "utf8");
    assert.doesNotMatch(manifestText, /fit_bytes/);
    assert.doesNotMatch(manifestText, /must-not-persist/);
    assert.deepEqual([...await readdir(join(staged.root, "fit"))], ["2026-08-23-001.fit"]);

    const loaded = await loadSourceSnapshot({ archiveDir, snapshotId: staged.snapshot_id });
    assert.equal(loaded.snapshot_id, staged.snapshot_id);
    assert.deepEqual([...loaded.corosByDate["2026-08-23"].activities[0].fit_bytes], [...bytes]);
    assert.equal(loaded.corosByDate["2026-08-23"].activities[0].labelId, "fixture");

    await removeSourceSnapshot({ archiveDir, snapshotId: staged.snapshot_id });
    assert.deepEqual(await readdir(join(archiveDir, ".sync", "training-archive", "snapshots")), []);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});
