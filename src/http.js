// @ts-check

import { createStore } from "./store.js";
import { addDays, base64UrlEncode, constantTimeEqual, deepClone, dateSpan, isRecord, isValidLocalDate, normalizeEmail, localDate, isValidTimezone, isValidUtcInstant, sha256Hex, trimString } from "./util.js";
import { planModel, planUpdateWeekProjection, scheduleModel, todayModel, sessionSummary, validatePlanForState, appendPlanRevision } from "./plan.js";
import { createSession, replaceRecord, endSession, pauseSession, resumeSession, continueOrRestart, normalizeExpiredSessions, findSession, sessionDetail } from "./session.js";
import { progressModel, exerciseDetail } from "./metrics.js";
import { athleteExport } from "./export.js";
import { authenticatedCoachUrl, coachManifest, coachReadme, coachResource, createCoachShare, findShareInStore, schemaResource } from "./coach.js";
import { agentAccessStatus, createAgentAccess, findAgentInStore, revokeAgentAccess } from "./agent.js";
import { agentApplyPlanUpdate, agentApplyPlanUpdateBatch, agentManifest, agentQueryError, agentResource, agentSyncAerobicProjection, agentValidatePlanUpdate, agentValidatePlanUpdateBatch } from "./agent-api.js";
import { aerobicDetailModel, aerobicListModel } from "./training-archive.js";
import { MAX_AEROBIC_SYNC_BODY_BYTES, syncAerobicProjection } from "./training-archive-projection.js";
import { compactAerobicSummary, recordingEvidence, recordsOverviewModel } from "./training-records.js";
import { routeDetailModel, routeHistoryModel, routeListModel } from "./training-routes.js";
import { validateSettings } from "./validation.js";
import { exerciseRegistry, resolveExercise, listExerciseDefinitions } from "./exercise-registry.js";
import { issueSignedCursor, verifySignedCursor } from "./signed-cursor.js";

const PRIVATE_PREFIX = "/api/private";
const SESSION_COOKIE = "workout_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_LOGIN_LIMIT = 5;
const DEFAULT_LOGIN_CLIENT_LIMIT = 20;
const DEFAULT_LOGIN_WINDOW_SECONDS = 10 * 60;
const MAX_LOGIN_BUCKETS = 1_024;

/** @typedef {Record<string, any>} HttpEnv */
/** @typedef {Map<string, { count: number, resetAt: number }>} LoginAttempts */

/** @param {HttpEnv} [initialEnv] @param {{ clock?: () => Date }} [options] */
export function createHandler(initialEnv = {}, options = {}) {
  let storePromise;
  const getStore = () => (storePromise ??= createStore(initialEnv, initialEnv.DB));
  const clock = options?.clock ?? (() => new Date());
  const loginAttempts = new Map();
  return { fetch: (/** @type {Request} */ request, /** @type {HttpEnv} */ env = initialEnv, /** @type {any} */ ctx) => route(request, env, getStore, ctx, requestInstant(clock), loginAttempts) };
}

