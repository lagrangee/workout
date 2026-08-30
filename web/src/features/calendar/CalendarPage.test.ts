import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

import App from "../../App.vue";
import type {
  ApiClient,
  AppCoreState,
  WorkoutAppStore,
  WorkoutView,
} from "../../core/contracts";
import type {
  AerobicActivity,
  AerobicListResponse,
  RecordsOverviewResponse,
} from "../records/records-types";
import CalendarPage from "./CalendarPage.vue";

type RequestHandler = (path: string, options?: RequestInit) => unknown | Promise<unknown>;

function createTestApp(handler: RequestHandler, view: WorkoutView = "calendar"): {
  app: WorkoutAppStore;
  request: ReturnType<typeof vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>>;
  refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  const request = vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>(async (path, options) => handler(path, options));
  const refresh = vi.fn<() => Promise<void>>(async () => {});
  const api: ApiClient = {
    request<T>(path: string, options?: RequestInit): Promise<T> {
      return request(path, options) as Promise<T>;
    },
    async response(): Promise<Response> {
      throw new Error("Unexpected raw response request");
    },
    idempotencyKey: () => "calendar-test-key",
  };
  const state = reactive<AppCoreState>({
    view,
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
      first_effective_from: "2026-08-20",
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
    refresh,
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    setMessage: vi.fn(),
    setError: vi.fn(),
    clearError: vi.fn(),
  };
  return { app, request, refresh };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekday(date: string): string {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    [new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function noPlanEntry(date: string): Record<string, unknown> {
  return {
    date,
    weekday: weekday(date),
    kind: "no_plan",
    title: null,
    module_count: null,
    estimated_duration_min: null,
    session_key: null,
    aerobic_summary: {
      activity_count: 0,
      distance_km: null,
      duration_sec: null,
      source_status: "none",
    },
  };
}

const targetDate = "2026-08-29";
const targetActivity: AerobicActivity = {
  schema_version: 1,
  activity_ref: "coros-calendar-target",
  source_ref: "coros:activity:coros-calendar-target",
  local_date: targetDate,
  timezone: "Asia/Shanghai",
  started_at: `${targetDate}T02:00:00.000Z`,
  ended_at: `${targetDate}T02:35:00.000Z`,
  sport_type: 101,
  sport_name: "indoor_run",
  source_status: "complete",
  data_as_of: `${targetDate}T23:59:00.000Z`,
  updated_at: `${targetDate}T23:59:30.000Z`,
  fit_status: "complete",
  route_key: null,
  route_direction: null,
  route_match_status: "ignored",
  summary: {
    duration_sec: 2100,
    distance_km: 5.25,
    average_heart_rate_bpm: 142,
    calories_kcal: null,
  },
};

const restDayWithAerobic = {
  date: targetDate,
  weekday: weekday(targetDate),
  kind: "rest",
  title: null,
  module_count: null,
  estimated_duration_min: null,
  session_key: null,
  aerobic_summary: {
    activity_count: 1,
    distance_km: 5.25,
    duration_sec: 2100,
    source_status: "complete",
  },
};

function calendarHandler(
  selectedEntry: Record<string, unknown> = restDayWithAerobic,
  includeRecords = false,
): RequestHandler {
  return (path) => {
    if (path.startsWith("/api/private/schedule?")) {
      const url = new URL(path, "https://workout.example");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!from || !to) throw new Error(`Calendar request is missing a range: ${path}`);
      const expanded = url.searchParams.get("expand") === "prescription";
      const entryFor = (date: string): Record<string, unknown> => {
        if (date !== targetDate) return noPlanEntry(date);
        if (expanded) return selectedEntry;
        const { prescription: _prescription, ...summary } = selectedEntry;
        return summary;
      };
      if (from === to) return { entries: [entryFor(from)] };
      const entries: Array<Record<string, unknown>> = [];
      for (let date = from; date <= to; date = addDays(date, 1)) entries.push(entryFor(date));
      return { entries };
    }
    if (path.startsWith("/api/private/sessions?")) return { items: [] };
    if (includeRecords && path === "/api/private/records/overview") {
      const response: RecordsOverviewResponse = {
        schema_version: 1,
        generated_at: `${targetDate}T23:59:30.000Z`,
        period: { from: "2026-08-01", to: targetDate, timezone: "Asia/Shanghai" },
        source_statuses: { workout: "none", coros: "complete" },
        relation_policy: "same_local_date_context_only",
        workout: { source: "workout", session_count: 0, table: {} },
        aerobic: { source: "coros", activity_count: 1, source_status: "complete" },
        days: [{
          local_date: targetDate,
          schedule_kind: "rest",
          workout_session_count: 0,
          workout_session_keys: [],
          aerobic_activity_count: 1,
          activity_refs: [targetActivity.activity_ref],
          aerobic_summary: { distance_km: 5.25, duration_sec: 2100 },
          relation_policy: "same_local_date_context_only",
        }],
      };
      return response;
    }
    if (includeRecords && path === `/api/private/records/aerobic?limit=200&from=${targetDate}&to=${targetDate}`) {
      const response: AerobicListResponse = {
        schema_version: 1,
        generated_at: `${targetDate}T23:59:30.000Z`,
        data_as_of: `${targetDate}T23:59:00.000Z`,
        timezone: "Asia/Shanghai",
        source_status: "complete",
        source_statuses: { workout: "none", coros: "complete" },
        source_ref: "aerobic-records",
        filters: { from: targetDate, to: targetDate, sport_type: null, limit: 200 },
        page: { limit: 200, next_cursor: null },
        items: [targetActivity],
      };
      return response;
    }
    throw new Error(`Unexpected request: ${path}`);
  };
}

const secondSessionDate = "2026-08-28";

function correctionSession(
  sessionKey: string,
  date: string,
  actualValue: number,
  note: string,
  title: string,
) {
  const snapshot = {
    schema_version: 2,
    title,
    blocks: [{
      title: "力量",
      exercises: [{
        exercise_occurrence_key: "squat",
        name: "深蹲",
        execution_mode: "none",
        sets: [{
          set_id: "set-1",
          target: { metric: "reps", value: 8 },
          resistance_mode: "external_load",
          resistance_kg: 40,
        }],
      }],
    }],
    completion_items: [{
      completion_item_key: "shared-item",
      exercise_occurrence_key: "squat",
      set_id: "set-1",
      target: { metric: "reps", value: 8 },
      resistance_mode: "external_load",
      resistance_kg: 40,
    }],
  };
  return {
    session_key: sessionKey,
    scheduled_date: date,
    status: "completed",
    snapshot,
    completion_results: [{
      completion_item_key: "shared-item",
      status: "completed",
      actual: { metric: "reps", value: actualValue },
      resistance: { mode: "external_load", value: 40, unit: "kg" },
      rir: 2,
      note: null,
      completed_at: `${date}T02:30:00.000Z`,
    }],
    completion_fraction: 1,
    training_intervals: [{
      started_at: `${date}T02:00:00.000Z`,
      ended_at: `${date}T02:30:00.000Z`,
    }],
    session_rpe: 7,
    note,
    skip_reason: null,
    exercise_feedback: [{ exercise_occurrence_key: "squat", text: `feedback-${sessionKey}` }],
    updated_at: `${date}T02:30:00.000Z`,
  };
}

type CorrectionSessionFixture = ReturnType<typeof correctionSession>;

interface CorrectionWrite {
  sessionKey: string;
  body: Record<string, unknown>;
}

interface CorrectionHarness {
  handler: RequestHandler;
  details: Record<string, CorrectionSessionFixture>;
  writes: CorrectionWrite[];
  onPut: ((write: CorrectionWrite) => unknown | Promise<unknown>) | null;
  onDetail: ((sessionKey: string, requestNumber: number) => unknown | Promise<unknown>) | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}

function createCorrectionHarness(): CorrectionHarness {
  const details = {
    "session-a": correctionSession("session-a", targetDate, 8, "server-a", "Session A"),
    "session-b": correctionSession("session-b", secondSessionDate, 22, "server-b", "Session B"),
  };
  let detailRequests = 0;
  const harness: CorrectionHarness = {
    details,
    writes: [],
    onPut: null,
    onDetail: null,
    handler: async (path, options) => {
      if (path.startsWith("/api/private/schedule?")) {
        const url = new URL(path, "https://workout.example");
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        if (!from || !to) throw new Error(`Calendar request is missing a range: ${path}`);
        const expanded = url.searchParams.get("expand") === "prescription";
        const entryFor = (date: string): Record<string, unknown> => {
          const detail = date === targetDate
            ? harness.details["session-a"]
            : date === secondSessionDate
              ? harness.details["session-b"]
              : null;
          if (!detail) return noPlanEntry(date);
          return {
            date,
            weekday: weekday(date),
            kind: "workout",
            title: detail.snapshot.title,
            module_count: 1,
            estimated_duration_min: 30,
            session_key: detail.session_key,
            aerobic_summary: {
              activity_count: 0,
              distance_km: null,
              duration_sec: null,
              source_status: "none",
            },
            ...(expanded ? { prescription: cloneFixture(detail.snapshot) } : {}),
          };
        };
        if (from === to) return { entries: [entryFor(from)] };
        const entries: Array<Record<string, unknown>> = [];
        for (let date = from; date <= to; date = addDays(date, 1)) entries.push(entryFor(date));
        return { entries };
      }
      if (path.startsWith("/api/private/sessions?") && options?.method !== "PUT") {
        return {
          items: Object.values(harness.details).map((detail) => ({
            session_key: detail.session_key,
            scheduled_date: detail.scheduled_date,
            status: detail.status,
          })),
        };
      }
      const correctionMatch = path.match(/^\/api\/private\/sessions\/([^/]+)\/record$/);
      if (correctionMatch && options?.method === "PUT") {
        if (typeof options.body !== "string") throw new Error("Correction request body must be JSON text");
        const parsed: unknown = JSON.parse(options.body);
        if (!isRecord(parsed)) throw new Error("Correction request body must be a JSON object");
        const write = { sessionKey: correctionMatch[1], body: parsed };
        harness.writes.push(write);
        return harness.onPut ? await harness.onPut(write) : cloneFixture(harness.details[write.sessionKey]);
      }
      const sessionMatch = path.match(/^\/api\/private\/sessions\/([^/]+)$/);
      if (sessionMatch) {
        detailRequests += 1;
        if (harness.onDetail) return await harness.onDetail(sessionMatch[1], detailRequests);
        const detail = harness.details[sessionMatch[1]];
        if (!detail) throw new Error(`Unknown session: ${sessionMatch[1]}`);
        return cloneFixture(detail);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  return harness;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openCorrection(wrapper: ReturnType<typeof mount>): Promise<void> {
  const button = wrapper.find('[data-action="calendar-correct"]');
  if (button.exists()) {
    await button.trigger("click");
    await nextTick();
  }
}

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

describe("CalendarPage", () => {
  it("shows when a workout was moved from another date", async () => {
    const movedWorkout = {
      date: targetDate,
      weekday: weekday(targetDate),
      kind: "workout",
      title: "下肢力量与下坡耐受",
      module_count: 2,
      estimated_duration_min: 60,
      session_key: null,
      is_overdue_unstarted: false,
      moved_from_date: "2026-08-28",
      aerobic_summary: { activity_count: 0, distance_km: null, duration_sec: null, source_status: "none" },
      prescription: { blocks: [] },
    };
    const { app } = createTestApp(calendarHandler(movedWorkout));
    const wrapper = mount(CalendarPage, { props: { app } });
    await settle();

    expect(wrapper.text()).toContain("从 2026-08-28 调整");
  });

  it("navigates by exact seven-day ranges and keeps the selected weekday", async () => {
    const { app, request } = createTestApp(calendarHandler());
    const wrapper = mount(CalendarPage, { props: { app } });
    await settle();

    expect(wrapper.text()).toContain("2026-08-24 – 2026-08-30");
    expect(wrapper.findAll('[data-action="calendar-select"]')).toHaveLength(7);

    await wrapper.get('[data-action="calendar-next"]').trigger("click");
    await settle();

    expect(wrapper.text()).toContain("2026-08-31 – 2026-09-06");
    expect(request).toHaveBeenCalledWith(
      "/api/private/schedule?from=2026-08-31&to=2026-09-06&include=aerobic_summary",
      undefined,
    );
    expect(request).toHaveBeenCalledWith(
      "/api/private/schedule?from=2026-09-05&to=2026-09-05&expand=prescription&include=aerobic_summary",
      undefined,
    );

    await wrapper.get('[data-action="calendar-previous"]').trigger("click");
    await settle();
    expect(wrapper.text()).toContain("2026-08-24 – 2026-08-30");

    wrapper.unmount();
  });

  it("retains the complete correction draft and editor mode across Calendar remounts", async () => {
    const harness = createCorrectionHarness();
    const { app } = createTestApp(harness.handler);
    let wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    await openCorrection(wrapper);

    await wrapper.get<HTMLInputElement>("#correction-value-shared-item").setValue("11");
    await wrapper.get<HTMLInputElement>("#correction-weight-shared-item").setValue("47.5");
    await wrapper.get<HTMLInputElement>("#correction-rir-shared-item").setValue("0");
    await wrapper.get<HTMLInputElement>("#correction-rpe").setValue("0");
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("draft-a-sentinel");
    await wrapper.get<HTMLInputElement>("#correction-feedback-squat").setValue("draft-feedback-a");

    wrapper.unmount();
    wrapper = mount(CalendarPage, { props: { app } });
    await settle();

    expect(wrapper.find('[data-action="save-correction"]').exists()).toBe(true);
    expect(wrapper.get<HTMLInputElement>("#correction-value-shared-item").element.value).toBe("11");
    expect(wrapper.get<HTMLInputElement>("#correction-weight-shared-item").element.value).toBe("47.5");
    expect(wrapper.get<HTMLInputElement>("#correction-rir-shared-item").element.value).toBe("0");
    expect(wrapper.get<HTMLInputElement>("#correction-rpe").element.value).toBe("0");
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("draft-a-sentinel");
    expect(wrapper.get<HTMLInputElement>("#correction-feedback-squat").element.value).toBe("draft-feedback-a");

    wrapper.unmount();
  });

  it("clears a retained correction only after explicit cancellation", async () => {
    const harness = createCorrectionHarness();
    const { app } = createTestApp(harness.handler);
    let wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    await openCorrection(wrapper);
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("cancelled-draft");

    await wrapper.get('[data-action="cancel-correction"]').trigger("click");
    expect(wrapper.find('[data-action="calendar-correct"]').exists()).toBe(true);
    wrapper.unmount();

    wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    expect(wrapper.find('[data-action="calendar-correct"]').exists()).toBe(true);
    await openCorrection(wrapper);
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("server-a");
    expect(wrapper.text()).not.toContain("cancelled-draft");

    wrapper.unmount();
  });

  it("clears the saved Session draft and reloads canonical server values", async () => {
    const harness = createCorrectionHarness();
    harness.onPut = ({ sessionKey }) => {
      const updated = correctionSession(sessionKey, targetDate, 12, "server-after-save", "Session A");
      harness.details[sessionKey] = updated;
      return cloneFixture(updated);
    };
    const { app } = createTestApp(harness.handler);
    let wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    await openCorrection(wrapper);
    await wrapper.get<HTMLInputElement>("#correction-value-shared-item").setValue("12");
    await wrapper.get<HTMLInputElement>("#correction-rir-shared-item").setValue("0");
    await wrapper.get<HTMLInputElement>("#correction-rpe").setValue("0");
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("draft-before-save");

    await wrapper.get('[data-action="save-correction"]').trigger("click");
    await settle();

    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]?.sessionKey).toBe("session-a");
    expect(harness.writes[0]?.body).toMatchObject({
      record_schema_version: 2,
      session_rpe: 0,
      note: "draft-before-save",
      set_results: [{
        completion_item_key: "shared-item",
        actual: { metric: "reps", value: 12 },
        rir: 0,
      }],
    });
    expect(wrapper.find('[data-action="calendar-correct"]').exists()).toBe(true);
    wrapper.unmount();

    wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    expect(wrapper.find('[data-action="save-correction"]').exists()).toBe(false);
    await openCorrection(wrapper);
    expect(wrapper.get<HTMLInputElement>("#correction-value-shared-item").element.value).toBe("12");
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("server-after-save");
    expect(wrapper.text()).not.toContain("draft-before-save");

    wrapper.unmount();
  });

  it("retains an unsaved draft when correction persistence fails", async () => {
    const harness = createCorrectionHarness();
    harness.onPut = async () => {
      throw new Error("correction write failed");
    };
    const { app } = createTestApp(harness.handler);
    let wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    await openCorrection(wrapper);
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("retry-after-failure");

    await wrapper.get('[data-action="save-correction"]').trigger("click");
    await settle();
    expect(app.setError).toHaveBeenCalledWith(expect.objectContaining({ message: "correction write failed" }));
    wrapper.unmount();

    wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("retry-after-failure");

    wrapper.unmount();
  });

  it("isolates retained corrections by session_key and authEpoch", async () => {
    const harness = createCorrectionHarness();
    const { app } = createTestApp(harness.handler);
    let wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    await openCorrection(wrapper);
    await wrapper.get<HTMLInputElement>("#correction-value-shared-item").setValue("91");
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("private-a");

    await wrapper.get(`[data-action="calendar-select"][data-date="${secondSessionDate}"]`).trigger("click");
    await settle();
    await openCorrection(wrapper);
    expect(wrapper.get<HTMLInputElement>("#correction-value-shared-item").element.value).toBe("22");
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("server-b");
    await wrapper.get<HTMLInputElement>("#correction-value-shared-item").setValue("82");
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("private-b");

    await wrapper.get(`[data-action="calendar-select"][data-date="${targetDate}"]`).trigger("click");
    await settle();
    expect(wrapper.get<HTMLInputElement>("#correction-value-shared-item").element.value).toBe("91");
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("private-a");
    wrapper.unmount();

    harness.details["session-a"] = correctionSession("session-a", targetDate, 3, "new-athlete-a", "New Athlete A");
    harness.details["session-b"] = correctionSession("session-b", secondSessionDate, 4, "new-athlete-b", "New Athlete B");
    app.state.authEpoch += 1;
    wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    expect(wrapper.find('[data-action="save-correction"]').exists()).toBe(false);
    await openCorrection(wrapper);
    expect(wrapper.get<HTMLInputElement>("#correction-value-shared-item").element.value).toBe("3");
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("new-athlete-a");
    expect(wrapper.text()).not.toContain("private-a");
    expect(wrapper.text()).not.toContain("private-b");

    wrapper.unmount();
  });

  it("does not let a previous instance's late save clear a newer draft", async () => {
    const harness = createCorrectionHarness();
    const lateSave = deferred<CorrectionSessionFixture>();
    harness.onPut = () => lateSave.promise;
    const { app } = createTestApp(harness.handler);
    let wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    await openCorrection(wrapper);
    await wrapper.get<HTMLInputElement>("#correction-value-shared-item").setValue("11");
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("first-instance-draft");
    await wrapper.get('[data-action="save-correction"]').trigger("click");
    await nextTick();
    expect(harness.writes).toHaveLength(1);
    wrapper.unmount();

    wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("first-instance-draft");
    await wrapper.get<HTMLInputElement>("#correction-value-shared-item").setValue("77");
    await wrapper.get<HTMLTextAreaElement>("#correction-note").setValue("newer-instance-draft");

    lateSave.resolve(cloneFixture(harness.details["session-a"]));
    await settle();
    expect(wrapper.get<HTMLInputElement>("#correction-value-shared-item").element.value).toBe("77");
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("newer-instance-draft");
    expect(app.setError).not.toHaveBeenCalled();
    wrapper.unmount();

    wrapper = mount(CalendarPage, { props: { app } });
    await settle();
    expect(wrapper.get<HTMLInputElement>("#correction-value-shared-item").element.value).toBe("77");
    expect(wrapper.get<HTMLTextAreaElement>("#correction-note").element.value).toBe("newer-instance-draft");

    wrapper.unmount();
  });

  it("bridges a compact Calendar summary into one date-scoped Records list", async () => {
    const { app, request } = createTestApp(calendarHandler(restDayWithAerobic, true));
    const wrapper = mount(App, { props: { app } });
    await settle();

    expect(wrapper.text()).toContain("有氧摘要");
    expect(wrapper.text()).toContain("1 次活动 · 5.25 km · 35 分钟");
    expect(wrapper.text()).not.toContain(targetActivity.activity_ref);
    expect(request.mock.calls.some(([path]) => path.startsWith("/api/private/records/aerobic?"))).toBe(false);

    await wrapper.get(`[data-action="open-aerobic-date"][data-date="${targetDate}"]`).trigger("click");
    await settle();

    expect(app.state.view).toBe("progress");
    expect(request.mock.calls.filter(([path]) => path.startsWith("/api/private/records/aerobic?")).map(([path]) => path)).toEqual([
      `/api/private/records/aerobic?limit=200&from=${targetDate}&to=${targetDate}`,
    ]);
    expect(wrapper.text()).toContain(`日期：${targetDate}`);
    expect(wrapper.text()).toContain(`${targetDate} · 室内运动`);
    const recordsNavigation = wrapper.findAll(".nav-link").find((button) => button.text() === "记录");
    expect(recordsNavigation?.attributes("aria-current")).toBe("page");

    wrapper.unmount();
  });

  it("shows recorded COROS evidence without duplicating a Workout prescription", async () => {
    const recordingIntent = {
      schema_version: 1,
      source: "coros",
      sport_type: 102,
      route_key: "香山鸡腿线",
    };
    const recordedEntry = {
      date: targetDate,
      weekday: weekday(targetDate),
      kind: "workout",
      title: "香山鸡腿线",
      module_count: 1,
      estimated_duration_min: 150,
      session_key: null,
      recording_intent: recordingIntent,
      recording_evidence: {
        status: "recorded",
      },
      aerobic_summary: {
        activity_count: 1,
        distance_km: 18,
        duration_sec: 9000,
        source_status: "complete",
      },
      prescription: {
        schema_version: 1,
        title: "香山鸡腿线",
        recording_intent: recordingIntent,
        blocks: [{
          title: "越野专项",
          exercises: [{
            occurrence_key: "trail-run",
            name: "越野跑与爬升快走",
            execution_mode: "none",
            sets: [{
              set_id: "trail-run-1",
              target: { metric: "duration_sec", value: 9000 },
              resistance_mode: "bodyweight",
              resistance_kg: null,
            }],
          }],
        }],
      },
    };
    const { app } = createTestApp(calendarHandler(recordedEntry));
    const wrapper = mount(CalendarPage, { props: { app } });
    await settle();

    expect(wrapper.get('[aria-label="COROS 路线记录状态"]').text()).toContain("COROS 记录");
    expect(wrapper.get('[aria-label="COROS 路线记录状态"]').text()).toContain("已记录");
    expect(wrapper.find(".calendar-prescription").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("开始训练");
    expect(wrapper.text()).not.toContain("跳过今天");

    wrapper.unmount();
  });

  it("normalizes expired Sessions once and reloads the active week", async () => {
    let normalized = false;
    const baseHandler = calendarHandler();
    const { app, request, refresh } = createTestApp(async (path, options) => {
      if (path === "/api/private/sessions/normalize-expired" && options?.method === "POST") {
        normalized = true;
        return { normalized_count: 1 };
      }
      if (path.startsWith("/api/private/sessions?")) {
        return {
          items: normalized
            ? []
            : [{
                session_key: "expired-session",
                scheduled_date: "2026-08-28",
                status: "in_progress",
              }],
        };
      }
      return baseHandler(path, options);
    });
    const wrapper = mount(CalendarPage, { props: { app } });
    await settle();

    expect(wrapper.get('[data-action="normalize-expired"]').text()).toContain("整理 1 条");
    await wrapper.get('[data-action="normalize-expired"]').trigger("click");
    await settle();

    expect(request).toHaveBeenCalledWith("/api/private/sessions/normalize-expired", {
      method: "POST",
      headers: { "Idempotency-Key": "calendar-test-key" },
      body: "{}",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(app.setMessage).toHaveBeenCalledWith(
      "已整理 1 条过期训练记录，统一标记为未完成",
    );
    expect(wrapper.find('[data-action="normalize-expired"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
