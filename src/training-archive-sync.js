// @ts-nocheck

import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { addDays, canonicalJson, isValidLocalDate, localDate, sha256Hex } from "./util.js";
import { COROS_LAP_TABLE_COLUMNS } from "./coros-field-catalog.js";
import { COROS_SPORT_TYPES, SOURCE_STATUSES, containsSensitiveText, normalizeCorosActivity, normalizeTimezone, safeAerobicActivity } from "./training-archive.js";
import { dailyHubModel, dailyHubNote, normalizeWorkoutSessionDetails, normalizeWorkoutSessionRecord, workoutIndexNote, workoutSessionDataPath, workoutSessionNote, workoutSessionRelativePath } from "./training-records.js";
import { assignRoute, readRouteRegistry, routeFilePath, routeLink, safeRouteProjection, writeRouteRegistry } from "./route-registry.js";
import { createAerobicProjectionPublisher } from "./training-archive-cloud-publisher.js";
import { decodeFitActivity, toFitBytes } from "./fit-decoder.js";
import { writeAtomicFile } from "./atomic-file.js";

const MAX_PUBLICATION_ATTEMPTS = 3;
const DEFAULT_CLOUD_TIMEOUT_MS = 30_000;
const SYNC_RECEIPT_DIR = [".sync", "training-archive"];
const SYNC_PHASES = ["source_read", "fit_decode", "local_archive", "cloud_publish"];
const PRIVACY_OMISSIONS = Object.freeze([
  "fit_file",
  "fit_path",
  "fit_bytes",
  "raw_fit",
  "gps",
  "telemetry",
  "sensor_streams",
  "absolute_vault_path",
  "credentials",
  "agent_token",
]);

/**
 * Run the two-stage Training Archive sync. Source adapters and the safe cloud
 * publisher are injected so this seam remains local, deterministic, and free
 * of COROS credentials, a real vault, or production D1.
 *
 * @param {{ archiveDir: string, timezone: string, targetDate?: string, now?: Date, workoutSource?: { read: Function }, corosSource?: { read: Function, readFit?: Function }, publish?: Function, applicationOrigin?: string, fetchImpl?: Function, credentials?: string, maxPublicationAttempts?: number }} options
 */
export async function syncTrainingArchive(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const timezone = normalizeTimezone(options.timezone);
  const targetDate = resolveSyncTargetDate(options.targetDate, now, timezone);
  if (typeof options.archiveDir !== "string" || !options.archiveDir.trim()) throw new Error("WORKOUT_ARCHIVE_DIR is required");
  const publish = options.publish ?? (options.applicationOrigin
    ? createAerobicProjectionPublisher({ origin: options.applicationOrigin, fetchImpl: options.fetchImpl, credentials: options.credentials })
    : null);
  if (typeof publish !== "function") throw new Error("A safe aerobic projection publisher is required");

  const priorReceipt = await readSyncReceipt(options.archiveDir, targetDate);
  if (shouldRetryMissingArtifacts(priorReceipt, options)) {
    return retryMissingArtifacts({ options, priorReceipt, targetDate, timezone, now, publish });
  }
  if (shouldRetryCloudOnly(priorReceipt, options)) {
    return retryPendingPublication({ options, priorReceipt, targetDate, timezone, now, publish });
  }

  const mode = options.syncMode === "refresh" || options.forceRefresh === true ? "refresh" : "resume";
  const snapshotId = safeReference(options.snapshotId);
  const phases = createSyncPhases();
  await persistPhaseCheckpoint(options.archiveDir, {
    targetDate,
    timezone,
    now,
    mode,
    snapshotId,
    phases,
    sourceStatus: { workout: "pending", coros: "pending" },
    errors: [],
  });

  const routeRead = await readRouteRegistry(options.archiveDir);
  const routeRegistry = routeRead.registry;
  const workoutResult = await readSource(options.workoutSource, "workout", targetDate, timezone, now);
  const corosResult = await readSource(options.corosSource, "coros", targetDate, timezone, now);
  const prepared = prepareCorosActivities(corosResult, targetDate, timezone, now, routeRegistry, options);
  const errors = [...workoutResult.errors, ...corosResult.errors, ...prepared.errors];
  phases.source_read = completedPhase(sourceReadPhaseStatus(workoutResult, corosResult), { statuses: { workout: workoutResult.source_status, coros: corosResult.source_status } });
  phases.fit_decode = completedPhase(prepared.fitDecode.error ? "partial" : (prepared.fitDecode.attempted ? "complete" : "skipped"), prepared.fitDecode);
  await persistPhaseCheckpoint(options.archiveDir, {
    targetDate,
    timezone,
    now,
    mode,
    snapshotId,
    phases,
    sourceStatus: { workout: workoutResult.source_status, coros: corosResult.source_status },
    sourceDataAsOf: { workout: workoutResult.data_as_of, coros: corosResult.data_as_of },
    errors,
    pendingArtifacts: prepared.pendingArtifacts,
  });
  const previousActivities = previousActivitiesForFailedSource(priorReceipt, corosResult.source_status);
  const activities = mergeActivities(prepared.activities, previousActivities);
  const protectedActivityRefs = new Set(previousActivities.map((activity) => activity.activity_ref));
  const activitiesToWrite = prepared.activities.filter((activity) => !protectedActivityRefs.has(activity.activity_ref));
  const sourceStatus = aggregateSourceStatus([workoutResult.source_status, corosResult.source_status]);
  const syncStatus = prepared.fitDecode.error ? aggregateSourceStatus([sourceStatus, "partial"]) : sourceStatus;

  phases.local_archive = runningPhase();
  await persistPhaseCheckpoint(options.archiveDir, {
    targetDate,
    timezone,
    now,
    mode,
    snapshotId,
    phases,
    sourceStatus: { workout: workoutResult.source_status, coros: corosResult.source_status },
    sourceDataAsOf: { workout: workoutResult.data_as_of, coros: corosResult.data_as_of },
    errors,
    pendingArtifacts: prepared.pendingArtifacts,
  });

  let localWrite;
  try {
    localWrite = await writeLocalArchive({
      archiveDir: options.archiveDir,
      targetDate,
      timezone,
      now,
      workout: workoutResult,
      coros: corosResult,
      activitiesToWrite,
      activitiesForNote: activities,
      fitBytesByRef: prepared.fitBytesByRef,
      routeRegistry,
      routeAssignments: prepared.routeAssignments,
      errors,
    });
  } catch (error) {
    const localError = safeError(error, "local", "local_archive_write_failed");
    errors.push(localError);
    localWrite = { write_status: "error", written_paths: [], fit_bytes: 0, workout_sessions: 0 };
  }

  phases.local_archive = completedPhase(localWrite.write_status === "complete" ? "complete" : "error", {
    write_status: localWrite.write_status,
    written_paths: localWrite.written_paths ?? [],
  });

  const projection = buildProjection({
    targetDate,
    timezone,
    workout: workoutResult,
    coros: corosResult,
    activities,
    routeRegistry,
  });

  let cloudPublication;
  if (localWrite.write_status !== "complete") {
    cloudPublication = {
      status: "error",
      published_count: 0,
      attempts: 0,
      retryable: false,
      idempotency_key: null,
      error: { code: "local_archive_write_failed", message: "Local archive stage failed; cloud publication was not attempted" },
      errors: [],
    };
    phases.cloud_publish = completedPhase("error", { skipped: true, code: "local_archive_write_failed" });
  } else {
    phases.cloud_publish = runningPhase();
    await persistPhaseCheckpoint(options.archiveDir, {
      targetDate,
      timezone,
      now,
      mode,
      snapshotId,
      phases,
      sourceStatus: { workout: workoutResult.source_status, coros: corosResult.source_status },
      sourceDataAsOf: { workout: workoutResult.data_as_of, coros: corosResult.data_as_of },
      errors,
      pendingArtifacts: prepared.pendingArtifacts,
    });
    cloudPublication = await publishProjection(publish, projection, options);
  }
  errors.push(...(cloudPublication.errors ?? []));
  phases.cloud_publish = completedPhase(cloudPublication.status === "complete" || (cloudPublication.status === "none" && projection.activities.length === 0) ? "complete" : cloudPublication.status === "partial" ? "partial" : "error", {
    status: cloudPublication.status,
    attempts: cloudPublication.attempts,
  });

  const receipt = makeReceipt({
    targetDate,
    timezone,
    now,
    sourceStatus: { workout: workoutResult.source_status, coros: corosResult.source_status },
    sourceDataAsOf: { workout: workoutResult.data_as_of, coros: corosResult.data_as_of },
    sourceStatusAggregate: syncStatus,
    dataAsOf: corosResult.data_as_of ?? workoutResult.data_as_of ?? null,
    localWrite,
    localStatus: localWrite.write_status === "complete" ? syncStatus : "error",
    cloudPublication,
    activitiesWritten: activitiesToWrite.length,
    activitiesPublished: cloudPublication.published_count,
    ignoredSportTypes: prepared.ignoredSportTypes,
    errors,
    pendingArtifacts: prepared.pendingArtifacts,
    routeAssignments: prepared.routeAssignments,
    routeRegistryPath: "config/routes.json",
    privacyEvidence: projectionPrivacyEvidence(projection, now),
    projection,
    mode,
    snapshotId,
    phases,
  });
  await persistReceipt(options.archiveDir, receipt, projection);
  return receipt;
}

