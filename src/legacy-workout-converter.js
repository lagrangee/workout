// @ts-check

import { createHash } from "node:crypto";
import { deepClone, WEEKDAYS } from "./util.js";
import { resolveExercise } from "./exercise-registry.js";

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const TARGET_METRICS = new Set(["reps", "duration_sec"]);
const LEGACY_TEMPO_KEYS = ["eccentric_sec", "bottom_hold_sec", "concentric_sec", "top_hold_sec"];

/** @typedef {{ rangePolicy: "max" }} RangeOptions */
/** @typedef {NonNullable<ReturnType<typeof resolveExercise>>} ExerciseDefinition */
/** @typedef {{ revision_key: string, revision_sequence: number, created_at: string, effective_from: string, week: Record<string, any> }} ConvertedRevision */

/**
 * Convert the bounded legacy Workout v1 document to the canonical v2 state
 * consumed by the explicit D1 rebuild. This is intentionally one-way and
 * strict: the caller must name the range policy, and unsupported legacy
 * shapes fail instead of being silently repaired.
 *
 * @param {unknown} legacyState
 * @param {RangeOptions} options
 */
export function convertLegacyState(legacyState, options) {
  if (options?.rangePolicy !== "max") throw new Error("Legacy conversion requires --range-policy max");
  requireRecord(legacyState, "state");
  for (const field of ["athlete_key", "email", "timezone"]) requireString(legacyState[field], `state.${field}`);
  if (!Array.isArray(legacyState.plan_revisions)) throw new Error("state.plan_revisions must be an array");
  if (!Array.isArray(legacyState.sessions)) throw new Error("state.sessions must be an array");
  if (legacyState.legacy_workout_v1 !== undefined) throw new Error("state.legacy_workout_v1 already exists");

  const revisionKeys = new Set();
  const planRevisions = legacyState.plan_revisions.map((revision, revisionIndex) => {
    const converted = convertLegacyRevision(revision, revisionIndex, options);
    if (revisionKeys.has(converted.revision_key)) throw new Error(`Duplicate Plan Revision ${converted.revision_key}`);
    revisionKeys.add(converted.revision_key);
    return converted;
  });
  const planId = `plan_${legacyState.athlete_key}`;
  const sessions = legacyState.sessions.map((session, sessionIndex) => convertLegacySession(session, sessionIndex, planId, planRevisions, options));

  return {
    ...deepClone(legacyState),
    // The exact v1 Workout facts stay available for rollback/audit. Runtime
    // reads never use this field after the cutover marker is written.
    legacy_workout_v1: {
      schema_version: 1,
      plan_revisions: deepClone(legacyState.plan_revisions),
      sessions: deepClone(legacyState.sessions),
    },
    plan_revisions: planRevisions,
    sessions,
  };
}

/**
 * Convert the JSON envelope emitted by Wrangler's `d1 execute --json`.
 * @param {unknown} input
 * @param {RangeOptions} options
 */
export function convertLegacyExport(input, options) {
  const rows = extractRows(input);
  if (rows.length === 0) throw new Error("Legacy export contains no Athlete rows");
  return rows.map((row, index) => {
    const state = typeof row?.state_json === "string" ? JSON.parse(row.state_json) : row?.state ?? row;
    const converted = convertLegacyState(state, options);
    return {
      athlete_key: converted.athlete_key,
      email: converted.email,
      state_revision: row?.state_revision ?? row?.stateRevision ?? null,
      state: converted,
    };
  });
}

/** @param {unknown} input @returns {any[]} */
function extractRows(input) {
  if (Array.isArray(input)) {
    if (input.every((part) => Array.isArray(part?.results))) return input.flatMap((part) => part.results);
    return input;
  }
  if (typeof input === "object" && input !== null && "results" in input && Array.isArray(input.results)) return input.results;
  return [input];
}

