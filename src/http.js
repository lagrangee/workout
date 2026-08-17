// @ts-nocheck

import { createStore } from "./store.js";
import { addDays, base64UrlDecode, base64UrlEncode, constantTimeEqual, deepClone, dateSpan, isRecord, isValidLocalDate, normalizeEmail, localDate, isValidTimezone, isValidUtcInstant, sha256Hex, trimString } from "./util.js";
import { planModel, scheduleModel, todayModel, sessionSummary, validatePlanForState, appendPlanRevision } from "./plan.js";
import { createSession, replaceRecord, endSession, pauseSession, resumeSession, continueOrRestart, normalizeExpiredSessions, findSession, sessionDetail } from "./session.js";
import { progressModel, exerciseDetail } from "./metrics.js";
import { athleteExport } from "./export.js";
import { authenticatedCoachUrl, coachManifest, coachReadme, coachResource, createCoachShare, findShareInStore, schemaResource } from "./coach.js";
import { agentAccessStatus, createAgentAccess, findAgentInStore, revokeAgentAccess } from "./agent.js";
import { agentApplyPlanUpdate, agentManifest, agentQueryError, agentResource, agentValidatePlanUpdate } from "./agent-api.js";
import { aerobicDetailModel, aerobicListModel } from "./training-archive.js";
import { compactAerobicSummary, recordsOverviewModel } from "./training-records.js";
import { validateSettings } from "./validation.js";

