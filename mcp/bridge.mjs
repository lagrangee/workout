// @ts-check

import { PLAN_UPDATE_PACKAGE_V2_SCHEMA, PLAN_UPDATE_WEEKDAYS, validateSchemaValue } from "../src/plan-update-structure.js";
import { saveTrainingPlanLocal } from "../src/training-plan-local.js";

/** @typedef {import("../types/interfaces.js").JsonRecord} JsonRecord */
/** @typedef {import("../types/interfaces.js").JsonSchema} JsonSchema */
/** @typedef {import("../types/interfaces.js").ToolDefinition} ToolDefinition */
/** @typedef {import("../types/interfaces.js").WorkoutToolArguments} WorkoutToolArguments */
/** @typedef {import("../types/interfaces.js").WorkoutToolName} WorkoutToolName */
/** @typedef {import("../types/interfaces.js").PlanUpdatePackage} PlanUpdatePackage */
/** @typedef {import("../types/interfaces.js").PlanUpdateBatch} PlanUpdateBatch */

const BRIDGE_PROTOCOL_VERSION = "2025-06-18";
const BRIDGE_SERVER_INFO = { name: "workout-agent-mcp", version: "0.1.0" };
/** @param {Record<string, JsonSchema>} properties @returns {JsonSchema & { type: "object", properties: Record<string, JsonSchema>, required: string[] }} */
const exactObject = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
/** @param {JsonSchema} items @param {number} minItems @param {number} [maxItems] @returns {JsonSchema} */
const arrayOf = (items, minItems, maxItems) => ({ type: "array", items, minItems, ...(maxItems === undefined ? {} : { maxItems }) });
const PLAN_UPDATE_PACKAGE_SCHEMA = PLAN_UPDATE_PACKAGE_V2_SCHEMA;
const PLAN_UPDATE_APPLY_SCHEMA = exactObject({
  package: PLAN_UPDATE_PACKAGE_SCHEMA,
  package_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  base_plan_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  confirmed: { type: "boolean", const: true },
  idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
});
const PLAN_UPDATE_BATCH_SCHEMA = exactObject({
  schema_version: { type: "integer", const: 1 },
  updates: arrayOf(PLAN_UPDATE_PACKAGE_SCHEMA, 2, 4),
});
const PLAN_UPDATE_BATCH_APPLY_SCHEMA = exactObject({
  batch: PLAN_UPDATE_BATCH_SCHEMA,
  batch_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  base_plan_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  confirmed: { type: "boolean", const: true },
  idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
});
const PLANNED_DAY_MOVE_SCHEMA = exactObject({
  source_date: { type: "string", format: "date" },
  target_date: { type: "string", format: "date" },
});
const PLANNED_DAY_MOVE_APPLY_SCHEMA = exactObject({
  move: PLANNED_DAY_MOVE_SCHEMA,
  move_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  base_plan_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  confirmed: { type: "boolean", const: true },
  idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
});

