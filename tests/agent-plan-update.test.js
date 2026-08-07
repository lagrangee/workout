// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, deepClone, weekdayKey } from "../src/util.js";
import { agentRequest, appFixture, call, createAgentToken, packageText, testAgentSecret, today, week, workout } from "./helpers.js";

async function agentPost(handler, token, path, body) {
  return agentRequest(handler, token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Agent plan validation returns a complete preview and base evidence without writing", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const before = await store.getByEmail("athlete-a@example.invalid");
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("Agent 预览")));

  const manifest = await agentRequest(handler, token, "/api/agent/v1");
  assert.equal(manifest.body.links.plan_update_validate, "/api/agent/v1/plan-updates/validate");
  assert.equal(manifest.body.endpoints.plan_update_validate.method, "POST");
  assert.equal(manifest.body.endpoints.plan_update_validate.rules.mutates, false);

  const getValidation = await agentRequest(handler, token, "/api/agent/v1/plan-updates/validate");
  assert.equal(getValidation.response.status, 405);
  assert.equal(getValidation.response.headers.get("Allow"), "POST");
  const putValidation = await handler.fetch(new Request("https://workout.example/api/agent/v1/plan-updates/validate", { method: "PUT", headers: { Authorization: `Bearer ${token}` } }), { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example", AGENT_TOKEN_SECRET: testAgentSecret });
  assert.equal(putValidation.status, 405);
  assert.equal(putValidation.headers.get("Allow"), "POST");

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

  const sizeBoundaryBase = packageText(addDays(today, 1), workout("大小边界"));
  const sizeBoundaryBytes = new TextEncoder().encode(sizeBoundaryBase).byteLength;
  const exactLimitPackage = `${" ".repeat(256 * 1024 - sizeBoundaryBytes)}${sizeBoundaryBase}`;
  const exactLimitResult = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: exactLimitPackage });
  assert.equal(exactLimitResult.response.status, 200);
  const oversizedPackage = `${" ".repeat(256 * 1024 - sizeBoundaryBytes + 1)}${sizeBoundaryBase}`;
  const oversizedResult = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: oversizedPackage });
  assert.equal(oversizedResult.response.status, 400);
  assert.equal(oversizedResult.body.error.code, "invalid_plan_package");

  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.plan_revisions.length, before.plan_revisions.length);
  assert.equal(after.training_version, before.training_version);
});

test("Agent plan validation reports strict errors and preserves zero-write failures", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const before = await store.getByEmail("athlete-a@example.invalid");
  const valid = JSON.parse(packageText(addDays(today, 1), workout("严格校验")));
  const cases = [
    [{}, "invalid_request"],
    [{ package_text: "not-json" }, "invalid_plan_package"],
    [{ package_text: JSON.stringify({ ...valid, unknown: true }) }, "invalid_plan_package"],
    [{ package_text: `{"schema_version":1,"effective_from":"${addDays(today, 1)}","effective_from":"${addDays(today, 2)}","week":{}}` }, "invalid_plan_package"],
    [{ package_text: JSON.stringify({ ...valid, week: [] }) }, "invalid_plan_package"],
  ];
  for (const [body, code] of cases) {
    const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", body);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.code, code);
    if (code === "invalid_plan_package") assert.equal(Array.isArray(result.body.error.details), true);
  }
  const malformedWeek = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify({ ...valid, week: [] }) });
  assert.equal(malformedWeek.body.error.details[0].path, "/week");

  const rootValue = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: "null" });
  assert.equal(rootValue.body.error.details[0].path, "");

  const duplicateExerciseWorkout = deepClone(workout("跨 Block 重复"));
  duplicateExerciseWorkout.blocks.push(deepClone(duplicateExerciseWorkout.blocks[0]));
  const duplicateExercise = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", {
    package_text: packageText(addDays(today, 1), duplicateExerciseWorkout),
  });
  assert.equal(duplicateExercise.body.error.details.some((detail) => detail.path === "/week/monday/blocks/1/exercises/0/exercise_key"), true);

  for (const [path, value] of [
    ["/week/monday/title", "  workout title  "],
    ["/week/monday/blocks/0/title", "  block title  "],
    ["/week/monday/blocks/0/exercises/0/name", "  exercise name  "],
  ]) {
    const trimmedValue = deepClone(valid);
    const segments = path.split("/").slice(1);
    const last = segments.pop();
    const target = segments.reduce((current, segment) => current[segment], trimmedValue);
    target[last] = value;
    const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(trimmedValue) });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error.details.some((detail) => detail.path === path), true);
  }

  const duplicateWeekMember = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", {
    package_text: `{"schema_version":1,"effective_from":"${addDays(today, 1)}","week":{"monday":null,"monday":null}}`,
  });
  assert.equal(duplicateWeekMember.body.error.details[0].path, "/week/monday");

  const malformedNestedValue = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", {
    package_text: `{"schema_version":1,"effective_from":"${addDays(today, 1)}","week":{"monday":{"kind":"rest",},}}`,
  });
  assert.equal(malformedNestedValue.body.error.details[0].path, "/week/monday");

  const prototypeField = JSON.stringify(valid).slice(0, -1) + ',"__proto__":true}';
  const prototypeResult = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: prototypeField });
  assert.equal(prototypeResult.body.error.details.some((detail) => detail.path === "/__proto__"), true);

  const unusualUnknownField = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", {
    package_text: JSON.stringify({ ...valid, "odd: field/with~chars": true }),
  });
  assert.equal(unusualUnknownField.body.error.details.some((detail) => detail.path === "/odd: field~1with~0chars"), true);

  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.plan_revisions.length, before.plan_revisions.length);
  assert.equal(after.training_version, before.training_version);

  const duplicateOuter = await handler.fetch(new Request("https://workout.example/api/agent/v1/plan-updates/validate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: `{"package_text":${JSON.stringify(packageText(addDays(today, 1), workout("外层重复")))},"package_text":${JSON.stringify(packageText(addDays(today, 2), workout("外层覆盖")))}}`,
  }), { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example", AGENT_TOKEN_SECRET: testAgentSecret });
  assert.equal(duplicateOuter.status, 400);
  assert.equal((await duplicateOuter.json()).error.code, "invalid_json");
});

