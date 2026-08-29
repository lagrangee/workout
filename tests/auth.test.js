import test from "node:test";
import assert from "node:assert/strict";
import { appendPlanRevision } from "../src/plan.js";
import { addDays } from "../src/util.js";
import { appFixture, createAgentToken, packageText, post, today, workout } from "./helpers.js";

/** @param {any} store @returns {Record<string, any>} */
function authEnv(store) {
  return {
    STORE: store,
    ATHLETE_A_EMAIL: "athlete-a@example.invalid",
    ATHLETE_B_EMAIL: "athlete-b@example.invalid",
    AUTH_A_PASSWORD: "a-correct-password",
    AUTH_B_PASSWORD: "b-correct-password",
    AUTH_SESSION_SECRET: "test-session-secret-32-bytes-minimum",
    AGENT_TOKEN_SECRET: "test-only-agent-token-secret",
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
    headers: { Origin: "https://workout.example", "Content-Type": "application/json" },
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
    headers: { Origin: "https://workout.example", "Content-Type": "application/json" },
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
    headers: { Origin: "https://workout.example", "Content-Type": "application/json" },
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

test("browser auth: cookie mutations require same-origin JSON while Agent Bearer remains independent", async () => {
  const { handler, store } = appFixture();
  const env = authEnv(store);
  const login = await handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password: "a-correct-password" }),
  }), env);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];

  const crossOrigin = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/private/agent-access", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: "{}",
  }), env));
  assert.equal(crossOrigin.response.status, 403);
  assert.equal(crossOrigin.body.error.code, "origin_not_allowed");

  const wrongType = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/private/agent-access", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://workout.example", "Content-Type": "text/plain" },
    body: "{}",
  }), env));
  assert.equal(wrongType.response.status, 415);
  assert.equal(wrongType.body.error.code, "json_content_type_required");

  const accepted = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/private/agent-access", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://workout.example", "Content-Type": "application/json" },
    body: "{}",
  }), env));
  assert.equal(accepted.response.status, 201);
  assert.equal(typeof accepted.body.token, "string");

  const agent = await jsonResponse(await handler.fetch(new Request("https://workout.example/api/agent/v1/plan-updates/validate", {
    method: "POST",
    headers: { Authorization: `Bearer ${accepted.body.token}`, "Content-Type": "application/json" },
    body: "{}",
  }), { ...env, AGENT_TOKEN_SECRET: "test-only-agent-token-secret" }));
  assert.equal(agent.response.status, 400);
  assert.notEqual(agent.body.error.code, "origin_not_allowed");
});

test("browser auth: login attempts use anonymous digest buckets and return an identity-neutral limit response", async () => {
  const { handler, store } = appFixture();
  /** @type {string[]} */
  const buckets = [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  const env = {
    ...authEnv(store),
    AUTH_LOGIN_RATE_LIMITER: {
      /** @param {{ key: string }} input */
      limit({ key }) {
        buckets.push(key);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return { success: count <= 2 };
      },
    },
  };
  /** @param {string} email */
  const attempt = (email) => handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.8" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  }), env);

  const known = await jsonResponse(await attempt("athlete-a@example.invalid"));
  const unknown = await jsonResponse(await attempt("unknown@example.invalid"));
  const knownAgain = await jsonResponse(await attempt("athlete-a@example.invalid"));
  const limited = await jsonResponse(await attempt("athlete-a@example.invalid"));

  assert.equal(known.response.status, 401);
  assert.equal(unknown.response.status, 401);
  assert.deepEqual(known.body, unknown.body);
  assert.equal(knownAgain.response.status, 401);
  assert.equal(limited.response.status, 429);
  assert.equal(limited.body.error.code, "rate_limited");
  assert.equal(limited.response.headers.get("Retry-After"), "600");
  assert.equal(buckets.length, 4);
  assert.ok(buckets.every((bucket) => /^[0-9a-f]{64}$/.test(bucket)));
  assert.ok(buckets.every((bucket) => !bucket.includes("athlete") && !bucket.includes("203.0.113.8")));
  assert.equal(buckets[0], buckets[2]);
  assert.equal(buckets[0], buckets[3]);
  assert.notEqual(buckets[0], buckets[1]);
});

test("browser auth: one candidate identity shares its budget across source IPs", async () => {
  const { handler, store } = appFixture();
  /** @type {string[]} */
  const identityBuckets = [];
  /** @type {string[]} */
  const clientBuckets = [];
  const env = {
    ...authEnv(store),
    AUTH_LOGIN_RATE_LIMITER: {
      /** @param {{ key: string }} input */
      limit({ key }) {
        identityBuckets.push(key);
        return { success: true };
      },
    },
    AUTH_LOGIN_CLIENT_RATE_LIMITER: {
      /** @param {{ key: string }} input */
      limit({ key }) {
        clientBuckets.push(key);
        return { success: true };
      },
    },
  };
  /** @param {string} ip */
  const attempt = (ip) => handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password: "wrong-password" }),
  }), env);

  assert.equal((await attempt("203.0.113.10")).status, 401);
  assert.equal((await attempt("203.0.113.11")).status, 401);
  assert.equal(identityBuckets.length, 2);
  assert.equal(clientBuckets.length, 2);
  assert.equal(identityBuckets[0], identityBuckets[1]);
  assert.notEqual(clientBuckets[0], clientBuckets[1]);
});