/** @param {unknown} revision @param {number} revisionIndex @param {RangeOptions} options @returns {ConvertedRevision} */
function convertLegacyRevision(revision, revisionIndex, options) {
  requireRecord(revision, `plan_revisions[${revisionIndex}]`);
  const label = `plan_revisions[${revisionIndex}]`;
  const revisionKey = requireString(revision.revision_key, `${label}.revision_key`);
  const revisionSequence = requirePositiveInteger(revision.revision_sequence, `${label}.revision_sequence`);
  const effectiveFrom = requireString(revision.effective_from, `${label}.effective_from`);
  const createdAt = requireString(revision.created_at, `${label}.created_at`);
  requireRecord(revision.week, `${label}.week`);
  /** @type {Record<string, any>} */
  const week = {};
  for (const weekday of WEEKDAYS) {
    if (!Object.hasOwn(revision.week, weekday)) throw new Error(`${label}.week.${weekday} is required`);
    week[weekday] = convertLegacySlot(revision.week[weekday], `${label}.week.${weekday}`, weekday, options);
  }
  return { revision_key: revisionKey, revision_sequence: revisionSequence, created_at: createdAt, effective_from: effectiveFrom, week };
}

/** @param {unknown} slot @param {string} label @param {string} weekday @param {RangeOptions} options */
function convertLegacySlot(slot, label, weekday, options) {
  if (slot === null) return null;
  requireRecord(slot, label);
  if (slot.kind === "rest") return { kind: "rest" };
  if (slot.kind !== "workout") throw new Error(`${label}.kind must be workout or rest`);
  const title = requireString(slot.title, `${label}.title`);
  const startTime = slot.start_time === null ? null : requireString(slot.start_time, `${label}.start_time`);
  const estimatedDuration = requirePositiveInteger(slot.estimated_duration_min, `${label}.estimated_duration_min`);
  if (!Array.isArray(slot.blocks) || slot.blocks.length === 0) throw new Error(`${label}.blocks must be a non-empty array`);
  const blocks = slot.blocks.map((block, blockIndex) => {
    const blockLabel = `${label}.blocks[${blockIndex}]`;
    requireRecord(block, blockLabel);
    const blockTitle = requireString(block.title, `${blockLabel}.title`);
    if (!Array.isArray(block.exercises) || block.exercises.length === 0) throw new Error(`${blockLabel}.exercises must be a non-empty array`);
    const occurrences = new Set();
    const exercises = block.exercises.map((exercise, exerciseIndex) => {
      const converted = convertLegacyPlanExercise(exercise, `${blockLabel}.exercises[${exerciseIndex}]`, weekday, blockIndex, exerciseIndex, options);
      if (occurrences.has(converted.occurrence_key)) throw new Error(`${blockLabel} contains duplicate occurrence ${converted.occurrence_key}`);
      occurrences.add(converted.occurrence_key);
      return converted;
    });
    return { title: blockTitle, exercises };
  });
  return { kind: "workout", title, start_time: startTime, estimated_duration_min: estimatedDuration, blocks };
}

/** @param {unknown} exercise @param {string} label @param {string} weekday @param {number} blockIndex @param {number} exerciseIndex @param {RangeOptions} options */
function convertLegacyPlanExercise(exercise, label, weekday, blockIndex, exerciseIndex, options) {
  requireRecord(exercise, label);
  const exerciseId = requireString(exercise.exercise_key, `${label}.exercise_key`);
  const definition = activeDefinition(exerciseId, label);
  const executionMode = legacyExecutionMode(exercise.side_mode, definition, `${label}.side_mode`);
  ensureModeSupported(definition, executionMode, label);
  const occurrenceKey = generatedKey(`${weekday}_block_${blockIndex + 1}_exercise_${exerciseIndex + 1}_${exerciseId}`);
  if (!Array.isArray(exercise.sets) || exercise.sets.length === 0) throw new Error(`${label}.sets must be a non-empty array`);
  const sets = exercise.sets.map((set, setIndex) => convertLegacySet(set, `${label}.sets[${setIndex}]`, generatedKey(`${occurrenceKey}_set_${setIndex + 1}`), options, setIndex + 1));
  return {
    occurrence_key: occurrenceKey,
    exercise_id: exerciseId,
    execution_mode: executionMode,
    name: definition.name,
    definition_version: definition.definition_version,
    category: definition.category,
    sets,
  };
}

