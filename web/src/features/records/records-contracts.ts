import type {
  AerobicActivity,
  AerobicDetailResponse,
  AerobicListResponse,
  AerobicSportType,
  AerobicSummary,
  FitStatus,
  RecordsOverviewResponse,
  RouteDetailResponse,
  RouteDirection,
  RouteHistoryActivity,
  RouteItem,
  RouteMatchStatus,
  RoutesListResponse,
  SourceStatus,
} from "./records-types";

type JsonObject = Record<string, unknown>;

const SPORT_NAMES: Record<AerobicSportType, string> = {
  100: "outdoor_run",
  101: "indoor_run",
  102: "trail_run",
  104: "hike",
  200: "cycling",
};

function invalid(path: string, expected: string): never {
  throw new Error(`训练记录响应格式无效：${path} 必须是${expected}`);
}

function objectAt(value: unknown, path: string): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : invalid(path, "对象");
}

function stringAt(value: unknown, path: string): string {
  return typeof value === "string" ? value : invalid(path, "字符串");
}

function nullableStringAt(value: unknown, path: string): string | null {
  return value === null ? null : stringAt(value, path);
}

function numberAt(value: unknown, path: string): number {
  return typeof value === "number" && Number.isFinite(value) ? value : invalid(path, "有限数字");
}

function nullableNumberAt(value: unknown, path: string): number | null {
  return value === null ? null : numberAt(value, path);
}

function integerAt(value: unknown, path: string): number {
  const number = numberAt(value, path);
  return Number.isInteger(number) && number >= 0 ? number : invalid(path, "非负整数");
}

function arrayAt(value: unknown, path: string): unknown[] {
  return Array.isArray(value) ? value : invalid(path, "数组");
}

function literalAt<T extends string | number>(value: unknown, expected: T, path: string): T {
  return value === expected ? expected : invalid(path, JSON.stringify(expected));
}

function nullAt(value: unknown, path: string): null {
  return value === null ? null : invalid(path, "null");
}

function schemaOneAt(value: JsonObject, path: string): 1 {
  return literalAt(value.schema_version, 1, `${path}.schema_version`);
}

function sourceStatusAt(value: unknown, path: string): SourceStatus {
  return value === "complete" || value === "none" || value === "partial" || value === "error"
    ? value
    : invalid(path, "complete、none、partial 或 error");
}

function sourceStatusesAt(value: unknown, path: string): { workout: SourceStatus; coros: SourceStatus } {
  const statuses = objectAt(value, path);
  return {
    workout: sourceStatusAt(statuses.workout, `${path}.workout`),
    coros: sourceStatusAt(statuses.coros, `${path}.coros`),
  };
}

function sportTypeAt(value: unknown, path: string): AerobicSportType {
  return value === 100 || value === 101 || value === 102 || value === 104 || value === 200
    ? value
    : invalid(path, "受支持的 sport_type");
}

function nullableSportTypeAt(value: unknown, path: string): AerobicSportType | null {
  return value === null ? null : sportTypeAt(value, path);
}

function routeDirectionAt(value: unknown, path: string): RouteDirection {
  return value === null || value === "forward" || value === "reverse"
    ? value
    : invalid(path, "forward、reverse 或 null");
}

function routeMatchStatusAt(value: unknown, path: string): RouteMatchStatus {
  return value === "matched" || value === "registered" || value === "unmatched"
    || value === "ambiguous" || value === "ignored" || value === "error"
    ? value
    : invalid(path, "受支持的 route_match_status");
}

function fitStatusAt(value: unknown, path: string): FitStatus {
  return value === null || value === "complete" || value === "partial" || value === "error"
    ? value
    : invalid(path, "complete、partial、error 或 null");
}

function stringArrayAt(value: unknown, path: string): string[] {
  return arrayAt(value, path).map((item, index) => stringAt(item, `${path}[${index}]`));
}

function summaryAt(value: unknown, path: string): AerobicSummary {
  const summary = objectAt(value, path);
  return {
    duration_sec: nullableNumberAt(summary.duration_sec, `${path}.duration_sec`),
    distance_km: nullableNumberAt(summary.distance_km, `${path}.distance_km`),
    average_heart_rate_bpm: nullableNumberAt(summary.average_heart_rate_bpm, `${path}.average_heart_rate_bpm`),
    calories_kcal: nullableNumberAt(summary.calories_kcal, `${path}.calories_kcal`),
  };
}

