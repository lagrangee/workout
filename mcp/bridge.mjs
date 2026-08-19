// @ts-nocheck

const BRIDGE_PROTOCOL_VERSION = "2025-06-18";
const BRIDGE_SERVER_INFO = { name: "workout-agent-mcp", version: "0.1.0" };
const PLAN_UPDATE_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const exactObject = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const nullable = (schema) => ({ oneOf: [{ type: "null" }, schema] });
const arrayOf = (items, minItems, maxItems) => ({ type: "array", items, minItems, ...(maxItems === undefined ? {} : { maxItems }) });
const PLAN_UPDATE_TARGET_SCHEMA = exactObject({
  metric: { type: "string", enum: ["reps", "duration_sec"] },
  value: { type: "integer", minimum: 1 },
});
const PLAN_UPDATE_RESISTANCE_SCHEMA = {
  oneOf: [
    exactObject({ mode: { const: "bodyweight" } }),
    exactObject({ mode: { const: "external_load" }, value: { type: "number", minimum: 0 }, unit: { type: "string", enum: ["kg", "lb"] } }),
  ],
};
const PLAN_UPDATE_TEMPO_SCHEMA = nullable({ type: "string", pattern: "^(?:0|[1-9]\\d*)-(?:0|[1-9]\\d*)-(?:0|[1-9]\\d*)-(?:0|[1-9]\\d*)$" });
const PLAN_UPDATE_SET_SCHEMA = exactObject({
  set_id: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
  ordinal: { type: "integer", minimum: 1 },
  target: PLAN_UPDATE_TARGET_SCHEMA,
  resistance: PLAN_UPDATE_RESISTANCE_SCHEMA,
  tempo: PLAN_UPDATE_TEMPO_SCHEMA,
  rest_after_sec: nullable({ type: "integer", minimum: 0 }),
});
const PLAN_UPDATE_EXERCISE_SCHEMA = exactObject({
  occurrence_key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
  exercise_id: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
  execution_mode: { type: "string", enum: ["none", "bilateral", "per_side", "alternating"] },
  sets: arrayOf(PLAN_UPDATE_SET_SCHEMA, 1, 200),
});
const PLAN_UPDATE_BLOCK_SCHEMA = exactObject({
  title: { type: "string", minLength: 1, maxLength: 100 },
  exercises: arrayOf(PLAN_UPDATE_EXERCISE_SCHEMA, 1),
});
const PLAN_UPDATE_WORKOUT_SCHEMA = exactObject({
  kind: { const: "workout" },
  title: { type: "string", minLength: 1, maxLength: 100 },
  start_time: nullable({ type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }),
  estimated_duration_min: { type: "integer", minimum: 1 },
  blocks: arrayOf(PLAN_UPDATE_BLOCK_SCHEMA, 1, 20),
});
const PLAN_UPDATE_SLOT_SCHEMA = {
  oneOf: [
    { type: "null" },
    exactObject({ kind: { const: "rest" } }),
    PLAN_UPDATE_WORKOUT_SCHEMA,
  ],
};
const PLAN_UPDATE_PACKAGE_SCHEMA = exactObject({
  schema_version: { type: "integer", const: 2 },
  effective_from: { type: "string", format: "date" },
  week: exactObject(Object.fromEntries(PLAN_UPDATE_WEEKDAYS.map((day) => [day, PLAN_UPDATE_SLOT_SCHEMA]))),
});
const PLAN_UPDATE_APPLY_SCHEMA = exactObject({
  package: PLAN_UPDATE_PACKAGE_SCHEMA,
  package_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  base_plan_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  confirmed: { type: "boolean", const: true },
  idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
});