/** @param {string|undefined} targetDate @param {Date} now @param {string} timezone */
export function resolveSyncTargetDate(targetDate, now, timezone) {
  if (targetDate === undefined) return addDays(localDate(now, timezone), -1);
  if (typeof targetDate !== "string" || !isValidLocalDate(targetDate)) throw new Error("targetDate must be an Athlete-local YYYY-MM-DD date");
  return targetDate;
}

async function readSource(adapter, source, targetDate, timezone, now) {
  if (!adapter || typeof adapter.read !== "function") {
    return {
      ...emptySource("error"),
      errors: [{ source, code: "source_not_configured", message: "Source adapter is not configured" }],
    };
  }
  try {
    const result = await adapter.read(targetDate, { timezone, now });
    const activities = Array.isArray(result?.activities) ? result.activities : [];
    const sessions = safeSessions(result?.sessions, targetDate, timezone, result?.data_as_of, result?.source_status);
    const sourceErrors = safeErrors(result?.errors, source);
    const inferredStatus = activities.length || sessions.length ? "complete" : "none";
    const inferredWithErrors = sourceErrors.length ? (activities.length || sessions.length ? "partial" : "error") : inferredStatus;
    let sourceStatus = result?.source_status ?? inferredWithErrors;
    if (sourceErrors.length && sourceStatus === "none") sourceStatus = activities.length || sessions.length ? "partial" : "error";
    if (!SOURCE_STATUSES.includes(sourceStatus)) throw new Error(`Unsupported source_status: ${String(sourceStatus)}`);
    return {
      source_status: sourceStatus,
      data_as_of: safeInstant(result?.data_as_of),
      activities,
      sessions,
      errors: sourceErrors,
    };
  } catch (error) {
    return {
      ...emptySource("error"),
      errors: [safeError(error, source, "source_read_failed")],
    };
  }
}

function emptySource(sourceStatus) {
  return { source_status: sourceStatus, data_as_of: null, activities: [], sessions: [], errors: [] };
}

function safeSessions(value, targetDate, timezone, dataAsOf, sourceStatus) {
  if (!Array.isArray(value)) return [];
  return value.map((session) => {
    const sessionKey = safeReference(session?.session_key ?? session?.sessionKey);
    if (!sessionKey) throw new Error("Workout Session must include a safe session_key");
    const scheduledDate = session?.scheduled_date ?? session?.local_date;
    if (typeof scheduledDate !== "string" || !isValidLocalDate(scheduledDate)) throw new Error(`Workout Session ${sessionKey} must include a valid scheduled_date`);
    const localDateValue = session?.local_date ?? scheduledDate;
    if (typeof localDateValue !== "string" || !isValidLocalDate(localDateValue)) throw new Error(`Workout Session ${sessionKey} must include a valid local_date`);
    const sourceRef = safeReference(session?.source_ref ?? session?.sourceRef);
    if (!sourceRef) throw new Error(`Workout Session ${sessionKey} must include a safe source_ref`);
    const title = typeof session?.title === "string" && session.title.trim() ? session.title.trim() : null;
    if (!title) throw new Error(`Workout Session ${sessionKey} must include a title`);
    const status = session?.status;
    if (!["planned", "in_progress", "completed", "partial", "abandoned", "skipped"].includes(status)) throw new Error(`Workout Session ${sessionKey} must include a supported status`);
    const normalizedDataAsOf = safeInstant(session?.data_as_of ?? session?.dataAsOf ?? dataAsOf);
    if (!normalizedDataAsOf) throw new Error(`Workout Session ${sessionKey} must include a valid data_as_of`);
    const details = normalizeWorkoutSessionDetails(session);
    return {
      session_key: sessionKey,
      source_ref: sourceRef,
      scheduled_date: scheduledDate,
      local_date: localDateValue,
      scheduled_workout_key: safeReference(session?.scheduled_workout_key ?? session?.scheduledWorkoutKey ?? details.scheduled_workout_key),
      plan_id: safeReference(session?.plan_id ?? session?.planId ?? details.plan_id),
      plan_revision_key: safeReference(session?.plan_revision_key ?? session?.planRevisionKey ?? details.plan_revision_key),
      title,
      status,
      completion_fraction: typeof session?.completion_fraction === "number" ? session.completion_fraction : null,
      training_duration_sec: typeof session?.training_duration_sec === "number" ? session.training_duration_sec : null,
      session_rpe: typeof session?.session_rpe === "number" ? session.session_rpe : null,
      source_status: SOURCE_STATUSES.includes(session?.source_status) ? session.source_status : sourceStatus,
      data_as_of: normalizedDataAsOf,
      updated_at: safeInstant(session?.updated_at ?? session?.updatedAt),
      timezone,
      details,
    };
  }).filter(Boolean);
}