function activityAt(value: unknown, path: string): AerobicActivity {
  const activity = objectAt(value, path);
  const activityRef = stringAt(activity.activity_ref, `${path}.activity_ref`);
  const sourceRef = stringAt(activity.source_ref, `${path}.source_ref`);
  if (sourceRef !== `coros:activity:${activityRef}`) invalid(`${path}.source_ref`, `coros:activity:${activityRef}`);
  const sportType = sportTypeAt(activity.sport_type, `${path}.sport_type`);
  const sportName = stringAt(activity.sport_name, `${path}.sport_name`);
  if (sportName !== SPORT_NAMES[sportType]) invalid(`${path}.sport_name`, SPORT_NAMES[sportType]);
  const routeKey = nullableStringAt(activity.route_key, `${path}.route_key`);
  const routeDirection = routeDirectionAt(activity.route_direction, `${path}.route_direction`);
  const routeMatchStatus = routeMatchStatusAt(activity.route_match_status, `${path}.route_match_status`);
  if (routeKey === null && routeDirection !== null) invalid(`${path}.route_direction`, "null when route_key is null");
  if (routeKey === null && (routeMatchStatus === "matched" || routeMatchStatus === "registered")) {
    invalid(`${path}.route_match_status`, "没有 route_key 时的非匹配状态");
  }
  if (routeKey !== null && routeMatchStatus !== "matched" && routeMatchStatus !== "registered") {
    invalid(`${path}.route_match_status`, "route_key 存在时的 matched 或 registered");
  }
  if (sportType === 101 && (routeKey !== null || routeDirection !== null || routeMatchStatus !== "ignored")) {
    invalid(path, "不含路线的室内活动");
  }
  return {
    schema_version: schemaOneAt(activity, path),
    activity_ref: activityRef,
    source_ref: sourceRef,
    local_date: stringAt(activity.local_date, `${path}.local_date`),
    timezone: stringAt(activity.timezone, `${path}.timezone`),
    started_at: nullableStringAt(activity.started_at, `${path}.started_at`),
    ended_at: nullableStringAt(activity.ended_at, `${path}.ended_at`),
    sport_type: sportType,
    sport_name: sportName,
    source_status: sourceStatusAt(activity.source_status, `${path}.source_status`),
    data_as_of: nullableStringAt(activity.data_as_of, `${path}.data_as_of`),
    updated_at: nullableStringAt(activity.updated_at, `${path}.updated_at`),
    summary: summaryAt(activity.summary, `${path}.summary`),
    route_key: routeKey,
    route_direction: routeDirection,
    route_match_status: routeMatchStatus,
    fit_status: fitStatusAt(activity.fit_status, `${path}.fit_status`),
  };
}

function historyActivityAt(value: unknown, path: string): RouteHistoryActivity {
  const activity = objectAt(value, path);
  const activityRef = stringAt(activity.activity_ref, `${path}.activity_ref`);
  const sourceRef = stringAt(activity.source_ref, `${path}.source_ref`);
  if (sourceRef !== `coros:activity:${activityRef}`) invalid(`${path}.source_ref`, `coros:activity:${activityRef}`);
  const sportType = sportTypeAt(activity.sport_type, `${path}.sport_type`);
  const sportName = stringAt(activity.sport_name, `${path}.sport_name`);
  if (sportName !== SPORT_NAMES[sportType]) invalid(`${path}.sport_name`, SPORT_NAMES[sportType]);
  const sourceStatus = sourceStatusAt(activity.source_status, `${path}.source_status`);
  const syncStatus = sourceStatusAt(activity.sync_status, `${path}.sync_status`);
  if (sourceStatus !== syncStatus) invalid(`${path}.sync_status`, "与 source_status 相同");
  return {
    activity_ref: activityRef,
    source_ref: sourceRef,
    local_date: stringAt(activity.local_date, `${path}.local_date`),
    timezone: stringAt(activity.timezone, `${path}.timezone`),
    started_at: nullableStringAt(activity.started_at, `${path}.started_at`),
    ended_at: nullableStringAt(activity.ended_at, `${path}.ended_at`),
    sport_type: sportType,
    sport_name: sportName,
    route_key: stringAt(activity.route_key, `${path}.route_key`),
    route_direction: routeDirectionAt(activity.route_direction, `${path}.route_direction`),
    source_status: sourceStatus,
    sync_status: syncStatus,
    data_as_of: nullableStringAt(activity.data_as_of, `${path}.data_as_of`),
    summary: summaryAt(activity.summary, `${path}.summary`),
  };
}

