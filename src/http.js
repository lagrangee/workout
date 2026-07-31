// @ts-nocheck

import { createStore } from "./store.js";
import { deepClone, isRecord, normalizeEmail, localDate, isValidTimezone, sha256Hex, trimString } from "./util.js";
import { planModel, scheduleModel, todayModel, sessionSummary, validatePlanForState, appendPlanRevision } from "./plan.js";
import { createSession, replaceRecord, endSession, continueOrRestart, findSession, sessionDetail } from "./session.js";
import { progressModel, exerciseDetail } from "./metrics.js";
import { athleteExport } from "./export.js";
import { authenticatedCoachUrl, coachManifest, coachReadme, coachResource, createCoachShare, findShare, schemaResource } from "./coach.js";
import { validateSettings } from "./validation.js";

const PRIVATE_PREFIX = "/api/private";

export function createHandler(initialEnv = {}) {
  let storePromise;
  const getStore = () => (storePromise ??= createStore(initialEnv, initialEnv.DB));
  return { fetch: (request, env = initialEnv, ctx) => route(request, env, getStore, ctx) };
}

/** @param {Request} request @param {Record<string, any>} env @param {() => Promise<any>} getStore @param {any} ctx */
async function route(request, env, getStore, ctx) {
  const url = new URL(request.url);
  if (env.ENVIRONMENT === "production" && env.PRODUCTION_HOST && url.hostname !== env.PRODUCTION_HOST) return textResponse("Not found", 404);
  if (url.pathname === "/healthz") return jsonResponse({ ok: true, service: "workout-tracker" });
  if (url.pathname === "/api/coach/v1/schemas" && request.method === "GET") return jsonResponse({ schema_version: 1, generated_at: new Date().toISOString(), schemas: ["manifest", "overview", "weekly_template", "plan", "schedule", "session_index", "session_detail", "progress", "exercise_detail", "error"].map((name) => ({ name, href: `/api/coach/v1/schemas/${name}`, json_schema_draft: "2020-12" })) });
  if (url.pathname.startsWith("/api/coach/v1/schemas/") && request.method === "GET") {
    const schema = schemaResource(url.pathname.split("/").at(-1));
    return schema ? new Response(JSON.stringify(schema, null, 2), { status: 200, headers: securityHeaders("application/schema+json") }) : jsonError("not_found", "Schema not found", [], 404);
  }
  if (url.pathname.startsWith("/coach/") || url.pathname.startsWith("/api/coach/v1/")) return coachRoute(request, env, getStore, url);
  if (url.pathname === "/" || url.pathname === "/app" || url.pathname.startsWith("/assets/")) return staticRoute(request, env);
  if (url.pathname.startsWith(PRIVATE_PREFIX)) return privateRoute(request, env, getStore, url);
  return textResponse("Not found", 404);
}

async function staticRoute(request, env) {
  if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
  const path = new URL(request.url).pathname;
  if (path.endsWith(".css")) return new Response("", { headers: securityHeaders("text/css; charset=utf-8") });
  if (path.endsWith(".js")) return new Response("", { headers: securityHeaders("text/javascript; charset=utf-8") });
  return new Response(FALLBACK_HTML, { headers: securityHeaders("text/html; charset=utf-8") });
}

async function coachRoute(request, env, getStore, url) {
  const match = url.pathname.match(/^\/api\/coach\/v1\/([^/]+)(.*)$/);
  const readmeMatch = url.pathname.match(/^\/coach\/([^/]+)$/);
  const token = match?.[1] ?? readmeMatch?.[1];
  if (!token || request.method !== "GET") return publicNotFound();
  const store = await getStore();
  const state = await findShare(await store.all(), token, env);
  if (!state) return publicNotFound();
  const now = new Date();
  if (readmeMatch) return new Response(coachReadme(state, now), { status: 200, headers: securityHeaders("text/markdown; charset=utf-8") });
  const suffix = match[2] || "";
  const manifest = suffix === "" ? coachManifest(state, now) : coachResource(state, suffix, url, now);
  if (suffix === "" && !manifest.error) manifest.links = { overview: `${url.origin}/api/coach/v1/${token}/overview`, plan: `${url.origin}/api/coach/v1/${token}/plan`, schedule: `${url.origin}/api/coach/v1/${token}/schedule`, sessions: `${url.origin}/api/coach/v1/${token}/sessions`, progress: `${url.origin}/api/coach/v1/${token}/progress`, exercise: `${url.origin}/api/coach/v1/${token}/exercises/{exercise_key}`, schemas: `${url.origin}/api/coach/v1/schemas` };
  if (manifest?.error) return jsonError(manifest.error.code, manifest.error.message, manifest.error.details ?? [], errorStatus(manifest.error.code));
  return jsonResponse(manifest);
}

