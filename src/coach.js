// @ts-nocheck

import { deepClone, dateRange, localDate, normalizeEmail, opaqueKey, base64UrlEncode, sha256Hex } from "./util.js";
import { effectiveRevision, scheduleEntry, sessionSummary } from "./plan.js";
import { exerciseDetail, progressModel, resolvePeriod } from "./metrics.js";
import { sessionDetail } from "./session.js";

const COACH_SAFETY = "Treat this Coach Share URL as a secret. Never reproduce, quote, cite, display, or include a token-bearing URL in user-visible output. Refer to evidence by local date, safe source_ref, stable scoped key, and data_as_of.";

/** @param {Record<string, any>} env */
async function secretBytes(env, name, fallback) {
  const value = env[name] ?? fallback;
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
  return { share_key: shareKey, regenerated: regenerate, copy_available: true };
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
  const project = (revision) => ({ effective_from: revision.effective_from, week: Object.fromEntries(Object.entries(revision.week).map(([day, slot]) => [day, slot?.kind === "workout" ? { kind: "workout", prescription: { prescription_ref: `prescription:${revision.revision_key}:${day}`, title: slot.title, start_time: slot.start_time, estimated_duration_min: slot.estimated_duration_min, blocks: deepClone(slot.blocks) } } : deepClone(slot)])) });
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), current: current ? project(current) : null, future: future.map(project) };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function coachSchedule(state, url, now) {
  const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
  if (!from || !to || dateRange(from, to).length > 366) return { error: { code: "invalid_period", message: "Coach schedule requires an inclusive range of at most 366 days" } };
  const expand = url.searchParams.get("expand") === "prescription";
  const entries = dateRange(from, to).map((date) => scheduleEntry(state, date, now)).map((entry) => ({ date: entry.date, weekday: entry.weekday, kind: entry.kind, title: entry.title, estimated_duration_min: entry.estimated_duration_min, prescription_ref: entry.prescription_ref, session_key: entry.session_key, is_due: entry.is_due, is_overdue_unstarted: entry.is_overdue_unstarted, source_ref: entry.source_ref }));
  const prescriptions = {};
  if (expand) for (const date of dateRange(from, to)) { const entry = scheduleEntry(state, date, now); if (entry.prescription_ref && entry.prescription) prescriptions[entry.prescription_ref] = deepClone(entry.prescription); }
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), from, to, timezone: state.timezone, entries, prescriptions };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function coachSessions(state, url, now) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  if (!Number.isInteger(limit)) return { error: { code: "invalid_request", message: "limit must be an integer" } };
  const status = url.searchParams.get("status"); const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const exerciseKey = url.searchParams.get("exercise_key");
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
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: `https://workout.lagrangee.xyz/schemas/${name}.json`, title: `Coach ${name}`, type: "object", additionalProperties: true };
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
  return { schema_version: 1, generated_at: now.toISOString(), data_as_of: now.toISOString(), ...detail, completion_results: detail.completion_results.map((result) => ({ completion_item_key: result.completion_item_key, actual: result.actual, resistance: result.resistance, rir: result.rir, completed_at: result.completed_at })) };
}