const PRIVATE_PREFIX = "/api/private";
const SESSION_COOKIE = "workout_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

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
  if (url.pathname === "/api/auth/login") return authLogin(request, env);
  if (url.pathname === "/api/auth/logout") return authLogout(request);
  if (url.pathname === "/api/coach/v1/schemas" && (request.method === "GET" || request.method === "HEAD")) return maybeHead(jsonResponse({ schema_version: 1, generated_at: new Date().toISOString(), schemas: ["manifest", "overview", "weekly_template", "plan", "schedule", "session_index", "session_detail", "progress", "exercise_detail", "error", "schema_catalog"].map((name) => ({ name, href: `/api/coach/v1/schemas/${name}`, json_schema_draft: "2020-12" })) }), request);
  if (url.pathname.startsWith("/api/coach/v1/schemas/") && (request.method === "GET" || request.method === "HEAD")) {
    const schema = schemaResource(url.pathname.split("/").at(-1));
    return schema ? maybeHead(new Response(JSON.stringify(schema, null, 2), { status: 200, headers: securityHeaders("application/schema+json") }), request) : jsonError("not_found", "Schema not found", [], 404);
  }
  if (url.pathname === "/api/agent/v1" || url.pathname.startsWith("/api/agent/v1/")) return agentRoute(request, env, getStore, url);
  if (url.pathname.startsWith("/coach/") || url.pathname.startsWith("/api/coach/v1/")) return coachRoute(request, env, getStore, url);
  if (url.pathname === "/app" && env.ENVIRONMENT === "production") {
    const auth = await authenticate(request, env);
    if (auth.error) return new Response(null, { status: 302, headers: { ...securityHeaders("text/plain; charset=utf-8"), Location: "/" } });
  }
  if (url.pathname === "/" || url.pathname === "/app" || url.pathname.startsWith("/assets/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".png") || url.pathname.endsWith(".wav") || url.pathname.endsWith(".webmanifest")) return staticRoute(request, env);
  if (url.pathname.startsWith(PRIVATE_PREFIX)) return privateRoute(request, env, getStore, url);
  return textResponse("Not found", 404);
}

async function agentRoute(request, env, getStore, url) {
  if (env.ENVIRONMENT === "production" && !env.AGENT_TOKEN_SECRET) return jsonError("service_not_configured", "Agent authentication is not configured", [], 503);
  const authorization = request.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  const store = await getStore();
  let state = null;
  try { state = bearer ? await findAgentInStore(store, bearer, env) : null; }
  catch (error) { if (error?.message?.startsWith("Missing required secret")) return jsonError("service_not_configured", "Agent authentication is not configured", [], 503); throw error; }
  if (!state) return agentUnauthorized();
  const isPlanValidationPath = url.pathname === "/api/agent/v1/plan-updates/validate";
  const isPlanApplyPath = url.pathname === "/api/agent/v1/plan-updates/apply";
  const isPlanValidation = request.method === "POST" && isPlanValidationPath;
  const isPlanApply = request.method === "POST" && isPlanApplyPath;
  if ((isPlanValidationPath || isPlanApplyPath) && request.method !== "POST") return agentMethodNotAllowed("POST");
  if (request.method !== "GET" && request.method !== "HEAD" && !isPlanValidation && !isPlanApply) return agentMethodNotAllowed();
  if (["athlete", "athlete_key", "email"].some((key) => url.searchParams.has(key))) return jsonError("invalid_request", "The Agent API does not accept Athlete selectors", [], 400);
  const queryError = agentQueryError(url.pathname, url);
  if (queryError) return jsonError(queryError.code, queryError.message, [], 400);
  const now = new Date();
  const resource = url.pathname === "/api/agent/v1" ? { ...agentManifest(state, now), capabilities: ["read", "plan:write"] } : isPlanValidation ? await agentValidatePlanUpdate(state, await request.text(), now) : isPlanApply ? await agentApplyRoute(request, store, state, now) : agentResource(state, url.pathname, url, now);
  if (resource instanceof Response) return resource;
  if (resource?.error) return jsonError(resource.error.code, resource.error.message, resource.error.details ?? [], errorStatus(resource.error.code));
  return maybeHead(jsonResponse(resource), request);
}

function agentUnauthorized() { return jsonError("agent_unauthorized", "A valid Agent Token is required", [], 401); }
function agentMethodNotAllowed(allow = "GET, HEAD") { const response = jsonError("method_not_allowed", "Method not allowed", [], 405); response.headers.set("Allow", allow); return response; }

/** @param {Request} request @param {any} store @param {any} authenticatedState @param {Date} now */
async function agentApplyRoute(request, store, authenticatedState, now) {
  const key = request.headers.get("Idempotency-Key") ?? "";
  if (!key || key.length > 200 || key.trim().length === 0) return jsonError("idempotency_key_required", "Idempotency-Key is required", [], 400);
  const rawBody = await request.text();
  const bodyDigest = await sha256Hex(rawBody);
  const execute = async (transactionStore) => {
    const state = transactionStore === store ? authenticatedState : await transactionStore.getByEmail(authenticatedState.email);
    if (!state) return jsonError("forbidden", "Identity is not configured", [], 403);
    state.idempotency_records ??= [];
    const existing = findIdempotencyRecord(state, key, request.method, "/api/agent/v1/plan-updates/apply", now);
    if (existing) {
      if (existing.body_digest !== bodyDigest) return jsonError("idempotency_conflict", "The key was already used with a different request body", [], 409);
      return new Response(existing.body, { status: existing.status, headers: securityHeaders("application/json; charset=utf-8") });
    }
    const resource = await agentApplyPlanUpdate(state, rawBody, now);
    if (resource?.error) return jsonError(resource.error.code, resource.error.message, resource.error.details ?? [], errorStatus(resource.error.code));
    const response = jsonResponse(resource, 201);
    await rememberIdempotencyResponse(state, key, request.method, "/api/agent/v1/plan-updates/apply", bodyDigest, response, now);
    await transactionStore.save(state);
    return response;
  };
  try {
    return store.transaction ? await store.transaction(execute) : await execute(store);
  } catch (error) {
    if (error?.code === "D1_CONCURRENCY_CONFLICT") return jsonError("session_state_conflict", "The Athlete state changed concurrently; retry the mutation", [], 409);
    throw error;
  }
}

async function staticRoute(request, env) {
  if (env.ASSETS?.fetch) {
    const response = await env.ASSETS.fetch(request);
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...securityHeaders(response.headers.get("content-type") ?? "text/html; charset=utf-8", "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'") } });
  }
  const path = new URL(request.url).pathname;
  if (path.endsWith(".css")) return new Response("", { headers: securityHeaders("text/css; charset=utf-8") });
  if (path.endsWith(".js")) return new Response("", { headers: securityHeaders("text/javascript; charset=utf-8") });
  return new Response(FALLBACK_HTML, { headers: securityHeaders("text/html; charset=utf-8") });
}

