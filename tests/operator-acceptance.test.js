import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../src/http.js";
import { runOperatorAcceptance } from "../scripts/operator-acceptance.mjs";

const EXPECTED_SHA = "0123456789abcdef0123456789abcdef01234567";
const OLD_SHA = `${EXPECTED_SHA.slice(0, -1)}8`;
const REQUIRED_SCHEMA_NAMES = [
  "manifest",
  "overview",
  "weekly_template",
  "plan",
  "schedule",
  "session_index",
  "session_detail",
  "progress",
  "exercise_detail",
  "error",
  "schema_catalog",
];
const APPLICATION_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="theme-color" content="#f6f1e8" /><meta name="apple-mobile-web-app-capable" content="yes" /><meta name="apple-mobile-web-app-status-bar-style" content="default" /><link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" /><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" /><link rel="manifest" href="/manifest.webmanifest" /><link rel="stylesheet" href="/styles.css?v=plan-batch-20260820" /><link rel="stylesheet" href="/navigation.css?v=today-rest-20260801" /><title>Workout Tracker</title><script type="module" crossorigin src="/assets/index-AbC_123-.js"></script></head><body><div id="app"></div></body></html>';
const ACCEPTANCE_DEFAULTS = {
  origin: "https://workout.example",
  expectedGithubSha: EXPECTED_SHA,
  expectedApplicationHtml: APPLICATION_HTML,
};
const APPLICATION_SECURITY_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** @param {string} [body] @param {Record<string, string>} [headers] */
function applicationResponse(body = APPLICATION_HTML, headers = {}) {
  return new Response(body, { status: 200, headers: { ...APPLICATION_SECURITY_HEADERS, ...headers } });
}

/** @param {unknown} body @param {{ status?: number, contentType?: string, cacheControl?: string, cdnCacheControl?: string }} [options] */
function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: {
      "Content-Type": options.contentType ?? "application/json; charset=utf-8",
      "Cache-Control": options.cacheControl ?? "private, no-store",
      "CDN-Cache-Control": options.cdnCacheControl ?? "no-store",
    },
  });
}

function schemaCatalog() {
  return {
    schema_version: 1,
    generated_at: "2026-08-29T00:00:00.000Z",
    schemas: REQUIRED_SCHEMA_NAMES.map((name) => ({
      name,
      href: `/api/coach/v1/schemas/${name}`,
      json_schema_draft: "2020-12",
    })),
  };
}

/**
 * @param {{
 *   health?: Response,
 *   application?: Response,
 *   module?: Response,
 *   applicationBoundary?: Response,
 *   schema?: Response,
 *   privateBoundary?: Response,
 * }} [overrides]
 */
function acceptanceFixture(overrides = {}) {
  /** @type {{ url: URL, init: RequestInit }[]} */
  const calls = [];
  const responses = {
    health: jsonResponse({ ok: true, service: "workout-tracker", revision: EXPECTED_SHA }),
    application: applicationResponse(),
    module: new Response("const migrated = true;\n", {
      status: 200,
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" },
    }),
    applicationBoundary: new Response(null, {
      status: 302,
      headers: { Location: "/", "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" },
    }),
    schema: jsonResponse(schemaCatalog()),
    privateBoundary: jsonResponse({ error: { code: "unauthorized", message: "A valid application session is required", details: [] } }, { status: 401 }),
    ...overrides,
  };

  const fetchImpl = async (/** @type {string | URL | Request} */ input, /** @type {RequestInit} */ init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, init });
    if (url.pathname === "/healthz") return responses.health.clone();
    if (url.pathname === "/") return responses.application.clone();
    if (url.pathname === "/assets/index-AbC_123-.js") return responses.module.clone();
    if (url.pathname === "/app") return responses.applicationBoundary.clone();
    if (url.pathname === "/api/coach/v1/schemas") return responses.schema.clone();
    if (url.pathname === "/api/private/me") return responses.privateBoundary.clone();
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  };

  return { calls, fetchImpl };
}

