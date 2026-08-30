import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewStore, PREVIEW_TIMEZONE } from "../scripts/preview.mjs";
import { todayModel } from "../src/plan.js";

test("preview fixture materializes a workout on the preview Athlete's current date", async () => {
  const startedAt = new Date("2026-08-30T04:00:00.000Z");
  const store = createPreviewStore(startedAt);
  const state = await store.getByEmail("athlete-a@example.invalid");
  const today = todayModel(state, startedAt);

  assert.equal(state.timezone, PREVIEW_TIMEZONE);
  assert.equal(today.date, "2026-08-30");
  assert.equal(today.entry.kind, "workout");
  assert.equal(today.entry.title, "本地演示训练");
});
