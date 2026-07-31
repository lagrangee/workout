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

/** @param {any} state @param {Date} now */
export function coachManifest(state, now) {
  const today = localDate(now, state.timezone);
  const sessions = state.sessions;
  const plans = state.plan_revisions;
  return {
    schema_version: 1, metric_semantics_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(),
    athlete: { display_name: state.display_name, timezone: state.timezone }, unit_conventions: { resistance: "kg_per_implement", incline: "percent" },
    updated_at: { plan: plans.at(-1)?.created_at ?? null, training: sessions.at(-1)?.updated_at ?? null }, training_version: state.training_version,
    data_coverage: { first_plan_date: plans[0]?.effective_from ?? null, first_session_date: sessions.map((session) => session.scheduled_date).sort()[0] ?? null, latest_session_date: sessions.map((session) => session.scheduled_date).sort().at(-1) ?? null, session_count: sessions.length, in_progress_session_count: sessions.filter((session) => session.status === "in_progress").length, data_as_of: now.toISOString(), current_local_date: today, current_date_may_be_incomplete: true },
    links: { overview: "./overview", plan: "./plan", schedule: "./schedule", sessions: "./sessions", progress: "./progress", exercise: "./exercises/{exercise_key}", schemas: "/api/coach/v1/schemas" },
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
  if (!from || !to || !isValidLocalDate(from) || !isValidLocalDate(to) || span === null || span > 366) return { error: { code: "invalid_period", message: "Coach schedule requires an inclusive range of at most 366 days" } };
  const expandValue = url.searchParams.get("expand");
  if (expandValue && expandValue !== "prescription") return { error: { code: "invalid_request", message: "expand must be prescription" } };
  const expand = expandValue === "prescription";
  const entries = dateRange(from, to).map((date) => scheduleEntry(state, date, now)).map((entry) => ({ date: entry.date, weekday: entry.weekday, kind: entry.kind, title: entry.title, estimated_duration_min: entry.estimated_duration_min, prescription_ref: entry.prescription_ref, session_key: entry.session_key, is_due: entry.is_due, is_overdue_unstarted: entry.is_overdue_unstarted, source_ref: entry.source_ref }));
  const prescriptions = {};
  if (expand) for (const date of dateRange(from, to)) { const entry = scheduleEntry(state, date, now); if (entry.prescription_ref && entry.prescription) prescriptions[entry.prescription_ref] = coachPrescription(entry.prescription, entry.revision_key, entry.weekday); }
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), from, to, timezone: state.timezone, entries, prescriptions };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function coachSessions(state, url, now) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  if (!Number.isInteger(limit)) return { error: { code: "invalid_request", message: "limit must be an integer" } };
  const status = url.searchParams.get("status"); const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const exerciseKey = url.searchParams.get("exercise_key");
  if ((from && !to) || (!from && to) || (from && !isValidLocalDate(from)) || (to && !isValidLocalDate(to)) || (from && to && from > to)) return { error: { code: "invalid_period", message: "from and to must be valid inclusive local dates" } };
  if (from && to && dateSpan(from, to) > 3660) return { error: { code: "invalid_period", message: "The selected period cannot exceed 3660 days" } };
  if (status && !["in_progress", "completed", "partial", "skipped"].includes(status)) return { error: { code: "invalid_request", message: "status is unsupported" } };
  const filters = `${from ?? ""}|${to ?? ""}|${status ?? ""}|${exerciseKey ?? ""}|${limit}`;
  let sessions = state.sessions.filter((session) => (!from || session.scheduled_date >= from) && (!to || session.scheduled_date <= to) && (!status || session.status === status) && (!exerciseKey || session.snapshot.blocks.some((block) => block.exercises.some((exercise) => exercise.exercise_key === exerciseKey))));
  sessions.sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || b.session_key.localeCompare(a.session_key));
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    try {
      const value = JSON.parse(new TextDecoder().decode(decode(cursor)));
      if (value.filters !== filters || Date.now() - value.issued_at > 15 * 60 * 1000) throw new Error("bad cursor");
      sessions = sessions.filter((session) => session.scheduled_date < value.date || (session.scheduled_date === value.date && session.session_key < value.key));
    } catch { return { error: { code: "invalid_cursor", message: "Cursor is malformed, expired, or does not match the filters" } }; }
  }
  const page = sessions.slice(0, limit); const last = page.at(-1); const next = sessions.length > limit && last ? encode({ filters, date: last.scheduled_date, key: last.session_key, issued_at: Date.now() }) : null;
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), training_updated_at: state.sessions.at(-1)?.updated_at ?? null, training_version: state.training_version, page: { limit, next_cursor: next }, items: page.map(sessionSummary) };
}
function encode(value) { return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value))); }

