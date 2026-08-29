import test from "node:test";
import assert from "node:assert/strict";
import { addDays, opaqueKey } from "../src/util.js";
import { agentRequest, appFixture, call, createAgentToken, TEST_NOW, testAgentSecret, today, week, workout } from "./helpers.js";

/** @param {any} handler @param {string} token @param {string} path @param {Record<string, string>} extraHeaders */
async function agentGet(handler, token, path, extraHeaders = {}) {
  return agentRequest(handler, token, path, { headers: extraHeaders });
}

test("Agent plan reads preserve bounded projections and Athlete-local schedule rules", async () => {
  const { handler, store } = appFixture();
  const stateA = await store.getByEmail("athlete-a@example.invalid");
  const futureEffectiveFrom = addDays(today, 8);
  stateA.plan_revisions.push({
    revision_key: opaqueKey("rev"),
    revision_sequence: 2,
    created_at: TEST_NOW,
    effective_from: futureEffectiveFrom,
    week: week(workout("未来计划")),
  });
  await store.save(stateA);
  const before = await store.getByEmail("athlete-a@example.invalid");
  const tokenA = await createAgentToken(handler);

  const manifest = await agentGet(handler, tokenA, "/api/agent/v1");
  assert.equal(manifest.response.status, 200);
  assert.equal(manifest.body.query_rules.overview.default_period, "30d");
  assert.equal(manifest.body.query_rules.overview.from_to_must_be_together, true);
  assert.equal(manifest.body.query_rules.overview.preset_range_mutually_exclusive, true);
  assert.equal(manifest.body.query_rules.overview.from_to_conflicts_with_selector, true);
  assert.equal(manifest.body.query_rules.overview.max_days, 3660);

  const overview = await agentGet(handler, tokenA, "/api/agent/v1/overview");
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.metric_semantics_version, 1);
  assert.equal(typeof overview.body.data_as_of, "string");
  assert.equal(typeof overview.body.coverage.current_local_date, "string");
  assert.equal(overview.body.coverage.current_date_may_be_incomplete, true);
  assert.equal(overview.response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(Object.hasOwn(overview.body, "athlete_key"), false);
  assert.equal(Object.hasOwn(overview.body, "email"), false);
  assert.doesNotMatch(JSON.stringify(overview.body), new RegExp("/coach/|Bearer|token_digest"));

  const allOverview = await agentGet(handler, tokenA, "/api/agent/v1/overview?range=all");
  assert.equal(allOverview.response.status, 200);
  assert.equal(allOverview.body.period.from, before.plan_revisions[0].effective_from);
  const invalidOverview = await agentGet(handler, tokenA, "/api/agent/v1/overview?range=quarter");
  assert.equal(invalidOverview.response.status, 400);
  assert.equal(invalidOverview.body.error.code, "invalid_period");
  const unknownOverview = await agentGet(handler, tokenA, "/api/agent/v1/overview?unexpected=1");
  assert.equal(unknownOverview.response.status, 400);
  assert.equal(unknownOverview.body.error.code, "invalid_request");
  const duplicateOverview = await agentGet(handler, tokenA, "/api/agent/v1/overview?range=7d&range=30d");
  assert.equal(duplicateOverview.response.status, 400);
  assert.equal(duplicateOverview.body.error.code, "invalid_request");

  const plan = await agentGet(handler, tokenA, "/api/agent/v1/plan");
  assert.equal(plan.response.status, 200);
  assert.equal(plan.body.current.effective_from, before.plan_revisions[0].effective_from);
  assert.equal(plan.body.future[0].effective_from, futureEffectiveFrom);
  assert.deepEqual(Object.keys(plan.body.current.week).sort(), ["friday", "monday", "saturday", "sunday", "thursday", "tuesday", "wednesday"]);
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
  const emptyExpand = await agentGet(handler, tokenA, `/api/agent/v1/schedule?from=${today}&to=${today}&expand=`);
  assert.equal(emptyExpand.response.status, 400);
  assert.equal(emptyExpand.body.error.code, "invalid_request");

  const schedule = await agentGet(handler, tokenA, `/api/agent/v1/schedule?from=${today}&to=${addDays(today, 7)}&expand=prescription`);
  assert.equal(schedule.response.status, 200);
  assert.equal(schedule.body.from, today);
  assert.equal(schedule.body.to, addDays(today, 7));
  assert.equal(schedule.body.period.timezone, "Asia/Shanghai");
  assert.equal(schedule.body.entries.length, 8);
  assert.ok(schedule.body.entries.some(/** @param {any} entry */ (entry) => entry.kind === "workout"));
  assert.ok(schedule.body.entries.some(/** @param {any} entry */ (entry) => entry.kind === "rest" || entry.kind === "no_plan"));
  const workoutEntries = schedule.body.entries.filter(/** @param {any} entry */ (entry) => entry.kind === "workout");
  assert.equal(new Set(workoutEntries.map(/** @param {any} entry */ (entry) => entry.prescription_ref)).size, 1);
  assert.equal(Object.keys(schedule.body.prescriptions).length, 1);
  const prescription = schedule.body.prescriptions[workoutEntries[0].prescription_ref];
  assert.equal(prescription.prescription_ref, workoutEntries[0].prescription_ref);
  assert.ok(Array.isArray(prescription.blocks));
  assert.equal(Object.hasOwn(prescription, "revision_key"), false);
  assert.doesNotMatch(JSON.stringify(prescription), /revision_key|scheduled_workout_key/);
  assert.ok(schedule.body.entries.every(/** @param {any} entry */ (entry) => !Object.hasOwn(entry, "revision_key") && !Object.hasOwn(entry, "scheduled_workout_key")));
  assert.ok(schedule.body.entries.every(/** @param {any} entry */ (entry) => /^schedule:\d{4}-\d{2}-\d{2}:(workout|rest|no_plan)$/.test(entry.source_ref)));

  const validBoundary = await agentGet(handler, tokenA, "/api/agent/v1/schedule?from=2026-01-01&to=2027-01-01");
  assert.equal(validBoundary.response.status, 200);
  assert.equal(validBoundary.body.entries.length, 366);
  const invalidBoundary = await agentGet(handler, tokenA, "/api/agent/v1/schedule?from=2026-01-01&to=2027-01-02");
  assert.equal(invalidBoundary.response.status, 400);
  assert.equal(invalidBoundary.body.error.code, "invalid_period");

  const after = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(after.training_version, before.training_version);
  assert.equal(after.plan_revisions.length, before.plan_revisions.length);

  const stateB = await store.getByEmail("athlete-b@example.invalid");
  const tokenB = await (async () => {
    return createAgentToken(handler, stateB.email);
  })();
  const bPlan = await agentGet(handler, tokenB, "/api/agent/v1/plan");
  assert.equal(bPlan.response.status, 200);
  assert.equal(bPlan.body.current, null);
  const spoofedIdentity = await agentGet(handler, tokenA, "/api/agent/v1/plan", { "x-athlete-email": stateB.email });
  assert.equal(spoofedIdentity.response.status, 200);
  assert.equal(spoofedIdentity.body.current.effective_from, before.plan_revisions[0].effective_from);
  const bSchedule = await agentGet(handler, tokenB, `/api/agent/v1/schedule?from=${today}&to=${today}`);
  assert.equal(bSchedule.body.entries[0].kind, "no_plan");
  const crossHeader = await handler.fetch(new Request(`https://workout.example/api/agent/v1/overview?athlete_key=${stateB.athlete_key}`, { headers: { Authorization: `Bearer ${tokenA}`, "x-athlete-email": stateB.email } }), { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example", AGENT_TOKEN_SECRET: testAgentSecret });
  assert.equal(crossHeader.status, 400);
});
