// @ts-nocheck

import { WEEKDAYS, base64UrlDecode, base64UrlEncode, canonicalJson, deepClone, dateRange, dateSpan, isRecord, isValidLocalDate, localDate, sha256Hex } from "./util.js";
import { appendPlanRevision, planUpdateBase, scheduleEntry, validatePlanForState } from "./plan.js";
import { coachOverview, coachResource, prescriptionProjection } from "./coach.js";
import { parseStrictJson, validatePlanPackage } from "./validation.js";
import { AGENT_ARCHIVE_LIMIT, agentAerobicActivities, agentAerobicActivityDetail, agentDailyContext, agentRouteDetail, agentRouteHistory, agentRoutes, agentSchemaCatalog, agentSchemaResource } from "./agent-archive-api.js";
import { syncAerobicProjection } from "./training-archive-projection.js";
import { PLAN_UPDATE_BATCH_MAX_BYTES, appendPlanUpdateBatch, parsePlanUpdateBatch, planUpdateBatchDigests, validatePlanUpdateBatchForState } from "./plan-update-batch.js";

const AGENT_PREFIX = "/api/agent/v1";

/** @param {any} state @param {Date} now */
export function agentManifest(state, now) {
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    athlete: { display_name: state.display_name, timezone: state.timezone },
    timezone: state.timezone,
    schema_catalog_url: `${AGENT_PREFIX}/schemas`,
    unit_conventions: { resistance: "kg_per_implement", incline: "percent" },
    updated_at: {
      plan: state.plan_revisions.at(-1)?.created_at ?? null,
      training: state.sessions.at(-1)?.updated_at ?? null,
    },
    training_version: state.training_version,
    query_rules: {
      timezone: state.timezone,
      date_format: "YYYY-MM-DD",
      date_ranges_inclusive: true,
      overview: { default_period: "30d", selectors: ["preset", "range"], values: ["7d", "30d", "12w", "all"], from_to_must_be_together: true, preset_range_mutually_exclusive: true, from_to_conflicts_with_selector: true, max_days: 3660 },
      schedule_range_required: true,
      sessions_date_range_optional: true,
      progress_date_range_optional: true,
      exercise_date_range_optional: true,
      aerobic_activity_date_range_optional: true,
      aerobic_activity_limit: { minimum: 1, maximum: AGENT_ARCHIVE_LIMIT, default: 50 },
      route_limit: { minimum: 1, maximum: AGENT_ARCHIVE_LIMIT, default: 50 },
      archive_cursor_ttl_minutes: 15,
      archive_cursor_bound_to: ["resource", "from", "to", "sport_type", "route_key", "limit", "training_version"],
      max_days: { schedule: 366, sessions: 3660, progress: 3660, exercise: 3660 },
      archive_max_days: 3660,
    },
    links: {
      overview: `${AGENT_PREFIX}/overview`,
      plan: `${AGENT_PREFIX}/plan`,
      schedule: `${AGENT_PREFIX}/schedule`,
      sessions: `${AGENT_PREFIX}/sessions`,
      progress: `${AGENT_PREFIX}/progress`,
      exercise: `${AGENT_PREFIX}/exercises/{exercise_id}`,
      plan_update_validate: `${AGENT_PREFIX}/plan-updates/validate`,
      plan_update_apply: `${AGENT_PREFIX}/plan-updates/apply`,
      plan_update_batch_validate: `${AGENT_PREFIX}/plan-update-batches/validate`,
      plan_update_batch_apply: `${AGENT_PREFIX}/plan-update-batches/apply`,
      aerobic_sync: `${AGENT_PREFIX}/aerobic/sync`,
      schemas: `${AGENT_PREFIX}/schemas`,
      aerobic_activities: `${AGENT_PREFIX}/aerobic/activities`,
      aerobic_activity: `${AGENT_PREFIX}/aerobic/activities/{activity_ref}`,
      activity_index: `${AGENT_PREFIX}/aerobic/activities`,
      activity_detail: `${AGENT_PREFIX}/aerobic/activities/{activity_ref}`,
      daily_context: `${AGENT_PREFIX}/daily/{local_date}`,
      daily: `${AGENT_PREFIX}/daily/{local_date}`,
      routes: `${AGENT_PREFIX}/routes`,
      route: `${AGENT_PREFIX}/routes/{route_key}`,
      route_index: `${AGENT_PREFIX}/routes`,
      route_detail: `${AGENT_PREFIX}/routes/{route_key}`,
      route_history: `${AGENT_PREFIX}/routes/{route_key}/history`,
    },
    endpoints: {
      overview: { method: "GET", path: `${AGENT_PREFIX}/overview`, parameters: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", preset: ["7d", "30d", "12w", "all"], range: ["7d", "30d", "12w", "all"] } },
      plan: { method: "GET", path: `${AGENT_PREFIX}/plan`, parameters: {} },
      schedule: { method: "GET", path: `${AGENT_PREFIX}/schedule`, parameters: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", expand: ["prescription"] }, rules: { from_to_required: true, max_days: 366 } },
      sessions: { method: "GET", path: `${AGENT_PREFIX}/sessions`, parameters: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", limit: { type: "integer", minimum: 1, maximum: 200, default: 50 }, cursor: { type: "string", format: "opaque" }, status: ["in_progress", "completed", "partial", "skipped"], exercise_id: "string", exercise_key: { type: "string", deprecated: true } }, rules: { max_days: 3660, date_window_optional: true, cursor_ttl_minutes: 15 } },
      session_detail: { method: "GET", path: `${AGENT_PREFIX}/sessions/{session_key}`, parameters: { session_key: { type: "string", location: "path" } } },
      progress: { method: "GET", path: `${AGENT_PREFIX}/progress`, parameters: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", preset: ["7d", "30d", "12w", "all"], range: ["7d", "30d", "12w", "all"], bucket: ["day", "week", "month"] }, rules: { max_days: 3660, date_window_optional: true } },
      exercise_history: { method: "GET", path: `${AGENT_PREFIX}/exercises/{exercise_id}`, parameters: { exercise_id: { type: "string", location: "path" }, from: "YYYY-MM-DD", to: "YYYY-MM-DD", preset: ["7d", "30d", "12w", "all"], range: ["7d", "30d", "12w", "all"] }, rules: { max_days: 3660, date_window_optional: true } },
      schemas: { method: "GET", path: `${AGENT_PREFIX}/schemas`, parameters: {}, rules: { token_authenticated: true } },
      aerobic_activities: { method: "GET", path: `${AGENT_PREFIX}/aerobic/activities`, parameters: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", sport_type: [100, 101, 102, 104, 200], route_key: "string", limit: { type: "integer", minimum: 1, maximum: AGENT_ARCHIVE_LIMIT, default: 50 }, cursor: { type: "string", format: "opaque" } }, rules: { max_days: 3660, date_window_optional: true, cursor_ttl_minutes: 15, response_schema: "aerobic_activity_index" } },
      aerobic_activity: { method: "GET", path: `${AGENT_PREFIX}/aerobic/activities/{activity_ref}`, parameters: { activity_ref: { type: "string", location: "path" } }, rules: { explicit_single_activity_lookup: true, response_schema: "aerobic_activity_detail" } },
      daily_context: { method: "GET", path: `${AGENT_PREFIX}/daily/{local_date}`, parameters: { local_date: { type: "string", format: "date", location: "path" } }, rules: { exact_one_local_date: true, response_schema: "daily_context" } },
      routes: { method: "GET", path: `${AGENT_PREFIX}/routes`, parameters: { sport_type: [100, 101, 102, 104, 200], route_key: "string", limit: { type: "integer", minimum: 1, maximum: AGENT_ARCHIVE_LIMIT, default: 50 }, cursor: { type: "string", format: "opaque" } }, rules: { cursor_ttl_minutes: 15, response_schema: "route_index" } },
      route_detail: { method: "GET", path: `${AGENT_PREFIX}/routes/{route_key}`, parameters: { route_key: { type: "string", location: "path" }, from: "YYYY-MM-DD", to: "YYYY-MM-DD", limit: { type: "integer", minimum: 1, maximum: AGENT_ARCHIVE_LIMIT, default: 50 }, cursor: { type: "string", format: "opaque" } }, rules: { max_days: 3660, response_schema: "route_detail" } },
      route_history: { method: "GET", path: `${AGENT_PREFIX}/routes/{route_key}/history`, parameters: { route_key: { type: "string", location: "path" }, from: "YYYY-MM-DD", to: "YYYY-MM-DD", limit: { type: "integer", minimum: 1, maximum: AGENT_ARCHIVE_LIMIT, default: 50 }, cursor: { type: "string", format: "opaque" } }, rules: { max_days: 3660, response_schema: "route_history" } },
      plan_update_validate: { method: "POST", path: `${AGENT_PREFIX}/plan-updates/validate`, parameters: { package_text: { type: "string", content: "Plan Update Package v2 JSON" } }, rules: { mutates: false, strict_package: true } },
      plan_update_apply: { method: "POST", path: `${AGENT_PREFIX}/plan-updates/apply`, parameters: { package_text: { type: "string", content: "Plan Update Package v2 JSON" }, package_digest: { type: "string", format: "sha256" }, base_plan_digest: { type: "string", format: "sha256" }, confirmed: { type: "boolean", const: true }, idempotency_key: { type: "string", location: "header", name: "Idempotency-Key" } }, rules: { mutates: true, requires_confirmation: true, idempotent: true, idempotency_window_hours: 24, strict_package: true } },
      plan_update_batch_validate: { method: "POST", path: `${AGENT_PREFIX}/plan-update-batches/validate`, parameters: { batch_text: { type: "string", content: "Plan Update Batch v1 JSON" } }, rules: { mutates: false, strict_batch: true, minimum_updates: 2, maximum_updates: 4 } },
      plan_update_batch_apply: { method: "POST", path: `${AGENT_PREFIX}/plan-update-batches/apply`, parameters: { batch_text: { type: "string", content: "Plan Update Batch v1 JSON" }, batch_digest: { type: "string", format: "sha256" }, base_plan_digest: { type: "string", format: "sha256" }, confirmed: { type: "boolean", const: true }, idempotency_key: { type: "string", location: "header", name: "Idempotency-Key" } }, rules: { mutates: true, requires_confirmation: true, idempotent: true, idempotency_window_hours: 24, strict_batch: true, atomic: true } },
      aerobic_sync: { method: "POST", path: `${AGENT_PREFIX}/aerobic/sync`, parameters: { projection: { type: "object", content: "AerobicProjectionV1" }, idempotency_key: { type: "string", location: "header", name: "Idempotency-Key" } }, rules: { mutates: true, idempotent: true, idempotency_window_hours: 24, strict_projection: true, excludes_raw_fit_gps: true } },
    },
  };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function agentOverview(state, url, now) {
  return { ...coachOverview(state, url, now), source_ref: "overview" };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
export async function agentValidatePlanUpdate(state, rawBody, now) {
  const parsed = parseAgentJson(rawBody);
  if (!parsed.ok) return parsed.error;
  const body = parsed.value;
  if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.package_text !== "string") return { error: { code: "invalid_request", message: "package_text is required and must be a string" } };
  const result = validatePlanForState(state, body.package_text, now);
  if (!result.ok) return { error: { code: "invalid_plan_package", message: "The plan package needs repair", details: result.errors } };
  const basePlan = planUpdateBaseEvidence(state, result.value);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    training_version: state.training_version,
    source_ref: "plan-update:validation",
    valid: true,
    package_digest: await sha256Hex(canonicalJson(result.value)),
    base_plan_digest: await sha256Hex(canonicalJson(basePlan)),
    base_plan: basePlan,
    preview: { ...result.preview, source_ref: "plan-update:preview" },
  };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
export async function agentApplyPlanUpdate(state, rawBody, now) {
  const parsed = parseAgentJson(rawBody);
  if (!parsed.ok) return parsed.error;
  const body = parsed.value;
  if (!isRecord(body) || Object.keys(body).length !== 4 || typeof body.package_text !== "string" || !isSha256(body.package_digest) || !isSha256(body.base_plan_digest) || body.confirmed !== true) {
    return { error: { code: body?.confirmed !== true ? "confirmation_required" : "invalid_request", message: body?.confirmed !== true ? "confirmed must be true" : "package_text, package_digest, base_plan_digest, and confirmed are required" } };
  }
  const packageResult = validatePlanPackage(body.package_text, localDate(now, state.timezone));
  if (!packageResult.ok) return { error: { code: "invalid_plan_package", message: "The plan package needs repair", details: packageResult.errors } };
  const packageDigest = await sha256Hex(canonicalJson(packageResult.value));
  if (packageDigest !== body.package_digest) return { error: { code: "package_digest_mismatch", message: "package_digest does not match package_text" } };
  const basePlan = planUpdateBaseEvidence(state, packageResult.value);
  const basePlanDigest = await sha256Hex(canonicalJson(basePlan));
  if (basePlanDigest !== body.base_plan_digest) return { error: { code: "stale_plan", message: "The Current Plan changed after this proposal was validated" } };
  const result = validatePlanForState(state, body.package_text, now);
  if (!result.ok) return { error: { code: "invalid_plan_package", message: "The plan package needs repair", details: result.errors } };
  appendPlanRevision(state, result.value, now);
  state.training_version += 1;
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    training_version: state.training_version,
    source_ref: "plan-update:application",
    applied: true,
    effective_from: result.value.effective_from,
    package_digest: packageDigest,
    base_plan_digest: basePlanDigest,
    preview: { ...result.preview, source_ref: "plan-update:preview" },
  };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
export async function agentValidatePlanUpdateBatch(state, rawBody, now) {
  const parsed = parseAgentJson(rawBody, PLAN_UPDATE_BATCH_MAX_BYTES + 64 * 1024);
  if (!parsed.ok) return parsed.error;
  const body = parsed.value;
  if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.batch_text !== "string") return { error: { code: "invalid_request", message: "batch_text is required and must be a string" } };
  const result = validatePlanUpdateBatchForState(state, body.batch_text, now);
  if (!result.ok) return { error: { code: "invalid_plan_batch", message: "The plan update batch needs repair", details: result.errors } };
  const evidence = await planUpdateBatchDigests(state, result.value, now);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    training_version: state.training_version,
    source_ref: "plan-update-batch:validation",
    valid: true,
    ...evidence,
    preview: result.preview,
  };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
export async function agentApplyPlanUpdateBatch(state, rawBody, now) {
  const parsed = parseAgentJson(rawBody, PLAN_UPDATE_BATCH_MAX_BYTES + 64 * 1024);
  if (!parsed.ok) return parsed.error;
  const body = parsed.value;
  if (!isRecord(body) || Object.keys(body).length !== 4 || typeof body.batch_text !== "string" || !isSha256(body.batch_digest) || !isSha256(body.base_plan_digest) || body.confirmed !== true) {
    return { error: { code: body?.confirmed !== true ? "confirmation_required" : "invalid_request", message: body?.confirmed !== true ? "confirmed must be true" : "batch_text, batch_digest, base_plan_digest, and confirmed are required" } };
  }
  const batchResult = parsePlanUpdateBatch(body.batch_text, now, state.timezone);
  if (!batchResult.ok) return { error: { code: "invalid_plan_batch", message: "The plan update batch needs repair", details: batchResult.errors } };
  const evidence = await planUpdateBatchDigests(state, batchResult.value, now);
  if (evidence.batch_digest !== body.batch_digest) return { error: { code: "package_digest_mismatch", message: "batch_digest does not match batch_text" } };
  if (evidence.base_plan_digest !== body.base_plan_digest) return { error: { code: "stale_plan", message: "The Current Plan changed after this batch was validated" } };
  const result = validatePlanUpdateBatchForState(state, body.batch_text, now);
  if (!result.ok) return { error: { code: "invalid_plan_batch", message: "The plan update batch needs repair", details: result.errors } };
  appendPlanUpdateBatch(state, result.value, now);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    training_version: state.training_version,
    source_ref: "plan-update-batch:application",
    applied: true,
    from: result.preview.from,
    to: result.preview.to,
    update_count: result.value.updates.length,
    batch_digest: evidence.batch_digest,
    base_plan_digest: evidence.base_plan_digest,
    preview: result.preview,
  };
}

/** @param {any} state @param {string} rawBody @param {Date} now */
export function agentSyncAerobicProjection(state, rawBody, now) {
  const result = syncAerobicProjection(state, rawBody, now);
  return result.error ? result : result.body;
}

/** @param {any} state @param {any} packageValue */
function planUpdateBaseEvidence(state, packageValue) {
  return { ...planUpdateBase(state, packageValue), source_ref: "plan:base" };
}

/** @param {any} value */
function isSha256(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }

/** @param {string} rawBody */
function parseAgentJson(rawBody, maxBytes = 512 * 1024) {
  try { return { ok: true, value: parseStrictJson(rawBody, maxBytes) }; }
  catch { return { ok: false, error: { error: { code: "invalid_json", message: "Request body must be valid JSON" } } }; }
}

/** @param {any} state @param {Date} now */
export function agentPlan(state, now) {
  const today = localDate(now, state.timezone);
  const current = state.plan_revisions.filter((revision) => revision.effective_from <= today).sort((left, right) => right.revision_sequence - left.revision_sequence)[0] ?? null;
  const future = state.plan_revisions
    .filter((revision) => revision.effective_from > today && state.plan_revisions.filter((candidate) => candidate.effective_from <= revision.effective_from).sort((left, right) => right.revision_sequence - left.revision_sequence)[0]?.revision_key === revision.revision_key)
    .sort((left, right) => left.effective_from.localeCompare(right.effective_from));
  const firstEffective = state.plan_revisions.slice().sort((left, right) => left.effective_from.localeCompare(right.effective_from))[0]?.effective_from ?? null;
  const project = (revision) => ({ effective_from: revision.effective_from, week: Object.fromEntries(WEEKDAYS.map((day) => { const slot = revision.week[day] ?? null; return [day, slot?.kind === "workout" ? { kind: "workout", prescription: prescriptionProjection(slot, `plan:${revision.effective_from}:${day}`, safePrescriptionKeys(`agent_plan_${revision.effective_from}_${day}`)) } : deepClone(slot)]; })) });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    timezone: state.timezone,
    training_version: state.training_version,
    source_ref: "plan",
    current: current ? { ...project(current), source_ref: "plan:current" } : null,
    future: future.map((revision) => ({ ...project(revision), source_ref: `plan:future:${revision.effective_from}` })),
    next_effective_from: future[0]?.effective_from ?? null,
    first_effective_from: firstEffective,
    pending_count: future.length,
  };
}

/** @param {any} state @param {URL} url @param {Date} now */
export function agentSchedule(state, url, now) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const span = from && to ? dateSpan(from, to) : null;
  if (!from || !to || !isValidLocalDate(from) || !isValidLocalDate(to) || from > to || span === null || span > 366) {
    return { error: { code: "invalid_period", field: !from ? "from" : !to ? "to" : "to", message: "Schedule requires an inclusive from/to range of at most 366 days" } };
  }
  const expandValue = url.searchParams.get("expand");
  if (url.searchParams.has("expand") && expandValue !== "prescription") return { error: { code: "invalid_request", field: "expand", message: "expand must be prescription" } };
  const expand = expandValue === "prescription";
  const prescriptions = {};
  const entries = dateRange(from, to).map((date) => {
    const raw = scheduleEntry(state, date, now, true);
    const prescriptionRef = raw.kind === "workout" ? stablePrescriptionRef(raw.prescription, raw.weekday) : null;
    if (expand && prescriptionRef && raw.prescription) prescriptions[prescriptionRef] = prescriptionProjection(raw.prescription, prescriptionRef, safePrescriptionKeys(`agent_schedule_${raw.weekday}_${stableFingerprint(raw.prescription)}`));
    return {
      date: raw.date,
      weekday: raw.weekday,
      kind: raw.kind,
      title: raw.title,
      module_count: raw.module_count,
      estimated_duration_min: raw.estimated_duration_min,
      prescription_ref: prescriptionRef,
      session_key: raw.session_key,
      is_due: raw.is_due,
      is_overdue_unstarted: raw.is_overdue_unstarted,
      source_ref: `schedule:${date}:${raw.kind}`,
    };
  });
  const currentDate = localDate(now, state.timezone);
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
    from,
    to,
    timezone: state.timezone,
    period: { from, to, timezone: state.timezone, includes_from: true, includes_to: true, includes_current_date: from <= currentDate && currentDate <= to, current_date_may_be_incomplete: from <= currentDate && currentDate <= to },
    training_version: state.training_version,
    entries,
    prescriptions,
  };
}

