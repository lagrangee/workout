// @ts-nocheck

import { deepClone, dateRange, dateSpan, isValidLocalDate, localDate, opaqueKey, base64UrlEncode } from "./util.js";
import { effectiveRevision, scheduleEntry, sessionSummary } from "./plan.js";
import { exerciseDetail, progressModel, resolvePeriod } from "./metrics.js";
import { sessionDetail } from "./session.js";

const COACH_SAFETY = "Treat this Coach Share URL as a secret. Never reproduce, quote, cite, display, or include a token-bearing URL in user-visible output. Refer to evidence by local date, safe source_ref, stable scoped key, and data_as_of.";

/** @param {Record<string, any>} env */
async function secretBytes(env, name, fallback) {
  const value = env[name] ?? (env.LOCAL_AUTH === "true" ? fallback : null);
  if (!value) throw new Error(`Missing required secret ${name}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/** @param {string} token @param {Record<string, any>} env */
export async function tokenDigest(token, env) {
  const key = await secretBytes(env, "COACH_LOOKUP_SECRET", "local-only-change-me");
  const cryptoKey = await globalThis.crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await globalThis.crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} token @param {Record<string, any>} env @param {string} athleteKey @param {string} shareKey */
async function encryptToken(token, env, athleteKey, shareKey) {
  const keyBytes = await secretBytes(env, "COACH_ENCRYPTION_SECRET", "local-only-encryption-change-me");
  const key = await globalThis.crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const nonce = new Uint8Array(12); globalThis.crypto.getRandomValues(nonce);
  const aad = new TextEncoder().encode(`${athleteKey}:${shareKey}:1`);
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, new TextEncoder().encode(token));
  return { ciphertext: base64UrlEncode(new Uint8Array(ciphertext)), nonce: base64UrlEncode(nonce), aad: base64UrlEncode(aad), lookup_key_version: 1, encryption_key_version: 1 };
}

/** @param {any} share @param {Record<string, any>} env @param {string} athleteKey */
async function decryptToken(share, env, athleteKey) {
  const keyBytes = await secretBytes(env, "COACH_ENCRYPTION_SECRET", "local-only-encryption-change-me");
  const key = await globalThis.crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const bytes = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(share.nonce), additionalData: decode(share.aad) }, key, decode(share.ciphertext));
  return new TextDecoder().decode(bytes);
}
function decode(value) { const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }

/** @param {any} state @param {Record<string, any>} env @param {Date} now */
export async function createCoachShare(state, env, now, regenerate = false) {
  const tokenBytes = new Uint8Array(32); globalThis.crypto.getRandomValues(tokenBytes);
  const token = base64UrlEncode(tokenBytes);
  const shareKey = opaqueKey("share");
  const encrypted = await encryptToken(token, env, state.athlete_key, shareKey);
  state.coach_share = { share_key: shareKey, token_digest: await tokenDigest(token, env), ...encrypted, created_at: now.toISOString(), revoked_at: null };
  state.training_version += 1;
  return { share_key: shareKey, created_at: state.coach_share.created_at, regenerated: regenerate, copy_available: true };
}

/** @param {any} state @param {Record<string, any>} env */
export async function authenticatedCoachUrl(state, env) {
  if (!state.coach_share || state.coach_share.revoked_at) return { error: { code: "not_found", message: "Coach Share not found" } };
  const token = await decryptToken(state.coach_share, env, state.athlete_key);
  const origin = env.PUBLIC_ORIGIN ?? "https://workout.lagrangee.xyz";
  return { url: `${origin}/coach/${token}`, share_key: state.coach_share.share_key };
}

/** @param {any[]} states @param {string} token @param {Record<string, any>} env */
export async function findShare(states, token, env) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const digest = await tokenDigest(token, env);
  return states.find((state) => state.coach_share && !state.coach_share.revoked_at && state.coach_share.token_digest === digest) ?? null;
}

/** @param {any} store @param {string} token @param {Record<string, any>} env */
export async function findShareInStore(store, token, env) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const digest = await tokenDigest(token, env);
  if (typeof store.findByCoachDigest === "function") return store.findByCoachDigest(digest);
  return (await store.all()).find((state) => state.coach_share && !state.coach_share.revoked_at && state.coach_share.token_digest === digest) ?? null;
}

/** @param {any} state @param {Date} now @param {string|undefined} origin @param {string|undefined} token */
export function coachManifest(state, now, origin, token) {
  const today = localDate(now, state.timezone);
  const sessions = state.sessions;
  const plans = state.plan_revisions;
  const apiBaseUrl = origin && token ? `${origin}/api/coach/v1/${token}` : null;
  const schemaCatalogUrl = origin ? `${origin}/api/coach/v1/schemas` : "/api/coach/v1/schemas";
  return {
    schema_version: 1, metric_semantics_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(),
    athlete: { display_name: state.display_name, timezone: state.timezone }, timezone: state.timezone, unit_conventions: { resistance: "kg_per_implement", incline: "percent" },
    updated_at: { plan: plans.at(-1)?.created_at ?? null, training: sessions.at(-1)?.updated_at ?? null }, training_version: state.training_version,
    data_coverage: { first_plan_date: plans[0]?.effective_from ?? null, first_session_date: sessions.map((session) => session.scheduled_date).sort()[0] ?? null, latest_session_date: sessions.map((session) => session.scheduled_date).sort().at(-1) ?? null, session_count: sessions.length, in_progress_session_count: sessions.filter((session) => session.status === "in_progress").length, data_as_of: now.toISOString(), current_local_date: today, current_date_may_be_incomplete: true },
    api_base_url: apiBaseUrl,
    manifest_url: apiBaseUrl,
    schema_catalog_url: schemaCatalogUrl,
    query_rules: { timezone: state.timezone, date_format: "YYYY-MM-DD", date_ranges_inclusive: true, from_to_must_be_together: true, from_to_conflicts_with_preset_or_range: true, max_days: { schedule: 366, sessions: 3660, progress: 3660, exercise: 3660 } },
    links: { overview: apiBaseUrl ? `${apiBaseUrl}/overview` : "./overview", plan: apiBaseUrl ? `${apiBaseUrl}/plan` : "./plan", schedule: apiBaseUrl ? `${apiBaseUrl}/schedule` : "./schedule", sessions: apiBaseUrl ? `${apiBaseUrl}/sessions` : "./sessions", progress: apiBaseUrl ? `${apiBaseUrl}/progress` : "./progress", exercise: apiBaseUrl ? `${apiBaseUrl}/exercises/{exercise_key}` : "./exercises/{exercise_key}", schemas: schemaCatalogUrl },
    endpoints: coachEndpointCatalog(apiBaseUrl, schemaCatalogUrl),
  };
}

function dateParameter(description, required = false) { return { location: "query", type: "date", format: "YYYY-MM-DD", required, description }; }
function coachEndpointCatalog(apiBaseUrl, schemaCatalogUrl) {
  const base = apiBaseUrl ?? "/api/coach/v1/:token";
  const dateWindow = {
    from: dateParameter("Inclusive Athlete-local start date; must be supplied with to", false),
    to: dateParameter("Inclusive Athlete-local end date; must be supplied with from", false),
  };
  const periodSelector = (defaultValue = "30d") => ({
    preset: { location: "query", type: "string", enum: ["7d", "30d", "12w", "all"], default: defaultValue, description: "Named inclusive period; mutually exclusive with from/to and range" },
    range: { location: "query", type: "string", enum: ["7d", "30d", "12w", "all"], description: "Alias for preset; mutually exclusive with preset and from/to" },
  });
  return {
    manifest: { method: "GET", path: base, parameters: {}, response_schema: "manifest" },
    overview: { method: "GET", path: `${base}/overview`, parameters: { ...dateWindow, ...periodSelector("30d") }, response_schema: "overview" },
    plan: { method: "GET", path: `${base}/plan`, parameters: {}, response_schema: "plan" },
    schedule: { method: "GET", path: `${base}/schedule`, parameters: { from: { ...dateWindow.from, required: true }, to: { ...dateWindow.to, required: true }, expand: { location: "query", type: "string", enum: ["prescription"], description: "Include deduplicated prescription bodies" } }, rules: { max_days: 366, date_window_required: true }, response_schema: "schedule" },
    sessions: { method: "GET", path: `${base}/sessions`, parameters: { ...dateWindow, limit: { location: "query", type: "integer", minimum: 1, maximum: 200, default: 50 }, cursor: { location: "query", type: "string", format: "opaque", description: "Use page.next_cursor unchanged" }, status: { location: "query", type: "string", enum: ["in_progress", "completed", "partial", "skipped"] }, exercise_key: { location: "query", type: "string" } }, rules: { max_days: 3660, date_window_optional: true }, response_schema: "session_index" },
    session_detail: { method: "GET", path: `${base}/sessions/{session_key}`, parameters: { session_key: { location: "path", type: "string", required: true } }, response_schema: "session_detail" },
    progress: { method: "GET", path: `${base}/progress`, parameters: { ...dateWindow, ...periodSelector("30d"), bucket: { location: "query", type: "string", enum: ["day", "week", "month"], default: "week" } }, rules: { max_days: 3660, date_window_optional: true }, response_schema: "progress" },
    exercise_history: { method: "GET", path: `${base}/exercises/{exercise_key}`, parameters: { exercise_key: { location: "path", type: "string", required: true }, ...dateWindow, ...periodSelector("12w") }, rules: { max_days: 3660, date_window_optional: true }, response_schema: "exercise_detail" },
    schemas: { method: "GET", path: schemaCatalogUrl, parameters: {}, response_schema: "schema_catalog" },
  };
}

/** @param {any} state @param {Date} now */
export function coachPlan(state, now) {
  const current = effectiveRevision(state, localDate(now, state.timezone));
  const future = state.plan_revisions.filter((revision) => revision.effective_from > localDate(now, state.timezone) && effectiveRevision(state, revision.effective_from)?.revision_key === revision.revision_key).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const project = (revision) => ({ effective_from: revision.effective_from, week: Object.fromEntries(Object.entries(revision.week).map(([day, slot]) => [day, slot?.kind === "workout" ? { kind: "workout", prescription: coachPrescription(slot, revision.revision_key, day) } : deepClone(slot)])) });
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), current: current ? project(current) : null, future: future.map(project) };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function coachSchedule(state, url, now) {
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
  const span = from && to ? dateSpan(from, to) : null;
  if (!from || !to || !isValidLocalDate(from) || !isValidLocalDate(to) || from > to || span === null || span > 366) return { error: { code: "invalid_period", field: !from ? "from" : !to ? "to" : !isValidLocalDate(from) ? "from" : "to", message: "Coach schedule requires an inclusive range of at most 366 days" } };
  const expandValue = url.searchParams.get("expand");
  if (expandValue && expandValue !== "prescription") return { error: { code: "invalid_request", field: "expand", message: "expand must be prescription" } };
  const expand = expandValue === "prescription";
  const entries = dateRange(from, to).map((date) => scheduleEntry(state, date, now)).map((entry) => ({ date: entry.date, weekday: entry.weekday, kind: entry.kind, title: entry.title, estimated_duration_min: entry.estimated_duration_min, prescription_ref: entry.prescription_ref, session_key: entry.session_key, is_due: entry.is_due, is_overdue_unstarted: entry.is_overdue_unstarted, source_ref: entry.source_ref }));
  const prescriptions = {};
  if (expand) for (const date of dateRange(from, to)) { const entry = scheduleEntry(state, date, now); if (entry.prescription_ref && entry.prescription) prescriptions[entry.prescription_ref] = coachPrescription(entry.prescription, entry.revision_key, entry.weekday); }
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), from, to, timezone: state.timezone, period: coachPeriodContext(from, to, state.timezone, now), entries, prescriptions };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function coachSessions(state, url, now) {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 200)) return { error: { code: "invalid_request", field: "limit", message: "limit must be an integer between 1 and 200" } };
  const status = url.searchParams.get("status"); const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const exerciseKey = url.searchParams.get("exercise_key");
  const hasFrom = from !== null; const hasTo = to !== null;
  if (hasFrom !== hasTo || (hasFrom && !isValidLocalDate(from)) || (hasTo && !isValidLocalDate(to)) || (hasFrom && hasTo && from > to)) return { error: { code: "invalid_period", field: hasFrom ? "to" : "from", message: "from and to must be valid inclusive local dates" } };
  if (from && to && (dateSpan(from, to) ?? Infinity) > 3660) return { error: { code: "invalid_period", field: "to", message: "The selected period cannot exceed 3660 days" } };
  if (status && !["in_progress", "completed", "partial", "skipped"].includes(status)) return { error: { code: "invalid_request", field: "status", message: "status is unsupported" } };
  const filters = `${from ?? ""}|${to ?? ""}|${status ?? ""}|${exerciseKey ?? ""}|${limit}`;
  let sessions = state.sessions.filter((session) => (!from || session.scheduled_date >= from) && (!to || session.scheduled_date <= to) && (!status || session.status === status) && (!exerciseKey || session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_key === exerciseKey))));
  sessions.sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || b.session_key.localeCompare(a.session_key));
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    try {
      const value = JSON.parse(new TextDecoder().decode(decode(cursor)));
      if (value.filters !== filters || typeof value.issued_at !== "number" || !Number.isFinite(value.issued_at) || value.issued_at > Date.now() || Date.now() - value.issued_at > 15 * 60 * 1000 || typeof value.date !== "string" || !isValidLocalDate(value.date) || typeof value.key !== "string" || !value.key) throw new Error("bad cursor");
      sessions = sessions.filter((session) => session.scheduled_date < value.date || (session.scheduled_date === value.date && session.session_key < value.key));
    } catch { return { error: { code: "invalid_cursor", field: "cursor", message: "Cursor is malformed, expired, or does not match the filters" } }; }
  }
  const page = sessions.slice(0, limit); const last = page.at(-1); const next = sessions.length > limit && last ? encode({ filters, date: last.scheduled_date, key: last.session_key, issued_at: Date.now() }) : null;
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), training_updated_at: state.sessions.at(-1)?.updated_at ?? null, training_version: state.training_version, period: from && to ? coachPeriodContext(from, to, state.timezone, now) : { from: null, to: null, timezone: state.timezone, includes_from: false, includes_to: false, includes_current_date: false, current_date_may_be_incomplete: false }, page: { limit, next_cursor: next }, items: page.map(sessionSummary) };
}
function encode(value) { return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value))); }

/** @param {any} state @param {URL} url @param {Date} now */
export function coachOverview(state, url, now) {
  const from = url.searchParams.get("from") ?? undefined; const to = url.searchParams.get("to") ?? undefined; const preset = url.searchParams.get("preset") ?? undefined; const range = url.searchParams.get("range") ?? undefined;
  const period = resolvePeriod(state, now, from, to, preset, range);
  if (period.error) return period;
  const progress = progressModel(state, now, period.from, period.to, undefined, "week");
  const plan = coachPlan(state, now);
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), metric_semantics_version: 1, athlete: { display_name: state.display_name, timezone: state.timezone }, coverage: coachManifest(state, now).data_coverage, updated_at: coachManifest(state, now).updated_at, training_version: state.training_version, current_plan: plan.current ? planSummary(plan.current) : null, next_plan: plan.future[0] ? planSummary(plan.future[0]) : null, period: progress.period, metrics: progress.metrics, current_streak: progress.current_streak, recent_sessions: state.sessions.slice().sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)).slice(0, 10).map(sessionSummary) };
}
function planSummary(plan) { const days = Object.values(plan.week); return { effective_from: plan.effective_from, title_by_weekday: Object.fromEntries(Object.entries(plan.week).map(([day, slot]) => [day, slot?.kind === "workout" ? slot.title : null])), workout_day_count: days.filter((slot) => slot?.kind === "workout").length, rest_day_count: days.filter((slot) => slot?.kind === "rest").length }; }

function coachPeriodContext(from, to, timezone, now) {
  const currentDate = localDate(now, timezone);
  const includesCurrentDate = from <= currentDate && currentDate <= to;
  return { from, to, timezone, includes_from: true, includes_to: true, includes_current_date: includesCurrentDate, current_date_may_be_incomplete: includesCurrentDate };
}

/** @param {any} state @param {Date} now @param {string|undefined} origin @param {string|undefined} token */
export function coachReadme(state, now, origin, token) {
  const manifest = coachManifest(state, now, origin, token);
  return `${COACH_SAFETY}

# Coach Share API v1

This is a permanent, read-only data interface for a ChatGPT Coach Agent. It contains the Athlete's plan, scheduled workouts, completed training records, and computed progress. It never creates recommendations, coaching analysis, or plan updates.

Athlete: ${state.display_name}
Timezone: ${state.timezone}
Data as of: ${manifest.data_as_of}

API Base URL: ${manifest.api_base_url ?? "not available in this rendering"}
Manifest URL: ${manifest.manifest_url ?? "not available in this rendering"}
Schema catalog URL: ${manifest.schema_catalog_url}

## Start here

1. Extract the bearer token from the share URL internally. Never print, quote, cite, or return that URL or token.
2. Fetch the manifest at the API Base URL above. It is the machine-readable source of truth for endpoint paths, parameters, defaults, enums, limits, and response schema names.
3. Fetch the schema catalog at the Schema catalog URL above, then fetch the exact JSON Schemas before interpreting unfamiliar fields.
4. Read "/overview" for a compact recent context, then fetch "/plan", the relevant "/schedule", "/progress", and paginated "/sessions" only when needed.
5. Fetch "/sessions/:session_key" or "/exercises/:exercise_key" for detail. Cite only "source_ref", local dates, and stable scoped keys.

## Resource catalog

All resource routes are GET-only (HEAD is also supported). Use the absolute URLs in the manifest; do not construct or return a token-bearing URL from memory.

- GET /api/coach/v1/:token — manifest, links, coverage, timezone, units, and "training_version".
- GET /api/coach/v1/:token/overview?from=&to=&preset=&range= — current/next plan summaries, selected-period metrics, streak, and up to 10 recent sessions. Default preset=30d.
- GET /api/coach/v1/:token/plan — current plan plus future effective weekly templates. A workout day is { kind: "workout", prescription: ... }; a rest day is { kind: "rest" }; an empty slot is null.
- GET /api/coach/v1/:token/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD[&expand=prescription] — inclusive local-date schedule. "from" and "to" are required; range is at most 366 days. Expanded prescriptions are deduplicated by "prescription_ref".
- GET /api/coach/v1/:token/sessions?limit=&cursor=&from=&to=&status=&exercise_key= — newest-first session index. "limit" defaults to 50 and is capped at 200. Filters "from"/"to" must be supplied together.
- GET /api/coach/v1/:token/sessions/:session_key — immutable plan snapshot, completion items/results, intervals, RPE, note, skip reason, and Exercise Feedback.
- GET /api/coach/v1/:token/progress?preset=&range=&bucket=week — metrics and evidence. Default preset=30d; use either a preset/range or an inclusive "from"/"to" range. bucket is day, week, or month; each bucket reports from, to, is_partial, and metrics.
- GET /api/coach/v1/:token/exercises/:exercise_key?preset=&range= — display-name history, per-session observations, and none/left/right series. Default preset=12w.

## Query examples

This README exposes an absolute URL so an Agent can copy the origin and token-bearing path from the current share. For example:

- This week's schedule: ${manifest.api_base_url ?? "<BASE_URL>"}/schedule?from=2026-07-27&to=2026-08-02
- Recent six-week trend: ${manifest.api_base_url ?? "<BASE_URL>"}/progress?from=2026-06-20&to=2026-07-31&bucket=week
- Exercise history: ${manifest.api_base_url ?? "<BASE_URL>"}/exercises/pull_up?from=2026-05-01&to=2026-07-31

The dates above are illustrative. Construct other inclusive YYYY-MM-DD windows directly; do not assume the example dates are the current date.

## Response shape

Normal JSON responses contain schema_version: 1, generated_at, and data_as_of. Metric responses also contain metric_semantics_version: 1. Dates are Athlete-local YYYY-MM-DD and all date arithmetic uses ${state.timezone}; instants are UTC RFC 3339 strings; quantities are JSON numbers; known missing values are explicit null.

The manifest contains api_base_url, manifest_url, schema_catalog_url, an endpoint catalog, query rules, athlete { display_name, timezone }, unit_conventions, updated_at, data_coverage, training_version, and links. Schedule entries contain date, weekday, kind, nullable workout fields, prescription_ref, nullable session_key, is_due, is_overdue_unstarted, and source_ref.

Every date-window response includes period { from, to, timezone, includes_from, includes_to, includes_current_date, current_date_may_be_incomplete }. A period containing the Athlete's current local date sets current_date_may_be_incomplete to true; treat that date as still open. Empty result sets are valid and use empty arrays with a valid period.

Session index responses contain page { limit, next_cursor }, an optional period context, and items. Session detail contains snapshot { blocks, completion_items }, completion_results, training_intervals, and exercise_feedback. Progress contains period, bucket, buckets, legacy week_buckets, metrics, current_streak, and exercises; each metric includes evidence or contributing session_refs where applicable.

## Schema discovery

GET /api/coach/v1/schemas lists token-free JSON Schema Draft 2020-12 resources. Fetch individual schemas from /api/coach/v1/schemas/{name} before relying on exact required fields. Available names are: manifest, overview, weekly_template, plan, schedule, session_index, session_detail, progress, exercise_detail, error, and schema_catalog. Schema documents contain no Athlete data.

## Pagination and consistency

Session cursors are opaque, bound to their filters and limit, and expire after 15 minutes. Traverse until page.next_cursor is null. Every page exposes training_version; if it changes during traversal, restart from the first page. This API does not promise a cross-page snapshot.

## Errors and privacy

Errors use { schema_version, generated_at, error: { code, message, details, field } }. Invalid dates, range conflicts, buckets, filters, limits, or cursors return 400; unknown, malformed, revoked, or regenerated tokens return indistinguishable 404s; unsupported methods return 405; throttling returns 429 with Retry-After: 60. Errors are never encoded as HTTP 200 responses.

The interface excludes login email, Cloudflare identity, internal database IDs, token fields, ciphertext, digests, visitor data, goals, routes, symptoms, telemetry, and coaching analysis. Responses use Cache-Control: private, no-store, X-Robots-Tag: noindex, and Referrer-Policy: no-referrer.
`;
}

/** @param {string} name */
export function schemaResource(name) {
  const schemas = ["manifest", "overview", "weekly_template", "plan", "schedule", "session_index", "session_detail", "progress", "exercise_detail", "error", "schema_catalog"];
  if (!schemas.includes(name)) return null;
  const string = { type: "string" };
  const integer = { type: "integer" };
  const number = { type: "number" };
  const boolean = { type: "boolean" };
  const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
  const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
  const envelope = { schema_version: { const: 1 }, generated_at: { type: "string", format: "date-time" }, data_as_of: { type: "string", format: "date-time" } };
  const target = object({ metric: { enum: ["reps", "duration_sec"] }, min: integer, max: integer });
  const resistance = nullable(object({ mode: { enum: ["bodyweight", "external_weight", "assisted_weight"] }, load_kg: nullable(number), quantity: nullable(integer) }));
  const set = object({ set_key: string, target, resistance, target_rir: nullable(integer), target_rpe: nullable(number), tempo: nullable(object({ eccentric_sec: nullable(integer), bottom_hold_sec: nullable(integer), concentric_sec: nullable(integer), top_hold_sec: nullable(integer) })), rest_after_sec: nullable(integer), target_incline_percent: nullable(number) });
  const block = object({ block_key: string, title: string, exercises: { type: "array", items: object({ exercise_occurrence_key: string, exercise_key: string, name: string, category: { enum: ["strength", "endurance", "mobility", "recovery"] }, side_mode: { enum: ["none", "left_right"] }, sets: { type: "array", items: set } }) } });
  const prescription = object({ prescription_ref: string, title: string, start_time: nullable(string), estimated_duration_min: integer, blocks: { type: "array", items: block } });
  const weekSlot = { anyOf: [{ type: "null" }, object({ kind: { const: "rest" } }), object({ kind: { const: "workout" }, prescription })] };
  const weeklyTemplate = object(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, weekSlot])));
  const sessionSummary = object({ session_key: string, scheduled_date: string, title: string, status: { enum: ["in_progress", "completed", "partial", "skipped"] }, completion_fraction: number, training_duration_sec: integer, session_rpe: nullable(integer), exercise_keys: { type: "array", items: string }, updated_at: { type: "string", format: "date-time" }, source_ref: string });
  const period = object({ from: string, to: string, timezone: string, includes_from: boolean, includes_to: boolean, includes_current_date: boolean, current_date_may_be_incomplete: boolean });
  const sessionPeriod = object({ from: nullable(string), to: nullable(string), timezone: string, includes_from: boolean, includes_to: boolean, includes_current_date: boolean, current_date_may_be_incomplete: boolean });
  const evidence = object({ completion_points: number, due_workouts: integer, completed: integer, partial: integer, in_progress: integer, skipped: integer, overdue_unstarted: integer, not_due_unstarted: integer, rest_days: integer, no_plan_days: integer });
  const rate = object({ value: nullable(number), evidence });
  const metricSet = object({ completion_rate: rate, training_duration: object({ value_sec: integer, session_refs: { type: "array", items: string } }), strength_training_days: object({ value: integer, session_refs: { type: "array", items: string } }), average_session_rpe: object({ value: nullable(number), included_count: integer, excluded_null_count: integer }) });
  const endpoint = object({ method: { const: "GET" }, path: string, parameters: { type: "object", additionalProperties: true }, rules: nullable({ type: "object", additionalProperties: true }), response_schema: string }, ["method", "path", "parameters", "response_schema"]);
  const schemaDefinitions = {
    manifest: object({ ...envelope, metric_semantics_version: { const: 1 }, athlete: object({ display_name: string, timezone: string }), timezone: string, unit_conventions: object({ resistance: { const: "kg_per_implement" }, incline: { const: "percent" } }), updated_at: object({ plan: nullable({ type: "string", format: "date-time" }), training: nullable({ type: "string", format: "date-time" }) }), training_version: integer, api_base_url: nullable(string), manifest_url: nullable(string), schema_catalog_url: string, query_rules: { type: "object", additionalProperties: true }, data_coverage: object({ first_plan_date: nullable(string), first_session_date: nullable(string), latest_session_date: nullable(string), session_count: integer, in_progress_session_count: integer, data_as_of: { type: "string", format: "date-time" }, current_local_date: string, current_date_may_be_incomplete: boolean }), links: object({ overview: string, plan: string, schedule: string, sessions: string, progress: string, exercise: string, schemas: string }), endpoints: { type: "object", additionalProperties: endpoint } }),
    weekly_template: weeklyTemplate,
    plan: object({ ...envelope, current: nullable(object({ effective_from: string, week: weeklyTemplate })), future: { type: "array", items: object({ effective_from: string, week: weeklyTemplate }) } }),
    schedule: object({ ...envelope, from: string, to: string, timezone: string, period, entries: { type: "array", items: object({ date: string, weekday: { enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] }, kind: { enum: ["workout", "rest", "no_plan"] }, title: nullable(string), estimated_duration_min: nullable(integer), prescription_ref: nullable(string), session_key: nullable(string), is_due: boolean, is_overdue_unstarted: boolean, source_ref: string }) }, prescriptions: { type: "object", additionalProperties: prescription } }),
    session_index: object({ ...envelope, training_updated_at: nullable({ type: "string", format: "date-time" }), training_version: integer, period: sessionPeriod, page: object({ limit: integer, next_cursor: nullable(string) }), items: { type: "array", items: sessionSummary } }),
    session_detail: object({ ...envelope, session_key: string, scheduled_date: string, timezone_at_session: string, title: string, status: { enum: ["in_progress", "completed", "partial", "skipped"] }, completion_fraction: number, training_duration_sec: integer, session_rpe: nullable(integer), note: nullable(string), skip_reason: nullable(string), snapshot: object({ blocks: { type: "array", items: block }, completion_items: { type: "array", items: object({ completion_item_key: string, set_key: string, side: { enum: ["none", "left", "right"] }, target }) } }), completion_results: { type: "array", items: object({ completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer), completed_at: { type: "string", format: "date-time" } }) }, training_intervals: { type: "array", items: object({ interval_key: string, started_at: { type: "string", format: "date-time" }, ended_at: nullable({ type: "string", format: "date-time" }) }) }, exercise_feedback: { type: "array", items: object({ exercise_occurrence_key: string, text: string }) }, updated_at: { type: "string", format: "date-time" }, source_ref: string }),
    progress: object({ ...envelope, metric_semantics_version: { const: 1 }, period, completion_rate_7d: rate, completion_rate_30d: rate, current_streak: object({ value: integer, first_qualifying_date: nullable(string), last_qualifying_date: nullable(string) }), metrics: metricSet, bucket: { enum: ["day", "week", "month"] }, buckets: { type: "array", items: object({ from: string, to: string, is_partial: boolean, week_start: nullable(string), week_end: nullable(string), included_from: nullable(string), included_to: nullable(string), month_start: nullable(string), month_end: nullable(string), metrics: metricSet }, ["from", "to", "is_partial", "metrics"]) }, week_buckets: { type: "array", items: object({ week_start: string, week_end: string, included_from: string, included_to: string, is_partial: boolean, metrics: metricSet }) }, exercises: { type: "array", items: object({ exercise_key: string, current_name: string, performed_session_count: integer, detail_ref: string }) } }),
    exercise_detail: object({ ...envelope, period, exercise_key: string, display_name_history: { type: "array", items: object({ name: string, first_date: string, last_date: string }) }, performed_session_count: integer, observations: { type: "array", items: object({ session_key: string, scheduled_date: string, source_ref: string, sets: { type: "array", items: object({ completion_item_key: string, set_key: string, side: { enum: ["none", "left", "right"] }, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, total_external_kg: nullable(number), assistance_kg: nullable(number), rir: nullable(integer) }) }, total_reps: nullable(integer), total_duration_sec: nullable(integer), highest_external_load_kg_per_implement: nullable(number), highest_external_total_kg: nullable(number), lowest_assistance_kg_per_implement: nullable(number) }) }, series: object({ none: { type: "array", items: object({ session_key: string, scheduled_date: string, completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer) }) }, left: { type: "array", items: object({ session_key: string, scheduled_date: string, completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer) }) }, right: { type: "array", items: object({ session_key: string, scheduled_date: string, completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer) }) } }) }),
    overview: object({ ...envelope, metric_semantics_version: { const: 1 }, athlete: object({ display_name: string, timezone: string }), coverage: object({ first_plan_date: nullable(string), first_session_date: nullable(string), latest_session_date: nullable(string), session_count: integer, in_progress_session_count: integer, data_as_of: { type: "string", format: "date-time" }, current_local_date: string, current_date_may_be_incomplete: boolean }), updated_at: object({ plan: nullable({ type: "string", format: "date-time" }), training: nullable({ type: "string", format: "date-time" }) }), training_version: integer, current_plan: nullable(object({ effective_from: string, title_by_weekday: object(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, nullable(string)]))), workout_day_count: integer, rest_day_count: integer })), next_plan: nullable(object({ effective_from: string, title_by_weekday: object(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, nullable(string)]))), workout_day_count: integer, rest_day_count: integer })), period, metrics: metricSet, current_streak: object({ value: integer, first_qualifying_date: nullable(string), last_qualifying_date: nullable(string) }), recent_sessions: { type: "array", items: sessionSummary } }),
    error: object({ schema_version: { const: 1 }, generated_at: { type: "string", format: "date-time" }, error: object({ code: string, message: string, details: { type: "array" }, field: nullable(string) }, ["code", "message", "details"]) }),
    schema_catalog: object({ schema_version: { const: 1 }, generated_at: { type: "string", format: "date-time" }, schemas: { type: "array", items: object({ name: string, href: string, json_schema_draft: { const: "2020-12" } }) } }),
  };
  const schema = schemaDefinitions[name];
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://workout.lagrangee.xyz/schemas/${name}.json`, title: `Coach ${name}`, ...schema };
}

