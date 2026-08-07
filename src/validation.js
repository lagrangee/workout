// @ts-check

import { isRecord, isValidLocalDate, isValidTimezone, isValidUtcInstant, trimString } from "./util.js";

/** @param {string} value */
function jsonPointerSegment(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

class StrictJsonParseError extends Error {
  /** @param {string} path @param {string} message */
  constructor(path, message) {
    super(message);
    this.name = "StrictJsonParseError";
    this.path = path;
  }
}

class StrictJsonParser {
  /** @param {string} text */
  constructor(text) { this.text = text; this.index = 0; }
  parse() {
    const value = this.value("");
    this.ws();
    if (this.index !== this.text.length) throw new StrictJsonParseError("", `Unexpected character at offset ${this.index}`);
    return value;
  }
  ws() { while (/\s/.test(this.text[this.index] ?? "")) this.index += 1; }
  /** @param {string} path @returns {any} */
  value(path) {
    this.ws();
    const char = this.text[this.index];
    if (char === "{") return this.object(path);
    if (char === "[") return this.array(path);
    if (char === '"') return this.string(path);
    if (char === "-" || /\d/.test(char ?? "")) return this.number(path);
    /** @type {Array<[string, any]>} */
    const literals = [["true", true], ["false", false], ["null", null]];
    for (const [literal, value] of literals) {
      if (this.text.startsWith(literal, this.index)) { this.index += literal.length; return value; }
    }
    throw new StrictJsonParseError(path, `Expected a JSON value at ${path} (offset ${this.index})`);
  }
  /** @param {string} path @returns {Record<string, any>} */
  object(path) {
    this.index += 1; this.ws();
    /** @type {Record<string, any>} */
    const object = Object.create(null);
    if (this.text[this.index] === "}") { this.index += 1; return object; }
    while (this.index < this.text.length) {
      this.ws();
      if (this.text[this.index] !== '"') throw new StrictJsonParseError(path, `Expected an object key at ${path} (offset ${this.index})`);
      const key = this.string(path);
      const keyPath = `${path}/${jsonPointerSegment(key)}`;
      if (Object.prototype.hasOwnProperty.call(object, key)) throw new StrictJsonParseError(keyPath, `Duplicate JSON member ${keyPath}`);
      this.ws();
      if (this.text[this.index] !== ":") throw new StrictJsonParseError(keyPath, `Expected ':' after ${keyPath}`);
      this.index += 1;
      object[key] = this.value(keyPath);
      this.ws();
      if (this.text[this.index] === "}") { this.index += 1; return object; }
      if (this.text[this.index] !== ",") throw new StrictJsonParseError(path, `Expected ',' in ${path}`);
      this.index += 1;
    }
    throw new StrictJsonParseError(path, `Unterminated object at ${path}`);
  }
  /** @param {string} path @returns {any[]} */
  array(path) {
    this.index += 1; this.ws();
    /** @type {any[]} */
    const array = [];
    if (this.text[this.index] === "]") { this.index += 1; return array; }
    while (this.index < this.text.length) {
      array.push(this.value(`${path}/${array.length}`));
      this.ws();
      if (this.text[this.index] === "]") { this.index += 1; return array; }
      if (this.text[this.index] !== ",") throw new StrictJsonParseError(path, `Expected ',' in ${path}`);
      this.index += 1;
    }
    throw new StrictJsonParseError(path, `Unterminated array at ${path}`);
  }
  /** @param {string} [path] */
  string(path = "") {
    const start = this.index; this.index += 1;
    while (this.index < this.text.length) {
      const char = this.text[this.index++];
      if (char === '"') {
        try { return JSON.parse(this.text.slice(start, this.index)); } catch { throw new StrictJsonParseError(path, `Invalid JSON string at ${path}`); }
      }
      if (char === "\\") this.index += 1;
    }
    throw new StrictJsonParseError(path, `Unterminated string at ${path}`);
  }
  /** @param {string} [path] */
  number(path = "") {
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) throw new StrictJsonParseError(path, `Invalid number at ${path}`);
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new StrictJsonParseError(path, `Non-finite number at ${path}`);
    return value;
  }
}

