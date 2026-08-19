import test from "node:test";
import assert from "node:assert/strict";
import { appFixture, call } from "./helpers.js";
import { validateExerciseRegistryDocument } from "../src/exercise-registry.js";

test("global exercise registry is exposed through the private domain boundary", async () => {
  const { handler } = appFixture();
  const result = await call(handler, "/api/private/exercise-registry");

  assert.equal(result.response.status, 200);
  assert.equal(result.body.schema_version, 1);
  assert.ok(Array.isArray(result.body.exercises));
  const deadBug = result.body.exercises.find(/** @param {any} exercise */ (exercise) => exercise.exercise_id === "dead_bug");
  assert.deepEqual(deadBug, {
    exercise_id: "dead_bug",
    slug: "dead-bug",
    name: "死虫",
    definition_version: 1,
    status: "active",
    execution: { side_modes: ["per_side", "alternating"] },
    target: { metrics: ["reps", "duration_sec"] },
    resistance: { modes: ["bodyweight"], units: [] },
    equipment: { required: [], optional: [] },
    capabilities: {},
  });
  assert.equal(Object.hasOwn(deadBug, "athlete_key"), false);
});

test("registry resolves one exercise without making the registry Athlete-scoped", async () => {
  const { handler } = appFixture();
  const first = await call(handler, "/api/private/exercise-registry?exercise_id=dead_bug", {}, "athlete-a@example.invalid");
  const second = await call(handler, "/api/private/exercise-registry?exercise_id=dead_bug", {}, "athlete-b@example.invalid");

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.deepEqual(first.body.exercise, second.body.exercise);
  assert.equal(first.body.exercise.name, "死虫");

  const missing = await call(handler, "/api/private/exercise-registry?exercise_id=does_not_exist");
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, "exercise_not_found");
});

test("registry validation rejects duplicate identities, malformed capabilities, and unversioned extensions", () => {
  const validExercise = {
    exercise_id: "dead_bug",
    slug: "dead-bug",
    name: "死虫",
    definition_version: 1,
    status: "active",
    execution: { side_modes: ["per_side"] },
    target: { metrics: ["reps"] },
    resistance: { modes: ["bodyweight"], units: [] },
    equipment: { required: [], optional: [] },
    capabilities: {},
  };

  const duplicate = validateExerciseRegistryDocument({ schema_version: 1, exercises: [validExercise, validExercise] });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join(" "), /duplicate exercise_id/);

  const malformed = structuredClone(validExercise);
  malformed.execution.side_modes = ["left_right"];
  const malformedResult = validateExerciseRegistryDocument({ schema_version: 1, exercises: [malformed] });
  assert.equal(malformedResult.ok, false);
  assert.match(malformedResult.errors.join(" "), /execution\.side_modes/);

  const unversioned = structuredClone(validExercise);
  unversioned.capabilities = { future: { enabled: true } };
  const extensionResult = validateExerciseRegistryDocument({ schema_version: 1, exercises: [unversioned] });
  assert.equal(extensionResult.ok, false);
  assert.match(extensionResult.errors.join(" "), /capabilities\.future/);
});
