// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { createAerobicProjectionPublisher } from "../src/training-archive-cloud-publisher.js";

function projection() {
  return {
    schema_version: 1,
    publication_key: "training-archive:2026-08-15",
    source_ref: "training-archive:2026-08-15",
    target_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    workout_source_status: "none",
    source_data_as_of: { workout: null, coros: "2026-08-17T11:00:56.975Z" },
    data_as_of: "2026-08-17T11:00:56.975Z",
    activities: [],
    routes: [],
  };
}

test("cloud publisher sends one safe projection through the application sync boundary", async () => {
  const requests = [];
  const publisher = createAerobicProjectionPublisher({
    origin: "https://workout.example",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({
        schema_version: 1,
        publication_key: projection().publication_key,
        target_date: projection().target_date,
        status: "none",
        published_count: 0,
        activity_count: 0,
        route_count: 0,
        source_statuses: projection().source_statuses,
        data_as_of: projection().data_as_of,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await publisher(projection(), {
    idempotency_key: "training-archive:2026-08-15:request-key",
    attempt: 1,
    max_attempts: 3,
  });

  assert.equal(result.status, "none");
  assert.equal(result.published_count, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://workout.example/api/private/records/aerobic/sync");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.credentials, "include");
  assert.equal(requests[0].init.headers["Idempotency-Key"], "training-archive:2026-08-15:request-key");
  assert.deepEqual(JSON.parse(requests[0].init.body), { projection: projection() });
  assert.doesNotMatch(JSON.stringify(requests[0]), /raw_fit|gps|Bearer|agent.token|\/Users\//i);
});

test("cloud publisher turns an application boundary error into a retryable structured error", async () => {
  const publisher = createAerobicProjectionPublisher({
    origin: "https://workout.example",
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "A valid application session is required" } }), { status: 401 }),
  });

  await assert.rejects(
    () => publisher(projection(), { idempotency_key: "training-archive:2026-08-15:request-key" }),
    (error) => error.code === "unauthorized" && error.retryable === false && /application session/i.test(error.message),
  );
});

test("cloud publisher rejects a response for a different projection", async () => {
  const publisher = createAerobicProjectionPublisher({
    origin: "https://workout.example",
    fetchImpl: async () => new Response(JSON.stringify({
      schema_version: 1,
      publication_key: "training-archive:other-date",
      target_date: "2026-08-14",
      status: "complete",
      published_count: 0,
    }), { status: 200 }),
  });

  await assert.rejects(
    () => publisher(projection(), { idempotency_key: "training-archive:2026-08-15:request-key" }),
    (error) => error.code === "invalid_sync_response" && error.retryable === false,
  );
});