/** @param {string} text @param {number} [maxBytes] */
export function parseStrictJson(text, maxBytes = 256 * 1024) {
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new StrictJsonParseError("", "Package exceeds the 256 KiB limit");
  return new StrictJsonParser(text).parse();
}

/** @param {any} value @param {string} path @param {string[]} errors */
function requireObject(value, path, errors) { if (!isRecord(value)) errors.push(`${path}: must be an object`); return isRecord(value); }
/** @param {any} value @param {string} path @param {string[]} errors */
function requireArray(value, path, errors) { if (!Array.isArray(value)) errors.push(`${path}: must be an array`); return Array.isArray(value); }
/** @param {any} value @param {string} path @param {string[]} errors */
function requireString(value, path, errors) { if (typeof value !== "string") errors.push(`${path}: must be a string`); return typeof value === "string"; }
/** @param {any} value @param {string} path @param {string[]} errors */
function requireInteger(value, path, errors) { if (!Number.isInteger(value)) errors.push(`${path}: must be an integer`); return Number.isInteger(value); }
/** @param {any} value @param {string} path @param {string[]} errors */
function requireTrimmedString(value, path, errors) {
  if (!requireString(value, path, errors)) return false;
  const trimmed = trimString(value);
  if (trimmed !== value || trimmed.length < 1 || trimmed.length > 100) errors.push(`${path}: must contain 1-100 trimmed characters`);
  return true;
}
/** @param {Record<string, any>} object @param {string[]} allowed @param {string} path @param {string[]} errors */
function exactKeys(object, allowed, path, errors) {
  for (const key of Object.keys(object)) if (!allowed.includes(key)) errors.push(`${path}/${jsonPointerSegment(key)}: unknown field`);
}

/** @param {string[]} errors */
function validationErrorDetails(errors) {
  return errors.map((message) => {
    const separator = message.lastIndexOf(": ");
    return { path: separator === -1 ? "" : message.slice(0, separator), message };
  });
}

/** @param {any} value @param {string} path @param {string[]} errors */
function validateTarget(value, path, errors) {
  if (!requireObject(value, path, errors)) return;
  exactKeys(value, ["metric", "min", "max"], path, errors);
  if (!["reps", "duration_sec"].includes(value.metric)) errors.push(`${path}/metric: unsupported metric`);
  if (requireInteger(value.min, `${path}/min`, errors) && value.min <= 0) errors.push(`${path}/min: must be positive`);
  if (requireInteger(value.max, `${path}/max`, errors) && value.max <= 0) errors.push(`${path}/max: must be positive`);
  if (Number.isInteger(value.min) && Number.isInteger(value.max) && value.min > value.max) errors.push(`${path}: min cannot exceed max`);
}

/** @param {any} value @param {string} path @param {string[]} errors @param {string} category */
function validateResistance(value, path, errors, category) {
  if (value === null) return;
  if (!requireObject(value, path, errors)) return;
  exactKeys(value, ["mode", "load_kg", "quantity"], path, errors);
  if (!["bodyweight", "external_weight", "assisted_weight"].includes(value.mode)) errors.push(`${path}/mode: unsupported resistance mode`);
  if (value.mode === "bodyweight") {
    if (value.load_kg !== null || value.quantity !== null) errors.push(`${path}: bodyweight load and quantity must be null`);
  } else {
    if (value.load_kg !== null && (typeof value.load_kg !== "number" || !Number.isFinite(value.load_kg) || value.load_kg < 0)) errors.push(`${path}/load_kg: must be a non-negative number or null`);
    if (!requireInteger(value.quantity, `${path}/quantity`, errors) || value.quantity <= 0) errors.push(`${path}/quantity: must be a positive integer`);
  }
  if (category !== "strength") errors.push(`${path}: resistance is only allowed for strength`);
}

