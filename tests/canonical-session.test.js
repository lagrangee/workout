import test from "node:test";
import assert from "node:assert/strict";
import { WEEKDAYS, weekdayKey } from "../src/util.js";
import { appFixture, call, TEST_NOW, today } from "./helpers.js";

function currentCanonicalRevision() {
  /** @param {string} set_id @param {number} value @param {string|null} [tempo] @param {string} [resistance_mode] @param {number|null} [resistance_kg] */
  const set = (set_id, value, tempo = null, resistance_mode = "bodyweight", resistance_kg = null) => ({ set_id, ordinal: 1, target: { metric: "reps", value }, resistance_mode, resistance_kg, tempo, rest_after_sec: 30 });
  const exercises = [
    { occurrence_key: "push_up_main", exercise_id: "push_up", execution_mode: "none", name: "俯卧撑", definition_version: 1, sets: [set("push_up_set_1", 8)] },
    { occurrence_key: "glute_bridge_main", exercise_id: "glute_bridge", execution_mode: "bilateral", name: "徒手臀桥", definition_version: 1, sets: [set("glute_bridge_set_1", 10, "2-1-2-1")] },
    { occurrence_key: "side_plank_main", exercise_id: "side_plank", execution_mode: "per_side", name: "侧平板", definition_version: 1, sets: [{ ...set("side_plank_set_1", 30), target: { metric: "duration_sec", value: 30 } }] },
  ];
  return {
    revision_key: "rev-canonical-session",
    revision_sequence: 1,
    created_at: TEST_NOW,
    effective_from: "2026-01-01",
    week: Object.fromEntries(WEEKDAYS.map((day) => [day, day === weekdayKey(today) ? { kind: "workout", title: "核心快训", start_time: "21:00", estimated_duration_min: 20, blocks: [{ title: "主训练", exercises }] } : null])),
  };
}

test("Session creation freezes the canonical prescription and expands core side modes deterministically", async () => {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  state.plan_revisions = [currentCanonicalRevision()];
  await fixture.store.save(state);

  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, { method: "POST", headers: { "Idempotency-Key": "canonical-session-start" }, body: "{}" });
  assert.equal(started.response.status, 201);
  assert.equal(started.body.plan_revision_key, "rev-canonical-session");
  assert.equal(started.body.snapshot.blocks[0].exercises[0].exercise_id, "push_up");
  assert.equal(started.body.snapshot.blocks[0].exercises[1].definition_version, 1);
  assert.equal(started.body.snapshot.blocks[0].exercises[1].sets[0].tempo, "2-1-2-1");

  const sides = started.body.snapshot.completion_items.map(/** @param {any} item */ (item) => item.side);
  assert.deepEqual(sides, ["none", "both", "left", "right"]);
  assert.deepEqual(started.body.snapshot.completion_items.map(/** @param {any} item */ (item) => item.target), [
    { metric: "reps", value: 8 },
    { metric: "reps", value: 10 },
    { metric: "duration_sec", value: 30 },
    { metric: "duration_sec", value: 30 },
  ]);
});

test("Session snapshot retains its own Exercise name/version after the source Plan object changes", async () => {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const revision = currentCanonicalRevision();
  state.plan_revisions = [revision];
  await fixture.store.save(state);
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, { method: "POST", headers: { "Idempotency-Key": "canonical-session-snapshot" }, body: "{}" });
  assert.equal(started.response.status, 201);
  const before = structuredClone(started.body.snapshot);

  const changed = await fixture.store.getByEmail("athlete-a@example.invalid");
  changed.plan_revisions[0].week[weekdayKey(today)].blocks[0].exercises[0].name = "被修改的名称";
  changed.plan_revisions[0].week[weekdayKey(today)].blocks[0].exercises[0].definition_version = 2;
  await fixture.store.save(changed);
  const detail = await call(fixture.handler, `/api/private/sessions/${started.body.session_key}`);
  assert.deepEqual(detail.body.snapshot, before);
});
