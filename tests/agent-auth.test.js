import test from "node:test";
import assert from "node:assert/strict";
import { appFixture, call } from "./helpers.js";

/** @param {any} handler @param {string|null} token @param {string} [path] @param {Record<string, string>} [headers] */
async function agentRequest(handler, token, path = "/api/agent/v1", headers = {}) {
  /** @type {Record<string, string>} */
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  const response = await handler.fetch(new Request(`https://workout.example${path}`, { headers: requestHeaders }), {
    LOCAL_AUTH: "true",
    PUBLIC_ORIGIN: "https://workout.example",
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { response, body };
}

test("Agent Token lifecycle is isolated and cannot cross existing auth boundaries", async () => {
  const { handler, store } = appFixture();

  const missing = await agentRequest(handler, null);
  assert.equal(missing.response.status, 401);
  assert.deepEqual(missing.body.error, {
    code: "agent_unauthorized",
    message: "A valid Agent Token is required",
    details: [],
  });

  const tampered = await agentRequest(handler, "A".repeat(43));
  assert.equal(tampered.response.status, 401);
  assert.equal(tampered.body.error.code, "agent_unauthorized");

  const created = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" });
  assert.equal(created.response.status, 201);
  assert.equal(typeof created.body.token, "string");
  assert.ok(created.body.token.length >= 40);
  const firstToken = created.body.token;

  const status = await call(handler, "/api/private/agent-access");
  assert.equal(status.response.status, 200);
  assert.equal(status.body.active, true);
  assert.equal(Object.hasOwn(status.body, "token"), false);
  assert.equal(Object.hasOwn(status.body, "token_digest"), false);

  const agentMe = await agentRequest(handler, firstToken, "/api/agent/v1", {
    "x-athlete-email": "athlete-b@example.invalid",
  });
  assert.equal(agentMe.response.status, 200);
  assert.equal(agentMe.body.athlete.display_name, "Athlete A");
  assert.equal(Object.hasOwn(agentMe.body, "email"), false);

  const selected = await agentRequest(handler, firstToken, "/api/agent/v1?athlete=athlete-b@example.invalid");
  assert.equal(selected.response.status, 400);
  assert.equal(selected.body.error.code, "invalid_request");

  const privateWithAgentToken = await agentRequest(handler, firstToken, "/api/private/me");
  assert.equal(privateWithAgentToken.response.status, 401);
  assert.equal(privateWithAgentToken.body.error.code, "unauthorized");

  const coachWithAgentToken = await agentRequest(handler, firstToken, "/api/coach/v1");
  assert.equal(coachWithAgentToken.response.status, 404);

  await call(handler, "/api/private/coach-share", { method: "POST", headers: { "Idempotency-Key": "coach-share-agent-test" }, body: "{}" });
  const coachShare = await call(handler, "/api/private/coach-share");
  const coachResponse = await handler.fetch(new Request(coachShare.body.url), { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example" });
  assert.equal(coachResponse.status, 200);

  const athleteBCreated = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" }, "athlete-b@example.invalid");
  assert.equal(athleteBCreated.response.status, 201);
  assert.notEqual(athleteBCreated.body.token, firstToken);

  const rotated = await call(handler, "/api/private/agent-access", { method: "POST", body: "{}" });
  assert.equal(rotated.response.status, 201);
  assert.notEqual(rotated.body.token, firstToken);
  const secondToken = rotated.body.token;

  const oldToken = await agentRequest(handler, firstToken);
  assert.equal(oldToken.response.status, 401);
  assert.equal(oldToken.body.error.code, "agent_unauthorized");

  const newToken = await agentRequest(handler, secondToken);
  assert.equal(newToken.response.status, 200);
  assert.equal(newToken.body.athlete.display_name, "Athlete A");

  const bToken = await agentRequest(handler, athleteBCreated.body.token);
  assert.equal(bToken.response.status, 200);
  assert.equal(bToken.body.athlete.display_name, "Athlete B");

  const revoked = await call(handler, "/api/private/agent-access", { method: "DELETE" });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.active, false);
  const revokedToken = await agentRequest(handler, secondToken);
  assert.equal(revokedToken.response.status, 401);

  const savedA = await store.getByEmail("athlete-a@example.invalid");
  const savedB = await store.getByEmail("athlete-b@example.invalid");
  assert.equal(Object.hasOwn(savedA.agent_access ?? {}, "token"), false);
  assert.equal(Object.hasOwn(savedB.agent_access ?? {}, "token"), false);
  assert.doesNotMatch(JSON.stringify(savedA), new RegExp(firstToken));
  assert.doesNotMatch(JSON.stringify(savedA), new RegExp(secondToken));
  assert.doesNotMatch(JSON.stringify(savedB), new RegExp(athleteBCreated.body.token));
});
