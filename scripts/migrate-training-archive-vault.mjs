#!/usr/bin/env node
// @ts-nocheck

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isValidLocalDate } from "../src/util.js";
import { normalizeCorosActivity, safeAerobicActivity } from "../src/training-archive.js";
import { corosActivityNote } from "../src/training-archive-sync.js";
import {
  dailyHubModel,
  dailyHubNote,
  normalizeWorkoutSessionRecord,
  workoutIndexNote,
  workoutSessionDataPath,
  workoutSessionNote,
  workoutSessionRelativePath,
} from "../src/training-records.js";

const TIMEZONE = "Asia/Shanghai";
const SOURCE_STATUSES = new Set(["complete", "none", "partial", "error"]);

function parseScalar(value) {
  const text = value.trim();
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  return text;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  const top = {};
  const nested = {};
  if (!match) return { top, nested };
  let section = null;
  for (const line of match[1].split("\n")) {
    const topMatch = line.match(/^([A-Za-z_][\w-]*):(?:\s*(.*))?$/);
    if (topMatch) {
      section = topMatch[1];
      top[section] = topMatch[2] ? parseScalar(topMatch[2]) : null;
      continue;
    }
    const nestedMatch = line.match(/^  ([A-Za-z_][\w-]*):\s*(.*)$/);
    if (nestedMatch && section) {
      nested[section] ??= {};
      nested[section][nestedMatch[1]] = parseScalar(nestedMatch[2]);
    }
  }
  return { top, nested };
}

function validStatus(value, fallback) {
  return SOURCE_STATUSES.has(value) ? value : fallback;
}