async function privateRoute(request, env, getStore, url) {
  const auth = await authenticate(request, env);
  if (auth.error) return jsonError(auth.error.code, auth.error.message, [], auth.error.status);
  const store = await getStore();
  const state = await store.getByEmail(auth.email);
  if (!state) return jsonError("forbidden", "Identity is not configured", [], 403);
  state.idempotency_records ??= [];
  const now = new Date();
  const path = url.pathname;
  if (request.method === "GET") return privateGet(state, path, url, now, env);
  if (request.method === "PUT" || request.method === "POST" || request.method === "DELETE") return privateMutation(request, env, store, state, path, url, now);
  return jsonError("method_not_allowed", "Method not allowed", [], 405);
}

async function privateGet(state, path, url, now, env) {
  if (path === "/api/private/me") return jsonResponse({ athlete_key: state.athlete_key, display_name: state.display_name, timezone: state.timezone });
  if (path === "/api/private/today") return jsonResponse(todayModel(state, now));
  if (path === "/api/private/plan") return jsonResponse(planModel(state, now));
  if (path === "/api/private/schedule") { const entries = scheduleModel(state, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, now); return jsonResponse({ timezone: state.timezone, from: entries[0]?.date ?? null, to: entries.at(-1)?.date ?? null, entries }); }
  if (path === "/api/private/sessions") return listPrivateSessions(state, url);
  if (path.startsWith("/api/private/sessions/")) { const session = findSession(state, path.split("/").at(-1)); return session ? jsonResponse(sessionDetail(session)) : jsonError("not_found", "Session not found", [], 404); }
  if (path === "/api/private/progress") { const result = progressModel(state, now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path.startsWith("/api/private/exercises/")) { const result = exerciseDetail(state, decodeURIComponent(path.split("/api/private/exercises/")[1]), now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path === "/api/private/coach-share") { const share = state.coach_share && !state.coach_share.revoked_at ? await authenticatedCoachUrl(state, env) : null; return jsonResponse(share ? { active: true, share_key: share.share_key, url: share.url } : { active: false, share_key: null, url: null }); }
  if (path === "/api/private/export") return exportResponse(state, now);
  return jsonError("not_found", "Resource not found", [], 404);
}

async function privateMutation(request, env, store, originalState, path, url, now) {
  const rawBody = await request.text();
  const state = originalState;
  const mutation = async () => {
    if (request.method === "PUT" && path === "/api/private/settings") return updateSettings(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/plan-updates/validate") return validatePlanUpdate(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/plan-updates/apply") return applyPlanUpdate(state, rawBody, now);
    if (request.method === "POST" && path.match(/^\/api\/private\/scheduled-workouts\/\d{4}-\d{2}-\d{2}\/(start|skip)$/)) return startOrSkip(state, path, rawBody, now);
    if (request.method === "POST" && path.match(/^\/api\/private\/sessions\/[^/]+\/(end|continue|restart)$/)) return sessionCommand(state, path, rawBody, now);
    if (request.method === "PUT" && path.match(/^\/api\/private\/sessions\/[^/]+\/record$/)) return correctRecord(state, path, rawBody, now);
    if (request.method === "POST" && path === "/api/private/coach-share") return shareCommand(state, env, now, false);
    if (request.method === "POST" && path === "/api/private/coach-share/regenerate") return shareCommand(state, env, now, true);
    if (request.method === "DELETE" && path === "/api/private/coach-share") { if (state.coach_share) { state.coach_share.revoked_at = now.toISOString(); state.training_version += 1; } return { body: { active: false, revoked: true }, status: 200, persist: true }; }
    return { body: { error: { code: "not_found", message: "Resource not found", details: [] } }, status: 404, persist: false };
  };
  const requiresKey = request.method === "POST" && path !== "/api/private/plan-updates/validate";
  if (!requiresKey) {
    const result = await mutation(); if (result.persist !== false) await store.save(state); return responseFromResult(result);
  }
  const key = request.headers.get("Idempotency-Key");
  if (!key || key.length > 200) return jsonError("idempotency_key_required", "Idempotency-Key is required", [], 400);
  const digest = await sha256Hex(rawBody);
  const existing = state.idempotency_records.find((record) => record.key === key && record.method === request.method && record.path === path && Date.parse(record.created_at) > now.getTime() - 24 * 60 * 60 * 1000);
  if (existing) {
    if (existing.body_digest !== digest) return jsonError("idempotency_conflict", "The key was already used with a different request body", [], 409);
    return new Response(existing.body, { status: existing.status, headers: securityHeaders("application/json; charset=utf-8") });
  }
  const result = await mutation();
  if (result.persist !== false) await store.save(state);
  const response = responseFromResult(result);
  state.idempotency_records = state.idempotency_records.filter((record) => Date.parse(record.created_at) > now.getTime() - 24 * 60 * 60 * 1000);
  state.idempotency_records.push({ key, method: request.method, path, body_digest: digest, created_at: now.toISOString(), status: response.status, body: await response.clone().text() });
  await store.save(state);
  return response;
}

function updateSettings(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  const errors = validateSettings(body.value); if (errors.length) return { body: errorBody("invalid_settings", "Settings are invalid", errors), status: 400, persist: false };
  const oldDate = localDate(now, state.timezone); const newDate = localDate(now, body.value.timezone);
  const oldRevision = state.plan_revisions.filter((revision) => revision.effective_from <= oldDate).sort((a, b) => b.revision_sequence - a.revision_sequence)[0]?.revision_key ?? null;
  const newRevision = state.plan_revisions.filter((revision) => revision.effective_from <= newDate).sort((a, b) => b.revision_sequence - a.revision_sequence)[0]?.revision_key ?? null;
  if (oldRevision !== newRevision) return { body: errorBody("timezone_revision_boundary", "This timezone change would select a different effective plan revision now", []), status: 409, persist: false };
  state.display_name = trimString(body.value.display_name); state.timezone = body.value.timezone; state.updated_at = now.toISOString();
  return { body: { display_name: state.display_name, timezone: state.timezone }, status: 200, persist: true };
}

function validatePlanUpdate(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 1 || typeof body.value.package_text !== "string") return { body: errorBody("invalid_request", "package_text is required", []), status: 400, persist: false };
  const result = validatePlanForState(state, body.value.package_text, now); if (!result.ok) return { body: errorBody("invalid_plan_package", "The plan package needs repair", result.errors), status: 400, persist: false };
  return { body: { valid: true, preview: result.preview }, status: 200, persist: false };
}

function applyPlanUpdate(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 1 || typeof body.value.package_text !== "string") return { body: errorBody("invalid_request", "package_text is required", []), status: 400, persist: false };
  const result = validatePlanForState(state, body.value.package_text, now); if (!result.ok) return { body: errorBody("invalid_plan_package", "The plan package needs repair", result.errors), status: 400, persist: false };
  const revision = appendPlanRevision(state, result.value, now);
  return { body: { revision: { effective_from: revision.effective_from }, preview: result.preview }, status: 201, persist: true };
}

