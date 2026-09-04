// @ts-check

import { readFile, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { writeAtomicFile } from "./atomic-file.js";
import { WEEKDAYS, addDays, canonicalJson, dateRange, isRecord, isValidLocalDate, isValidTimezone, isValidUtcInstant, localDate, mondayOf, sha256Hex, weekdayKey } from "./util.js";

const PLAN_INDEX_PATH = "plan/index.md";
const PLAN_WEEK_DIR = "plan/weeks";
const PLAN_SOURCE_PATH = ".sync/plan2local/effective.json";
const PLAN_MANIFEST_PATH = ".sync/plan2local/manifest.json";
const LEGACY_PLAN_PATHS = Object.freeze(["plan/current.md", "data/plan/current.json", ".sync/plan2local.json", ".sync/plan2local/source.json"]);
const WEEKDAY_LABELS = Object.freeze({ monday: "周一", tuesday: "周二", wednesday: "周三", thursday: "周四", friday: "周五", saturday: "周六", sunday: "周日" });

/** @param {string} message @param {string} code */
function planLocalError(message, code = "invalid_plan_projection") {
  const error = new Error(message);
  // @ts-ignore error code is intentionally exposed to the MCP boundary
  error.code = code;
  return error;
}

/** @param {unknown} value @param {string} label */
function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw planLocalError(`${label} must be a non-empty string`);
}

/** @param {unknown} value @param {string} label */
function validatePrescription(value, label) {
  if (!isRecord(value)) throw planLocalError(`${label} must be an object`);
  requireString(value.prescription_ref, `${label}.prescription_ref`);
  requireString(value.title, `${label}.title`);
  if (!Array.isArray(value.blocks)) throw planLocalError(`${label}.blocks must be an array`);
}

/**
 * Validate the effective Agent Plan response before it may replace the local
 * Obsidian projection.
 * @param {unknown} value
 * @returns {asserts value is Record<string, any>}
 */
export function validateLocalPlanSource(value) {
  if (!isRecord(value)) throw planLocalError("Workout Plan response must be an object");
  if (value.schema_version !== 2) throw planLocalError("Workout Plan response schema_version must be 2");
  if (!isValidUtcInstant(value.generated_at) || !isValidUtcInstant(value.data_as_of)) throw planLocalError("Workout Plan response freshness timestamps are invalid");
  if (!isValidTimezone(value.timezone)) throw planLocalError("Workout Plan response timezone is invalid");
  if (!Number.isInteger(value.training_version) || value.training_version < 0) throw planLocalError("Workout Plan response training_version is invalid");
  if (value.source_ref !== "plan") throw planLocalError("Workout Plan response source_ref must be plan");
  if (!isValidLocalDate(value.from) || !isValidLocalDate(value.to) || value.from > value.to) throw planLocalError("Workout Plan response range is invalid");
  if (mondayOf(value.from) !== value.from || addDays(mondayOf(value.to), 6) !== value.to) throw planLocalError("Workout Plan response must cover complete natural weeks");
  if (!isRecord(value.period) || value.period.from !== value.from || value.period.to !== value.to || value.period.timezone !== value.timezone || value.period.includes_from !== true || value.period.includes_to !== true) throw planLocalError("Workout Plan response period does not match its range");
  if (!Array.isArray(value.entries) || !isRecord(value.prescriptions)) throw planLocalError("Workout Plan response entries and prescriptions are required");

  const expectedDates = dateRange(value.from, value.to);
  if (value.entries.length !== expectedDates.length) throw planLocalError("Workout Plan response must contain one entry per covered date");
  const referencedPrescriptions = new Set();
  value.entries.forEach((entry, index) => {
    const label = `entries[${index}]`;
    if (!isRecord(entry) || entry.date !== expectedDates[index] || entry.weekday !== weekdayKey(entry.date)) throw planLocalError(`${label} is not the expected dated Planned Day`);
    if (!["workout", "rest", "no_plan"].includes(/** @type {string} */ (entry.kind))) throw planLocalError(`${label}.kind is unsupported`);
    if (entry.source_ref !== `plan:${entry.date}:${entry.kind}`) throw planLocalError(`${label}.source_ref is invalid`);
    if (entry.kind === "workout") {
      requireString(entry.title, `${label}.title`);
      requireString(entry.prescription_ref, `${label}.prescription_ref`);
      const prescription = value.prescriptions[entry.prescription_ref];
      validatePrescription(prescription, `prescriptions.${entry.prescription_ref}`);
      if (prescription.prescription_ref !== entry.prescription_ref) throw planLocalError(`${label}.prescription_ref does not match its prescription`);
      referencedPrescriptions.add(entry.prescription_ref);
    } else if (entry.prescription_ref !== null) {
      throw planLocalError(`${label}.prescription_ref must be null for ${entry.kind}`);
    }
    if (entry.moved_from_date !== undefined && !isValidLocalDate(entry.moved_from_date)) throw planLocalError(`${label}.moved_from_date is invalid`);
    if (entry.moved_to_date !== undefined && !isValidLocalDate(entry.moved_to_date)) throw planLocalError(`${label}.moved_to_date is invalid`);
  });
  if (Object.keys(value.prescriptions).sort().join("|") !== [...referencedPrescriptions].sort().join("|")) throw planLocalError("Workout Plan response prescriptions must exactly match referenced prescriptions");
}