async function coachRoute(request, env, getStore, url) {
  const match = url.pathname.match(/^\/api\/coach\/v1\/([^/]+)(.*)$/);
  const readmeMatch = url.pathname.match(/^\/coach\/([^/]+)$/);
  const token = match?.[1] ?? readmeMatch?.[1];
  if (!token) return publicNotFound();
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { ...securityHeaders("text/plain; charset=utf-8"), Allow: "GET, HEAD" } });
  const store = await getStore();
  const state = await findShareInStore(store, token, env);
  if (!state) return publicNotFound();
  const now = new Date();
  const limited = await coachRateLimit(env, state, now);
  if (limited) return maybeHead(limited, request);
  if (readmeMatch) return maybeHead(new Response(coachReadme(state, now, url.origin, token), { status: 200, headers: securityHeaders("text/markdown; charset=utf-8") }), request);
  const suffix = match[2] || "";
  const manifest = suffix === "" ? coachManifest(state, now, url.origin, token) : coachResource(state, suffix, url, now, token);
  if (manifest?.error) return coachJsonError(manifest.error.code, manifest.error.message, manifest.error.details ?? [], errorStatus(manifest.error.code), now, manifest.error.field ?? null);
  return maybeHead(jsonResponse(manifest), request);
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
  if (request.method === "GET") {
    try { return await privateGet(state, path, url, now, env); }
    catch (error) { if (error?.message?.startsWith("Missing required secret")) return jsonError("service_not_configured", "The requested capability is not configured", [], 503); throw error; }
  }
  if (request.method === "PUT" || request.method === "POST" || request.method === "DELETE") return privateMutation(request, env, store, state, path, url, now);
  return jsonError("method_not_allowed", "Method not allowed", [], 405);
}

