import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { normalizePublicOrigin } from "./prepare-production-config.mjs";

const RELEASE_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const VITE_MODULE_PATH_PATTERN = /^\/assets\/index-[A-Za-z0-9_-]{8,}\.js$/;
const VITE_GENERATED_SOURCE_EXAMPLE = 'src="\/assets\/index-<hash>.js"';
const JAVASCRIPT_MEDIA_TYPES = new Set(["application/javascript", "text/javascript"]);
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

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireAcceptance(condition, message) {
  if (!condition) throw new Error(`Operator acceptance failed: ${message}`);
}

/** @param {string} value */
function trimAsciiWhitespace(value) {
  return value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
}

/** @param {unknown} rawOrigin */
function productionOrigin(rawOrigin) {
  if (rawOrigin instanceof URL && (rawOrigin.username !== ""
    || rawOrigin.password !== ""
    || rawOrigin.pathname !== "/"
    || rawOrigin.search !== ""
    || rawOrigin.hash !== "")) {
    throw new Error("Operator acceptance failed: WORKOUT_PUBLIC_ORIGIN must be a canonical HTTPS origin");
  }
  const value = rawOrigin instanceof URL ? rawOrigin.origin : rawOrigin;
  try {
    return new URL(normalizePublicOrigin(value).origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKOUT_PUBLIC_ORIGIN must be a canonical HTTPS origin";
    throw new Error(`Operator acceptance failed: ${message}`);
  }
}

/** @param {unknown} value */
function expectedRevision(value) {
  requireAcceptance(typeof value === "string" && RELEASE_REVISION_PATTERN.test(value), "EXPECTED_GITHUB_SHA must be a lowercase 40-character hexadecimal revision");
  return value;
}

/** @param {Response} response */
function mediaType(response) {
  const raw = response.headers.get("content-type");
  if (!raw) return "";
  const segments = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      return "";
    } else if (character === ";") {
      segments.push(trimAsciiWhitespace(raw.slice(start, index)));
      start = index + 1;
    }
  }
  if (quoted || escaped) return "";
  segments.push(trimAsciiWhitespace(raw.slice(start)));
  const [rawValue, ...parameters] = segments;
  const value = rawValue.toLowerCase();
  const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
  const parameterPattern = new RegExp(`^${token}[\\t ]*=[\\t ]*(?:${token}|\"(?:[^\"\\\\\\r\\n]|\\\\.)*\")$`);
  if (!new RegExp(`^${token}\/${token}$`).test(value)
    || parameters.some((parameter) => !parameterPattern.test(parameter))) return "";
  return value;
}

/** @param {Response} response @param {string} label @param {string} headerName */
function cacheDirectives(response, label, headerName) {
  const header = response.headers.get(headerName) ?? "";
  const directives = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      directives.push(trimAsciiWhitespace(header.slice(start, index)).toLowerCase());
      start = index + 1;
    }
  }
  requireAcceptance(!quoted && !escaped, `${label} ${headerName} must be syntactically valid`);
  directives.push(trimAsciiWhitespace(header.slice(start)).toLowerCase());
  requireAcceptance(directives.every(Boolean), `${label} ${headerName} must be syntactically valid`);
  return directives;
}

/** @param {Response} response @param {string} label */
function requireNoStore(response, label) {
  const conflicting = new Set(["public", "immutable", "max-age", "s-maxage", "stale-if-error", "stale-while-revalidate"]);
  const cacheControl = cacheDirectives(response, label, "Cache-Control");
  requireAcceptance(cacheControl.filter((directive) => directive === "no-store").length === 1, `${label} Cache-Control must contain exactly one no-store directive`);
  const cacheDirectiveNames = cacheControl.map((directive) => trimAsciiWhitespace(directive.split("=", 1)[0]));
  requireAcceptance(!cacheDirectiveNames.some((name) => conflicting.has(name)), `${label} Cache-Control must not conflict with no-store`);

  const cdnCacheControl = cacheDirectives(response, label, "CDN-Cache-Control");
  requireAcceptance(cdnCacheControl.length === 1 && cdnCacheControl[0] === "no-store", `${label} CDN-Cache-Control must be exactly no-store`);
}