/** @param {Request} request @param {Record<string, any>} env @param {() => Promise<any>} getStore @param {any} ctx @param {Date} now @param {Map<string, { count: number, resetAt: number }>} loginAttempts */
async function route(request, env, getStore, ctx, now, loginAttempts) {
  const url = new URL(request.url);
  if (env.ENVIRONMENT === "production" && env.PRODUCTION_HOST && url.hostname !== env.PRODUCTION_HOST) return textResponse("Not found", 404);
  if (url.pathname === "/healthz") {
    if (env.ENVIRONMENT === undefined || env.ENVIRONMENT === "development") return jsonResponse({ ok: true, service: "workout-tracker" });
    if (env.ENVIRONMENT !== "production") return jsonResponse({ ok: false, service: "workout-tracker" }, 503);
    const revision = typeof env.RELEASE_REVISION === "string" && /^[0-9a-f]{40}$/.test(env.RELEASE_REVISION) ? env.RELEASE_REVISION : null;
    return revision
      ? jsonResponse({ ok: true, service: "workout-tracker", revision })
      : jsonResponse({ ok: false, service: "workout-tracker" }, 503);
  }
  if (url.pathname === "/api/auth/login") return authLogin(request, env, now, loginAttempts);
  if (url.pathname === "/api/auth/logout") return authLogout(request, env, now);
  if (url.pathname === "/api/coach/v1/schemas" && (request.method === "GET" || request.method === "HEAD")) return maybeHead(jsonResponse({ schema_version: 1, generated_at: now.toISOString(), schemas: ["manifest", "overview", "weekly_template", "plan", "schedule", "session_index", "session_detail", "progress", "exercise_detail", "error", "schema_catalog"].map((name) => ({ name, href: `/api/coach/v1/schemas/${name}`, json_schema_draft: "2020-12" })) }), request);
  if (url.pathname.startsWith("/api/coach/v1/schemas/") && (request.method === "GET" || request.method === "HEAD")) {
    const schemaName = url.pathname.split("/").at(-1);
    const schema = schemaName ? schemaResource(schemaName, configuredPublicOrigin(env, url)) : null;
    return schema ? maybeHead(new Response(JSON.stringify(schema, null, 2), { status: 200, headers: securityHeaders("application/schema+json") }), request) : jsonError("not_found", "Schema not found", [], 404);
  }
  if (url.pathname === "/api/agent/v1" || url.pathname.startsWith("/api/agent/v1/")) return agentRoute(request, env, getStore, url, now);
  if (url.pathname.startsWith("/coach/") || url.pathname.startsWith("/api/coach/v1/")) return coachRoute(request, env, getStore, url, now);
  if (url.pathname === "/app" && env.ENVIRONMENT === "production") {
    const auth = await authenticate(request, env, now);
    if (auth.error) return new Response(null, { status: 302, headers: { ...securityHeaders("text/plain; charset=utf-8"), Location: "/" } });
  }
  if (url.pathname === "/" || url.pathname === "/app" || url.pathname.startsWith("/assets/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".png") || url.pathname.endsWith(".wav") || url.pathname.endsWith(".webmanifest")) return staticRoute(request, env);
  if (url.pathname.startsWith(PRIVATE_PREFIX)) return privateRoute(request, env, getStore, url, now);
  return textResponse("Not found", 404);
}

/** @param {Request} request @param {HttpEnv} env @param {() => Promise<any>} getStore @param {URL} url @param {Date} now */
async function agentRoute(request, env, getStore, url, now) {
  if (env.ENVIRONMENT === "production" && !env.AGENT_TOKEN_SECRET) return jsonError("service_not_configured", "Agent authentication is not configured", [], 503);
  const authorization = request.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  const store = await getStore();
  let state = null;
  try { state = bearer ? await findAgentInStore(store, bearer, env) : null; }
  catch (error) { if (error instanceof Error && error.message.startsWith("Missing required secret")) return jsonError("service_not_configured", "Agent authentication is not configured", [], 503); throw error; }
  if (!state) {
    emitSecurityEvent(env, "authentication_rejected", now, { surface: "agent_bearer", reason: "invalid_bearer" });
    return agentUnauthorized();
  }
  const isPlanValidationPath = url.pathname === "/api/agent/v1/plan-updates/validate";
  const isPlanApplyPath = url.pathname === "/api/agent/v1/plan-updates/apply";
  const isPlanBatchValidationPath = url.pathname === "/api/agent/v1/plan-update-batches/validate";
  const isPlanBatchApplyPath = url.pathname === "/api/agent/v1/plan-update-batches/apply";
  const isAerobicSyncPath = url.pathname === "/api/agent/v1/aerobic/sync";
  const isPlanValidation = request.method === "POST" && isPlanValidationPath;
  const isPlanApply = request.method === "POST" && isPlanApplyPath;
  const isPlanBatchValidation = request.method === "POST" && isPlanBatchValidationPath;
  const isPlanBatchApply = request.method === "POST" && isPlanBatchApplyPath;
  const isAerobicSync = request.method === "POST" && isAerobicSyncPath;
  if ((isPlanValidationPath || isPlanApplyPath || isPlanBatchValidationPath || isPlanBatchApplyPath || isAerobicSyncPath) && request.method !== "POST") return agentMethodNotAllowed("POST");
  if (request.method !== "GET" && request.method !== "HEAD" && !isPlanValidation && !isPlanApply && !isPlanBatchValidation && !isPlanBatchApply && !isAerobicSync) return agentMethodNotAllowed();
  if (["athlete", "athlete_key", "email"].some((key) => url.searchParams.has(key))) return jsonError("invalid_request", "The Agent API does not accept Athlete selectors", [], 400);
  const queryError = agentQueryError(url.pathname, url);
  if (queryError) return jsonError(queryError.code, queryError.message, [], 400);
  const resource = url.pathname === "/api/agent/v1" ? { ...agentManifest(state, now), capabilities: ["read", "plan:write", "plan-batch:write", "aerobic:write"] } : isPlanValidation ? await agentValidatePlanUpdate(state, await request.text(), now) : isPlanApply ? await agentApplyRoute(request, env, store, state, now) : isPlanBatchValidation ? await agentValidatePlanUpdateBatch(state, await request.text(), now) : isPlanBatchApply ? await agentBatchApplyRoute(request, env, store, state, now) : isAerobicSync ? await agentAerobicSyncRoute(request, env, store, state, now) : await agentResource(state, url.pathname, url, now, configuredPublicOrigin(env, url), env.AGENT_TOKEN_SECRET);
  if (resource instanceof Response) return resource;
  if (resource?.error) return jsonError(resource.error.code, resource.error.message, resource.error.details ?? [], errorStatus(resource.error.code));
  return maybeHead(jsonResponse(resource), request);
}

function agentUnauthorized() { return jsonError("agent_unauthorized", "A valid Agent Token is required", [], 401); }
function agentMethodNotAllowed(allow = "GET, HEAD") { const response = jsonError("method_not_allowed", "Method not allowed", [], 405); response.headers.set("Allow", allow); return response; }

/** @param {Request} request @param {any} env @param {any} store @param {any} authenticatedState @param {Date} now */
async function agentApplyRoute(request, env, store, authenticatedState, now) {
  const rawBody = await request.text();
  return agentMutationRoute({ request, env, store, authenticatedState, now, path: "/api/agent/v1/plan-updates/apply", rawBody, status: 201, apply: (state) => agentApplyPlanUpdate(state, rawBody, now) });
}

/** @param {Request} request @param {any} env @param {any} store @param {any} authenticatedState @param {Date} now */
async function agentBatchApplyRoute(request, env, store, authenticatedState, now) {
  const rawBody = await request.text();
  return agentMutationRoute({ request, env, store, authenticatedState, now, path: "/api/agent/v1/plan-update-batches/apply", rawBody, status: 201, apply: (state) => agentApplyPlanUpdateBatch(state, rawBody, now) });
}

/** @param {Request} request @param {any} env @param {any} store @param {any} authenticatedState @param {Date} now */
async function agentAerobicSyncRoute(request, env, store, authenticatedState, now) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_AEROBIC_SYNC_BODY_BYTES) {
    emitSecurityEvent(env, "archive_validation_rejected", now, { surface: "agent", reason: "payload_too_large" });
    return jsonError("payload_too_large", "The aerobic projection body is too large", [], 413);
  }
  return agentMutationRoute({ request, env, store, authenticatedState, now, path: "/api/agent/v1/aerobic/sync", rawBody, status: 200, apply: (state) => agentSyncAerobicProjection(state, rawBody, now) });
}

/** @param {{ request: Request, env: any, store: any, authenticatedState: any, now: Date, path: string, rawBody: string, status: number, apply: (state: any) => any|Promise<any> }} options */
async function agentMutationRoute({ request, env, store, authenticatedState, now, path, rawBody, status, apply }) {
  const key = request.headers.get("Idempotency-Key") ?? "";
  if (!key || key.length > 200 || key.trim().length === 0) return jsonError("idempotency_key_required", "Idempotency-Key is required", [], 400);
  const bodyDigest = await sha256Hex(rawBody);
  /** @param {any} transactionStore */
  const execute = async (transactionStore) => {
    const state = transactionStore === store ? authenticatedState : await transactionStore.getByEmail(authenticatedState.email);
    if (!state) return jsonError("forbidden", "Identity is not configured", [], 403);
    state.idempotency_records ??= [];
    const existing = findIdempotencyRecord(state, key, request.method, path, now);
    if (existing) {
      if (existing.body_digest !== bodyDigest) {
        emitSecurityEvent(env, "mutation_conflict", now, { surface: "agent", reason: "idempotency_conflict" });
        return jsonError("idempotency_conflict", "The key was already used with a different request body", [], 409);
      }
      return new Response(existing.body, { status: existing.status, headers: securityHeaders("application/json; charset=utf-8") });
    }
    const resource = await apply(state);
    if (resource?.error) {
      if (path === "/api/agent/v1/aerobic/sync") emitSecurityEvent(env, "archive_validation_rejected", now, { surface: "agent", reason: safeReason(resource.error.code) });
      const statusCode = errorStatus(resource.error.code);
      if (statusCode === 409) emitSecurityEvent(env, "mutation_conflict", now, { surface: "agent", reason: safeReason(resource.error.code) });
      return jsonError(resource.error.code, resource.error.message, resource.error.details ?? [], statusCode);
    }
    const response = jsonResponse(resource, status);
    await rememberIdempotencyResponse(state, key, request.method, path, bodyDigest, response, now);
    await transactionStore.save(state);
    return response;
  };
  try {
    return store.transaction ? await store.transaction(execute, { now }) : await execute(store);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "D1_CONCURRENCY_CONFLICT") {
      emitSecurityEvent(env, "mutation_conflict", now, { surface: "agent", reason: "state_concurrency" });
      return jsonError("session_state_conflict", "The Athlete state changed concurrently; retry the mutation", [], 409);
    }
    throw error;
  }
}