/** @param {any} value @param {string} path @param {string[]} errors @param {string} category */
function validateSet(value, path, errors, category) {
  if (!requireObject(value, path, errors)) return;
  exactKeys(value, ["target", "resistance", "target_rir", "target_rpe", "tempo", "rest_after_sec", "target_incline_percent"], path, errors);
  validateTarget(value.target, `${path}/target`, errors);
  validateResistance(value.resistance, `${path}/resistance`, errors, category);
  if (value.target_rir !== null && (!requireInteger(value.target_rir, `${path}/target_rir`, errors) || value.target_rir < 0 || value.target_rir > 10)) errors.push(`${path}/target_rir: must be null or 0-10`);
  if (value.target_rpe !== null && (typeof value.target_rpe !== "number" || !Number.isFinite(value.target_rpe) || value.target_rpe < 0 || value.target_rpe > 10)) errors.push(`${path}/target_rpe: must be null or 0-10`);
  if (value.tempo !== null) {
    if (requireObject(value.tempo, `${path}/tempo`, errors)) {
      exactKeys(value.tempo, ["eccentric_sec", "bottom_hold_sec", "concentric_sec", "top_hold_sec"], `${path}/tempo`, errors);
      if (!["eccentric_sec", "bottom_hold_sec", "concentric_sec", "top_hold_sec"].some((key) => value.tempo[key] !== null)) errors.push(`${path}/tempo: one phase must be non-null`);
      for (const key of ["eccentric_sec", "bottom_hold_sec", "concentric_sec", "top_hold_sec"]) if (value.tempo[key] !== null && (!requireInteger(value.tempo[key], `${path}/tempo/${key}`, errors) || value.tempo[key] < 0)) errors.push(`${path}/tempo/${key}: must be null or non-negative integer`);
    }
  }
  if (value.rest_after_sec !== null && (!requireInteger(value.rest_after_sec, `${path}/rest_after_sec`, errors) || value.rest_after_sec < 0)) errors.push(`${path}/rest_after_sec: must be null or non-negative integer`);
  if (value.target_incline_percent !== null && (typeof value.target_incline_percent !== "number" || !Number.isFinite(value.target_incline_percent) || value.target_incline_percent < 0 || value.target_incline_percent > 100)) errors.push(`${path}/target_incline_percent: must be null or 0-100`);
  if (category !== "endurance" && value.target_incline_percent !== null) errors.push(`${path}/target_incline_percent: only endurance may set incline`);
  if (category !== "strength" && value.target_rir !== null) errors.push(`${path}/target_rir: only strength may set RIR`);
}

