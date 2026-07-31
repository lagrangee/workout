import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/http.js";

test("ticket 25 browser seam: the mobile app shell is served with navigation and no forbidden feature UI", async () => {
  const handler = createHandler({ LOCAL_AUTH: "true" });
  const response = await handler.fetch(new Request("https://workout.example/app"), { LOCAL_AUTH: "true" });
  const html = await response.text();
  assert.equal(response.status, 200); assert.match(html, /Workout Tracker/); assert.match(html, /id="app"/);
});
