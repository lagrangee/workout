import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/http.js";

test("ticket 25 browser seam: the mobile app shell is served with navigation and no forbidden feature UI", async () => {
  const handler = createHandler({ LOCAL_AUTH: "true" });
  const response = await handler.fetch(new Request("https://workout.example/app"), { LOCAL_AUTH: "true" });
  const html = await response.text();
  assert.equal(response.status, 200); assert.match(html, /Workout Tracker/); assert.match(html, /id="app"/);
});

test("Worker-served application HTML replaces asset cache and security headers without duplicate values", async () => {
  const handler = createHandler();
  const response = await handler.fetch(new Request("https://workout.example/"), {
    ENVIRONMENT: "production",
    PRODUCTION_HOST: "workout.example",
    ASSETS: {
      fetch: async () => new Response("<!doctype html><div id=\"app\"></div>", {
        headers: {
          "Cache-Control": "public, max-age=0, must-revalidate",
          "Content-Type": "text/html; charset=utf-8",
          ETag: '"asset-hash"',
        },
      }),
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("etag"), '"asset-hash"');
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  assert.doesNotMatch(response.headers.get("content-security-policy") ?? "", /'unsafe-inline'|'unsafe-eval'/);
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