/** @type {ToolDefinition[]} */
const TOOL_DEFINITIONS = [
  {
    name: "workout_get_overview",
    description: "Read bounded current plan context, coverage, freshness, metrics, and recent Workout Session evidence.",
    inputSchema: { type: "object", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, preset: { type: "string", enum: ["7d", "30d", "12w", "all"] }, range: { type: "string", enum: ["7d", "30d", "12w", "all"] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_get_plan",
    description: "Read one effective Planned Day per date from the current natural week through the configured Athlete's final planned week, with deduplicated prescriptions and no revision history.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_save_plan_local",
    description: "Read the configured Athlete's effective Workout Plan and atomically replace its managed Obsidian projection under WORKOUT_ARCHIVE_DIR.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "workout_get_schedule",
    description: "Read an explicit inclusive Athlete-local Schedule range, optionally expanded with prescriptions.",
    inputSchema: { type: "object", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, expand: { type: "boolean", default: false } }, required: ["from", "to"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_list_sessions",
    description: "List bounded Workout Sessions with Athlete-local filters and an opaque cursor.",
    inputSchema: { type: "object", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 }, cursor: { type: "string" }, status: { type: "string", enum: ["in_progress", "completed", "partial", "skipped"] }, exercise_id: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_get_session",
    description: "Read one complete Workout Session, immutable Training Plan Snapshot, Actual Training Data, intervals, and feedback.",
    inputSchema: { type: "object", properties: { session_key: { type: "string" } }, required: ["session_key"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_get_progress",
    description: "Read progress metrics, evidence, streak, duration, strength days, RPE, and weekly buckets.",
    inputSchema: { type: "object", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, preset: { type: "string", enum: ["7d", "30d", "12w", "all"] }, range: { type: "string", enum: ["7d", "30d", "12w", "all"] }, bucket: { type: "string", enum: ["day", "week", "month"], default: "week" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_get_exercise_history",
    description: "Read one Exercise's display-name history, performed Sessions, resistance semantics, and side-separated observations.",
    inputSchema: { type: "object", properties: { exercise_id: { type: "string" }, from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, preset: { type: "string", enum: ["7d", "30d", "12w", "all"] }, range: { type: "string", enum: ["7d", "30d", "12w", "all"] } }, required: ["exercise_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_validate_plan_update",
    description: "Validate a complete future Plan Update Package and return its non-mutating preview and base evidence.",
    inputSchema: { type: "object", properties: { package: PLAN_UPDATE_PACKAGE_SCHEMA }, required: ["package"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_apply_plan_update",
    description: "Apply one previously validated future Plan Update Package after explicit confirmation, then verify its seven effective Planned Days from one Plan readback.",
    inputSchema: PLAN_UPDATE_APPLY_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "workout_validate_plan_update_batch",
    description: "Validate 2-4 consecutive Monday Plan Update Packages as one non-mutating atomic batch preview.",
    inputSchema: { type: "object", properties: { batch: PLAN_UPDATE_BATCH_SCHEMA }, required: ["batch"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_apply_plan_update_batch",
    description: "Atomically apply one previously validated Plan Update Batch after explicit confirmation, then verify every effective Planned Day from one Plan readback.",
    inputSchema: PLAN_UPDATE_BATCH_APPLY_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "workout_validate_planned_day_move",
    description: "Validate one atomic move of an unstarted Planned Day to today or a future Rest/no-plan date.",
    inputSchema: { type: "object", properties: { move: PLANNED_DAY_MOVE_SCHEMA }, required: ["move"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_apply_planned_day_move",
    description: "Apply one validated Planned Day move after confirmation and read back both affected dates.",
    inputSchema: PLANNED_DAY_MOVE_APPLY_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

export class WorkoutApiError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] @param {unknown[]} [details] */
  constructor(code, message, status = 0, details = []) {
    super(message);
    this.name = "WorkoutApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class WorkoutApiClient {
  /** @param {{ origin?: string, token?: string, archiveDir?: string, fetchImpl?: typeof globalThis.fetch }} [options] */
  constructor({ origin, token, archiveDir, fetchImpl = globalThis.fetch } = {}) {
    if (typeof origin !== "string" || !origin) throw new Error("WORKOUT_AGENT_API_ORIGIN is required");
    if (typeof token !== "string" || !token) throw new Error("WORKOUT_AGENT_TOKEN is required");
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") throw new Error("WORKOUT_AGENT_API_ORIGIN must use HTTPS");
    if (parsed.search || parsed.hash) throw new Error("WORKOUT_AGENT_API_ORIGIN must not include a query or hash");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    this.baseUrl = `${parsed.toString().replace(/\/$/, "")}/api/agent/v1`;
    this.token = token;
    this.archiveDir = archiveDir;
    this.fetchImpl = fetchImpl;
  }

  listTools() { return TOOL_DEFINITIONS.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties }, ...(tool.inputSchema.required ? { required: [...tool.inputSchema.required] } : {}) }, annotations: { ...tool.annotations } })); }

  /** @template {WorkoutToolName} Name @param {Name} name @param {WorkoutToolArguments[Name]} [args] */
  async callTool(name, args = /** @type {WorkoutToolArguments[Name]} */ ({})) {
    const input = /** @type {any} */ (args);
    if (name === "workout_get_overview") return this.getOverview(input);
    if (name === "workout_get_plan") return this.getPlan(input);
    if (name === "workout_save_plan_local") return this.savePlanLocal(input);
    if (name === "workout_get_schedule") return this.getSchedule(input);
    if (name === "workout_list_sessions") return this.listSessions(input);
    if (name === "workout_get_session") return this.getSession(input);
    if (name === "workout_get_progress") return this.getProgress(input);
    if (name === "workout_get_exercise_history") return this.getExerciseHistory(input);
    if (name === "workout_validate_plan_update") return this.validatePlanUpdate(input);
    if (name === "workout_apply_plan_update") return this.applyPlanUpdate(input);
    if (name === "workout_validate_plan_update_batch") return this.validatePlanUpdateBatch(input);
    if (name === "workout_apply_plan_update_batch") return this.applyPlanUpdateBatch(input);
    if (name === "workout_validate_planned_day_move") return this.validatePlannedDayMove(input);
    if (name === "workout_apply_planned_day_move") return this.applyPlannedDayMove(input);
    throw new WorkoutApiError("tool_not_found", `Tool is not available: ${name}`, 0);
  }

  /** @param {WorkoutToolArguments["workout_get_overview"]} [args] */
  async getOverview(args = {}) {
    assertToolArguments("workout_get_overview", args);
    const query = new URLSearchParams();
    for (const field of /** @type {(keyof WorkoutToolArguments["workout_get_overview"])[]} */ (["from", "to", "preset", "range"])) if (typeof args[field] === "string") query.set(field, args[field]);
    return this.get(`/overview${query.size ? `?${query}` : ""}`);
  }

  /** @param {WorkoutToolArguments["workout_get_plan"]} [args] */
  async getPlan(args = {}) { assertToolArguments("workout_get_plan", args); return this.get("/plan"); }

  /** @param {WorkoutToolArguments["workout_save_plan_local"]} [args] */
  async savePlanLocal(args = {}) {
    assertToolArguments("workout_save_plan_local", args);
    if (typeof this.archiveDir !== "string" || !this.archiveDir.trim()) throw new WorkoutApiError("local_archive_unavailable", "WORKOUT_ARCHIVE_DIR is required for plan2local");
    const plan = await this.getPlan();
    try {
      return await saveTrainingPlanLocal({ archiveDir: this.archiveDir, plan });
    } catch (/** @type {any} */ error) {
      throw new WorkoutApiError(error?.code ?? "local_archive_write_failed", error instanceof Error ? error.message : "Local plan projection failed");
    }
  }

  /** @param {WorkoutToolArguments["workout_get_schedule"]} args */
  async getSchedule(args) {
    assertToolArguments("workout_get_schedule", args);
    const query = new URLSearchParams();
    if (typeof args.from === "string") query.set("from", args.from);
    if (typeof args.to === "string") query.set("to", args.to);
    if (args.expand === true) query.set("expand", "prescription");
    return this.get(`/schedule${query.size ? `?${query}` : ""}`);
  }

  /** @param {WorkoutToolArguments["workout_list_sessions"]} [args] */
  async listSessions(args = {}) {
    assertToolArguments("workout_list_sessions", args);
    const query = new URLSearchParams();
    for (const field of /** @type {(keyof WorkoutToolArguments["workout_list_sessions"])[]} */ (["from", "to", "limit", "cursor", "status", "exercise_id"])) if (args[field] !== undefined) query.set(field, String(args[field]));
    return this.get(`/sessions${query.size ? `?${query}` : ""}`);
  }

  /** @param {WorkoutToolArguments["workout_get_session"]} args */
  async getSession(args) {
    assertToolArguments("workout_get_session", args);
    return this.get(`/sessions/${encodeURIComponent(args.session_key)}`);
  }

  /** @param {WorkoutToolArguments["workout_get_progress"]} [args] */
  async getProgress(args = {}) {
    assertToolArguments("workout_get_progress", args);
    const query = new URLSearchParams();
    for (const field of /** @type {(keyof WorkoutToolArguments["workout_get_progress"])[]} */ (["from", "to", "preset", "range", "bucket"])) if (args[field] !== undefined) query.set(field, String(args[field]));
    return this.get(`/progress${query.size ? `?${query}` : ""}`);
  }

  /** @param {WorkoutToolArguments["workout_get_exercise_history"]} args */
  async getExerciseHistory(args) {
    assertToolArguments("workout_get_exercise_history", args);
    const query = new URLSearchParams();
    for (const field of /** @type {(keyof WorkoutToolArguments["workout_get_exercise_history"])[]} */ (["from", "to", "preset", "range"])) if (args[field] !== undefined) query.set(field, String(args[field]));
    return this.get(`/exercises/${encodeURIComponent(args.exercise_id)}${query.size ? `?${query}` : ""}`);
  }

  /** @param {WorkoutToolArguments["workout_validate_plan_update"]} args */
  async validatePlanUpdate(args) {
    assertToolArguments("workout_validate_plan_update", args);
    return this.post("/plan-updates/validate", { package_text: JSON.stringify(args.package) });
  }

  /** @param {WorkoutToolArguments["workout_apply_plan_update"]} args */
  async applyPlanUpdate(args) {
    assertToolArguments("workout_apply_plan_update", args);
    const applied = await this.post("/plan-updates/apply", {
      package_text: JSON.stringify(args.package),
      package_digest: args.package_digest,
      base_plan_digest: args.base_plan_digest,
      confirmed: args.confirmed,
    }, { "Idempotency-Key": args.idempotency_key });
    const readbackFrom = applied.effective_from;
    try {
      const plan = await this.get("/plan");
      verifyPlanReadback(plan, readbackFrom, args.package);
      return { ...applied, readback: { status: "verified", plan } };
    } catch (/** @type {any} */ error) {
      return {
        ...applied,
        readback: {
          status: "failed",
          error: {
            code: error.code ?? "readback_failed",
            message: error.message ?? String(error),
            status: error.status ?? 0,
            details: error.details ?? [],
          },
        },
      };
    }
  }

  /** @param {WorkoutToolArguments["workout_validate_plan_update_batch"]} args */
  async validatePlanUpdateBatch(args) {
    assertToolArguments("workout_validate_plan_update_batch", args);
    return this.post("/plan-update-batches/validate", { batch_text: JSON.stringify(args.batch) });
  }

  /** @param {WorkoutToolArguments["workout_apply_plan_update_batch"]} args */
  async applyPlanUpdateBatch(args) {
    assertToolArguments("workout_apply_plan_update_batch", args);
    const applied = await this.post("/plan-update-batches/apply", {
      batch_text: JSON.stringify(args.batch),
      batch_digest: args.batch_digest,
      base_plan_digest: args.base_plan_digest,
      confirmed: args.confirmed,
    }, { "Idempotency-Key": args.idempotency_key });
    try {
      const plan = await this.get("/plan");
      for (const update of args.batch.updates) verifyPlanReadback(plan, update.effective_from, update);
      return { ...applied, readback: { status: "verified", plan } };
    } catch (/** @type {any} */ error) {
      return {
        ...applied,
        readback: {
          status: "failed",
          error: {
            code: error.code ?? "readback_failed",
            message: error.message ?? String(error),
            status: error.status ?? 0,
            details: error.details ?? [],
          },
        },
      };
    }
  }

  /** @param {WorkoutToolArguments["workout_validate_planned_day_move"]} args */
  async validatePlannedDayMove(args) {
    assertToolArguments("workout_validate_planned_day_move", args);
    return this.post("/planned-day-moves/validate", { move: args.move });
  }

  /** @param {WorkoutToolArguments["workout_apply_planned_day_move"]} args */
  async applyPlannedDayMove(args) {
    assertToolArguments("workout_apply_planned_day_move", args);
    const applied = await this.post("/planned-day-moves/apply", {
      move: args.move,
      move_digest: args.move_digest,
      base_plan_digest: args.base_plan_digest,
      confirmed: args.confirmed,
    }, { "Idempotency-Key": args.idempotency_key });
    const from = args.move.source_date < args.move.target_date ? args.move.source_date : args.move.target_date;
    const to = args.move.source_date > args.move.target_date ? args.move.source_date : args.move.target_date;
    try {
      const schedule = await this.getSchedule({ from, to, expand: true });
      const source = schedule?.entries?.find((/** @type {any} */ entry) => entry.date === args.move.source_date);
      const target = schedule?.entries?.find((/** @type {any} */ entry) => entry.date === args.move.target_date);
      const targetPrescription = target?.prescription_ref ? schedule?.prescriptions?.[target.prescription_ref] : null;
      const expectedPrescription = applied?.preview?.before?.source?.prescription;
      const prescriptionMatches = expectedPrescription && targetPrescription
        && JSON.stringify(comparablePlanSlot({ kind: "workout", ...targetPrescription })) === JSON.stringify(comparablePlanSlot(expectedPrescription));
      if (!source || !target || source.kind === "workout" || source.is_overdue_unstarted !== false || target.kind !== "workout"
        || source.moved_to_date !== args.move.target_date || target.moved_from_date !== args.move.source_date || !prescriptionMatches) {
        throw new WorkoutApiError("readback_mismatch", "Schedule readback does not exactly reflect the Planned Day move");
      }
      return { ...applied, readback: { status: "verified", schedule, source, target } };
    } catch (/** @type {any} */ error) {
      return { ...applied, readback: { status: "failed", error: { code: error.code ?? "readback_failed", message: error.message ?? String(error), status: error.status ?? 0, details: error.details ?? [] } } };
    }
  }

  /** @param {string} path */
  async get(path) {
    return this.request(path, { method: "GET" });
  }

  /** @param {string} path @param {unknown} body @param {Record<string, string>} [headers] @param {RequestInit} [requestOptions] */
  async post(path, body, headers = {}, requestOptions = {}) {
    return this.request(path, { ...requestOptions, method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  }

  /** @param {string} path @param {RequestInit} [options] @returns {Promise<any>} */
  async request(path, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...options, headers: { Accept: "application/json", Authorization: `Bearer ${this.token}`, ...(options.headers ?? {}) } });
    } catch (/** @type {any} */ error) {
      throw new WorkoutApiError("transport_error", error instanceof Error ? error.message : "Agent API request failed");
    }
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = null; }
    if (!response.ok) {
      const error = payload?.error ?? {};
      throw new WorkoutApiError(error.code ?? `http_${response.status}`, error.message ?? "Agent API request failed", response.status, error.details ?? []);
    }
    if (payload === null) throw new WorkoutApiError("invalid_response", "Agent API returned invalid JSON", response.status);
    return payload;
  }
}

/** @param {unknown} message */
export function hasId(message) { return Boolean(message && typeof message === "object" && Object.prototype.hasOwnProperty.call(message, "id")); }
/** @param {unknown} id @param {unknown} result */
function makeResponse(id, result) { return { jsonrpc: "2.0", id, result }; }
/** @param {unknown} id @param {number} code @param {string} message */
export function makeError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

export class McpBridge {
  /** @param {{ client?: import("../types/interfaces.js").McpClient, serverInfo?: { name: string, version: string } }} [options] */
  constructor({ client, serverInfo = BRIDGE_SERVER_INFO } = {}) {
    if (!client || typeof client.listTools !== "function" || typeof client.callTool !== "function") throw new TypeError("McpBridge requires a typed workout client");
    this.client = client;
    this.serverInfo = serverInfo;
  }

  async getTools() { return this.client.listTools(); }

  /** @param {any} message */
  async handleMessage(message) {
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") return makeError(hasId(message ?? {}) ? message.id : null, -32600, "Invalid Request");
    if (message.method === "notifications/initialized") return null;
    if (!hasId(message)) return null;
    if (message.method === "initialize") return makeResponse(message.id, { protocolVersion: BRIDGE_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: this.serverInfo });
    if (message.method === "ping") return makeResponse(message.id, {});
    if (message.method === "tools/list") return makeResponse(message.id, { tools: await this.getTools() });
    if (message.method === "tools/call") return this.handleToolCall(message);
    return makeError(message.id, -32601, `Method not found: ${message.method}`);
  }

  /** @param {any} message */
  async handleToolCall(message) {
    const params = /** @type {JsonRecord|undefined} */ (message.params);
    if (!params || typeof params !== "object" || typeof params.name !== "string") return makeError(message.id, -32602, "tools/call requires params.name");
    if (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments))) return makeError(message.id, -32602, "tools/call params.arguments must be an object");
    const available = await this.getTools();
    if (!available.some((tool) => tool.name === params.name)) return makeError(message.id, -32602, `Tool is not available: ${params.name}`);
    const validationError = validateToolArguments(available.find((tool) => tool.name === params.name), params.arguments ?? {});
    if (validationError) return makeError(message.id, -32602, validationError);
    try {
      const value = await this.client.callTool(/** @type {WorkoutToolName} */ (params.name), params.arguments ?? {});
      return makeResponse(message.id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    } catch (/** @type {any} */ error) {
      const failure = { error: { code: error.code ?? "transport_error", message: error.message ?? String(error), details: error.details ?? [] }, status: error.status ?? 0 };
      return makeResponse(message.id, { content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure, isError: true });
    }
  }
}

/** @param {ToolDefinition|undefined} tool @param {JsonRecord} args */
function validateToolArguments(tool, args) {
  if (!tool) return "Tool is not available";
  const schema = tool.inputSchema;
  const properties = schema.properties ?? {};
  for (const required of schema.required ?? []) if (!Object.hasOwn(args, required)) return `Missing required argument: ${required}`;
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(properties, key)) return `Unknown argument: ${key}`;
    const property = properties[key];
    const error = validateArgumentValue(property, args[key], `Argument ${key}`);
    if (error) return error;
  }
  return null;
}

/** @param {JsonSchema} property @param {unknown} value @param {string} label */
function validateArgumentValue(property, value, label) {
  const error = validateSchemaValue(property, value)[0];
  if (!error) return null;
  const nestedLabel = error.path ? `${label}${error.path.replaceAll("/", ".")}` : label;
  return `${nestedLabel} ${error.message}`;
}

/** @param {WorkoutToolName} name @param {JsonRecord} args */
function assertToolArguments(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new WorkoutApiError("invalid_arguments", "Tool arguments must be an object");
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  const validationError = validateToolArguments(tool, args);
  if (validationError) throw new WorkoutApiError("invalid_arguments", validationError);
}

/** @param {string} value @param {number} days */
function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** @param {any} plan @param {string} effectiveFrom @param {PlanUpdatePackage} expectedPackage */
function verifyPlanReadback(plan, effectiveFrom, expectedPackage) {
  const expectedDates = Array.from({ length: 7 }, (_, index) => addDays(effectiveFrom, index));
  const finalDate = expectedDates[6];
  if (plan?.schema_version !== 2 || !Array.isArray(plan.entries) || !plan.prescriptions || plan.from > effectiveFrom || plan.to < finalDate) throw new WorkoutApiError("readback_mismatch", "Effective Plan readback does not cover the applied seven-day window");
  const entriesByDate = new Map(plan.entries.map((/** @type {any} */ entry) => [entry?.date, entry]));
  const week = Object.fromEntries(expectedDates.map((date) => {
    const entry = entriesByDate.get(date);
    if (!entry) throw new WorkoutApiError("readback_mismatch", `Effective Plan readback is missing ${date}`);
    const slot = entry.kind === "no_plan" ? null : entry.kind === "rest" ? { kind: "rest" } : entry.kind === "workout" ? { kind: "workout", prescription: plan.prescriptions[entry.prescription_ref] } : undefined;
    if (slot === undefined || (entry.kind === "workout" && !slot?.prescription)) throw new WorkoutApiError("readback_mismatch", `Effective Plan readback has an invalid entry for ${date}`);
    const weekday = PLAN_UPDATE_WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
    return [weekday, slot];
  }));
  if (JSON.stringify(comparablePlanWeek(week)) !== JSON.stringify(comparablePlanWeek(expectedPackage.week))) throw new WorkoutApiError("readback_mismatch", "Effective Plan readback does not match the applied seven-day window");
}

/** @param {any} week */
function comparablePlanWeek(week) {
  return Object.fromEntries(PLAN_UPDATE_WEEKDAYS.map((day) => [day, comparablePlanSlot(week?.[day])]));
}

/** @param {any} slot */
function comparablePlanSlot(slot) {
  if (slot === null) return null;
  if (slot?.kind === "rest") return { kind: "rest" };
  if (slot?.kind !== "workout") return slot;
  const source = slot.prescription ?? slot;
  return {
    kind: "workout",
    title: source.title,
    start_time: source.start_time,
    estimated_duration_min: source.estimated_duration_min,
    ...(source.recording_intent ? { recording_intent: source.recording_intent } : {}),
    blocks: source.blocks.map((/** @type {any} */ block) => ({
      title: block.title,
      exercises: block.exercises.map((/** @type {any} */ exercise) => ({
        occurrence_key: exercise.occurrence_key,
        exercise_id: exercise.exercise_id,
        execution_mode: exercise.execution_mode,
        sets: exercise.sets.map((/** @type {any} */ set) => ({
          set_id: set.set_id,
          ordinal: set.ordinal,
          target: set.target,
          resistance_mode: set.resistance_mode ?? set.resistance?.mode,
          resistance_kg: set.resistance_kg ?? (set.resistance?.mode === "external_load" ? Math.round(set.resistance.value * (set.resistance.unit === "lb" ? 0.45359237 : 1) * 100000) / 100000 : null),
          tempo: set.tempo,
          rest_after_sec: set.rest_after_sec,
        })),
      })),
    })),
  };
}
