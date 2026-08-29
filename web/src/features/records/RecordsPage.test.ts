import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

import type {
  ApiClient,
  AppCoreState,
  WorkoutAppStore,
} from "../../core/contracts";
import RecordsPage from "./RecordsPage.vue";
import type {
  AerobicActivity,
  AerobicDetailResponse,
  AerobicListResponse,
  ExerciseDetailResponse,
  ProgressResponse,
  RecordsOverviewResponse,
  RouteHistoryActivity,
  RouteDetailResponse,
  RoutesListResponse,
} from "./records-types";

type RequestHandler = (path: string, options?: RequestInit) => unknown | Promise<unknown>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createTestApp(handler: RequestHandler): {
  app: WorkoutAppStore;
  request: ReturnType<typeof vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>>;
} {
  const request = vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>(async (path, options) => handler(path, options));
  const api: ApiClient = {
    request<T>(path: string, options?: RequestInit): Promise<T> {
      return request(path, options) as Promise<T>;
    },
    async response(): Promise<Response> {
      throw new Error("Unexpected raw response request");
    },
    idempotencyKey: () => "records-test-key",
  };
  const state = reactive<AppCoreState>({
    view: "progress",
    authEpoch: 0,
    loading: false,
    authRequired: false,
    authMessage: "",
    error: null,
    message: "",
    today: {
      date: "2026-08-29",
      timezone: "Asia/Shanghai",
      entry: null,
      session: null,
    },
    plan: {
      timezone: "Asia/Shanghai",
      first_effective_from: "2026-08-01",
      current: null,
      future: [],
    },
    progress: null,
    session: null,
  });
  const app: WorkoutAppStore = {
    state,
    api,
    bootstrap: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    setMessage: vi.fn(),
    setError: vi.fn(),
    clearError: vi.fn(),
  };
  return { app, request };
}

function activity(overrides: Partial<AerobicActivity> = {}): AerobicActivity {
  const activityRef = overrides.activity_ref ?? "coros-indoor-august";
  return {
    schema_version: 1,
    activity_ref: activityRef,
    source_ref: `coros:activity:${activityRef}`,
    local_date: "2026-08-29",
    timezone: "Asia/Shanghai",
    started_at: "2026-08-29T02:00:00.000Z",
    ended_at: "2026-08-29T02:35:00.000Z",
    sport_type: 101,
    sport_name: "indoor_run",
    source_status: "partial",
    data_as_of: "2026-08-29T23:59:00.000Z",
    updated_at: "2026-08-29T23:59:30.000Z",
    fit_status: "partial",
    route_key: null,
    route_direction: null,
    route_match_status: "ignored",
    summary: {
      duration_sec: 2100,
      distance_km: 5.25,
      average_heart_rate_bpm: 142,
      calories_kcal: null,
    },
    ...overrides,
  };
}

const activities: AerobicActivity[] = [
  activity(),
  activity({
    activity_ref: "coros-trail-august",
    local_date: "2026-08-23",
    started_at: "2026-08-23T01:00:00.000Z",
    sport_type: 102,
    sport_name: "trail_run",
    source_status: "complete",
    fit_status: "complete",
    route_key: "city-loop",
    route_direction: "reverse",
    route_match_status: "matched",
    summary: {
      duration_sec: 7200,
      distance_km: 12.23,
      average_heart_rate_bpm: 148,
      calories_kcal: 820,
    },
  }),
  activity({
    activity_ref: "coros-run-july",
    local_date: "2026-07-31",
    started_at: "2026-07-31T01:00:00.000Z",
    sport_type: 100,
    sport_name: "outdoor_run",
    source_status: "complete",
    fit_status: "complete",
    route_key: "river-loop",
    route_direction: "forward",
    route_match_status: "matched",
    summary: {
      duration_sec: 3600,
      distance_km: 8.5,
      average_heart_rate_bpm: 144,
      calories_kcal: 540,
    },
  }),
];

