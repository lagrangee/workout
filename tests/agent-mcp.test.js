// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { McpBridge, WorkoutApiClient } from "../mcp/bridge.mjs";

test("workout MCP exposes exactly the typed tools", async () => {
  assert.throws(() => new WorkoutApiClient({ origin: "http://workout.example", token: "local-test-token" }), /HTTPS/);
  assert.throws(() => new WorkoutApiClient({ origin: "https://workout.example?unexpected=1", token: "local-test-token" }), /query or hash/);
  const client = new WorkoutApiClient({ origin: "https://workout.example", token: "local-test-token", fetchImpl: async () => new Response(JSON.stringify({ ok: true })) });
  await assert.rejects(() => client.getSchedule({ expand: "" }), /** @param {any} error */ (error) => error.code === "invalid_arguments");
  const bridge = new McpBridge({ client });
  const listed = await bridge.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["workout_get_overview", "workout_get_plan", "workout_get_schedule", "workout_list_sessions", "workout_get_session", "workout_get_progress", "workout_get_exercise_history", "workout_validate_plan_update", "workout_apply_plan_update", "workout_validate_plan_update_batch", "workout_apply_plan_update_batch"]);
  assert.equal(listed.result.tools.some((tool) => tool.name === "http_request"), false);
  assert.equal(listed.result.tools.filter((tool) => !tool.name.startsWith("workout_apply_")).every((tool) => tool.annotations.readOnlyHint === true), true);
  assert.equal(listed.result.tools.find((tool) => tool.name === "workout_apply_plan_update").annotations.readOnlyHint, false);
  assert.equal(listed.result.tools.find((tool) => tool.name === "workout_apply_plan_update_batch").annotations.readOnlyHint, false);
});

test("workout MCP maps typed calls to authenticated Agent API reads and preserves errors", async () => {
  const requests = [];
  const client = new WorkoutApiClient({
    origin: "https://workout.example/",
    token: "local-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("schedule")) return new Response(JSON.stringify({ error: { code: "invalid_period", message: "from and to are required", details: [] } }), { status: 400, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ schema_version: 1, data_as_of: "2026-08-07T00:00:00.000Z", ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });
  const plan = await bridge.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "workout_get_plan", arguments: {} } });
  assert.equal(plan.result.isError, undefined);
  assert.deepEqual(plan.result.structuredContent, { schema_version: 1, data_as_of: "2026-08-07T00:00:00.000Z", ok: true });
  assert.equal(requests[0].url, "https://workout.example/api/agent/v1/plan");
  assert.equal(requests[0].options.headers.Authorization, "Bearer local-test-token");

  const schedule = await bridge.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "workout_get_schedule", arguments: { from: "2026-08-01", to: "2026-08-02" } } });
  assert.equal(schedule.result.isError, true);
  assert.equal(schedule.result.structuredContent.error.code, "invalid_period");
  assert.equal(requests[1].url, "https://workout.example/api/agent/v1/schedule?from=2026-08-01&to=2026-08-02");

  const unknownArgument = await bridge.handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "workout_get_plan", arguments: { athlete_key: "athlete-b" } } });
  assert.equal(unknownArgument.error.code, -32602);
  const wrongType = await bridge.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "workout_get_schedule", arguments: { from: "2026-08-01", to: true } } });
  assert.equal(wrongType.error.code, -32602);
  assert.equal(requests.length, 2);

  const invalidJsonBridge = new McpBridge({ client: new WorkoutApiClient({ origin: "https://workout.example", token: "local-test-token", fetchImpl: async () => new Response("not-json", { status: 200 }) }) });
  const invalidJson = await invalidJsonBridge.handleMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "workout_get_plan", arguments: {} } });
  assert.equal(invalidJson.result.isError, true);
  assert.equal(invalidJson.result.structuredContent.error.code, "invalid_response");
});

