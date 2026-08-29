// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { agentRequest, appFixture, call, createAgentToken, post, today } from "./helpers.js";
import { publishAerobicProjection } from "../src/training-archive.js";
import { addDays, base64UrlDecode, base64UrlEncode } from "../src/util.js";

const now = new Date("2026-08-17T08:00:00.000Z");
const path = "/api/agent/v1/aerobic/activities?from=2026-08-15&to=2026-08-15&limit=1";

/** @param {number} index */
function activity(index) {
  const suffix = String(index).padStart(2, "0");
  return {
    activity_ref: `cursor-integrity-${suffix}`,
    source_ref: `coros:activity:cursor-integrity-${suffix}`,
    local_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    started_at: `2026-08-15T01:00:${suffix}.000Z`,
    ended_at: `2026-08-15T01:30:${suffix}.000Z`,
    sport_type: 100,
    sport_name: "outdoor_run",
    source_status: "complete",
    data_as_of: "2026-08-17T07:59:00.000Z",
    updated_at: "2026-08-17T08:00:00.000Z",
    summary: { duration_sec: 1800, distance_km: 5, sport_metrics: {} },
    route_key: null,
    route_direction: null,
    route_match_status: "unmatched",
    fit_status: "complete",
  };
}

/** @param {string} cursor @param {number} archiveVersion */
function tamperArchiveVersion(cursor, archiveVersion) {
  const parts = cursor.split(".");
  const payloadIndex = parts.length === 3 ? 1 : 0;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[payloadIndex])));
  payload.archive_version = archiveVersion;
  parts[payloadIndex] = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return parts.join(".");
}

/** @param {ReturnType<typeof appFixture>} fixture @param {string} key */
function addOlderSession(fixture, key) {
  const state = fixture.store.athletes.get("athlete-a@example.invalid");
  state.sessions.push({
    ...structuredClone(state.sessions[0]),
    session_key: key,
    scheduled_date: addDays(today, -1),
    local_date: addDays(today, -1),
  });
}

test("Agent Archive rejects a cursor whose archive version was edited after publication", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  publishAerobicProjection(state, {
    target_date: "2026-08-15",
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: "2026-08-17T07:59:00.000Z",
    activities: [activity(1), activity(2)],
    routes: [],
  }, now);
  await store.save(state);
  const token = await createAgentToken(handler);
  const first = await agentRequest(handler, token, path);
  assert.equal(first.response.status, 200);
  assert.equal(typeof first.body.page.next_cursor, "string");

  const current = await store.getByEmail("athlete-a@example.invalid");
  current.archive_version += 1;
  await store.save(current);
  const tampered = tamperArchiveVersion(first.body.page.next_cursor, current.archive_version);
  const result = await agentRequest(handler, token, `${path}&cursor=${encodeURIComponent(tampered)}`);

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error.code, "invalid_cursor");
});

test("Agent Archive cursor verification fails closed across token shape, version, signature, and Athlete", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  publishAerobicProjection(state, {
    target_date: "2026-08-15",
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: "2026-08-17T07:59:00.000Z",
    activities: [activity(1), activity(2)],
    routes: [],
  }, now);
  await store.save(state);
  const tokenA = await createAgentToken(handler, "athlete-a@example.invalid");
  const tokenB = await createAgentToken(handler, "athlete-b@example.invalid");
  const first = await agentRequest(handler, tokenA, path);
  const cursor = first.body.page.next_cursor;
  assert.equal(typeof cursor, "string");
  const manifest = await agentRequest(handler, tokenA, "/api/agent/v1");
  assert.equal(manifest.body.query_rules.archive_cursor_format_version, 1);
  assert.equal(manifest.body.query_rules.archive_cursor_integrity, "hmac-sha256");
  assert.deepEqual(manifest.body.query_rules.archive_cursor_bound_to, ["athlete", "resource", "from", "to", "sport_type", "route_key", "limit", "position", "archive_version"]);

  const parts = cursor.split(".");
  const badSignature = [...parts];
  badSignature[2] = `${badSignature[2][0] === "A" ? "B" : "A"}${badSignature[2].slice(1)}`;
  const candidates = [
    "not-a-cursor",
    cursor.replace(/^v1\./, "v0."),
    badSignature.join("."),
  ];
  const expected = {
    error: {
      code: "invalid_cursor",
      message: "Cursor is malformed, expired, or does not match the filters",
      details: [],
    },
  };

  for (const candidate of candidates) {
    const result = await agentRequest(handler, tokenA, `${path}&cursor=${encodeURIComponent(candidate)}`);
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.body, expected);
  }
  const crossAthlete = await agentRequest(handler, tokenB, `${path}&cursor=${encodeURIComponent(cursor)}`);
  assert.equal(crossAthlete.response.status, 400);
  assert.deepEqual(crossAthlete.body, expected);
});

test("Agent Session cursor cannot be replayed by another Athlete", async () => {
  const fixture = appFixture();
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "agent-session-cross-athlete-start"));
  assert.equal(started.response.status, 201);
  addOlderSession(fixture, "session_agent_cross_athlete_older");
  const tokenA = await createAgentToken(fixture.handler, "athlete-a@example.invalid");
  const tokenB = await createAgentToken(fixture.handler, "athlete-b@example.invalid");
  const first = await agentRequest(fixture.handler, tokenA, "/api/agent/v1/sessions?limit=1");
  assert.equal(first.response.status, 200);
  assert.equal(typeof first.body.page.next_cursor, "string");

  const replay = await agentRequest(fixture.handler, tokenB, `/api/agent/v1/sessions?limit=1&cursor=${encodeURIComponent(first.body.page.next_cursor)}`);
  assert.equal(replay.response.status, 400);
  assert.equal(replay.body.error.code, "invalid_cursor");
});

test("Agent Session and Agent Archive cursors cannot replay across domains sharing AGENT_TOKEN_SECRET", async () => {
  const fixture = appFixture();
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "agent-session-archive-domain-start"));
  assert.equal(started.response.status, 201);
  addOlderSession(fixture, "session_agent_archive_domain_older");
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  publishAerobicProjection(state, {
    target_date: "2026-08-15",
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: "2026-08-17T07:59:00.000Z",
    activities: [activity(1), activity(2)],
    routes: [],
  }, now);
  await fixture.store.save(state);
  const token = await createAgentToken(fixture.handler);
  const sessionPage = await agentRequest(fixture.handler, token, "/api/agent/v1/sessions?limit=1");
  const archivePage = await agentRequest(fixture.handler, token, path);
  assert.equal(sessionPage.response.status, 200);
  assert.equal(archivePage.response.status, 200);
  assert.equal(typeof sessionPage.body.page.next_cursor, "string");
  assert.equal(typeof archivePage.body.page.next_cursor, "string");

  const sessionAsArchive = await agentRequest(fixture.handler, token, `${path}&cursor=${encodeURIComponent(sessionPage.body.page.next_cursor)}`);
  const archiveAsSession = await agentRequest(fixture.handler, token, `/api/agent/v1/sessions?limit=1&cursor=${encodeURIComponent(archivePage.body.page.next_cursor)}`);
  assert.equal(sessionAsArchive.response.status, 400);
  assert.equal(sessionAsArchive.body.error.code, "invalid_cursor");
  assert.equal(archiveAsSession.response.status, 400);
  assert.equal(archiveAsSession.body.error.code, "invalid_cursor");
});