test("production health exposes only a verified lowercase release revision", async () => {
  const handler = createHandler();
  const request = new Request("https://workout.example/healthz");

  for (const releaseRevision of [undefined, "A".repeat(40), "a".repeat(39), "a".repeat(41), "not-a-revision", 123]) {
    const response = await handler.fetch(request.clone(), {
      ENVIRONMENT: "production",
      PRODUCTION_HOST: "workout.example",
      RELEASE_REVISION: releaseRevision,
    });
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(body), { ok: false, service: "workout-tracker" });
    assert.equal(body.includes(String(releaseRevision)), false);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  }

  const response = await handler.fetch(request, {
    ENVIRONMENT: "production",
    PRODUCTION_HOST: "workout.example",
    RELEASE_REVISION: EXPECTED_SHA,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "workout-tracker", revision: EXPECTED_SHA });
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
});

test("development health remains compatible without release metadata", async () => {
  const handler = createHandler();
  for (const env of [{}, { RELEASE_REVISION: EXPECTED_SHA }]) {
    const response = await handler.fetch(new Request("https://workout.example/healthz"), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "workout-tracker" });
  }
});

test("operator acceptance proves the exact revision and fetches the built module without caches or redirects", async () => {
  const { calls, fetchImpl } = acceptanceFixture();
  const result = await runOperatorAcceptance({
    ...ACCEPTANCE_DEFAULTS,
    fetchImpl,
    now: () => new Date("2026-08-29T00:01:02.000Z"),
  });

  assert.equal(result.revision, EXPECTED_SHA);
  assert.equal(result.checked_at, "2026-08-29T00:01:02.000Z");
  assert.equal("origin" in result, false);
  assert.deepEqual(calls.map(({ url }) => url.pathname), [
    "/healthz",
    "/",
    "/assets/index-AbC_123-.js",
    "/app",
    "/api/coach/v1/schemas",
    "/api/private/me",
  ]);
  for (const { init } of calls) {
    const headers = new Headers(init.headers);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(headers.get("cache-control"), "no-cache");
    assert.equal(headers.get("pragma"), "no-cache");
  }
});

test("operator acceptance rejects an old deployed revision", async () => {
  const { fetchImpl } = acceptanceFixture({
    health: jsonResponse({ ok: true, service: "workout-tracker", revision: OLD_SHA }),
  });
  await assert.rejects(
    runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl }),
    /health revision does not match EXPECTED_GITHUB_SHA/,
  );

  const duplicateMembers = acceptanceFixture({
    health: new Response(`{"ok":false,"ok":true,"service":"unexpected","service":"workout-tracker","revision":"unexpected","revision":"${EXPECTED_SHA}"}`, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" },
    }),
  });
  await assert.rejects(
    runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: duplicateMembers.fetchImpl }),
    /health must match the exact ready response/,
  );
});

test("operator acceptance rejects an assets-first /app or a non-canonical redirect", async () => {
  const assetsFirst = acceptanceFixture({
    applicationBoundary: new Response('<div id="app"></div>', {
      status: 200,
      headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=0, must-revalidate" },
    }),
  });
  await assert.rejects(
    runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: assetsFirst.fetchImpl }),
    /unauthenticated application boundary returned an unexpected status/,
  );

  const externalRedirect = acceptanceFixture({
    applicationBoundary: new Response(null, {
      status: 302,
      headers: { Location: "https://other.example/", "Content-Type": "text/plain", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" },
    }),
  });
  await assert.rejects(
    runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: externalRedirect.fetchImpl }),
    /unauthenticated application boundary Location must be \/$/,
  );
});

test("operator acceptance rejects missing, empty, or HTML-substituted module assets", async () => {
  const cases = [
    {
      response: new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } }),
      error: /application module returned an unexpected status/,
    },
    {
      response: new Response("", { status: 200, headers: { "Content-Type": "application/javascript" } }),
      error: /application module must not be empty/,
    },
    {
      response: new Response("<!doctype html><title>fallback</title>", { status: 200, headers: { "Content-Type": "text/javascript" } }),
      error: /application module must not contain an HTML fallback/,
    },
    {
      response: new Response("  <div>fallback</div>", { status: 200, headers: { "Content-Type": "application/javascript" } }),
      error: /application module must not contain an HTML fallback/,
    },
    {
      response: new Response("Proxy fallback follows:\n<!doctype html><html><title>fallback</title></html>", { status: 200, headers: { "Content-Type": "application/javascript" } }),
      error: /application module must not contain an HTML document fallback/,
    },
  ];
  for (const { response, error } of cases) {
    const { fetchImpl } = acceptanceFixture({ module: response });
    await assert.rejects(
      runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl }),
      error,
    );
  }
});