/** @param {Request} request @param {HttpEnv} env */
async function staticRoute(request, env) {
  if (env.ASSETS?.fetch) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders(
      response.headers.get("content-type") ?? "text/html; charset=utf-8",
      "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ))) headers.set(name, value);
    return new Response(request.method === "HEAD" ? null : response.body, {
      status: response.status,
      headers,
    });
  }
  const path = new URL(request.url).pathname;
  if (path.endsWith(".css")) return new Response("", { headers: securityHeaders("text/css; charset=utf-8") });
  if (path.endsWith(".js")) return new Response("", { headers: securityHeaders("text/javascript; charset=utf-8") });
  return new Response(FALLBACK_HTML, { headers: securityHeaders("text/html; charset=utf-8") });
}

/** @param {Request} request @param {HttpEnv} env @param {() => Promise<any>} getStore @param {URL} url @param {Date} now */
async function coachRoute(request, env, getStore, url, now) {
  const match = url.pathname.match(/^\/api\/coach\/v1\/([^/]+)(.*)$/);
  const readmeMatch = url.pathname.match(/^\/coach\/([^/]+)$/);
  const token = match?.[1] ?? readmeMatch?.[1];
  if (!token) return publicNotFound();
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { ...securityHeaders("text/plain; charset=utf-8"), Allow: "GET, HEAD" } });
  const store = await getStore();
  const state = await findShareInStore(store, token, env);
  if (!state) return publicNotFound();
  const limited = await coachRateLimit(env, state, now);
  if (limited) return maybeHead(limited, request);
  const origin = configuredPublicOrigin(env, url);
  if (readmeMatch) return maybeHead(new Response(coachReadme(state, now, origin, token), { status: 200, headers: securityHeaders("text/markdown; charset=utf-8") }), request);
  const suffix = match?.[2] || "";
  const cursorSecret = authCursorSecret(env);
  if (suffix.endsWith("/sessions") && !cursorSecret) return coachJsonError("service_not_configured", "Coach cursor signing is not configured", [], 503, now, null);
  const manifest = /** @type {any} */ (suffix === "" ? coachManifest(state, now, origin, token) : await coachResource(state, suffix, url, now, token, suffix.endsWith("/sessions") ? {
    requireTrainingVersion: true,
    cursor: { secret: cursorSecret, domain: "coach-share-sessions", subject: `${state.athlete_key}\u0000${state.coach_share.share_key}` },
  } : {}));
  if (manifest?.error) return coachJsonError(manifest.error.code, manifest.error.message, manifest.error.details ?? [], errorStatus(manifest.error.code), now, manifest.error.field ?? null);
  return maybeHead(jsonResponse(manifest), request);
}

/** @param {Request} request @param {HttpEnv} env @param {() => Promise<any>} getStore @param {URL} url @param {Date} now */
async function privateRoute(request, env, getStore, url, now) {
  if (["PUT", "POST", "DELETE"].includes(request.method)) {
    const browserGuard = cookieMutationGuard(request, env);
    if (browserGuard) {
      emitSecurityEvent(env, "authentication_rejected", now, { surface: "browser_mutation", reason: browserGuard.reason });
      return browserGuard.response;
    }
  }
  const auth = await authenticate(request, env, now);
  if (auth.error) {
    emitSecurityEvent(env, "authentication_rejected", now, { surface: "application_session", reason: "invalid_session" });
    return jsonError(auth.error.code, auth.error.message, [], auth.error.status);
  }
  const store = await getStore();
  const state = await store.getByEmail(auth.email);
  if (!state) return jsonError("forbidden", "Identity is not configured", [], 403);
  state.idempotency_records ??= [];
  const path = url.pathname;
  if (request.method === "GET") {
    try { return await privateGet(state, path, url, now, env); }
    catch (error) { if (error instanceof Error && error.message.startsWith("Missing required secret")) return jsonError("service_not_configured", "The requested capability is not configured", [], 503); throw error; }
  }
  if (request.method === "PUT" || request.method === "POST" || request.method === "DELETE") return privateMutation(request, env, store, state, path, url, now);
  return jsonError("method_not_allowed", "Method not allowed", [], 405);
}

/** @param {any} state @param {string} path @param {URL} url @param {Date} now @param {HttpEnv} env */
async function privateGet(state, path, url, now, env) {
  if (path === "/api/private/me") return jsonResponse({ athlete_key: state.athlete_key, display_name: state.display_name, timezone: state.timezone });
  if (path === "/api/private/exercise-registry") {
    const exerciseId = url.searchParams.get("exercise_id");
    if (exerciseId !== null) {
      if (!exerciseId) return jsonError("invalid_request", "exercise_id must not be empty", [], 400);
      const exercise = resolveExercise(exerciseId);
      return exercise ? jsonResponse({ schema_version: exerciseRegistry().schema_version, exercise }) : jsonError("exercise_not_found", "Exercise was not found in the global registry", [], 404);
    }
    return jsonResponse({ schema_version: exerciseRegistry().schema_version, exercises: listExerciseDefinitions() });
  }
  if (path === "/api/private/agent-access") return jsonResponse(agentAccessStatus(state));
  if (path === "/api/private/today") {
    const result = todayModel(state, now);
    if (result.entry.recording_intent) {
      result.entry.aerobic_summary = compactAerobicSummary(state, result.date, now);
      result.entry.recording_evidence = recordingEvidence(state, result.date, result.entry.recording_intent, now);
    }
    return jsonResponse(result);
  }
  if (path === "/api/private/plan") return jsonResponse(planModel(state, now));
  if (path === "/api/private/plan/update-package") {
    const current = planModel(state, now).current;
    const week = current?.week ? planUpdateWeekProjection(current.week) : Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, null]));
    const canonical = /** @type {any[]} */ (Object.values(week)).some((slot) => slot?.kind === "workout" && /** @type {any[]} */ (slot.blocks ?? []).some((block) => /** @type {any[]} */ (block.exercises ?? []).some((exercise) => exercise.exercise_id)));
    return jsonResponse({ schema_version: canonical ? 2 : 1, effective_from: current?.effective_from ?? addDays(localDate(now, state.timezone), 1), week });
  }
  if (path === "/api/private/schedule") {
    const expandValue = url.searchParams.get("expand");
    if (expandValue && expandValue !== "prescription") return jsonError("invalid_request", "expand must be prescription", [], 400);
    const includeValue = url.searchParams.get("include");
    if (includeValue && includeValue !== "aerobic_summary") return jsonError("invalid_request", "include must be aerobic_summary", [], 400);
    const result = /** @type {any} */ (scheduleModel(state, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, now, expandValue === "prescription"));
    if (Array.isArray(result) && includeValue === "aerobic_summary") for (const entry of result) {
      entry.aerobic_summary = compactAerobicSummary(state, entry.date, now);
      const evidence = recordingEvidence(state, entry.date, entry.recording_intent, now);
      if (evidence) entry.recording_evidence = evidence;
    }
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse({ timezone: state.timezone, from: result[0]?.date ?? null, to: result.at(-1)?.date ?? null, entries: result });
  }
  if (path === "/api/private/sessions") return await listPrivateSessions(state, url, now, env);
  if (path.startsWith("/api/private/sessions/")) { const sessionKey = path.split("/").at(-1); const session = sessionKey ? findSession(state, sessionKey) : null; return session ? jsonResponse(sessionDetail(session)) : jsonError("not_found", "Session not found", [], 404); }
  if (path === "/api/private/records/overview") {
    const period = recordPeriod(url);
    if (period.error) return jsonError(period.error.code, period.error.message, [], 400);
    const result = recordsOverviewModel(state, period.from, period.to, now);
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result);
  }
  if (path === "/api/private/records/aerobic") { const result = /** @type {any} */ (aerobicListModel(state, url, now)); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path.startsWith("/api/private/records/aerobic/")) {
    let activityRef;
    try { activityRef = decodeURIComponent(path.slice("/api/private/records/aerobic/".length)); } catch { return jsonError("invalid_request", "activity_ref must be a valid path segment", [], 400); }
    if (!activityRef || activityRef.includes("/") || activityRef.includes("\\")) return jsonError("invalid_request", "activity_ref must be a single non-empty path segment", [], 400);
    const result = aerobicDetailModel(state, activityRef, now);
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result);
  }
  if (path === "/api/private/records/routes") {
    const result = routeListModel(state, url, now);
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result);
  }
  if (path.startsWith("/api/private/records/routes/")) {
    const suffix = path.slice("/api/private/records/routes/".length);
    const isHistory = suffix.endsWith("/history");
    const encodedKey = isHistory ? suffix.slice(0, -"/history".length) : suffix;
    let routeKey;
    try { routeKey = decodeURIComponent(encodedKey); } catch { return jsonError("invalid_request", "route_key must be a valid path segment", [], 400); }
    if (!routeKey || routeKey.includes("/") || routeKey.includes("\\")) return jsonError("invalid_request", "route_key must be a single non-empty path segment", [], 400);
    const result = isHistory ? routeHistoryModel(state, routeKey, now, url) : routeDetailModel(state, routeKey, now, url);
    return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result);
  }
  if (path === "/api/private/progress") { const result = /** @type {any} */ (progressModel(state, now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined)); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path.startsWith("/api/private/exercises/")) { const exerciseKey = path.split("/api/private/exercises/")[1]; if (!exerciseKey) return jsonError("invalid_request", "exercise_key must not be empty", [], 400); const result = /** @type {any} */ (exerciseDetail(state, decodeURIComponent(exerciseKey), now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined, undefined)); return result.error ? jsonError(result.error.code, result.error.message, [], errorStatus(result.error.code)) : jsonResponse(result); }
  if (path === "/api/private/coach-share") { const share = state.coach_share && !state.coach_share.revoked_at ? await authenticatedCoachUrl(state, env) : null; return jsonResponse(share ? { active: true, share_key: share.share_key, url: share.url } : { active: false, share_key: null, url: null }); }
  if (path === "/api/private/export") return exportResponse(state, now);
  return jsonError("not_found", "Resource not found", [], 404);
}

