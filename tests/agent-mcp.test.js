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
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["workout_get_overview", "workout_get_plan", "workout_get_schedule", "workout_list_sessions", "workout_get_session", "workout_get_progress", "workout_get_exercise_history", "workout_validate_plan_update"]);
  assert.equal(listed.result.tools.some((tool) => tool.name === "http_request"), false);
  assert.equal(listed.result.tools.every((tool) => tool.annotations.readOnlyHint === true), true);
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

  const sessions = await bridge.handleMessage({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "workout_list_sessions", arguments: { from: "2026-08-01", to: "2026-08-08", limit: 2, cursor: "opaque cursor", status: "partial", exercise_key: "split_squat" } } });
  assert.equal(sessions.result.structuredContent.training_version, 4);
  assert.equal(new URL(requests[0].url).pathname, "/api/agent/v1/sessions");
  assert.equal(new URL(requests[0].url).searchParams.get("cursor"), "opaque cursor");
  assert.equal(new URL(requests[0].url).searchParams.get("limit"), "2");

  await bridge.handleMessage({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "workout_get_session", arguments: { session_key: "sess_1/opaque" } } });
  assert.equal(new URL(requests[1].url).pathname, "/api/agent/v1/sessions/sess_1%2Fopaque");

  await bridge.handleMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "workout_get_progress", arguments: { preset: "all", bucket: "week" } } });
  assert.equal(new URL(requests[2].url).searchParams.get("preset"), "all");
  assert.equal(new URL(requests[2].url).searchParams.get("bucket"), "week");

  await bridge.handleMessage({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "workout_get_exercise_history", arguments: { exercise_key: "split_squat", range: "12w" } } });
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
  const packageValue = { schema_version: 1, effective_from: "2026-08-09", week: { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null } };
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
});