test("operator acceptance rejects every broken schema catalog dimension", async () => {
  const cases = [
    {
      mutate: (catalog) => { catalog.schema_version = 2; },
      error: /schema catalog schema_version must be 1/,
    },
    {
      mutate: (catalog) => { catalog.schemas = catalog.schemas.filter(({ name }) => name !== "session_detail"); },
      error: /schema catalog is missing required schema session_detail/,
    },
    {
      mutate: (catalog) => { catalog.schemas[0].href = "https://other.example/api/coach/v1/schemas/manifest"; },
      error: /schema catalog hrefs must identify their same-origin schema resource/,
    },
    {
      mutate: (catalog) => { catalog.schemas[0].json_schema_draft = "2019-09"; },
      error: /schema catalog items must declare JSON Schema Draft 2020-12/,
    },
  ];
  for (const { mutate, error } of cases) {
    const broken = schemaCatalog();
    mutate(broken);
    const { fetchImpl } = acceptanceFixture({ schema: jsonResponse(broken) });
    await assert.rejects(
      runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl }),
      error,
    );
  }

  const duplicateMemberCatalog = JSON.stringify(schemaCatalog())
    .replace('"schema_version":1', '"schema_version":2,"schema_version":1')
    .replace('"href":"/api/coach/v1/schemas/manifest"', '"href":"https://other.example/unexpected","href":"/api/coach/v1/schemas/manifest"');
  const duplicateMembers = acceptanceFixture({
    schema: new Response(duplicateMemberCatalog, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" },
    }),
  });
  await assert.rejects(
    runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: duplicateMembers.fetchImpl }),
    /schema catalog must match its canonical JSON representation/,
  );
});

test("operator acceptance requires the exact non-sensitive unauthorized envelope", async () => {
  const cases = [
    {
      body: { error: { code: "authentication_failed", message: "A valid application session is required", details: [] } },
      error: /private boundary error code must be unauthorized/,
    },
    {
      body: { error: { code: "unauthorized", message: "Authentication required", details: [] } },
      error: /private boundary error message must match the unauthorized contract/,
    },
    {
      body: { error: { code: "unauthorized", message: "A valid application session is required", details: {} } },
      error: /private boundary error details must be an empty array/,
    },
    {
      body: { error: { code: "unauthorized", message: "A valid application session is required", details: ["token=must-not-leak"] } },
      error: /private boundary error details must be an empty array/,
    },
    {
      body: { error: { code: "unauthorized", message: "A valid application session is required", details: [], debug: "must-not-leak" } },
      error: /private boundary must return the exact API error fields/,
    },
    {
      body: { error: { code: "unauthorized", message: "A valid application session is required", details: [] }, request_id: "private-id" },
      error: /private boundary must not return extra top-level fields/,
    },
    {
      body: { error: "Unauthorized" },
      error: /private boundary must return the API error envelope/,
    },
  ];
  for (const { body, error } of cases) {
    const fixture = acceptanceFixture({ privateBoundary: jsonResponse(body, { status: 401 }) });
    await assert.rejects(
      runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: fixture.fetchImpl }),
      error,
    );
  }

  const duplicateMembers = acceptanceFixture({
    privateBoundary: new Response('{"error":{"code":"unexpected","code":"unauthorized","message":"unexpected","message":"A valid application session is required","details":["unexpected"],"details":[]}}', {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" },
    }),
  });
  await assert.rejects(
    runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: duplicateMembers.fetchImpl }),
    /private boundary must match the exact unauthorized response/,
  );
});