/** @param {any} state @param {string} pathname @param {URL} url @param {Date} now @param {string} token */
export function coachResource(state, pathname, url, now, token) {
  if (pathname.endsWith("/overview")) return coachOverview(state, url, now, token);
  if (pathname.endsWith("/plan")) return coachPlan(state, now);
  if (pathname.endsWith("/schedule")) return coachSchedule(state, url, now);
  if (pathname.endsWith("/sessions")) return coachSessions(state, url, now);
  if (pathname.includes("/sessions/")) { const key = pathname.split("/sessions/")[1]; const session = state.sessions.find((item) => item.session_key === key); return session ? coachSessionDetail(session, now) : { error: { code: "not_found", message: "Not found" } }; }
  if (pathname.endsWith("/progress")) return progressModel(state, now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined, url.searchParams.get("bucket") ?? "week", url.searchParams.get("range") ?? undefined);
  if (pathname.includes("/exercises/")) return exerciseDetail(state, decodeURIComponent(pathname.split("/exercises/")[1]), now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined, url.searchParams.get("range") ?? undefined);
  return { error: { code: "not_found", message: "Not found" } };
}

/** @param {any} session @param {Date} now */
function coachSessionDetail(session, now) {
  const detail = sessionDetail(session);
  const snapshot = { ...detail.snapshot, exercise_occurrence_keys: undefined, blocks: detail.snapshot.blocks.map((block) => ({ ...block, exercises: block.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map(({ set_key, target, resistance, target_rir, target_rpe, tempo, rest_after_sec, target_incline_percent }) => ({ set_key, target, resistance, target_rir, target_rpe, tempo, rest_after_sec, target_incline_percent })) })) })), completion_items: detail.snapshot.completion_items.map(({ completion_item_key, set_key, side, target }) => ({ completion_item_key, set_key, side, target })) };
  delete snapshot.exercise_occurrence_keys;
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), session_key: detail.session_key, scheduled_date: detail.scheduled_date, timezone_at_session: detail.timezone_at_session, title: detail.title, status: detail.status, completion_fraction: detail.completion_fraction, training_duration_sec: detail.training_duration_sec, session_rpe: detail.session_rpe, note: detail.note, skip_reason: detail.skip_reason, snapshot, completion_results: detail.completion_results.map((result) => ({ completion_item_key: result.completion_item_key, actual: result.actual, resistance: result.resistance, rir: result.rir, completed_at: result.completed_at })), training_intervals: detail.training_intervals, exercise_feedback: detail.exercise_feedback, updated_at: detail.updated_at, source_ref: detail.source_ref };
}

function coachPrescription(slot, revisionKey, weekday) {
  return { prescription_ref: `prescription:${revisionKey}:${weekday}`, title: slot.title, start_time: slot.start_time, estimated_duration_min: slot.estimated_duration_min, blocks: slot.blocks.map((block, blockIndex) => ({ block_key: `cb_${revisionKey}_${weekday}_${blockIndex + 1}`, title: block.title, exercises: block.exercises.map((exercise, exerciseIndex) => ({ exercise_occurrence_key: `ce_${revisionKey}_${weekday}_${blockIndex + 1}_${exerciseIndex + 1}`, exercise_key: exercise.exercise_key, name: exercise.name, category: exercise.category, side_mode: exercise.side_mode, sets: exercise.sets.map((set, setIndex) => ({ set_key: `cs_${revisionKey}_${weekday}_${blockIndex + 1}_${exerciseIndex + 1}_${setIndex + 1}`, ...deepClone(set) })) })) })) };
}