const routeHistoryActivity: RouteHistoryActivity = {
  activity_ref: activities[1].activity_ref,
  source_ref: activities[1].source_ref,
  local_date: activities[1].local_date,
  timezone: activities[1].timezone,
  started_at: activities[1].started_at,
  ended_at: activities[1].ended_at,
  sport_type: activities[1].sport_type,
  sport_name: activities[1].sport_name,
  route_key: "city-loop",
  route_direction: activities[1].route_direction,
  source_status: activities[1].source_status,
  sync_status: "complete",
  data_as_of: activities[1].data_as_of,
  summary: activities[1].summary,
};

const routes: RoutesListResponse = {
  schema_version: 1,
  generated_at: "2026-08-29T23:59:30.000Z",
  data_as_of: "2026-08-29T23:59:00.000Z",
  source_status: "complete",
  source_ref: "route-records",
  filters: { sport_type: null, limit: 200 },
  page: { limit: 200, next_cursor: null },
  items: [{
    route_key: "city-loop",
    route_name: "城市环线",
    sport_types: [102],
    distance_range_km: [11, 13.5],
    activity_count: 1,
    total_distance_km: 12.23,
    total_duration_sec: 7200,
    latest_activity: routeHistoryActivity,
  }],
};

const routeDetail: RouteDetailResponse = {
  schema_version: 1,
  generated_at: "2026-08-29T23:59:30.000Z",
  data_as_of: "2026-08-29T23:59:00.000Z",
  source_status: "complete",
  source_ref: "route:city-loop",
  ...routes.items![0],
  history: [routeHistoryActivity],
  history_period: { from: null, to: null },
  page: { limit: 200, next_cursor: null },
};

function overviewResponse(items: AerobicActivity[] = activities): RecordsOverviewResponse {
  return {
    schema_version: 1,
    generated_at: "2026-08-29T23:59:30.000Z",
    period: { from: "2026-08-01", to: "2026-08-29", timezone: "Asia/Shanghai" },
    source_statuses: { workout: "complete", coros: items.length ? "complete" : "none" },
    relation_policy: "same_local_date_context_only",
    workout: { source: "workout", session_count: items.length ? 2 : 0, table: {} },
    aerobic: {
      source: "coros",
      activity_count: items.length,
      source_status: items.length ? "complete" : "none",
    },
    days: items.map((item) => ({
      local_date: item.local_date,
      schedule_kind: "workout",
      workout_session_count: 0,
      workout_session_keys: [],
      aerobic_activity_count: 1,
      activity_refs: [item.activity_ref],
      aerobic_summary: { distance_km: item.summary.distance_km },
      relation_policy: "same_local_date_context_only",
    })),
  };
}

function aerobicListResponse(
  items: AerobicActivity[],
  filters: AerobicListResponse["filters"] = { from: null, to: null, sport_type: null, limit: 200 },
): AerobicListResponse {
  return {
    schema_version: 1,
    generated_at: "2026-08-29T23:59:30.000Z",
    data_as_of: "2026-08-29T23:59:00.000Z",
    timezone: "Asia/Shanghai",
    source_status: items.length ? "complete" : "none",
    source_statuses: { workout: "complete", coros: items.length ? "complete" : "none" },
    source_ref: "aerobic-records",
    filters,
    page: { limit: 200, next_cursor: null },
    items,
  };
}

function aerobicDetailResponse(item: AerobicActivity): AerobicDetailResponse {
  return {
    ...item,
    generated_at: "2026-08-29T23:59:30.000Z",
    source_statuses: { workout: "complete", coros: "complete" },
  };
}

function progressResponse(
  exercises: ProgressResponse["exercises"] = [],
): ProgressResponse {
  return {
    metric_semantics_version: 1,
    period: { from: "2026-08-01", to: "2026-08-29" },
    metrics: {
      completion_rate: { value: 0.75 },
      training_duration: { value_sec: 7200 },
      strength_training_days: { value: 2 },
      average_session_rpe: { value: 7, included_count: 2 },
    },
    current_streak: { value: 1 },
    exercises,
  };
}