/** @param {any} value @param {string} path @param {string[]} errors */
function validateSlot(value, path, errors) {
  if (value === null) return;
  if (!requireObject(value, path, errors)) return;
  if (value.kind === "rest") { exactKeys(value, ["kind"], path, errors); return; }
  exactKeys(value, ["kind", "title", "start_time", "estimated_duration_min", "blocks"], path, errors);
  if (value.kind !== "workout") errors.push(`${path}/kind: must be workout or rest`);
  requireTrimmedString(value.title, `${path}/title`, errors);
  if (value.start_time !== null && (!requireString(value.start_time, `${path}/start_time`, errors) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.start_time))) errors.push(`${path}/start_time: must be HH:mm or null`);
  if (!requireInteger(value.estimated_duration_min, `${path}/estimated_duration_min`, errors) || value.estimated_duration_min <= 0) errors.push(`${path}/estimated_duration_min: must be a positive integer`);
  if (!requireArray(value.blocks, `${path}/blocks`, errors) || value.blocks.length < 1 || value.blocks.length > 20) { errors.push(`${path}/blocks: must contain 1-20 blocks`); return; }
  let exercises = 0; let completionItems = 0;
  const exerciseKeys = new Set();
  value.blocks.forEach((block, blockIndex) => {
    const blockPath = `${path}/blocks/${blockIndex}`;
    if (!requireObject(block, blockPath, errors)) return;
    exactKeys(block, ["title", "exercises"], blockPath, errors);
    requireTrimmedString(block.title, `${blockPath}/title`, errors);
    if (!requireArray(block.exercises, `${blockPath}/exercises`, errors) || block.exercises.length < 1) { errors.push(`${blockPath}/exercises: must not be empty`); return; }
    block.exercises.forEach((exercise, exerciseIndex) => {
      exercises += 1;
      const exercisePath = `${blockPath}/exercises/${exerciseIndex}`;
      if (!requireObject(exercise, exercisePath, errors)) return;
      exactKeys(exercise, ["exercise_key", "name", "category", "side_mode", "sets"], exercisePath, errors);
      if (!requireString(exercise.exercise_key, `${exercisePath}/exercise_key`, errors) || !/^[a-z][a-z0-9_]{0,63}$/.test(exercise.exercise_key)) errors.push(`${exercisePath}/exercise_key: invalid key`);
      if (exerciseKeys.has(exercise.exercise_key)) errors.push(`${exercisePath}/exercise_key: duplicate in workout slot`); exerciseKeys.add(exercise.exercise_key);
      requireTrimmedString(exercise.name, `${exercisePath}/name`, errors);
      if (!["strength", "endurance", "mobility", "recovery"].includes(exercise.category)) errors.push(`${exercisePath}/category: unsupported category`);
      if (!["none", "left_right"].includes(exercise.side_mode)) errors.push(`${exercisePath}/side_mode: unsupported side mode`);
      if (!requireArray(exercise.sets, `${exercisePath}/sets`, errors) || exercise.sets.length < 1 || exercise.sets.length > 200) { errors.push(`${exercisePath}/sets: must contain 1-200 sets`); return; }
      exercise.sets.forEach((set, setIndex) => { validateSet(set, `${exercisePath}/sets/${setIndex}`, errors, exercise.category); completionItems += exercise.side_mode === "left_right" ? 2 : 1; });
    });
  });
  if (exercises > 50) errors.push(`${path}/blocks: workout may contain at most 50 exercise occurrences`);
  if (completionItems > 200) errors.push(`${path}/blocks: workout may expand to at most 200 Completion Items`);
}

