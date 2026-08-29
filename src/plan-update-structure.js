// @ts-check

/**
 * Portable Plan Update Package v2 structure.
 *
 * This module deliberately excludes Athlete-local and repository semantics:
 * dates, registry membership, Exercise capabilities, ordering relationships,
 * uniqueness, and trimming are validated by the Server after this seam.
 */

export const PLAN_UPDATE_WEEKDAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
export const PLAN_UPDATE_KEY_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
export const PLAN_UPDATE_TEMPO_PATTERN = "^(?:0|[1-9]\\d*)(?:\\.\\d+)?-(?:0|[1-9]\\d*)(?:\\.\\d+)?-(?:0|[1-9]\\d*)(?:\\.\\d+)?-(?:0|[1-9]\\d*)(?:\\.\\d+)?$";

/** @param {Record<string, any>} properties @param {string[]} [required] */
function exactObject(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

/** @param {any} schema */
function nullable(schema) { return { oneOf: [{ type: "null" }, schema] }; }

/** @param {any} items @param {number} minItems @param {number} [maxItems] */
function arrayOf(items, minItems, maxItems) {
  return { type: "array", items, minItems, ...(maxItems === undefined ? {} : { maxItems }) };
}

const targetSchema = exactObject({
  metric: { type: "string", enum: ["reps", "duration_sec"] },
  value: { type: "integer", minimum: 1 },
});

const resistanceSchema = nullable({
  oneOf: [
    exactObject({ mode: { const: "bodyweight" } }),
    exactObject({
      mode: { const: "external_load" },
      value: { type: "number", minimum: 0 },
      unit: { type: "string", enum: ["kg", "lb"] },
    }),
  ],
});

const setSchema = exactObject({
  set_id: { type: "string", pattern: PLAN_UPDATE_KEY_PATTERN },
  ordinal: { type: "integer", minimum: 1 },
  target: targetSchema,
  resistance: resistanceSchema,
  tempo: nullable({ type: "string", pattern: PLAN_UPDATE_TEMPO_PATTERN }),
  rest_after_sec: nullable({ type: "integer", minimum: 0 }),
});

const exerciseSchema = exactObject({
  occurrence_key: { type: "string", pattern: PLAN_UPDATE_KEY_PATTERN },
  exercise_id: { type: "string", pattern: PLAN_UPDATE_KEY_PATTERN },
  execution_mode: { type: "string", enum: ["none", "bilateral", "per_side", "alternating"] },
  sets: arrayOf(setSchema, 1, 200),
});

const blockSchema = exactObject({
  title: { type: "string", minLength: 1, maxLength: 100 },
  exercises: arrayOf(exerciseSchema, 1),
});

const recordingIntentSchema = exactObject({
  schema_version: { type: "integer", const: 1 },
  source: { const: "coros" },
  sport_type: { type: "integer", enum: [100, 102, 104, 200] },
  route_key: { type: "string", minLength: 1, maxLength: 100 },
});

const workoutSchema = exactObject({
  kind: { const: "workout" },
  title: { type: "string", minLength: 1, maxLength: 100 },
  start_time: nullable({ type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }),
  estimated_duration_min: { type: "integer", minimum: 1 },
  recording_intent: recordingIntentSchema,
  blocks: arrayOf(blockSchema, 1, 20),
}, ["kind", "title", "start_time", "estimated_duration_min", "blocks"]);

const slotSchema = {
  oneOf: [
    { type: "null" },
    exactObject({ kind: { const: "rest" } }),
    workoutSchema,
  ],
};

export const PLAN_UPDATE_PACKAGE_V2_SCHEMA = exactObject({
  schema_version: { type: "integer", const: 2 },
  effective_from: { type: "string" },
  week: exactObject(Object.fromEntries(PLAN_UPDATE_WEEKDAYS.map((day) => [day, slotSchema]))),
});

/** @typedef {{ path: string, message: string }} SchemaValidationError */

/**
 * Validate a value against the small JSON Schema vocabulary used by MCP tools.
 *
 * @param {any} schema
 * @param {any} value
 * @param {string} [path]
 * @returns {SchemaValidationError[]}
 */
export function validateSchemaValue(schema, value, path = "") {
  if (schema.oneOf) {
    const candidates = /** @type {any[]} */ (schema.oneOf);
    const results = candidates.map((/** @type {any} */ candidate) => validateSchemaValue(candidate, value, path));
    if (results.some((/** @type {SchemaValidationError[]} */ errors) => errors.length === 0)) return [];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const discriminator of ["kind", "mode"]) {
        const index = candidates.findIndex((/** @type {any} */ candidate) => candidate.properties?.[discriminator]?.const === value[discriminator]);
        if (index !== -1) return results[index];
      }
    }
    const matchingTypeIndexes = candidates
      .map((/** @type {any} */ candidate, /** @type {number} */ index) => runtimeTypeMatches(candidate, value) ? index : -1)
      .filter((/** @type {number} */ index) => index !== -1);
    if (matchingTypeIndexes.length === 1) return results[matchingTypeIndexes[0]];
    return [{ path, message: "does not match the expected shape" }];
  }
  if (schema.type === "null") return value === null ? [] : [{ path, message: "must be null" }];
  if (schema.type === "string") {
    if (typeof value !== "string") return [{ path, message: "must be a string" }];
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return [{ path, message: "has an invalid format" }];
    if (schema.minLength !== undefined && value.length < schema.minLength) return [{ path, message: "is too short" }];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return [{ path, message: "is too long" }];
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [{ path, message: "must be an object" }];
    /** @type {SchemaValidationError[]} */
    const errors = [];
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push({ path: `${path}/${pointerSegment(required)}`, message: "is required" });
    }
    for (const key of Object.keys(value)) {
      const nested = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties[key] : undefined;
      const nestedPath = `${path}/${pointerSegment(key)}`;
      if (!nested && schema.additionalProperties === false) errors.push({ path: nestedPath, message: "is an unknown field" });
      else if (nested) errors.push(...validateSchemaValue(nested, value[key], nestedPath));
    }
    return errors;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [{ path, message: "must be an array" }];
    if (schema.minItems !== undefined && value.length < schema.minItems) return [{ path, message: `must contain at least ${schema.minItems} items` }];
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return [{ path, message: `must contain at most ${schema.maxItems} items` }];
    return value.flatMap((item, index) => validateSchemaValue(schema.items, item, `${path}/${index}`));
  }
  if (schema.type === "boolean" && typeof value !== "boolean") return [{ path, message: "must be a boolean" }];
  if (schema.type === "integer" && !Number.isInteger(value)) return [{ path, message: "must be an integer" }];
  if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return [{ path, message: "must be a finite number" }];
  if (schema.const !== undefined && value !== schema.const) return [{ path, message: "is unsupported" }];
  if (schema.minimum !== undefined && value < schema.minimum) return [{ path, message: "is below the minimum" }];
  if (schema.maximum !== undefined && value > schema.maximum) return [{ path, message: "is above the maximum" }];
  if (schema.enum && !schema.enum.includes(value)) return [{ path, message: "is unsupported" }];
  if (schema.format === "date" && !isValidDate(value)) return [{ path, message: "must be a valid YYYY-MM-DD date" }];
  return [];
}

/** @param {any} schema @param {any} value */
function runtimeTypeMatches(schema, value) {
  if (schema.type === undefined) return true;
  if (schema.type === "null") return value === null;
  if (schema.type === "array") return Array.isArray(value);
  if (schema.type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (schema.type === "integer") return Number.isInteger(value);
  if (schema.type === "number") return typeof value === "number";
  return typeof value === schema.type;
}

/** @param {string} value */
function pointerSegment(value) { return value.replaceAll("~", "~0").replaceAll("/", "~1"); }

/** @param {any} value @returns {SchemaValidationError[]} */
export function validatePlanUpdatePackageStructure(value) {
  return validateSchemaValue(PLAN_UPDATE_PACKAGE_V2_SCHEMA, value);
}

/** @param {any} value */
function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
