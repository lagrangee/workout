// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { appendPlanRevision } from "../src/plan.js";
import { addDays } from "../src/util.js";
import { agentRequest, appFixture, createAgentToken, packageText, today, workout } from "./helpers.js";

async function agentPost(handler, token, path, body, headers = {}) {
  return agentRequest(handler, token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function applyBody(packageValue, preview, overrides = {}) {
  return {
    package_text: JSON.stringify(packageValue),
    package_digest: preview.package_digest,
    base_plan_digest: preview.base_plan_digest,
    confirmed: true,
    ...overrides,
  };
}

test("Agent plan application requires the preview evidence and returns readback-ready application data", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const before = await store.getByEmail("athlete-a@example.invalid");
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("确认应用")));
  const preview = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  assert.equal(preview.response.status, 200);

  const applied = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", {
    package_text: JSON.stringify(packageValue),
    package_digest: preview.body.package_digest,
    base_plan_digest: preview.body.base_plan_digest,
    confirmed: true,
  }, { "Idempotency-Key": "agent-apply-1" });
  assert.equal(applied.response.status, 201);
  assert.equal(applied.body.applied, true);
  assert.equal(applied.body.effective_from, addDays(today, 1));
  assert.equal(applied.body.package_digest, preview.body.package_digest);
  assert.equal(applied.body.base_plan_digest, preview.body.base_plan_digest);
  assert.equal(applied.body.training_version, before.training_version + 1);
  assert.doesNotMatch(JSON.stringify(applied.body), /revision_key|athlete_key/);

  const state = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(state.plan_revisions.length, 2);
  assert.equal(state.training_version, before.training_version + 1);
  const plan = await agentRequest(handler, token, "/api/agent/v1/plan");
  assert.equal(plan.response.status, 200);
  assert.equal(plan.body.future[0].effective_from, addDays(today, 1));
  const schedule = await agentRequest(handler, token, `/api/agent/v1/schedule?from=${addDays(today, 1)}&to=${addDays(today, 7)}`);
  assert.equal(schedule.response.status, 200);
  assert.equal(schedule.body.entries.length, 7);
  assert.ok(schedule.body.entries.some((entry) => entry.kind === "workout" && entry.title === "确认应用"));
});

test("Agent plan application gates confirmation and idempotency before any write", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("门禁测试")));
  const preview = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  const before = await store.getByEmail("athlete-a@example.invalid");

  const missingKey = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", applyBody(packageValue, preview.body));
  assert.equal(missingKey.response.status, 400);
  assert.equal(missingKey.body.error.code, "idempotency_key_required");

  const whitespaceKey = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", applyBody(packageValue, preview.body), { "Idempotency-Key": "   " });
  assert.equal(whitespaceKey.response.status, 400);
  assert.equal(whitespaceKey.body.error.code, "idempotency_key_required");

  const missingConfirmation = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", applyBody(packageValue, preview.body, { confirmed: false }), { "Idempotency-Key": "gate-confirmation" });
  assert.equal(missingConfirmation.response.status, 400);
  assert.equal(missingConfirmation.body.error.code, "confirmation_required");

  const digestMismatch = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", applyBody(packageValue, preview.body, { package_digest: "f".repeat(64) }), { "Idempotency-Key": "gate-digest" });
  assert.equal(digestMismatch.response.status, 409);
  assert.equal(digestMismatch.body.error.code, "package_digest_mismatch");

  const invalidPackage = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", { package_text: "{}", package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true }, { "Idempotency-Key": "gate-package" });
  assert.equal(invalidPackage.response.status, 400);
  assert.equal(invalidPackage.body.error.code, "invalid_plan_package");

  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.plan_revisions.length, before.plan_revisions.length);
  assert.equal(after.idempotency_records.length, before.idempotency_records.length);
});

