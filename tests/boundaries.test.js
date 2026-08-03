import test from "node:test";
import assert from "node:assert/strict";
import { addDays, localDate, weekdayKey, WEEKDAYS } from "../src/util.js";
import { scheduleEntry, todayModel } from "../src/plan.js";
import { appFixture, call, packageText, post, today, workout } from "./helpers.js";

test("ticket 25 boundaries: future and current unstarted workouts are not due", async () => {
  const { handler } = appFixture();
  const future = await call(handler, `/api/private/schedule?from=${addDays(today, 1)}&to=${addDays(today, 1)}`);
  assert.equal(future.body.entries[0].kind, "rest"); assert.equal(future.body.entries[0].is_due, false);
  const current = await call(handler, `/api/private/today`); assert.equal(current.body.entry.is_due, false); assert.equal(current.body.entry.is_overdue_unstarted, false); assert.ok(current.body.entry.prescription?.blocks?.length);
});

test("ticket 25 boundaries: later-confirmed earlier revision masks older future revision", async () => {
  const { handler } = appFixture();
  const oldFuture = packageText(addDays(today, 4), workout("旧未来计划"));
  const earlier = packageText(addDays(today, 2), workout("较早生效的新计划"));
  assert.equal((await call(handler, "/api/private/plan-updates/apply", post({ package_text: oldFuture }, "future-old"))).response.status, 201);
  assert.equal((await call(handler, "/api/private/plan-updates/apply", post({ package_text: earlier }, "future-new"))).response.status, 201);
  const plan = await call(handler, "/api/private/plan");
  assert.equal(plan.body.future.length, 1); assert.equal(plan.body.future[0].effective_from, addDays(today, 2));
});

test("Calendar boundaries: pre-plan dates stay no-plan and midweek revisions win on their effective date", async () => {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  const firstPlanDate = state.plan_revisions[0].effective_from;
  const beforeFirst = await call(handler, `/api/private/schedule?from=${addDays(firstPlanDate, -1)}&to=${addDays(firstPlanDate, -1)}`);
  assert.equal(beforeFirst.response.status, 200);
  assert.equal(beforeFirst.body.entries[0].kind, "no_plan");

  const effectiveFrom = addDays(today, 2);
  const nextWeek = Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
  nextWeek[weekdayKey(effectiveFrom)] = workout("midweek boundary");
  const applied = await call(handler, "/api/private/plan-updates/apply", post({ package_text: JSON.stringify({ schema_version: 1, effective_from: effectiveFrom, week: nextWeek }) }, "calendar-boundary"));
  assert.equal(applied.response.status, 201);
  const beforeRevision = await call(handler, `/api/private/schedule?from=${addDays(effectiveFrom, -1)}&to=${addDays(effectiveFrom, -1)}`);
  const afterRevision = await call(handler, `/api/private/schedule?from=${effectiveFrom}&to=${effectiveFrom}`);
  assert.notEqual(beforeRevision.body.entries[0].revision_key, afterRevision.body.entries[0].revision_key);
  assert.equal(afterRevision.body.entries[0].title, "midweek boundary");
});