function distanceRangeAt(value: unknown, path: string): [number, number] | null {
  if (value === null) return null;
  const range = arrayAt(value, path);
  if (range.length !== 2) invalid(path, "两个数字组成的数组或 null");
  const minimum = numberAt(range[0], `${path}[0]`);
  const maximum = numberAt(range[1], `${path}[1]`);
  if (minimum < 0 || maximum < minimum) invalid(path, "有效且递增的距离范围");
  return [minimum, maximum];
}

function routeItemAt(value: unknown, path: string): RouteItem {
  const route = objectAt(value, path);
  return {
    route_key: stringAt(route.route_key, `${path}.route_key`),
    route_name: stringAt(route.route_name, `${path}.route_name`),
    sport_types: arrayAt(route.sport_types, `${path}.sport_types`).map((item, index) => sportTypeAt(item, `${path}.sport_types[${index}]`)),
    distance_range_km: distanceRangeAt(route.distance_range_km, `${path}.distance_range_km`),
    activity_count: integerAt(route.activity_count, `${path}.activity_count`),
    total_distance_km: nullableNumberAt(route.total_distance_km, `${path}.total_distance_km`),
    total_duration_sec: nullableNumberAt(route.total_duration_sec, `${path}.total_duration_sec`),
    latest_activity: route.latest_activity === null
      ? null
      : historyActivityAt(route.latest_activity, `${path}.latest_activity`),
  };
}

export function parseRecordsOverviewResponse(value: unknown): RecordsOverviewResponse {
  const response = objectAt(value, "overview");
  const period = objectAt(response.period, "overview.period");
  const workout = objectAt(response.workout, "overview.workout");
  const aerobic = objectAt(response.aerobic, "overview.aerobic");
  return {
    schema_version: schemaOneAt(response, "overview"),
    generated_at: stringAt(response.generated_at, "overview.generated_at"),
    period: {
      from: stringAt(period.from, "overview.period.from"),
      to: stringAt(period.to, "overview.period.to"),
      timezone: stringAt(period.timezone, "overview.period.timezone"),
    },
    source_statuses: sourceStatusesAt(response.source_statuses, "overview.source_statuses"),
    relation_policy: literalAt(response.relation_policy, "same_local_date_context_only", "overview.relation_policy"),
    workout: {
      source: literalAt(workout.source, "workout", "overview.workout.source"),
      session_count: integerAt(workout.session_count, "overview.workout.session_count"),
      table: objectAt(workout.table, "overview.workout.table"),
    },
    aerobic: {
      source: literalAt(aerobic.source, "coros", "overview.aerobic.source"),
      activity_count: integerAt(aerobic.activity_count, "overview.aerobic.activity_count"),
      source_status: sourceStatusAt(aerobic.source_status, "overview.aerobic.source_status"),
    },
    days: arrayAt(response.days, "overview.days").map((value, index) => {
      const path = `overview.days[${index}]`;
      const day = objectAt(value, path);
      const scheduleKind = day.schedule_kind;
      if (scheduleKind !== "workout" && scheduleKind !== "rest" && scheduleKind !== "no_plan") {
        invalid(`${path}.schedule_kind`, "workout、rest 或 no_plan");
      }
      return {
        local_date: stringAt(day.local_date, `${path}.local_date`),
        schedule_kind: scheduleKind,
        workout_session_count: integerAt(day.workout_session_count, `${path}.workout_session_count`),
        workout_session_keys: stringArrayAt(day.workout_session_keys, `${path}.workout_session_keys`),
        aerobic_activity_count: integerAt(day.aerobic_activity_count, `${path}.aerobic_activity_count`),
        activity_refs: stringArrayAt(day.activity_refs, `${path}.activity_refs`),
        aerobic_summary: objectAt(day.aerobic_summary, `${path}.aerobic_summary`),
        relation_policy: literalAt(day.relation_policy, "same_local_date_context_only", `${path}.relation_policy`),
      };
    }),
  };
}

