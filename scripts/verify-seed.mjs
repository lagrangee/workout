import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { addDays, canonicalJson, weekdayKey } from "../src/util.js";
import { expandSnapshot } from "../src/plan.js";
import { appFixture, call, post, today } from "../tests/helpers.js";

const seedPath = "seed/workout-tracker-weekly-seed.json";
const seedText = await readFile(seedPath, "utf8");
const seed = JSON.parse(seedText);
const { handler, store } = appFixture();
const before = await store.getByEmail("athlete-a@example.invalid");
const revisionCountBefore = before.plan_revisions.length;

const validation = await call(handler, "/api/private/plan-updates/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package_text: seedText }) });
assert.equal(validation.response.status, 200, JSON.stringify(validation.body));
assert.equal(validation.body.preview.effective_from, seed.effective_from);
assert.deepEqual(validation.body.preview.week, seed.week);

const applied = await call(handler, "/api/private/plan-updates/apply", post({ package_text: seedText }, "seed-apply-1"));
assert.equal(applied.response.status, 201, JSON.stringify(applied.body));
const after = await store.getByEmail("athlete-a@example.invalid");
assert.equal(after.plan_revisions.length, revisionCountBefore + 1);

const plan = await call(handler, "/api/private/plan");
const readBack = plan.body.future.find((revision) => revision.effective_from === seed.effective_from);
assert.ok(readBack, "seed revision should remain visible as the next effective plan");
assert.equal(canonicalJson(readBack.week), canonicalJson(seed.week));

const expectedCounts = { monday: 9, tuesday: 10, wednesday: 9, thursday: 0, friday: 6, saturday: 6, sunday: 0 };
for (const [day, expected] of Object.entries(expectedCounts)) {
  const slot = seed.week[day];
  const actual = slot?.kind === "workout" ? expandSnapshot(slot, `seed-${day}`).completion_items.length : 0;
  assert.equal(actual, expected, `${day} Completion Item count`);
  if (slot?.kind === "workout") {
    const unilateral = expandSnapshot(slot, `seed-${day}`).completion_items.filter((item) => item.side !== "none");
    for (let index = 0; index < unilateral.length; index += 2) assert.deepEqual(unilateral.slice(index, index + 2).map((item) => item.side), ["left", "right"]);
  }
}

const schedule = await call(handler, `/api/private/schedule?from=${seed.effective_from}&to=${addDays(seed.effective_from, 6)}&expand=prescription`);
assert.equal(schedule.response.status, 200);
const expectedScheduleKinds = Array.from({ length: 7 }, (_, index) => {
  const slot = seed.week[weekdayKey(addDays(seed.effective_from, index))];
  return slot === null ? "no_plan" : slot.kind === "rest" ? "rest" : "workout";
});
assert.deepEqual(schedule.body.entries.map((entry) => entry.kind), expectedScheduleKinds);
const scheduleText = JSON.stringify(schedule.body);
for (const forbidden of ["telemetry", "symptom", "condition", "instruction", "route"]) assert.equal(scheduleText.includes(forbidden), false, forbidden);

const invalid = await call(handler, "/api/private/plan-updates/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ package_text: "{}" }) });
assert.equal(invalid.response.status, 400);
const noop = await call(handler, "/api/private/plan-updates/apply", post({ package_text: seedText }, "seed-noop"));
assert.equal(noop.response.status, 400);
assert.equal((await store.getByEmail("athlete-a@example.invalid")).plan_revisions.length, revisionCountBefore + 1);

const otherPlan = await call(handler, "/api/private/plan", {}, "athlete-b@example.invalid");
assert.equal(otherPlan.body.current, null);
assert.deepEqual(otherPlan.body.future, []);

console.log(JSON.stringify({ seed: seedPath, selected_athlete: "fixture-only", effective_from: seed.effective_from, revision_created: true, completion_item_counts: expectedCounts, schedule_kinds: schedule.body.entries.map((entry) => entry.kind), no_op_rejected: true, invalid_attempt_preserved_revision_count: true, other_athlete_isolated: true }));