test("browser auth: login requires the configured origin and application/json", async () => {
  const { handler, store } = appFixture();
  const env = authEnv(store);
  const body = JSON.stringify({ email: "athlete-a@example.invalid", password: "a-correct-password" });
  /** @param {Record<string, string>} headers */
  const login = async (headers) => jsonResponse(await handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers,
    body,
  }), env));

  const crossOrigin = await login({ Origin: "https://attacker.example", "Content-Type": "application/json" });
  const missingOrigin = await login({ "Content-Type": "application/json" });
  const wrongType = await login({ Origin: "https://workout.example", "Content-Type": "text/plain" });
  const accepted = await login({ Origin: "https://workout.example", "Content-Type": "application/json" });

  assert.equal(crossOrigin.response.status, 403);
  assert.equal(crossOrigin.body.error.code, "origin_not_allowed");
  assert.deepEqual(missingOrigin.body, crossOrigin.body);
  assert.equal(wrongType.response.status, 415);
  assert.equal(wrongType.body.error.code, "json_content_type_required");
  assert.equal(accepted.response.status, 200);
  assert.deepEqual(accepted.body, { authenticated: true });
});

test("browser auth: successful credentials neither consume nor reset failed-login budgets", async () => {
  const { handler, store } = appFixture();
  const env = {
    ...authEnv(store),
    AUTH_LOGIN_LIMIT: 2,
    AUTH_LOGIN_CLIENT_LIMIT: 20,
    AUTH_LOGIN_WINDOW_SECONDS: 60,
    SECURITY_EVENT_SINK() {},
  };
  const attempt = (password) => handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.12" },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password }),
  }), env);

  assert.equal((await attempt("wrong-one")).status, 401);
  assert.equal((await attempt("a-correct-password")).status, 200);
  assert.equal((await attempt("wrong-two")).status, 401);
  assert.equal((await attempt("wrong-three")).status, 429);
  assert.equal((await attempt("a-correct-password")).status, 200);
  assert.equal((await attempt("wrong-four")).status, 429);
});

test("browser auth: self-host fallback enforces the documented fixed-window policy", async () => {
  const { handler, store } = appFixture();
  const env = { ...authEnv(store), AUTH_LOGIN_LIMIT: 2, AUTH_LOGIN_WINDOW_SECONDS: 60, SECURITY_EVENT_SINK() {} };
  const attempt = () => handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password: "wrong-password" }),
  }), env);

  assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 401);
  const limited = await attempt();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
});

test("browser auth: rotating candidate identities cannot bypass the client budget", async () => {
  const { handler, store } = appFixture();
  const env = { ...authEnv(store), AUTH_LOGIN_CLIENT_LIMIT: 2, AUTH_LOGIN_WINDOW_SECONDS: 60, SECURITY_EVENT_SINK() {} };
  /** @param {string} email */
  const attempt = (email) => handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  }), env);

  assert.equal((await attempt("unknown-1@example.invalid")).status, 401);
  assert.equal((await attempt("unknown-2@example.invalid")).status, 401);
  assert.equal((await attempt("unknown-3@example.invalid")).status, 429);
});

test("browser auth: fallback fails closed at its high-cardinality bucket cap", async () => {
  const { handler, store } = appFixture();
  const env = {
    ...authEnv(store),
    AUTH_LOGIN_LIMIT: 100,
    AUTH_LOGIN_CLIENT_LIMIT: 1000,
    AUTH_LOGIN_WINDOW_SECONDS: 60,
    SECURITY_EVENT_SINK() {},
  };
  const attempt = (index) => handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json", "CF-Connecting-IP": `203.0.${Math.floor(index / 256)}.${index % 256}` },
    body: JSON.stringify({ email: `unknown-${index}@example.invalid`, password: "wrong-password" }),
  }), env);

  for (let index = 0; index < 512; index += 1) assert.equal((await attempt(index)).status, 401);
  assert.equal((await attempt(512)).status, 429);
});