test("workout MCP maps Session, progress, and Exercise history arguments without retries", async () => {
  const requests = [];
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ schema_version: 1, training_version: 4, data_as_of: "2026-08-08T00:00:00.000Z", items: [], page: { next_cursor: "next" } }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });

  const sessions = await bridge.handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "workout_list_sessions", arguments: { from: "2026-08-01", to: "2026-08-08", limit: 2, cursor: "opaque cursor", status: "partial", exercise_id: "split_squat" } } });
  assert.equal(sessions.result.structuredContent.training_version, 4);
  assert.equal(new URL(requests[0].url).pathname, "/api/agent/v1/sessions");
  assert.equal(new URL(requests[0].url).searchParams.get("cursor"), "opaque cursor");
  assert.equal(new URL(requests[0].url).searchParams.get("limit"), "2");

  await bridge.handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "workout_get_session", arguments: { session_key: "sess_1/opaque" } } });
  assert.equal(new URL(requests[1].url).pathname, "/api/agent/v1/sessions/sess_1%2Fopaque");

  await bridge.handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "workout_get_progress", arguments: { preset: "all", bucket: "week" } } });
  assert.equal(new URL(requests[2].url).searchParams.get("preset"), "all");
  assert.equal(new URL(requests[2].url).searchParams.get("bucket"), "week");

  await bridge.handleMessage({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "workout_get_exercise_history", arguments: { exercise_id: "split_squat", range: "12w" } } });
  assert.equal(new URL(requests[3].url).pathname, "/api/agent/v1/exercises/split_squat");
  assert.equal(new URL(requests[3].url).searchParams.get("range"), "12w");
  assert.equal(requests.every((request) => request.options.headers.Authorization === "Bearer local-test-token"), true);
  assert.equal(requests.length, 4);
});

test("workout MCP preserves typed history errors and never retries stale reads", async () => {
  const responses = [
    { status: 400, body: { error: { code: "invalid_cursor", message: "Cursor expired", details: [] } } },
    { status: 409, body: { error: { code: "training_version_changed", message: "Restart from page one", details: [] } } },
    { status: 404, body: { error: { code: "not_found", message: "Not found", details: [] } } },
  ];
  let calls = 0;
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async () => {
      const response = responses[calls++];
      return new Response(JSON.stringify(response.body), { status: response.status, headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });

  const invalidCursor = await bridge.handleMessage({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "workout_list_sessions", arguments: { cursor: "expired" } } });
  assert.equal(invalidCursor.result.isError, true);
  assert.equal(invalidCursor.result.structuredContent.error.code, "invalid_cursor");
  assert.equal(invalidCursor.result.structuredContent.status, 400);

  const changed = await bridge.handleMessage({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "workout_list_sessions", arguments: { cursor: "stale" } } });
  assert.equal(changed.result.isError, true);
  assert.equal(changed.result.structuredContent.error.code, "training_version_changed");
  assert.equal(changed.result.structuredContent.status, 409);

  const missing = await bridge.handleMessage({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "workout_get_session", arguments: { session_key: "missing" } } });
  assert.equal(missing.result.isError, true);
  assert.equal(missing.result.structuredContent.error.code, "not_found");
  assert.equal(missing.result.structuredContent.status, 404);
  assert.equal(calls, 3);
});

test("workout MCP serializes a typed Plan Update Package for non-mutating validation", async () => {
  const requests = [];
  const packageValue = { schema_version: 2, effective_from: "2026-08-09", week: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } };
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ schema_version: 1, valid: true, source_ref: "plan-update:validation", preview: { effective_from: "2026-08-09", week: packageValue.week, changed_weekday_slot_count: 1 } }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });
  const result = await bridge.handleMessage({ jsonrpc: "2.0", id: 14, method: "tools/call", params: { name: "workout_validate_plan_update", arguments: { package: packageValue } } });
  assert.equal(result.result.structuredContent.valid, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://workout.example/api/agent/v1/plan-updates/validate");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].options.body), { package_text: JSON.stringify(packageValue) });

  const wrongType = await bridge.handleMessage({ jsonrpc: "2.0", id: 15, method: "tools/call", params: { name: "workout_validate_plan_update", arguments: { package: [] } } });
  assert.equal(wrongType.error.code, -32602);
  assert.equal(requests.length, 1);

  const incomplete = await bridge.handleMessage({ jsonrpc: "2.0", id: 16, method: "tools/call", params: { name: "workout_validate_plan_update", arguments: { package: {} } } });
  assert.equal(incomplete.error.code, -32602);
  assert.equal(requests.length, 1);

  const nestedUnknown = JSON.parse(JSON.stringify(packageValue));
  nestedUnknown.week.monday = { kind: "rest", unexpected: true };
  const nestedUnknownResult = await bridge.handleMessage({ jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "workout_validate_plan_update", arguments: { package: nestedUnknown } } });
  assert.equal(nestedUnknownResult.error.code, -32602);
  assert.equal(requests.length, 1);

  const nestedPrototype = JSON.parse(JSON.stringify(packageValue));
  nestedPrototype.week.monday = JSON.parse('{"kind":"rest","__proto__":true}');
  const nestedPrototypeResult = await bridge.handleMessage({ jsonrpc: "2.0", id: 18, method: "tools/call", params: { name: "workout_validate_plan_update", arguments: { package: nestedPrototype } } });
  assert.equal(nestedPrototypeResult.error.code, -32602);
  assert.equal(requests.length, 1);

  const topLevelConstructor = JSON.parse(JSON.stringify(packageValue));
  topLevelConstructor.constructor = true;
  const topLevelConstructorResult = await bridge.handleMessage({ jsonrpc: "2.0", id: 19, method: "tools/call", params: { name: "workout_validate_plan_update", arguments: { package: topLevelConstructor } } });
  assert.equal(topLevelConstructorResult.error.code, -32602);
  assert.equal(requests.length, 1);

  const incompleteWorkout = JSON.parse(JSON.stringify(packageValue));
  incompleteWorkout.week.monday = { kind: "workout" };
  const incompleteWorkoutResult = await bridge.handleMessage({ jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "workout_validate_plan_update", arguments: { package: incompleteWorkout } } });
  assert.equal(incompleteWorkoutResult.error.code, -32602);
  assert.equal(requests.length, 1);
});