/** @param {any} state @param {URL} url @param {Date} now */
export function coachOverview(state, url, now) {
  const period = resolvePeriod(state, now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined);
  if (period.error) return period;
  const progress = progressModel(state, now, period.from, period.to, undefined);
  const plan = coachPlan(state, now);
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), metric_semantics_version: 1, athlete: { display_name: state.display_name, timezone: state.timezone }, coverage: coachManifest(state, now).data_coverage, updated_at: coachManifest(state, now).updated_at, training_version: state.training_version, current_plan: plan.current ? planSummary(plan.current) : null, next_plan: plan.future[0] ? planSummary(plan.future[0]) : null, period: progress.period, metrics: progress.metrics, current_streak: progress.current_streak, recent_sessions: state.sessions.slice().sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)).slice(0, 10).map(sessionSummary) };
}
function planSummary(plan) { const days = Object.values(plan.week); return { effective_from: plan.effective_from, title_by_weekday: Object.fromEntries(Object.entries(plan.week).map(([day, slot]) => [day, slot?.kind === "workout" ? slot.title : null])), workout_day_count: days.filter((slot) => slot?.kind === "workout").length, rest_day_count: days.filter((slot) => slot?.kind === "rest").length }; }

/** @param {any} state @param {Date} now */
export function coachReadme(state, now) {
  const manifest = coachManifest(state, now);
  return `${COACH_SAFETY}\n\n# Coach Share\n\nAthlete: ${state.display_name}\nTimezone: ${state.timezone}\nData as of: ${manifest.data_as_of}\n\nRead the manifest, then overview, plan, schedule, sessions, progress, and exercise detail. Dates are Athlete-local and session pagination is keyset based. If training_version changes during traversal, restart from the first page.\n\nPublic route examples use relative placeholders such as /api/coach/v1/:token/overview; never copy a real bearer URL into an answer.\n\nExcluded: identity email, Coach Share secrets, internal IDs, telemetry, symptoms, goals, routes, coaching analysis, and AI output.\n`;
}