/** @param {unknown} session @param {number} sessionIndex @param {string} planId @param {ConvertedRevision[]} revisions @param {RangeOptions} options */
function convertLegacySession(session, sessionIndex, planId, revisions, options) {
  const label = `sessions[${sessionIndex}]`;
  requireRecord(session, label);
  const sessionKey = canonicalKey(requireString(session.session_key, `${label}.session_key`), `${label}.session_key`);
  const scheduledDate = requireString(session.scheduled_date, `${label}.scheduled_date`);
  const revision = selectRevision(session, scheduledDate, revisions, label);
  const snapshot = convertLegacySnapshot(session.snapshot, `${label}.snapshot`, options);
  const items = snapshot.completion_items;
  const itemMap = new Map(items.map((item) => [item.completion_item_key, item]));
  const results = convertLegacyResults(session.completion_results, `${label}.completion_results`, itemMap);
  const intervals = convertLegacyIntervals(session.training_intervals, `${label}.training_intervals`);
  const feedback = convertLegacyFeedback(session.exercise_feedback, `${label}.exercise_feedback`, snapshot.exercise_occurrence_keys);
  const status = requireString(session.status, `${label}.status`);
  if (!["planned", "in_progress", "completed", "partial", "abandoned", "skipped"].includes(status)) throw new Error(`${label}.status is unsupported: ${status}`);
  const planRevisionKey = session.plan_revision_key ?? revision.revision_key;
  if (planRevisionKey !== revision.revision_key) throw new Error(`${label}.plan_revision_key does not match the legacy Plan Revision selected by date`);
  return {
    session_key: sessionKey,
    plan_id: session.plan_id ?? planId,
    plan_revision_key: planRevisionKey,
    scheduled_workout_key: session.scheduled_workout_key ?? generatedKey(`sw_${planId}_${scheduledDate}`),
    scheduled_date: scheduledDate,
    local_date: session.local_date ?? scheduledDate,
    timezone_at_session: requireString(session.timezone_at_session, `${label}.timezone_at_session`),
    title: requireString(session.title, `${label}.title`),
    status,
    snapshot,
    completion_results: results,
    set_results: deepClone(results),
    training_intervals: intervals,
    session_rpe: nullableInteger(session.session_rpe, `${label}.session_rpe`, 0, 10),
    note: session.note ?? null,
    skip_reason: session.skip_reason ?? null,
    exercise_feedback: feedback,
    created_at: requireString(session.created_at, `${label}.created_at`),
    updated_at: requireString(session.updated_at, `${label}.updated_at`),
  };
}

/** @param {Record<string, any>} session @param {string} scheduledDate @param {ConvertedRevision[]} revisions @param {string} label @returns {ConvertedRevision} */
function selectRevision(session, scheduledDate, revisions, label) {
  if (revisions.length === 0) throw new Error(`${label} cannot be converted because there is no Plan Revision`);
  if (session.plan_revision_key) {
    const explicit = revisions.find((revision) => revision.revision_key === session.plan_revision_key);
    if (!explicit) throw new Error(`${label}.plan_revision_key references an unknown Plan Revision`);
    return explicit;
  }
  const applicable = revisions.filter((revision) => revision.effective_from <= scheduledDate).sort((left, right) => right.effective_from.localeCompare(left.effective_from) || right.revision_sequence - left.revision_sequence);
  if (applicable.length === 0) throw new Error(`${label} has no Plan Revision effective on ${scheduledDate}`);
  return applicable[0];
}