test("security observability: rejection, conflict, and archive validation events contain no identity or payload", async () => {
  const { handler, store } = appFixture();
  /** @type {Record<string, any>[]} */
  const events = [];
  const env = { ...authEnv(store), LOCAL_AUTH: "true", AGENT_TOKEN_SECRET: "test-only-agent-token-secret", SECURITY_EVENT_SINK: (/** @type {Record<string, any>} */ event) => events.push(event) };

  await handler.fetch(new Request("https://workout.example/api/auth/login", {
    method: "POST",
    headers: { Origin: "https://workout.example", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "athlete-a@example.invalid", password: "do-not-log-this" }),
  }), env);
  const mutationHeaders = { "x-athlete-email": "athlete-a@example.invalid", "Content-Type": "application/json", "Idempotency-Key": "observable-conflict" };
  await handler.fetch(new Request(`https://workout.example/api/private/scheduled-workouts/${today}/start`, { method: "POST", headers: mutationHeaders, body: "{}" }), env);
  await handler.fetch(new Request(`https://workout.example/api/private/scheduled-workouts/${today}/start`, { method: "POST", headers: mutationHeaders, body: "{\"different\":true}" }), env);
  await handler.fetch(new Request("https://workout.example/api/private/records/aerobic/sync", {
    method: "POST",
    headers: { ...mutationHeaders, "Idempotency-Key": "observable-archive-invalid" },
    body: JSON.stringify({ projection: { athlete_email: "should-not-appear" } }),
  }), env);

  assert.deepEqual(events.map((event) => event.event), ["authentication_rejected", "mutation_conflict", "archive_validation_rejected"]);
  assert.ok(events.every((event) => event.schema_version === 1 && typeof event.occurred_at === "string"));
  const serialized = JSON.stringify(events);
  for (const forbidden of ["athlete-a@example.invalid", "should-not-appear", "do-not-log-this", "Authorization", "Cookie", "token", "password", "metrics", "gps", "fit"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("security observability: invalid Agent Bearer rejection emits only a safe reason", async () => {
  const { handler, store } = appFixture();
  /** @type {Record<string, any>[]} */
  const events = [];
  const secretToken = "agent-secret-that-must-not-be-logged";
  const env = { ...authEnv(store), AGENT_TOKEN_SECRET: "test-only-agent-token-secret", SECURITY_EVENT_SINK: (/** @type {Record<string, any>} */ event) => events.push(event) };

  const response = await handler.fetch(new Request("https://workout.example/api/agent/v1", { headers: { Authorization: `Bearer ${secretToken}` } }), env);

  assert.equal(response.status, 401);
  assert.deepEqual(events.map(({ event, surface, reason }) => ({ event, surface, reason })), [
    { event: "authentication_rejected", surface: "agent_bearer", reason: "invalid_bearer" },
  ]);
  assert.equal(JSON.stringify(events).includes(secretToken), false);
});

test("security observability: stale Agent plan emits a privacy-safe conflict", async () => {
  const { handler, store } = appFixture();
  /** @type {Record<string, any>[]} */
  const events = [];
  const env = { ...authEnv(store), LOCAL_AUTH: "true", AGENT_TOKEN_SECRET: "test-only-agent-token-secret", SECURITY_EVENT_SINK: (/** @type {Record<string, any>} */ event) => events.push(event) };
  const token = await createAgentToken(handler);
  const packageValue = JSON.parse(packageText(addDays(today, 1), workout("private-title")));
  const agentPost = async (path, body, idempotencyKey = null) => {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await handler.fetch(new Request(`https://workout.example${path}`, { method: "POST", headers, body: JSON.stringify(body) }), env);
    return { response, body: await response.json() };
  };
  const preview = await agentPost("/api/agent/v1/plan-updates/validate", { package_text: JSON.stringify(packageValue) });
  assert.equal(preview.response.status, 200);
  const changed = await store.getByEmail("athlete-a@example.invalid");
  appendPlanRevision(changed, packageValue);
  await store.save(changed);

  const stale = await agentPost("/api/agent/v1/plan-updates/apply", {
    package_text: JSON.stringify(packageValue),
    package_digest: preview.body.package_digest,
    base_plan_digest: preview.body.base_plan_digest,
    confirmed: true,
  }, "observable-stale-plan");

  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error.code, "stale_plan");
  assert.deepEqual(events.map(({ event, surface, reason }) => ({ event, surface, reason })), [
    { event: "mutation_conflict", surface: "agent", reason: "stale_plan" },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private-title|athlete-a|example\.invalid|Bearer|token|password/i);
});
