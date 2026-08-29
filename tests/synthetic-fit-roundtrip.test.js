// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { decodeFitActivity } from "../src/fit-decoder.js";
import { buildRegistrationProposal } from "../skills/workout/scripts/route-matcher.mjs";
import { SYNTHETIC_FIT_ACTIVITY, syntheticFitBytes } from "./helpers/synthetic-fit.js";

test("synthetic FIT round trip preserves integrity, time, distance, and a device-neutral route", () => {
  const first = syntheticFitBytes();
  const second = syntheticFitBytes();
  assert.deepEqual(first, second);

  const result = decodeFitActivity(first);
  assert.equal(result.status, "complete");
  assert.equal(result.integrity, true);
  assert.equal(result.metrics.distance_m, SYNTHETIC_FIT_ACTIVITY.distance_m);
  assert.equal(result.metrics.duration_sec, SYNTHETIC_FIT_ACTIVITY.duration_sec);
  assert.equal(result.metrics.start_at, SYNTHETIC_FIT_ACTIVITY.start_at);
  assert.equal(result.metrics.end_at, SYNTHETIC_FIT_ACTIVITY.end_at);
  assert.equal(result.points.length, SYNTHETIC_FIT_ACTIVITY.points.length);
  result.points.forEach((point, index) => {
    const expected = SYNTHETIC_FIT_ACTIVITY.points[index];
    assert.ok(Math.abs(point.lat - expected.lat) < 0.000001);
    assert.ok(Math.abs(point.lon - expected.lon) < 0.000001);
    assert.equal(point.distance_m, expected.distance_m);
    assert.equal(point.timestamp, expected.timestamp);
  });
  assert.equal(result.diagnostics.decoder, "fit-file-parser");
  assert.equal(result.diagnostics.developer_field_record_count, 0);
  assert.deepEqual(result.diagnostics.decoder_errors, []);

  const proposal = buildRegistrationProposal({
    points: result.points,
    distance_m: result.metrics.distance_m,
    sport_type: SYNTHETIC_FIT_ACTIVITY.sport_type,
  });
  assert.ok(proposal);
  assert.deepEqual(proposal.sport_types, [SYNTHETIC_FIT_ACTIVITY.sport_type]);
  assert.ok(proposal.direction_signatures.forward);
  assert.ok(proposal.direction_signatures.reverse);
  assert.doesNotMatch(JSON.stringify(result), /device|serial|manufacturer|product|developerFields|telemetry|sensor_streams/i);
});