/** @param {unknown} value */
function markdownCell(value) { return String(value ?? "—").replaceAll("|", "\\|").replace(/[\r\n]+/g, " "); }

/** @param {any} target */
function formatTarget(target) {
  if (!isRecord(target)) return "—";
  const metric = target.metric === "reps" ? "次" : target.metric === "duration_sec" ? "秒" : target.metric ?? "目标";
  const primary = Number.isFinite(target.value) ? `${target.value} ${metric}` : Number.isFinite(target.min) && Number.isFinite(target.max) ? `${target.min}–${target.max} ${metric}` : canonicalJson(target);
  const details = [];
  if (Number.isFinite(target.distance_km)) details.push(`${target.distance_km} km`);
  if (isRecord(target.heart_rate_zone)) details.push(`心率 Z${target.heart_rate_zone.min}–Z${target.heart_rate_zone.max}`);
  if (isRecord(target.rpe)) details.push(`RPE ${target.rpe.min}–${target.rpe.max}`);
  if (Number.isFinite(target.target_incline_percent)) details.push(`坡度 ${target.target_incline_percent}%`);
  if (typeof target.effort_cue === "string" && target.effort_cue.trim()) details.push(target.effort_cue.trim());
  return details.length ? `${primary}；${details.join("；")}` : primary;
}

/** @param {any} set */
function formatResistance(set) {
  const mode = set?.resistance_mode ?? set?.resistance?.mode ?? null;
  if (mode === "bodyweight") return "自重";
  if (mode === "external_load") {
    const value = set?.resistance_kg ?? set?.resistance?.value;
    const unit = set?.resistance_kg !== undefined ? "kg/件" : set?.resistance?.unit ?? "kg/件";
    return Number.isFinite(value) ? `${value} ${unit}` : "外部负重";
  }
  if (mode === "external_weight") return Number.isFinite(set?.resistance?.load_kg) ? `${set.resistance.load_kg} kg/件` : "外部负重";
  return "—";
}

/** @param {any} prescription */
function renderPrescription(prescription) {
  const lines = [`**${markdownCell(prescription.title)}**`, "", `- 开始时间：${markdownCell(prescription.start_time ?? "未指定")}`, `- 预计时长：${Number.isFinite(prescription.estimated_duration_min) ? `${prescription.estimated_duration_min} 分钟` : "未指定"}`];
  if (isRecord(prescription.recording_intent)) {
    const route = prescription.recording_intent.route_key ? ` · 路线 ${markdownCell(prescription.recording_intent.route_key)}` : "";
    lines.push(`- 记录意图：${markdownCell(prescription.recording_intent.source)} · sport type ${markdownCell(prescription.recording_intent.sport_type)}${route}`);
  }
  for (const block of prescription.blocks) {
    lines.push("", `### ${markdownCell(block?.title ?? "训练模块")}`, "", "| 动作 | 执行方式 | 组 | 目标 | 负重 | 节奏 | 组间休息 |", "| --- | --- | ---: | --- | --- | --- | ---: |");
    for (const exercise of Array.isArray(block?.exercises) ? block.exercises : []) {
      const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
      if (!sets.length) lines.push(`| ${markdownCell(exercise?.name)} | ${markdownCell(exercise?.execution_mode ?? exercise?.side_mode)} | — | — | — | — | — |`);
      sets.forEach((/** @type {any} */ set, /** @type {number} */ index) => lines.push(`| ${markdownCell(exercise?.name)} | ${markdownCell(exercise?.execution_mode ?? exercise?.side_mode)} | ${set?.ordinal ?? index + 1} | ${markdownCell(formatTarget(set?.target))} | ${markdownCell(formatResistance(set))} | ${markdownCell(set?.tempo)} | ${Number.isFinite(set?.rest_after_sec) ? `${set.rest_after_sec} 秒` : "—"} |`));
    }
  }
  return lines;
}