function startOrSkip(state, path, rawBody, now) {
  const parts = path.split("/"); const date = parts.at(-2); const kind = parts.at(-1); const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || (kind === "start" && Object.keys(body.value).length) || (kind === "skip" && (!Object.prototype.hasOwnProperty.call(body.value, "skip_reason") || Object.keys(body.value).some((key) => key !== "skip_reason") || (body.value.skip_reason !== null && typeof body.value.skip_reason !== "string")))) return { body: errorBody("invalid_request", "Command body is invalid", []), status: 400, persist: false };
  const reason = kind === "skip" ? trimString(body.value.skip_reason ?? null) : null;
  if (reason !== null && (reason.length < 1 || reason.length > 500)) return { body: errorBody("invalid_request", "skip_reason must contain 1-500 characters", []), status: 400, persist: false };
  const result = createSession(state, date, now, kind, reason); if (result.error) return { body: errorBody(result.error.code, result.error.message, []), status: errorStatus(result.error.code), persist: false };
  return { body: sessionDetail(result.session), status: result.replay ? 200 : 201, persist: !result.replay };
}

function sessionCommand(state, path, rawBody, now) {
  const sessionKey = path.split("/").at(-2); const command = path.split("/").at(-1); const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 0 && command !== "end") return { body: errorBody("invalid_request", `${command} accepts an empty object`, []), status: 400, persist: false };
  const result = command === "end" ? endSession(state, sessionKey, body.value, now) : continueOrRestart(state, sessionKey, now, command);
  if (result.error) return { body: errorBody(result.error.code, result.error.message, result.error.details ?? []), status: errorStatus(result.error.code), persist: false };
  return { body: sessionDetail(result.session), status: 200, persist: true };
}

function correctRecord(state, path, rawBody, now) {
  const session = findSession(state, path.split("/").at(-2)); if (!session) return { body: errorBody("not_found", "Session not found", []), status: 404, persist: false };
  const body = parseJsonBody(rawBody); if (body.error) return body;
  const result = replaceRecord(state, session, body.value, now); if (result.error) return { body: errorBody(result.error.code, result.error.message, result.error.details ?? []), status: errorStatus(result.error.code), persist: false };
  return { body: sessionDetail(result.session), status: 200, persist: true };
}

async function shareCommand(state, env, now, regenerate) { return { body: await createCoachShare(state, env, now, regenerate), status: regenerate ? 201 : 201, persist: true }; }