function validDate(value) {
  return typeof value === "string" && isValidLocalDate(value) ? value : null;
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function readNames(path, suffix) {
  try {
    return (await readdir(path)).filter((name) => !suffix || name.endsWith(suffix));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readDailyNotes(archiveDir) {
  const byDate = new Map();
  for (const name of await readNames(join(archiveDir, "daily"), ".md")) {
    const date = basename(name, ".md");
    if (!validDate(date)) continue;
    const markdown = await readFile(join(archiveDir, "daily", name), "utf8");
    byDate.set(date, { ...parseFrontmatter(markdown), markdown });
  }
  return byDate;
}

async function readReceipts(archiveDir) {
  const byDate = new Map();
  for (const name of await readNames(join(archiveDir, ".sync", "training-archive"), ".json")) {
    const date = basename(name, ".json");
    if (!validDate(date)) continue;
    const receipt = await readJson(join(archiveDir, ".sync", "training-archive", name));
    if (receipt) byDate.set(date, receipt);
  }
  return byDate;
}

async function readActivities(archiveDir) {
  const activities = [];
  for (const name of await readNames(join(archiveDir, "data", "coros"), ".json")) {
    const value = await readJson(join(archiveDir, "data", "coros", name));
    if (!value || !validDate(value.local_date) || !value.activity_ref) continue;
    activities.push(value);
  }
  return activities;
}

async function readSessions(archiveDir) {
  const sessions = [];
  const legacyPaths = [];
  for (const name of await readNames(join(archiveDir, "workout", "sessions"), ".md")) {
    const path = join(archiveDir, "workout", "sessions", name);
    const parsed = parseFrontmatter(await readFile(path, "utf8"));
    if (parsed.top.kind !== "workout-session") continue;
    const localDateValue = validDate(parsed.top.local_date);
    const sessionKey = typeof parsed.top.session_key === "string" ? parsed.top.session_key : null;
    if (!localDateValue || !sessionKey) continue;
    let details = null;
    const sidecarPath = join(archiveDir, `${workoutSessionDataPath(localDateValue, sessionKey)}.json`);
    const sidecar = await readJson(sidecarPath);
    if (sidecar?.details && typeof sidecar.details === "object") details = sidecar.details;
    sessions.push({
      session_key: sessionKey,
      scheduled_date: localDateValue,
      source_ref: parsed.top.source_ref,
      title: parsed.top.title,
      status: parsed.top.status,
      completion_fraction: parsed.top.completion_fraction,
      training_duration_sec: parsed.top.training_duration_sec,
      session_rpe: parsed.top.session_rpe,
      source_status: parsed.top.source_status,
      data_as_of: parsed.top.data_as_of,
      updated_at: parsed.top.updated_at,
      timezone: parsed.top.timezone ?? TIMEZONE,
      ...(details ? { details } : {}),
    });
    if (name !== `${localDateValue}--${encodeURIComponent(sessionKey).replaceAll("%", "_")}.md`) legacyPaths.push(path);
  }
  return { sessions, legacyPaths };
}

function sourceForDate(date, daily, receipt, sessions, source) {
  const nested = daily?.nested ?? {};
  const receiptStatus = receipt?.source_status?.[source];
  const legacyStatus = nested.source_status?.[source];
  const status = validStatus(receiptStatus ?? legacyStatus, sessions.length && source === "workout" ? "complete" : "none");
  const receiptAsOf = receipt?.source_data_as_of?.[source];
  const legacyAsOf = nested.data_as_of?.[source] ?? nested[source]?.data_as_of;
  return {
    source_status: status,
    data_as_of: typeof (receiptAsOf ?? legacyAsOf) === "string" ? (receiptAsOf ?? legacyAsOf) : null,
    ...(source === "workout" ? { sessions } : {}),
    ...(source === "coros" ? { activities: [] } : {}),
  };
}

function noteTime(date, daily, receipt) {
  const candidate = daily?.top?.updated_at ?? daily?.top?.captured_at ?? receipt?.captured_at;
  const parsed = candidate ? new Date(candidate) : new Date(`${date}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? new Date(`${date}T00:00:00+08:00`) : parsed;
}

async function migrate(archiveDir) {
  const [dailyByDate, receipts, activities, sessionRead] = await Promise.all([
    readDailyNotes(archiveDir),
    readReceipts(archiveDir),
    readActivities(archiveDir),
    readSessions(archiveDir),
  ]);
  const activitiesByDate = new Map();
  for (const activity of activities) {
    const normalized = normalizeCorosActivity(activity, {
      timezone: activity.timezone ?? TIMEZONE,
      targetDate: activity.local_date,
      dataAsOf: activity.data_as_of,
      updatedAt: activity.updated_at,
    });
    const safe = safeAerobicActivity(normalized);
    const stem = `${safe.local_date}-${encodeURIComponent(safe.activity_ref).replaceAll("%", "_")}`;
    activitiesByDate.set(safe.local_date, [...(activitiesByDate.get(safe.local_date) ?? []), normalized]);
    await writeFile(join(archiveDir, "data", "coros", `${stem}.json`), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await writeFile(join(archiveDir, "data", "coros", `${stem}.md`), corosActivityNote(normalized), "utf8");
  }
  const sessionsByDate = new Map();
  for (const session of sessionRead.sessions) sessionsByDate.set(session.scheduled_date, [...(sessionsByDate.get(session.scheduled_date) ?? []), session]);
  const dates = new Set([...dailyByDate.keys(), ...activitiesByDate.keys(), ...sessionsByDate.keys()]);
  await mkdir(join(archiveDir, "data", "workout"), { recursive: true });
  await mkdir(join(archiveDir, "workout", "sessions"), { recursive: true });
  for (const date of [...dates].sort()) {
    const daily = dailyByDate.get(date);
    const receipt = receipts.get(date);
    const sessions = sessionsByDate.get(date) ?? [];
    const workout = sourceForDate(date, daily, receipt, sessions, "workout");
    const coros = sourceForDate(date, daily, receipt, [], "coros");
    const dateActivities = activitiesByDate.get(date) ?? [];
    coros.activities = dateActivities;
    const hub = dailyHubModel({ targetDate: date, timezone: TIMEZONE, now: noteTime(date, daily, receipt), workout, coros, activities: dateActivities });
    await writeFile(join(archiveDir, "daily", `${date}.md`), dailyHubNote(hub), "utf8");
  }
  for (const session of sessionRead.sessions) {
    const record = normalizeWorkoutSessionRecord(session, {
      timezone: session.timezone ?? TIMEZONE,
      dataAsOf: session.data_as_of,
      sourceStatus: session.source_status,
      includeDetails: true,
    });
    await writeFile(join(archiveDir, `${workoutSessionRelativePath(record.local_date, record.session_key)}.md`), workoutSessionNote(record), "utf8");
    await writeFile(join(archiveDir, `${workoutSessionDataPath(record.local_date, record.session_key)}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }
  await writeFile(join(archiveDir, "workout", "index.md"), workoutIndexNote(), "utf8");
  for (const path of sessionRead.legacyPaths) await rm(path, { force: true });
  return {
    daily_hubs: dates.size,
    activities: activities.length,
    workout_sessions: sessionRead.sessions.length,
    removed_legacy_session_notes: sessionRead.legacyPaths.length,
  };
}

const archiveDir = process.argv[2];
if (!archiveDir || !archiveDir.trim()) {
  console.error("Usage: node scripts/migrate-training-archive-vault.mjs <WORKOUT_ARCHIVE_DIR>");
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify(await migrate(archiveDir), null, 2));
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