/** @param {URL} url */
function recordPeriod(url) {
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  if ((from === undefined) !== (to === undefined)) return { error: { code: "invalid_period", message: "from and to must be provided together" } };
  return { from, to };
}

/** @param {Request} request @param {HttpEnv} env @param {any} store @param {any} originalState @param {string} path @param {URL} url @param {Date} now */
async function privateMutation(request, env, store, originalState, path, url, now) {
  const rawBody = await request.text();
  if (path === "/api/private/records/aerobic/sync" && new TextEncoder().encode(rawBody).byteLength > MAX_AEROBIC_SYNC_BODY_BYTES) {
    emitSecurityEvent(env, "archive_validation_rejected", now, { surface: "private", reason: "payload_too_large" });
    return jsonError("payload_too_large", "The aerobic projection body is too large", [], 413);
  }
  /** @param {any} transactionStore */
  const execute = async (transactionStore) => {
    const state = transactionStore === store ? originalState : await transactionStore.getByEmail(originalState.email);
    if (!state) return jsonError("forbidden", "Identity is not configured", [], 403);
    state.idempotency_records ??= [];
    const mutation = async () => {
    if (request.method === "PUT" && path === "/api/private/settings") return updateSettings(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/records/aerobic/sync") {
      const result = syncAerobicProjection(state, rawBody, now);
      if (result.error) {
        emitSecurityEvent(env, "archive_validation_rejected", now, { surface: "private", reason: safeReason(result.error.code) });
        return { body: errorBody(result.error.code, result.error.message, []), status: result.status ?? errorStatus(result.error.code), persist: false };
      }
      return result;
    }
    if (request.method === "POST" && path === "/api/private/plan-updates/validate") return validatePlanUpdate(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/plan-updates/apply") return applyPlanUpdate(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/plan-update-batches/validate") return validatePlanUpdateBatch(state, rawBody, now);
    if (request.method === "POST" && path === "/api/private/plan-update-batches/apply") return applyPlanUpdateBatch(state, rawBody, now);
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
    const requiresKey = request.method === "POST" && path !== "/api/private/plan-updates/validate" && path !== "/api/private/plan-update-batches/validate" && path !== "/api/private/agent-access";
    if (!requiresKey) {
      const result = await mutation();
      observeMutationResult(env, result, now, "private");
      if (result.persist !== false) await transactionStore.save(state);
      return responseFromResult(result);
    }
    const key = request.headers.get("Idempotency-Key");
    if (!key || key.length > 200 || key.trim().length === 0) return jsonError("idempotency_key_required", "Idempotency-Key is required", [], 400);
    const digest = await sha256Hex(rawBody);
    const existing = findIdempotencyRecord(state, key, request.method, path, now);
    if (existing) {
      if (existing.body_digest !== digest) {
        emitSecurityEvent(env, "mutation_conflict", now, { surface: "private", reason: "idempotency_conflict" });
        return jsonError("idempotency_conflict", "The key was already used with a different request body", [], 409);
      }
      return new Response(existing.body, { status: existing.status, headers: securityHeaders("application/json; charset=utf-8") });
    }
    const result = await mutation();
    observeMutationResult(env, result, now, "private");
    const response = responseFromResult(result);
    if (!response.ok) return response;
    if (result.persist !== false) await transactionStore.save(state);
    await rememberIdempotencyResponse(state, key, request.method, path, digest, response, now);
    await transactionStore.save(state);
    return response;
  };
  try {
    return store.transaction ? await store.transaction(execute, { now }) : await execute(store);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "D1_CONCURRENCY_CONFLICT") {
      emitSecurityEvent(env, "mutation_conflict", now, { surface: "private", reason: "state_concurrency" });
      return jsonError("session_state_conflict", "The Athlete state changed concurrently; retry the mutation", [], 409);
    }
    if (error instanceof Error && error.message.startsWith("Missing required secret")) return jsonError("service_not_configured", "The requested capability is not configured", [], 503);
    throw error;
  }
}