const TOOL_DEFINITIONS = [
  {
    name: "workout_get_overview",
    description: "Read bounded current plan context, coverage, freshness, metrics, and recent Workout Session evidence.",
    inputSchema: { type: "object", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" }, preset: { type: "string", enum: ["7d", "30d", "12w", "all"] }, range: { type: "string", enum: ["7d", "30d", "12w", "all"] } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "workout_get_plan",
    description: "Read the Current Plan and effective future Weekly Templates for the configured Athlete.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
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
    description: "Apply one previously validated future Plan Update Package after explicit confirmation, then read back the Current Plan and affected seven-day Schedule.",
    inputSchema: PLAN_UPDATE_APPLY_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

export class WorkoutApiError extends Error {
  constructor(code, message, status = 0, details = []) {
    super(message);
    this.name = "WorkoutApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class WorkoutApiClient {
  constructor({ origin, token, fetchImpl = globalThis.fetch } = {}) {
    if (typeof origin !== "string" || !origin) throw new Error("WORKOUT_AGENT_API_ORIGIN is required");
    if (typeof token !== "string" || !token) throw new Error("WORKOUT_AGENT_TOKEN is required");
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") throw new Error("WORKOUT_AGENT_API_ORIGIN must use HTTPS");
    if (parsed.search || parsed.hash) throw new Error("WORKOUT_AGENT_API_ORIGIN must not include a query or hash");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    this.baseUrl = `${parsed.toString().replace(/\/$/, "")}/api/agent/v1`;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  listTools() { return TOOL_DEFINITIONS.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties }, ...(tool.inputSchema.required ? { required: [...tool.inputSchema.required] } : {}) }, annotations: { ...tool.annotations } })); }

  async callTool(name, args = {}) {
    if (name === "workout_get_overview") return this.getOverview(args);
    if (name === "workout_get_plan") return this.getPlan(args);
    if (name === "workout_get_schedule") return this.getSchedule(args);
    if (name === "workout_list_sessions") return this.listSessions(args);
    if (name === "workout_get_session") return this.getSession(args);
    if (name === "workout_get_progress") return this.getProgress(args);
    if (name === "workout_get_exercise_history") return this.getExerciseHistory(args);
    if (name === "workout_validate_plan_update") return this.validatePlanUpdate(args);
    if (name === "workout_apply_plan_update") return this.applyPlanUpdate(args);
    throw new WorkoutApiError("tool_not_found", `Tool is not available: ${name}`, 0);
  }

  async getOverview(args = {}) {
    assertToolArguments("workout_get_overview", args);
    const query = new URLSearchParams();
    for (const field of ["from", "to", "preset", "range"]) if (typeof args[field] === "string") query.set(field, args[field]);
    return this.get(`/overview${query.size ? `?${query}` : ""}`);
  }

  async getPlan(args = {}) { assertToolArguments("workout_get_plan", args); return this.get("/plan"); }

  async getSchedule(args = {}) {
    assertToolArguments("workout_get_schedule", args);
    const query = new URLSearchParams();
    if (typeof args.from === "string") query.set("from", args.from);
    if (typeof args.to === "string") query.set("to", args.to);
    if (args.expand === true) query.set("expand", "prescription");
    return this.get(`/schedule${query.size ? `?${query}` : ""}`);
  }

  async listSessions(args = {}) {
    assertToolArguments("workout_list_sessions", args);
    const query = new URLSearchParams();
    for (const field of ["from", "to", "limit", "cursor", "status", "exercise_id"]) if (args[field] !== undefined) query.set(field, String(args[field]));
    return this.get(`/sessions${query.size ? `?${query}` : ""}`);
  }

  async getSession(args = {}) {
    assertToolArguments("workout_get_session", args);
    return this.get(`/sessions/${encodeURIComponent(args.session_key)}`);
  }

  async getProgress(args = {}) {
    assertToolArguments("workout_get_progress", args);
    const query = new URLSearchParams();
    for (const field of ["from", "to", "preset", "range", "bucket"]) if (args[field] !== undefined) query.set(field, String(args[field]));
    return this.get(`/progress${query.size ? `?${query}` : ""}`);
  }

  async getExerciseHistory(args = {}) {
    assertToolArguments("workout_get_exercise_history", args);
    const query = new URLSearchParams();
    for (const field of ["from", "to", "preset", "range"]) if (args[field] !== undefined) query.set(field, String(args[field]));
    return this.get(`/exercises/${encodeURIComponent(args.exercise_id)}${query.size ? `?${query}` : ""}`);
  }

  async validatePlanUpdate(args = {}) {
    assertToolArguments("workout_validate_plan_update", args);
    return this.post("/plan-updates/validate", { package_text: JSON.stringify(args.package) });
  }

  async applyPlanUpdate(args = {}) {
    assertToolArguments("workout_apply_plan_update", args);
    const applied = await this.post("/plan-updates/apply", {
      package_text: JSON.stringify(args.package),
      package_digest: args.package_digest,
      base_plan_digest: args.base_plan_digest,
      confirmed: args.confirmed,
    }, { "Idempotency-Key": args.idempotency_key });
    const readbackFrom = applied.effective_from;
    const readbackTo = addDays(readbackFrom, 6);
    try {
      const [plan, schedule] = await Promise.all([
        this.get("/plan"),
        this.getSchedule({ from: readbackFrom, to: readbackTo, expand: true }),
      ]);
      verifyPlanReadback(plan, readbackFrom, args.package);
      verifyScheduleReadback(schedule, readbackFrom, readbackTo);
      return { ...applied, readback: { status: "verified", plan, schedule } };
    } catch (error) {
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

  async get(path) {
    return this.request(path, { method: "GET" });
  }

  async post(path, body, headers = {}) {
    return this.request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  }

  async request(path, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...options, headers: { Accept: "application/json", Authorization: `Bearer ${this.token}`, ...(options.headers ?? {}) } });
    } catch (error) {
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

export function hasId(message) { return Boolean(message && typeof message === "object" && Object.prototype.hasOwnProperty.call(message, "id")); }
function makeResponse(id, result) { return { jsonrpc: "2.0", id, result }; }
export function makeError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

export class McpBridge {
  constructor({ client, serverInfo = BRIDGE_SERVER_INFO } = {}) {
    if (!client || typeof client.listTools !== "function" || typeof client.callTool !== "function") throw new TypeError("McpBridge requires a typed workout client");
    this.client = client;
    this.serverInfo = serverInfo;
  }

  async getTools() { return this.client.listTools(); }

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

  async handleToolCall(message) {
    const params = message.params;
    if (!params || typeof params !== "object" || typeof params.name !== "string") return makeError(message.id, -32602, "tools/call requires params.name");
    if (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments))) return makeError(message.id, -32602, "tools/call params.arguments must be an object");
    const available = await this.getTools();
    if (!available.some((tool) => tool.name === params.name)) return makeError(message.id, -32602, `Tool is not available: ${params.name}`);
    const validationError = validateToolArguments(available.find((tool) => tool.name === params.name), params.arguments ?? {});
    if (validationError) return makeError(message.id, -32602, validationError);
    try {
      const value = await this.client.callTool(params.name, params.arguments ?? {});
      return makeResponse(message.id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    } catch (error) {
      const failure = { error: { code: error.code ?? "transport_error", message: error.message ?? String(error), details: error.details ?? [] }, status: error.status ?? 0 };
      return makeResponse(message.id, { content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure, isError: true });
    }
  }
}

function validateToolArguments(tool, args) {
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

function validateArgumentValue(property, value, label) {
  if (property.oneOf) {
    if (property.oneOf.some((candidate) => !validateArgumentValue(candidate, value, label))) return null;
    return `${label} does not match the expected shape`;
  }
  if (property.type === "null") return value === null ? null : `${label} must be null`;
  if (property.type === "string" && typeof value !== "string") return `${label} must be a string`;
  if (property.type === "string" && property.pattern && !new RegExp(property.pattern).test(value)) return `${label} has an invalid format`;
  if (property.type === "string" && property.minLength !== undefined && value.length < property.minLength) return `${label} is too short`;
  if (property.type === "string" && property.maxLength !== undefined && value.length > property.maxLength) return `${label} is too long`;
  if (property.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${label} must be an object`;
    for (const required of property.required ?? []) if (!Object.hasOwn(value, required)) return `Missing required argument: ${label}.${required}`;
    for (const key of Object.keys(value)) {
      const hasNestedProperty = Object.hasOwn(property.properties ?? {}, key);
      const nested = hasNestedProperty ? property.properties[key] : undefined;
      if (!hasNestedProperty && property.additionalProperties === false) return `Unknown argument: ${label}.${key}`;
      if (nested) {
        const error = validateArgumentValue(nested, value[key], `${label}.${key}`);
        if (error) return error;
      }
    }
  }
  if (property.type === "array") {
    if (!Array.isArray(value)) return `${label} must be an array`;
    if (property.minItems !== undefined && value.length < property.minItems) return `${label} must contain at least ${property.minItems} items`;
    if (property.maxItems !== undefined && value.length > property.maxItems) return `${label} must contain at most ${property.maxItems} items`;
    for (let index = 0; index < value.length; index += 1) {
      const error = validateArgumentValue(property.items, value[index], `${label}.${index}`);
      if (error) return error;
    }
  }
  if (property.type === "boolean" && typeof value !== "boolean") return `${label} must be a boolean`;
  if (property.type === "integer" && !Number.isInteger(value)) return `${label} must be an integer`;
  if (property.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return `${label} must be a number`;
  if (property.const !== undefined && value !== property.const) return `${label} is unsupported`;
  if (property.minimum !== undefined && value < property.minimum) return `${label} is below the minimum`;
  if (property.maximum !== undefined && value > property.maximum) return `${label} is above the maximum`;
  if (property.enum && !property.enum.includes(value)) return `${label} is unsupported`;
  if (property.format === "date" && !isValidDateArgument(value)) return `${label} must be a valid YYYY-MM-DD date`;
  return null;
}

function assertToolArguments(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new WorkoutApiError("invalid_arguments", "Tool arguments must be an object");
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  const validationError = validateToolArguments(tool, args);
  if (validationError) throw new WorkoutApiError("invalid_arguments", validationError);
}

function isValidDateArgument(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function verifyPlanReadback(plan, effectiveFrom, expectedPackage) {
  const revisions = [plan?.current, ...(Array.isArray(plan?.future) ? plan.future : [])];
  const revision = revisions.find((candidate) => candidate?.effective_from === effectiveFrom);
  if (!revision) throw new WorkoutApiError("readback_mismatch", "Current Plan readback does not contain the applied effective date");
  if (JSON.stringify(comparablePlanWeek(revision.week)) !== JSON.stringify(comparablePlanWeek(expectedPackage.week))) throw new WorkoutApiError("readback_mismatch", "Current Plan readback does not match the applied Weekly Template");
}

function verifyScheduleReadback(schedule, from, to) {
  const entries = schedule?.entries;
  const expectedDates = Array.from({ length: 7 }, (_, index) => addDays(from, index));
  if (!schedule || schedule.from !== from || schedule.to !== to || !Array.isArray(entries) || entries.length !== expectedDates.length || entries.some((entry, index) => entry?.date !== expectedDates[index])) throw new WorkoutApiError("readback_mismatch", "Schedule readback does not cover the applied seven-day window");
}

function comparablePlanWeek(week) {
  return Object.fromEntries(PLAN_UPDATE_WEEKDAYS.map((day) => [day, comparablePlanSlot(week?.[day])]));
}

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
    blocks: source.blocks.map((block) => ({
      title: block.title,
      exercises: block.exercises.map((exercise) => ({
        occurrence_key: exercise.occurrence_key,
        exercise_id: exercise.exercise_id,
        execution_mode: exercise.execution_mode,
        sets: exercise.sets.map((set) => ({
          set_id: set.set_id,
          ordinal: set.ordinal,
          target: set.target,
          resistance_mode: set.resistance_mode,
          resistance_kg: set.resistance_kg,
          tempo: set.tempo,
          rest_after_sec: set.rest_after_sec,
        })),
      })),
    })),
  };
}
