import test from "node:test";
import assert from "node:assert/strict";
import { addDays, localDate } from "../src/util.js";
import { appFixture, call, packageText, post, today, workout } from "./helpers.js";

test("ticket 25 boundaries: future and current unstarted workouts are not due", async () => {
  const { handler } = appFixture();
  const future = await call(handler, `/api/private/schedule?from=${addDays(today, 1)}&to=${addDays(today, 1)}`);
  assert.equal(future.body.entries[0].kind, "rest"); assert.equal(future.body.entries[0].is_due, false);
  const current = await call(handler, `/api/private/today`); assert.equal(current.body.entry.is_due, false); assert.equal(current.body.entry.is_overdue_unstarted, false);
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

test("ticket 25 boundaries: public schemas and private/Coach responses carry cache and referrer protections", async () => {
  const { handler } = appFixture();
  const me = await call(handler, "/api/private/me"); assert.equal(me.response.headers.get("cache-control"), "no-store"); assert.equal(me.response.headers.get("referrer-policy"), "no-referrer");
  const schema = await call(handler, "/api/coach/v1/schemas/manifest", { headers: {} }, "ignored@example.invalid"); assert.equal(schema.response.status, 200); assert.equal(schema.response.headers.get("cache-control"), "no-store"); assert.equal(schema.body.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.response.headers.get("cdn-cache-control"), "no-store"); assert.equal(schema.response.headers.get("content-security-policy").startsWith("default-src 'none'"), true);
  for (const name of ["manifest", "overview", "weekly_template", "plan", "schedule", "session_index", "session_detail", "progress", "exercise_detail", "error"]) {
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
