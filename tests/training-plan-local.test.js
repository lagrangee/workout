// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTrainingPlanLocal } from "../src/training-plan-local.js";
import { dateRange, weekdayKey } from "../src/util.js";

function strengthPrescription() {
  return {
    prescription_ref: "prescription:strength",
    title: "下肢力量",
    start_time: "08:00",
    estimated_duration_min: 45,
    blocks: [{
      block_key: "block_1",
      title: "主训练",
      exercises: [{
        occurrence_key: "squat_main",
        exercise_id: "goblet_squat",
        execution_mode: "bilateral",
        name: "高脚杯深蹲",
        definition_version: 1,
        category: "strength",
        sets: [{ set_id: "squat_1", ordinal: 1, target: { metric: "reps", value: 8 }, resistance_mode: "external_load", resistance_kg: 12, tempo: "3-1-1-0", rest_after_sec: 60 }],
      }],
    }],
  };
}

function planFixture() {
  const from = "2026-08-31";
  const to = "2026-09-13";
  const entries = dateRange(from, to).map((date) => ({ date, weekday: weekdayKey(date), kind: "no_plan", title: null, module_count: null, estimated_duration_min: null, prescription_ref: null, source_ref: `plan:${date}:no_plan` }));
  Object.assign(entries[1], { kind: "workout", title: "下肢力量", module_count: 1, estimated_duration_min: 45, prescription_ref: "prescription:strength", source_ref: `plan:${entries[1].date}:workout` });
  Object.assign(entries[2], { kind: "rest", source_ref: `plan:${entries[2].date}:rest` });
  Object.assign(entries[8], { kind: "rest", source_ref: `plan:${entries[8].date}:rest` });
  return {
    schema_version: 2,
    generated_at: "2026-09-03T02:00:00.000Z",
    data_as_of: "2026-09-03T02:00:00.000Z",
    from,
    to,
    timezone: "Asia/Shanghai",
    period: { from, to, timezone: "Asia/Shanghai", includes_from: true, includes_to: true, includes_current_date: true, current_date_may_be_incomplete: true },
    training_version: 191,
    source_ref: "plan",
    entries,
    prescriptions: { "prescription:strength": strengthPrescription() },
  };
}

