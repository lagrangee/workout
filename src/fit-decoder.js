// @ts-nocheck

import { Decoder, Stream } from "@garmin/fitsdk";

const SEMICIRCLE_TO_DEGREES = 180 / 0x80000000;
const FIT_DECODE_STATUSES = new Set(["complete", "error", "skipped"]);

/**
 * A stable error boundary around the vendor FIT decoder. Callers can preserve
 * the downloaded FIT artifact while deciding whether a decode failure should
 * block only route matching or the whole sync.
 */
export class FitDecodeError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FitDecodeError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Decode one FIT artifact into the narrow contract used by route matching.
 * Vendor message shapes and developer field values stay inside this module.
 * @param {unknown} value
 * @returns {{ status: "complete", integrity: true, points: Array<{ lat: number, lon: number, distance_m: number|null, timestamp: string|null }>, metrics: { distance_m: number|null, duration_sec: number|null, start_at: string|null, end_at: string|null }, diagnostics: { decoder: string, record_count: number, gps_point_count: number, developer_field_record_count: number, decoder_errors: string[] } }}
 */
export function decodeFitActivity(value) {
  const bytes = toFitBytes(value);
  if (!bytes || bytes.byteLength === 0) throw new FitDecodeError("fit_empty", "FIT artifact is empty");

  try {
    const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
    if (!decoder.isFIT()) throw new FitDecodeError("fit_invalid_signature", "FIT artifact has an invalid signature");
    if (!decoder.checkIntegrity()) throw new FitDecodeError("fit_integrity_failed", "FIT artifact failed header or CRC validation");

    const decoded = decoder.read({
      applyScaleAndOffset: true,
      convertDateTimesToDates: true,
      includeUnknownData: true,
      mergeHeartRates: true,
    });
    const decoderErrors = (decoded.errors ?? []).map((error) => String(error?.message ?? error)).filter(Boolean);
    if (decoderErrors.length) {
      throw new FitDecodeError("fit_decode_failed", "FIT decoder returned errors", { errors: decoderErrors.slice(0, 8) });
    }

    const records = Array.isArray(decoded.messages?.recordMesgs) ? decoded.messages.recordMesgs : [];
    const points = records.flatMap((record) => {
      const lat = semicircleToDegrees(record?.positionLat ?? record?.position_lat, 90);
      const lon = semicircleToDegrees(record?.positionLong ?? record?.position_long, 180);
      if (lat === null || lon === null) return [];
      return [{
        lat,
        lon,
        distance_m: finiteNonNegative(record?.distance ?? record?.distance_m),
        timestamp: isoOrNull(record?.timestamp),
      }];
    });
    const session = Array.isArray(decoded.messages?.sessionMesgs) ? decoded.messages.sessionMesgs.at(-1) : null;
    const firstRecord = records[0] ?? null;
    const lastRecord = records.at(-1) ?? null;
    const developerFieldRecordCount = records.filter((record) => record?.developerFields && Object.keys(record.developerFields).length > 0).length;

    return {
      status: "complete",
      integrity: true,
      points,
      metrics: {
        distance_m: finiteNonNegative(session?.totalDistance ?? lastRecord?.distance),
        duration_sec: finiteNonNegative(session?.totalTimerTime ?? session?.totalElapsedTime),
        start_at: isoOrNull(session?.startTime ?? firstRecord?.timestamp),
        end_at: isoOrNull(session?.timestamp ?? lastRecord?.timestamp),
      },
      diagnostics: {
        decoder: "@garmin/fitsdk",
        record_count: records.length,
        gps_point_count: points.length,
        developer_field_record_count: developerFieldRecordCount,
        decoder_errors: [],
      },
    };
  } catch (error) {
    if (error instanceof FitDecodeError) throw error;
    throw new FitDecodeError("fit_decode_failed", "FIT artifact could not be decoded");
  }
}

/** @param {unknown} value @returns {Uint8Array|null} */
export function toFitBytes(value) {
  if (value === null || value === undefined) return null;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return Uint8Array.from(value);
  if (value && typeof value === "object" && Array.isArray(value.data)) return toFitBytes(value.data);
  if (typeof value === "string" && value.startsWith("base64:")) {
    try { return new Uint8Array(Buffer.from(value.slice("base64:".length), "base64")); } catch { return null; }
  }
  return null;
}

/** @param {unknown} value @returns {number|null} */
function semicircleToDegrees(value, limit) {
  const number = finiteNumber(value);
  if (number === null || number === 0x7fffffff || number === -0x80000000) return null;
  const degrees = number * SEMICIRCLE_TO_DEGREES;
  return degrees >= -limit && degrees <= limit ? degrees : null;
}

/** @param {unknown} value @returns {number|null} */
function finiteNonNegative(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

/** @param {unknown} value @returns {number|null} */
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value @returns {string|null} */
function isoOrNull(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** @param {unknown} value @returns {boolean} */
export function isFitDecodeStatus(value) {
  return typeof value === "string" && FIT_DECODE_STATUSES.has(value);
}
