import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/http.js";

const validRevision = "0123456789abcdef0123456789abcdef01234567";

test("health fails closed for an unknown environment without exposing deployment metadata", async () => {
  const response = await createHandler().fetch(new Request("https://workout.example/healthz"), {
    ENVIRONMENT: "staging",
    RELEASE_REVISION: validRevision,
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, service: "workout-tracker" });
});

test("health preserves the legacy response only for omitted and exact development environments", async () => {
  for (const env of [
    { RELEASE_REVISION: validRevision },
    { ENVIRONMENT: undefined },
    { ENVIRONMENT: undefined, RELEASE_REVISION: "not-a-revision" },
    { ENVIRONMENT: undefined, RELEASE_REVISION: validRevision },
    { ENVIRONMENT: "development" },
    { ENVIRONMENT: "development", RELEASE_REVISION: "not-a-revision" },
    { ENVIRONMENT: "development", RELEASE_REVISION: validRevision },
  ]) {
    const response = await createHandler().fetch(new Request("https://workout.example/healthz"), env);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "workout-tracker" });
  }
});

test("health rejects environment typos, whitespace, case variants, and non-string values without reflection", async () => {
  const invalidEnvironments = [
    "",
    "staging",
    "Development",
    "DEVELOPMENT",
    " development",
    "development ",
    "development\t",
    "development\n",
    "Production",
    "PRODUCTION",
    " production",
    "production ",
    "\tproduction",
    "production\n",
    new String("development"),
    new String("production"),
    { toString: () => "development" },
    { toString: () => "production" },
    null,
    false,
    0,
  ];

  for (const environment of invalidEnvironments) {
    const response = await createHandler().fetch(new Request("https://workout.example/healthz"), {
      ENVIRONMENT: environment,
      RELEASE_REVISION: validRevision,
    });

    assert.equal(response.status, 503);
    assert.equal(await response.text(), '{"ok":false,"service":"workout-tracker"}');
  }
});

test("production health accepts and exposes an exact lowercase 40-hex revision", async () => {
  const response = await createHandler().fetch(new Request("https://workout.example/healthz"), {
    ENVIRONMENT: "production",
    RELEASE_REVISION: validRevision,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "workout-tracker",
    revision: validRevision,
  });
});

test("production health rejects every non-exact revision without reflecting it", async () => {
  const invalidRevisions = [
    undefined,
    null,
    123,
    "",
    "a".repeat(39),
    "a".repeat(41),
    validRevision.toUpperCase(),
    ` ${validRevision}`,
    `${validRevision} `,
    "g".repeat(40),
    new String(validRevision),
    { toString: () => validRevision },
  ];

  for (const revision of invalidRevisions) {
    const response = await createHandler().fetch(new Request("https://workout.example/healthz"), {
      ENVIRONMENT: "production",
      RELEASE_REVISION: revision,
    });

    assert.equal(response.status, 503);
    assert.equal(await response.text(), '{"ok":false,"service":"workout-tracker"}');
  }
});
