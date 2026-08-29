// @ts-check

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { toFitBytes } from "./fit-decoder.js";
import { writeAtomicFile } from "./atomic-file.js";

const SNAPSHOT_DIR = [".sync", "training-archive", "snapshots"];
const FIT_PAYLOAD_KEYS = ["fit_bytes", "fitBytes", "fit_data", "fitData", "fit_content", "fitContent"];

/**
 * Persist one normalized source snapshot. FIT bytes are written as separate
 * local artifacts so the manifest stays inspectable and retries do not need
 * to reconstruct a provider envelope.
 */
/** @param {{ archiveDir: string, timezone: string, dates: string[], capturedAt?: string|number|Date, workoutByDate?: Record<string, any>, corosByDate?: Record<string, any> }} options */
export async function stageSourceSnapshot({ archiveDir, timezone, dates, capturedAt, workoutByDate = {}, corosByDate = {} }) {
  const snapshotId = `snapshot-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const root = join(archiveDir, ...SNAPSHOT_DIR, snapshotId);
  const fitRoot = join(root, "fit");
  await mkdir(fitRoot, { recursive: true });
  /** @type {Record<string, any>} */
  const dateEntries = {};

  for (const targetDate of dates) {
    const rawCoros = corosByDate?.[targetDate] ?? { source_status: "none", data_as_of: null, activities: [] };
    const activities = Array.isArray(rawCoros.activities) ? rawCoros.activities : [];
    const coros = cloneJson({ ...rawCoros, activities: [] });
    coros.activities = [];
    for (const [index, raw] of activities.entries()) {
      const bytes = extractActivityFitBytes(raw);
      const activity = cloneJsonWithoutFitPayload(raw);
      if (bytes && bytes.byteLength > 0) {
        const relativePath = `fit/${targetDate}-${String(index + 1).padStart(3, "0")}.fit`;
        await writeAtomicFile(join(root, relativePath), bytes);
        activity.fit_file = {
          ...(activity.fit_file && typeof activity.fit_file === "object" ? activity.fit_file : {}),
          snapshot_relative_path: relativePath,
          bytes: bytes.byteLength,
        };
      }
      coros.activities.push(activity);
    }
    dateEntries[targetDate] = {
      workout: cloneJson(workoutByDate?.[targetDate] ?? { source_status: "none", data_as_of: null, sessions: [] }),
      coros,
    };
  }

  const manifest = {
    schema_version: 1,
    snapshot_id: snapshotId,
    captured_at: new Date(capturedAt ?? Date.now()).toISOString(),
    timezone,
    dates: dateEntries,
  };
  await writeJsonAtomic(join(root, "manifest.json"), manifest);
  return { snapshot_id: snapshotId, root, manifest, ...(await mapsFromManifest(root, manifest)) };
}

/** @param {{ archiveDir: string, snapshotId?: string|null }} options */
export async function loadSourceSnapshot({ archiveDir, snapshotId = null }) {
  const id = snapshotId ?? await latestSnapshotId(archiveDir);
  if (!id) return null;
  const root = join(archiveDir, ...SNAPSHOT_DIR, id);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (!manifest || manifest.schema_version !== 1 || manifest.snapshot_id !== id || !manifest.dates || typeof manifest.dates !== "object") throw new Error("Source snapshot manifest is invalid");
  return { snapshot_id: id, root, manifest, ...await mapsFromManifest(root, manifest) };
}

/** @param {{ archiveDir: string, snapshotId: string }} options */
export async function removeSourceSnapshot({ archiveDir, snapshotId }) {
  if (typeof snapshotId !== "string" || !/^snapshot-[a-z0-9-]+$/i.test(snapshotId)) throw new Error("snapshotId is invalid");
  await rm(join(archiveDir, ...SNAPSHOT_DIR, snapshotId), { recursive: true, force: true });
}

/** @param {string} archiveDir */
async function latestSnapshotId(archiveDir) {
  try {
    const entries = await readdir(join(archiveDir, ...SNAPSHOT_DIR), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && /^snapshot-[a-z0-9-]+$/i.test(entry.name)).map((entry) => entry.name).sort().at(-1) ?? null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** @param {string} root @param {any} manifest */
async function mapsFromManifest(root, manifest) {
  /** @type {Record<string, any>} */
  const workoutByDate = {};
  /** @type {Record<string, any>} */
  const corosByDate = {};
  for (const [targetDate, entry] of Object.entries(manifest.dates)) {
    workoutByDate[targetDate] = cloneJson(entry.workout ?? { source_status: "none", data_as_of: null, sessions: [] });
    const coros = cloneJson(entry.coros ?? { source_status: "none", data_as_of: null, activities: [] });
    coros.activities = Array.isArray(coros.activities) ? coros.activities : [];
    for (const activity of coros.activities) {
      const relativePath = activity?.fit_file?.snapshot_relative_path;
      if (!isSafeSnapshotPath(relativePath)) continue;
      try {
        activity.fit_bytes = new Uint8Array(await readFile(join(root, relativePath)));
      } catch (error) {
        activity.fit_file = { ...(activity.fit_file ?? {}), status: "error", error: { code: "snapshot_fit_read_failed", message: "Staged FIT artifact could not be read" } };
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") activity.fit_file.status = "error";
      }
    }
    corosByDate[targetDate] = coros;
  }
  return { workoutByDate, corosByDate };
}

/** @param {any} raw */
function extractActivityFitBytes(raw) {
  for (const value of [
    ...FIT_PAYLOAD_KEYS.map((key) => raw?.[key]),
    raw?.fit?.data,
    raw?.fit?.content,
    raw?.fit?.bytes,
    raw?.fitFile?.data,
    raw?.fitFile?.content,
    raw?.fitFile?.bytes,
    raw?.fit_file?.data,
    raw?.fit_file?.content,
    raw?.fit_file?.bytes,
  ]) {
    const bytes = toFitBytes(value);
    if (bytes) return bytes;
  }
  return null;
}

/** @param {Record<string, any>} activity */
function stripFitPayload(activity) {
  for (const key of FIT_PAYLOAD_KEYS) delete activity[key];
  for (const key of ["fit", "fitFile", "fit_file"]) {
    if (!activity[key] || typeof activity[key] !== "object" || Array.isArray(activity[key])) continue;
    for (const field of ["data", "content", "bytes"]) {
      if (field === "bytes" && typeof activity[key][field] === "number") continue;
      delete activity[key][field];
    }
  }
  return activity;
}

/** @param {any} raw */
function cloneJsonWithoutFitPayload(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  stripFitPayload(value);
  return cloneJson(value);
}

/** @param {unknown} value @returns {any} */
function cloneJson(value) {
  if (value === undefined) return null;
  return sanitizeSnapshotValue(value);
}

/** @param {unknown} value @param {number} [depth] @returns {any} */
function sanitizeSnapshotValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 20) return null;
  if (Array.isArray(value)) return value.map((item) => sanitizeSnapshotValue(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|credential|password|secret|authorization|cookie|bearer|raw[_ -]?envelope|mcp[_ -]?envelope)/i.test(key))
    .map(([key, child]) => [key, sanitizeSnapshotValue(child, depth + 1)]));
}

/** @param {unknown} value */
function isSafeSnapshotPath(value) {
  return typeof value === "string" && value.startsWith("fit/") && !value.includes("..") && !value.includes("\\") && !value.startsWith("/");
}

/** @param {string} path @param {unknown} value */
async function writeJsonAtomic(path, value) {
  await writeAtomicFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