test("Agent plan application rejects stale base evidence, including a package that became a no-op", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("过期提案")));
  const preview = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  const changed = await store.getByEmail("athlete-a@example.invalid");
  appendPlanRevision(changed, packageValue);
  await store.save(changed);

  const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", applyBody(packageValue, preview.body), { "Idempotency-Key": "stale-plan" });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error.code, "stale_plan");
  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.plan_revisions.length, 2);
  assert.equal(after.idempotency_records.length, 0);
});

test("Agent plan application replays one idempotent success and rejects a conflicting body", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("只应用一次")));
  const preview = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  const body = applyBody(packageValue, preview.body);
  const first = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", body, { "Idempotency-Key": "replay-once" });
  const replay = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", body, { "Idempotency-Key": "replay-once" });
  assert.equal(first.response.status, 201);
  assert.equal(replay.response.status, 201);
  assert.deepEqual(replay.body, first.body);

  const alternate = JSON.parse(packageText(addDays(today, 1), workout("不同请求体")));
  const conflict = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", { ...body, package_text: JSON.stringify(alternate) }, { "Idempotency-Key": "replay-once" });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error.code, "idempotency_conflict");
  const state = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(state.plan_revisions.length, 2);
  assert.equal(state.idempotency_records.length, 1);
  assert.equal(state.training_version, first.body.training_version);
});

test("Agent plan application preserves effective revision precedence for later updates", async () => {
  const { handler } = appFixture();
  const token = await createAgentToken(handler);
  const firstPackage = JSON.parse(packageText(addDays(today, 1), workout("第一阶段")));
  const firstPreview = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(firstPackage) });
  const first = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", applyBody(firstPackage, firstPreview.body), { "Idempotency-Key": "precedence-1" });
  assert.equal(first.response.status, 201);

  const laterPackage = JSON.parse(packageText(addDays(today, 3), workout("第二阶段")));
  const laterPreview = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(laterPackage) });
  assert.equal(laterPreview.body.base_plan.effective_from, firstPackage.effective_from);
  const later = await agentPost(handler, token, "/api/agent/v1/plan-updates/apply", applyBody(laterPackage, laterPreview.body), { "Idempotency-Key": "precedence-2" });
  assert.equal(later.response.status, 201);

  const plan = await agentRequest(handler, token, "/api/agent/v1/plan");
  assert.ok(plan.body.future.some((revision) => revision.effective_from === firstPackage.effective_from && revision.week.monday.prescription.title === "第一阶段"));
  assert.ok(plan.body.future.some((revision) => revision.effective_from === laterPackage.effective_from && revision.week.monday.prescription.title === "第二阶段"));
});

test("Agent plan application isolates Athletes and maps a concurrent state conflict", async () => {
  const { handler, store } = appFixture();
  const tokenA = await createAgentToken(handler, "athlete-a@example.invalid");
  const tokenB = await createAgentToken(handler, "athlete-b@example.invalid");
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("只属于 A")));
  const preview = await agentPost(handler, tokenA, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  const crossAthlete = await agentPost(handler, tokenB, "/api/agent/v1/plan-updates/apply", applyBody(packageValue, preview.body), { "Idempotency-Key": "cross-athlete" });
  assert.equal(crossAthlete.response.status, 409);
  assert.equal(crossAthlete.body.error.code, "stale_plan");
  assert.equal((await store.getByEmail("athlete-b@example.invalid")).plan_revisions.length, 0);

  const conflictPackage = JSON.parse(packageText(addDays(today, 1), workout("并发边界")));
  const conflictPreview = await agentPost(handler, tokenA, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(conflictPackage) });
  const originalTransaction = store.transaction;
  store.transaction = async () => { const error = new Error("D1 state changed concurrently"); error.code = "D1_CONCURRENCY_CONFLICT"; throw error; };
  try {
    const concurrent = await agentPost(handler, tokenA, "/api/agent/v1/plan-updates/apply", applyBody(conflictPackage, conflictPreview.body), { "Idempotency-Key": "concurrent-state" });
    assert.equal(concurrent.response.status, 409);
    assert.equal(concurrent.body.error.code, "session_state_conflict");
  } finally {
    store.transaction = originalTransaction;
  }
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).plan_revisions.length, 1);
});
