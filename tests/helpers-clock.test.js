import test from "node:test";
import assert from "node:assert/strict";
import { appFixture, call, post, TEST_NOW, TEST_TODAY } from "./helpers.js";

test("test fixture defaults date, request clock, and persistence to one explicit instant", async () => {
  const fixture = appFixture();

  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${TEST_TODAY}/start`, post({}, "default-fixed-clock-start"));

  assert.equal(started.response.status, 201);
  assert.equal(started.body.created_at, TEST_NOW);
  assert.equal(started.body.updated_at, TEST_NOW);
  assert.equal((await fixture.store.getByEmail("athlete-a@example.invalid")).updated_at, TEST_NOW);
});
