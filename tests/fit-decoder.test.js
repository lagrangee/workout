// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { decodeFitActivity } from "../src/fit-decoder.js";
import { SYNTHETIC_FIT_ACTIVITY, syntheticFitBytes } from "./helpers/synthetic-fit.js";

test("FIT adapter decodes the public synthetic fixture with integrity, GPS, timestamps, and distance", () => {
  const result = decodeFitActivity(syntheticFitBytes());

  assert.equal(result.status, "complete");
  assert.equal(result.integrity, true);
  assert.equal(result.points.length, SYNTHETIC_FIT_ACTIVITY.points.length);
  assert.equal(result.diagnostics.record_count, result.points.length);
  assert.equal(result.diagnostics.developer_field_record_count, 0);
  assert.deepEqual(result.diagnostics.decoder_errors, []);
  assert.equal(result.metrics.distance_m, SYNTHETIC_FIT_ACTIVITY.distance_m);
  assert.equal(result.metrics.duration_sec, SYNTHETIC_FIT_ACTIVITY.duration_sec);
  assert.equal(result.points[0].timestamp, SYNTHETIC_FIT_ACTIVITY.start_at);
  assert.ok(result.points.every((point) => point.lat >= -90 && point.lat <= 90 && point.lon >= -180 && point.lon <= 180));
  assert.ok(result.points.every((point, index) => index === 0 || point.distance_m >= result.points[index - 1].distance_m));
  assert.doesNotMatch(JSON.stringify(result), /developerFields|telemetry|sensor_streams/);
});

test("FIT adapter rejects a malformed artifact without repairing it", () => {
  assert.throws(() => decodeFitActivity(new Uint8Array([0, 1, 2, 3, 4])), (error) => {
    assert.equal(error.code, "fit_invalid_signature");
    return true;
  });
});

test("FIT adapter rejects a CRC-corrupted synthetic artifact without partial decoding", () => {
  const bytes = syntheticFitBytes();
  bytes[20] ^= 0xff;
  assert.throws(() => decodeFitActivity(bytes), (error) => {
    assert.equal(error.code, "fit_integrity_failed");
    assert.deepEqual(error.details, {});
    return true;
  });
});

test("FIT adapter classifies a truncated signed artifact as failed integrity", () => {
  const bytes = syntheticFitBytes().slice(0, -8);
  assert.throws(() => decodeFitActivity(bytes), (error) => {
    assert.equal(error.code, "fit_integrity_failed");
    return true;
  });
});
