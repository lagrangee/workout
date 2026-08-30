// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { appendPlanRevision } from "../src/plan.js";
import { agentRequest, appFixture, createAgentToken } from "./helpers.js";
import { portablePlanUpdateV2 } from "./fixtures/plan-update-v2.js";

const TODAY = "2026-08-30";
const YESTERDAY = "2026-08-29";

function datedWeek() {
  const value = portablePlanUpdateV2("2026-08-24");
  value.week.saturday = { ...value.week.monday, title: "下肢力量与下坡耐受", start_time: "18:30", estimated_duration_min: 60 };
  value.week.monday = null;
  value.week.sunday = { kind: "rest" };
  return value;
}

async function configuredFixture() {
  const value = appFixture({ today: TODAY });
  const state = await value.store.getByEmail("athlete-a@example.invalid");
  state.plan_revisions = [];
  state.plan_day_storage_version = 0;
  state.planned_days = [];
  state.plan_changes = [];
  appendPlanRevision(state, datedWeek(), new Date("2026-08-23T04:00:00.000Z"));
  await value.store.save(state);
  const token = await createAgentToken(value.handler);
  return { ...value, token };
}

async function agentPost(handler, token, path, body, key) {
  return agentRequest(handler, token, path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  });
}

test("Planned Day move validates, atomically swaps a workout with a Rest Day, and verifies both dates", async () => {
  const { handler, store, token } = await configuredFixture();
  const move = { source_date: YESTERDAY, target_date: TODAY };
  const preview = await agentPost(handler, token, "/api/agent/v1/planned-day-moves/validate", { move });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.valid, true);
  assert.equal(preview.body.preview.before.source.kind, "workout");
  assert.equal(preview.body.preview.before.target.kind, "rest");
  assert.equal(preview.body.preview.after.source.kind, "rest");
  assert.equal(preview.body.preview.after.target.kind, "workout");

  const before = await store.getByEmail("athlete-a@example.invalid");
  const applied = await agentPost(handler, token, "/api/agent/v1/planned-day-moves/apply", {
    move,
    move_digest: preview.body.move_digest,
    base_plan_digest: preview.body.base_plan_digest,
    confirmed: true,
  }, "move-yesterday-to-today");
  assert.equal(applied.response.status, 201);
  assert.equal(applied.body.applied, true);
  assert.equal(applied.body.training_version, before.training_version + 1);

  const schedule = await agentRequest(handler, token, `/api/agent/v1/schedule?from=${YESTERDAY}&to=${TODAY}&expand=prescription`);
  assert.equal(schedule.body.entries[0].kind, "rest");
  assert.equal(schedule.body.entries[0].is_overdue_unstarted, false);
  assert.equal(schedule.body.entries[0].moved_to_date, TODAY);
  assert.equal(schedule.body.entries[1].kind, "workout");
  assert.equal(schedule.body.entries[1].moved_from_date, YESTERDAY);
  assert.equal(schedule.body.entries[1].title, "下肢力量与下坡耐受");
  assert.equal(schedule.body.prescriptions[schedule.body.entries[1].prescription_ref].estimated_duration_min, 60);

  const state = await store.getByEmail("athlete-a@example.invalid");
  assert.equal(state.plan_changes.at(-1).change_type, "day_move");
  assert.equal(state.planned_days.find((day) => day.date === YESTERDAY).moved_to_date, TODAY);
  assert.equal(state.planned_days.find((day) => day.date === TODAY).moved_from_date, YESTERDAY);
  assert.equal(state.plan_revisions.length, 1);
});

test("Planned Day move preview evidence is bound to its Athlete", async () => {
  const { handler, store, token } = await configuredFixture();
  const athleteB = await store.getByEmail("athlete-b@example.invalid");
  athleteB.plan_revisions = [];
  athleteB.plan_day_storage_version = 0;
  athleteB.planned_days = [];
  athleteB.plan_changes = [];
  appendPlanRevision(athleteB, datedWeek(), new Date("2026-08-23T04:00:00.000Z"));
  await store.save(athleteB);
  const tokenB = await createAgentToken(handler, "athlete-b@example.invalid");
  const move = { source_date: YESTERDAY, target_date: TODAY };
  const previewA = await agentPost(handler, token, "/api/agent/v1/planned-day-moves/validate", { move });
  const previewB = await agentPost(handler, tokenB, "/api/agent/v1/planned-day-moves/validate", { move });
  assert.notEqual(previewA.body.base_plan_digest, previewB.body.base_plan_digest);

  const rejected = await agentPost(handler, tokenB, "/api/agent/v1/planned-day-moves/apply", {
    move,
    move_digest: previewA.body.move_digest,
    base_plan_digest: previewA.body.base_plan_digest,
    confirmed: true,
  }, "cross-athlete-planned-day-move");
  assert.equal(rejected.response.status, 409);
  assert.equal(rejected.body.error.code, "stale_plan");
});

test("Planned Day move rejects stale evidence and any date that already owns a Session", async () => {
  const { handler, store, token } = await configuredFixture();
  const move = { source_date: YESTERDAY, target_date: TODAY };
  const preview = await agentPost(handler, token, "/api/agent/v1/planned-day-moves/validate", { move });
  const state = await store.getByEmail("athlete-a@example.invalid");
  state.training_version += 1;
  await store.save(state);
  const stale = await agentPost(handler, token, "/api/agent/v1/planned-day-moves/apply", {
    move,
    move_digest: preview.body.move_digest,
    base_plan_digest: preview.body.base_plan_digest,
    confirmed: true,
  }, "stale-planned-day-move");
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "stale_plan");

  const withSession = await store.getByEmail("athlete-a@example.invalid");
  withSession.sessions.push({ scheduled_date: YESTERDAY, session_key: "existing-session" });
  await store.save(withSession);
  const rejected = await agentPost(handler, token, "/api/agent/v1/planned-day-moves/validate", { move });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.error.code, "invalid_planned_day_move");
  assert.match(JSON.stringify(rejected.body.error.details), /Workout Session/);
});