/** @param {unknown} snapshot @param {string} label @param {RangeOptions} options */
function convertLegacySnapshot(snapshot, label, options) {
  requireRecord(snapshot, label);
  if (!Array.isArray(snapshot.blocks)) throw new Error(`${label}.blocks must be an array`);
  const exerciseMap = new Map();
  const blocks = snapshot.blocks.map((block, blockIndex) => {
    const blockLabel = `${label}.blocks[${blockIndex}]`;
    requireRecord(block, blockLabel);
    const blockKey = canonicalKey(block.block_key ?? generatedKey(`snapshot_block_${blockIndex + 1}`), `${blockLabel}.block_key`);
    if (!Array.isArray(block.exercises)) throw new Error(`${blockLabel}.exercises must be an array`);
    const exercises = block.exercises.map((exercise, exerciseIndex) => {
      const exerciseLabel = `${blockLabel}.exercises[${exerciseIndex}]`;
      requireRecord(exercise, exerciseLabel);
      const occurrenceKey = canonicalKey(requireString(exercise.exercise_occurrence_key, `${exerciseLabel}.exercise_occurrence_key`), `${exerciseLabel}.exercise_occurrence_key`);
      if (exerciseMap.has(occurrenceKey)) throw new Error(`${label} contains duplicate occurrence ${occurrenceKey}`);
      const definition = activeDefinition(requireString(exercise.exercise_key, `${exerciseLabel}.exercise_key`), exerciseLabel);
      const executionMode = legacyExecutionMode(exercise.side_mode, definition, `${exerciseLabel}.side_mode`);
      ensureModeSupported(definition, executionMode, exerciseLabel);
      if (!Array.isArray(exercise.sets) || exercise.sets.length === 0) throw new Error(`${exerciseLabel}.sets must be a non-empty array`);
      const sets = exercise.sets.map((set, setIndex) => {
        const setLabel = `${exerciseLabel}.sets[${setIndex}]`;
        const setKey = canonicalKey(requireString(set.set_key, `${setLabel}.set_key`), `${setLabel}.set_key`);
        return convertLegacySet(set, setLabel, setKey, options, setIndex + 1);
      });
      const setMap = new Map(sets.map((set) => [set.set_id, set]));
      const converted = {
        exercise_occurrence_key: occurrenceKey,
        occurrence_key: occurrenceKey,
        exercise_id: definition.exercise_id,
        name: requireString(exercise.name, `${exerciseLabel}.name`),
        definition_version: definition.definition_version,
        category: definition.category,
        execution_mode: executionMode,
        sets: sets.map((set) => ({ set_key: set.set_id, ...set })),
      };
      exerciseMap.set(occurrenceKey, { exercise: converted, sets: setMap });
      return converted;
    });
    return { block_key: blockKey, title: requireString(block.title, `${blockLabel}.title`), exercises };
  });

  if (!Array.isArray(snapshot.completion_items)) throw new Error(`${label}.completion_items must be an array`);
  const completionItems = snapshot.completion_items.map((item, itemIndex) => {
    const itemLabel = `${label}.completion_items[${itemIndex}]`;
    requireRecord(item, itemLabel);
    const completionItemKey = canonicalKey(requireString(item.completion_item_key, `${itemLabel}.completion_item_key`), `${itemLabel}.completion_item_key`);
    const occurrenceKey = canonicalKey(requireString(item.exercise_occurrence_key, `${itemLabel}.exercise_occurrence_key`), `${itemLabel}.exercise_occurrence_key`);
    const occurrence = exerciseMap.get(occurrenceKey);
    if (!occurrence) throw new Error(`${itemLabel} references unknown occurrence ${occurrenceKey}`);
    const setKey = canonicalKey(requireString(item.set_key, `${itemLabel}.set_key`), `${itemLabel}.set_key`);
    const set = occurrence.sets.get(setKey);
    if (!set) throw new Error(`${itemLabel} references unknown Set ${setKey}`);
    const target = convertLegacyTarget(item.target, `${itemLabel}.target`, options);
    if (target.metric !== set.target.metric || target.value !== set.target.value) throw new Error(`${itemLabel}.target does not match its snapshot Set`);
    const resistance = convertLegacyResistance(item.resistance, `${itemLabel}.resistance`);
    if (resistance.resistance_mode !== set.resistance_mode || resistance.resistance_kg !== set.resistance_kg) throw new Error(`${itemLabel}.resistance does not match its snapshot Set`);
    let side = requireString(item.side, `${itemLabel}.side`);
    if (!["none", "both", "left", "right"].includes(side)) throw new Error(`${itemLabel}.side is unsupported: ${side}`);
    if (occurrence.exercise.execution_mode === "bilateral" && side === "none") side = "both";
    return {
      completion_item_key: completionItemKey,
      exercise_occurrence_key: occurrenceKey,
      occurrence_key: occurrenceKey,
      set_key: setKey,
      set_id: setKey,
      set_ordinal: set.ordinal,
      side,
      target,
      ...resistance,
      resistance: resistanceProjection(resistance.resistance_mode, resistance.resistance_kg),
      tempo: set.tempo,
      rest_after_sec: set.rest_after_sec,
    };
  });
  const occurrenceKeys = Array.isArray(snapshot.exercise_occurrence_keys) ? snapshot.exercise_occurrence_keys.map((key, index) => canonicalKey(requireString(key, `${label}.exercise_occurrence_keys[${index}]`), `${label}.exercise_occurrence_keys[${index}]`)) : blocks.flatMap((block) => block.exercises.map((exercise) => exercise.exercise_occurrence_key));
  const mappedOccurrenceKeys = blocks.flatMap((block) => block.exercises.map((exercise) => exercise.exercise_occurrence_key));
  if (occurrenceKeys.length !== mappedOccurrenceKeys.length || occurrenceKeys.some((key) => !mappedOccurrenceKeys.includes(key))) throw new Error(`${label}.exercise_occurrence_keys does not match snapshot Exercises`);
  return {
    schema_version: 2,
    title: requireString(snapshot.title, `${label}.title`),
    start_time: snapshot.start_time ?? null,
    estimated_duration_min: snapshot.estimated_duration_min == null ? null : requirePositiveInteger(snapshot.estimated_duration_min, `${label}.estimated_duration_min`),
    blocks,
    completion_items: completionItems,
    exercise_occurrence_keys: occurrenceKeys,
  };
}