/** @param {string} csp @param {string} name @param {string} expectedSource */
function requireCspDirective(csp, name, expectedSource) {
  const matching = csp
    .split(";")
    .map(trimAsciiWhitespace)
    .filter(Boolean)
    .map((directive) => directive.toLowerCase().split(/[\t\n\f\r ]+/))
    .filter(([directiveName]) => directiveName === name);
  requireAcceptance(matching.length === 1 && matching[0].length === 2 && matching[0][1] === expectedSource, `application HTML CSP must set ${name} ${expectedSource}`);
}

/** @param {Response} response */
function requireApplicationSecurity(response) {
  requireNoStore(response, "application HTML");
  const csp = response.headers.get("content-security-policy") ?? "";
  requireCspDirective(csp, "default-src", "'self'");
  requireCspDirective(csp, "script-src", "'self'");
  requireCspDirective(csp, "script-src-attr", "'none'");
  requireCspDirective(csp, "style-src", "'self'");
  requireCspDirective(csp, "style-src-attr", "'none'");
  requireCspDirective(csp, "object-src", "'none'");
  requireCspDirective(csp, "frame-ancestors", "'none'");
  requireCspDirective(csp, "base-uri", "'none'");
  requireCspDirective(csp, "form-action", "'self'");
  const cspDirectives = csp
    .split(";")
    .map(trimAsciiWhitespace)
    .filter(Boolean)
    .map((directive) => directive.toLowerCase().replace(/[\t\n\f\r ]+/g, " "))
    .sort();
  const expectedCspDirectives = [
    "base-uri 'none'",
    "default-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-attr 'none'",
  ].sort();
  requireAcceptance(cspDirectives.join("\n") === expectedCspDirectives.join("\n"), "application HTML CSP must match the exact Worker policy");
  requireAcceptance((response.headers.get("x-content-type-options") ?? "").toLowerCase() === "nosniff", "application HTML must set X-Content-Type-Options nosniff");
  requireAcceptance((response.headers.get("referrer-policy") ?? "").toLowerCase() === "no-referrer", "application HTML must set Referrer-Policy no-referrer");
  const permissions = (response.headers.get("permissions-policy") ?? "")
    .split(",")
    .map((directive) => directive.replace(/[\t\n\f\r ]+/g, "").toLowerCase());
  for (const feature of ["camera", "microphone", "geolocation"]) {
    const matching = permissions.filter((directive) => directive.startsWith(`${feature}=`));
    requireAcceptance(matching.length === 1 && matching[0] === `${feature}=()`, `application HTML Permissions-Policy must disable ${feature}`);
  }
}

