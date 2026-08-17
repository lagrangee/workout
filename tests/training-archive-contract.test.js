import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const archivePath = resolve("docs/contracts/training-archive-v1.md");
const wirePath = resolve("docs/contracts/training-archive-wire-catalog-v1.md");
const calendarPath = resolve("docs/contracts/calendar-read-v1.md");
const contextPath = resolve("CONTEXT.md");

test("Training Archive v1 documents local-first routing and explicit sync scope", async () => {
  const archive = await readFile(archivePath, "utf8");

  assert.match(archive, /Training Archive v1/);
  assert.match(archive, /WORKOUT_ARCHIVE_DIR/);
  assert.match(archive, /local-first analysis/i);
  assert.match(archive, /Workout and COROS remain the authoritative\s+sources/i);
  assert.match(archive, /100 = Outdoor Run/);
  assert.match(archive, /200 = Cycling/);
  assert.match(archive, /COROS Strength \(`402`\) is outside this archive/);
  assert.match(archive, /daily\/YYYY-MM-DD\.md/);
  assert.match(archive, /weekly\/YYYY-Www\.md/);
  assert.match(archive, /workout\/sessions\/<session_key>\.md/);
  assert.match(archive, /daily-hub/);
  assert.match(archive, /same_local_date_context_only/);
  assert.match(archive, /data\/coros\/YYYY-MM-DD-<activity_ref>\.json/);
  assert.match(archive, /data\/coros\/YYYY-MM-DD-<activity_ref>\.fit/);
  assert.match(archive, /config\/routes\.json/);
  assert.match(archive, /forward.*reverse/s);
  assert.match(archive, /FIT-backed route matching/);
  assert.match(archive, /asks the Athlete for a route name/i);
  assert.match(archive, /initial\s+distance\s+range.*10%/is);
  assert.match(archive, /direction_signatures/);
  assert.match(archive, /anchor_distance_m/);
  assert.match(archive, /start_radius_m/);
});

test("Training Archive wire catalog preserves lap groups and provider fields", async () => {
  const wire = await readFile(wirePath, "utf8");

  assert.match(wire, /Training Archive Wire Catalog v1/);
  assert.match(wire, /kind: daily-hub/);
  assert.match(wire, /kind: workout-session/);
  assert.match(wire, /workout\/index\.md/);
  assert.match(wire, /records_written: \{ daily_hubs: number, workout_sessions: number, activities: number \}/);
  assert.match(wire, /same_local_date_context_only/);
  assert.match(wire, /CorosActivityArchiveV1/);
  assert.match(wire, /lap_groups: LapGroup\[\]/);
  assert.match(wire, /provider_metrics: object/);
  assert.match(wire, /normalized_metrics: object/);
  assert.match(wire, /group_type/);
  assert.match(wire, /field_catalog_version/);
  assert.match(wire, /activity_ref.*labelId/i);
  assert.match(wire, /fit_file: FitArtifact/);
  assert.match(wire, /route_direction: forward\|reverse\|null/);
  assert.match(wire, /position_lat/);
  assert.match(wire, /relative_path/);
  assert.match(wire, /ActivityPoints/);
  assert.match(wire, /RouteRegistrationProposal/);
  assert.match(wire, /direction_signatures/);
  assert.match(wire, /anchor_distance_m/);
  assert.match(wire, /route-matcher\.mjs/);
  assert.match(wire, /unknown additive envelope fields/i);
});

test("Calendar contract keeps aerobic context compact and source-separated", async () => {
  const calendar = await readFile(calendarPath, "utf8");

  assert.match(calendar, /include=aerobic_summary/);
  assert.match(calendar, /activity_count/);
  assert.match(calendar, /has no activity rows/);
  assert.match(calendar, /not a cross-source\s+event join/);
  assert.match(calendar, /今日 \| 日历 \| 记录 \| 设置/);
});

test("Domain context names the archive as a derived boundary", async () => {
  const context = await readFile(contextPath, "utf8");

  assert.match(context, /\*\*Training Archive\*\*/);
  assert.match(context, /Workout and COROS remain authoritative/);
  assert.match(context, /\*\*COROS Activity Archive\*\*/);
});
