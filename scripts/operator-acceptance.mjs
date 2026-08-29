import { strict as assert } from "node:assert";

const rawOrigin = process.env.WORKOUT_PUBLIC_ORIGIN;
assert.ok(rawOrigin, "Set WORKOUT_PUBLIC_ORIGIN to the deployed HTTPS origin");
const origin = new URL(rawOrigin);
assert.equal(origin.protocol, "https:", "WORKOUT_PUBLIC_ORIGIN must use HTTPS");
assert.equal(origin.pathname, "/", "WORKOUT_PUBLIC_ORIGIN must not contain a path");
assert.equal(origin.search, "", "WORKOUT_PUBLIC_ORIGIN must not contain a query");
assert.equal(origin.hash, "", "WORKOUT_PUBLIC_ORIGIN must not contain a fragment");

/** @param {string} path @param {number} expectedStatus */
async function read(path, expectedStatus) {
  const response = await fetch(new URL(path, origin), { redirect: "manual" });
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}, expected ${expectedStatus}`);
  return { response, body: await response.text() };
}

const health = await read("/healthz", 200);
assert.deepEqual(JSON.parse(health.body), { ok: true, service: "workout-tracker" });

const schema = await read("/api/coach/v1/schemas", 200);
assert.match(schema.response.headers.get("content-type") ?? "", /application\/json/);
assert.match(schema.response.headers.get("cache-control") ?? "", /no-store/);

const privateBoundary = await read("/api/private/me", 401);
assert.match(privateBoundary.response.headers.get("cache-control") ?? "", /no-store/);

console.log(JSON.stringify({
  schema_version: 1,
  checked_at: new Date().toISOString(),
  origin: origin.origin,
  checks: { healthz: 200, coach_schema_catalog: 200, unauthenticated_private_api: 401 },
}, null, 2));