test("Calendar boundaries: Athlete-local timezone changes the dated projection boundary", async () => {
  const { store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  const instant = new Date("2026-07-31T23:30:00.000Z");
  state.timezone = "UTC";
  const utc = todayModel(state, instant);
  state.timezone = "Asia/Shanghai";
  const shanghai = todayModel(state, instant);
  assert.equal(utc.date, localDate(instant, "UTC"));
  assert.equal(shanghai.date, localDate(instant, "Asia/Shanghai"));
  assert.notEqual(utc.date, shanghai.date);
  assert.equal(scheduleEntry(state, shanghai.date, instant).date, shanghai.date);
});

test("ticket 25 boundaries: public schemas and private/Coach responses carry cache and referrer protections", async () => {
  const { handler } = appFixture();
  const me = await call(handler, "/api/private/me"); assert.equal(me.response.headers.get("cache-control"), "private, no-store"); assert.equal(me.response.headers.get("referrer-policy"), "no-referrer");
  const schema = await call(handler, "/api/coach/v1/schemas/manifest", { headers: {} }, "ignored@example.invalid"); assert.equal(schema.response.status, 200); assert.equal(schema.response.headers.get("cache-control"), "private, no-store"); assert.equal(schema.body.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.response.headers.get("cdn-cache-control"), "no-store"); assert.equal(schema.response.headers.get("content-security-policy").startsWith("default-src 'none'"), true);
  for (const name of ["manifest", "overview", "weekly_template", "plan", "schedule", "session_index", "session_detail", "progress", "exercise_detail", "error", "schema_catalog"]) {
    const resource = await call(handler, `/api/coach/v1/schemas/${name}`, { headers: {} }, "ignored@example.invalid");
    assert.equal(resource.response.status, 200); assert.ok(resource.body.required?.length); assert.equal(resource.body.additionalProperties, false);
  }
  const head = await handler.fetch(new Request("https://workout.example/api/coach/v1/schemas/manifest", { method: "HEAD" }), { LOCAL_AUTH: "true" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
});

test("ticket 25 boundaries: each Athlete has an empty export without crossing state", async () => {
  const { handler } = appFixture();
  const athleteA = await call(handler, "/api/private/export", {}, "athlete-a@example.invalid"); const athleteB = await call(handler, "/api/private/export", {}, "athlete-b@example.invalid");
  assert.equal(athleteA.body.athlete.display_name, "Athlete A"); assert.equal(athleteB.body.athlete.display_name, "Athlete B"); assert.notEqual(athleteA.body.athlete.display_name, athleteB.body.athlete.display_name);
  assert.equal(athleteB.body.counts.sessions, 0); assert.deepEqual(athleteB.body.scheduled_workouts, []);
});

test("ticket 24 boundaries: unbounded analytical ranges fail before expansion", async () => {
  const { handler } = appFixture();
  const schedule = await call(handler, "/api/private/schedule?from=2000-01-01&to=2026-01-01");
  assert.equal(schedule.response.status, 400); assert.equal(schedule.body.error.code, "invalid_period");
  const progress = await call(handler, "/api/private/progress?from=2000-01-01&to=2026-01-01");
  assert.equal(progress.response.status, 400); assert.equal(progress.body.error.code, "invalid_period");
  const coachShare = await call(handler, "/api/private/coach-share", post({}, "range-share"));
  const copy = await call(handler, "/api/private/coach-share");
  const token = copy.body.url.split("/coach/")[1];
  const coach = await call(handler, `/api/coach/v1/${token}/progress?from=2000-01-01&to=2026-01-01`, { headers: {} }, "ignored@example.invalid");
  assert.equal(coach.response.status, 400); assert.equal(coach.body.error.code, "invalid_period");
  const expand = await call(handler, `/api/coach/v1/${token}/schedule?from=${today}&to=${today}&expand=unknown`, { headers: {} }, "ignored@example.invalid");
  assert.equal(expand.response.status, 400); assert.equal(expand.body.error.code, "invalid_request");
  assert.equal(coachShare.response.status, 201);
});

test("ticket 21 boundaries: invalid calendar dates and strict pagination filters fail", async () => {
  const { handler } = appFixture();
  const packageResponse = await call(handler, "/api/private/plan/update-package");
  assert.equal(packageResponse.response.status, 200);
  assert.equal(packageResponse.body.schema_version, 1);
  assert.equal(Object.keys(packageResponse.body.week).length, 7);
  const invalidProgress = await call(handler, "/api/private/progress?from=2026-02-30&to=2026-03-01");
  assert.equal(invalidProgress.response.status, 400);
  assert.equal(invalidProgress.body.error.code, "invalid_period");
  const invalidSessions = await call(handler, "/api/private/sessions?limit=0");
  assert.equal(invalidSessions.response.status, 400);
  assert.equal(invalidSessions.body.error.code, "invalid_request");
});

test("ticket 22 boundaries: Coach unknown resources and invalid limits are explicit errors", async () => {
  const { handler } = appFixture();
  const created = await call(handler, "/api/private/coach-share", post({}, "coach-errors"));
  assert.equal(created.response.status, 201);
  const copy = await call(handler, "/api/private/coach-share");
  const token = copy.body.url.split("/coach/")[1];
  const invalidLimit = await call(handler, `/api/coach/v1/${token}/sessions?limit=0`, { headers: {} }, "ignored@example.invalid");
  assert.equal(invalidLimit.response.status, 400);
  assert.equal(invalidLimit.body.error.code, "invalid_request");
  const unknown = await call(handler, `/api/coach/v1/${token}/not-a-resource`, { headers: {} }, "ignored@example.invalid");
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.error.code, "not_found");
});

test("Coach API uses one date-window contract and explicit progress buckets", async () => {
  const { handler } = appFixture();
  const created = await call(handler, "/api/private/coach-share", post({}, "coach-contract"));
  assert.equal(created.response.status, 201);
  const copy = await call(handler, "/api/private/coach-share");
  const token = copy.body.url.split("/coach/")[1];
  const from = addDays(today, -8);
  const day = await call(handler, `/api/coach/v1/${token}/progress?from=${from}&to=${today}&bucket=day`, { headers: {} }, "ignored@example.invalid");
  assert.equal(day.response.status, 200); assert.equal(day.body.bucket, "day"); assert.equal(day.body.buckets.length, 9); assert.equal(day.body.period.includes_from, true); assert.equal(day.body.period.includes_to, true); assert.equal(day.body.period.includes_current_date, true); assert.equal(day.body.period.current_date_may_be_incomplete, true); assert.equal(day.body.buckets.at(-1).is_partial, false);
  const month = await call(handler, `/api/coach/v1/${token}/progress?from=${from}&to=${today}&bucket=month`, { headers: {} }, "ignored@example.invalid");
  assert.equal(month.response.status, 200); assert.equal(month.body.buckets[0].month_start.endsWith("-01"), true); assert.equal(month.body.buckets[0].is_partial, true);
  const conflict = await call(handler, `/api/coach/v1/${token}/progress?from=${from}&to=${today}&range=30d`, { headers: {} }, "ignored@example.invalid");
  assert.equal(conflict.response.status, 400); assert.equal(conflict.body.error.code, "invalid_period"); assert.equal(conflict.body.error.field, "range");
  const invalidBucket = await call(handler, `/api/coach/v1/${token}/progress?range=7d&bucket=quarter`, { headers: {} }, "ignored@example.invalid");
  assert.equal(invalidBucket.response.status, 400); assert.equal(invalidBucket.body.error.code, "invalid_request"); assert.equal(invalidBucket.body.error.field, "bucket");
  const sessions = await call(handler, `/api/coach/v1/${token}/sessions?from=${from}&to=${today}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(sessions.response.status, 200); assert.equal(sessions.body.period.includes_current_date, true);
  const exercise = await call(handler, `/api/coach/v1/${token}/exercises/not-an-exercise?from=${from}&to=${today}`, { headers: {} }, "ignored@example.invalid");
  assert.equal(exercise.response.status, 404); assert.equal(exercise.body.error.code, "not_found");
});