function listPrivateSessions(state, url) {
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const status = url.searchParams.get("status"); const exerciseKey = url.searchParams.get("exercise_key");
  const sessions = state.sessions.filter((session) => (!from || session.scheduled_date >= from) && (!to || session.scheduled_date <= to) && (!status || session.status === status) && (!exerciseKey || session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_key === exerciseKey)))).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || b.session_key.localeCompare(a.session_key));
  return jsonResponse({ items: sessions.map(sessionSummary), page: { next_cursor: null } });
}

function exportResponse(state, now) {
  const result = athleteExport(state, now); if (result.error) return jsonError(result.error.code, result.error.message, [], result.status); const date = localDate(now, state.timezone); return new Response(JSON.stringify(result.value, null, 2), { status: 200, headers: { ...securityHeaders("application/json; charset=utf-8"), "Content-Disposition": `attachment; filename="workout-data-${date}.json"` } });
}

async function authenticate(request, env) {
  const testEmail = request.headers.get("x-athlete-email") ?? request.headers.get("x-test-athlete-email");
  if (testEmail && env.ENVIRONMENT !== "production" && env.LOCAL_AUTH !== "false") return { email: normalizeEmail(testEmail) };
  const token = request.headers.get("CF-Access-Jwt-Assertion");
  if (!token) return { error: { code: "unauthorized", message: "A valid Access assertion is required", status: 401 } };
  const claims = await verifyAccessJwt(token, env);
  if (!claims) return { error: { code: "unauthorized", message: "A valid Access assertion is required", status: 401 } };
  const email = claims.email ?? claims.sub; if (typeof email !== "string" || !email.includes("@")) return { error: { code: "unauthorized", message: "A valid Access identity is required", status: 401 } };
  return { email: normalizeEmail(email) };
}

async function verifyAccessJwt(token, env) {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split("."); if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
    const header = JSON.parse(new TextDecoder().decode(decodePart(encodedHeader))); const claims = JSON.parse(new TextDecoder().decode(decodePart(encodedPayload))); const now = Math.floor(Date.now() / 1000);
    const issuer = env.ACCESS_ISSUER; const audience = env.ACCESS_AUDIENCE;
    if (issuer && claims.iss !== issuer) return null;
    if (audience && !(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience)) return null;
    if (typeof claims.exp !== "number" || claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now + 60)) return null;
    const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`); const signature = decodePart(encodedSignature);
    if (env.ACCESS_JWT_SECRET) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ACCESS_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      return await crypto.subtle.verify("HMAC", key, signature, data) ? claims : null;
    }
    if (!env.ACCESS_JWKS) return env.ENVIRONMENT === "production" ? null : claims;
    const jwks = typeof env.ACCESS_JWKS === "string" ? JSON.parse(env.ACCESS_JWKS) : env.ACCESS_JWKS; const jwk = jwks.keys.find((key) => key.kid === header.kid); if (!jwk) return null;
    const algorithm = header.alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    return await crypto.subtle.verify(algorithm, key, signature, data) ? claims : null;
  } catch { return null; }
}
function decodePart(value) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); const binary = atob(normalized); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }

function parseJsonBody(rawBody) { try { return { value: JSON.parse(rawBody) }; } catch { return { body: errorBody("invalid_json", "Request body must be valid JSON", []), status: 400, persist: false, error: true }; } }
function responseFromResult(result) { return jsonResponse(result.body, result.status ?? 200); }
function jsonResponse(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: securityHeaders("application/json; charset=utf-8") }); }
function textResponse(body, status = 200) { return new Response(body, { status, headers: securityHeaders("text/plain; charset=utf-8") }); }
function publicNotFound() { return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") }); }
function jsonError(code, message, details = [], status = 400) { return jsonResponse(errorBody(code, message, details), status); }
function errorBody(code, message, details) { return { error: { code, message, details } }; }
function errorStatus(code) { return ["not_found"].includes(code) ? 404 : ["unauthorized"].includes(code) ? 401 : ["forbidden"].includes(code) ? 403 : ["session_state_conflict", "idempotency_conflict", "timezone_revision_boundary"].includes(code) ? 409 : ["export_capacity_exceeded"].includes(code) ? 503 : 400; }
function securityHeaders(contentType) { return { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }; }

const FALLBACK_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workout Tracker</title><style>body{font-family:system-ui;background:#f6f1e8;color:#26231f;margin:0}main{max-width:760px;margin:auto;padding:36px 22px}nav{display:flex;gap:16px;border-top:1px solid #e6ddd0;padding-top:20px;margin-top:40px}a{color:#a8432c}</style></head><body><main id="app"><p>WORKOUT TRACKER</p><h1>你的训练，今天就从这里开始。</h1><p>在线、移动优先的训练计划与 Session 记录。</p><nav aria-label="主导航"><a href="/app">今日</a><a href="/app#plan">计划</a><a href="/app#progress">进展</a><a href="/app#coach">教练</a><a href="/app#settings">设置</a></nav></main></body></html>`;