async function privateGet(state, path, url, now, env) {
  if (path === "/api/private/me") return jsonResponse({ athlete_key: state.athlete_key, display_name: state.display_name, timezone: state.timezone });
  if (path === "/api/private/agent-access") return jsonResponse(agentAccessStatus(state));
  if (path === "/api/private/today") return jsonResponse(todayModel(state, now));
  if (path === "/api/private/plan") return jsonResponse(planModel(state, now));
  if (path === "/api/private/plan/update-package") {
    const current = planModel(state, now).current;
    const week = current?.week ?? Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, null]));
    return jsonResponse({ schema_version: 1, effective_from: current?.effective_from ?? addDays(localDate(now, state.timezone), 1), week });
  }
  if (path === "/api/private/schedule") {
    const expandValue = url.searchParams.get("expand");
    if (expandValue && expandValue !== "prescription") return jsonError("invalid_request", "expand must be prescription", [], 400);
    const includeValue = url.searchParams.get("include");
    if (includeValue && includeValue !== "aerobic_summary") return jsonError("invalid_request", "include must be aerobic_summary", [], 400);
    const result = scheduleModel(state, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, now, expandValue === "prescription");
    if (Array.isArray(result) && includeValue === "aerobic_summary") for (const entry of result) entry.aerobic_summary = compactAerobicSummary(state, entry.date, now);
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse({ timezone: state.timezone, from: result[0]?.date ?? null, to: result.at(-1)?.date ?? null, entries: result });
  }
  if (path === "/api/private/sessions") return listPrivateSessions(state, url);
  if (path.startsWith("/api/private/sessions/")) { const session = findSession(state, path.split("/").at(-1)); return session ? jsonResponse(sessionDetail(session)) : jsonError("not_found", "Session not found", [], 404); }
  if (path === "/api/private/records/overview") {
    const period = recordPeriod(url);
    if (period.error) return jsonError(period.error.code, period.error.message, [], 400);
    const result = recordsOverviewModel(state, period.from, period.to, now);
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result);
  }
  if (path === "/api/private/records/aerobic") { const result = aerobicListModel(state, url, now); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path.startsWith("/api/private/records/aerobic/")) {
    let activityRef;
    try { activityRef = decodeURIComponent(path.slice("/api/private/records/aerobic/".length)); } catch { return jsonError("invalid_request", "activity_ref must be a valid path segment", [], 400); }
    if (!activityRef || activityRef.includes("/") || activityRef.includes("\\")) return jsonError("invalid_request", "activity_ref must be a single non-empty path segment", [], 400);
    const result = aerobicDetailModel(state, activityRef, now);
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result);
  }
  if (path === "/api/private/progress") { const result = progressModel(state, now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path.startsWith("/api/private/exercises/")) { const result = exerciseDetail(state, decodeURIComponent(path.split("/api/private/exercises/")[1]), now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path === "/api/private/coach-share") { const share = state.coach_share && !state.coach_share.revoked_at ? await authenticatedCoachUrl(state, env) : null; return jsonResponse(share ? { active: true, share_key: share.share_key, url: share.url } : { active: false, share_key: null, url: null }); }
  if (path === "/api/private/export") return exportResponse(state, now);
  return jsonError("not_found", "Resource not found", [], 404);
}

function recordPeriod(url) {
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  if ((from === undefined) !== (to === undefined)) return { error: { code: "invalid_period", message: "from and to must be provided together" } };
  return { from, to };
}

async function privateMutation(request, env, store, originalState, path, url, now) {
  const rawBody = await request.text();
  const execute = async (transactionStore) => {
    const state = transactionStore === store ? originalState : await transactionStore.getByEmail(originalState.email);
    if (!state) return jsonError("forbidden", "Identity is not configured", [], 403);
    state.idempotency_records ??= [];
    const mutation = async () => {
    if (request.method === "PUT" && path === "/api/private/settings") return updateSettings(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/plan-updates/validate") return validatePlanUpdate(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/plan-updates/apply") return applyPlanUpdate(state, rawBody, now);
    if (request.method === "POST" && path.match(/^\/api\/private\/scheduled-workouts\/\d{4}-\d{2}-\d{2}\/(start|skip)$/)) return startOrSkip(state, path, rawBody, now);
    if (request.method === "POST" && path === "/api/private/sessions/normalize-expired") return normalizeExpired(state, rawBody, now);
    if (request.method === "POST" && path.match(/^\/api\/private\/sessions\/[^/]+\/(end|pause|resume|continue|restart)$/)) return sessionCommand(state, path, rawBody, now);
    if (request.method === "PUT" && path.match(/^\/api\/private\/sessions\/[^/]+\/record$/)) return correctRecord(state, path, rawBody, now);
    if (request.method === "POST" && path === "/api/private/coach-share") return shareCommand(state, env, now, false);
    if (request.method === "POST" && path === "/api/private/coach-share/regenerate") return shareCommand(state, env, now, true);
    if (request.method === "POST" && path === "/api/private/agent-access") return agentAccessCommand(state, env, rawBody, now);
    if (request.method === "DELETE" && path === "/api/private/agent-access") { const result = revokeAgentAccess(state, now); return { body: { active: result.active, revoked: result.revoked }, status: 200, persist: result.persist }; }
    if (request.method === "DELETE" && path === "/api/private/coach-share") { if (state.coach_share) { state.coach_share.revoked_at = now.toISOString(); state.training_version += 1; } return { body: { active: false, revoked: true }, status: 200, persist: true }; }
    return { body: { error: { code: "not_found", message: "Resource not found", details: [] } }, status: 404, persist: false };
    };
    const requiresKey = request.method === "POST" && path !== "/api/private/plan-updates/validate" && path !== "/api/private/agent-access";
    if (!requiresKey) {
      const result = await mutation(); if (result.persist !== false) await transactionStore.save(state); return responseFromResult(result);
    }
    const key = request.headers.get("Idempotency-Key");
    if (!key || key.length > 200 || key.trim().length === 0) return jsonError("idempotency_key_required", "Idempotency-Key is required", [], 400);
    const digest = await sha256Hex(rawBody);
    const existing = findIdempotencyRecord(state, key, request.method, path, now);
    if (existing) {
      if (existing.body_digest !== digest) return jsonError("idempotency_conflict", "The key was already used with a different request body", [], 409);
      return new Response(existing.body, { status: existing.status, headers: securityHeaders("application/json; charset=utf-8") });
    }
    const result = await mutation();
    if (result.persist !== false) await transactionStore.save(state);
    const response = responseFromResult(result);
    await rememberIdempotencyResponse(state, key, request.method, path, digest, response, now);
    await transactionStore.save(state);
    return response;
  };
  try {
    return store.transaction ? await store.transaction(execute) : await execute(store);
  } catch (error) {
    if (error?.code === "D1_CONCURRENCY_CONFLICT") return jsonError("session_state_conflict", "The Athlete state changed concurrently; retry the mutation", [], 409);
    if (error?.message?.startsWith("Missing required secret")) return jsonError("service_not_configured", "The requested capability is not configured", [], 503);
    throw error;
  }
}

function findIdempotencyRecord(state, key, method, path, now) {
  return state.idempotency_records.find((record) => record.key === key && record.method === method && record.path === path && Date.parse(record.created_at) > now.getTime() - 24 * 60 * 60 * 1000);
}

async function rememberIdempotencyResponse(state, key, method, path, bodyDigest, response, now) {
  state.idempotency_records = state.idempotency_records.filter((record) => Date.parse(record.created_at) > now.getTime() - 24 * 60 * 60 * 1000);
  state.idempotency_records.push({ key, method, path, body_digest: bodyDigest, created_at: now.toISOString(), status: response.status, body: await response.clone().text() });
}

async function agentAccessCommand(state, env, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 0) return { body: errorBody("invalid_request", "Agent access accepts an empty object", []), status: 400, persist: false };
  return { body: await createAgentAccess(state, env, now), status: 201, persist: true };
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
  const allowedKeys = command === "end" ? ["record", "ended_at"] : command === "pause" ? ["close_at"] : [];
  if (!isRecord(body.value) || Object.keys(body.value).some((key) => !allowedKeys.includes(key))) return { body: errorBody("invalid_request", `${command} request body is invalid`, []), status: 400, persist: false };
  if (command !== "end" && command !== "pause" && Object.keys(body.value).length !== 0) return { body: errorBody("invalid_request", `${command} accepts an empty object`, []), status: 400, persist: false };
  if (command === "pause" && Object.hasOwn(body.value, "close_at") && (typeof body.value.close_at !== "string" || !isValidUtcInstant(body.value.close_at))) return { body: errorBody("invalid_request", "close_at must be an RFC 3339 UTC instant", []), status: 400, persist: false };
  const result = command === "end" ? endSession(state, sessionKey, body.value, now) : command === "pause" ? pauseSession(state, sessionKey, now, body.value.close_at ?? null) : command === "resume" ? resumeSession(state, sessionKey, now) : continueOrRestart(state, sessionKey, now, command);
  if (result.error) return { body: errorBody(result.error.code, result.error.message, result.error.details ?? []), status: errorStatus(result.error.code), persist: false };
  return { body: sessionDetail(result.session), status: 200, persist: true };
}