function recordsHandler(path: string): unknown {
  if (path === "/api/private/records/overview") {
    return overviewResponse();
  }
  if (path.startsWith("/api/private/progress?")) {
    return progressResponse();
  }
  if (path.startsWith("/api/private/records/aerobic?")) {
    const url = new URL(path, "https://workout.example");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const items = activities.filter((item) => (
        (!from || (item.local_date ?? "") >= from)
        && (!to || (item.local_date ?? "") <= to)
      ));
    return aerobicListResponse(items, {
      from,
      to,
      sport_type: null,
      limit: 200,
    });
  }
  if (path.startsWith("/api/private/records/aerobic/")) {
    const ref = decodeURIComponent(path.slice("/api/private/records/aerobic/".length));
    const item = activities.find((candidate) => candidate.activity_ref === ref);
    return item ? aerobicDetailResponse(item) : null;
  }
  if (path === "/api/private/records/routes?limit=200") return routes;
  if (path === "/api/private/records/routes/city-loop?limit=200") return routeDetail;
  throw new Error(`Unexpected request: ${path}`);
}

function tabByName(wrapper: ReturnType<typeof mount>, label: string) {
  const tab = wrapper.findAll('[role="tab"]').find((candidate) => candidate.text() === label);
  if (!tab) throw new Error(`Missing tab: ${label}`);
  return tab;
}