/** @param {string} relativePath */
function wikilink(relativePath) { return `[[${relativePath.replace(/\.md$/, "")}]]`; }

/** @param {Record<string, any>} plan @param {{ role: "current" | "future", weekStart: string, weekEnd: string, days: any[], digest: string, path: string }} week */
export function localPlanWeekMarkdown(plan, week) {
  validateLocalPlanSource(plan);
  const lines = ["---", "kind: workout-plan-week", "schema_version: 1", "projection_version: 3", "source: workout", "source_status: complete", `source_ref: ${JSON.stringify(plan.source_ref)}`, `data_as_of: ${JSON.stringify(plan.data_as_of)}`, `timezone: ${JSON.stringify(plan.timezone)}`, `training_version: ${plan.training_version}`, `plan_role: ${week.role}`, `week_start: ${JSON.stringify(week.weekStart)}`, `week_end: ${JSON.stringify(week.weekEnd)}`, `week_digest: ${JSON.stringify(week.digest)}`, `plan_index: ${JSON.stringify(wikilink(PLAN_INDEX_PATH))}`, "---", "", `# 训练周 ${week.weekStart} — ${week.weekEnd}`, "", `> Workout 是计划事实源；本文是 \`/workout plan2local\` 生成的当前有效 Planned Day 投影。返回 ${wikilink(PLAN_INDEX_PATH)}。`];
  for (const day of week.days) {
    lines.push("", `## ${WEEKDAY_LABELS[/** @type {keyof typeof WEEKDAY_LABELS} */ (day.weekday)]} · ${day.date}`, "");
    if (day.moved_from_date) lines.push(`> 本训练由 ${day.moved_from_date} 调整到本日。`, "");
    if (day.moved_to_date) lines.push(`> 原训练已调整到 ${day.moved_to_date}。`, "");
    if (day.kind === "no_plan") lines.push("未安排。");
    else if (day.kind === "rest") lines.push("休息日。");
    else lines.push(...renderPrescription(plan.prescriptions[day.prescription_ref]));
  }
  lines.push("", "## 数据说明", "", `- 周文件：\`${week.path}\``, `- 数据时间：${plan.data_as_of}`, `- \`training_version\`：${plan.training_version}（训练数据状态序号，不是计划版本号）`, "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** @param {{days: any[]}} week @param {Record<string, any>} plan */
function weekSummary(week, plan) {
  /** @type {string[]} */
  const titles = [];
  for (const day of week.days) {
    if (day.kind !== "workout") continue;
    const title = plan.prescriptions[day.prescription_ref]?.title;
    if (typeof title === "string" && title.trim() && !titles.includes(title.trim())) titles.push(title.trim());
  }
  return { workoutCount: week.days.filter((day) => day.kind === "workout").length, titles };
}

/** @param {Record<string, any>} plan @param {string} planDigest @param {Array<{ role: "current" | "future", weekStart: string, weekEnd: string, days: any[], digest: string, path: string }>} weeks */
export function localPlanIndexMarkdown(plan, planDigest, weeks) {
  validateLocalPlanSource(plan);
  const current = weeks.find((week) => week.role === "current") ?? null;
  const future = weeks.filter((week) => week.role === "future");
  const lines = ["---", "kind: workout-plan-index", "schema_version: 1", "projection_version: 3", "source: workout", "source_status: complete", `source_ref: ${JSON.stringify(plan.source_ref)}`, `data_as_of: ${JSON.stringify(plan.data_as_of)}`, `generated_at: ${JSON.stringify(plan.generated_at)}`, `timezone: ${JSON.stringify(plan.timezone)}`, `training_version: ${plan.training_version}`, `plan_digest: ${JSON.stringify(planDigest)}`, `current_week: ${current ? JSON.stringify(wikilink(current.path)) : "null"}`];
  if (future.length) lines.push("future_weeks:", ...future.map((week) => `  - ${JSON.stringify(wikilink(week.path))}`));
  else lines.push("future_weeks: []");
  lines.push("---", "", "# 训练计划", "", "> Workout 是计划事实源；本页是 `/workout plan2local` 生成的只读有效计划索引。同一自然周始终覆盖同一个文件，不保留 revision 历史。", "", "| 状态 | 周开始 | 周结束 | 训练日 | 内容 | 周计划 |", "| --- | --- | --- | ---: | --- | --- |");
  for (const week of weeks) {
    const summary = weekSummary(week, plan);
    lines.push(`| ${week.role === "current" ? "当前" : "后续"} | ${week.weekStart} | ${week.weekEnd} | ${summary.workoutCount} | ${markdownCell(summary.titles.join("、") || "无训练安排")} | ${wikilink(week.path)} |`);
  }
  lines.push("", "## 数据说明", "", `- 数据时间：${plan.data_as_of}`, `- \`training_version\`：${plan.training_version}（训练数据状态序号，不是计划版本号）`, `- 完整有效投影：\`${PLAN_SOURCE_PATH}\`（Agent/恢复用途，不作为日常阅读入口）`, "");
  return `${lines.join("\n")}\n`;
}

/** @param {string} path */
async function readJsonOrNull(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (/** @type {any} */ error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

/** @param {string} root @param {string} relativePath */
async function unlinkIfPresent(root, relativePath) {
  try { await unlink(join(root, relativePath)); return true; }
  catch (/** @type {any} */ error) { if (error?.code === "ENOENT") return false; throw error; }
}

/** @param {unknown} path */
function isManagedWeekPath(path) { return typeof path === "string" && /^plan\/weeks\/\d{4}-\d{2}-\d{2}(?:--[a-f0-9]{12})?\.md$/.test(path); }

/** @param {Record<string, any>} plan */
async function buildWeekEntries(plan) {
  const currentDate = localDate(new Date(plan.generated_at), plan.timezone);
  /** @type {Array<{ role: "current" | "future", weekStart: string, weekEnd: string, days: any[], digest: string, path: string }>} */
  const weeks = [];
  for (let offset = 0; offset < plan.entries.length; offset += 7) {
    const days = plan.entries.slice(offset, offset + 7);
    const weekStart = days[0].date;
    const weekEnd = days[6].date;
    const refs = /** @type {string[]} */ ([...new Set(days.map((/** @type {any} */ day) => day.prescription_ref).filter((/** @type {unknown} */ ref) => typeof ref === "string"))].sort());
    const prescriptions = Object.fromEntries(refs.map((ref) => [ref, plan.prescriptions[ref]]));
    const digest = await sha256Hex(canonicalJson({ week_start: weekStart, week_end: weekEnd, days, prescriptions }));
    weeks.push({ role: weekStart <= currentDate && currentDate <= weekEnd ? "current" : "future", weekStart, weekEnd, days, digest, path: `${PLAN_WEEK_DIR}/${weekStart}.md` });
  }
  return weeks;
}

/**
 * Replace the managed local plan projection, verify the new generation, then
 * remove only paths owned by an earlier plan2local generation.
 * @param {{ archiveDir: string, plan: unknown, savedAt?: Date }} options
 */
export async function saveTrainingPlanLocal({ archiveDir, plan, savedAt = new Date() }) {
  if (typeof archiveDir !== "string" || !archiveDir.trim() || !isAbsolute(archiveDir)) throw planLocalError("WORKOUT_ARCHIVE_DIR must be an absolute path", "archive_path_invalid");
  validateLocalPlanSource(plan);
  const root = resolve(archiveDir);
  if (root === "/") throw planLocalError("WORKOUT_ARCHIVE_DIR must not be the filesystem root", "archive_path_invalid");
  const semanticPlan = { schema_version: plan.schema_version, timezone: plan.timezone, from: plan.from, to: plan.to, entries: plan.entries, prescriptions: plan.prescriptions };
  const planDigest = await sha256Hex(canonicalJson(semanticPlan));
  const [priorManifest, legacyReceipt] = await Promise.all([readJsonOrNull(join(root, PLAN_MANIFEST_PATH)), readJsonOrNull(join(root, ".sync/plan2local.json"))]);
  const weeks = await buildWeekEntries(plan);
  const weekFiles = new Map(weeks.map((week) => [week.path, localPlanWeekMarkdown(plan, week)]));
  const sourceJson = `${JSON.stringify(plan)}\n`;
  const indexMarkdown = localPlanIndexMarkdown(plan, planDigest, weeks);

  for (const [relativePath, content] of weekFiles) await writeAtomicFile(join(root, relativePath), content, "utf8");
  await writeAtomicFile(join(root, PLAN_SOURCE_PATH), sourceJson, "utf8");
  await writeAtomicFile(join(root, PLAN_INDEX_PATH), indexMarkdown, "utf8");
  const expectedFiles = new Map([[PLAN_INDEX_PATH, indexMarkdown], ...weekFiles, [PLAN_SOURCE_PATH, sourceJson]]);
  const readbacks = await Promise.all([...expectedFiles].map(async ([relativePath, expected]) => [relativePath, await readFile(join(root, relativePath), "utf8"), expected]));
  if (readbacks.some(([, actual, expected]) => actual !== expected)) throw planLocalError("Local plan readback did not match the written projection", "local_readback_failed");

  const writtenPaths = [PLAN_INDEX_PATH, ...weekFiles.keys(), PLAN_SOURCE_PATH, PLAN_MANIFEST_PATH];
  const manifestBase = { schema_version: 1, projection_version: 3, route: "plan2local", status: plan.entries.some((/** @type {any} */ entry) => entry.kind !== "no_plan") ? "complete" : "none", saved_at: savedAt.toISOString(), data_as_of: plan.data_as_of, source_ref: plan.source_ref, training_version: plan.training_version, plan_digest: planDigest, changed: (priorManifest?.plan_digest ?? legacyReceipt?.plan_digest) !== planDigest, index_path: PLAN_INDEX_PATH, source_path: PLAN_SOURCE_PATH, week_paths: [...weekFiles.keys()], written_paths: writtenPaths };
  const pendingManifest = { ...manifestBase, write_status: "partial", cleanup_status: "pending", removed_paths: [], readback: { status: "verified" } };
  const pendingManifestJson = `${JSON.stringify(pendingManifest, null, 2)}\n`;
  await writeAtomicFile(join(root, PLAN_MANIFEST_PATH), pendingManifestJson, "utf8");
  if (await readFile(join(root, PLAN_MANIFEST_PATH), "utf8") !== pendingManifestJson) throw planLocalError("Local plan manifest readback did not match the written projection", "local_readback_failed");

  const currentWeekPaths = new Set(weekFiles.keys());
  const priorWeekPaths = Array.isArray(priorManifest?.week_paths) ? priorManifest.week_paths.filter(isManagedWeekPath) : [];
  const staleWeekPaths = priorWeekPaths.filter((/** @type {string} */ path) => !currentWeekPaths.has(path));
  const removedPaths = [];
  for (const relativePath of [...staleWeekPaths, ...LEGACY_PLAN_PATHS]) if (await unlinkIfPresent(root, relativePath)) removedPaths.push(relativePath);

  const manifest = { ...manifestBase, write_status: "complete", cleanup_status: "complete", removed_paths: removedPaths, readback: { status: "verified" } };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeAtomicFile(join(root, PLAN_MANIFEST_PATH), manifestJson, "utf8");
  if (await readFile(join(root, PLAN_MANIFEST_PATH), "utf8") !== manifestJson) throw planLocalError("Local plan manifest readback did not match the written projection", "local_readback_failed");
  return manifest;
}