/** @param {any} state @param {string} key @param {string} method @param {string} path @param {Date} now */
function findIdempotencyRecord(state, key, method, path, now) {
  return /** @type {any[]} */ (state.idempotency_records).find((record) => record.key === key && record.method === method && record.path === path && Date.parse(record.created_at) > now.getTime() - 24 * 60 * 60 * 1000);
}

/** @param {any} state @param {string} key @param {string} method @param {string} path @param {string} bodyDigest @param {Response} response @param {Date} now */
async function rememberIdempotencyResponse(state, key, method, path, bodyDigest, response, now) {
  state.idempotency_records = /** @type {any[]} */ (state.idempotency_records).filter((record) => Date.parse(record.created_at) > now.getTime() - 24 * 60 * 60 * 1000);
  state.idempotency_records.push({ key, method, path, body_digest: bodyDigest, created_at: now.toISOString(), status: response.status, body: await response.clone().text() });
}

/** @param {any} state @param {HttpEnv} env @param {string} rawBody @param {Date} now */
async function agentAccessCommand(state, env, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 0) return { body: errorBody("invalid_request", "Agent access accepts an empty object", []), status: 400, persist: false };
  return { body: await createAgentAccess(state, env, now), status: 201, persist: true };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
function updateSettings(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  const errors = validateSettings(body.value); if (errors.length) return { body: errorBody("invalid_settings", "Settings are invalid", errors), status: 400, persist: false };
  const oldDate = localDate(now, state.timezone); const newDate = localDate(now, body.value.timezone);
  const oldRevision = /** @type {any[]} */ (state.plan_revisions).filter((revision) => revision.effective_from <= oldDate).sort((a, b) => b.revision_sequence - a.revision_sequence)[0]?.revision_key ?? null;
  const newRevision = /** @type {any[]} */ (state.plan_revisions).filter((revision) => revision.effective_from <= newDate).sort((a, b) => b.revision_sequence - a.revision_sequence)[0]?.revision_key ?? null;
  if (oldRevision !== newRevision) return { body: errorBody("timezone_revision_boundary", "This timezone change would select a different effective plan revision now", []), status: 409, persist: false };
  state.display_name = trimString(body.value.display_name); state.timezone = body.value.timezone; state.updated_at = now.toISOString();
  return { body: { display_name: state.display_name, timezone: state.timezone }, status: 200, persist: true };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
function validatePlanUpdate(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 1 || typeof body.value.package_text !== "string") return { body: errorBody("invalid_request", "package_text is required", []), status: 400, persist: false };
  const result = /** @type {any} */ (validatePlanForState(state, body.value.package_text, now)); if (!result.ok) return { body: errorBody("invalid_plan_package", "The plan package needs repair", result.errors), status: 400, persist: false };
  return { body: { valid: true, preview: result.preview }, status: 200, persist: false };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
function applyPlanUpdate(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 1 || typeof body.value.package_text !== "string") return { body: errorBody("invalid_request", "package_text is required", []), status: 400, persist: false };
  const result = /** @type {any} */ (validatePlanForState(state, body.value.package_text, now)); if (!result.ok) return { body: errorBody("invalid_plan_package", "The plan package needs repair", result.errors), status: 400, persist: false };
  const revision = appendPlanRevision(state, result.value, now);
  state.training_version += 1;
  return { body: { revision: { effective_from: revision.effective_from }, preview: result.preview }, status: 201, persist: true };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
async function validatePlanUpdateBatch(state, rawBody, now) {
  const result = /** @type {any} */ (await agentValidatePlanUpdateBatch(state, rawBody, now));
  return result.error ? { body: errorBody(result.error.code, result.error.message, result.error.details ?? []), status: errorStatus(result.error.code), persist: false } : { body: result, status: 200, persist: false };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
async function applyPlanUpdateBatch(state, rawBody, now) {
  const result = /** @type {any} */ (await agentApplyPlanUpdateBatch(state, rawBody, now));
  return result.error ? { body: errorBody(result.error.code, result.error.message, result.error.details ?? []), status: errorStatus(result.error.code), persist: false } : { body: result, status: 201, persist: true };
}

/** @param {any} state @param {string} path @param {string} rawBody @param {Date} now */
function startOrSkip(state, path, rawBody, now) {
  const parts = path.split("/"); const date = parts.at(-2); const kind = parts.at(-1); const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || (kind === "start" && Object.keys(body.value).length) || (kind === "skip" && (!Object.prototype.hasOwnProperty.call(body.value, "skip_reason") || Object.keys(body.value).some((key) => key !== "skip_reason") || (body.value.skip_reason !== null && typeof body.value.skip_reason !== "string")))) return { body: errorBody("invalid_request", "Command body is invalid", []), status: 400, persist: false };
  const reason = kind === "skip" ? trimString(body.value.skip_reason ?? null) : null;
  if (reason !== null && (reason.length < 1 || reason.length > 500)) return { body: errorBody("invalid_request", "skip_reason must contain 1-500 characters", []), status: 400, persist: false };
  if (!date || !kind) return { body: errorBody("invalid_request", "Session command path is incomplete", []), status: 400, persist: false };
  const result = createSession(state, date, now, kind, reason); if (result.error) return { body: errorBody(result.error.code, result.error.message, []), status: errorStatus(result.error.code), persist: false };
  return { body: sessionDetail(result.session), status: result.replay ? 200 : 201, persist: !result.replay };
}

/** @param {any} state @param {string} path @param {string} rawBody @param {Date} now */
function sessionCommand(state, path, rawBody, now) {
  const sessionKey = path.split("/").at(-2); const command = path.split("/").at(-1); const body = parseJsonBody(rawBody); if (body.error) return body;
  const allowedKeys = command === "end" ? ["record", "ended_at"] : command === "pause" ? ["close_at"] : [];
  if (!isRecord(body.value) || Object.keys(body.value).some((key) => !allowedKeys.includes(key))) return { body: errorBody("invalid_request", `${command} request body is invalid`, []), status: 400, persist: false };
  if (command !== "end" && command !== "pause" && Object.keys(body.value).length !== 0) return { body: errorBody("invalid_request", `${command} accepts an empty object`, []), status: 400, persist: false };
  if (command === "pause" && Object.hasOwn(body.value, "close_at") && (typeof body.value.close_at !== "string" || !isValidUtcInstant(body.value.close_at))) return { body: errorBody("invalid_request", "close_at must be an RFC 3339 UTC instant", []), status: 400, persist: false };
  if (!sessionKey || !command) return { body: errorBody("invalid_request", "Session command path is incomplete", []), status: 400, persist: false };
  const result = /** @type {any} */ (command === "end" ? endSession(state, sessionKey, body.value, now) : command === "pause" ? pauseSession(state, sessionKey, now, body.value.close_at ?? null) : command === "resume" ? resumeSession(state, sessionKey, now) : continueOrRestart(state, sessionKey, now, command));
  if (result.error) return { body: errorBody(result.error.code, result.error.message, result.error.details ?? []), status: errorStatus(result.error.code), persist: false };
  return { body: sessionDetail(result.session), status: 200, persist: true };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
function normalizeExpired(state, rawBody, now) {
  const body = parseJsonBody(rawBody); if (body.error) return body;
  if (!isRecord(body.value) || Object.keys(body.value).length !== 0) return { body: errorBody("invalid_request", "normalize-expired accepts an empty object", []), status: 400, persist: false };
  const result = normalizeExpiredSessions(state, now);
  return { body: result, status: 200, persist: result.normalized_count > 0 };
}

/** @param {any} state @param {string} path @param {string} rawBody @param {Date} now */
function correctRecord(state, path, rawBody, now) {
  const sessionKey = path.split("/").at(-2); const session = sessionKey ? findSession(state, sessionKey) : null; if (!session) return { body: errorBody("not_found", "Session not found", []), status: 404, persist: false };
  const body = parseJsonBody(rawBody); if (body.error) return body;
  const result = replaceRecord(state, session, body.value, now); if (result.error) return { body: errorBody(result.error.code, result.error.message, result.error.details ?? []), status: errorStatus(result.error.code), persist: false };
  return { body: sessionDetail(result.session), status: 200, persist: true };
}

/** @param {any} state @param {HttpEnv} env @param {Date} now @param {boolean} regenerate */
async function shareCommand(state, env, now, regenerate) { return { body: await createCoachShare(state, env, now, regenerate), status: regenerate ? 201 : 201, persist: true }; }

/** @param {any} state @param {URL} url @param {Date} now @param {HttpEnv} env */
async function listPrivateSessions(state, url, now, env) {
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const status = url.searchParams.get("status"); const exerciseKey = url.searchParams.get("exercise_key");
  const rawLimit = url.searchParams.get("limit"); const limit = rawLimit === null ? 50 : Number(rawLimit);
  if ((from && !to) || (!from && to) || (from && !isValidLocalDate(from)) || (to && !isValidLocalDate(to)) || (from && to && from > to)) return jsonError("invalid_period", "from and to must be valid inclusive local dates", [], 400);
  if (from && to && (dateSpan(from, to) ?? Infinity) > 3660) return jsonError("invalid_period", "The selected period cannot exceed 3660 days", [], 400);
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 200)) return jsonError("invalid_request", "limit must be an integer between 1 and 200", [], 400);
  if (status && !["in_progress", "completed", "partial", "skipped"].includes(status)) return jsonError("invalid_request", "status is unsupported", [], 400);
  const filters = JSON.stringify({ from, to, status, exercise_key: exerciseKey, limit });
  let sessions = /** @type {any[]} */ (state.sessions).filter((session) => (!from || session.scheduled_date >= from) && (!to || session.scheduled_date <= to) && (!status || session.status === status) && (!exerciseKey || /** @type {any[]} */ (session.snapshot.blocks).some((block) => /** @type {any[]} */ (block.exercises).some((exercise) => exercise.exercise_key === exerciseKey)))).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || b.session_key.localeCompare(a.session_key));
  const cursorSecret = authCursorSecret(env);
  if (!cursorSecret) return jsonError("service_not_configured", "Private cursor signing is not configured", [], 503);
  const cursorContext = { secret: cursorSecret, domain: "private-sessions", subject: state.athlete_key };
  const hasCursor = url.searchParams.has("cursor");
  const cursor = url.searchParams.get("cursor");
  if (hasCursor && !cursor) return jsonError("invalid_cursor", "Cursor is malformed, expired, or does not match the filters", [], 400);
  if (cursor) {
    const value = await verifySignedCursor(cursor, cursorContext);
    const keys = value ? Object.keys(value).sort() : [];
    const expectedKeys = ["filters", "issued_at", "limit", "position", "resource", "training_version", "v"];
    if (!value || keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return jsonError("invalid_cursor", "Cursor is malformed, expired, or does not match the filters", [], 400);
    if (!Number.isInteger(value.training_version)) return jsonError("invalid_cursor", "Cursor is malformed, expired, or does not match the filters", [], 400);
    if (value.training_version !== state.training_version) return jsonError("training_version_changed", "Training data changed; restart from page one", [], 409);
    if (value.resource !== "sessions" || value.filters !== filters || value.limit !== limit || typeof value.issued_at !== "number" || !Number.isInteger(value.issued_at) || value.issued_at > now.getTime() || now.getTime() - value.issued_at > 15 * 60 * 1000 || !value.position || typeof value.position !== "object" || Array.isArray(value.position) || Object.keys(value.position).sort().join("|") !== "date|key" || typeof value.position.date !== "string" || !isValidLocalDate(value.position.date) || typeof value.position.key !== "string" || !value.position.key) return jsonError("invalid_cursor", "Cursor is malformed, expired, or does not match the filters", [], 400);
    sessions = sessions.filter((session) => session.scheduled_date < value.position.date || (session.scheduled_date === value.position.date && session.session_key < value.position.key));
  }
  const page = sessions.slice(0, limit); const last = page.at(-1); const next = sessions.length > limit && last ? await issueSignedCursor({ resource: "sessions", filters, limit, position: { date: last.scheduled_date, key: last.session_key }, issued_at: now.getTime(), training_version: state.training_version }, cursorContext) : null;
  return jsonResponse({ items: page.map(sessionSummary), page: { limit, next_cursor: next } });
}