test("Agent plan validation rejects no-op and non-future effective dates", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
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

  const emptyWeek = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, null]));
  const tokenB = await createAgentToken(handler, "athlete-b@example.invalid");
  const noPlan = await agentPost(handler, tokenB, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify({ schema_version: 1, effective_from: addDays(today, 1), week: emptyWeek }) });
  assert.equal(noPlan.response.status, 400);
  assert.equal(noPlan.body.error.code, "invalid_plan_package");
  assert.equal(noPlan.body.error.details[0].path, "/week");
});

test("Agent plan preview counts changed and unchanged weekday slots explicitly", async () => {
  const { handler, store } = appFixture();
  const token = await createAgentToken(handler);
  const state = await store.getByEmail("athlete-a@example.invalid");
  const effectiveFrom = addDays(today, 1);
  const week = deepClone(state.plan_revisions[0].week);
  week[weekdayKey(effectiveFrom)] = workout("只改一天");
  const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify({ schema_version: 1, effective_from: effectiveFrom, week }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.preview.changed_weekday_slot_count, 1);
  assert.deepEqual(Object.keys(result.body.preview.week).sort(), ["friday", "monday", "saturday", "sunday", "thursday", "tuesday", "wednesday"]);
});

test("Agent plan validation returns the effective plan base used by the preview", async () => {
  const { handler, store } = appFixture();
  const futureEffectiveFrom = addDays(today, 7);
  const state = await store.getByEmail("athlete-a@example.invalid");
  state.plan_revisions.push({
    revision_key: "future-revision-for-preview",
    revision_sequence: 2,
    created_at: new Date().toISOString(),
    effective_from: futureEffectiveFrom,
    week: week(workout("已有未来基线")),
  });
  await store.save(state);
  const token = await createAgentToken(handler);
  const result = await agentPost(handler, token, "/api/agent/v1/plan-updates/validate", {
    package_text: packageText(addDays(futureEffectiveFrom, 1), workout("替换未来基线")),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.base_plan.effective_from, futureEffectiveFrom);
  assert.equal(result.body.base_plan.week.monday.title, "已有未来基线");
  assert.equal(result.body.preview.changed_weekday_slot_count, 1);
});

test("Agent plan validation remains scoped to the bearer Athlete", async () => {
  const { handler, store } = appFixture();
  const tokenA = await createAgentToken(handler, "athlete-a@example.invalid");
  const tokenB = await createAgentToken(handler, "athlete-b@example.invalid");
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("隔离预览")));
  const athleteAResult = await agentPost(handler, tokenA, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  const athleteBResult = await agentPost(handler, tokenB, "/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  assert.equal(athleteAResult.response.status, 200);
  assert.equal(athleteBResult.response.status, 200);
  assert.notEqual(athleteAResult.body.base_plan_digest, athleteBResult.body.base_plan_digest);
  assert.notEqual(athleteAResult.body.base_plan.effective_from, athleteBResult.body.base_plan.effective_from);
  assert.equal((await store.getByEmail("athlete-a@example.invalid")).plan_revisions.length, 1);
  assert.equal((await store.getByEmail("athlete-b@example.invalid")).plan_revisions.length, 0);
});
