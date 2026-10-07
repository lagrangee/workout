import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/http.js";
import { MemoryStore, emptyAthlete } from "../src/store.js";

test("private response timing includes awaited store work without exposing Athlete or request content", async () => {
  const athlete = emptyAthlete({ email: "timing@example.invalid", displayName: "Synthetic timing", timezone: "Asia/Shanghai" });
  const store = new MemoryStore([athlete]);
  const read = store.getByEmail.bind(store);
  store.getByEmail = async (email) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return read(email);
  };
  const env = { STORE: store, LOCAL_AUTH: "true" };
  const response = await createHandler(env).fetch(new Request("https://workout.example/api/private/me", { headers: { "x-athlete-email": athlete.email } }), env);
  assert.equal(response.status, 200);
  const timing = response.headers.get("Server-Timing");
  assert.match(timing, /^workout;dur=\d+(\.\d+)?$/);
  assert.ok(Number(timing.split("=")[1]) >= 10, "timing must include the awaited store read");
  assert.equal((await response.json()).display_name, athlete.display_name);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});
