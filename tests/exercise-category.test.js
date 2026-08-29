import test from "node:test";
import assert from "node:assert/strict";
import { exerciseRegistry, validateExerciseRegistryDocument } from "../src/exercise-registry.js";
import { WEEKDAYS, weekdayKey } from "../src/util.js";
import { appFixture, call, json, post, today } from "./helpers.js";

const CATEGORY_VALUES = new Set(["strength", "endurance", "mobility", "recovery"]);

/** @returns {any} */
function canonicalPackage() {
  return {
    schema_version: 2,
    effective_from: "2099-01-05",
    week: Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, weekday === "monday" ? {
      kind: "workout",
      title: "核心训练",
      start_time: "08:00",
      estimated_duration_min: 20,
      blocks: [{
        title: "主训练",
        exercises: [{
          occurrence_key: "dead_bug_main",
          exercise_id: "dead_bug",
          execution_mode: "alternating",
          sets: [{
            set_id: "dead_bug_set_1",
            ordinal: 1,
            target: { metric: "reps", value: 5 },
            resistance: { mode: "bodyweight" },
            tempo: "3-1-1-0",
            rest_after_sec: 45,
          }],
        }],
      }],
    } : null])),
  };
}

/** @param {{ date: string, sessionKey: string, category: string, sessionStatus: string, resultStatus?: string | null }} options */
function historicalSession({ date, sessionKey, category, sessionStatus, resultStatus = null }) {
  const occurrenceKey = `${sessionKey}_exercise`;
  const completionItemKey = `${sessionKey}_item`;
  return {
    session_key: sessionKey,
    scheduled_date: date,
    local_date: date,
    status: sessionStatus,
    title: "历史训练",
    updated_at: `${date}T10:00:00.000Z`,
    snapshot: {
      schema_version: 2,
      blocks: [{
        title: "主训练",
        exercises: [{
          exercise_occurrence_key: occurrenceKey,
          occurrence_key: occurrenceKey,
          exercise_id: "dead_bug",
          name: "死虫",
          definition_version: 1,
          category,
          execution_mode: "none",
          sets: [],
        }],
      }],
      completion_items: [{
        completion_item_key: completionItemKey,
        exercise_occurrence_key: occurrenceKey,
        occurrence_key: occurrenceKey,
        set_id: `${sessionKey}_set`,
        set_key: `${sessionKey}_set`,
        side: "none",
        target: { metric: "reps", value: 5 },
      }],
      exercise_occurrence_keys: [occurrenceKey],
    },
    completion_results: resultStatus === null ? [] : [{
      completion_item_key: completionItemKey,
      status: resultStatus,
      actual: resultStatus === "skipped" ? null : { metric: "reps", value: 5 },
    }],
    training_intervals: [],
    session_rpe: null,
  };
}

test("Exercise Registry requires one controlled category instead of inferring it from identity", () => {
  const registry = exerciseRegistry();
  assert.ok(registry.exercises.every(/** @param {any} exercise */ (exercise) => CATEGORY_VALUES.has(exercise.category)));

  const missing = structuredClone(registry.exercises[0]);
  delete missing.category;
  const missingResult = validateExerciseRegistryDocument({ schema_version: 1, exercises: [missing] });
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.errors.join(" "), /category/);

  const ambiguous = structuredClone(registry.exercises[0]);
  ambiguous.category = "core";
  const ambiguousResult = validateExerciseRegistryDocument({ schema_version: 1, exercises: [ambiguous] });
  assert.equal(ambiguousResult.ok, false);
  assert.match(ambiguousResult.errors.join(" "), /category/);
});

test("Plan Update v2 derives category from the Registry and rejects caller-owned category", async () => {
  const { handler } = appFixture();
  const packageValue = canonicalPackage();
  const validated = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: JSON.stringify(packageValue) }));
  assert.equal(validated.response.status, 200);
  assert.equal(validated.body.preview.week.monday.blocks[0].exercises[0].category, "strength");

  packageValue.week.monday.blocks[0].exercises[0].category = "mobility";
  const callerOwned = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: JSON.stringify(packageValue) }));
  assert.equal(callerOwned.response.status, 400);
  assert.equal(callerOwned.body.error.code, "invalid_plan_package");
  assert.ok(callerOwned.body.error.details.some(/** @param {any} detail */ (detail) => detail.path.endsWith("/category")));
});