test("operator acceptance rejects a non-lowercase or non-40-character expected revision before any request", async () => {
  for (const invalidRevision of ["A".repeat(40), "a".repeat(39), "a".repeat(41), `g${"a".repeat(39)}`, 123]) {
    let requested = false;
    await assert.rejects(
      runOperatorAcceptance({
        ...ACCEPTANCE_DEFAULTS,
        expectedGithubSha: invalidRevision,
        fetchImpl: async () => { requested = true; throw new Error("must not request"); },
      }),
      /EXPECTED_GITHUB_SHA must be a lowercase 40-character hexadecimal revision/,
    );
    assert.equal(requested, false);
  }
});

test("operator acceptance reuses the canonical production-origin rules before any request", async () => {
  for (const invalidOrigin of [
    "https://workout.example/",
    "https://workout.example:8443",
    "https://127.0.0.1",
    "https://localhost",
    "https://Workout.example",
    "https://workout..example",
    new URL("https://workout.example/unexpected"),
  ]) {
    let requested = false;
    await assert.rejects(
      runOperatorAcceptance({
        ...ACCEPTANCE_DEFAULTS,
        origin: invalidOrigin,
        fetchImpl: async () => { requested = true; throw new Error("must not request"); },
      }),
      /WORKOUT_PUBLIC_ORIGIN must be a canonical HTTPS origin/,
    );
    assert.equal(requested, false);
  }
});

test("operator acceptance does not leak the private origin through network errors or success output", async () => {
  const privateOrigin = "https://private-workout-host.example";
  await assert.rejects(
    runOperatorAcceptance({
      ...ACCEPTANCE_DEFAULTS,
      origin: privateOrigin,
      fetchImpl: async () => { throw new Error(`connection failed for ${privateOrigin}`); },
    }),
    (error) => error instanceof Error
      && error.message === "Operator acceptance failed: health request failed"
      && !error.message.includes(privateOrigin),
  );
});

