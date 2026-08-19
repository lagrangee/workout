// @ts-check

import { appendPlanRevision, packagePreview, planUpdateBase, scheduleModel } from "./plan.js";
import { parseStrictJson, validatePlanPackage } from "./validation.js";
import { addDays, canonicalJson, deepClone, isRecord, localDate, sha256Hex, weekdayKey, WEEKDAYS } from "./util.js";

export const PLAN_UPDATE_BATCH_MIN = 2;
export const PLAN_UPDATE_BATCH_MAX = 4;
export const PLAN_UPDATE_BATCH_MAX_BYTES = 2 * 1024 * 1024;

/** @param {any} state */
function cloneState(state) {
  const clone = deepClone(state);
  if (state.__canonicalCutover) Object.defineProperty(clone, "__canonicalCutover", { value: true, enumerable: false, writable: true });
  return clone;
}

/** @param {string} text @param {Date} now @param {string} timezone */
export function parsePlanUpdateBatch(text, now, timezone) {
  let input;
  try { input = parseStrictJson(text, PLAN_UPDATE_BATCH_MAX_BYTES); }
  catch { return { ok: false, errors: [{ path: "/", message: "Batch must be valid strict JSON" }] }; }
  if (!isRecord(input) || Object.keys(input).some((key) => !["schema_version", "updates"].includes(key)) || input.schema_version !== 1 || !Array.isArray(input.updates)) {
    return { ok: false, errors: [{ path: "/", message: "Batch requires only schema_version 1 and an updates array" }] };
  }
  if (input.updates.length < PLAN_UPDATE_BATCH_MIN || input.updates.length > PLAN_UPDATE_BATCH_MAX) {
    return { ok: false, errors: [{ path: "/updates", message: `Batch requires ${PLAN_UPDATE_BATCH_MIN}-${PLAN_UPDATE_BATCH_MAX} updates` }] };
  }
  const today = localDate(now, timezone);
  /** @type {any[]} */
  const updates = [];
  /** @type {{path: string, message: string}[]} */
  const errors = [];
  for (let index = 0; index < input.updates.length; index += 1) {
    const result = /** @type {any} */ (validatePlanPackage(canonicalJson(input.updates[index]), today));
    if (!result.ok) {
      errors.push(...result.errors.map(/** @param {{path: string, message: string}} error */ (error) => ({ path: `/updates/${index}${error.path}`, message: error.message })));
      continue;
    }
    if (result.value.schema_version !== 2) errors.push({ path: `/updates/${index}/schema_version`, message: "Plan Update Batch accepts only Plan Update Package v2" });
    updates.push(result.value);
  }
  if (errors.length) return { ok: false, errors };
  for (let index = 0; index < updates.length; index += 1) {
    const current = updates[index];
    if (weekdayKey(current.effective_from) !== "monday") errors.push({ path: `/updates/${index}/effective_from`, message: "Each update must take effect on a Monday" });
    if (index > 0 && current.effective_from !== addDays(updates[index - 1].effective_from, 7)) errors.push({ path: `/updates/${index}/effective_from`, message: "Effective dates must be ordered consecutive Mondays" });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { schema_version: 1, updates } };
}

/** @param {any} state @param {any} batchValue @param {Date} now */
export function planUpdateBatchBaseEvidence(state, batchValue, now = new Date()) {
  const simulated = cloneState(state);
  const updates = batchValue.updates.map(/** @param {any} update */ (update) => {
    const basePlan = planUpdateBase(simulated, update);
    appendPlanRevision(simulated, update, now);
    return { effective_from: update.effective_from, base_plan: { ...basePlan, source_ref: "plan:base" } };
  });
  return { updates, source_ref: "plan-update-batch:base" };
}

/** @param {any} state @param {string} text @param {Date} now */
export function validatePlanUpdateBatchForState(state, text, now = new Date()) {
  const parsed = /** @type {any} */ (parsePlanUpdateBatch(text, now, state.timezone));
  if (!parsed.ok) return parsed;
  const simulated = cloneState(state);
  const previews = [];
  for (let index = 0; index < parsed.value.updates.length; index += 1) {
    const update = parsed.value.updates[index];
    const baseline = planUpdateBase(simulated, update).week ?? Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
    if (canonicalJson(baseline) === canonicalJson(update.week)) return { ok: false, errors: [{ path: `/updates/${index}/week`, message: "This update does not change the effective template" }] };
    previews.push({ ...packagePreview(simulated, update, now), source_ref: `plan-update-batch:preview:${index + 1}` });
    appendPlanRevision(simulated, update, now);
  }
  const from = parsed.value.updates[0].effective_from;
  const to = addDays(parsed.value.updates.at(-1).effective_from, 6);
  const schedule = scheduleModel(simulated, from, to, now, true);
  return {
    ok: true,
    value: parsed.value,
    preview: {
      from,
      to,
      update_count: previews.length,
      updates: previews,
      resulting_schedule: { from, to, entries: schedule },
      source_ref: "plan-update-batch:preview",
    },
  };
}

/** @param {any} state @param {any} batchValue @param {Date} now */
export function appendPlanUpdateBatch(state, batchValue, now = new Date()) {
  const revisions = batchValue.updates.map(/** @param {any} update */ (update) => appendPlanRevision(state, update, now));
  state.training_version += 1;
  return revisions;
}

/** @param {any} state @param {any} batchValue @param {Date} now */
export async function planUpdateBatchDigests(state, batchValue, now = new Date()) {
  const basePlan = planUpdateBatchBaseEvidence(state, batchValue, now);
  return {
    batch_digest: await sha256Hex(canonicalJson(batchValue)),
    base_plan_digest: await sha256Hex(canonicalJson(basePlan)),
    base_plan: basePlan,
  };
}
