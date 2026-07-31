import test from "node:test";
import assert from "node:assert/strict";
import { appFixture } from "./helpers.js";

/** @param {any} store @returns {Record<string, any>} */
function authEnv(store) {
  return {
    STORE: store,
    ATHLETE_A_EMAIL: "athlete-a@example.invalid",
    ATHLETE_B_EMAIL: "athlete-b@example.invalid",
    AUTH_A_PASSWORD: "a-correct-password",
    AUTH_B_PASSWORD: "b-correct-password",
    AUTH_SESSION_SECRET: "test-session-secret-32-bytes-minimum",
    PUBLIC_ORIGIN: "https://workout.example",
  };
}

/** @param {Response} response */
async function jsonResponse(response) {
  const text = await response.text();
  return { response, body: JSON.parse(text) };
}

test("simple auth: each configured email gets an isolated signed session cookie", async () => {
  const { handler, store } = appFixture();
  const env = authEnv(store);
  const login = await handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password: "a-correct-password" }),
  }), env);
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /workout_session=/);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];

  const me = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/private/me", { headers: { Cookie: cookie } }), env));
  assert.equal(me.response.status, 200);
  assert.equal(me.body.display_name, "Athlete A");

  const otherLogin = await handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "athlete-b@example.invalid", password: "b-correct-password" }),
  }), env);
  const otherCookie = otherLogin.headers.get("set-cookie").split(";", 1)[0];
  const otherMe = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/private/me", { headers: { Cookie: otherCookie } }), env));
  assert.equal(otherMe.response.status, 200);
  assert.equal(otherMe.body.display_name, "Athlete B");
});

test("simple auth: invalid credentials and tampered sessions fail closed", async () => {
  const { handler, store } = appFixture();
  const env = authEnv(store);
  const badLogin = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password: "wrong" }),
  }), env));
  assert.equal(badLogin.response.status, 401);
  assert.equal(badLogin.body.error.code, "invalid_credentials");

  const tampered = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/private/me", {
    headers: { Cookie: "workout_session=not-a-valid-session" },
  }), env));
  assert.equal(tampered.response.status, 401);
  assert.equal(tampered.body.error.code, "unauthorized");
});

test("simple auth: logout expires the session cookie", async () => {
  const { handler, store } = appFixture();
  const env = authEnv(store);
  const logout = await handler.fetch(new Request("https://workout.example/api/auth/logout", { method: "POST" }), env);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  const body = await logout.json();
  assert.deepEqual(body, { logged_out: true });
});
