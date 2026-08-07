// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { McpBridge, WorkoutApiClient } from "../mcp/bridge.mjs";

test("workout MCP exposes exactly the first three typed read tools", async () => {
  const client = new WorkoutApiClient({ origin: "https://workout.example", token: "local-test-token", fetchImpl: async () => new Response(JSON.stringify({ ok: true })) });
  const bridge = new McpBridge({ client });
  const listed = await bridge.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["workout_get_overview", "workout_get_plan", "workout_get_schedule"]);
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
});