function prepareCorosActivities(coros, targetDate, timezone, now, routeRegistry, options = {}) {
  const byRef = new Map();
  const fitBytesByRef = new Map();
  const pendingArtifacts = [];
  const ignoredSportTypes = [];
  const errors = [];
  const routeAssignments = { matched: 0, registered: 0, unmatched: 0, ambiguous: 0, ignored: 0, error: 0 };
  const fitDecode = { attempted: 0, complete: 0, error: 0, skipped: 0 };
  for (const raw of coros.activities) {
    const rawSportType = raw?.sport_type ?? raw?.sportType;
    if (!isInScopeSportType(rawSportType)) {
      if (rawSportType !== undefined && rawSportType !== null) ignoredSportTypes.push(rawSportType);
      continue;
    }
    const activityRef = safeReference(raw?.activity_ref ?? raw?.activityRef ?? raw?.labelId);
    try {
      const fitBytes = extractFitBytes(raw);
      const fitStatus = deriveFitStatus(raw, fitBytes);
      const fitResult = decodeFitForRoute(fitBytes, activityRef);
      fitDecode[fitResult.status === "complete" ? "complete" : fitResult.status === "error" ? "error" : "skipped"] += 1;
      if (fitBytes && fitBytes.byteLength > 0) fitDecode.attempted += 1;
      if (fitResult.status === "error") {
        errors.push(fitResult.error);
      }
      const routeRaw = fitBytes && fitResult.status === "complete" ? { ...raw, fit_points: fitResult.points } : raw;
      const routeMatch = fitResult.status === "error"
        ? { status: "error", route_key: null, route_direction: null, matcher_version: null, registration_proposal: null }
        : assignRoute({ raw: routeRaw, activityRef, registry: routeRegistry, options });
      routeAssignments[routeMatch.status] = (routeAssignments[routeMatch.status] ?? 0) + 1;
      const activityStatus = deriveActivityStatus(raw, coros.source_status, fitStatus, fitResult.status);
      const fitFile = {
        ...(raw?.fit_file && typeof raw.fit_file === "object" ? raw.fit_file : {}),
        status: fitStatus,
        bytes: fitBytes ? fitBytes.byteLength : raw?.fit_file?.bytes ?? raw?.fitFile?.bytes ?? null,
        decode_status: fitResult.status,
      };
      const activity = normalizeCorosActivity({
        ...raw,
        route_key: routeMatch.route_key,
        route_direction: routeMatch.route_direction,
        route_match_status: routeMatch.status,
        source_status: activityStatus,
        fit_file: fitFile,
      }, {
        timezone,
        targetDate,
        dataAsOf: coros.data_as_of,
        sourceStatus: activityStatus,
        updatedAt: now.toISOString(),
      });
      if (activity.local_date !== targetDate) continue;
      activity.fit_file.relative_path = `data/coros/${targetDate}-${fileComponent(activity.activity_ref)}.fit`;
      byRef.set(activity.activity_ref, activity);
      if (fitBytes && fitBytes.byteLength > 0) fitBytesByRef.set(activity.activity_ref, fitBytes);
      if (fitStatus !== "complete" && hasFitOutcome(raw)) {
        pendingArtifacts.push({ kind: "fit", activity_ref: activity.activity_ref, relative_path: activity.fit_file.relative_path, status: fitStatus });
      }
      errors.push(...activityDiagnostics(raw, activity.activity_ref, fitStatus));
    } catch (error) {
      routeAssignments.error += 1;
      errors.push(safeError(error, "coros", "invalid_activity", activityRef));
    }
  }
  return { activities: [...byRef.values()], fitBytesByRef, pendingArtifacts, ignoredSportTypes: [...new Set(ignoredSportTypes)], errors, routeAssignments, fitDecode };
}

function decodeFitForRoute(bytes, activityRef) {
  if (!bytes || bytes.byteLength === 0) return { status: "skipped", points: [], error: null };
  try {
    const decoded = decodeFitActivity(bytes);
    return { status: "complete", points: decoded.points, diagnostics: decoded.diagnostics, error: null };
  } catch (error) {
    return {
      status: "error",
      points: [],
      error: safeError(error, "coros", error?.code ?? "fit_decode_failed", activityRef),
    };
  }
}

function activityDiagnostics(raw, activityRef, fitStatus) {
  const errors = [];
  for (const [field, code, label] of [
    ["detail_status", "coros_detail_partial", "COROS detail data is incomplete"],
    ["lap_status", "coros_lap_partial", "COROS lap data is incomplete"],
  ]) {
    const status = activityPartStatus(raw, field.replace("_status", ""));
    if (["partial", "error"].includes(status)) errors.push({ source: "coros", code, message: label, activity_ref: activityRef });
  }
  if (fitStatus !== "complete" && hasFitOutcome(raw)) {
    const fitError = raw?.fit_error ?? raw?.fit?.error ?? raw?.fitFile?.error ?? raw?.fit_file?.error;
    errors.push(safeError(fitError ?? { code: fitStatus === "error" ? "fit_download_failed" : "fit_unavailable", message: fitStatus === "error" ? "FIT download failed" : "FIT artifact is incomplete" }, "coros", fitStatus === "error" ? "fit_download_failed" : "fit_unavailable", activityRef));
  }
  return errors;
}

function deriveActivityStatus(raw, sourceStatus, fitStatus, fitDecodeStatus = "skipped") {
  const explicit = raw?.source_status ?? raw?.sourceStatus;
  if (explicit === "error") return "error";
  if (sourceStatus === "error") return "error";
  const fitFailure = (fitStatus !== "complete" && hasFitOutcome(raw)) || fitDecodeStatus === "error";
  if (explicit === "partial" || sourceStatus === "partial" || fitFailure || [activityPartStatus(raw, "detail"), activityPartStatus(raw, "lap")].some((status) => ["partial", "error"].includes(status))) return "partial";
  return sourceStatus;
}

function activityPartStatus(raw, part) {
  const value = raw?.[`${part}_status`] ?? raw?.[part];
  if (typeof value === "string") return value;
  return value?.status ?? value?.source_status ?? null;
}

function hasFitOutcome(raw) {
  return raw?.fit_status !== undefined
    || raw?.fitStatus !== undefined
    || raw?.fit_error !== undefined
    || raw?.fit?.status !== undefined
    || raw?.fit?.fit_status !== undefined
    || raw?.fit_file?.status !== undefined
    || raw?.fit_file?.fit_status !== undefined
    || raw?.fitFile?.status !== undefined
    || raw?.fitFile?.fit_status !== undefined
    || extractFitBytes(raw) !== null;
}

function deriveFitStatus(raw, fitBytes) {
  const declared = raw?.fit_file?.status ?? raw?.fit_file?.fit_status ?? raw?.fit?.status ?? raw?.fit?.fit_status ?? raw?.fit_status ?? raw?.fitStatus;
  if (fitBytes && fitBytes.byteLength > 0) return "complete";
  if (declared === "error") return "error";
  if (declared === "complete") return "error";
  return declared === "partial" ? "partial" : "partial";
}

function extractFitBytes(raw) {
  for (const value of [raw?.fit_bytes, raw?.fitBytes, raw?.fit_data, raw?.fitData, raw?.fit_content, raw?.fit?.data, raw?.fit?.content, raw?.fit?.bytes, raw?.fit_file?.data, raw?.fitFile?.data, raw?.fit_file?.content, raw?.fitFile?.content, raw?.fit_file?.bytes, raw?.fitFile?.bytes]) {
    const bytes = toBytes(value);
    if (bytes) return bytes;
  }
  return null;
}

function toBytes(value) {
  return toFitBytes(value);
}