function normalizeExpired(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 0) return { body: errorBody("invalid_request", "normalize-expired accepts an empty object", []), status: 400, persist: false };
  const result = normalizeExpiredSessions(state, now);
  return { body: result, status: 200, persist: result.normalized_count > 0 };
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
  const rawLimit = url.searchParams.get("limit"); const limit = rawLimit === null ? 50 : Number(rawLimit);
  if ((from && !to) || (!from && to) || (from && !isValidLocalDate(from)) || (to && !isValidLocalDate(to)) || (from && to && from > to)) return jsonError("invalid_period", "from and to must be valid inclusive local dates", [], 400);
  if (from && to && (dateSpan(from, to) ?? Infinity) > 3660) return jsonError("invalid_period", "The selected period cannot exceed 3660 days", [], 400);
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 200)) return jsonError("invalid_request", "limit must be an integer between 1 and 200", [], 400);
  if (status && !["in_progress", "completed", "partial", "skipped"].includes(status)) return jsonError("invalid_request", "status is unsupported", [], 400);
  const filters = `${from ?? ""}|${to ?? ""}|${status ?? ""}|${exerciseKey ?? ""}|${limit}`;
  let sessions = state.sessions.filter((session) => (!from || session.scheduled_date >= from) && (!to || session.scheduled_date <= to) && (!status || session.status === status) && (!exerciseKey || session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_key === exerciseKey)))).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || b.session_key.localeCompare(a.session_key));
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    try {
      const value = JSON.parse(new TextDecoder().decode(base64UrlDecode(cursor)));
      if (value.filters !== filters || typeof value.issued_at !== "number" || !Number.isFinite(value.issued_at) || value.issued_at > Date.now() || Date.now() - value.issued_at > 15 * 60 * 1000 || typeof value.date !== "string" || !isValidLocalDate(value.date) || typeof value.key !== "string" || !value.key) throw new Error("bad cursor");
      sessions = sessions.filter((session) => session.scheduled_date < value.date || (session.scheduled_date === value.date && session.session_key < value.key));
    } catch { return jsonError("invalid_cursor", "Cursor is malformed, expired, or does not match the filters", [], 400); }
  }
  const page = sessions.slice(0, limit); const last = page.at(-1); const next = sessions.length > limit && last ? base64UrlEncode(new TextEncoder().encode(JSON.stringify({ filters, date: last.scheduled_date, key: last.session_key, issued_at: Date.now() }))) : null;
  return jsonResponse({ items: page.map(sessionSummary), page: { limit, next_cursor: next } });
}

