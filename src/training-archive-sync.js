// @ts-nocheck

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { addDays, isValidLocalDate, localDate } from "./util.js";
import { COROS_SPORT_TYPES, SOURCE_STATUSES, normalizeCorosActivity, safeAerobicActivity } from "./training-archive.js";

/**
 * Run the first Training Archive sync slice. Source adapters are deliberately
 * injected so this seam can be exercised without COROS credentials or a real
 * Obsidian vault.
 *
 * @param {{ archiveDir: string, timezone: string, targetDate?: string, now?: Date, workoutSource?: { read: Function }, corosSource: { read: Function }, publish: Function }} options
 */
export async function syncTrainingArchive(options) {
  const now = options.now ?? new Date();
  const targetDate = resolveSyncTargetDate(options.targetDate, now, options.timezone);
  if (typeof options.archiveDir !== "string" || !options.archiveDir.trim()) throw new Error("WORKOUT_ARCHIVE_DIR is required");
  if (typeof options.publish !== "function") throw new Error("A safe aerobic projection publisher is required");

  const workoutResult = await readSource(options.workoutSource, targetDate, options.timezone, now);
  const corosResult = await readSource(options.corosSource, targetDate, options.timezone, now);
  const ignoredSportTypes = [];
  const errors = [...(workoutResult.errors ?? []), ...(corosResult.errors ?? [])];
  const activities = [];
  for (const raw of corosResult.activities ?? []) {
    const rawSportType = raw?.sport_type ?? raw?.sportType;
    if (!isInScopeSportType(rawSportType)) {
      if (rawSportType !== undefined && rawSportType !== null) ignoredSportTypes.push(rawSportType);
      continue;
    }
    try {
      const activity = normalizeCorosActivity(raw, {
        timezone: options.timezone,
        targetDate,
        dataAsOf: corosResult.data_as_of,
        sourceStatus: corosResult.source_status,
        updatedAt: now.toISOString(),
      });
      if (activity.local_date !== targetDate) continue;
      activity.fit_file.relative_path = `data/coros/${targetDate}-${fileComponent(activity.activity_ref)}.fit`;
      activities.push(activity);
    } catch (error) {
      errors.push({ source: "coros", code: "invalid_activity", message: error.message, activity_ref: raw?.activity_ref ?? raw?.activityRef ?? raw?.labelId ?? null });
    }
  }
  const uniqueActivities = [...new Map(activities.map((activity) => [activity.activity_ref, activity])).values()];
  const writtenPaths = await writeLocalArchive(options.archiveDir, targetDate, options.timezone, now, workoutResult, corosResult, uniqueActivities, errors);
  const projection = {
    schema_version: 1,
    source_ref: `training-archive:${targetDate}`,
    target_date: targetDate,
    timezone: options.timezone,
    source_status: corosResult.source_status,
    data_as_of: corosResult.data_as_of,
    activities: uniqueActivities.map(safeAerobicActivity),
  };
  let cloudPublication;
  try {
    const result = await options.publish(projection);
    cloudPublication = { status: result?.status ?? "complete", published_count: result?.published_count ?? uniqueActivities.length, error: result?.error ?? null };
  } catch (error) {
    cloudPublication = { status: "error", published_count: 0, error: { code: error.code ?? "projection_publish_failed", message: error.message } };
  }
  const localStatus = writtenPaths.length >= 1 ? "complete" : "error";
  return {
    schema_version: 1,
    sync_ref: `training-sync:${targetDate}:${now.toISOString()}`,
    target_date: targetDate,
    timezone: options.timezone,
    captured_at: now.toISOString(),
    data_as_of: corosResult.data_as_of ?? workoutResult.data_as_of ?? null,
    source_status: { workout: workoutResult.source_status, coros: corosResult.source_status },
    local_archive: { status: localStatus, written_paths: writtenPaths },
    cloud_publication: cloudPublication,
    records_written: { daily_hubs: 1, activities: uniqueActivities.length },
    ignored_sport_types: ignoredSportTypes,
    errors,
  };
}

