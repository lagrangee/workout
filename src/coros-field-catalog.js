// @ts-check

/**
 * The COROS response is provider-shaped. Only the fields confirmed by the
 * COROS app's lap view are promoted into the stable archive vocabulary.
 * Unknown additive fields remain in provider_metrics and are reported to the
 * human-readable note instead of being guessed or silently discarded.
 */
export const COROS_FIELD_CATALOG_VERSION = 2;

export const COROS_LAP_FIELD_CATALOG = Object.freeze([
  { provider_key: "distance", normalized_key: "distance_m", label: "距离", unit: "m", table: "main" },
  { provider_key: "time", normalized_key: "duration_sec", label: "时间", unit: "sec", table: "main" },
  { provider_key: "totalLength", normalized_key: "cumulative_duration_sec", label: "累计时间", unit: "sec", table: "main" },
  { provider_key: "elevGain", normalized_key: "elevation_gain_m", label: "上升", unit: "m", table: "main" },
  { provider_key: "totalDescent", normalized_key: "elevation_loss_m", label: "下降", unit: "m", table: "main" },
  { provider_key: "avgHr", normalized_key: "average_heart_rate_bpm", label: "平均心率", unit: "bpm", table: "main" },
  { provider_key: "maxHr", normalized_key: "max_heart_rate_bpm", label: "最大心率", unit: "bpm", table: "main" },
  { provider_key: "avgCadence", normalized_key: "average_cadence_spm", label: "步频", unit: "spm", table: "main" },
  { provider_key: "avgStrideLength", normalized_key: "average_stride_length_cm", label: "步幅", unit: "cm", table: "main" },
  { provider_key: "avgPace", normalized_key: "average_pace_sec_per_km", label: "平均配速", unit: "sec/km", table: "main" },
  { provider_key: "adjustedPace", normalized_key: "adjusted_pace_sec_per_km", label: "等效配速", unit: "sec/km", table: "main" },
  { provider_key: "vertSpeed", normalized_key: "vertical_speed_m_per_h", label: "垂直速度", unit: "m/h", table: "main" },
  { provider_key: "avgPower", normalized_key: "average_power_w", label: "跑步功率", unit: "W", table: "main" },

  // Recognized provider fields that are intentionally not promoted until the
  // app's exact unit/meaning is confirmed for the archive contract.
  { provider_key: "avgSpeedV2", normalized_key: null, label: "平均速度", unit: null, table: "provider" },
  { provider_key: "groundTime", normalized_key: null, label: "触地时间", unit: null, table: "provider" },
  { provider_key: "groundBalance", normalized_key: null, label: "左右平衡", unit: null, table: "provider" },
  { provider_key: "maxCadence", normalized_key: null, label: "最大步频", unit: null, table: "provider" },
  { provider_key: "strideRatio", normalized_key: null, label: "垂直步幅比", unit: null, table: "provider" },
  { provider_key: "strideHeight", normalized_key: null, label: "垂直振幅", unit: null, table: "provider" },
  { provider_key: "formPower", normalized_key: null, label: "姿势功率", unit: null, table: "provider" },
  { provider_key: "legStiffness", normalized_key: null, label: "下肢刚度", unit: null, table: "provider" },
  { provider_key: "bodyTemperature", normalized_key: null, label: "体温", unit: null, table: "provider" },
]);

const CATALOG_BY_PROVIDER_KEY = new Map(COROS_LAP_FIELD_CATALOG.map((field) => [field.provider_key, field]));
const RECOGNIZED_PROVIDER_KEYS = new Set([
  ...COROS_LAP_FIELD_CATALOG.map((field) => field.provider_key),
  "distance_m",
  "duration_sec",
  "cumulative_duration_sec",
  "elevation_gain_m",
  "elevation_loss_m",
  "average_heart_rate_bpm",
  "max_heart_rate_bpm",
  "average_cadence_spm",
  "average_stride_length_cm",
  "average_pace_sec_per_km",
  "adjusted_pace_sec_per_km",
  "vertical_speed_m_per_h",
  "average_power_w",
]);

export const COROS_LAP_TABLE_COLUMNS = Object.freeze([
  { key: "lap_index", label: "段", unit: null },
  { key: "distance_m", label: "距离", unit: "m" },
  { key: "duration_sec", label: "时间", unit: "sec" },
  { key: "cumulative_duration_sec", label: "累计时间", unit: "sec" },
  { key: "elevation_gain_m", label: "上升", unit: "m" },
  { key: "elevation_loss_m", label: "下降", unit: "m" },
  { key: "average_heart_rate_bpm", label: "平均心率", unit: "bpm" },
  { key: "max_heart_rate_bpm", label: "最大心率", unit: "bpm" },
  { key: "average_cadence_spm", label: "步频", unit: "spm" },
  { key: "average_stride_length_cm", label: "步幅", unit: "cm" },
  { key: "average_pace_sec_per_km", label: "平均配速", unit: "sec/km" },
  { key: "adjusted_pace_sec_per_km", label: "等效配速", unit: "sec/km" },
  { key: "vertical_speed_m_per_h", label: "垂直速度", unit: "m/h" },
  { key: "average_power_w", label: "跑步功率", unit: "W" },
]);

/** @param {unknown} value */
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {Record<string, any>} target @param {string} key @param {unknown} value */
function setIfMissing(target, key, value) {
  if (value === null || value === undefined) return;
  if (target[key] === null || target[key] === undefined) target[key] = value;
}

/**
 * Normalize only fields whose provider units are confirmed by the COROS lap
 * view. COROS lap distance uses 100 m units in the observed response.
 * @param {Record<string, any>} providerMetrics
 * @param {Record<string, any>} existingMetrics
 */
export function normalizeCorosLapMetrics(providerMetrics = {}, existingMetrics = {}) {
  const source = providerMetrics && typeof providerMetrics === "object" && !Array.isArray(providerMetrics) ? providerMetrics : {};
  const normalized = existingMetrics && typeof existingMetrics === "object" && !Array.isArray(existingMetrics) ? { ...existingMetrics } : {};
  const direct = [
    ["time", "duration_sec"],
    ["totalLength", "cumulative_duration_sec"],
    ["elevGain", "elevation_gain_m"],
    ["totalDescent", "elevation_loss_m"],
    ["avgHr", "average_heart_rate_bpm"],
    ["maxHr", "max_heart_rate_bpm"],
    ["avgCadence", "average_cadence_spm"],
    ["avgStrideLength", "average_stride_length_cm"],
    ["avgPace", "average_pace_sec_per_km"],
    ["adjustedPace", "adjusted_pace_sec_per_km"],
    ["vertSpeed", "vertical_speed_m_per_h"],
    ["avgPower", "average_power_w"],
  ];
  for (const [providerKey, normalizedKey] of direct) setIfMissing(normalized, normalizedKey, finiteNumber(source[providerKey]));
  const distance = finiteNumber(source.distance);
  if (distance !== null) setIfMissing(normalized, "distance_m", distance / 100);
  return normalized;
}

/** @param {Record<string, any>} providerMetrics @returns {string[]} */
export function unknownCorosProviderFields(providerMetrics = {}) {
  if (!providerMetrics || typeof providerMetrics !== "object" || Array.isArray(providerMetrics)) return [];
  return Object.keys(providerMetrics)
    .filter((key) => !RECOGNIZED_PROVIDER_KEYS.has(key))
    .sort();
}

/** @param {string} providerKey @returns {any|null} */
export function corosFieldDefinition(providerKey) {
  return CATALOG_BY_PROVIDER_KEY.get(providerKey) ?? null;
}