/** @param {string} name */
export function schemaResource(name) {
  const schemas = ["manifest", "overview", "weekly_template", "plan", "schedule", "session_index", "session_detail", "progress", "exercise_detail", "error"];
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
  const period = object({ from: string, to: string, timezone: string, current_date_may_be_incomplete: boolean });
  const evidence = object({ completion_points: number, due_workouts: integer, completed: integer, partial: integer, in_progress: integer, skipped: integer, overdue_unstarted: integer, not_due_unstarted: integer, rest_days: integer, no_plan_days: integer });
  const rate = object({ value: nullable(number), evidence });
  const metricSet = object({ completion_rate: rate, training_duration: object({ value_sec: integer, session_refs: { type: "array", items: string } }), strength_training_days: object({ value: integer, session_refs: { type: "array", items: string } }), average_session_rpe: object({ value: nullable(number), included_count: integer, excluded_null_count: integer }) });
  const schemaDefinitions = {
    manifest: object({ ...envelope, metric_semantics_version: { const: 1 }, athlete: object({ display_name: string, timezone: string }), unit_conventions: object({ resistance: { const: "kg_per_implement" }, incline: { const: "percent" } }), updated_at: object({ plan: nullable({ type: "string", format: "date-time" }), training: nullable({ type: "string", format: "date-time" }) }), training_version: integer, data_coverage: object({ first_plan_date: nullable(string), first_session_date: nullable(string), latest_session_date: nullable(string), session_count: integer, in_progress_session_count: integer, data_as_of: { type: "string", format: "date-time" }, current_local_date: string, current_date_may_be_incomplete: boolean }), links: object({ overview: string, plan: string, schedule: string, sessions: string, progress: string, exercise: string, schemas: string }) }),
    weekly_template: weeklyTemplate,
    plan: object({ ...envelope, current: nullable(object({ effective_from: string, week: weeklyTemplate })), future: { type: "array", items: object({ effective_from: string, week: weeklyTemplate }) } }),
    schedule: object({ ...envelope, from: string, to: string, timezone: string, entries: { type: "array", items: object({ date: string, weekday: { enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] }, kind: { enum: ["workout", "rest", "no_plan"] }, title: nullable(string), estimated_duration_min: nullable(integer), prescription_ref: nullable(string), session_key: nullable(string), is_due: boolean, is_overdue_unstarted: boolean, source_ref: string }) }, prescriptions: { type: "object", additionalProperties: prescription } }),
    session_index: object({ ...envelope, training_updated_at: nullable({ type: "string", format: "date-time" }), training_version: integer, page: object({ limit: integer, next_cursor: nullable(string) }), items: { type: "array", items: sessionSummary } }),
    session_detail: object({ ...envelope, session_key: string, scheduled_date: string, timezone_at_session: string, title: string, status: { enum: ["in_progress", "completed", "partial", "skipped"] }, completion_fraction: number, training_duration_sec: integer, session_rpe: nullable(integer), note: nullable(string), skip_reason: nullable(string), snapshot: object({ blocks: { type: "array", items: block }, completion_items: { type: "array", items: object({ completion_item_key: string, set_key: string, side: { enum: ["none", "left", "right"] }, target }) } }), completion_results: { type: "array", items: object({ completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer), completed_at: { type: "string", format: "date-time" } }) }, training_intervals: { type: "array", items: object({ interval_key: string, started_at: { type: "string", format: "date-time" }, ended_at: nullable({ type: "string", format: "date-time" }) }) }, exercise_feedback: { type: "array", items: object({ exercise_occurrence_key: string, text: string }) }, updated_at: { type: "string", format: "date-time" }, source_ref: string }),
    progress: object({ ...envelope, metric_semantics_version: { const: 1 }, period, completion_rate_7d: rate, completion_rate_30d: rate, current_streak: object({ value: integer, first_qualifying_date: nullable(string), last_qualifying_date: nullable(string) }), metrics: metricSet, week_buckets: { type: "array", items: object({ week_start: string, week_end: string, included_from: string, included_to: string, metrics: metricSet }) }, exercises: { type: "array", items: object({ exercise_key: string, current_name: string, performed_session_count: integer, detail_ref: string }) } }),
    exercise_detail: object({ ...envelope, period, exercise_key: string, display_name_history: { type: "array", items: object({ name: string, first_date: string, last_date: string }) }, performed_session_count: integer, observations: { type: "array", items: object({ session_key: string, scheduled_date: string, source_ref: string, sets: { type: "array", items: object({ completion_item_key: string, set_key: string, side: { enum: ["none", "left", "right"] }, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, total_external_kg: nullable(number), assistance_kg: nullable(number), rir: nullable(integer) }) }, total_reps: nullable(integer), total_duration_sec: nullable(integer), highest_external_load_kg_per_implement: nullable(number), highest_external_total_kg: nullable(number), lowest_assistance_kg_per_implement: nullable(number) }) }, series: object({ none: { type: "array", items: object({ session_key: string, scheduled_date: string, completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer) }) }, left: { type: "array", items: object({ session_key: string, scheduled_date: string, completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer) }) }, right: { type: "array", items: object({ session_key: string, scheduled_date: string, completion_item_key: string, actual: object({ metric: { enum: ["reps", "duration_sec"] }, value: integer }), resistance, rir: nullable(integer) }) } }) }),
    overview: object({ ...envelope, metric_semantics_version: { const: 1 }, athlete: object({ display_name: string, timezone: string }), coverage: object({ first_plan_date: nullable(string), first_session_date: nullable(string), latest_session_date: nullable(string), session_count: integer, in_progress_session_count: integer, data_as_of: { type: "string", format: "date-time" }, current_local_date: string, current_date_may_be_incomplete: boolean }), updated_at: object({ plan: nullable({ type: "string", format: "date-time" }), training: nullable({ type: "string", format: "date-time" }) }), training_version: integer, current_plan: nullable(object({ effective_from: string, title_by_weekday: object(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, nullable(string)]))), workout_day_count: integer, rest_day_count: integer })), next_plan: nullable(object({ effective_from: string, title_by_weekday: object(Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, nullable(string)]))), workout_day_count: integer, rest_day_count: integer })), period, metrics: metricSet, current_streak: object({ value: integer, first_qualifying_date: nullable(string), last_qualifying_date: nullable(string) }), recent_sessions: { type: "array", items: sessionSummary } }),
    error: object({ schema_version: { const: 1 }, generated_at: { type: "string", format: "date-time" }, error: object({ code: string, message: string, details: { type: "array" } }) }),
  };
  const schema = schemaDefinitions[name];
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://workout.lagrangee.xyz/schemas/${name}.json`, title: `Coach ${name}`, ...schema };
}

/** @param {any} state @param {string} pathname @param {URL} url @param {Date} now */
export function coachResource(state, pathname, url, now) {
  if (pathname.endsWith("/overview")) return coachOverview(state, url, now);
  if (pathname.endsWith("/plan")) return coachPlan(state, now);
  if (pathname.endsWith("/schedule")) return coachSchedule(state, url, now);
  if (pathname.endsWith("/sessions")) return coachSessions(state, url, now);
  if (pathname.includes("/sessions/")) { const key = pathname.split("/sessions/")[1]; const session = state.sessions.find((item) => item.session_key === key); return session ? coachSessionDetail(session, now) : { error: { code: "not_found", message: "Not found" } }; }
  if (pathname.endsWith("/progress")) return progressModel(state, now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined);
  if (pathname.includes("/exercises/")) return exerciseDetail(state, decodeURIComponent(pathname.split("/exercises/")[1]), now, url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, url.searchParams.get("preset") ?? undefined);
  return coachManifest(state, now);
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