/** @param {string|undefined} targetDate @param {Date} now @param {string} timezone */
export function resolveSyncTargetDate(targetDate, now, timezone) {
  if (targetDate === undefined) return addDays(localDate(now, timezone), -1);
  if (typeof targetDate !== "string" || !isValidLocalDate(targetDate)) throw new Error("targetDate must be an Athlete-local YYYY-MM-DD date");
  return targetDate;
}

async function readSource(adapter, targetDate, timezone, now) {
  if (!adapter || typeof adapter.read !== "function") return { source_status: "none", data_as_of: null, activities: [], sessions: [], errors: [] };
  try {
    const result = await adapter.read(targetDate, { timezone, now });
    const sourceStatus = result?.source_status ?? (Array.isArray(result?.activities) && result.activities.length ? "complete" : "none");
    if (!SOURCE_STATUSES.includes(sourceStatus)) throw new Error(`Unsupported source_status: ${String(sourceStatus)}`);
    return { source_status: sourceStatus, data_as_of: result?.data_as_of ?? null, activities: Array.isArray(result?.activities) ? result.activities : [], sessions: Array.isArray(result?.sessions) ? result.sessions : [], errors: Array.isArray(result?.errors) ? result.errors : [] };
  } catch (error) {
    return { source_status: "error", data_as_of: null, activities: [], sessions: [], errors: [{ source: adapter === undefined ? "unknown" : "source", code: error.code ?? "source_read_failed", message: error.message }] };
  }
}

function isInScopeSportType(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && Object.hasOwn(COROS_SPORT_TYPES, number);
}

async function writeLocalArchive(archiveDir, targetDate, timezone, now, workout, coros, activities, errors) {
  const dailyPath = join(archiveDir, "daily", `${targetDate}.md`);
  const activityPaths = [];
  await mkdir(join(archiveDir, "daily"), { recursive: true });
  await mkdir(join(archiveDir, "data", "coros"), { recursive: true });
  for (const activity of activities) {
    const stem = `${targetDate}-${fileComponent(activity.activity_ref)}`;
    const jsonPath = join(archiveDir, "data", "coros", `${stem}.json`);
    const notePath = join(archiveDir, "data", "coros", `${stem}.md`);
    await writeFile(jsonPath, `${JSON.stringify(activity, null, 2)}\n`, "utf8");
    await writeFile(notePath, activityNote(activity), "utf8");
    activityPaths.push(relativePath(archiveDir, jsonPath), relativePath(archiveDir, notePath));
  }
  await writeFile(dailyPath, dailyNote({ targetDate, timezone, now, workout, coros, activities, errors }), "utf8");
  return [relativePath(archiveDir, dailyPath), ...activityPaths];
}