function exportResponse(state, now) {
  const result = athleteExport(state, now); if (result.error) return jsonError(result.error.code, result.error.message, [], result.status); const date = localDate(now, state.timezone); return new Response(JSON.stringify(result.value, null, 2), { status: 200, headers: { ...securityHeaders("application/json; charset=utf-8"), "Content-Disposition": `attachment; filename="workout-data-${date}.json"` } });
}

async function authenticate(request, env) {
  const testEmail = request.headers.get("x-athlete-email") ?? request.headers.get("x-test-athlete-email");
  if (testEmail && env.LOCAL_AUTH === "true") return { email: normalizeEmail(testEmail) };
  const authorization = request.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  const token = bearer || readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  const claims = token ? await verifySessionToken(token, env) : null;
  if (!claims) return { error: { code: "unauthorized", message: "A valid application session is required", status: 401 } };
  return { email: claims.email };
}

async function authLogin(request, env) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...securityHeaders("text/plain; charset=utf-8"), Allow: "POST" } });
  if (!validSessionSecret(env.AUTH_SESSION_SECRET)) return jsonError("service_not_configured", "Authentication is not configured", [], 503);
  let body;
  try { body = JSON.parse(await request.text()); } catch { return jsonError("invalid_json", "Request body must be valid JSON", [], 400); }
  if (!isRecord(body) || Object.keys(body).length !== 2 || typeof body.email !== "string" || typeof body.password !== "string") return jsonError("invalid_credentials", "Email or password is incorrect", [], 401);
  const identity = configuredAuthIdentity(body.email, env);
  if (!identity || typeof identity.password !== "string" || !identity.password) return jsonError("invalid_credentials", "Email or password is incorrect", [], 401);
  const suppliedDigest = await sha256Hex(body.password);
  const expectedDigest = await sha256Hex(identity.password);
  if (!constantTimeEqual(suppliedDigest, expectedDigest)) return jsonError("invalid_credentials", "Email or password is incorrect", [], 401);
  const now = Math.floor(Date.now() / 1000);
  const token = await createSessionToken(identity.email, now, env.AUTH_SESSION_SECRET);
  const response = jsonResponse({ authenticated: true });
  response.headers.set("Set-Cookie", sessionCookie(token, SESSION_TTL_SECONDS));
  return response;
}

function authLogout(request) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...securityHeaders("text/plain; charset=utf-8"), Allow: "POST" } });
  const response = jsonResponse({ logged_out: true });
  response.headers.set("Set-Cookie", sessionCookie("", 0));
  return response;
}

function configuredAuthIdentity(email, env) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const normalized = normalizeEmail(email);
  const emailA = env.ENVIRONMENT === "production" ? normalizeConfiguredEmail(env.ATHLETE_A_EMAIL) : normalizeEmail(env.ATHLETE_A_EMAIL ?? "athlete-a@example.invalid");
  const emailB = env.ENVIRONMENT === "production" ? normalizeConfiguredEmail(env.ATHLETE_B_EMAIL) : normalizeEmail(env.ATHLETE_B_EMAIL ?? "athlete-b@example.invalid");
  if (!emailA || !emailB) return null;
  if (emailA === emailB) return null;
  if (normalized === emailA) return { email: emailA, password: env.AUTH_A_PASSWORD };
  if (normalized === emailB) return { email: emailB, password: env.AUTH_B_PASSWORD };
  return null;
}