test("operator acceptance CLI exits nonzero with a sanitized one-line failure", () => {
  const privateOrigin = "https://private-workout-host.example";
  const invalidRevision = "private-invalid-revision";
  const scriptPath = fileURLToPath(new URL("../scripts/operator-acceptance.mjs", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "workout-operator-cli-"));
  const symlinkPath = join(temporaryDirectory, "operator-acceptance-link.mjs");
  symlinkSync(scriptPath, symlinkPath, "file");
  try {
    for (const invocationPath of [scriptPath, symlinkPath]) {
      const child = spawnSync(process.execPath, [invocationPath], {
        encoding: "utf8",
        env: {
          ...process.env,
          WORKOUT_PUBLIC_ORIGIN: privateOrigin,
          EXPECTED_GITHUB_SHA: invalidRevision,
        },
      });

      assert.equal(child.status, 1);
      assert.equal(child.signal, null);
      assert.equal(child.stdout, "");
      assert.equal(child.stderr.trim(), "Operator acceptance failed: EXPECTED_GITHUB_SHA must be a lowercase 40-character hexadecimal revision");
      assert.equal(child.stderr.includes(privateOrigin), false);
      assert.equal(child.stderr.includes(invalidRevision), false);
      assert.equal(child.stderr.includes("    at "), false);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("operator acceptance requires exact cache and media-type semantics", async () => {
  const unauthorized = { error: { code: "unauthorized", message: "A valid application session is required", details: [] } };
  const mediaCases = [
    {
      override: { health: jsonResponse({ ok: true, service: "workout-tracker", revision: EXPECTED_SHA }, { contentType: "application/problem+json" }) },
      error: /health content-type must be application\/json/,
    },
    {
      override: { application: applicationResponse(APPLICATION_HTML, { "Content-Type": "application/xhtml+xml" }) },
      error: /application HTML content-type must be text\/html/,
    },
    {
      override: { module: new Response("const migrated = true;", { status: 200, headers: { "Content-Type": "text/plain" } }) },
      error: /application module must use a JavaScript media type/,
    },
    {
      override: { applicationBoundary: new Response(null, { status: 302, headers: { Location: "/", "Content-Type": "application/json", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" } }) },
      error: /unauthenticated application boundary content-type must be text\/plain/,
    },
    {
      override: { schema: jsonResponse(schemaCatalog(), { contentType: "text/plain" }) },
      error: /schema catalog content-type must be application\/json/,
    },
    {
      override: { privateBoundary: jsonResponse(unauthorized, { status: 401, contentType: "application/problem+json" }) },
      error: /private boundary content-type must be application\/json/,
    },
    {
      override: { health: jsonResponse({ ok: true, service: "workout-tracker", revision: EXPECTED_SHA }, { contentType: "application/json; charset=utf-8, text/html" }) },
      error: /health content-type must be application\/json/,
    },
    {
      override: { health: jsonResponse({ ok: true, service: "workout-tracker", revision: EXPECTED_SHA }, { contentType: "application/json; charset=utf-8; text/html" }) },
      error: /health content-type must be application\/json/,
    },
    {
      override: { application: applicationResponse(APPLICATION_HTML, { "Content-Type": "text/html; charset=utf-8, application/json" }) },
      error: /application HTML content-type must be text\/html/,
    },
    {
      override: { module: new Response("const migrated = true;", { status: 200, headers: { "Content-Type": "text/javascript; charset=utf-8, text/html" } }) },
      error: /application module must use a JavaScript media type/,
    },
    {
      override: { applicationBoundary: new Response(null, { status: 302, headers: { Location: "/", "Content-Type": "text/plain; charset=utf-8, text/html", "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" } }) },
      error: /unauthenticated application boundary content-type must be text\/plain/,
    },
    {
      override: { schema: jsonResponse(schemaCatalog(), { contentType: "application/json; charset=utf-8, text/html" }) },
      error: /schema catalog content-type must be application\/json/,
    },
    {
      override: { privateBoundary: jsonResponse(unauthorized, { status: 401, contentType: "application/json; charset=utf-8, text/html" }) },
      error: /private boundary content-type must be application\/json/,
    },
  ];
  for (const { override, error } of mediaCases) {
    const fixture = acceptanceFixture(override);
    await assert.rejects(
      runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: fixture.fetchImpl }),
      error,
    );
  }

  const cacheCases = [
    {
      label: "health",
      override: (cacheControl) => ({ health: jsonResponse({ ok: true, service: "workout-tracker", revision: EXPECTED_SHA }, { cacheControl }) }),
    },
    {
      label: "application HTML",
      override: (cacheControl) => ({ application: applicationResponse(APPLICATION_HTML, { "Cache-Control": cacheControl }) }),
    },
    {
      label: "unauthenticated application boundary",
      override: (cacheControl) => ({ applicationBoundary: new Response(null, { status: 302, headers: { Location: "/", "Content-Type": "text/plain", "Cache-Control": cacheControl, "CDN-Cache-Control": "no-store" } }) }),
    },
    {
      label: "schema catalog",
      override: (cacheControl) => ({ schema: jsonResponse(schemaCatalog(), { cacheControl }) }),
    },
    {
      label: "private boundary",
      override: (cacheControl) => ({ privateBoundary: jsonResponse(unauthorized, { status: 401, cacheControl }) }),
    },
  ];
  for (const { label, override } of cacheCases) {
    for (const [cacheControl, suffix] of [
      ["private, no-store-if-error", "must contain exactly one no-store directive"],
      ['sentinel="x, no-store, y"', "must contain exactly one no-store directive"],
      ["private, no-store, public", "must not conflict with no-store"],
      ["private, no-store, max-age=0", "must not conflict with no-store"],
      ['private, no-store, sentinel="unterminated, public', "must be syntactically valid"],
    ]) {
      const fixture = acceptanceFixture(override(cacheControl));
      await assert.rejects(
        runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: fixture.fetchImpl }),
        new RegExp(`${label} Cache-Control ${suffix}`),
      );
    }
  }

  const cdnCacheCases = [
    {
      label: "health",
      override: (cdnCacheControl) => ({ health: jsonResponse({ ok: true, service: "workout-tracker", revision: EXPECTED_SHA }, { cdnCacheControl }) }),
    },
    {
      label: "application HTML",
      override: (cdnCacheControl) => ({ application: applicationResponse(APPLICATION_HTML, { "CDN-Cache-Control": cdnCacheControl }) }),
    },
    {
      label: "unauthenticated application boundary",
      override: (cdnCacheControl) => ({ applicationBoundary: new Response(null, { status: 302, headers: { Location: "/", "Content-Type": "text/plain", "Cache-Control": "private, no-store", "CDN-Cache-Control": cdnCacheControl } }) }),
    },
    {
      label: "schema catalog",
      override: (cdnCacheControl) => ({ schema: jsonResponse(schemaCatalog(), { cdnCacheControl }) }),
    },
    {
      label: "private boundary",
      override: (cdnCacheControl) => ({ privateBoundary: jsonResponse(unauthorized, { status: 401, cdnCacheControl }) }),
    },
  ];
  for (const { label, override } of cdnCacheCases) {
    for (const [cdnCacheControl, suffix] of [
      ["public, max-age=31536000", "must be exactly no-store"],
      ["no-store, public", "must be exactly no-store"],
      ['no-store, sentinel="unterminated, public', "must be syntactically valid"],
    ]) {
      const fixture = acceptanceFixture(override(cdnCacheControl));
      await assert.rejects(
        runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: fixture.fetchImpl }),
        new RegExp(`${label} CDN-Cache-Control ${suffix}`),
      );
    }
  }
});

test("operator acceptance requires the Worker-owned application security headers", async () => {
  const canonicalCsp = APPLICATION_SECURITY_HEADERS["Content-Security-Policy"];
  const cases = [
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("default-src 'self'", "default-src *") },
      error: /application HTML CSP must set default-src 'self'/,
    },
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("frame-ancestors 'none'", "frame-ancestors 'self'") },
      error: /application HTML CSP must set frame-ancestors 'none'/,
    },
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("; base-uri 'none'", "") },
      error: /application HTML CSP must set base-uri 'none'/,
    },
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("script-src 'self'", "script-src * 'unsafe-inline'") },
      error: /application HTML CSP must set script-src 'self'/,
    },
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("script-src-attr 'none'", "script-src-attr 'unsafe-inline'") },
      error: /application HTML CSP must set script-src-attr 'none'/,
    },
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") },
      error: /application HTML CSP must set style-src 'self'/,
    },
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("style-src-attr 'none'", "style-src-attr 'unsafe-inline'") },
      error: /application HTML CSP must set style-src-attr 'none'/,
    },
    {
      headers: { "Content-Security-Policy": canonicalCsp.replace("object-src 'none'", "object-src 'self'") },
      error: /application HTML CSP must set object-src 'none'/,
    },
    {
      headers: { "Content-Security-Policy": `${canonicalCsp}; worker-src *` },
      error: /application HTML CSP must match the exact Worker policy/,
    },
    {
      headers: { "X-Content-Type-Options": "off" },
      error: /application HTML must set X-Content-Type-Options nosniff/,
    },
    {
      headers: { "Referrer-Policy": "origin" },
      error: /application HTML must set Referrer-Policy no-referrer/,
    },
    {
      headers: { "Permissions-Policy": "camera=(self), microphone=(), geolocation=()" },
      error: /application HTML Permissions-Policy must disable camera/,
    },
    {
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
      error: /application HTML Cache-Control must contain exactly one no-store directive/,
    },
  ];
  for (const { headers, error } of cases) {
    const fixture = acceptanceFixture({ application: applicationResponse(APPLICATION_HTML, headers) });
    await assert.rejects(
      runOperatorAcceptance({ ...ACCEPTANCE_DEFAULTS, fetchImpl: fixture.fetchImpl }),
      error,
    );
  }
});