test("workout MCP applies a confirmed package and verifies plan and schedule readback", async () => {
  const requests = [];
  const packageValue = { schema_version: 2, effective_from: "2026-08-09", week: { monday: null, tuesday: { kind: "rest" }, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } };
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/plan-updates/apply")) return new Response(JSON.stringify({ schema_version: 1, applied: true, effective_from: "2026-08-09", package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64) }), { headers: { "Content-Type": "application/json" } });
      if (String(url).endsWith("/plan")) return new Response(JSON.stringify({ source_ref: "plan", future: [{ effective_from: "2026-08-09", week: packageValue.week }] }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ source_ref: "schedule", from: "2026-08-09", to: "2026-08-15", entries: ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"].map((date) => ({ date })) }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });
  const result = await bridge.handleMessage({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "workout_apply_plan_update", arguments: { package: packageValue, package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true, idempotency_key: "apply-1" } } });
  assert.equal(result.result.structuredContent.applied, true);
  assert.equal(result.result.structuredContent.readback.status, "verified");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, "https://workout.example/api/agent/v1/plan-updates/apply");
  assert.equal(requests[0].options.headers.Authorization, "Bearer local-test-token");
  assert.equal(requests[0].options.headers["Idempotency-Key"], "apply-1");
  assert.deepEqual(JSON.parse(requests[0].options.body), { package_text: JSON.stringify(packageValue), package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true });
  assert.equal(requests[1].url, "https://workout.example/api/agent/v1/plan");
  assert.equal(requests[2].url, "https://workout.example/api/agent/v1/schedule?from=2026-08-09&to=2026-08-15&expand=prescription");

  const missingDigest = await bridge.handleMessage({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "workout_apply_plan_update", arguments: { package: packageValue, base_plan_digest: "b".repeat(64), confirmed: true, idempotency_key: "apply-2" } } });
  assert.equal(missingDigest.error.code, -32602);
  const unconfirmed = await bridge.handleMessage({ jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "workout_apply_plan_update", arguments: { package: packageValue, package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: false, idempotency_key: "apply-3" } } });
  assert.equal(unconfirmed.error.code, -32602);
  const missingKey = await bridge.handleMessage({ jsonrpc: "2.0", id: 24, method: "tools/call", params: { name: "workout_apply_plan_update", arguments: { package: packageValue, package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true, idempotency_key: "" } } });
  assert.equal(missingKey.error.code, -32602);
  assert.equal(requests.length, 3);
});

