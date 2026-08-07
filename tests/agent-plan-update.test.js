// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, deepClone, weekdayKey } from "../src/util.js";
import { appFixture, call, packageText, testAgentSecret, today, workout } from "./helpers.js";

async function createToken(handler) {
  const result = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" });
  assert.equal(result.response.status, 201);
  return result.body.token;
}

async function agentPost(handler, token, path, body) {
  const response = await handler.fetch(new Request(`https://workout.example${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), {
    LOCAL_AUTH: "true",
    PUBLIC_ORIGIN: "https://workout.example",
    AGENT_TOKEN_SECRET: testAgentSecret,
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { response, body: parsed };
}

async function agentGet(handler, token, path) {
  const response = await handler.fetch(new Request(`https://workout.example${path}`, { headers: { Authorization: `Bearer ${token}` } }), {
    LOCAL_AUTH: "true",
    PUBLIC_ORIGIN: "https://workout.example",
    AGENT_TOKEN_SECRET: testAgentSecret,
  });
  return { response, body: JSON.parse(await response.text()) };
}

test("Agent plan validation returns a complete preview and base evidence without writing", async () => {
  const { handler, store } = appFixture();
  const token = await createToken(handler);
  const before = await store.getByEmail("athlete-a@example.invalid");
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("Agent 预览")));

  const manifest = await agentGet(handler, token, "/api/agent/v1");
  assert.equal(manifest.body.links.plan_update_validate, "/api/agent/v1/plan-updates/validate");
  assert.equal(manifest.body.endpoints.plan_update_validate.method, "POST");
  assert.equal(manifest.body.endpoints.plan_update_validate.rules.mutates, false);

  const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.valid, true);
  assert.equal(result.body.preview.effective_from, addDays(today, 1));
  assert.equal(Object.keys(result.body.preview.week).length, 7);
  assert.equal(result.body.preview.changed_weekday_slot_count > 0, true);
  assert.equal(result.body.preview.source_ref, "plan-update:preview");
  assert.equal(result.body.source_ref, "plan-update:validation");
  assert.match(result.body.package_digest, /^[a-f0-9]{64}$/);
  assert.match(result.body.base_plan_digest, /^[a-f0-9]{64}$/);
  assert.equal(result.body.base_plan.source_ref, "plan:base");
  assert.doesNotMatch(JSON.stringify(result.body), /revision_key|athlete_key|token_digest|Bearer|\/coach\//);

  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.plan_revisions.length, before.plan_revisions.length);
  assert.equal(after.training_version, before.training_version);
});

test("Agent plan validation reports strict errors and preserves zero-write failures", async () => {
  const { handler, store } = appFixture();
  const token = await createToken(handler);
  const before = await store.getByEmail("athlete-a@example.invalid");
  const valid = JSON.parse(packageText(addDays(today, 1), workout("严格校验")));
  const cases = [
    [{}, "invalid_request"],
    [{ package_text: "not-json" }, "invalid_plan_package"],
    [{ package_text: JSON.stringify({ ...valid, unknown: true }) }, "invalid_plan_package"],
    [{ package_text: `{"schema_version":1,"effective_from":"${addDays(today, 1)}","effective_from":"${addDays(today, 2)}","week":{}}` }, "invalid_plan_package"],
  ];
  for (const [body, code] of cases) {
    const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", body);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, code);
    if (code === "invalid_plan_package") assert.equal(Array.isArray(result.body.error.details), true);
  }

  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.plan_revisions.length, before.plan_revisions.length);
  assert.equal(after.training_version, before.training_version);
});

test("Agent plan validation rejects no-op and non-future effective dates", async () => {
  const { handler, store } = appFixture();
  const token = await createToken(handler);
  const state = await store.getByEmail("athlete-a@example.invalid");
  const unchangedWeek = deepClone(state.plan_revisions[0].week);
  const noOp = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", {
    package_text: JSON.stringify({ schema_version: 1, effective_from: addDays(today, 1), week: unchangedWeek }),
  });
  assert.equal(noOp.response.status, 400);
  assert.equal(noOp.body.error.code, "invalid_plan_package");
  assert.equal(noOp.body.error.details[0].path, "/week");

  for (const effectiveFrom of [today, addDays(today, -1)]) {
    const past = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: packageText(effectiveFrom, workout("过期提案")) });
    assert.equal(past.response.status, 400);
    assert.equal(past.body.error.code, "invalid_plan_package");
    assert.equal(past.body.error.details.some((detail) => detail.path === "/effective_from"), true);
  }
});

test("Agent plan preview counts changed and unchanged weekday slots explicitly", async () => {
  const { handler, store } = appFixture();
  const token = await createToken(handler);
  const state = await store.getByEmail("athlete-a@example.invalid");
  const effectiveFrom = addDays(today, 1);
  const week = deepClone(state.plan_revisions[0].week);
  week[weekdayKey(effectiveFrom)] = workout("只改一天");
  const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify({ schema_version: 1, effective_from: effectiveFrom, week }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.preview.changed_weekday_slot_count, 1);
  assert.deepEqual(Object.keys(result.body.preview.week).sort(), ["friday", "monday", "saturday", "sunday", "thursday", "tuesday", "wednesday"]);
});
