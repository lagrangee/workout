import type { ApiClient, ApiErrorBody, JsonRecord } from "./contracts";

export class WorkoutApiError extends Error {
  readonly status: number;
  readonly data: ApiErrorBody;

  constructor(message: string, status: number, data: ApiErrorBody) {
    super(message);
    this.name = "WorkoutApiError";
    this.status = status;
    this.data = data;
  }
}

export class WorkoutProtocolError extends Error {
  readonly path: string;
  readonly issue: string;

  constructor(path: string, issue: string) {
    super("服务器返回了无法验证的响应");
    this.name = "WorkoutProtocolError";
    this.path = path;
    this.issue = issue;
  }
}

function requestOptions(options: RequestInit): RequestInit {
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  const localEmail = typeof storage?.getItem === "function"
    ? storage.getItem("workout-athlete-email")
    : null;
  const hostname = typeof location === "undefined" ? "" : location.hostname;
  if (localEmail && ["localhost", "127.0.0.1"].includes(hostname)) {
    headers.set("x-athlete-email", localEmail);
  }
  return {
    ...options,
    credentials: options.credentials ?? "same-origin",
    headers,
  };
}

function apiErrorBody(value: unknown): ApiErrorBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const candidate = (value as { error?: unknown }).error;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return {};
  const source = candidate as Record<string, unknown>;
  const error: NonNullable<ApiErrorBody["error"]> = {};
  if (typeof source.code === "string") error.code = source.code;
  if (typeof source.message === "string") error.message = source.message;
  if (Array.isArray(source.details)) {
    error.details = source.details.flatMap((detail) => {
      if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return [];
      const record = detail as Record<string, unknown>;
      const normalized: { path?: string; message?: string } = {};
      if (typeof record.path === "string") normalized.path = record.path;
      if (typeof record.message === "string") normalized.message = record.message;
      return normalized.path !== undefined || normalized.message !== undefined ? [normalized] : [];
    });
  }
  return Object.keys(error).length ? { error } : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function responsePath(path: string): string {
  try {
    return new URL(path, "https://workout.invalid").pathname;
  } catch {
    return path.split(/[?#]/, 1)[0] ?? path;
  }
}

function protocolFailure(path: string, issue: string): never {
  throw new WorkoutProtocolError(path, issue);
}

function validateSessionSummary(path: string, value: unknown): JsonRecord {
  if (!isRecord(value)) protocolFailure(path, "session must be an object");
  const validStatus = ["planned", "in_progress", "completed", "partial", "abandoned", "skipped"];
  if (!isNonEmptyString(value.session_key)
    || !isLocalDate(value.scheduled_date)
    || !isLocalDate(value.local_date)
    || typeof value.title !== "string"
    || typeof value.status !== "string"
    || !validStatus.includes(value.status)
    || !isFiniteNumber(value.completion_fraction)
    || value.completion_fraction < 0
    || value.completion_fraction > 1
    || !isFiniteNumber(value.training_duration_sec)
    || value.training_duration_sec < 0
    || !(value.session_rpe === null || isFiniteNumber(value.session_rpe))
    || !isStringArray(value.exercise_keys)
    || !isStringArray(value.exercise_ids)
    || !isNonEmptyString(value.updated_at)
    || !isNonEmptyString(value.source_ref)) {
    protocolFailure(path, "session summary is missing required fields");
  }
  return value;
}

function validateSessionDetail(path: string, value: JsonRecord): void {
  validateSessionSummary(path, value);
  if (!isRecord(value.snapshot)
    || !Array.isArray(value.completion_results)
    || !Array.isArray(value.training_intervals)
    || !Array.isArray(value.exercise_feedback)
    || !(value.external_completions === undefined || Array.isArray(value.external_completions))
    || !isNonEmptyString(value.timezone_at_session)
    || !isNonEmptyString(value.created_at)
    || !hasOwn(value, "note")
    || !(value.note === null || typeof value.note === "string")
    || !hasOwn(value, "skip_reason")
    || !(value.skip_reason === null || typeof value.skip_reason === "string")) {
    protocolFailure(path, "session detail is missing required fields");
  }
}

function isExternalCompletionPath(pathname: string): boolean {
  return /^\/api\/private\/scheduled-workouts\/\d{4}-\d{2}-\d{2}\/exercises\/[^/]+\/external-completion$/.test(pathname);
}

function validateToday(path: string, value: JsonRecord): void {
  if (!isLocalDate(value.date)
    || !isNonEmptyString(value.timezone)
    || !hasOwn(value, "entry")
    || !(value.entry === null || isRecord(value.entry))
    || !hasOwn(value, "session")
    || !(value.session === null || isRecord(value.session))) {
    protocolFailure(path, "today envelope is missing required fields");
  }
  if (value.session !== null) validateSessionSummary(path, value.session);
}

function validatePlanRevision(path: string, value: unknown): void {
  if (!isRecord(value) || !isLocalDate(value.effective_from) || !isRecord(value.week)) {
    protocolFailure(path, "plan revision is missing required fields");
  }
}

function validatePlan(path: string, value: JsonRecord): void {
  if (!isNonEmptyString(value.timezone)
    || !hasOwn(value, "first_effective_from")
    || !(value.first_effective_from === null || isLocalDate(value.first_effective_from))
    || !hasOwn(value, "current")
    || !(value.current === null || isRecord(value.current))
    || !Array.isArray(value.future)) {
    protocolFailure(path, "plan envelope is missing required fields");
  }
  if (value.current !== null) validatePlanRevision(path, value.current);
  for (const revision of value.future) validatePlanRevision(path, revision);
}

function validateProgress(path: string, value: JsonRecord): void {
  if (value.metric_semantics_version !== 1
    || !isRecord(value.period)
    || !isLocalDate(value.period.from)
    || !isLocalDate(value.period.to)
    || !isRecord(value.metrics)
    || !isRecord(value.metrics.completion_rate)
    || !(value.metrics.completion_rate.value === null || isFiniteNumber(value.metrics.completion_rate.value))
    || !isRecord(value.metrics.training_duration)
    || !isFiniteNumber(value.metrics.training_duration.value_sec)
    || !isRecord(value.metrics.strength_training_days)
    || !isFiniteNumber(value.metrics.strength_training_days.value)
    || !isRecord(value.metrics.average_session_rpe)
    || !(value.metrics.average_session_rpe.value === null || isFiniteNumber(value.metrics.average_session_rpe.value))
    || !isFiniteNumber(value.metrics.average_session_rpe.included_count)
    || !isRecord(value.current_streak)
    || !isFiniteNumber(value.current_streak.value)
    || !Array.isArray(value.exercises)) {
    protocolFailure(path, "progress envelope is missing required fields");
  }
  for (const exercise of value.exercises) {
    if (!isRecord(exercise)
      || !isNonEmptyString(exercise.exercise_key)
      || typeof exercise.current_name !== "string"
      || !isFiniteNumber(exercise.performed_session_count)) {
      protocolFailure(path, "progress exercise is missing required fields");
    }
  }
}

function isSessionDetailPath(pathname: string): boolean {
  if (/^\/api\/private\/scheduled-workouts\/\d{4}-\d{2}-\d{2}\/(?:start|skip)$/.test(pathname)) return true;
  if (pathname === "/api/private/sessions/normalize-expired") return false;
  return /^\/api\/private\/sessions\/[^/]+(?:\/(?:end|pause|resume|continue|restart|record))?$/.test(pathname);
}

export function validateWorkoutJsonResponse(path: string, value: unknown): JsonRecord {
  if (!isRecord(value)) protocolFailure(path, "response body must be a JSON object");
  if (hasOwn(value, "error")) protocolFailure(path, "successful response contains an error envelope");

  const pathname = responsePath(path);
  if (isExternalCompletionPath(pathname)) {
    if (hasOwn(value, "session")) {
      if (!(value.session === null || isRecord(value.session)) || value.external_completion !== null) protocolFailure(path, "external completion undo response is malformed");
      if (isRecord(value.session)) validateSessionDetail(path, value.session);
    } else validateSessionDetail(path, value);
    return value;
  }
  if (pathname === "/api/private/me") validateMe(path, value);
  else if (pathname === "/api/private/today") validateToday(path, value);
  else if (pathname === "/api/private/plan") validatePlan(path, value);
  else if (pathname === "/api/private/progress") validateProgress(path, value);
  else if (isSessionDetailPath(pathname)) validateSessionDetail(path, value);
  return value;
}

function validateMe(path: string, value: JsonRecord): void {
  if (!isNonEmptyString(value.athlete_key)
    || !isNonEmptyString(value.display_name)
    || !isNonEmptyString(value.timezone)) {
    protocolFailure(path, "athlete profile is missing required fields");
  }
}

function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || /^[^/\s]+\/[^/\s;]+\+json$/.test(mediaType);
}

export async function workoutApiErrorFromResponse(response: Response): Promise<WorkoutApiError> {
  const data = apiErrorBody(await response.json().catch(() => null));
  const message = typeof data.error?.message === "string" && data.error.message.trim()
    ? data.error.message
    : "请求失败";
  return new WorkoutApiError(message, response.status, data);
}

export function createApiClient(fetchImpl: typeof fetch = fetch): ApiClient {
  async function response(path: string, options: RequestInit = {}): Promise<Response> {
    const result = await fetchImpl(path, requestOptions(options));
    if (!result.ok) throw await workoutApiErrorFromResponse(result);
    return result;
  }

  return {
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const result = await response(path, options);
      if (!isJsonMediaType(result.headers.get("Content-Type"))) {
        protocolFailure(path, "successful response must use a JSON media type");
      }
      const body = await result.text();
      if (!body.trim()) protocolFailure(path, "successful JSON response body is empty");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        protocolFailure(path, "successful response contains malformed JSON");
      }
      return validateWorkoutJsonResponse(path, parsed) as T;
    },
    response,
    idempotencyKey() {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    },
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof WorkoutApiError) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return error instanceof Error ? error.message : "请求失败";
}