export function parseAerobicListResponse(value: unknown): AerobicListResponse {
  const response = objectAt(value, "aerobic list");
  const filters = objectAt(response.filters, "aerobic list.filters");
  const page = objectAt(response.page, "aerobic list.page");
  return {
    schema_version: schemaOneAt(response, "aerobic list"),
    generated_at: stringAt(response.generated_at, "aerobic list.generated_at"),
    data_as_of: nullableStringAt(response.data_as_of, "aerobic list.data_as_of"),
    timezone: stringAt(response.timezone, "aerobic list.timezone"),
    source_status: sourceStatusAt(response.source_status, "aerobic list.source_status"),
    source_statuses: sourceStatusesAt(response.source_statuses, "aerobic list.source_statuses"),
    source_ref: literalAt(response.source_ref, "aerobic-records", "aerobic list.source_ref"),
    filters: {
      from: nullableStringAt(filters.from, "aerobic list.filters.from"),
      to: nullableStringAt(filters.to, "aerobic list.filters.to"),
      sport_type: nullableSportTypeAt(filters.sport_type, "aerobic list.filters.sport_type"),
      limit: integerAt(filters.limit, "aerobic list.filters.limit"),
    },
    page: {
      limit: integerAt(page.limit, "aerobic list.page.limit"),
      next_cursor: nullAt(page.next_cursor, "aerobic list.page.next_cursor"),
    },
    items: arrayAt(response.items, "aerobic list.items").map((item, index) => activityAt(item, `aerobic list.items[${index}]`)),
  };
}

export function parseAerobicDetailResponse(value: unknown): AerobicDetailResponse {
  const response = objectAt(value, "aerobic detail");
  return {
    ...activityAt(response, "aerobic detail"),
    generated_at: stringAt(response.generated_at, "aerobic detail.generated_at"),
    source_statuses: sourceStatusesAt(response.source_statuses, "aerobic detail.source_statuses"),
  };
}

export function parseRoutesListResponse(value: unknown): RoutesListResponse {
  const response = objectAt(value, "routes list");
  const filters = objectAt(response.filters, "routes list.filters");
  const page = objectAt(response.page, "routes list.page");
  return {
    schema_version: schemaOneAt(response, "routes list"),
    generated_at: stringAt(response.generated_at, "routes list.generated_at"),
    data_as_of: nullableStringAt(response.data_as_of, "routes list.data_as_of"),
    source_status: sourceStatusAt(response.source_status, "routes list.source_status"),
    source_ref: literalAt(response.source_ref, "route-records", "routes list.source_ref"),
    filters: {
      sport_type: nullableSportTypeAt(filters.sport_type, "routes list.filters.sport_type"),
      limit: integerAt(filters.limit, "routes list.filters.limit"),
    },
    page: {
      limit: integerAt(page.limit, "routes list.page.limit"),
      next_cursor: nullAt(page.next_cursor, "routes list.page.next_cursor"),
    },
    items: arrayAt(response.items, "routes list.items").map((item, index) => routeItemAt(item, `routes list.items[${index}]`)),
  };
}

export function parseRouteDetailResponse(value: unknown): RouteDetailResponse {
  const response = objectAt(value, "route detail");
  const route = routeItemAt(response, "route detail");
  const historyPeriod = objectAt(response.history_period, "route detail.history_period");
  const page = objectAt(response.page, "route detail.page");
  const sourceRef = stringAt(response.source_ref, "route detail.source_ref");
  if (sourceRef !== `route:${route.route_key}`) invalid("route detail.source_ref", `route:${route.route_key}`);
  return {
    schema_version: schemaOneAt(response, "route detail"),
    generated_at: stringAt(response.generated_at, "route detail.generated_at"),
    data_as_of: nullableStringAt(response.data_as_of, "route detail.data_as_of"),
    source_status: sourceStatusAt(response.source_status, "route detail.source_status"),
    source_ref: sourceRef,
    ...route,
    history: arrayAt(response.history, "route detail.history").map((item, index) => historyActivityAt(item, `route detail.history[${index}]`)),
    history_period: {
      from: nullableStringAt(historyPeriod.from, "route detail.history_period.from"),
      to: nullableStringAt(historyPeriod.to, "route detail.history_period.to"),
    },
    page: {
      limit: integerAt(page.limit, "route detail.page.limit"),
      next_cursor: nullAt(page.next_cursor, "route detail.page.next_cursor"),
    },
  };
}