function fileComponent(value) {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function relativePath(root, value) {
  return value.slice(root.endsWith("/") ? root.length : root.length + 1).replaceAll("\\", "/");
}

function yamlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function listYaml(values) {
  return values.length ? values.map((value) => `  - ${yamlValue(value)}`).join("\n") : "  []";
}

function activityNote(activity) {
  const routeLines = activity.route_key ? [`route_key: ${yamlValue(activity.route_key)}`, `route_direction: ${yamlValue(activity.route_direction)}`, `route: ${yamlValue(`[[routes/${activity.route_key}]]`)}`] : ["route_key: null", "route_direction: null"];
  const summary = activity.summary;
  return [
    "---",
    "kind: coros-activity",
    "schema_version: 1",
    "field_catalog_version: 1",
    "source: coros",
    `source_ref: ${yamlValue(activity.source_ref)}`,
    `activity_ref: ${yamlValue(activity.activity_ref)}`,
    `local_date: ${yamlValue(activity.local_date)}`,
    `timezone: ${yamlValue(activity.timezone)}`,
    `sport_type: ${activity.sport_type}`,
    `sport_name: ${yamlValue(activity.sport_name)}`,
    `started_at: ${yamlValue(activity.started_at)}`,
    `ended_at: ${yamlValue(activity.ended_at)}`,
    `source_status: ${yamlValue(activity.source_status)}`,
    `data_as_of: ${yamlValue(activity.data_as_of)}`,
    `updated_at: ${yamlValue(activity.updated_at)}`,
    ...routeLines,
    `fit_status: ${yamlValue(activity.fit_file?.status ?? null)}`,
    "---",
    "",
    "## 摘要",
    `- 距离：${summary.distance_km ?? "—"} km`,
    `- 用时：${summary.duration_sec ?? "—"} 秒`,
    `- 平均心率：${summary.average_heart_rate_bpm ?? "—"} bpm`,
    `- 消耗：${summary.calories_kcal ?? "—"} kcal`,
    "",
    "## 来源",
    `- COROS activity_ref：${activity.activity_ref}`,
    `- FIT：${activity.fit_file?.status ?? "—"}`,
    activity.route_key ? `- 路线：[[routes/${activity.route_key}]]` : "- 路线：未匹配（不适用或尚未确认）",
    "",
  ].join("\n");
}

function dailyNote({ targetDate, timezone, now, workout, coros, activities, errors }) {
  const workoutSessions = workout.sessions ?? [];
  const workoutSourceRefs = workoutSessions.map((session) => session.source_ref ?? session.session_key).filter(Boolean);
  const fitFiles = activities.map((activity) => activity.fit_file?.relative_path).filter(Boolean);
  const activityLinks = activities.map((activity) => `[[data/coros/${targetDate}-${fileComponent(activity.activity_ref)}]]`);
  const distance = activities.reduce((total, activity) => total + (activity.summary.distance_km ?? 0), 0);
  const limitations = [...errors.map((error) => `${error.source ?? "source"}: ${error.message}`), ...(coros.source_status === "partial" ? ["COROS 数据不完整，缺失字段保持 null。"] : []), ...(activities.length === 0 && coros.source_status === "none" ? ["当天没有 in-scope COROS aerobic activity。"] : [])];
  return [
    "---",
    "kind: training-day",
    "schema_version: 1",
    `date: ${targetDate}`,
    `timezone: ${yamlValue(timezone)}`,
    `captured_at: ${yamlValue(now.toISOString())}`,
    `updated_at: ${yamlValue(now.toISOString())}`,
    "source_status:",
    `  workout: ${yamlValue(workout.source_status)}`,
    `  coros: ${yamlValue(coros.source_status)}`,
    "workout:",
    `  data_as_of: ${yamlValue(workout.data_as_of)}`,
    "  session_keys:",
    listYaml(workoutSessions.map((session) => session.session_key).filter(Boolean)),
    "  source_refs:",
    listYaml(workoutSourceRefs),
    "coros:",
    `  data_as_of: ${yamlValue(coros.data_as_of)}`,
    "  activity_refs:",
    listYaml(activities.map((activity) => activity.activity_ref)),
    "  fit_files:",
    listYaml(fitFiles),
    "---",
    "",
    "## 无氧训练",
    workoutSessions.length ? workoutSessions.map((session) => `- ${session.session_key ?? "Workout Session"}`).join("\n") : "- 暂无 Workout Session 归档。",
    "",
    "## 有氧训练",
    activityLinks.length ? activityLinks.map((link, index) => `- ${link} · ${activities[index].sport_name} · ${activities[index].summary.distance_km ?? "—"} km`).join("\n") : "- 暂无 COROS aerobic activity。",
    "",
    "## 当日汇总",
    `- COROS 有氧：${activities.length} 次 · ${activities.length ? `${distance.toFixed(2)} km` : "—"}`,
    "",
    "## 限制与待补",
    limitations.length ? limitations.map((item) => `- ${item}`).join("\n") : "- 无。",
    "",
  ].join("\n");
}