test("workout MCP validates and atomically applies a typed four-week batch with full readback", async () => {
  const requests = [];
  const emptyWeek = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: { kind: "rest" } };
  const batch = { schema_version: 1, updates: [0, 1, 2, 3].map((index) => ({ schema_version: 2, effective_from: `2026-08-${10 + index * 7}`, week: emptyWeek })) };
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/plan-update-batches/validate")) return new Response(JSON.stringify({ valid: true, batch_digest: "a".repeat(64), base_plan_digest: "b".repeat(64) }), { headers: { "Content-Type": "application/json" } });
      if (String(url).endsWith("/plan-update-batches/apply")) return new Response(JSON.stringify({ applied: true, from: "2026-08-10", to: "2026-09-06", update_count: 4 }), { headers: { "Content-Type": "application/json" } });
      if (String(url).endsWith("/plan")) return new Response(JSON.stringify({ current: null, future: batch.updates.map(({ effective_from, week }) => ({ effective_from, week })) }), { headers: { "Content-Type": "application/json" } });
      const entries = Array.from({ length: 28 }, (_, index) => { const date = new Date("2026-08-10T00:00:00Z"); date.setUTCDate(date.getUTCDate() + index); return { date: date.toISOString().slice(0, 10) }; });
      return new Response(JSON.stringify({ from: "2026-08-10", to: "2026-09-06", entries }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });
  const validation = await bridge.handleMessage({ jsonrpc: "2.0", id: 25, method: "tools/call", params: { name: "workout_validate_plan_update_batch", arguments: { batch } } });
  assert.equal(validation.result.structuredContent.valid, true);
  assert.deepEqual(JSON.parse(requests[0].options.body), { batch_text: JSON.stringify(batch) });

  const applied = await bridge.handleMessage({ jsonrpc: "2.0", id: 26, method: "tools/call", params: { name: "workout_apply_plan_update_batch", arguments: { batch, batch_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true, idempotency_key: "batch-apply-1" } } });
  assert.equal(applied.result.structuredContent.readback.status, "verified");
  assert.equal(requests[1].url, "https://workout.example/api/agent/v1/plan-update-batches/apply");
  assert.equal(requests[1].options.headers["Idempotency-Key"], "batch-apply-1");
  assert.equal(requests[3].url, "https://workout.example/api/agent/v1/schedule?from=2026-08-10&to=2026-09-06&expand=prescription");
});

test("workout MCP accepts an applied revision when it is now the Current Plan", async () => {
  const packageValue = { schema_version: 2, effective_from: "2026-08-09", week: { monday: null, tuesday: { kind: "rest" }, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } };
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/plan-updates/apply")) return new Response(JSON.stringify({ applied: true, effective_from: "2026-08-09" }), { headers: { "Content-Type": "application/json" } });
      if (String(url).endsWith("/plan")) return new Response(JSON.stringify({ source_ref: "plan", current: { effective_from: "2026-08-09", week: packageValue.week }, future: [] }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ source_ref: "schedule", from: "2026-08-09", to: "2026-08-15", entries: ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"].map((date) => ({ date })) }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await client.applyPlanUpdate({ package: packageValue, package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true, idempotency_key: "apply-current" });
  assert.equal(result.readback.status, "verified");
});

test("workout MCP preserves a successful apply when post-apply readback fails", async () => {
  let calls = 0;
  const packageValue = { schema_version: 2, effective_from: "2026-08-09", week: { monday: null, tuesday: { kind: "rest" }, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } };
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url) => {
      calls += 1;
      if (String(url).endsWith("/plan-updates/apply")) return new Response(JSON.stringify({ applied: true, effective_from: "2026-08-09" }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: { code: "readback_unavailable", message: "temporary", details: [] } }), { status: 503, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await client.applyPlanUpdate({ package: packageValue, package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true, idempotency_key: "apply-4" });
  assert.equal(result.applied, true);
  assert.equal(result.readback.status, "failed");
  assert.equal(result.readback.error.code, "readback_unavailable");
  assert.equal(calls, 3);
});

test("workout MCP reports a readback mismatch instead of claiming verification", async () => {
  const packageValue = { schema_version: 2, effective_from: "2026-08-09", week: { monday: null, tuesday: { kind: "rest" }, wednesday: null, thursday: { kind: "rest" }, friday: null, saturday: null, sunday: null } };
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/plan-updates/apply")) return new Response(JSON.stringify({ applied: true, effective_from: "2026-08-09" }), { headers: { "Content-Type": "application/json" } });
      if (String(url).endsWith("/plan")) return new Response(JSON.stringify({ source_ref: "plan", future: [] }), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ source_ref: "schedule", from: "2026-08-09", to: "2026-08-15", entries: ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"].map((date) => ({ date })) }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await client.applyPlanUpdate({ package: packageValue, package_digest: "a".repeat(64), base_plan_digest: "b".repeat(64), confirmed: true, idempotency_key: "apply-mismatch" });
  assert.equal(result.applied, true);
  assert.equal(result.readback.status, "failed");
  assert.equal(result.readback.error.code, "readback_mismatch");
});
