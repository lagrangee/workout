// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, mondayOf } from "../src/util.js";
import { agentRequest, appFixture, call, createAgentToken, json, today } from "./helpers.js";

const firstMonday = addDays(mondayOf(today), 7);

function workout(title, reps) {
  return {
    kind: "workout",
    title,
    start_time: "07:30",
    estimated_duration_min: 45,
    blocks: [{
      title: "主训练",
      exercises: [{
        occurrence_key: "dead_bug_main",
        exercise_id: "dead_bug",
        execution_mode: "per_side",
        sets: [{
          set_id: "dead_bug_set_1",
          ordinal: 1,
          target: { metric: "reps", value: reps },
          resistance: { mode: "bodyweight" },
          tempo: null,
          rest_after_sec: 45,
        }],
      }],
    }],
  };
}

function week(index) {
  return {
    monday: workout(`第 ${index + 1} 周`, 6 + index),
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: { kind: "rest" },
  };
}

function batch(count = 4) {
  return {
    schema_version: 1,
    updates: Array.from({ length: count }, (_, index) => ({
      schema_version: 2,
      effective_from: addDays(firstMonday, index * 7),
      week: week(index),
    })),
  };
}

function privatePost(handler, path, body, idempotencyKey = null) {
  return call(handler, path, json({ method: "POST", headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {} }, body));
}

function agentPost(handler, token, path, body, idempotencyKey = null) {
  return agentRequest(handler, token, path, json({ method: "POST", headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {} }, body));
}

test("private Plan Update Batch validates four full weeks without mutation and applies atomically", async () => {
  const { handler, store } = appFixture();
  const before = await store.getByEmail("athlete-a@example.invalid");
  const batchText = JSON.stringify(batch());
  const validation = await privatePost(handler, "/api/private/plan-update-batches/validate", { batch_text: batchText });

  assert.equal(validation.response.status, 200);
  assert.equal(validation.body.preview.update_count, 4);
  assert.equal(validation.body.preview.resulting_schedule.entries.length, 28);
  assert.equal(validation.body.training_version, before.training_version);
  assert.equal((await store.getByEmail(before.email)).plan_revisions.length, before.plan_revisions.length);

  const applyBody = {
    batch_text: batchText,
    batch_digest: validation.body.batch_digest,
    base_plan_digest: validation.body.base_plan_digest,
    confirmed: true,
  };
  const applied = await privatePost(handler, "/api/private/plan-update-batches/apply", applyBody, "batch-private-1");
  assert.equal(applied.response.status, 201);
  assert.equal(applied.body.update_count, 4);
  const after = await store.getByEmail(before.email);
  assert.equal(after.plan_revisions.length, before.plan_revisions.length + 4);
  assert.equal(after.training_version, before.training_version + 1);

  const replay = await privatePost(handler, "/api/private/plan-update-batches/apply", applyBody, "batch-private-1");
  assert.equal(replay.response.status, 201);
  assert.equal((await store.getByEmail(before.email)).plan_revisions.length, before.plan_revisions.length + 4);
});

test("batch rejects non-consecutive weeks and an invalid member without writing any revision", async () => {
  const { handler, store } = appFixture();
  const before = await store.getByEmail("athlete-a@example.invalid");
  const invalid = batch();
  invalid.updates[2].effective_from = addDays(invalid.updates[1].effective_from, 14);
  invalid.updates[3].week.monday.blocks[0].exercises[0].exercise_id = "unknown_exercise";
  const result = await privatePost(handler, "/api/private/plan-update-batches/validate", { batch_text: JSON.stringify(invalid) });

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "invalid_plan_batch");
  assert.equal((await store.getByEmail(before.email)).plan_revisions.length, before.plan_revisions.length);
});

test("Agent batch requires exact preview evidence and rejects stale or cross-Athlete application", async () => {
  const { handler, store } = appFixture();
  const tokenA = await createAgentToken(handler, "athlete-a@example.invalid");
  const tokenB = await createAgentToken(handler, "athlete-b@example.invalid");
  const batchText = JSON.stringify(batch(2));
  const validation = await agentPost(handler, tokenA, "/api/agent/v1/plan-update-batches/validate", { batch_text: batchText });
  assert.equal(validation.response.status, 200);

  const applyBody = { batch_text: batchText, batch_digest: validation.body.batch_digest, base_plan_digest: validation.body.base_plan_digest, confirmed: true };
  const crossAthlete = await agentPost(handler, tokenB, "/api/agent/v1/plan-update-batches/apply", applyBody, "batch-cross-athlete");
  assert.equal(crossAthlete.response.status, 409);
  assert.equal(crossAthlete.body.error.code, "stale_plan");

  const stateA = await store.getByEmail("athlete-a@example.invalid");
  stateA.plan_revisions.push({ revision_key: "rev_concurrent_batch", revision_sequence: 99, created_at: new Date().toISOString(), effective_from: firstMonday, week: week(9) });
  await store.save(stateA);
  const stale = await agentPost(handler, tokenA, "/api/agent/v1/plan-update-batches/apply", applyBody, "batch-stale");
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "stale_plan");
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).plan_revisions.length, stateA.plan_revisions.length);
});

test("Agent manifest advertises the atomic batch endpoints", async () => {
  const { handler } = appFixture();
  const token = await createAgentToken(handler);
  const manifest = await agentRequest(handler, token, "/api/agent/v1");
  assert.equal(manifest.response.status, 200);
  assert.equal(manifest.body.links.plan_update_batch_validate, "/api/agent/v1/plan-update-batches/validate");
  assert.equal(manifest.body.endpoints.plan_update_batch_apply.rules.atomic, true);
});