test("historical Plan and Session retain their frozen category when the current Registry meaning differs", async () => {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const currentDefinition = exerciseRegistry().exercises.find(/** @param {any} exercise */ (exercise) => exercise.exercise_id === "dead_bug");
  assert.equal(currentDefinition.category, "strength");

  const packageValue = canonicalPackage();
  const slot = packageValue.week.monday;
  slot.blocks[0].exercises[0] = {
    occurrence_key: "dead_bug_main",
    exercise_id: "dead_bug",
    execution_mode: "alternating",
    name: "死虫",
    definition_version: 1,
    category: "mobility",
    sets: [{ set_id: "dead_bug_set_1", ordinal: 1, target: { metric: "reps", value: 5 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: "3-1-1-0", rest_after_sec: 45 }],
  };
  state.plan_revisions = [{
    revision_key: "rev-category",
    revision_sequence: 1,
    created_at: `${today}T00:00:00.000Z`,
    effective_from: today,
    week: Object.fromEntries(WEEKDAYS.map((weekday) => [weekday, weekday === weekdayKey(today) ? slot : null])),
  }];
  await fixture.store.save(state);

  const plan = await call(fixture.handler, "/api/private/plan");
  assert.equal(plan.body.current.week[weekdayKey(today)].blocks[0].exercises[0].category, "mobility");

  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "category-snapshot-start"));
  assert.equal(started.response.status, 201);
  assert.equal(started.body.snapshot.blocks[0].exercises[0].category, "mobility");

  const detail = await call(fixture.handler, `/api/private/sessions/${started.body.session_key}`);
  assert.equal(detail.body.snapshot.blocks[0].exercises[0].category, "mobility");
});

test("Strength Training Day counts only completed strength results on terminal training Sessions", async () => {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  const completedStrength = historicalSession({ date: "2026-08-01", sessionKey: "strength-completed", category: "strength", sessionStatus: "completed", resultStatus: "completed" });
  completedStrength.snapshot.completion_items.push({
    ...completedStrength.snapshot.completion_items[0],
    completion_item_key: "strength-completed-item-2",
    set_id: "strength-completed-set-2",
    set_key: "strength-completed-set-2",
  });
  completedStrength.completion_results.push({
    ...completedStrength.completion_results[0],
    completion_item_key: "strength-completed-item-2",
  });
  state.sessions = [
    completedStrength,
    historicalSession({ date: "2026-08-02", sessionKey: "strength-in-partial-session", category: "strength", sessionStatus: "partial", resultStatus: "completed" }),
    historicalSession({ date: "2026-08-03", sessionKey: "partial-result", category: "strength", sessionStatus: "partial", resultStatus: "partial" }),
    historicalSession({ date: "2026-08-04", sessionKey: "historical-mobility", category: "mobility", sessionStatus: "completed", resultStatus: "completed" }),
    historicalSession({ date: "2026-08-05", sessionKey: "in-progress", category: "strength", sessionStatus: "in_progress", resultStatus: "completed" }),
    historicalSession({ date: "2026-08-06", sessionKey: "skipped-session", category: "strength", sessionStatus: "skipped", resultStatus: null }),
    historicalSession({ date: "2026-08-07", sessionKey: "historical-endurance", category: "endurance", sessionStatus: "completed", resultStatus: "completed" }),
    historicalSession({ date: "2026-08-08", sessionKey: "historical-recovery", category: "recovery", sessionStatus: "completed", resultStatus: "completed" }),
    historicalSession({ date: "2026-08-09", sessionKey: "planned-only", category: "strength", sessionStatus: "in_progress", resultStatus: null }),
  ];
  await fixture.store.save(state);

  const progress = await call(fixture.handler, "/api/private/progress?from=2026-08-01&to=2026-08-09");
  assert.equal(progress.response.status, 200);
  assert.equal(progress.body.metrics.strength_training_days.value, 2);
  assert.deepEqual(progress.body.metrics.strength_training_days.session_refs, [
    "session:2026-08-01:strength-completed",
    "session:2026-08-02:strength-in-partial-session",
  ]);
});
