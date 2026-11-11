import assert from "node:assert/strict";
import test from "node:test";
import { appFixture, call, today } from "./helpers.js";

test("execution sync batches across midnight, replays a lost receipt and rejects another device's stale batch", async () => {
  const start = new Date(`${today}T15:59:50.000Z`);
  let now = start;
  const { handler } = appFixture({ clock: () => now });
  const send = (path, body, key, email) => call(handler, path, {
    method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": key },
  }, email);
  const started = await send(`/api/private/scheduled-workouts/${today}/start`, {}, "fixture-start");
  assert.equal(started.response.status, 201);
  const detail = started.body;
  const path = `/api/private/sessions/${detail.session_key}/sync`;
  const [first, second] = detail.snapshot.completion_items;
  const at = (seconds) => new Date(start.getTime() + seconds * 1000).toISOString();
  const result = (item, seconds) => ({
    completion_item_key: item.completion_item_key, completed: true,
    actual: { metric: "reps", value: 8 }, resistance: item.resistance, rir: 1, completed_at: at(seconds),
  });
  const record = (item, seconds) => ({ type: "record", results: [result(item, seconds)], exercise_feedback: [] });
  const body = { base_updated_at: detail.updated_at, actions: [
    record(first, 2), { type: "pause", at: at(3) }, { type: "resume", at: at(12) }, record(second, 14),
  ] };
  now = new Date(at(20));
  const rejected = await send(path, { ...body, actions: [...body.actions, { type: "unexpected" }] }, "rejected");
  assert.equal(rejected.response.status, 400);
  const untouched = await call(handler, path.slice(0, -5));
  assert.deepEqual(untouched.body.training_intervals, detail.training_intervals);
  assert.deepEqual(untouched.body.completion_results, []);
  const committed = await send(path, body, "one-batch");
  assert.equal(committed.response.status, 200);
  assert.equal(committed.body.scheduled_date, today);
  assert.deepEqual(committed.body.training_intervals.map(({ started_at, ended_at }) => [started_at, ended_at]), [[at(0), at(3)], [at(12), null]]);
  assert.equal(committed.body.completion_results.length, 2);
  const replay = await send(path, body, "one-batch");
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.synced_updated_at, committed.body.updated_at);
  assert.deepEqual(replay.body.training_intervals, committed.body.training_intervals);
  assert.equal((await send(path, body, "other-device")).response.status, 409);
  assert.equal((await send(path, body, "other-athlete", "athlete-b@example.invalid")).response.status, 404);
  const pause = { base_updated_at: committed.body.updated_at, actions: [{ type: "pause", at: at(19) }] };
  const newer = await send(path, pause, "newer-batch");
  assert.equal(newer.response.status, 200);
  const replayAfterAnotherChange = await send(path, body, "one-batch");
  assert.equal(replayAfterAnotherChange.body.synced_updated_at, committed.body.updated_at);
  assert.equal(replayAfterAnotherChange.body.updated_at, newer.body.updated_at);
});