test("plan2local writes stable natural-week files, an effective source, and a verified manifest", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-plan-local-"));
  try {
    const plan = planFixture();
    const manifest = await saveTrainingPlanLocal({ archiveDir, plan, savedAt: new Date("2026-09-03T02:01:00.000Z") });
    assert.equal(manifest.status, "complete");
    assert.equal(manifest.write_status, "complete");
    assert.equal(manifest.cleanup_status, "complete");
    assert.equal(manifest.projection_version, 3);
    assert.equal(manifest.readback.status, "verified");
    assert.equal(manifest.changed, true);
    assert.deepEqual(manifest.week_paths, ["plan/weeks/2026-08-31.md", "plan/weeks/2026-09-07.md"]);
    assert.deepEqual(manifest.written_paths.slice(-2), [".sync/plan2local/effective.json", ".sync/plan2local/manifest.json"]);
    assert.match(manifest.plan_digest, /^[a-f0-9]{64}$/);

    const index = await readFile(join(archiveDir, "plan/index.md"), "utf8");
    assert.match(index, /^---\nkind: workout-plan-index\n/);
    assert.match(index, /data_as_of: "2026-09-03T02:00:00.000Z"/);
    assert.match(index, /\| 当前 \| 2026-08-31 \| 2026-09-06 \| 1 \| 下肢力量 \|/);
    assert.match(index, /\| 后续 \| 2026-09-07 \| 2026-09-13 \| 0 \| 无训练安排 \|/);
    assert.doesNotMatch(index, /高脚杯深蹲/);

    const currentWeek = await readFile(join(archiveDir, manifest.week_paths[0]), "utf8");
    const futureWeek = await readFile(join(archiveDir, manifest.week_paths[1]), "utf8");
    assert.match(currentWeek, /projection_version: 3/);
    assert.match(currentWeek, /week_start: "2026-08-31"/);
    assert.match(currentWeek, /plan_role: current/);
    assert.match(currentWeek, /高脚杯深蹲/);
    assert.match(currentWeek, /8 次/);
    assert.match(currentWeek, /12 kg\/件/);
    assert.match(futureWeek, /plan_role: future/);
    assert.match(futureWeek, /休息日/);

    const source = await readFile(join(archiveDir, ".sync/plan2local/effective.json"), "utf8");
    assert.equal(source, `${JSON.stringify(plan)}\n`);
    assert.deepEqual(JSON.parse(source), plan);
    assert.deepEqual(JSON.parse(await readFile(join(archiveDir, ".sync/plan2local/manifest.json"), "utf8")), manifest);

    const second = await saveTrainingPlanLocal({ archiveDir, plan, savedAt: new Date("2026-09-03T02:02:00.000Z") });
    assert.equal(second.changed, false);
    assert.equal(second.plan_digest, manifest.plan_digest);
    assert.deepEqual(second.week_paths, manifest.week_paths);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("plan2local migrates digest-named shards and removes only prior managed files", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-plan-local-migrate-"));
  try {
    await mkdir(join(archiveDir, "plan/weeks"), { recursive: true });
    await mkdir(join(archiveDir, "data/plan"), { recursive: true });
    await mkdir(join(archiveDir, ".sync/plan2local"), { recursive: true });
    await writeFile(join(archiveDir, "plan/current.md"), "legacy\n");
    await writeFile(join(archiveDir, "data/plan/current.json"), "{}\n");
    await writeFile(join(archiveDir, ".sync/plan2local.json"), "{}\n");
    await writeFile(join(archiveDir, ".sync/plan2local/source.json"), "{}\n");
    await writeFile(join(archiveDir, "plan/weeks/user-note.md"), "keep me\n");

    const first = await saveTrainingPlanLocal({ archiveDir, plan: planFixture() });
    const legacyWeek = "plan/weeks/2026-09-07--aaaaaaaaaaaa.md";
    await writeFile(join(archiveDir, legacyWeek), "old generated revision\n");
    const priorManifest = { ...first, week_paths: [...first.week_paths, legacyWeek] };
    await writeFile(join(archiveDir, ".sync/plan2local/manifest.json"), `${JSON.stringify(priorManifest, null, 2)}\n`);
    await writeFile(join(archiveDir, ".sync/plan2local/source.json"), "{}\n");

    const second = await saveTrainingPlanLocal({ archiveDir, plan: planFixture() });
    assert.ok(second.removed_paths.includes(legacyWeek));
    assert.ok(second.removed_paths.includes(".sync/plan2local/source.json"));
    await assert.rejects(() => readFile(join(archiveDir, legacyWeek), "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(join(archiveDir, "plan/weeks/user-note.md"), "utf8"), "keep me\n");
    assert.deepEqual(second.week_paths, ["plan/weeks/2026-08-31.md", "plan/weeks/2026-09-07.md"]);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("plan2local records an empty effective Plan without inventing workouts", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-plan-local-empty-"));
  try {
    const plan = planFixture();
    plan.to = "2026-09-06";
    plan.period.to = plan.to;
    plan.entries = plan.entries.slice(0, 7).map((entry) => ({ ...entry, kind: "no_plan", title: null, module_count: null, estimated_duration_min: null, prescription_ref: null, source_ref: `plan:${entry.date}:no_plan` }));
    plan.prescriptions = {};
    const manifest = await saveTrainingPlanLocal({ archiveDir, plan });
    assert.equal(manifest.status, "none");
    assert.deepEqual(manifest.week_paths, ["plan/weeks/2026-08-31.md"]);
    assert.doesNotMatch(await readFile(join(archiveDir, manifest.week_paths[0]), "utf8"), /下肢力量/);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("plan2local rejects a non-contiguous effective source before writing", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "workout-plan-local-invalid-"));
  try {
    const plan = planFixture();
    plan.entries.splice(4, 1);
    await assert.rejects(() => saveTrainingPlanLocal({ archiveDir, plan }), /one entry per covered date/);
    await assert.rejects(() => readFile(join(archiveDir, "plan/index.md"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});