test("operator acceptance identifies the one active Vite module by parsed HTML semantics", async () => {
  const moduleTag = '<script type="module" crossorigin src="/assets/index-AbC_123-.js"></script>';
  const invalidCases = [
    {
      shell: APPLICATION_HTML.replace('<div id="app"></div>', '<div data-decoy=\'<div id="app"></div>\'></div>'),
      error: /gated application artifact must contain exactly one Vue app mount/,
    },
    {
      shell: APPLICATION_HTML.replace(moduleTag, `<template>${moduleTag}</template>`),
      error: /gated application artifact must contain exactly one active script/,
    },
    {
      shell: APPLICATION_HTML.replace(moduleTag, `<noscript>${moduleTag}</noscript>`),
      error: /gated application artifact must contain exactly one active script/,
    },
    {
      shell: APPLICATION_HTML.replace(moduleTag, `<math>${moduleTag}</math>`),
      error: /gated application artifact must contain exactly one active script/,
    },
    {
      shell: APPLICATION_HTML.replace("<title>", '<base href="https://other.example/"><title>'),
      error: /application module must be same-origin/,
    },
    {
      shell: APPLICATION_HTML.replace(moduleTag, `<SCRIPT type=module src=https://other.example/payload.js></SCRIPT>${moduleTag}`),
      error: /gated application artifact must contain exactly one active script/,
    },
    {
      shell: APPLICATION_HTML.replace(moduleTag, `${moduleTag}<script type=module src=https://other.example/payload.js></script>`),
      error: /gated application artifact must contain exactly one active script/,
    },
    {
      shell: APPLICATION_HTML.replace(moduleTag, '<script type="module" src="/assets/main.js"></script>'),
      error: /application module must use src="\/assets\/index-<hash>.js"/,
    },
    {
      shell: APPLICATION_HTML.replace('<div id="app"></div>', '<div id="app" style="display:block"></div>'),
      error: /gated application artifact must not require inline styles/,
    },
    {
      shell: APPLICATION_HTML.replace("<title>", "<style>body { display: block; }</style><title>"),
      error: /gated application artifact must not require inline styles/,
    },
    {
      shell: APPLICATION_HTML.replace("<body>", '<body onload="start()">'),
      error: /gated application artifact must not require inline event handlers/,
    },
    {
      shell: APPLICATION_HTML.replace("<title>", '<link rel="stylesheet" href="https://other.example/app.css"><title>'),
      error: /gated application stylesheets must be same-origin/,
    },
    {
      shell: APPLICATION_HTML.replace(moduleTag, '<script type="module" src="/assets/index-AbC_123-.js">start()</script>'),
      error: /gated application artifact module must not contain inline code/,
    },
  ];

  for (const { shell, error } of invalidCases) {
    const fixture = acceptanceFixture({ application: applicationResponse(shell) });
    await assert.rejects(
      runOperatorAcceptance({
        ...ACCEPTANCE_DEFAULTS,
        expectedApplicationHtml: shell,
        fetchImpl: fixture.fetchImpl,
      }),
      error,
    );
    assert.equal(fixture.calls.length, 0, "the local gated artifact must fail before any production request");
  }

  const inertDecoys = [
    '<!-- <script type="module" src="/assets/index-comment.js"></script> -->',
    '<div data-decoy=\'<script type="module" src="/assets/index-attribute.js"></script>\'></div>',
    '<template><script type="module" src="/assets/index-template.js"></script></template>',
    '<noscript><script type="module" src="/assets/index-noscript.js"></script></noscript>',
  ].join("");
  const validShells = [
    APPLICATION_HTML
      .replace("<html", "\n<html")
      .replace("<head>", "<head>\n  ")
      .replace("</title><script", "</title>\n  <script")
      .replace("</script></head><body>", "</script>\n</head>\n<body>\n  ")
      .replace("</div></body></html>", "</div>\n</body>\n</html>\n"),
    APPLICATION_HTML.replace(moduleTag, "<SCRIPT SRC='/assets/index-AbC_123-.js' CROSSORIGIN TYPE='MODULE'></SCRIPT>"),
    APPLICATION_HTML.replace(moduleTag, `${inertDecoys}${moduleTag}`),
  ];
  for (const shell of validShells) {
    const fixture = acceptanceFixture({ application: applicationResponse(shell) });
    await assert.doesNotReject(
      runOperatorAcceptance({
        ...ACCEPTANCE_DEFAULTS,
        expectedApplicationHtml: shell,
        fetchImpl: fixture.fetchImpl,
      }),
    );
  }
});