/** @param {string} body @param {string} label */
function parseJson(body, label) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Operator acceptance failed: ${label} must contain valid JSON`);
  }
}

/** @param {string} html @param {URL} origin */
function applicationModuleUrl(html, origin) {
  const window = new Window({
    url: origin.href,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  try {
    try {
      window.document.write(html);
      window.document.close();
    } catch {
      throw new Error("Operator acceptance failed: gated application artifact must be parseable HTML");
    }
    requireAcceptance(window.document.querySelectorAll("#app").length === 1, "gated application artifact must contain exactly one Vue app mount");
    requireAcceptance(window.document.querySelectorAll("style, [style]").length === 0, "gated application artifact must not require inline styles");
    const elements = [...window.document.querySelectorAll("*")];
    const hasInlineHandler = elements.some((element) => [...element.attributes].some((attribute) => attribute.name.toLowerCase().startsWith("on")));
    requireAcceptance(!hasInlineHandler, "gated application artifact must not require inline event handlers");
    const scripts = [...window.document.querySelectorAll("script")]
      .filter((script) => !script.closest("template, noscript, math, svg"));
    requireAcceptance(scripts.length === 1, "gated application artifact must contain exactly one active script");
    const [moduleScript] = scripts;
    requireAcceptance((moduleScript.getAttribute("type") ?? "").toLowerCase() === "module", "gated application artifact script must be a module");
    requireAcceptance((moduleScript.textContent ?? "").trim() === "", "gated application artifact module must not contain inline code");
    const source = moduleScript.getAttribute("src");
    requireAcceptance(typeof source === "string" && VITE_MODULE_PATH_PATTERN.test(source), `application module must use ${VITE_GENERATED_SOURCE_EXAMPLE}`);
    const moduleUrl = new URL(source, window.document.baseURI);
    requireAcceptance(moduleUrl.origin === origin.origin, "application module must be same-origin");
    requireAcceptance(moduleUrl.search === "" && moduleUrl.hash === "", "application module URL must not contain a query or fragment");
    for (const link of window.document.querySelectorAll("link")) {
      const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/[\t\n\f\r ]+/).filter(Boolean);
      if (!rel.includes("stylesheet")) continue;
      const href = link.getAttribute("href");
      requireAcceptance(typeof href === "string" && new URL(href, window.document.baseURI).origin === origin.origin, "gated application stylesheets must be same-origin");
    }
    return moduleUrl;
  } finally {
    window.close();
  }
}

/** @param {unknown} catalog */
function requireSchemaCatalog(catalog) {
  requireAcceptance(isRecord(catalog), "schema catalog must be a JSON object");
  requireAcceptance(catalog.schema_version === 1, "schema catalog schema_version must be 1");
  requireAcceptance(Array.isArray(catalog.schemas), "schema catalog schemas must be an array");
  const names = new Set();
  for (const schema of catalog.schemas) {
    requireAcceptance(isRecord(schema) && typeof schema.name === "string" && schema.name.length > 0, "schema catalog items must have a name");
    requireAcceptance(!names.has(schema.name), "schema catalog names must be unique");
    names.add(schema.name);
    requireAcceptance(schema.href === `/api/coach/v1/schemas/${schema.name}`, "schema catalog hrefs must identify their same-origin schema resource");
    requireAcceptance(schema.json_schema_draft === "2020-12", "schema catalog items must declare JSON Schema Draft 2020-12");
  }
  for (const name of REQUIRED_SCHEMA_NAMES) {
    requireAcceptance(names.has(name), `schema catalog is missing required schema ${name}`);
  }
}

/**
 * Verify the deployed public boundary without credentials.
 * @param {{
 *   origin: string | URL,
 *   expectedGithubSha: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 *   expectedApplicationHtml?: string,
 * }} options
 */
export async function runOperatorAcceptance({ origin: rawOrigin, expectedGithubSha: rawExpectedRevision, fetchImpl = globalThis.fetch, now = () => new Date(), expectedApplicationHtml }) {
  const origin = productionOrigin(rawOrigin);
  const revision = expectedRevision(rawExpectedRevision);
  requireAcceptance(typeof fetchImpl === "function", "a fetch implementation is required");
  let gatedApplicationHtml = expectedApplicationHtml;
  if (typeof gatedApplicationHtml !== "string") {
    try {
      gatedApplicationHtml = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
    } catch {
      throw new Error("Operator acceptance failed: gated dist/index.html could not be read");
    }
  }
  requireAcceptance(gatedApplicationHtml.length > 0, "gated dist/index.html must not be empty");
  const moduleUrl = applicationModuleUrl(gatedApplicationHtml, origin);

  /** @param {string | URL} input @param {number} expectedStatus @param {string} label */
  const read = async (input, expectedStatus, label) => {
    const url = input instanceof URL ? input : new URL(input, origin);
    requireAcceptance(url.origin === origin.origin, `${label} request must remain same-origin`);
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
    } catch {
      throw new Error(`Operator acceptance failed: ${label} request failed`);
    }
    requireAcceptance(response.status === expectedStatus, `${label} returned an unexpected status`);
    try {
      return { response, body: await response.text() };
    } catch {
      throw new Error(`Operator acceptance failed: ${label} response body could not be read`);
    }
  };

  const health = await read("/healthz", 200, "health");
  requireNoStore(health.response, "health");
  requireAcceptance(mediaType(health.response) === "application/json", "health content-type must be application/json");
  const healthBody = parseJson(health.body, "health");
  requireAcceptance(isRecord(healthBody), "health must be a JSON object");
  requireAcceptance(Object.keys(healthBody).sort().join(",") === "ok,revision,service", "health must expose only ok, service, and revision");
  requireAcceptance(healthBody.ok === true && healthBody.service === "workout-tracker", "health must identify a ready workout-tracker service");
  requireAcceptance(healthBody.revision === revision, "health revision does not match EXPECTED_GITHUB_SHA");
  const expectedHealthBody = JSON.stringify({ ok: true, service: "workout-tracker", revision });
  requireAcceptance(health.body === expectedHealthBody, "health must match the exact ready response");

  const application = await read("/", 200, "application HTML");
  requireAcceptance(mediaType(application.response) === "text/html", "application HTML content-type must be text/html");
  requireApplicationSecurity(application.response);
  requireAcceptance(application.body === gatedApplicationHtml, "application HTML must exactly match the gated dist/index.html artifact");
  const applicationModule = await read(moduleUrl, 200, "application module");
  requireAcceptance(JAVASCRIPT_MEDIA_TYPES.has(mediaType(applicationModule.response)), "application module must use a JavaScript media type");
  const moduleSource = applicationModule.body.trim();
  requireAcceptance(moduleSource.length > 0, "application module must not be empty");
  requireAcceptance(!moduleSource.startsWith("<"), "application module must not contain an HTML fallback");
  requireAcceptance(!/(?:<!doctype[\t\n\f\r ]+html\b|<html(?=[\t\n\f\r />]))/i.test(moduleSource), "application module must not contain an HTML document fallback");

  const applicationBoundary = await read("/app", 302, "unauthenticated application boundary");
  requireAcceptance(mediaType(applicationBoundary.response) === "text/plain", "unauthenticated application boundary content-type must be text/plain");
  requireNoStore(applicationBoundary.response, "unauthenticated application boundary");
  requireAcceptance(applicationBoundary.response.headers.get("location") === "/", "unauthenticated application boundary Location must be /");

  const schema = await read("/api/coach/v1/schemas", 200, "schema catalog");
  requireNoStore(schema.response, "schema catalog");
  requireAcceptance(mediaType(schema.response) === "application/json", "schema catalog content-type must be application/json");
  const schemaBody = parseJson(schema.body, "schema catalog");
  requireSchemaCatalog(schemaBody);
  requireAcceptance(schema.body === JSON.stringify(schemaBody), "schema catalog must match its canonical JSON representation");

  const privateBoundary = await read("/api/private/me", 401, "private boundary");
  requireNoStore(privateBoundary.response, "private boundary");
  requireAcceptance(mediaType(privateBoundary.response) === "application/json", "private boundary content-type must be application/json");
  const privateBody = parseJson(privateBoundary.body, "private boundary");
  requireAcceptance(isRecord(privateBody) && isRecord(privateBody.error), "private boundary must return the API error envelope");
  requireAcceptance(Object.keys(privateBody).join(",") === "error", "private boundary must not return extra top-level fields");
  requireAcceptance(Object.keys(privateBody.error).sort().join(",") === "code,details,message", "private boundary must return the exact API error fields");
  requireAcceptance(privateBody.error.code === "unauthorized", "private boundary error code must be unauthorized");
  requireAcceptance(privateBody.error.message === "A valid application session is required", "private boundary error message must match the unauthorized contract");
  requireAcceptance(Array.isArray(privateBody.error.details) && privateBody.error.details.length === 0, "private boundary error details must be an empty array");
  const expectedPrivateBody = JSON.stringify({ error: { code: "unauthorized", message: "A valid application session is required", details: [] } });
  requireAcceptance(privateBoundary.body === expectedPrivateBody, "private boundary must match the exact unauthorized response");

  const checkedAt = now();
  requireAcceptance(checkedAt instanceof Date && !Number.isNaN(checkedAt.getTime()), "acceptance clock must return a valid Date");
  return {
    schema_version: 1,
    checked_at: checkedAt.toISOString(),
    revision,
    checks: {
      healthz: 200,
      vue_application_shell: 200,
      vue_application_module: 200,
      unauthenticated_application_entry: 302,
      coach_schema_catalog: 200,
      unauthenticated_private_api: 401,
    },
  };
}

/** @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, now?: () => Date }} [options] */
export async function runCli(options = {}) {
  const env = options.env ?? process.env;
  const result = await runOperatorAcceptance({
    origin: env.WORKOUT_PUBLIC_ORIGIN ?? "",
    expectedGithubSha: env.EXPECTED_GITHUB_SHA ?? "",
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    now: options.now,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    const [modulePath, invokedPath] = await Promise.all([
      realpath(fileURLToPath(import.meta.url)),
      realpath(resolve(process.argv[1])),
    ]);
    return modulePath === invokedPath;
  } catch {
    return false;
  }
}

if (await isDirectInvocation()) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Operator acceptance failed");
    process.exitCode = 1;
  }
}