/** @param {string} text @param {string} today */
export function validatePlanPackage(text, today) {
  /** @type {string[]} */
  const errors = [];
  let packageValue;
  try { packageValue = parseStrictJson(text); } catch (error) {
    return {
      ok: false,
      errors: [{ path: error instanceof StrictJsonParseError ? error.path : "", message: error instanceof Error ? error.message : "Invalid JSON" }],
    };
  }
  if (!requireObject(packageValue, "", errors)) return { ok: false, errors: validationErrorDetails(errors) };
  exactKeys(packageValue, ["schema_version", "effective_from", "week"], "", errors);
  if (packageValue.schema_version !== 1) errors.push("/schema_version: must equal integer 1");
  if (!requireString(packageValue.effective_from, "/effective_from", errors) || !isValidLocalDate(packageValue.effective_from)) errors.push("/effective_from: must be a valid local date");
  else if (packageValue.effective_from <= today) errors.push("/effective_from: must be later than the current local date");
  if (!requireObject(packageValue.week, "/week", errors)) return { ok: false, errors: validationErrorDetails(errors) };
  exactKeys(packageValue.week, ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"], "/week", errors);
  for (const weekday of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) {
    if (!Object.prototype.hasOwnProperty.call(packageValue.week, weekday)) errors.push(`/week/${weekday}: required`);
    else validateSlot(packageValue.week[weekday], `/week/${weekday}`, errors);
  }
  return errors.length ? { ok: false, errors: validationErrorDetails(errors) } : { ok: true, value: packageValue };
}

/** @param {any} value @param {string} path @returns {string[]} */
export function validateSettings(value, path = "$") {
  /** @type {string[]} */
  const errors = [];
  if (!requireObject(value, path, errors)) return errors;
  exactKeys(value, ["display_name", "timezone"], path, errors);
  if (!requireString(value.display_name, `${path}/display_name`, errors) || trimString(value.display_name).length < 1 || trimString(value.display_name).length > 50) errors.push(`${path}/display_name: must contain 1-50 trimmed characters`);
  if (!requireString(value.timezone, `${path}/timezone`, errors) || !isValidTimezone(value.timezone)) errors.push(`${path}/timezone: must be a valid IANA timezone`);
  return errors;
}

/** @param {any} value @param {string} path @param {string[]} errors */
function validateResistanceValue(value, path, errors) {
  if (value === null) return;
  if (!requireObject(value, path, errors)) return;
  exactKeys(value, ["mode", "load_kg", "quantity"], path, errors);
  if (!["bodyweight", "external_weight", "assisted_weight"].includes(value.mode)) errors.push(`${path}/mode: unsupported resistance mode`);
  if (value.mode === "bodyweight" && (value.load_kg !== null || value.quantity !== null)) errors.push(`${path}: bodyweight values must be null`);
  if (value.mode !== "bodyweight" && value.load_kg !== null && (typeof value.load_kg !== "number" || value.load_kg < 0)) errors.push(`${path}/load_kg: invalid load`);
  if (value.mode !== "bodyweight" && (!Number.isInteger(value.quantity) || value.quantity <= 0)) errors.push(`${path}/quantity: invalid quantity`);
}

/** @param {any} record @param {any} session @param {string} now @param {string} mode */
export function validateSessionRecord(record, session, now, mode = "replace") {
  /** @type {string[]} */
  const errors = [];
  if (!requireObject(record, "$", errors)) return errors;
  exactKeys(record, ["record_schema_version", "completion_results", "training_intervals", "session_rpe", "note", "exercise_feedback", "skip_reason"], "$", errors);
  if (record.record_schema_version !== 1) errors.push("/record_schema_version: must equal integer 1");
  if (!requireArray(record.completion_results, "/completion_results", errors)) return errors;
  if (!requireArray(record.training_intervals, "/training_intervals", errors)) return errors;
  if (!requireArray(record.exercise_feedback, "/exercise_feedback", errors)) return errors;
  const itemMap = new Map(session.snapshot.completion_items.map(/** @param {any} item */ (item) => [item.completion_item_key, item]));
  const resultKeys = new Set();
  for (const [index, result] of record.completion_results.entries()) {
    const path = `/completion_results/${index}`;
    if (!requireObject(result, path, errors)) continue;
    exactKeys(result, ["completion_item_key", "completed", "actual", "resistance", "rir", "completed_at"], path, errors);
    if (resultKeys.has(result.completion_item_key)) errors.push(`${path}/completion_item_key: duplicate`); resultKeys.add(result.completion_item_key);
    const item = itemMap.get(result.completion_item_key);
    if (!item) { errors.push(`${path}/completion_item_key: unknown snapshot Completion Item`); continue; }
    if (result.completed !== true) errors.push(`${path}/completed: must be true`);
    if (!requireObject(result.actual, `${path}/actual`, errors)) continue;
    exactKeys(result.actual, ["metric", "value"], `${path}/actual`, errors);
    if (result.actual.metric !== item.target.metric) errors.push(`${path}/actual/metric: must match snapshot target`);
    if (!Number.isInteger(result.actual.value) || result.actual.value <= 0) errors.push(`${path}/actual/value: must be a positive integer`);
    validateResistanceValue(result.resistance, `${path}/resistance`, errors);
    if (item.resistance !== null && result.resistance?.mode !== item.resistance.mode) errors.push(`${path}/resistance: mode must match snapshot`);
    if (item.resistance === null && result.resistance !== null) errors.push(`${path}/resistance: must be null for this snapshot item`);
    if (result.rir !== null && (!Number.isInteger(result.rir) || result.rir < 0 || result.rir > 10)) errors.push(`${path}/rir: must be null or 0-10`);
    if (!requireString(result.completed_at, `${path}/completed_at`, errors) || !isValidUtcInstant(result.completed_at)) errors.push(`${path}/completed_at: must be RFC 3339 UTC`);
    else if (Date.parse(result.completed_at) > Date.parse(now)) errors.push(`${path}/completed_at: cannot be in the future`);
  }
  const intervalKeys = new Set(); let openCount = 0;
  for (const [index, interval] of record.training_intervals.entries()) {
    const path = `/training_intervals/${index}`;
    if (!requireObject(interval, path, errors)) continue;
    exactKeys(interval, ["interval_key", "started_at", "ended_at"], path, errors);
    if (intervalKeys.has(interval.interval_key)) errors.push(`${path}/interval_key: duplicate`); intervalKeys.add(interval.interval_key);
    if (!isValidUtcInstant(interval.started_at)) errors.push(`${path}/started_at: invalid instant`);
    if (interval.ended_at === null) openCount += 1;
    else if (!isValidUtcInstant(interval.ended_at)) errors.push(`${path}/ended_at: invalid instant`);
    else if (Date.parse(interval.ended_at) <= Date.parse(interval.started_at)) errors.push(`${path}: ended_at must be after started_at`);
  }
  for (let index = 1; index < record.training_intervals.length; index += 1) {
    const previous = record.training_intervals[index - 1]; const current = record.training_intervals[index];
    if (isValidUtcInstant(previous.ended_at) && isValidUtcInstant(current.started_at) && Date.parse(current.started_at) < Date.parse(previous.ended_at)) errors.push(`/training_intervals/${index}: intervals overlap or are out of order`);
  }
  for (const [index, result] of record.completion_results.entries()) {
    if (!isValidUtcInstant(result.completed_at)) continue;
    const completedAt = Date.parse(result.completed_at);
    const insideInterval = record.training_intervals.some((interval) => isValidUtcInstant(interval.started_at) && completedAt >= Date.parse(interval.started_at) && (interval.ended_at === null || (isValidUtcInstant(interval.ended_at) && completedAt <= Date.parse(interval.ended_at))));
    if (!insideInterval) errors.push(`/completion_results/${index}/completed_at: must fall inside a Session interval`);
  }
  if (mode === "in_progress" && (openCount !== 1 || record.training_intervals.at(-1)?.ended_at !== null)) errors.push("/training_intervals: in-progress record needs exactly one open interval last");
  if (mode === "terminal" && (openCount !== 0 || record.training_intervals.length === 0)) errors.push("/training_intervals: terminal record needs at least one closed interval");
  if (mode === "skipped" && (record.training_intervals.length !== 0 || record.completion_results.length !== 0 || openCount !== 0)) errors.push("/training_intervals: skipped record cannot contain training intervals or results");
  if (record.session_rpe !== null && (!Number.isInteger(record.session_rpe) || record.session_rpe < 0 || record.session_rpe > 10)) errors.push("/session_rpe: must be null or 0-10");
  if (mode === "in_progress" && record.session_rpe !== null) errors.push("/session_rpe: must be null while in progress");
  if (mode === "in_progress" && record.skip_reason !== null) errors.push("/skip_reason: must be null while in progress");
  if (record.note !== null && (!requireString(record.note, "/note", errors) || trimString(record.note).length < 1 || trimString(record.note).length > 5000)) errors.push("/note: must be null or 1-5000 trimmed characters");
  if (record.skip_reason !== null && (!requireString(record.skip_reason, "/skip_reason", errors) || trimString(record.skip_reason).length < 1 || trimString(record.skip_reason).length > 500)) errors.push("/skip_reason: must be null or 1-500 trimmed characters");
  const feedbackKeys = new Set();
  for (const [index, feedback] of record.exercise_feedback.entries()) {
    const path = `/exercise_feedback/${index}`;
    if (!requireObject(feedback, path, errors)) continue;
    exactKeys(feedback, ["exercise_occurrence_key", "text"], path, errors);
    if (feedbackKeys.has(feedback.exercise_occurrence_key)) errors.push(`${path}/exercise_occurrence_key: duplicate`); feedbackKeys.add(feedback.exercise_occurrence_key);
    if (!session.snapshot.exercise_occurrence_keys.includes(feedback.exercise_occurrence_key)) errors.push(`${path}/exercise_occurrence_key: unknown snapshot exercise`);
    if (!requireString(feedback.text, `${path}/text`, errors) || trimString(feedback.text).length < 1 || trimString(feedback.text).length > 1000) errors.push(`${path}/text: must contain 1-1000 trimmed characters`);
  }
  return errors;
}