/** @param {unknown} set @param {string} label @param {string} setId @param {RangeOptions} options @param {number} fallbackOrdinal */
function convertLegacySet(set, label, setId, options, fallbackOrdinal) {
  requireRecord(set, label);
  const target = convertLegacyTarget(set.target, `${label}.target`, options);
  const resistance = convertLegacyResistance(set.resistance, `${label}.resistance`);
  return {
    set_id: setId,
    ordinal: requirePositiveInteger(set.ordinal ?? fallbackOrdinal, `${label}.ordinal`),
    target,
    ...resistance,
    resistance: resistanceProjection(resistance.resistance_mode, resistance.resistance_kg),
    tempo: convertLegacyTempo(set.tempo, `${label}.tempo`),
    rest_after_sec: set.rest_after_sec == null ? null : requireNonNegativeInteger(set.rest_after_sec, `${label}.rest_after_sec`),
  };
}

/** @param {unknown} target @param {string} label @param {RangeOptions} options */
function convertLegacyTarget(target, label, options) {
  requireRecord(target, label);
  const metric = requireString(target.metric, `${label}.metric`);
  if (!TARGET_METRICS.has(metric)) throw new Error(`${label}.metric is unsupported: ${metric}`);
  const minimum = requirePositiveInteger(target.min, `${label}.min`);
  const maximum = requirePositiveInteger(target.max, `${label}.max`);
  if (maximum < minimum) throw new Error(`${label}.max must be greater than or equal to min`);
  if (options.rangePolicy !== "max") throw new Error(`Unsupported legacy range policy ${options.rangePolicy}`);
  return { metric, value: maximum };
}

