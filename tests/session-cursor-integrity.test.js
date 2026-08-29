// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { addDays, base64UrlDecode, base64UrlEncode } from "../src/util.js";
import { agentRequest, appFixture, call, createAgentToken, post, TEST_NOW, today } from "./helpers.js";

function mutateCursorPayload(cursor, mutate) {
  const parts = cursor.split(".");
  const payloadIndex = parts.length === 3 ? 1 : 0;
  const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[payloadIndex])));
  mutate(value);
  parts[payloadIndex] = base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return parts.join(".");
}

function addOlderSession(fixture, key, email = "athlete-a@example.invalid") {
  const state = fixture.store.athletes.get(email);
  state.sessions.push({
    ...structuredClone(state.sessions[0]),
    session_key: key,
    scheduled_date: addDays(today, -1),
    local_date: addDays(today, -1),
  });
}

test("private Session cursor rejects a client-edited sort position", async () => {
  const fixture = appFixture();
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "private-cursor-tamper-start"));
  assert.equal(started.response.status, 201);
  addOlderSession(fixture, "session_private_older");

  const first = await call(fixture.handler, "/api/private/sessions?limit=1");
  assert.equal(first.response.status, 200);
  const tampered = mutateCursorPayload(first.body.page.next_cursor, (value) => {
    if (value.position) value.position.key = "client_forged_position";
    else value.key = "client_forged_position";
  });
  const replay = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(tampered)}`);
  assert.equal(replay.response.status, 400);
  assert.equal(replay.body.error.code, "invalid_cursor");
});

test("private Session cursor rejects legacy tokens and cross-Athlete replay while preserving genuine stale 409", async () => {
  const fixture = appFixture();
  await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "private-cursor-boundary-start"));
  addOlderSession(fixture, "session_private_boundary_older");
  const first = await call(fixture.handler, "/api/private/sessions?limit=1");
  assert.equal(first.response.status, 200);
  assert.match(first.body.page.next_cursor, /^v1\./);
  const wrongLimit = await call(fixture.handler, `/api/private/sessions?limit=2&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(wrongLimit.response.status, 400);
  assert.equal(wrongLimit.body.error.code, "invalid_cursor");

  const legacy = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ filters: "legacy", date: today, key: first.body.items[0].session_key, issued_at: Date.parse(TEST_NOW) })));
  const oldFormat = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(legacy)}`);
  assert.equal(oldFormat.response.status, 400);
  assert.equal(oldFormat.body.error.code, "invalid_cursor");

  const foreign = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`, {}, "athlete-b@example.invalid");
  assert.equal(foreign.response.status, 400);
  assert.equal(foreign.body.error.code, "invalid_cursor");

  const state = fixture.store.athletes.get("athlete-a@example.invalid");
  state.training_version += 1;
  const stale = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "training_version_changed");
});

test("Coach Session cursor rejects tamper, old format, cross-share replay, and genuine stale data", async () => {
  const fixture = appFixture();
  await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "coach-cursor-boundary-start"));
  addOlderSession(fixture, "session_coach_boundary_older");
  await call(fixture.handler, "/api/private/coach-share", post({}, "coach-cursor-boundary-share"));
  const copied = await call(fixture.handler, "/api/private/coach-share");
  const coachToken = copied.body.url.split("/coach/")[1];
  const first = await call(fixture.handler, `/api/coach/v1/${coachToken}/sessions?limit=1`, { headers: {} }, "ignored@example.invalid");
  assert.equal(first.response.status, 200);
  const wrongLimit = await call(fixture.handler, `/api/coach/v1/${coachToken}/sessions?limit=2&cursor=${encodeURIComponent(first.body.page.next_cursor)}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(wrongLimit.response.status, 400);
  assert.equal(wrongLimit.body.error.code, "invalid_cursor");

  for (const mutate of [
    (value) => { value.issued_at += 1; },
    (value) => { value.position.key = "client_forged_position"; },
  ]) {
    const token = mutateCursorPayload(first.body.page.next_cursor, mutate);
    const rejected = await call(fixture.handler, `/api/coach/v1/${coachToken}/sessions?limit=1&cursor=${encodeURIComponent(token)}`, { headers: {} }, "ignored@example.invalid");
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error.code, "invalid_cursor");
  }

  const legacy = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ filters: "legacy", date: today, key: first.body.items[0].session_key, issued_at: Date.parse(TEST_NOW) })));
  const oldFormat = await call(fixture.handler, `/api/coach/v1/${coachToken}/sessions?limit=1&cursor=${encodeURIComponent(legacy)}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(oldFormat.response.status, 400);
  assert.equal(oldFormat.body.error.code, "invalid_cursor");

  await call(fixture.handler, "/api/private/coach-share", post({}, "coach-cursor-boundary-share-b"), "athlete-b@example.invalid");
  const copiedB = await call(fixture.handler, "/api/private/coach-share", {}, "athlete-b@example.invalid");
  const coachTokenB = copiedB.body.url.split("/coach/")[1];
  const foreign = await call(fixture.handler, `/api/coach/v1/${coachTokenB}/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(foreign.response.status, 400);
  assert.equal(foreign.body.error.code, "invalid_cursor");

  const state = fixture.store.athletes.get("athlete-a@example.invalid");
  state.training_version += 1;
  const stale = await call(fixture.handler, `/api/coach/v1/${coachToken}/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "training_version_changed");
});

test("Coach and private Session cursors cannot be replayed across cursor domains", async () => {
  const fixture = appFixture();
  await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "cursor-domain-start"));
  addOlderSession(fixture, "session_cursor_domain_older");
  await call(fixture.handler, "/api/private/coach-share", post({}, "cursor-domain-share"));
  const copied = await call(fixture.handler, "/api/private/coach-share");
  const coachToken = copied.body.url.split("/coach/")[1];

  const privatePage = await call(fixture.handler, "/api/private/sessions?limit=1");
  const coachPage = await call(fixture.handler, `/api/coach/v1/${coachToken}/sessions?limit=1`, { headers: {} }, "ignored@example.invalid");
  const privateAsCoach = await call(fixture.handler, `/api/coach/v1/${coachToken}/sessions?limit=1&cursor=${encodeURIComponent(privatePage.body.page.next_cursor)}`, { headers: {} }, "ignored@example.invalid");
  const coachAsPrivate = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(coachPage.body.page.next_cursor)}`);
  assert.equal(privateAsCoach.response.status, 400);
  assert.equal(privateAsCoach.body.error.code, "invalid_cursor");
  assert.equal(coachAsPrivate.response.status, 400);
  assert.equal(coachAsPrivate.body.error.code, "invalid_cursor");

  const agentToken = await createAgentToken(fixture.handler);
  const agentPage = await agentRequest(fixture.handler, agentToken, "/api/agent/v1/sessions?limit=1");
  const agentAsPrivate = await call(fixture.handler, `/api/private/sessions?limit=1&cursor=${encodeURIComponent(agentPage.body.page.next_cursor)}`);
  assert.equal(agentAsPrivate.response.status, 400);
  assert.equal(agentAsPrivate.body.error.code, "invalid_cursor");
});
