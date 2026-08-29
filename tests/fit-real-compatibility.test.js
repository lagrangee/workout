// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeFitActivity } from "../src/fit-decoder.js";

const localFitPath = process.env.WORKOUT_REAL_FIT_PATH?.trim() || null;

test("maintainer-supplied real FIT remains compatible (set WORKOUT_REAL_FIT_PATH to enable)", { skip: localFitPath === null }, async () => {
  let bytes;
  try {
    bytes = await readFile(localFitPath);
  } catch {
    assert.fail("WORKOUT_REAL_FIT_PATH could not be read");
  }
  const result = decodeFitActivity(bytes);
  assert.equal(result.status, "complete");
  assert.equal(result.integrity, true);
  assert.ok(result.diagnostics.record_count > 0);
  assert.ok(result.metrics.start_at);
  assert.ok(result.metrics.end_at);
});