/** @param {unknown} value @param {string} label */
function convertLegacyResistance(value, label) {
  if (value === null || value === undefined) return { resistance_mode: null, resistance_kg: null };
  requireRecord(value, label);
  if (value.mode === "bodyweight") {
    if (value.load_kg !== null && value.load_kg !== undefined) throw new Error(`${label}.load_kg must be null for bodyweight`);
    if (value.quantity !== null && value.quantity !== undefined) throw new Error(`${label}.quantity must be null for bodyweight`);
    return { resistance_mode: "bodyweight", resistance_kg: null };
  }
  if (value.mode !== "external_weight") throw new Error(`${label}.mode cannot be represented canonically: ${value.mode}`);
  if (!Number.isInteger(value.quantity) || value.quantity !== 1) throw new Error(`${label}.quantity must be 1 for canonical external_load`);
  if (value.load_kg !== null && (!Number.isFinite(value.load_kg) || value.load_kg < 0)) throw new Error(`${label}.load_kg must be a non-negative number or null`);
  return { resistance_mode: "external_load", resistance_kg: value.load_kg ?? null };
}

/** @param {unknown} value @param {string} label */
function convertLegacyTempo(value, label) {
  if (value === null || value === undefined) return null;
  requireRecord(value, label);
  for (const key of Object.keys(value)) if (!LEGACY_TEMPO_KEYS.includes(key)) throw new Error(`${label} contains unsupported phase ${key}`);
  const values = LEGACY_TEMPO_KEYS.map((key) => value[key] ?? null);
  if (values.every((phase) => phase === null)) return null;
  for (const [index, phase] of values.entries()) if (phase !== null && (!Number.isInteger(phase) || phase < 0)) throw new Error(`${label}.${LEGACY_TEMPO_KEYS[index]} must be a non-negative integer or null`);
  return values.map((phase) => phase ?? 0).join("-");
}

/** @param {unknown} results @param {string} label @param {Map<string, any>} itemMap */
function convertLegacyResults(results, label, itemMap) {
  if (!Array.isArray(results)) throw new Error(`${label} must be an array`);
  const seen = new Set();
  return results.map((result, index) => {
    const resultLabel = `${label}[${index}]`;
    requireRecord(result, resultLabel);
    const completionItemKey = canonicalKey(requireString(result.completion_item_key, `${resultLabel}.completion_item_key`), `${resultLabel}.completion_item_key`);
    if (seen.has(completionItemKey)) throw new Error(`${label} contains duplicate Completion Item ${completionItemKey}`);
    seen.add(completionItemKey);
    const item = itemMap.get(completionItemKey);
    if (!item) throw new Error(`${resultLabel} references unknown Completion Item ${completionItemKey}`);
    if (typeof result.completed !== "boolean") throw new Error(`${resultLabel}.completed must be boolean`);
    const actual = result.actual == null ? null : convertActual(result.actual, `${resultLabel}.actual`, item.target.metric);
    const status = result.completed ? "completed" : actual ? "partial" : "skipped";
    if (status === "completed" && !actual) throw new Error(`${resultLabel}.completed requires actual`);
    if (status === "skipped" && actual) throw new Error(`${resultLabel}.skipped cannot contain actual`);
    return {
      completion_item_key: completionItemKey,
      status,
      actual,
      ...convertLegacyResistance(result.resistance, `${resultLabel}.resistance`),
      resistance: result.resistance == null ? null : resistanceProjection(convertLegacyResistance(result.resistance, `${resultLabel}.resistance`).resistance_mode, convertLegacyResistance(result.resistance, `${resultLabel}.resistance`).resistance_kg),
      rir: nullableInteger(result.rir, `${resultLabel}.rir`, 0, 10),
      note: result.note ?? null,
      completed_at: result.completed_at ?? null,
      completed: status === "completed",
    };
  });
}

/** @param {unknown} value @param {string} label @param {string} expectedMetric */
function convertActual(value, label, expectedMetric) {
  requireRecord(value, label);
  const metric = requireString(value.metric, `${label}.metric`);
  if (metric !== expectedMetric) throw new Error(`${label}.metric must match its Completion Item`);
  return { metric, value: requirePositiveInteger(value.value, `${label}.value`) };
}

/** @param {unknown} intervals @param {string} label */
function convertLegacyIntervals(intervals, label) {
  if (!Array.isArray(intervals)) throw new Error(`${label} must be an array`);
  return intervals.map((interval, index) => {
    const intervalLabel = `${label}[${index}]`;
    requireRecord(interval, intervalLabel);
    return {
      interval_key: requireString(interval.interval_key, `${intervalLabel}.interval_key`),
      started_at: requireString(interval.started_at, `${intervalLabel}.started_at`),
      ended_at: interval.ended_at ?? null,
    };
  });
}

