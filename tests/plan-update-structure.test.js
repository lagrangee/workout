// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { McpBridge, WorkoutApiClient } from "../mcp/bridge.mjs";
import { addDays } from "../src/util.js";
import { portablePlanUpdateV2 } from "./fixtures/plan-update-v2.js";
import { appFixture, call, json, today } from "./helpers.js";

test("Server and MCP accept the same portable v2 package with nullable resistance and decimal tempo", async () => {
  const packageValue = portablePlanUpdateV2(addDays(today, 1));
  const { handler } = appFixture();
  const serverResult = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: JSON.stringify(packageValue) }));

  assert.equal(serverResult.response.status, 200);
  assert.equal(serverResult.body.valid, true);

  const requests = [];
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({ valid: true }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });
  const mcpResult = await bridge.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "workout_validate_plan_update", arguments: { package: packageValue } },
  });

  assert.equal(mcpResult.error, undefined);
  assert.equal(mcpResult.result.structuredContent.valid, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].options.body), { package_text: JSON.stringify(packageValue) });
});

test("Server and MCP reject the same invalid portable structure before mutation", async () => {
  const packageValue = portablePlanUpdateV2(addDays(today, 1));
  packageValue.week.monday.blocks[0].exercises[0].sets[0]["un/expected"] = true;

  const { handler } = appFixture();
  const before = await call(handler, "/api/private/plan");
  const serverResult = await call(handler, "/api/private/plan-updates/apply", json({
    method: "POST",
    headers: { "Idempotency-Key": "invalid-portable-plan-structure" },
  }, { package_text: JSON.stringify(packageValue) }));
  const after = await call(handler, "/api/private/plan");

  assert.equal(serverResult.response.status, 400);
  assert.equal(serverResult.body.error.code, "invalid_plan_package");
  assert.equal(serverResult.body.error.details.some((detail) => detail.path.endsWith("/un~1expected")), true);
  assert.deepEqual(after.body, before.body);

  let requests = 0;
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({ applied: true }), { headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });
  const mcpResult = await bridge.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "workout_apply_plan_update",
      arguments: {
        package: packageValue,
        package_digest: "a".repeat(64),
        base_plan_digest: "b".repeat(64),
        confirmed: true,
        idempotency_key: "invalid-portable-plan-structure",
      },
    },
  });

  assert.equal(mcpResult.error.code, -32602);
  assert.equal(requests, 0);
});

test("MCP forwards date, Registry, capability, and trimming decisions to the Server", async () => {
  const cases = [
    ["date", (value) => { value.effective_from = "not-a-date"; }],
    ["Registry", (value) => { value.week.monday.blocks[0].exercises[0].exercise_id = "not_in_registry"; }],
    ["capability", (value) => { value.week.monday.blocks[0].exercises[0].execution_mode = "bilateral"; }],
    ["trimming", (value) => { value.week.monday.title = " 核心训练"; }],
  ];
  const { handler } = appFixture();
  const requests = [];
  const client = new WorkoutApiClient({
    origin: "https://workout.example",
    token: "local-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(JSON.stringify({
        error: { code: "invalid_plan_package", message: "The plan package needs repair", details: [] },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    },
  });
  const bridge = new McpBridge({ client });

  for (const [label, mutate] of cases) {
    const packageValue = portablePlanUpdateV2(addDays(today, 1));
    mutate(packageValue);
    const serverResult = await call(handler, "/api/private/plan-updates/validate", json({ method: "POST" }, { package_text: JSON.stringify(packageValue) }));
    assert.equal(serverResult.response.status, 400, label);
    assert.equal(serverResult.body.error.code, "invalid_plan_package", label);

    const mcpResult = await bridge.handleMessage({
      jsonrpc: "2.0",
      id: label,
      method: "tools/call",
      params: { name: "workout_validate_plan_update", arguments: { package: packageValue } },
    });
    assert.equal(mcpResult.error, undefined, label);
    assert.equal(mcpResult.result.isError, true, label);
    assert.equal(mcpResult.result.structuredContent.error.code, "invalid_plan_package", label);
  }

  assert.equal(requests.length, cases.length);
});
