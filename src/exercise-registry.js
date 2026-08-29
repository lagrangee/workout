// @ts-check

import registryDocument from "../config/exercises.json" with { type: "json" };

const SIDE_MODES = new Set(["none", "bilateral", "per_side", "alternating"]);
const METRICS = new Set(["reps", "duration_sec"]);
const RESISTANCE_MODES = new Set(["bodyweight", "external_load"]);
const UNITS = new Set(["kg", "lb"]);
const STATUSES = new Set(["active", "deprecated"]);
const CATEGORIES = new Set(["strength", "endurance", "mobility", "recovery"]);
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** @param {unknown} value @returns {value is string} */
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }

/** @param {unknown} value @returns {value is string[]} */
function isStringArray(value) { return Array.isArray(value) && value.every((item) => typeof item === "string"); }

/** @param {any[]} values @param {Set<string>} allowed @param {string} path @param {string[]} errors */
function validateEnumArray(values, allowed, path, errors) {
  if (!isStringArray(values) || values.length === 0) {
    errors.push(`${path} must be a non-empty string array`);
    return;
  }
  if (new Set(values).size !== values.length) errors.push(`${path} must not contain duplicates`);
  for (const value of values) if (!allowed.has(value)) errors.push(`${path} contains unsupported value ${value}`);
}

/** @param {unknown} value @returns {{ ok: true, document: any } | { ok: false, errors: string[] }} */
export function validateExerciseRegistryDocument(value) {
  const errors = [];
  if (!isRecord(value)) return { ok: false, errors: ["registry must be an object"] };
  if (value.schema_version !== 1) errors.push("schema_version must be 1");
  if (!Array.isArray(value.exercises) || value.exercises.length === 0) errors.push("exercises must be a non-empty array");
  if (errors.length > 0) return { ok: false, errors };

  const ids = new Set();
  const slugs = new Set();
  for (const [index, exercise] of value.exercises.entries()) {
    const path = `exercises[${index}]`;
    if (!isRecord(exercise)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (!isNonEmptyString(exercise.exercise_id) || !KEY_PATTERN.test(exercise.exercise_id)) errors.push(`${path}.exercise_id must match ${KEY_PATTERN}`);
    if (ids.has(exercise.exercise_id)) errors.push(`duplicate exercise_id ${exercise.exercise_id}`);
    ids.add(exercise.exercise_id);
    if (!isNonEmptyString(exercise.slug) || !SLUG_PATTERN.test(exercise.slug)) errors.push(`${path}.slug must match ${SLUG_PATTERN}`);
    if (slugs.has(exercise.slug)) errors.push(`duplicate slug ${exercise.slug}`);
    slugs.add(exercise.slug);
    if (!isNonEmptyString(exercise.name) || exercise.name.length > 100) errors.push(`${path}.name must be a non-empty string of at most 100 characters`);
    if (!Number.isInteger(exercise.definition_version) || exercise.definition_version < 1) errors.push(`${path}.definition_version must be a positive integer`);
    if (!STATUSES.has(exercise.status)) errors.push(`${path}.status must be active or deprecated`);
    if (!CATEGORIES.has(exercise.category)) errors.push(`${path}.category must be strength, endurance, mobility, or recovery`);

    if (!isRecord(exercise.execution)) errors.push(`${path}.execution must be an object`);
    else validateEnumArray(exercise.execution.side_modes, SIDE_MODES, `${path}.execution.side_modes`, errors);
    if (!isRecord(exercise.target)) errors.push(`${path}.target must be an object`);
    else validateEnumArray(exercise.target.metrics, METRICS, `${path}.target.metrics`, errors);
    if (!isRecord(exercise.resistance)) errors.push(`${path}.resistance must be an object`);
    else {
      validateEnumArray(exercise.resistance.modes, RESISTANCE_MODES, `${path}.resistance.modes`, errors);
      if (!isStringArray(exercise.resistance.units)) errors.push(`${path}.resistance.units must be a string array`);
      else {
        if (new Set(exercise.resistance.units).size !== exercise.resistance.units.length) errors.push(`${path}.resistance.units must not contain duplicates`);
        for (const unit of exercise.resistance.units) if (!UNITS.has(unit)) errors.push(`${path}.resistance.units contains unsupported value ${unit}`);
        if (exercise.resistance.modes?.includes("external_load") && exercise.resistance.units.length === 0) errors.push(`${path}.resistance.units is required when external_load is supported`);
        if (!exercise.resistance.modes?.includes("external_load") && exercise.resistance.units.length > 0) errors.push(`${path}.resistance.units must be empty without external_load`);
      }
    }
    if (!isRecord(exercise.equipment)) errors.push(`${path}.equipment must be an object`);
    else {
      for (const field of ["required", "optional"]) {
        const values = exercise.equipment[field];
        if (!isStringArray(values)) errors.push(`${path}.equipment.${field} must be a string array`);
        else {
          if (new Set(values).size !== values.length) errors.push(`${path}.equipment.${field} must not contain duplicates`);
          for (const equipment of values) if (!KEY_PATTERN.test(equipment)) errors.push(`${path}.equipment.${field} contains invalid key ${equipment}`);
        }
      }
      if (isStringArray(exercise.equipment.required) && isStringArray(exercise.equipment.optional)) {
        const required = new Set(exercise.equipment.required);
        for (const equipment of exercise.equipment.optional) if (required.has(equipment)) errors.push(`${path}.equipment.required and optional must be disjoint`);
      }
    }
    if (!isRecord(exercise.capabilities)) errors.push(`${path}.capabilities must be an object`);
    else for (const [extension, extensionValue] of Object.entries(exercise.capabilities)) {
      if (!KEY_PATTERN.test(extension) || !isRecord(extensionValue) || !Number.isInteger(extensionValue.schema_version) || extensionValue.schema_version < 1) errors.push(`${path}.capabilities.${extension} must be a versioned object`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, document: value };
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const validation = validateExerciseRegistryDocument(registryDocument);
if (!validation.ok) throw new Error(`Invalid bundled Exercise Registry: ${validation.errors.join("; ")}`);

/** @type {any} */
const BUNDLED_REGISTRY = deepFreeze(registryDocument);
const BY_ID = new Map(BUNDLED_REGISTRY.exercises.map(/** @param {any} exercise */ (exercise) => [exercise.exercise_id, exercise]));

/** @returns {any} */
export function exerciseRegistry() { return BUNDLED_REGISTRY; }

/** @returns {any[]} */
export function listExerciseDefinitions() { return BUNDLED_REGISTRY.exercises; }

/** @param {string} exerciseId @returns {any | null} */
export function resolveExercise(exerciseId) { return BY_ID.get(exerciseId) ?? null; }

/** @param {string} exerciseId */
export function resolveActiveExercise(exerciseId) {
  const exercise = resolveExercise(exerciseId);
  return exercise?.status === "active" ? exercise : null;
}