/** @param {unknown} feedback @param {string} label @param {string[]} occurrenceKeys */
function convertLegacyFeedback(feedback, label, occurrenceKeys) {
  if (!Array.isArray(feedback)) throw new Error(`${label} must be an array`);
  return feedback.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    requireRecord(item, itemLabel);
    const occurrenceKey = requireString(item.exercise_occurrence_key, `${itemLabel}.exercise_occurrence_key`);
    if (!occurrenceKeys.includes(occurrenceKey)) throw new Error(`${itemLabel} references unknown occurrence ${occurrenceKey}`);
    return { exercise_occurrence_key: occurrenceKey, text: requireString(item.text, `${itemLabel}.text`) };
  });
}

/** @param {string} exerciseId @param {string} label @returns {ExerciseDefinition} */
function activeDefinition(exerciseId, label) {
  const definition = resolveExercise(exerciseId);
  if (!definition || definition.status !== "active") throw new Error(`${label} references an inactive or unknown Exercise ${exerciseId}`);
  return definition;
}

/** @param {ExerciseDefinition} definition @param {string} mode @param {string} label */
function ensureModeSupported(definition, mode, label) {
  if (!definition.execution.side_modes.includes(mode)) throw new Error(`${label} uses ${mode}, unsupported by ${definition.exercise_id}`);
}

/** @param {unknown} value @param {ExerciseDefinition} definition @param {string} label @returns {string} */
function legacyExecutionMode(value, definition, label) {
  if (value === "none") {
    if (definition.execution.side_modes.includes("none")) return "none";
    if (definition.execution.side_modes.includes("bilateral")) return "bilateral";
    throw new Error(`${label} cannot be represented canonically for ${definition.exercise_id}`);
  }
  if (value === "left_right") return "per_side";
  throw new Error(`${label} cannot be represented canonically: ${value}`);
}

/** @param {string | null} mode @param {number | null} load */
function resistanceProjection(mode, load) {
  if (mode === "bodyweight") return { mode: "bodyweight" };
  if (mode === "external_load") return { mode: "external_load", load_kg: load, quantity: 1 };
  return null;
}

/** @param {unknown} value @returns {string} */
function generatedKey(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "legacy";
  const base = /^[a-z]/.test(normalized) ? normalized : `legacy_${normalized}`;
  if (base.length <= 64) return base;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 10);
  return `${base.slice(0, 53)}_${digest}`;
}

/** @param {string} value @param {string} label @returns {string} */
function canonicalKey(value, label) {
  if (!KEY_PATTERN.test(value)) throw new Error(`${label} is not a canonical key: ${value}`);
  return value;
}

/** @param {unknown} value @param {string} label @returns {asserts value is Record<string, any>} */
function requireRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

/** @param {unknown} value @param {string} label @returns {string} */
function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

/** @param {unknown} value @param {string} label @returns {number} */
function requirePositiveInteger(value, label) {
  const numericValue = /** @type {number} */ (value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) throw new Error(`${label} must be a positive integer`);
  return numericValue;
}

/** @param {unknown} value @param {string} label @returns {number} */
function requireNonNegativeInteger(value, label) {
  const numericValue = /** @type {number} */ (value);
  if (!Number.isInteger(numericValue) || numericValue < 0) throw new Error(`${label} must be a non-negative integer`);
  return numericValue;
}

/** @param {unknown} value @param {string} label @param {number} minimum @param {number} maximum @returns {number | null} */
function nullableInteger(value, label, minimum, maximum) {
  if (value === null || value === undefined) return null;
  const numericValue = /** @type {number} */ (value);
  if (!Number.isInteger(numericValue) || numericValue < minimum || numericValue > maximum) throw new Error(`${label} must be null or an integer between ${minimum} and ${maximum}`);
  return numericValue;
}
