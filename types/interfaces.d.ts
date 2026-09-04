import type { AthleteState, WorkoutSession } from "../src/types.js";

export type JsonRecord = Record<string, any>;

export type AgentState = AthleteState & {
  training_version: number;
  archive_version?: number;
  aerobic_projection?: JsonRecord;
  aerobic_activities?: JsonRecord[];
  aerobic_date_projections?: Record<string, JsonRecord>;
  routes?: JsonRecord[];
};

export type AgentStore = {
  findByAgentDigest?(digest: string): Promise<AgentState | null> | AgentState | null;
  all(): Promise<AgentState[]> | AgentState[];
};

export type JsonSchema = {
  type?: string;
  const?: unknown;
  enum?: readonly unknown[];
  format?: string;
  default?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  uniqueItems?: boolean;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDefinition = {
  name: WorkoutToolName;
  description: string;
  inputSchema: JsonSchema & { type: "object"; properties: Record<string, JsonSchema> };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
};

export type PlanUpdatePackage = {
  schema_version: 2;
  effective_from: string;
  week: Record<string, JsonRecord | null>;
};

export type PlanUpdateBatch = {
  schema_version: 1;
  updates: PlanUpdatePackage[];
};

export type PlannedDayMove = { source_date: string; target_date: string };

export type WorkoutToolArguments = {
  workout_get_overview: { from?: string; to?: string; preset?: "7d" | "30d" | "12w" | "all"; range?: "7d" | "30d" | "12w" | "all" };
  workout_get_plan: Record<string, never>;
  workout_save_plan_local: Record<string, never>;
  workout_get_schedule: { from: string; to: string; expand?: boolean };
  workout_list_sessions: { from?: string; to?: string; limit?: number; cursor?: string; status?: "in_progress" | "completed" | "partial" | "skipped"; exercise_id?: string };
  workout_get_session: { session_key: string };
  workout_get_progress: { from?: string; to?: string; preset?: "7d" | "30d" | "12w" | "all"; range?: "7d" | "30d" | "12w" | "all"; bucket?: "day" | "week" | "month" };
  workout_get_exercise_history: { exercise_id: string; from?: string; to?: string; preset?: "7d" | "30d" | "12w" | "all"; range?: "7d" | "30d" | "12w" | "all" };
  workout_validate_plan_update: { package: PlanUpdatePackage };
  workout_apply_plan_update: { package: PlanUpdatePackage; package_digest: string; base_plan_digest: string; confirmed: true; idempotency_key: string };
  workout_validate_plan_update_batch: { batch: PlanUpdateBatch };
  workout_apply_plan_update_batch: { batch: PlanUpdateBatch; batch_digest: string; base_plan_digest: string; confirmed: true; idempotency_key: string };
  workout_validate_planned_day_move: { move: PlannedDayMove };
  workout_apply_planned_day_move: { move: PlannedDayMove; move_digest: string; base_plan_digest: string; confirmed: true; idempotency_key: string };
};

export type WorkoutToolName = keyof WorkoutToolArguments;

export type McpMessage = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

export type McpClient = {
  listTools(): ToolDefinition[] | Promise<ToolDefinition[]>;
  callTool(name: WorkoutToolName, args: JsonRecord): unknown | Promise<unknown>;
};

export type WorkoutTestSeams = {
  now?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  audio?: import("../web/src/lib/workout-timeline.js").AudioOutput;
};

export type TodayResponse = {
  date: string;
  timezone: string;
  entry: JsonRecord | null;
  session: WorkoutSession | null;
};

export type PlanResponse = {
  timezone: string;
  first_effective_from: string | null;
  current: JsonRecord | null;
  future: JsonRecord[];
};

export type AppState = JsonRecord & {
  today: TodayResponse | null;
  plan: PlanResponse | null;
  session: WorkoutSession | null;
  sessionDetail: WorkoutSession | null;
};

declare global {
  interface Window {
    __workoutTestSeams?: WorkoutTestSeams;
  }
}