/** @param {HttpEnv} env */
function authCursorSecret(env) {
  return validSessionSecret(env.AUTH_SESSION_SECRET) ? env.AUTH_SESSION_SECRET : env.LOCAL_AUTH === "true" ? "local-only-auth-session-cursor-secret" : "";
}

/** @param {any} state @param {Date} now */
function exportResponse(state, now) {
  const result = athleteExport(state, now); if (result.error) return jsonError(result.error.code, result.error.message, [], result.status); const date = localDate(now, state.timezone); return new Response(result.body, { status: 200, headers: { ...securityHeaders("application/json; charset=utf-8"), "Content-Disposition": `attachment; filename="workout-data-${date}.json"` } });
}

/** @param {Request} request @param {HttpEnv} env @param {Date} now */
async function authenticate(request, env, now) {
  const testEmail = request.headers.get("x-athlete-email") ?? request.headers.get("x-test-athlete-email");
  if (testEmail && env.LOCAL_AUTH === "true") return { email: normalizeEmail(testEmail) };
  const authorization = request.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  const token = bearer || readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  const claims = token ? await verifySessionToken(token, env, now) : null;
  if (!claims) return { error: { code: "unauthorized", message: "A valid application session is required", status: 401 } };
  return { email: claims.email };
}

/** @param {Request} request @param {HttpEnv} env @param {Date} now @param {LoginAttempts} loginAttempts */
async function authLogin(request, env, now, loginAttempts) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...securityHeaders("text/plain; charset=utf-8"), Allow: "POST" } });
  const browserGuard = loginRequestGuard(request, env);
  if (browserGuard) {
    emitSecurityEvent(env, "authentication_rejected", now, { surface: "login", reason: browserGuard.reason });
    return browserGuard.response;
  }
  if (!validSessionSecret(env.AUTH_SESSION_SECRET)) return jsonError("service_not_configured", "Authentication is not configured", [], 503);
  let body;
  let invalidJson = false;
  try { body = JSON.parse(await request.text()); } catch { invalidJson = true; }
  const candidateEmail = isRecord(body) && typeof body.email === "string" ? normalizeEmail(body.email) : "invalid";
  const hasCredentials = !invalidJson && isRecord(body) && Object.keys(body).length === 2 && typeof body.email === "string" && typeof body.password === "string";
  const identity = hasCredentials ? configuredAuthIdentity(body.email, env) : null;
  const suppliedDigest = await sha256Hex(hasCredentials ? body.password : `${env.AUTH_SESSION_SECRET}:invalid-request`);
  const expectedDigest = await sha256Hex(identity && typeof identity.password === "string" && identity.password ? identity.password : `${env.AUTH_SESSION_SECRET}:invalid-identity`);
  if (!identity || !constantTimeEqual(suppliedDigest, expectedDigest)) {
    const buckets = await loginRateLimitBuckets(candidateEmail, request, env.AUTH_SESSION_SECRET);
    const allowed = await loginAttemptAllowed(env, loginAttempts, buckets, now);
    if (!allowed) {
      emitSecurityEvent(env, "authentication_rejected", now, { surface: "login", reason: "rate_limited" });
      const response = jsonError("rate_limited", "Too many login attempts; try again later", [], 429);
      response.headers.set("Retry-After", String(loginWindowSeconds(env)));
      return response;
    }
    if (invalidJson) {
      emitSecurityEvent(env, "authentication_rejected", now, { surface: "login", reason: "invalid_request" });
      return jsonError("invalid_json", "Request body must be valid JSON", [], 400);
    }
    emitSecurityEvent(env, "authentication_rejected", now, { surface: "login", reason: "invalid_credentials" });
    return jsonError("invalid_credentials", "Email or password is incorrect", [], 401);
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const token = await createSessionToken(identity.email, issuedAt, env.AUTH_SESSION_SECRET);
  const response = jsonResponse({ authenticated: true });
  response.headers.set("Set-Cookie", sessionCookie(token, SESSION_TTL_SECONDS));
  return response;
}