/** @param {any} slot @param {string} weekday */
function stablePrescriptionRef(slot, weekday) { return `prescription:${weekday}:${stableFingerprint(slot)}`; }

/** @param {any} value */
function stableFingerprint(value) {
  let hash = 14695981039346656037n;
  for (const character of canonicalJson(value)) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** @param {any} state @param {string} pathname @param {URL} url @param {Date} now */
export function agentResource(state, pathname, url, now) {
  if (pathname === `${AGENT_PREFIX}/schemas`) return agentSchemaCatalog(now);
  if (pathname.startsWith(`${AGENT_PREFIX}/schemas/`)) return agentSchemaResource(pathname.slice(`${AGENT_PREFIX}/schemas/`.length), now);
  if (pathname === `${AGENT_PREFIX}/aerobic/activities`) return agentAerobicActivities(state, url, now);
  if (pathname.startsWith(`${AGENT_PREFIX}/aerobic/activities/`)) {
    const encodedActivityRef = pathname.slice(`${AGENT_PREFIX}/aerobic/activities/`.length);
    let activityRef;
    try { activityRef = decodeURIComponent(encodedActivityRef); } catch { return { error: { code: "invalid_request", field: "activity_ref", message: "activity_ref must be a valid path segment" } }; }
    if (!activityRef || activityRef.includes("/") || activityRef.includes("\\")) return { error: { code: "invalid_request", field: "activity_ref", message: "activity_ref must be a single non-empty path segment" } };
    return agentAerobicActivityDetail(state, activityRef, now);
  }
  if (pathname.startsWith(`${AGENT_PREFIX}/daily/`)) {
    const encodedDate = pathname.slice(`${AGENT_PREFIX}/daily/`.length);
    let date;
    try { date = decodeURIComponent(encodedDate); } catch { return { error: { code: "invalid_request", field: "local_date", message: "local_date must be a valid path segment" } }; }
    if (!date || date.includes("/") || date.includes("\\")) return { error: { code: "invalid_request", field: "local_date", message: "local_date must be a single non-empty path segment" } };
    return agentDailyContext(state, date, now);
  }
  if (pathname === `${AGENT_PREFIX}/routes`) return agentRoutes(state, url, now);
  if (pathname.startsWith(`${AGENT_PREFIX}/routes/`)) {
    const suffix = pathname.slice(`${AGENT_PREFIX}/routes/`.length);
    const isHistory = suffix.endsWith("/history");
    const encodedRouteKey = isHistory ? suffix.slice(0, -"/history".length) : suffix;
    let routeKey;
    try { routeKey = decodeURIComponent(encodedRouteKey); } catch { return { error: { code: "invalid_request", field: "route_key", message: "route_key must be a valid path segment" } }; }
    if (!routeKey || routeKey.includes("/") || routeKey.includes("\\")) return { error: { code: "invalid_request", field: "route_key", message: "route_key must be a single non-empty path segment" } };
    return isHistory ? agentRouteHistory(state, routeKey, url, now) : agentRouteDetail(state, routeKey, url, now);
  }
  if (pathname === `${AGENT_PREFIX}/overview`) return agentOverview(state, url, now);
  if (pathname === `${AGENT_PREFIX}/plan`) return agentPlan(state, now);
  if (pathname === `${AGENT_PREFIX}/schedule`) return agentSchedule(state, url, now);
  if (pathname === `${AGENT_PREFIX}/sessions`) return { ...coachResource(state, pathname, url, now, undefined, { requireTrainingVersion: true }), source_ref: "sessions" };
  if (pathname.startsWith(`${AGENT_PREFIX}/sessions/`)) {
    const resource = coachResource(state, pathname, url, now);
    return resource.error ? resource : { ...resource, training_version: state.training_version };
  }
  if (pathname === `${AGENT_PREFIX}/progress`) {
    const resource = coachResource(state, pathname, url, now);
    return resource.error ? resource : { schema_version: 1, generated_at: now.toISOString(), ...resource, training_version: state.training_version, source_ref: "progress" };
  }
  if (pathname.startsWith(`${AGENT_PREFIX}/exercises/`)) {
    const rawExerciseId = pathname.slice(`${AGENT_PREFIX}/exercises/`.length);
    let exerciseId;
    try { exerciseId = decodeURIComponent(rawExerciseId); } catch { return { error: { code: "invalid_request", field: "exercise_id", message: "exercise_id must be a valid path segment" } }; }
    if (!exerciseId || exerciseId.includes("/") || exerciseId.includes("\\")) return { error: { code: "invalid_request", field: "exercise_id", message: "exercise_id must be a single non-empty path segment" } };
    const resource = coachResource(state, `${AGENT_PREFIX}/exercises/${encodeURIComponent(exerciseId)}`, url, now);
    return resource.error ? resource : { schema_version: 1, generated_at: now.toISOString(), ...resource, training_version: state.training_version, source_ref: `exercise:${exerciseId}` };
  }
  return { error: { code: "not_found", message: "Resource not found" } };
}

/** @param {string} pathname @param {URL} url */
export function agentQueryError(pathname, url) {
  const allowed = pathname === AGENT_PREFIX ? [] : pathname === `${AGENT_PREFIX}/schemas` || pathname.startsWith(`${AGENT_PREFIX}/schemas/`) ? [] : pathname === `${AGENT_PREFIX}/overview` ? ["from", "to", "preset", "range"] : pathname === `${AGENT_PREFIX}/plan` ? [] : pathname === `${AGENT_PREFIX}/schedule` ? ["from", "to", "expand"] : pathname === `${AGENT_PREFIX}/sessions` ? ["from", "to", "limit", "cursor", "status", "exercise_id", "exercise_key"] : pathname === `${AGENT_PREFIX}/progress` ? ["from", "to", "preset", "range", "bucket"] : pathname === `${AGENT_PREFIX}/aerobic/activities` ? ["from", "to", "sport_type", "route_key", "limit", "cursor"] : pathname.startsWith(`${AGENT_PREFIX}/aerobic/activities/`) ? [] : pathname === `${AGENT_PREFIX}/daily/` || pathname.startsWith(`${AGENT_PREFIX}/daily/`) ? [] : pathname === `${AGENT_PREFIX}/routes` ? ["sport_type", "route_key", "limit", "cursor"] : pathname.startsWith(`${AGENT_PREFIX}/routes/`) ? ["from", "to", "sport_type", "limit", "cursor"] : pathname.startsWith(`${AGENT_PREFIX}/exercises/`) ? ["from", "to", "preset", "range"] : [];
  const seen = new Set();
  if (pathname === `${AGENT_PREFIX}/sessions` && url.searchParams.has("exercise_id") && url.searchParams.has("exercise_key")) return { code: "invalid_request", field: "exercise_id", message: "Use exercise_id or exercise_key, not both" };
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) return { code: "invalid_request", field: key, message: `Unsupported query parameter: ${key}` };
    if (seen.has(key)) return { code: "invalid_request", field: key, message: `Query parameter may only be provided once: ${key}` };
    if (["cursor", "status", "exercise_id", "exercise_key"].includes(key) && url.searchParams.get(key) === "") return { code: key === "cursor" ? "invalid_cursor" : "invalid_request", field: key, message: key === "cursor" ? "Cursor is malformed, expired, or does not match the filters" : `${key} must not be empty` };
    seen.add(key);
  }
  return null;
}

/** @param {string} prefix */
function safePrescriptionKeys(prefix) {
  return {
    block: (blockIndex) => `${prefix}_b${blockIndex + 1}`,
    exercise: (blockIndex, exerciseIndex) => `${prefix}_e${blockIndex + 1}_${exerciseIndex + 1}`,
    set: (blockIndex, exerciseIndex, setIndex) => `${prefix}_s${blockIndex + 1}_${exerciseIndex + 1}_${setIndex + 1}`,
  };
}
