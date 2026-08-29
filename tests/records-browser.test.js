import test from "node:test";
import assert from "node:assert/strict";

import { addDays } from "../src/util.js";
import { appFixture, call, today } from "./helpers.js";

function aerobicActivity({ activityRef, localDate, sportType = 101 }) {
  return {
    schema_version: 1,
    activity_ref: activityRef,
    source_ref: `coros:activity:${activityRef}`,
    local_date: localDate,
    timezone: "Asia/Shanghai",
    started_at: `${localDate}T02:00:00.000Z`,
    ended_at: `${localDate}T02:35:00.000Z`,
    sport_type: sportType,
    sport_name: sportType === 101 ? "indoor_run" : "run",
    source_status: "complete",
    data_as_of: `${localDate}T23:59:00.000Z`,
    updated_at: `${localDate}T23:59:30.000Z`,
    summary: {
      duration_sec: 2100,
      distance_km: 5.25,
      average_heart_rate_bpm: 142,
      calories_kcal: null,
      sport_metrics: {},
    },
    route_key: null,
    route_direction: null,
    fit_status: "complete",
    raw_fit: "must-not-cross-the-read-model",
    gps: [{ lat: 31.2, lon: 121.5 }],
  };
}

test("Calendar summary bridges to the same date-scoped Records read without exposing activity rows", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  const adjacentDate = addDays(today, -1);
  state.aerobic_activities = [
    aerobicActivity({ activityRef: "coros-calendar-target", localDate: today }),
    aerobicActivity({ activityRef: "coros-adjacent-date", localDate: adjacentDate, sportType: 100 }),
  ];
  state.aerobic_projection = {
    schema_version: 1,
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: `${today}T23:59:00.000Z`,
    updated_at: `${today}T23:59:30.000Z`,
    activity_count: 2,
  };
  await store.save(state);

  const calendar = await call(
    handler,
    `/api/private/schedule?from=${today}&to=${today}&expand=prescription&include=aerobic_summary`,
  );
  assert.equal(calendar.response.status, 200);
  assert.equal(calendar.body.entries.length, 1);
  const summary = calendar.body.entries[0].aerobic_summary;
  assert.equal(summary.local_date, today);
  assert.equal(summary.activity_count, 1);
  assert.equal(summary.distance_km, 5.25);
  assert.equal(summary.duration_sec, 2100);
  assert.equal(summary.records_href, `/app#records-aerobic-${today}`);
  assert.equal("items" in summary, false);
  assert.equal("activity_ref" in summary, false);
  assert.equal("raw_fit" in summary, false);
  assert.equal("gps" in summary, false);

  const records = await call(
    handler,
    `/api/private/records/aerobic?limit=200&from=${today}&to=${today}`,
  );
  assert.equal(records.response.status, 200);
  assert.deepEqual(records.body.filters, {
    from: today,
    to: today,
    sport_type: null,
    limit: 200,
  });
  assert.equal(records.body.items.length, 1);
  assert.equal(records.body.items[0].activity_ref, "coros-calendar-target");
  assert.equal("raw_fit" in records.body.items[0], false);
  assert.equal("gps" in records.body.items[0], false);
});

test("Calendar and date-scoped Records reads remain isolated by Athlete", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  state.aerobic_activities = [
    aerobicActivity({ activityRef: "athlete-a-private-activity", localDate: today }),
  ];
  state.aerobic_projection = {
    schema_version: 1,
    source_status: "complete",
    source_statuses: { workout: "none", coros: "complete" },
    data_as_of: `${today}T23:59:00.000Z`,
    updated_at: `${today}T23:59:30.000Z`,
    activity_count: 1,
  };
  await store.save(state);

  const otherCalendar = await call(
    handler,
    `/api/private/schedule?from=${today}&to=${today}&include=aerobic_summary`,
    {},
    "athlete-b@example.invalid",
  );
  assert.equal(otherCalendar.response.status, 200);
  assert.equal(otherCalendar.body.entries[0].aerobic_summary.activity_count, 0);

  const otherRecords = await call(
    handler,
    `/api/private/records/aerobic?limit=200&from=${today}&to=${today}`,
    {},
    "athlete-b@example.invalid",
  );
  assert.equal(otherRecords.response.status, 200);
  assert.deepEqual(otherRecords.body.items, []);

  const incompleteDateRange = await call(
    handler,
    `/api/private/records/aerobic?from=${today}`,
  );
  assert.equal(incompleteDateRange.response.status, 400);
  assert.equal(incompleteDateRange.body.error.code, "invalid_period");
});
