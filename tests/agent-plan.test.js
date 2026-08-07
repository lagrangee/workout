import test from "node:test";
import assert from "node:assert/strict";
import { addDays, opaqueKey } from "../src/util.js";
import { appFixture, call, today, week, workout } from "./helpers.js";

/** @param {any} handler */
async function createToken(handler) {
  const result = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" });
  assert.equal(result.response.status, 201);
  return result.body.token;
}

/** @param {any} handler @param {string} token @param {string} path */
async function agentGet(handler, token, path) {
  const response = await handler.fetch(new Request(`https://workout.example${path}`, { headers: { Authorization: `Bearer ${token}` } }), {
    LOCAL_AUTH: "true",
    PUBLIC_ORIGIN: "https://workout.example",
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

test("Agent plan reads preserve bounded projections and Athlete-local schedule rules", async () => {
  const { handler, store } = appFixture();
  const stateA = await store.getByEmail("athlete-a@example.invalid");
  stateA.plan_revisions.push({
    revision_key: opaqueKey("rev"),
    revision_sequence: 2,
    created_at: new Date().toISOString(),
    effective_from: addDays(today, 7),
    week: week(workout("未来计划")),
  });
  await store.save(stateA);
  const before = await store.getByEmail("athlete-a@example.invalid");
  const tokenA = await createToken(handler);

  const overview = await agentGet(handler, tokenA, "/api/agent/v1/overview");
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.metric_semantics_version, 1);
  assert.equal(typeof overview.body.data_as_of, "string");
  assert.equal(typeof overview.body.coverage.current_local_date, "string");
  assert.equal(overview.body.coverage.current_date_may_be_incomplete, true);
  assert.equal(Object.hasOwn(overview.body, "athlete_key"), false);
  assert.equal(Object.hasOwn(overview.body, "email"), false);
  assert.doesNotMatch(JSON.stringify(overview.body), new RegExp("/coach/|Bearer|token_digest"));

  const plan = await agentGet(handler, tokenA, "/api/agent/v1/plan");
  assert.equal(plan.response.status, 200);
  assert.equal(plan.body.current.effective_from, before.plan_revisions[0].effective_from);
  assert.equal(plan.body.future[0].effective_from, addDays(today, 7));
  assert.equal(typeof plan.body.current.source_ref, "string");
  assert.equal(typeof plan.body.future[0].source_ref, "string");
  assert.doesNotMatch(JSON.stringify(plan.body), /revision_key|athlete_key/);

  const missingRange = await agentGet(handler, tokenA, "/api/agent/v1/schedule?from=2026-08-01");
  assert.equal(missingRange.response.status, 400);
  assert.equal(missingRange.body.error.code, "invalid_period");

  const reversedRange = await agentGet(handler, tokenA, "/api/agent/v1/schedule?from=2026-08-08&to=2026-08-07");
  assert.equal(reversedRange.response.status, 400);
  assert.equal(reversedRange.body.error.code, "invalid_period");

  const oversizedRange = await agentGet(handler, tokenA, "/api/agent/v1/schedule?from=2026-01-01&to=2027-01-02");
  assert.equal(oversizedRange.response.status, 400);
  assert.equal(oversizedRange.body.error.code, "invalid_period");

  const schedule = await agentGet(handler, tokenA, `/api/agent/v1/schedule?from=${today}&to=${addDays(today, 2)}&expand=prescription`);
  assert.equal(schedule.response.status, 200);
  assert.equal(schedule.body.from, today);
  assert.equal(schedule.body.to, addDays(today, 2));
  assert.equal(schedule.body.period.timezone, "Asia/Shanghai");
  assert.equal(schedule.body.entries.length, 3);
  assert.ok(schedule.body.entries.some(/** @param {any} entry */ (entry) => entry.kind === "workout"));
  assert.ok(schedule.body.entries.some(/** @param {any} entry */ (entry) => entry.kind === "rest" || entry.kind === "no_plan"));
  assert.ok(Object.keys(schedule.body.prescriptions).length >= 1);
  assert.ok(schedule.body.entries.every(/** @param {any} entry */ (entry) => !Object.hasOwn(entry, "revision_key") && !Object.hasOwn(entry, "scheduled_workout_key")));
  assert.ok(schedule.body.entries.every(/** @param {any} entry */ (entry) => /^schedule:\d{4}-\d{2}-\d{2}:(workout|rest|no_plan)$/.test(entry.source_ref)));

  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.training_version, before.training_version);
  assert.equal(after.plan_revisions.length, before.plan_revisions.length);

  const stateB = await store.getByEmail("athlete-b@example.invalid");
  const tokenB = await (async () => {
    const result = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" }, stateB.email);
    return result.body.token;
  })();
  const bPlan = await agentGet(handler, tokenB, "/api/agent/v1/plan");
  assert.equal(bPlan.response.status, 200);
  assert.equal(bPlan.body.current, null);
  const bSchedule = await agentGet(handler, tokenB, `/api/agent/v1/schedule?from=${today}&to=${today}`);
  assert.equal(bSchedule.body.entries[0].kind, "no_plan");
  const crossHeader = await handler.fetch(new Request(`https://workout.example/api/agent/v1/overview?athlete_key=${stateB.athlete_key}`, { headers: { Authorization: `Bearer ${tokenA}`, "x-athlete-email": stateB.email } }), { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example" });
  assert.equal(crossHeader.status, 400);
});