async function writeLocalArchive({ archiveDir, targetDate, timezone, now, workout, coros, activitiesToWrite, activitiesForNote, fitBytesByRef, routeRegistry, routeAssignments, errors }) {
  const dailyPath = join(archiveDir, "daily", `${targetDate}.md`);
  const activityPaths = [];
  const workoutPaths = [];
  const routePaths = [];
  let fitBytes = 0;
  await mkdir(join(archiveDir, "daily"), { recursive: true });
  await mkdir(join(archiveDir, "data", "coros"), { recursive: true });
  await mkdir(join(archiveDir, "data", "workout"), { recursive: true });
  await mkdir(join(archiveDir, "workout", "sessions"), { recursive: true });

  const workoutRecords = (workout.sessions ?? [])
    .map((session) => normalizeWorkoutSessionRecord(session, {
      timezone,
      dataAsOf: workout.data_as_of,
      sourceStatus: workout.source_status,
      includeDetails: true,
    }))
    .filter((record) => record.local_date === targetDate);
  for (const record of workoutRecords) {
    const sessionPath = join(archiveDir, `${workoutSessionRelativePath(record.local_date, record.session_key)}.md`);
    const sessionDataPath = join(archiveDir, `${workoutSessionDataPath(record.local_date, record.session_key)}.json`);
    await writeAtomicFile(sessionPath, workoutSessionNote(record), "utf8");
    await writeAtomicFile(sessionDataPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    workoutPaths.push(relativePath(archiveDir, sessionPath), relativePath(archiveDir, sessionDataPath));
  }
  const indexPath = join(archiveDir, "workout", "index.md");
  await writeAtomicFile(indexPath, workoutIndexNote(), "utf8");
  workoutPaths.push(relativePath(archiveDir, indexPath));
  for (const activity of activitiesToWrite) {
    const stem = `${targetDate}-${fileComponent(activity.activity_ref)}`;
    const jsonPath = join(archiveDir, "data", "coros", `${stem}.json`);
    const notePath = join(archiveDir, "data", "coros", `${stem}.md`);
    const fitPath = join(archiveDir, "data", "coros", `${stem}.fit`);
    const bytes = fitBytesByRef.get(activity.activity_ref);
    if (bytes && bytes.byteLength > 0) {
      await writeAtomicFile(fitPath, bytes);
      activity.fit_file = { ...activity.fit_file, relative_path: `data/coros/${stem}.fit`, status: "complete", mime_type: "application/octet-stream", bytes: bytes.byteLength };
      fitBytes += bytes.byteLength;
      activityPaths.push(relativePath(archiveDir, fitPath));
    }
    await writeAtomicFile(jsonPath, `${JSON.stringify(activity, null, 2)}\n`, "utf8");
    await writeAtomicFile(notePath, corosActivityNote(activity), "utf8");
    activityPaths.push(relativePath(archiveDir, jsonPath), relativePath(archiveDir, notePath));
  }
  const routeHistoryActivities = mergeActivityHistory(await readArchivedActivities(archiveDir), activitiesForNote);
  const routeRegistryPath = await writeRouteRegistry(archiveDir, routeRegistry);
  routePaths.push(relativePath(archiveDir, routeRegistryPath));
  await mkdir(join(archiveDir, "routes"), { recursive: true });
  for (const route of routeRegistry.routes) {
    const routePath = routeFilePath(archiveDir, route.route_key);
    await writeAtomicFile(routePath, routeNote(route, routeHistoryActivities), "utf8");
    routePaths.push(relativePath(archiveDir, routePath));
  }
  const routeIndexPath = join(archiveDir, "routes", "index.md");
  await writeAtomicFile(routeIndexPath, routeIndexNote(routeRegistry, routeHistoryActivities), "utf8");
  routePaths.push(relativePath(archiveDir, routeIndexPath));
  await writeAtomicFile(dailyPath, dailyNote({ targetDate, timezone, now, workout, coros, activities: activitiesForNote, errors }), "utf8");
  return { write_status: "complete", written_paths: [relativePath(archiveDir, dailyPath), ...workoutPaths, ...activityPaths, ...routePaths], fit_bytes: fitBytes, workout_sessions: workoutRecords.length, route_assignments: routeAssignments };
}

async function readArchivedActivities(archiveDir) {
  let names;
  try {
    names = await readdir(join(archiveDir, "data", "coros"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    try {
      const value = JSON.parse(await readFile(join(archiveDir, "data", "coros", name), "utf8"));
      records.push(safeAerobicActivity(value));
    } catch {
      // A malformed historical sidecar must not prevent a new date from syncing.
    }
  }
  return records;
}

function mergeActivityHistory(existing, current) {
  const byRef = new Map();
  for (const activity of [...existing, ...current]) {
    try {
      const safe = safeAerobicActivity(activity);
      byRef.set(safe.activity_ref, safe);
    } catch {
      // Route history is a derived view; an invalid sidecar is not a new source fact.
    }
  }
  return [...byRef.values()];
}

function buildProjection({ targetDate, timezone, workout, coros, activities, routeRegistry }) {
  const sourceStatus = aggregateSourceStatus([workout.source_status, coros.source_status]);
  return {
    schema_version: 1,
    publication_key: `training-archive:${targetDate}`,
    source_ref: `training-archive:${targetDate}`,
    target_date: targetDate,
    timezone,
    source_status: sourceStatus,
    source_statuses: { workout: workout.source_status, coros: coros.source_status },
    workout_source_status: workout.source_status,
    source_data_as_of: { workout: workout.data_as_of, coros: coros.data_as_of },
    data_as_of: coros.data_as_of ?? workout.data_as_of ?? null,
    activities: activities.map(safeAerobicActivity),
    routes: routeRegistry.routes.map(safeRouteProjection),
  };
}

async function publishProjection(publish, projection, options) {
  const maxAttempts = publicationAttempts(options);
  const idempotencyKey = await projectionRequestIdempotencyKey(projection);
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await publishWithTimeout(publish, projection, {
        idempotency_key: idempotencyKey,
        attempt,
        max_attempts: maxAttempts,
      }, publicationTimeout(options));
      const status = publicationStatus(result?.status ?? (projection.activities.length ? "complete" : "none"));
      const publishedCount = boundedCount(result?.published_count, status === "complete" ? projection.activities.length : 0, projection.activities.length);
      const error = result?.error ? safeError(result.error, "cloud", result.error.code ?? "projection_publish_failed") : (status === "partial" || status === "error" ? { code: status === "partial" ? "projection_partial" : "projection_publish_failed", message: "Cloud publication did not complete" } : null);
      last = { status, published_count: publishedCount, attempts: attempt, retryable: status === "partial" || status === "error", idempotency_key: idempotencyKey, error, errors: error ? [error] : [] };
      if (status === "complete" || (status === "none" && projection.activities.length === 0)) return last;
    } catch (error) {
      const normalized = safeError(error, "cloud", "projection_publish_failed");
      last = { status: "error", published_count: 0, attempts: attempt, retryable: error?.retryable !== false, idempotency_key: idempotencyKey, error: normalized, errors: [normalized] };
    }
  }
  return last ?? { status: "error", published_count: 0, attempts: maxAttempts, retryable: true, idempotency_key: idempotencyKey, error: { code: "projection_publish_failed", message: "Cloud publication did not complete" }, errors: [] };
}

/**
 * Keep the logical publication identity stable while binding the HTTP retry
 * key to the exact safe projection body. This lets a same-date refresh update
 * D1 without colliding with the private mutation idempotency record.
 * @param {any} projection
 */
export async function projectionRequestIdempotencyKey(projection) {
  if (!projection || typeof projection.publication_key !== "string" || !projection.publication_key.trim()) throw new Error("projection.publication_key is required");
  return `${projection.publication_key}:${await sha256Hex(canonicalJson(projection))}`;
}

function publicationAttempts(options) {
  const requested = options.maxPublicationAttempts ?? MAX_PUBLICATION_ATTEMPTS;
  const number = Number(requested);
  if (!Number.isFinite(number)) return 1;
  return Math.min(MAX_PUBLICATION_ATTEMPTS, Math.max(1, Math.floor(number)));
}

function publicationTimeout(options) {
  const requested = Number(options.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS);
  if (!Number.isFinite(requested)) return DEFAULT_CLOUD_TIMEOUT_MS;
  return Math.max(1, Math.min(120_000, Math.floor(requested)));
}

async function publishWithTimeout(publish, projection, context, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const operation = Promise.resolve().then(() => publish(projection, { ...context, ...(controller ? { signal: controller.signal } : {}) }));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(Object.assign(new Error("Cloud publication timed out"), { code: "cloud_timeout", retryable: true }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
    operation.catch(() => {});
  }
}

function makeReceipt({ targetDate, timezone, now, sourceStatus, sourceDataAsOf, sourceStatusAggregate, dataAsOf, localWrite, localStatus, cloudPublication, activitiesWritten, activitiesPublished, ignoredSportTypes, errors, pendingArtifacts = [], routeAssignments = {}, routeRegistryPath, privacyEvidence, projection, mode = "resume", snapshotId = null, phases = createSyncPhases() }) {
  return {
    schema_version: 1,
    sync_ref: `training-sync:${targetDate}:${now.toISOString()}`,
    publication_key: projection.publication_key,
    mode,
    snapshot_id: snapshotId,
    target_date: targetDate,
    timezone,
    captured_at: now.toISOString(),
    data_as_of: dataAsOf,
    source_data_as_of: sourceDataAsOf,
    status: localWrite.write_status !== "complete" ? "error" : (cloudPublication.status === "error" || cloudPublication.status === "partial" ? "partial" : sourceStatusAggregate),
    source_status: sourceStatus,
    local_archive: {
      status: localStatus,
      write_status: localWrite.write_status,
      written_paths: localWrite.written_paths,
      fit_bytes: localWrite.fit_bytes,
      reused: false,
    },
    cloud_publication: cloudPublication,
    records_written: { daily_hubs: localWrite.write_status === "complete" ? 1 : 0, workout_sessions: localWrite.write_status === "complete" ? (localWrite.workout_sessions ?? 0) : 0, activities: activitiesWritten },
    records_published: { activities: activitiesPublished },
    pending_artifacts: pendingArtifacts,
    phases,
    route_assignments: routeAssignments,
    route_registry_path: routeRegistryPath ?? "config/routes.json",
    privacy_evidence: privacyEvidence ?? projectionPrivacyEvidence(projection, now),
    ignored_sport_types: ignoredSportTypes,
    errors,
    receipt_path: receiptRelativePath(targetDate),
  };
}

function shouldRetryMissingArtifacts(priorReceipt, options) {
  return typeof options.corosSource?.readFit === "function"
    && Array.isArray(priorReceipt?.pending_artifacts)
    && priorReceipt.pending_artifacts.some((artifact) => artifact?.kind === "fit" && safeReference(artifact.activity_ref));
}

async function retryMissingArtifacts({ options, priorReceipt, targetDate, timezone, now, publish }) {
  const pending = (priorReceipt.pending_artifacts ?? []).filter((artifact) => artifact?.kind === "fit" && safeReference(artifact.activity_ref));
  const localActivities = Array.isArray(priorReceipt.local_projection?.activities) ? priorReceipt.local_projection.activities.map(safeAerobicActivity) : [];
  const resolvedRefs = new Set();
  const retryErrors = [];
  let fitBytes = 0;

  for (const artifact of pending) {
    const activityRef = safeReference(artifact.activity_ref);
    try {
      const result = await options.corosSource.readFit(activityRef, { targetDate, timezone, now, relative_path: artifact.relative_path });
      const bytes = extractRetryFitBytes(result);
      if (!bytes || bytes.byteLength === 0) throw Object.assign(new Error("FIT artifact was not returned"), { code: "fit_retry_empty" });
      await writeRetriedFitArtifact(options.archiveDir, targetDate, activityRef, bytes);
      resolvedRefs.add(activityRef);
      fitBytes += bytes.byteLength;
    } catch (error) {
      retryErrors.push(safeError(error, "coros", "fit_retry_failed", activityRef));
    }
  }

  const updatedActivities = localActivities.map((activity) => resolvedRefs.has(activity.activity_ref) ? { ...activity, fit_status: "complete" } : activity);
  const remainingArtifacts = pending.filter((artifact) => !resolvedRefs.has(artifact.activity_ref));
  let projection = safePendingProjection(priorReceipt.pending_projection);
  if (projection) projection = { ...projection, activities: updatedActivities.map(safeAerobicActivity) };
  let cloudPublication = priorReceipt.cloud_publication ?? { status: "none", published_count: 0, attempts: 0, retryable: false, errors: [] };
  if (projection && cloudPublication.status !== "complete") cloudPublication = { ...await publishProjection(publish, projection, options), retried: true };

  const sourceStatus = priorReceipt.source_status && typeof priorReceipt.source_status === "object"
    ? priorReceipt.source_status
    : { workout: "none", coros: "none" };
  const sourceStatusAggregate = aggregateSourceStatus([sourceStatus.workout, sourceStatus.coros]);
  const priorErrors = Array.isArray(priorReceipt.errors) ? priorReceipt.errors.filter((error) => !resolvedRefs.has(error.activity_ref)) : [];
  const receipt = {
    schema_version: 1,
    sync_ref: `training-sync:${targetDate}:${now.toISOString()}`,
    publication_key: projection?.publication_key ?? priorReceipt.publication_key ?? `training-archive:${targetDate}`,
    retry_of: priorReceipt.sync_ref ?? null,
    mode: "resume",
    snapshot_id: priorReceipt.snapshot_id ?? null,
    target_date: targetDate,
    timezone,
    captured_at: now.toISOString(),
    data_as_of: priorReceipt.data_as_of ?? null,
    source_data_as_of: priorReceipt.source_data_as_of ?? null,
    status: cloudPublication.status === "error" || cloudPublication.status === "partial" || remainingArtifacts.length ? "partial" : sourceStatusAggregate,
    source_status: sourceStatus,
    local_archive: {
      ...(priorReceipt.local_archive ?? {}),
      status: remainingArtifacts.length ? "partial" : (priorReceipt.local_archive?.status ?? "complete"),
      reused: true,
      fit_bytes: Number(priorReceipt.local_archive?.fit_bytes ?? 0) + fitBytes,
    },
    cloud_publication: cloudPublication,
    records_written: { daily_hubs: 0, workout_sessions: 0, activities: 0 },
    records_published: { activities: cloudPublication.published_count ?? 0 },
    privacy_evidence: projection ? projectionPrivacyEvidence(projection, now) : (priorReceipt.privacy_evidence ?? null),
    ignored_sport_types: priorReceipt.ignored_sport_types ?? [],
    pending_artifacts: remainingArtifacts,
    phases: {
      ...(priorReceipt.phases ?? createSyncPhases()),
      cloud_publish: completedPhase(cloudPublication.status === "complete" || (cloudPublication.status === "none" && !projection?.activities?.length) ? "complete" : cloudPublication.status === "partial" ? "partial" : "error", { retried: true }),
    },
    errors: [...priorErrors, ...retryErrors, ...(cloudPublication.errors ?? [])],
    receipt_path: receiptRelativePath(targetDate),
  };
  const persistedProjection = projection ?? { schema_version: 1, publication_key: receipt.publication_key, source_ref: receipt.publication_key, target_date: targetDate, timezone, source_status: sourceStatusAggregate, source_statuses: sourceStatus, data_as_of: receipt.data_as_of, activities: updatedActivities };
  await persistReceipt(options.archiveDir, receipt, persistedProjection, updatedActivities);
  return receipt;
}

function extractRetryFitBytes(result) {
  const value = result && typeof result === "object" && !(result instanceof Uint8Array) && !(typeof Buffer !== "undefined" && Buffer.isBuffer(result))
    ? (result.bytes ?? result.fit_bytes ?? result.data ?? result.content)
    : result;
  return toBytes(value);
}

async function writeRetriedFitArtifact(archiveDir, targetDate, activityRef, bytes) {
  const stem = `${targetDate}-${fileComponent(activityRef)}`;
  const relativeFitPath = `data/coros/${stem}.fit`;
  const fitPath = join(archiveDir, relativeFitPath);
  await mkdir(dirname(fitPath), { recursive: true });
  await writeAtomicFile(fitPath, bytes);

  const jsonPath = join(archiveDir, "data", "coros", `${stem}.json`);
  const record = JSON.parse(await readFile(jsonPath, "utf8"));
  record.fit_file = { ...(record.fit_file ?? {}), relative_path: relativeFitPath, status: "complete", mime_type: "application/octet-stream", bytes: bytes.byteLength };
  await writeAtomicFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const notePath = join(archiveDir, "data", "coros", `${stem}.md`);
  try {
    await writeAtomicFile(notePath, corosActivityNote(record), "utf8");
  } catch {
    // The JSON sidecar is the required record; an absent note is not a reason to duplicate source reads.
  }
}

function shouldRetryCloudOnly(priorReceipt, options) {
  return options.retryCloudOnly !== false
    && priorReceipt?.local_archive?.write_status === "complete"
    && priorReceipt?.cloud_publication?.status !== "complete"
    && priorReceipt?.pending_projection
    && Array.isArray(priorReceipt.pending_projection.activities);
}

async function retryPendingPublication({ options, priorReceipt, targetDate, timezone, now, publish }) {
  const projection = safePendingProjection(priorReceipt.pending_projection);
  if (!projection) return syncTrainingArchive({ ...options, timezone, retryCloudOnly: false });
  const cloudPublication = await publishProjection(publish, projection, options);
  const sourceStatus = priorReceipt.source_status ?? projection.source_statuses ?? { workout: "none", coros: projection.source_status ?? "none" };
  const sourceStatusAggregate = aggregateSourceStatus([sourceStatus.workout, sourceStatus.coros]);
  const receipt = {
    schema_version: 1,
    sync_ref: `training-sync:${targetDate}:${now.toISOString()}`,
    publication_key: projection.publication_key,
    retry_of: priorReceipt.sync_ref ?? null,
    mode: "resume",
    snapshot_id: priorReceipt.snapshot_id ?? null,
    target_date: targetDate,
    timezone,
    captured_at: now.toISOString(),
    data_as_of: priorReceipt.data_as_of ?? null,
    source_data_as_of: priorReceipt.source_data_as_of ?? null,
    status: cloudPublication.status === "error" || cloudPublication.status === "partial" ? "partial" : (sourceStatusAggregate === "error" ? "error" : sourceStatusAggregate),
    source_status: sourceStatus,
    local_archive: { ...priorReceipt.local_archive, reused: true },
    cloud_publication: { ...cloudPublication, retried: true },
    records_written: { daily_hubs: 0, workout_sessions: 0, activities: 0 },
    records_published: { activities: cloudPublication.published_count },
    privacy_evidence: projectionPrivacyEvidence(projection, now),
    ignored_sport_types: priorReceipt.ignored_sport_types ?? [],
    phases: {
      ...(priorReceipt.phases ?? createSyncPhases()),
      cloud_publish: completedPhase(cloudPublication.status === "complete" || (cloudPublication.status === "none" && !projection.activities.length) ? "complete" : cloudPublication.status === "partial" ? "partial" : "error", { retried: true }),
    },
    errors: cloudPublication.errors ?? [],
    receipt_path: receiptRelativePath(targetDate),
  };
  await persistReceipt(options.archiveDir, receipt, projection, priorReceipt.local_projection?.activities ?? projection.activities);
  return receipt;
}

async function persistReceipt(archiveDir, receipt, projection, localActivities = projection.activities) {
  const persisted = {
    ...receipt,
    local_projection: { activities: localActivities.map(safeAerobicActivity) },
    pending_artifacts: receipt.pending_artifacts ?? [],
    pending_projection: receipt.cloud_publication.status === "complete" || (receipt.cloud_publication.status === "none" && projection.activities.length === 0) ? null : projection,
  };
  try {
    await writeReceiptFile(archiveDir, receipt.target_date, persisted);
    receipt.receipt_persisted = true;
  } catch (error) {
    receipt.receipt_persisted = false;
    receipt.errors.push(safeError(error, "local", "sync_receipt_write_failed"));
    if (receipt.status === "complete") receipt.status = "partial";
  }
}

function createSyncPhases() {
  return Object.fromEntries(SYNC_PHASES.map((name) => [name, { status: "pending" }]));
}

function runningPhase(details = {}) {
  return { status: "running", ...details };
}

function completedPhase(status, details = {}) {
  return { status, ...details };
}

function sourceReadPhaseStatus(workout, coros) {
  const statuses = [workout.source_status, coros.source_status];
  if (statuses.every((status) => status === "error")) return "error";
  if (statuses.some((status) => status === "error" || status === "partial")) return "partial";
  return "complete";
}

async function persistPhaseCheckpoint(archiveDir, { targetDate, timezone, now, mode, snapshotId, phases, sourceStatus, sourceDataAsOf = null, errors = [], pendingArtifacts = [] }) {
  const checkpoint = {
    schema_version: 1,
    sync_ref: `training-sync:${targetDate}:${now.toISOString()}`,
    publication_key: `training-archive:${targetDate}`,
    mode,
    snapshot_id: snapshotId,
    target_date: targetDate,
    timezone,
    captured_at: now.toISOString(),
    status: "running",
    source_status: sourceStatus,
    source_data_as_of: sourceDataAsOf,
    phases,
    local_archive: { status: phases.local_archive?.status ?? "pending", write_status: phases.local_archive?.status === "complete" ? "complete" : "pending", reused: false },
    cloud_publication: { status: phases.cloud_publish?.status ?? "pending", published_count: 0, attempts: 0, retryable: true, errors: [] },
    pending_artifacts: pendingArtifacts,
    errors,
    receipt_path: receiptRelativePath(targetDate),
  };
  try {
    await writeReceiptFile(archiveDir, targetDate, checkpoint);
  } catch {
    // The actual local archive stage remains authoritative if the checkpoint path is unavailable.
  }
}

async function writeReceiptFile(archiveDir, targetDate, value) {
  const path = join(archiveDir, ...SYNC_RECEIPT_DIR, `${targetDate}.json`);
  await writeAtomicFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readSyncReceipt(archiveDir, targetDate) {
  if (typeof archiveDir !== "string" || !archiveDir.trim()) return null;
  try {
    const value = JSON.parse(await readFile(join(archiveDir, ...SYNC_RECEIPT_DIR, `${targetDate}.json`), "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function safePendingProjection(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || !Array.isArray(value.activities)) throw new Error("Persisted pending projection is invalid");
  return {
    schema_version: 1,
    publication_key: requiredReference(value.publication_key, "publication_key"),
    source_ref: safeReference(value.source_ref),
    target_date: value.target_date,
    timezone: normalizeTimezone(value.timezone),
    source_status: persistedStatus(value.source_status, "source_status"),
    source_statuses: {
      workout: persistedStatus(value.source_statuses?.workout, "source_statuses.workout"),
      coros: persistedStatus(value.source_statuses?.coros, "source_statuses.coros"),
    },
    workout_source_status: persistedStatus(value.workout_source_status ?? value.source_statuses?.workout, "workout_source_status"),
    source_data_as_of: {
      workout: safeInstant(value.source_data_as_of?.workout),
      coros: safeInstant(value.source_data_as_of?.coros),
    },
    data_as_of: safeInstant(value.data_as_of),
    activities: value.activities.map(safeAerobicActivity),
    routes: Array.isArray(value.routes) ? value.routes.map((route) => safeRouteProjection(route)) : [],
  };
}

function projectionPrivacyEvidence(projection, now) {
  const serialized = JSON.stringify(projection);
  const patterns = [
    ["fit_file", /fit[_-]file/i],
    ["fit_path", /fit[_-]path|\.fit\b/i],
    ["fit_bytes", /fit[_-]bytes/i],
    ["raw_fit", /raw[_-]?fit/i],
    ["gps", /gps|coordinate|latitude|longitude|polyline|geometry/i],
    ["telemetry", /telemetry|sensor/i],
    ["absolute_vault_path", /(?:\/Users\/|\/private\/|\/var\/|[A-Za-z]:\\)/i],
    ["credentials", /credential|password|secret|bearer|token/i],
  ];
  const violations = patterns.filter(([, pattern]) => pattern.test(serialized)).map(([name]) => name);
  return {
    status: violations.length ? "failed" : "passed",
    checked_at: now.toISOString(),
    scope: "safe_cloud_projection",
    omitted_fields: [...PRIVACY_OMISSIONS],
    violations,
  };
}

function persistedStatus(value, field) {
  if (value === undefined || value === null) return "none";
  if (!SOURCE_STATUSES.includes(value)) throw new Error(`Invalid persisted ${field}`);
  return value;
}

function requiredReference(value, field) {
  const reference = safeReference(value);
  if (!reference) throw new Error(`Invalid persisted ${field}`);
  return reference;
}

function previousActivitiesForFailedSource(priorReceipt, sourceStatus) {
  if (!["partial", "error"].includes(sourceStatus) || !Array.isArray(priorReceipt?.local_projection?.activities)) return [];
  return priorReceipt.local_projection.activities.flatMap((activity) => {
    try { return [safeAerobicActivity(activity)]; } catch { return []; }
  });
}

function mergeActivities(current, previous) {
  const merged = new Map(previous.map((activity) => [activity.activity_ref, activity]));
  for (const activity of current) {
    const previousActivity = merged.get(activity.activity_ref);
    if (previousActivity && previousActivity.source_status === "complete" && ["partial", "error"].includes(activity.source_status)) continue;
    merged.set(activity.activity_ref, activity);
  }
  return [...merged.values()].sort((left, right) => (right.started_at ?? "").localeCompare(left.started_at ?? "") || right.activity_ref.localeCompare(left.activity_ref));
}

function aggregateSourceStatus(statuses) {
  const filtered = statuses.filter((status) => SOURCE_STATUSES.includes(status));
  if (!filtered.length || filtered.every((status) => status === "none")) return "none";
  if (filtered.every((status) => status === "complete" || status === "none")) return "complete";
  if (filtered.some((status) => status === "partial") || filtered.some((status) => status === "error" && filtered.some((other) => other === "complete" || other === "partial"))) return "partial";
  return "error";
}

function publicationStatus(value) {
  return SOURCE_STATUSES.includes(value) ? value : "error";
}

function boundedCount(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(number)));
}

function safeErrors(value, source) {
  return Array.isArray(value) ? value.map((error) => safeError(error, source, error?.code ?? "source_error")) : [];
}

function safeError(error, source, fallbackCode, activityRef = null) {
  const code = safeCode(error?.code ?? fallbackCode) ?? fallbackCode;
  const rawMessage = typeof error?.message === "string" ? error.message : (typeof error === "string" ? error : "Operation failed");
  const message = containsSensitiveText(rawMessage) ? "Operation failed; sensitive details redacted" : rawMessage.slice(0, 240);
  return { source, code, message, ...(activityRef ? { activity_ref: activityRef } : {}) };
}

function safeCode(value) {
  return typeof value === "string" && /^[a-z0-9_.-]{1,80}$/i.test(value) ? value : null;
}

function safeReference(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const reference = value.trim();
  return containsSensitiveText(reference) || reference.includes("/") || reference.includes("\\") ? null : reference;
}

function safeInstant(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function isInScopeSportType(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && Object.hasOwn(COROS_SPORT_TYPES, number);
}

function fileComponent(value) {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function relativePath(root, value) {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return value.slice(prefix.length).replaceAll("\\", "/");
}

function receiptRelativePath(targetDate) {
  return `${SYNC_RECEIPT_DIR.join("/")}/${targetDate}.json`;
}

function yamlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function listYaml(values) {
  return values.length ? values.map((value) => `  - ${yamlValue(value)}`).join("\n") : "  []";
}

export function corosActivityNote(activity) {
  const routeLines = activity.route_key
    ? [`route_key: ${yamlValue(activity.route_key)}`, `route_direction: ${yamlValue(activity.route_direction)}`, `route_match_status: ${yamlValue(activity.route_match_status ?? "matched")}`, `route: ${yamlValue(routeLink(activity.route_key))}`]
    : [`route_key: null`, `route_direction: null`, `route_match_status: ${yamlValue(activity.route_match_status ?? "unmatched")}`];
  const fitStatus = activity.fit_file?.status ?? null;
  const fitDecodeStatus = activity.fit_file?.decode_status ?? null;
  const fitPath = activity.fit_file?.relative_path ?? null;
  const fitLink = fitStatus === "complete" && fitPath ? `[[${fitPath}]]` : null;
  const summary = activity.summary;
  const detailLines = renderActivityDetailSections(activity);
  return [
    "---",
    "kind: coros-activity",
    "schema_version: 1",
    `field_catalog_version: ${activity.field_catalog_version ?? 2}`,
    "projection_version: 2",
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
    `fit_status: ${yamlValue(fitStatus)}`,
    `fit_decode_status: ${yamlValue(fitDecodeStatus)}`,
    `fit_path: ${yamlValue(fitPath)}`,
    `fit_file: ${yamlValue(fitLink)}`,
    "---",
    "",
    "## 摘要",
    `- 距离：${summary.distance_km ?? "—"} km`,
    `- 用时：${summary.duration_sec ?? "—"} 秒`,
    `- 平均心率：${summary.average_heart_rate_bpm ?? "—"} bpm`,
    `- 消耗：${summary.calories_kcal ?? "—"} kcal`,
    "",
    ...detailLines,
    "## 来源",
    `- COROS activity_ref：${activity.activity_ref}`,
    `- FIT：${fitLink ?? fitStatus ?? "—"}`,
    activity.route_key ? `- 路线：${routeLink(activity.route_key)}` : "- 路线：未匹配（不适用或尚未确认）",
    "",
  ].join("\n");
}

const ACTIVITY_METRIC_LABELS = Object.freeze({
  duration_sec: "用时",
  total_duration_sec: "总用时",
  distance_km: "距离",
  average_heart_rate_bpm: "平均心率",
  max_heart_rate_bpm: "最大心率",
  calories_kcal: "消耗",
  training_load: "训练负荷",
  aerobic_te: "有氧训练效果",
  anaerobic_te: "无氧训练效果",
  training_focus: "训练重点",
  perceived_effort: "主观用力感",
  average_pace_sec_per_km: "平均配速",
  max_pace_sec_per_km: "最大配速",
  average_speed_kmh: "平均速度",
  max_speed_kmh: "最大速度",
  cadence: "步频/踏频",
});

/** @param {string} key @returns {string} */
function activityMetricLabel(key) {
  return ACTIVITY_METRIC_LABELS[key] ?? key;
}

/** @param {any} value @returns {string|null} */
function activityMetricValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value); } catch { return null; }
}

/** @param {any} value @param {string} prefix @returns {string[]} */
function renderActivityMetricMap(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const lines = [];
  for (const [key, child] of Object.entries(value)) {
    const label = prefix ? `${prefix} · ${activityMetricLabel(key)}` : activityMetricLabel(key);
    if (child && typeof child === "object" && !Array.isArray(child)) {
      lines.push(...renderActivityMetricMap(child, label));
    } else {
      const formatted = activityMetricValue(child);
      if (formatted !== null) lines.push(`- ${label}：${formatted}`);
    }
  }
  return lines;
}

/** @param {unknown} value @returns {number|null} */
function lapNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value @returns {string} */
function formatElapsed(value) {
  const seconds = lapNumber(value);
  if (seconds === null) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** @param {unknown} value @returns {string} */
function formatPace(value) {
  const seconds = lapNumber(value);
  if (seconds === null) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}'${String(rounded % 60).padStart(2, "0")}"/km`;
}

/** @param {unknown} value @returns {string} */
function formatDistance(value) {
  const meters = lapNumber(value);
  if (meters === null) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Number.isInteger(meters) ? meters : meters.toFixed(1)} m`;
}

/** @param {unknown} value @param {string} unit @returns {string} */
function formatLapQuantity(value, unit) {
  const number = lapNumber(value);
  if (number === null) return "—";
  const formatted = Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted} ${unit}`;
}

/** @param {string} value @returns {string} */
function markdownCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ").replaceAll("\r", " ");
}

/** @param {any} group @param {number} index @returns {string} */
function lapGroupLabel(group, index) {
  if (group?.group_type === -1) return "总计";
  const rawDistance = lapNumber(group?.lap_distance_raw);
  if (rawDistance !== null && rawDistance > 0) {
    const kilometers = rawDistance / 100000;
    if (kilometers >= 1) return `${Number.isInteger(kilometers) ? kilometers : kilometers.toFixed(2)} km 分段`;
    return `${Math.round(kilometers * 1000)} m 分段`;
  }
  return group?.group_type == null ? `分组 ${index + 1}` : `分组 ${group.group_type}`;
}

/** @param {number} key @param {any} value @returns {string} */
function formatLapCell(key, value) {
  if (key === "lap_index") return value == null ? "—" : String(value);
  if (key === "distance_m") return formatDistance(value);
  if (key === "duration_sec" || key === "cumulative_duration_sec") return formatElapsed(value);
  if (["elevation_gain_m", "elevation_loss_m"].includes(key)) return formatLapQuantity(value, "m");
  if (key === "average_heart_rate_bpm" || key === "max_heart_rate_bpm") return formatLapQuantity(value, "bpm");
  if (key === "average_cadence_spm") return formatLapQuantity(value, "spm");
  if (key === "average_stride_length_cm") return formatLapQuantity(value, "cm");
  if (key === "average_pace_sec_per_km" || key === "adjusted_pace_sec_per_km") return formatPace(value);
  if (key === "vertical_speed_m_per_h") {
    const number = lapNumber(value);
    return number === null ? "—" : formatLapQuantity(Math.round(number), "m/h");
  }
  if (key === "average_power_w") return formatLapQuantity(value, "W");
  return activityMetricValue(value) ?? "—";
}

/** @param {any} group @returns {string[]} */
function renderLapGroupTable(group) {
  const laps = Array.isArray(group?.laps) ? group.laps : [];
  if (!laps.length) return [];
  const header = `| ${COROS_LAP_TABLE_COLUMNS.map((column) => column.label).join(" | ")} |`;
  const separator = `| ${COROS_LAP_TABLE_COLUMNS.map(() => "---:").join(" | ")} |`;
  const rows = laps.map((lap, index) => {
    const metrics = lap?.normalized_metrics ?? {};
    return `| ${COROS_LAP_TABLE_COLUMNS.map((column) => markdownCell(formatLapCell(column.key, column.key === "lap_index" ? (lap?.lap_index ?? index + 1) : metrics[column.key]))).join(" | ")} |`;
  });
  return [header, separator, ...rows];
}

/** @param {any} activity @returns {string[]} */
function renderActivityDetailSections(activity) {
  const lines = [];
  const summary = activity.summary ?? {};
  const extendedSummary = [
    "total_duration_sec",
    "max_heart_rate_bpm",
    "training_load",
    "aerobic_te",
    "anaerobic_te",
    "training_focus",
    "perceived_effort",
  ].filter((key) => summary[key] !== null && summary[key] !== undefined);
  const sportMetrics = renderActivityMetricMap(summary.sport_metrics);
  if (extendedSummary.length || sportMetrics.length) {
    lines.push("## 详细指标");
    for (const key of extendedSummary) {
      const value = activityMetricValue(summary[key]);
      if (value !== null) lines.push(`- ${activityMetricLabel(key)}：${value}`);
    }
    lines.push(...sportMetrics);
    lines.push("");
  }
  const providerShape = activity.provider_shape;
  if (providerShape && typeof providerShape === "object") {
    const columns = Array.isArray(providerShape.columns) ? providerShape.columns.map((column) => column?.label || column?.name).filter(Boolean) : [];
    lines.push("## COROS 细分字段");
    if (providerShape.mode !== null && providerShape.mode !== undefined) lines.push(`- 模式：${providerShape.mode}${providerShape.sub_mode == null ? "" : ` / ${providerShape.sub_mode}`}`);
    lines.push(`- 细分数据：${providerShape.sport_data_details_present ? "有" : "无"}`);
    if (columns.length) lines.push(`- 字段：${columns.join("、")}`);
    lines.push("");
  }
  const groups = Array.isArray(activity.lap_groups) ? activity.lap_groups : [];
  if (groups.length) {
    lines.push("## 分段");
    for (const [groupIndex, group] of groups.entries()) {
      lines.push(`### ${lapGroupLabel(group, groupIndex)}`);
      lines.push(...renderLapGroupTable(group));
      lines.push("");
    }
  }
  const warnings = Array.isArray(activity.lap_field_warnings) ? activity.lap_field_warnings : [];
  if (warnings.length) {
    lines.push("## 解析提示");
    lines.push(`- 未识别 provider 字段：${warnings.join("、")}（已保留在 JSON，未进入分段表格）`);
    lines.push("");
  }
  return lines;
}

function routeNote(route, activities) {
  const history = activities.filter((activity) => activity.route_key === route.route_key).sort((left, right) => right.local_date.localeCompare(left.local_date) || right.activity_ref.localeCompare(left.activity_ref));
  const activityRefs = history.map((activity) => activity.activity_ref);
  const links = history.map((activity) => `[[data/coros/${activity.local_date}-${fileComponent(activity.activity_ref)}]]`);
  return [
    "---",
    "kind: route",
    "schema_version: 1",
    "source: derived",
    `route_key: ${yamlValue(route.route_key)}`,
    `route_name: ${yamlValue(route.route_name ?? route.route_key)}`,
    `sport_types: ${JSON.stringify(route.sport_types ?? [])}`,
    `distance_range_km: ${JSON.stringify(route.distance_range_km ?? null)}`,
    "activity_refs:",
    listYaml(activityRefs),
    "activities:",
    listYaml(links),
    "---",
    "",
    "## 路线历史",
    links.length ? history.map((activity, index) => `- ${links[index]} · ${activity.local_date} · ${activity.route_direction ?? "—"} · ${activity.summary?.distance_km ?? "—"} km`).join("\n") : "- 暂无活动历史。",
    "",
  ].join("\n");
}

function routeIndexNote(registry, activities) {
  const routes = registry.routes ?? [];
  return [
    "---",
    "kind: route-index",
    "schema_version: 1",
    "source: derived",
    "---",
    "",
    "# Routes",
    "",
    routes.length ? routes.map((route) => `- [[routes/${route.route_key}]] · ${route.route_name ?? route.route_key} · ${activities.filter((activity) => activity.route_key === route.route_key).length} 次`).join("\n") : "- 暂无已确认路线。",
    "",
  ].join("\n");
}

function dailyNote({ targetDate, timezone, now, workout, coros, activities, errors }) {
  const hub = dailyHubModel({ targetDate, timezone, now, workout, coros, activities, errors });
  return dailyHubNote(hub);
}
