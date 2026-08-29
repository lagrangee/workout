import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../src/util.js";
import { agentRequest, appFixture, call, createAgentToken, post } from "./helpers.js";

const fixedDay = "2026-08-29";

test("HTTP request clock: Session creation captures one instant across a Shanghai midnight boundary", async () => {
  const beforeMidnight = new Date(`${fixedDay}T15:59:59.999Z`);
  const afterMidnight = new Date(beforeMidnight.getTime() + 2);
  let reads = 0;
  const fixture = appFixture({ today: fixedDay, clock: () => [beforeMidnight, afterMidnight][reads++] ?? afterMidnight });

  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${fixedDay}/start`, post({}, "fixed-clock-start"));

  assert.equal(started.response.status, 201);
  assert.equal(reads, 1);
  assert.equal(started.body.created_at, beforeMidnight.toISOString());
  assert.equal(started.body.updated_at, beforeMidnight.toISOString());
  assert.equal(started.body.training_intervals[0].started_at, beforeMidnight.toISOString());
  assert.equal(started.body.scheduled_date, fixedDay);
  const persisted = await fixture.store.getByEmail("athlete-a@example.invalid");
  assert.equal(persisted.updated_at, beforeMidnight.toISOString());
});

test("HTTP request clock: private cursor stays valid for exactly its injected lifetime", async () => {
  let instant = new Date(`${fixedDay}T04:00:00.123Z`);
  let reads = 0;
  const fixture = appFixture({ today: fixedDay, clock: () => { reads += 1; return instant; } });
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${fixedDay}/start`, post({}, "fixed-clock-cursor-start"));
  assert.equal(started.response.status, 201);

  const state = fixture.store.athletes.get("athlete-a@example.invalid");
  state.sessions.push({
    ...structuredClone(state.sessions[0]),
    session_key: "session_older",
    scheduled_date: addDays(fixedDay, -1),
    local_date: addDays(fixedDay, -1),
  });
  const beforeList = reads;
  const listed = await call(fixture.handler, "/api/private/sessions?limit=1");

  assert.equal(listed.response.status, 200);
  assert.equal(reads, beforeList + 1);
  const issuedAt = instant;
  instant = new Date(issuedAt.getTime() + 15 * 60 * 1000);
  const boundary = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(listed.body.page.next_cursor)}`);
  assert.equal(boundary.response.status, 200);
  instant = new Date(issuedAt.getTime() + 15 * 60 * 1000 + 1);
  const expired = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(listed.body.page.next_cursor)}`);
  assert.equal(expired.response.status, 400);
  assert.equal(expired.body.error.code, "invalid_cursor");
});

test("HTTP request clock: Coach cursor uses the injected issuance and expiry instant", async () => {
  let instant = new Date(`${fixedDay}T04:00:00.123Z`);
  const fixture = appFixture({ today: fixedDay, clock: () => instant });
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${fixedDay}/start`, post({}, "fixed-clock-coach-start"));
  assert.equal(started.response.status, 201);
  const state = fixture.store.athletes.get("athlete-a@example.invalid");
  state.sessions.push({
    ...structuredClone(state.sessions[0]),
    session_key: "session_coach_older",
    scheduled_date: addDays(fixedDay, -1),
    local_date: addDays(fixedDay, -1),
  });
  const created = await call(fixture.handler, "/api/private/coach-share", post({}, "fixed-clock-coach-share"));
  assert.equal(created.response.status, 201);
  const share = await call(fixture.handler, "/api/private/coach-share");
  const token = share.body.url.split("/coach/")[1];
  const first = await call(fixture.handler, `/api/coach/v1/${token}/sessions?limit=1`, { headers: {} }, "ignored@example.invalid");
  assert.equal(first.response.status, 200);
  const issuedAt = instant;

  instant = new Date(issuedAt.getTime() + 15 * 60 * 1000);
  const boundary = await call(fixture.handler, `/api/coach/v1/${token}/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(boundary.response.status, 200);
  instant = new Date(issuedAt.getTime() + 15 * 60 * 1000 + 1);
  const expired = await call(fixture.handler, `/api/coach/v1/${token}/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(expired.response.status, 400);
  assert.equal(expired.body.error.code, "invalid_cursor");
});

test("HTTP request clock: Agent Session cursor uses a genuine signed issuance instant", async () => {
  let instant = new Date(`${fixedDay}T04:00:00.123Z`);
  const fixture = appFixture({ today: fixedDay, clock: () => instant });
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${fixedDay}/start`, post({}, "fixed-clock-agent-cursor-start"));
  assert.equal(started.response.status, 201);
  const state = fixture.store.athletes.get("athlete-a@example.invalid");
  state.sessions.push({
    ...structuredClone(state.sessions[0]),
    session_key: "session_agent_older",
    scheduled_date: addDays(fixedDay, -1),
    local_date: addDays(fixedDay, -1),
  });
  const token = await createAgentToken(fixture.handler);
  const first = await agentRequest(fixture.handler, token, "/api/agent/v1/sessions?limit=1");
  assert.equal(first.response.status, 200);
  const issuedAt = instant;

  instant = new Date(issuedAt.getTime() + 15 * 60 * 1000);
  const boundary = await agentRequest(fixture.handler, token, `/api/agent/v1/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(boundary.response.status, 200);
  instant = new Date(issuedAt.getTime() + 15 * 60 * 1000 + 1);
  const expired = await agentRequest(fixture.handler, token, `/api/agent/v1/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(expired.response.status, 400);
  assert.equal(expired.body.error.code, "invalid_cursor");
});

test("HTTP request clock: same-millisecond start and pause preserve the deterministic minimum interval", async () => {
  const instant = new Date(`${fixedDay}T04:00:00.000Z`);
  const fixture = appFixture({ today: fixedDay, clock: () => instant });
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${fixedDay}/start`, post({}, "same-millisecond-start"));
  assert.equal(started.response.status, 201);
  const paused = await call(fixture.handler, `/api/private/sessions/${started.body.session_key}/pause`, post({}, "same-millisecond-pause"));
  assert.equal(paused.response.status, 200);
  assert.equal(paused.body.training_intervals[0].started_at, instant.toISOString());
  assert.equal(paused.body.training_intervals[0].ended_at, new Date(instant.getTime() + 1).toISOString());
});

test("HTTP request clock: signed session expiry changes exactly at the injected boundary", async () => {
  const issuedAt = new Date("2026-08-29T04:00:00.000Z");
  let instant = issuedAt;
  const fixture = appFixture({ today: fixedDay, clock: () => instant });
  const env = {
    STORE: fixture.store,
    ATHLETE_A_EMAIL: "athlete-a@example.invalid",
    ATHLETE_B_EMAIL: "athlete-b@example.invalid",
    AUTH_A_PASSWORD: "a-correct-password",
    AUTH_B_PASSWORD: "b-correct-password",
    AUTH_SESSION_SECRET: "test-session-secret-32-bytes-minimum",
    PUBLIC_ORIGIN: "https://workout.example",
  };
  const login = await fixture.handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password: "a-correct-password" }),
  }), env);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];

  instant = new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000 - 1_000);
  const beforeExpiry = await fixture.handler.fetch(new Request("https://workout.example/api/private/me", { headers: { Cookie: cookie } }), env);
  assert.equal(beforeExpiry.status, 200);

  instant = new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const atExpiry = await fixture.handler.fetch(new Request("https://workout.example/api/private/me", { headers: { Cookie: cookie } }), { ...env, SECURITY_EVENT_SINK() {} });
  assert.equal(atExpiry.status, 401);
});
