#!/usr/bin/env node
// @ts-nocheck

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { buildRegistrationProposal } from "../skills/workout/scripts/route-matcher.mjs";
import { normalizeRouteRecord, readRouteRegistry, writeRouteRegistry } from "../src/route-registry.js";
import { aerobicDetailModel, aerobicListModel, publishAerobicProjection } from "../src/training-archive.js";
import { compactAerobicSummary } from "../src/training-records.js";
import { createAerobicProjectionPublisher } from "../src/training-archive-cloud-publisher.js";
import { syncTrainingArchive } from "../src/training-archive-sync.js";
import { emptyAthlete } from "../src/store.js";
import { routeDetailModel, routeHistoryModel, routeListModel } from "../src/training-routes.js";

/**
 * Execute the archive orchestrator from one already-collected source snapshot.
 * The caller is responsible for collecting that snapshot through the live
 * Workout/COROS read boundaries. This runner always performs local page
 * readback, but it reports cloud publication as an error unless an actual
 * authenticated application publisher is supplied.
 */
export async function runSnapshot(payload) {
  if (!payload || typeof payload !== "object") throw new Error("A source snapshot object is required");
  const archiveDir = payload.archiveDir;
  const timezone = payload.timezone;
  const dates = Array.isArray(payload.dates) ? payload.dates : [];
  if (typeof archiveDir !== "string" || !archiveDir.trim()) throw new Error("archiveDir is required");
  if (typeof timezone !== "string" || !timezone.trim()) throw new Error("timezone is required");
  if (!dates.length || dates.some((date) => typeof date !== "string")) throw new Error("dates must contain at least one local date");

  const now = new Date(payload.capturedAt ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error("capturedAt must be a valid instant");
  await seedConfirmedRoute(payload);

  const state = emptyAthlete({ email: "snapshot-sync@example.invalid", displayName: "Snapshot sync", timezone });
  const applicationPublisher = typeof payload.publish === "function"
    ? payload.publish
    : (typeof payload.applicationOrigin === "string" && payload.applicationOrigin.trim()
      ? createAerobicProjectionPublisher({ origin: payload.applicationOrigin, fetchImpl: payload.fetchImpl })
      : null);
  const run = (targetDate) => syncTrainingArchive({
    archiveDir,
    timezone,
    targetDate,
    now,
    workoutSource: { read: async (date) => payload.workoutByDate?.[date] ?? { source_status: "none", data_as_of: null, sessions: [] } },
    corosSource: { read: async (date) => payload.corosByDate?.[date] ?? { source_status: "none", data_as_of: null, activities: [] } },
    publish: async (projection, context) => {
      publishAerobicProjection(state, projection, now);
      if (!applicationPublisher) return {
        status: "error",
        published_count: 0,
        retryable: false,
        error: { code: "cloud_publisher_not_configured", message: "No authenticated Workout application publisher was supplied" },
      };
      return applicationPublisher(projection, context);
    },
  });

  const receipts = [];
  for (const date of dates) receipts.push(await run(date));
  if (typeof payload.rerunDate === "string") receipts.push({ ...(await run(payload.rerunDate)), rerun: true });
  const routeRegistry = await readRouteRegistry(archiveDir);
  const workoutPageReadback = buildWorkoutPageReadback(state, dates, payload.routeKey, now);
  await writeWorkoutPageReadback(archiveDir, workoutPageReadback);
  return {
    receipts: receipts.map((receipt) => ({
      target_date: receipt.target_date,
      status: receipt.status,
      source_status: receipt.source_status,
      local_archive: {
        status: receipt.local_archive.status,
        write_status: receipt.local_archive.write_status,
        fit_bytes: receipt.local_archive.fit_bytes,
        activity_count: receipt.records_written.activities,
      },
      cloud_publication: {
        status: receipt.cloud_publication.status,
        published_count: receipt.cloud_publication.published_count,
        attempts: receipt.cloud_publication.attempts,
      },
      route_assignments: receipt.route_assignments,
      errors: receipt.errors,
      rerun: receipt.rerun === true,
    })),
    page_read_model: state.aerobic_activities.map((activity) => ({
      activity_ref: activity.activity_ref,
      local_date: activity.local_date,
      sport_type: activity.sport_type,
      distance_km: activity.summary.distance_km,
      duration_sec: activity.summary.duration_sec,
      route_key: activity.route_key,
      route_direction: activity.route_direction,
      fit_status: activity.fit_status,
    })),
    workout_page_readback: workoutPageReadback,
    routes: routeRegistry.registry.routes.map((route) => ({
      route_key: route.route_key,
      sport_types: route.sport_types,
      distance_range_km: route.distance_range_km,
    })),
    route_history_rows: state.aerobic_activities.filter((activity) => activity.route_key === payload.routeKey).length,
  };
}

function buildWorkoutPageReadback(state, dates, routeKey, now) {
  const queryDates = dates.filter((date) => typeof date === "string").sort();
  const from = queryDates[0] ?? "1900-01-01";
  const to = queryDates.at(-1) ?? from;
  const aerobicList = aerobicListModel(state, new URL(`https://workout.invalid/api/private/records/aerobic?from=${from}&to=${to}`), now);
  const routeList = routeListModel(state, new URL("https://workout.invalid/api/private/records/routes?limit=200"), now);
  const routeDetail = routeKey ? routeDetailModel(state, routeKey, now, new URL("https://workout.invalid/api/private/records/routes")) : null;
  const routeHistory = routeKey ? routeHistoryModel(state, routeKey, now, new URL("https://workout.invalid/api/private/records/routes")) : null;
  return {
    schema_version: 1,
    surface: "workout-records-aerobic",
    persistence: "local-sync-readback",
    generated_at: now.toISOString(),
    list: {
      source_status: aerobicList.source_status,
      source_statuses: aerobicList.source_statuses,
      data_as_of: aerobicList.data_as_of,
      items: aerobicList.items,
    },
    activity_details: state.aerobic_activities.map((activity) => aerobicDetailModel(state, activity.activity_ref, now)),
    routes: routeList,
    route_detail: routeDetail,
    route_history: routeHistory,
    calendar: queryDates.map((date) => compactAerobicSummary(state, date, now)),
  };
}

async function writeWorkoutPageReadback(archiveDir, value) {
  const directory = join(archiveDir, ".sync", "training-archive");
  const path = join(directory, "workout-records-readback.json");
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function seedConfirmedRoute(payload) {
  if (typeof payload.routeKey !== "string" || !payload.routeKey.trim() || !payload.routeReference) return;
  const current = await readRouteRegistry(payload.archiveDir);
  if (current.registry.routes.some((route) => route.route_key === payload.routeKey)) return;
  const proposal = buildRegistrationProposal({
    points: payload.routeReference.fit_points,
    distance_m: Number(payload.routeReference.summary?.distance_km) * 1000,
    sport_type: null,
  });
  if (!proposal) throw new Error("Could not build the confirmed route proposal from the live FIT");
  const route = normalizeRouteRecord({
    route_key: payload.routeKey,
    route_name: payload.routeKey,
    sport_types: [102, 104],
    distance_range_km: proposal.distance_range_km,
    direction_signatures: proposal.direction_signatures,
  });
  await writeRouteRegistry(payload.archiveDir, { schema_version: 1, routes: [...current.registry.routes, route] });
}

if (process.argv[1]?.endsWith("sync-training-archive-snapshot.mjs")) {
  const input = createInterface({ input: process.stdin });
  input.once("line", async (line) => {
    try {
      process.stdout.write(`${JSON.stringify(await runSnapshot(JSON.parse(line)), null, 2)}\n`);
    } catch (error) {
      console.error(error?.stack ?? String(error));
      process.exitCode = 1;
    } finally {
      input.close();
    }
  });
}
