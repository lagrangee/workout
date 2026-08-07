// @ts-nocheck

const BRIDGE_PROTOCOL_VERSION = "2025-06-18";
const BRIDGE_SERVER_INFO = { name: "workout-agent-mcp", version: "0.1.0" };

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

  async get(path) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` } });
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
    const property = properties[key];
    if (!property) return `Unknown argument: ${key}`;
    const value = args[key];
    if (property.type === "string" && typeof value !== "string") return `Argument ${key} must be a string`;
    if (property.type === "boolean" && typeof value !== "boolean") return `Argument ${key} must be a boolean`;
    if (property.enum && !property.enum.includes(value)) return `Argument ${key} is unsupported`;
    if (property.format === "date" && !isValidDateArgument(value)) return `Argument ${key} must be a valid YYYY-MM-DD date`;
  }
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