/** @param {Request} request @param {HttpEnv} env @param {Date} now */
function authLogout(request, env, now) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...securityHeaders("text/plain; charset=utf-8"), Allow: "POST" } });
  const browserGuard = cookieMutationGuard(request, env);
  if (browserGuard) {
    emitSecurityEvent(env, "authentication_rejected", now, { surface: "browser_mutation", reason: browserGuard.reason });
    return browserGuard.response;
  }
  const response = jsonResponse({ logged_out: true });
  response.headers.set("Set-Cookie", sessionCookie("", 0));
  return response;
}

/** @param {string} email @param {HttpEnv} env */
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

/** @param {string} email @param {number} issuedAt @param {string} secret */
async function createSessionToken(email, issuedAt, secret) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ version: 1, email, issued_at: issuedAt, expires_at: issuedAt + SESSION_TTL_SECONDS })));
  return `${payload}.${await signHmac(payload, secret)}`;
}

/** @param {string} token @param {HttpEnv} env @param {Date} instant */
async function verifySessionToken(token, env, instant) {
  try {
    if (!validSessionSecret(env.AUTH_SESSION_SECRET)) return null;
    const [payload, signature] = token.split("."); if (!payload || !signature) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, decodePart(signature), new TextEncoder().encode(payload))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decodePart(payload))); const now = Math.floor(instant.getTime() / 1000);
    if (claims.version !== 1 || typeof claims.email !== "string" || !Number.isSafeInteger(claims.issued_at) || !Number.isSafeInteger(claims.expires_at) || claims.expires_at <= now || claims.issued_at > now + 60 || claims.expires_at - claims.issued_at !== SESSION_TTL_SECONDS) return null;
    const identity = configuredAuthIdentity(claims.email, env);
    return identity ? { email: identity.email } : null;
  } catch { return null; }
}

/** @param {string} value @param {string} secret */
async function signHmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

/** @param {string} value @param {string} secret */
async function hmacHex(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {unknown} secret */
function validSessionSecret(secret) {
  return typeof secret === "string" && secret.length >= 32;
}

/** @param {() => Date} clock */
function requestInstant(clock) {
  const value = clock();
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new TypeError("The request clock returned an invalid instant");
  return instant;
}

/** @param {HttpEnv} env @param {URL} requestUrl */
function configuredPublicOrigin(env, requestUrl) {
  try { return new URL(env.PUBLIC_ORIGIN || requestUrl.origin).origin; }
  catch { return requestUrl.origin; }
}

/** @param {string} candidateEmail @param {Request} request @param {string} secret */
async function loginRateLimitBuckets(candidateEmail, request, secret) {
  const clientAddress = request.headers.get("CF-Connecting-IP")?.trim() || "unknown-client";
  return {
    identity: await hmacHex(`identity\u0000${candidateEmail}`, secret),
    client: await hmacHex(`client\u0000${clientAddress}`, secret),
  };
}

/** @param {HttpEnv} env */
function loginWindowSeconds(env) {
  const value = Number(env.AUTH_LOGIN_WINDOW_SECONDS);
  return Number.isSafeInteger(value) && value >= 60 && value <= 24 * 60 * 60 ? value : DEFAULT_LOGIN_WINDOW_SECONDS;
}

/** @param {HttpEnv} env */
function loginAttemptLimit(env) {
  const value = Number(env.AUTH_LOGIN_LIMIT);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : DEFAULT_LOGIN_LIMIT;
}

/** @param {HttpEnv} env */
function loginClientAttemptLimit(env) {
  const value = Number(env.AUTH_LOGIN_CLIENT_LIMIT);
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000 ? value : DEFAULT_LOGIN_CLIENT_LIMIT;
}

/** @param {HttpEnv} env @param {LoginAttempts} attempts @param {{ identity: string, client: string }} buckets @param {Date} now */
async function loginAttemptAllowed(env, attempts, buckets, now) {
  const distributedClient = await distributedLimit(env.AUTH_LOGIN_CLIENT_RATE_LIMITER, buckets.client);
  if (!(distributedClient ?? fixedWindowAttempt(attempts, buckets.client, loginClientAttemptLimit(env), env, now))) return false;
  const distributedIdentity = await distributedLimit(env.AUTH_LOGIN_RATE_LIMITER, buckets.identity);
  return distributedIdentity ?? fixedWindowAttempt(attempts, buckets.identity, loginAttemptLimit(env), env, now);
}

/** @param {any} binding @param {string} key */
async function distributedLimit(binding, key) {
  if (!binding?.limit) return null;
  try { return (await binding.limit({ key }))?.success !== false; }
  catch { return null; }
}

/** @param {LoginAttempts} attempts @param {string} bucket @param {number} limit @param {HttpEnv} env @param {Date} now */
function fixedWindowAttempt(attempts, bucket, limit, env, now) {
  const resetAt = now.getTime() + loginWindowSeconds(env) * 1000;
  const previous = attempts.get(bucket);
  if (!previous && attempts.size >= MAX_LOGIN_BUCKETS) {
    for (const [key, value] of attempts) if (value.resetAt <= now.getTime()) attempts.delete(key);
    if (attempts.size >= MAX_LOGIN_BUCKETS) return false;
  }
  const current = !previous || previous.resetAt <= now.getTime() ? { count: 1, resetAt } : { count: previous.count + 1, resetAt: previous.resetAt };
  attempts.set(bucket, current);
  return current.count <= limit;
}

/** @param {Request} request @param {HttpEnv} env */
function cookieMutationGuard(request, env) {
  const localHeader = request.headers.get("x-athlete-email") ?? request.headers.get("x-test-athlete-email");
  if (env.LOCAL_AUTH === "true" && localHeader) return null;
  if (!readCookie(request.headers.get("Cookie"), SESSION_COOKIE)) return null;
  const suppliedOrigin = request.headers.get("Origin");
  let allowedOrigin;
  try { allowedOrigin = new URL(env.PUBLIC_ORIGIN || request.url).origin; }
  catch { allowedOrigin = new URL(request.url).origin; }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (suppliedOrigin !== allowedOrigin || (fetchSite && fetchSite !== "same-origin")) {
    return { reason: "origin_not_allowed", response: jsonError("origin_not_allowed", "Cookie-authenticated mutations require the application origin", [], 403) };
  }
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { reason: "json_content_type_required", response: jsonError("json_content_type_required", "Cookie-authenticated mutations require application/json", [], 415) };
  }
  return null;
}