describe("RecordsPage", () => {
  it.each([
    {
      label: "schema version",
      response: { ...overviewResponse(), schema_version: 2 },
      expectedPath: "overview.schema_version",
    },
    {
      label: "schedule kind",
      response: {
        ...overviewResponse(),
        days: [{ ...overviewResponse().days[0], schedule_kind: "holiday" }],
      },
      expectedPath: "overview.days[0].schedule_kind",
    },
  ])("fails closed on an invalid overview $label", async ({ response, expectedPath }) => {
    const { app } = createTestApp((path) => (
      path === "/api/private/records/overview" ? response : recordsHandler(path)
    ));
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    expect(wrapper.get(".error-card").text()).toContain(expectedPath);
    expect(wrapper.find('button[aria-label="查看力量记录"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("rejects an unknown route direction before rendering the aerobic list", async () => {
    const validList = aerobicListResponse([activity({ route_key: "city-loop" })]);
    const invalidList = {
      ...validList,
      items: [{ ...validList.items[0], route_direction: "sideways" }],
    };
    const { app } = createTestApp((path) => {
      if (path.startsWith("/api/private/records/aerobic?")) return invalidList;
      return recordsHandler(path);
    });
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();

    expect(wrapper.get(".error-card").text()).toContain("route_direction");
    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(0);

    wrapper.unmount();
  });

  it("drops raw FIT and GPS sentinel fields from list and detail rendering", async () => {
    const sensitive = activity();
    const list = aerobicListResponse([sensitive]);
    const detailResponse = aerobicDetailResponse(sensitive);
    const withSensitiveFields = (value: object) => ({
      ...value,
      raw_fit: "RAW-FIT-SENTINEL",
      gps: [{ lat: "GPS-LAT-SENTINEL", lon: 121.5 }],
    });
    const { app } = createTestApp((path) => {
      if (path.startsWith("/api/private/records/aerobic?")) {
        return { ...list, items: list.items.map(withSensitiveFields) };
      }
      if (path === `/api/private/records/aerobic/${sensitive.activity_ref}`) {
        return withSensitiveFields(detailResponse);
      }
      return recordsHandler(path);
    });
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("RAW-FIT-SENTINEL");
    expect(wrapper.text()).not.toContain("GPS-LAT-SENTINEL");

    await wrapper.get(`[data-activity-ref="${sensitive.activity_ref}"]`).trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("活动详情");
    expect(wrapper.text()).not.toContain("RAW-FIT-SENTINEL");
    expect(wrapper.text()).not.toContain("GPS-LAT-SENTINEL");

    wrapper.unmount();
  });

  it.each([
    {
      label: "metric semantics version",
      response: { ...progressResponse(), metric_semantics_version: 2 },
    },
    {
      label: "null exercise row",
      response: { ...progressResponse(), exercises: [null] },
    },
  ])("fails closed on an invalid progress $label", async ({ response }) => {
    const { app } = createTestApp((path) => {
      if (path.startsWith("/api/private/progress?")) return response;
      return recordsHandler(path);
    });
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    await tabByName(wrapper, "力量").trigger("click");
    await flushPromises();

    expect(wrapper.get(".error-card").text()).toContain("训练进展响应格式无效");
    expect(wrapper.findAll("[data-exercise]")).toHaveLength(0);

    wrapper.unmount();
  });

  it("does not reopen a late exercise detail after the athlete changes tabs", async () => {
    const exerciseGate = deferred<ExerciseDetailResponse>();
    const exercise = {
      exercise_key: "goblet-squat",
      current_name: "高脚杯深蹲",
      performed_session_count: 3,
    };
    const { app, request } = createTestApp((path) => {
      if (path.startsWith("/api/private/progress?")) return progressResponse([exercise]);
      if (path === "/api/private/exercises/goblet-squat?preset=12w") return exerciseGate.promise;
      return recordsHandler(path);
    });
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    await tabByName(wrapper, "力量").trigger("click");
    await flushPromises();
    await wrapper.get('[data-exercise="goblet-squat"]').trigger("click");
    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();

    exerciseGate.resolve({ ...exercise, observations: [] });
    await flushPromises();

    expect(tabByName(wrapper, "有氧").attributes("aria-selected")).toBe("true");
    expect(wrapper.find('[data-action="close-exercise"]').exists()).toBe(false);
    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(3);
    expect(request.mock.calls.filter(([path]) => path.includes("/api/private/exercises/"))).toHaveLength(1);

    wrapper.unmount();
  });

  it.each(["open activity detail", "show another date"])(
    "discards a late route-list rejection after %s",
    async (action) => {
      const routesGate = deferred<RoutesListResponse>();
      const { app } = createTestApp((path) => {
        if (path === "/api/private/records/routes?limit=200") return routesGate.promise;
        return recordsHandler(path);
      });
      const wrapper = mount(RecordsPage, { props: { app } });
      await flushPromises();
      await tabByName(wrapper, "有氧").trigger("click");
      await flushPromises();

      await wrapper.get('[data-action="routes-open"]').trigger("click");
      if (action === "open activity detail") {
        await wrapper.get('[data-activity-ref="coros-indoor-august"]').trigger("click");
        await flushPromises();
      } else {
        const exposed = wrapper.vm as unknown as { showAerobicDate(date: string): Promise<void> };
        await exposed.showAerobicDate("2026-08-29");
      }
      routesGate.reject(new Error("stale route failure"));
      await flushPromises();

      expect(wrapper.find('[aria-label="路线浏览"]').exists()).toBe(false);
      expect(wrapper.find(".error-card").exists()).toBe(false);
      if (action === "open activity detail") {
        expect(wrapper.text()).toContain("活动详情");
        await wrapper.get('[data-action="aerobic-back"]').trigger("click");
        expect(wrapper.find(".error-card").exists()).toBe(false);
        expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(3);
      } else {
        expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(1);
      }

      wrapper.unmount();
    },
  );

  it("retains the date and route stack across a same-auth remount and today refresh", async () => {
    const { app, request } = createTestApp(recordsHandler);
    let wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    const exposed = wrapper.vm as unknown as { showAerobicDate(date: string): Promise<void> };
    await exposed.showAerobicDate("2026-08-29");
    await flushPromises();
    await wrapper.get('[data-action="routes-open"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('aside[aria-label="路线浏览"]')
      .get('[data-action="route-detail"][data-route-key="city-loop"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.get('aside[aria-label="路线浏览"]').text()).toContain("历史活动");

    const requestCount = request.mock.calls.length;
    wrapper.unmount();
    app.state.today = app.state.today ? { ...app.state.today } : null;
    wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    expect(request).toHaveBeenCalledTimes(requestCount);
    expect(wrapper.get('aside[aria-label="路线浏览"]').text()).toContain("历史活动");
    await wrapper
      .get('aside[aria-label="路线浏览"]')
      .get('[data-action="route-detail-back"]')
      .trigger("click");
    await wrapper
      .get('aside[aria-label="路线浏览"]')
      .get('[data-action="routes-close"]')
      .trigger("click");

    expect(tabByName(wrapper, "有氧").attributes("aria-selected")).toBe("true");
    expect(wrapper.text()).toContain("日期：2026-08-29");
    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(1);

    wrapper.unmount();
  });

  it("resets on auth epoch change and ignores the previous epoch overview response", async () => {
    const oldOverview = deferred<RecordsOverviewResponse>();
    let overviewReads = 0;
    const { app, request } = createTestApp((path) => {
      if (path === "/api/private/records/overview") {
        overviewReads += 1;
        return overviewReads === 1 ? oldOverview.promise : overviewResponse([]);
      }
      return recordsHandler(path);
    });
    const wrapper = mount(RecordsPage, { props: { app } });
    await wrapper.vm.$nextTick();
    expect(request.mock.calls.filter(([path]) => path === "/api/private/records/overview")).toHaveLength(1);

    app.state.authEpoch += 1;
    await flushPromises();

    expect(request.mock.calls.filter(([path]) => path === "/api/private/records/overview")).toHaveLength(2);
    expect(wrapper.get('button[aria-label="查看力量记录"]').text()).toContain("0");
    expect(wrapper.get('button[aria-label="查看有氧记录"]').text()).toContain("0");

    oldOverview.resolve(overviewResponse());
    await flushPromises();

    expect(wrapper.get('button[aria-label="查看力量记录"]').text()).toContain("0");
    expect(wrapper.get('button[aria-label="查看有氧记录"]').text()).toContain("0");

    wrapper.unmount();
  });

  it("opens on the three-tab overview and keeps the Records navigation when entering strength", async () => {
    const { app } = createTestApp(recordsHandler);
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    const overviewTabs = wrapper.get('[aria-label="训练记录类型"]');
    expect(overviewTabs.findAll('[role="tab"]')).toHaveLength(3);
    expect(overviewTabs.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(["总览", "力量", "有氧"]);
    expect(wrapper.get("h1").text()).toBe("总览");
    expect(wrapper.get('button[aria-label="查看力量记录"]').text()).toContain("力量 Session");
    expect(wrapper.get('button[aria-label="查看有氧记录"]').text()).toContain("有氧活动");

    await wrapper.get('button[aria-label="查看力量记录"]').trigger("click");
    await flushPromises();

    const strengthTabs = wrapper.get('[aria-label="训练记录类型"]');
    expect(strengthTabs.findAll('[role="tab"]')).toHaveLength(3);
    expect(tabByName(wrapper, "力量").attributes("aria-selected")).toBe("true");
    expect(wrapper.get("h1").text()).toBe("力量");
    expect(wrapper.text()).not.toMatch(/12 个到期训练|只计已结束区间|按日期计一次/);
    expect(wrapper.text()).not.toMatch(/Workout source|COROS source|不会因为 local date 相同而被判定为同一训练事件/);

    wrapper.unmount();
  });

  it("shows an explicit empty state when the aerobic projection has no activities", async () => {
    const emptyHandler: RequestHandler = (path) => {
      if (path === "/api/private/records/overview") {
        return overviewResponse([]);
      }
      if (path.startsWith("/api/private/records/aerobic?")) {
        return aerobicListResponse([]);
      }
      return recordsHandler(path);
    };
    const { app } = createTestApp(emptyHandler);
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();

    expect(wrapper.get('[aria-label="有氧活动列表"]').text()).toContain("还没有有氧记录");
    expect(wrapper.get('[aria-label="有氧活动列表"]').text()).toContain("暂无有氧记录");
    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(0);

    wrapper.unmount();
  });

  it("filters an already-loaded aerobic list by month and sport without issuing another request", async () => {
    const { app, request } = createTestApp(recordsHandler);
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();

    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(3);
    const aerobicRequestsBeforeFiltering = request.mock.calls.filter(([path]) => path.startsWith("/api/private/records/aerobic?")).length;

    await wrapper.get('select[aria-label="月份"]').setValue("2026-08");
    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("2026-07-31 · 户外跑");

    await wrapper.get('select[aria-label="运动"]').setValue("101");
    const filteredCards = wrapper.findAll(".aerobic-activity-card");
    expect(filteredCards).toHaveLength(1);
    expect(filteredCards[0].text()).toContain("2026-08-29 · 室内运动");
    expect(request.mock.calls.filter(([path]) => path.startsWith("/api/private/records/aerobic?")).length).toBe(aerobicRequestsBeforeFiltering);

    wrapper.unmount();
  });

  it("opens one Calendar date, resets local filters, and renders a safe indoor activity detail", async () => {
    const { app, request } = createTestApp(recordsHandler);
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();
    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();

    await wrapper.get('select[aria-label="月份"]').setValue("2026-07");
    await wrapper.get('select[aria-label="运动"]').setValue("100");

    const exposed = wrapper.vm as unknown as { showAerobicDate(date: string): Promise<void> };
    await exposed.showAerobicDate("2026-08-29");
    await flushPromises();

    expect(request).toHaveBeenCalledWith(
      "/api/private/records/aerobic?limit=200&from=2026-08-29&to=2026-08-29",
      undefined,
    );
    expect(wrapper.get('select[aria-label="月份"]').element).toHaveProperty("value", "all");
    expect(wrapper.get('select[aria-label="运动"]').element).toHaveProperty("value", "all");
    expect(wrapper.text()).toContain("日期：2026-08-29");
    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(1);

    await wrapper.get('[data-activity-ref="coros-indoor-august"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("活动详情");
    expect(wrapper.text()).toContain("室内运动 · 无路线");
    expect(wrapper.text()).toContain("活动时间");
    expect(wrapper.text()).toContain("FIT");
    expect(wrapper.find('[aria-label="训练记录类型"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("opens the route index and history, then returns through the index to the aerobic list", async () => {
    const { app, request } = createTestApp(recordsHandler);
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();
    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();

    await wrapper.get('[data-action="routes-open"]').trigger("click");
    await flushPromises();

    expect(request).toHaveBeenCalledWith("/api/private/records/routes?limit=200", undefined);
    expect(wrapper.find('[aria-label="训练记录类型"]').exists()).toBe(false);
    let routeSidebar = wrapper.get('aside[aria-label="路线浏览"]');
    expect(routeSidebar.text()).toContain("城市环线");

    await routeSidebar.get('[data-action="route-detail"][data-route-key="city-loop"]').trigger("click");
    await flushPromises();

    expect(request).toHaveBeenCalledWith("/api/private/records/routes/city-loop?limit=200", undefined);
    expect(wrapper.find('[aria-label="训练记录类型"]').exists()).toBe(false);
    routeSidebar = wrapper.get('aside[aria-label="路线浏览"]');
    expect(routeSidebar.text()).toContain("历史活动");
    expect(routeSidebar.text()).toContain("累计距离");

    await routeSidebar.get('[data-action="route-detail-back"]').trigger("click");
    routeSidebar = wrapper.get('aside[aria-label="路线浏览"]');
    expect(routeSidebar.text()).toContain("城市环线");
    expect(routeSidebar.text()).not.toContain("历史活动");
    expect(wrapper.find('[aria-label="训练记录类型"]').exists()).toBe(false);

    await routeSidebar.get('[data-action="routes-close"]').trigger("click");
    expect(wrapper.find('[aria-label="路线浏览"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="训练记录类型"]').findAll('[role="tab"]')).toHaveLength(3);
    expect(wrapper.findAll(".aerobic-activity-card")).toHaveLength(3);

    wrapper.unmount();
  });

  it("returns from route history to the activity detail that opened it", async () => {
    const { app, request } = createTestApp(recordsHandler);
    const wrapper = mount(RecordsPage, { props: { app } });
    await flushPromises();
    await tabByName(wrapper, "有氧").trigger("click");
    await flushPromises();

    await wrapper.get('[data-activity-ref="coros-trail-august"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("活动详情");

    await wrapper.get('[data-action="route-detail"][data-route-key="city-loop"]').trigger("click");
    await flushPromises();

    expect(request).toHaveBeenCalledWith("/api/private/records/routes/city-loop?limit=200", undefined);
    expect(wrapper.text()).toContain("历史活动");
    expect(wrapper.text()).toContain("累计距离");
    const backButtons = wrapper.findAll('[data-action="route-detail-back"]');
    expect(backButtons.length).toBeGreaterThan(0);
    expect(backButtons[0].text()).toBe("← 返回活动详情");

    await backButtons[0].trigger("click");
    expect(wrapper.text()).toContain("活动详情");
    expect(wrapper.text()).toContain("city-loop");
    expect(wrapper.find('[aria-label="路线浏览"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