async function createSessionToken(email, issuedAt, secret) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ version: 1, email, issued_at: issuedAt, expires_at: issuedAt + SESSION_TTL_SECONDS })));
  return `${payload}.${await signHmac(payload, secret)}`;
}

async function verifySessionToken(token, env) {
  try {
    if (!validSessionSecret(env.AUTH_SESSION_SECRET)) return null;
    const [payload, signature] = token.split("."); if (!payload || !signature) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decodePart(signature), new TextEncoder().encode(payload))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodePart(payload))); const now = Math.floor(Date.now() / 1000);
    if (claims.version !== 1 || typeof claims.email !== "string" || !Number.isSafeInteger(claims.issued_at) || !Number.isSafeInteger(claims.expires_at) || claims.expires_at <= now || claims.issued_at > now + 60 || claims.expires_at - claims.issued_at !== SESSION_TTL_SECONDS) return null;
    const identity = configuredAuthIdentity(claims.email, env);
    return identity ? { email: identity.email } : null;
  } catch { return null; }
}

async function signHmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function validSessionSecret(secret) {
  return typeof secret === "string" && secret.length >= 32;
}

function normalizeConfiguredEmail(value) {
  return typeof value === "string" && value.includes("@") ? normalizeEmail(value) : null;
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
function decodePart(value) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); const binary = atob(normalized); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }

function parseJsonBody(rawBody) { try { return { value: JSON.parse(rawBody) }; } catch { return { body: errorBody("invalid_json", "Request body must be valid JSON", []), status: 400, persist: false, error: true }; } }
function responseFromResult(result) { return jsonResponse(result.body, result.status ?? 200); }
function jsonResponse(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: securityHeaders("application/json; charset=utf-8") }); }
function textResponse(body, status = 200) { return new Response(body, { status, headers: securityHeaders("text/plain; charset=utf-8") }); }
function publicNotFound() { return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") }); }
function jsonError(code, message, details = [], status = 400) { return jsonResponse(errorBody(code, message, details), status); }
function coachJsonError(code, message, details = [], status = 400, now = new Date(), field = null) { const error = { code, message, details }; if (field) error.field = field; const response = jsonResponse({ schema_version: 1, generated_at: now.toISOString(), error }, status); if (status === 429) response.headers.set("Retry-After", "60"); return response; }
async function coachRateLimit(env, state, now) {
  if (!env.COACH_RATE_LIMITER?.limit) return null;
  try {
    const result = await env.COACH_RATE_LIMITER.limit({ key: state.coach_share.token_digest });
    return result?.success === false ? coachJsonError("rate_limited", "Coach Share request limit exceeded", [], 429, now) : null;
  } catch {
    return null;
  }
}
function errorBody(code, message, details) { return { error: { code, message, details } }; }
function errorStatus(code) { return ["not_found"].includes(code) ? 404 : ["unauthorized"].includes(code) ? 401 : ["forbidden"].includes(code) ? 403 : ["session_state_conflict", "idempotency_conflict", "package_digest_mismatch", "stale_plan", "timezone_revision_boundary", "training_version_changed"].includes(code) ? 409 : ["export_capacity_exceeded"].includes(code) ? 503 : 400; }
function securityHeaders(contentType, csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'") { return { "Content-Type": contentType, "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Content-Security-Policy": csp, "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }; }
function maybeHead(response, request) { return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response; }

const FALLBACK_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workout Tracker</title><style>body{font-family:system-ui;background:#f6f1e8;color:#26231f;margin:0}main{max-width:760px;margin:auto;padding:36px 22px}nav{display:flex;gap:16px;border-top:1px solid #e6ddd0;padding-top:20px;margin-top:40px}a{color:#a8432c}</style></head><body><main id="app"><p>WORKOUT TRACKER</p><h1>你的训练，今天就从这里开始。</h1><p>在线、移动优先的训练计划与 Session 记录。</p><nav aria-label="主导航"><a href="/app">今日</a><a href="/app#plan">计划</a><a href="/app#progress">进展</a><a href="/app#coach">教练</a><a href="/app#settings">设置</a></nav></main></body></html>`;
