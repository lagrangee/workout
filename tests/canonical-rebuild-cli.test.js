import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

function emptyState() {
  return {
    athlete_key: "athlete-cli",
    email: "cli@example.invalid",
    display_name: "CLI",
    timezone: "Asia/Shanghai",
    plan_revisions: [],
    sessions: [],
    aerobic_activities: [],
    routes: [],
    aerobic_projection: {},
    aerobic_date_projections: {},
    training_version: 0,
    updated_at: "2026-08-19T00:00:00.000Z",
    coach_share: null,
    agent_access: null,
    idempotency_records: [],
  };
}

test("canonical rebuild CLI generates a reviewable SQL artifact without applying it", async () => {
  const root = await mkdtemp(join(tmpdir(), "workout-canonical-rebuild-cli-"));
  const input = join(root, "state.json");
  const output = join(root, "cutover.sql");
  try {
    await writeFile(input, JSON.stringify(emptyState()), "utf8");
    const result = await execFileAsync(process.execPath, ["scripts/rebuild-canonical-d1.mjs", "--input", input, "--output", output, "--now", "2026-08-19T12:30:00.000Z"], { cwd: process.cwd() });
    const sql = await readFile(output, "utf8");
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.applied, false);
    assert.doesNotMatch(sql, /BEGIN IMMEDIATE|COMMIT;/);
    assert.match(sql, /workout_storage_cutover/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical rebuild CLI refuses an apply without the explicit cutover guard", async () => {
  const root = await mkdtemp(join(tmpdir(), "workout-canonical-rebuild-cli-guard-"));
  const input = join(root, "state.json");
  const output = join(root, "cutover.sql");
  try {
    await writeFile(input, JSON.stringify(emptyState()), "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/rebuild-canonical-d1.mjs", "--input", input, "--output", output, "--apply", "--database", "workout"], { cwd: process.cwd() }),
      /--apply requires --confirm canonical-cutover/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