/** @param {Request} request @param {HttpEnv} env */
function loginRequestGuard(request, env) {
  const allowedOrigin = configuredPublicOrigin(env, new URL(request.url));
  const suppliedOrigin = request.headers.get("Origin");
  let canonicalOrigin = null;
  try { canonicalOrigin = suppliedOrigin ? new URL(suppliedOrigin).origin : null; } catch {}
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (canonicalOrigin !== allowedOrigin || (fetchSite && fetchSite !== "same-origin")) {
    return { reason: "origin_not_allowed", response: jsonError("origin_not_allowed", "Login requires the application origin", [], 403) };
  }
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { reason: "json_content_type_required", response: jsonError("json_content_type_required", "Login requires application/json", [], 415) };
  }
  return null;
}

/** @param {unknown} value */
function safeReason(value) {
  return typeof value === "string" && /^[a-z0-9_]{1,80}$/.test(value) ? value : "rejected";
}

/** @param {HttpEnv} env @param {any} result @param {Date} now @param {string} surface */
function observeMutationResult(env, result, now, surface) {
  const code = result?.body?.error?.code;
  if (result?.status === 409 && code) emitSecurityEvent(env, "mutation_conflict", now, { surface, reason: safeReason(code) });
}

/** @param {HttpEnv} env @param {string} event @param {Date} now @param {Record<string, unknown>} details */
function emitSecurityEvent(env, event, now, details) {
  const record = { schema_version: 1, event, occurred_at: now.toISOString(), ...details };
  try {
    if (typeof env.SECURITY_EVENT_SINK === "function") env.SECURITY_EVENT_SINK(record);
    else if (env.SECURITY_EVENT_SINK?.emit) env.SECURITY_EVENT_SINK.emit(record);
    else console.info(JSON.stringify(record));
  } catch {
    // Security logging must never make authentication or mutation handling fail open.
  }
}

/** @param {unknown} value */
function normalizeConfiguredEmail(value) {
  return typeof value === "string" && value.includes("@") ? normalizeEmail(value) : null;
}

/** @param {string|null} header @param {string} name */
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim() || null;
  }
  return null;
}

/** @param {string} token @param {number} maxAge */
function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
/** @param {string} value */
function decodePart(value) { const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); const binary = atob(normalized); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }

/** @param {string} rawBody */
function parseJsonBody(rawBody) { try { return { value: JSON.parse(rawBody) }; } catch { return { body: errorBody("invalid_json", "Request body must be valid JSON", []), status: 400, persist: false, error: true }; } }
/** @param {any} result */
function responseFromResult(result) { return jsonResponse(result.body, result.status ?? 200); }
/** @param {unknown} body @param {number} [status] */
function jsonResponse(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: securityHeaders("application/json; charset=utf-8") }); }
/** @param {string} body @param {number} [status] */
function textResponse(body, status = 200) { return new Response(body, { status, headers: securityHeaders("text/plain; charset=utf-8") }); }
function publicNotFound() { return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") }); }
/** @param {string} code @param {string} message @param {any[]} [details] @param {number} [status] */
function jsonError(code, message, details = [], status = 400) { return jsonResponse(errorBody(code, message, details), status); }
/** @param {string} code @param {string} message @param {any[]} [details] @param {number} [status] @param {Date} [now] @param {string|null} [field] */
function coachJsonError(code, message, details = [], status = 400, now = new Date(), field = null) { const error = /** @type {{ code: string, message: string, details: any[], field?: string }} */ ({ code, message, details }); if (field) error.field = field; const response = jsonResponse({ schema_version: 1, generated_at: now.toISOString(), error }, status); if (status === 429) response.headers.set("Retry-After", "60"); return response; }
/** @param {HttpEnv} env @param {any} state @param {Date} now */
async function coachRateLimit(env, state, now) {
  if (!env.COACH_RATE_LIMITER?.limit) return null;
  try {
    const result = await env.COACH_RATE_LIMITER.limit({ key: state.coach_share.token_digest });
    return result?.success === false ? coachJsonError("rate_limited", "Coach Share request limit exceeded", [], 429, now) : null;
  } catch {
    return null;
  }
}
/** @param {string} code @param {string} message @param {any} details */
function errorBody(code, message, details) { return { error: { code, message, details } }; }
/** @param {string} code */
function errorStatus(code) { return ["not_found"].includes(code) ? 404 : ["unauthorized"].includes(code) ? 401 : ["forbidden"].includes(code) ? 403 : ["session_state_conflict", "idempotency_conflict", "package_digest_mismatch", "stale_plan", "timezone_revision_boundary", "training_version_changed"].includes(code) ? 409 : ["export_capacity_exceeded"].includes(code) ? 503 : 400; }
/** @param {string} contentType @param {string} [csp] */
function securityHeaders(contentType, csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'") { return { "Content-Type": contentType, "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Content-Security-Policy": csp, "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" }; }
/** @param {Response} response @param {Request} request */
function maybeHead(response, request) { return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response; }

const FALLBACK_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workout Tracker</title><style>body{font-family:system-ui;background:#f6f1e8;color:#26231f;margin:0}main{max-width:760px;margin:auto;padding:36px 22px}nav{display:flex;gap:16px;border-top:1px solid #e6ddd0;padding-top:20px;margin-top:40px}a{color:#a8432c}</style></head><body><main id="app"><p>WORKOUT TRACKER</p><h1>你的训练，今天就从这里开始。</h1><p>在线、移动优先的训练计划与 Session 记录。</p><nav aria-label="主导航"><a href="/app">今日</a><a href="/app#plan">计划</a><a href="/app#progress">进展</a><a href="/app#coach">教练</a><a href="/app#settings">设置</a></nav></main></body></html>`;
