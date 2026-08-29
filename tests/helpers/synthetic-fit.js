// @ts-nocheck

import { FitBaseType, FitEncoder } from "fit-file-parser";

const SEMICIRCLES_PER_DEGREE = 0x80000000 / 180;

export const SYNTHETIC_FIT_ACTIVITY = Object.freeze({
  sport_type: 102,
  start_at: "2024-01-15T00:00:00.000Z",
  end_at: "2024-01-15T00:02:00.000Z",
  duration_sec: 120,
  distance_m: 1_200,
  points: Object.freeze([
    Object.freeze({ lat: 1, lon: 1, distance_m: 0, timestamp: "2024-01-15T00:00:00.000Z" }),
    Object.freeze({ lat: 1, lon: 1.0027, distance_m: 300, timestamp: "2024-01-15T00:00:30.000Z" }),
    Object.freeze({ lat: 1, lon: 1.0054, distance_m: 600, timestamp: "2024-01-15T00:01:00.000Z" }),
    Object.freeze({ lat: 1, lon: 1.0081, distance_m: 900, timestamp: "2024-01-15T00:01:30.000Z" }),
    Object.freeze({ lat: 1, lon: 1.0108, distance_m: 1_200, timestamp: "2024-01-15T00:02:00.000Z" }),
  ]),
});

/**
 * Build a tiny, deterministic and device-neutral FIT activity for public tests.
 * It deliberately omits manufacturer, product, serial and developer fields.
 */
export function syntheticFitBytes() {
  const encoder = new FitEncoder({ protocolVersion: 0x20, profileVersion: 2_300 });
  encoder.writeMessage(0, [
    field(0, 1, FitBaseType.Enum, 4),
    field(4, 4, FitBaseType.Uint32, fitTimestamp(SYNTHETIC_FIT_ACTIVITY.start_at)),
  ], 0);

  for (const point of SYNTHETIC_FIT_ACTIVITY.points) {
    encoder.writeMessage(20, [
      field(253, 4, FitBaseType.Uint32, fitTimestamp(point.timestamp)),
      field(0, 4, FitBaseType.Sint32, degreesToSemicircles(point.lat)),
      field(1, 4, FitBaseType.Sint32, degreesToSemicircles(point.lon)),
      field(5, 4, FitBaseType.Uint32, Math.round(point.distance_m * 100)),
    ], 1);
  }

  encoder.writeMessage(18, [
    field(253, 4, FitBaseType.Uint32, fitTimestamp(SYNTHETIC_FIT_ACTIVITY.end_at)),
    field(2, 4, FitBaseType.Uint32, fitTimestamp(SYNTHETIC_FIT_ACTIVITY.start_at)),
    field(7, 4, FitBaseType.Uint32, SYNTHETIC_FIT_ACTIVITY.duration_sec * 1_000),
    field(8, 4, FitBaseType.Uint32, SYNTHETIC_FIT_ACTIVITY.duration_sec * 1_000),
    field(9, 4, FitBaseType.Uint32, SYNTHETIC_FIT_ACTIVITY.distance_m * 100),
    field(5, 1, FitBaseType.Enum, 1),
  ], 2);

  return encoder.close();
}

function fitTimestamp(value) {
  return FitEncoder.toFitTimestamp(new Date(value));
}

function degreesToSemicircles(value) {
  return Math.round(value * SEMICIRCLES_PER_DEGREE);
}

function field(number, size, baseType, value) {
  return { number, size, baseType, value };
}
