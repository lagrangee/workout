import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";
import { createWorkoutAppStore } from "./core/app-store";
import { createApiClient } from "./core/api-client";
import type {
  ApiClient,
  AppCoreState,
  PlanState,
  TodayState,
  WorkoutAppStore,
} from "./core/contracts";

enableAutoUnmount(afterEach);

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const today: TodayState = {
  date: "2026-08-29",
  timezone: "Asia/Shanghai",
  entry: null,
  session: null,
};

const plan: PlanState = {
  timezone: "Asia/Shanghai",
  first_effective_from: "2026-08-25",
  current: null,
  future: [],
};

const progress = {
  metric_semantics_version: 1,
  period: { from: "2026-08-01", to: "2026-08-29" },
  metrics: {
    completion_rate: { value: 0.75 },
    training_duration: { value_sec: 7200 },
    strength_training_days: { value: 2 },
    average_session_rpe: { value: 7, included_count: 2 },
  },
  current_streak: { value: 1 },
  exercises: [],
};

function progressWithCompletion(value: number) {
  return {
    ...progress,
    metrics: {
      ...progress.metrics,
      completion_rate: { value },
    },
  };
}

function setAppHash(hash = "", dispatch = false): void {
  window.history.replaceState(null, "", `/app${hash}`);
  if (dispatch) window.dispatchEvent(new Event("hashchange"));
}

beforeEach(() => {
  setAppHash();
});

function apiWith(
  implementation: (path: string, options?: RequestInit) => Promise<unknown>,
): { api: ApiClient; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(implementation);
  return {
    api: {
      async request<T>(path: string, options?: RequestInit): Promise<T> {
        return await request(path, options) as T;
      },
      async response(): Promise<Response> {
        throw new Error("Unexpected raw response request");
      },
      idempotencyKey: () => "idempotency-test-key",
    },
    request,
  };
}

function coreState(overrides: Partial<AppCoreState> = {}): AppCoreState {
  return reactive({
    view: "today",
    authEpoch: 0,
    loading: false,
    authRequired: false,
    authMessage: "",
    error: null,
    message: "",
    today,
    plan,
    progress,
    session: null,
    ...overrides,
  });
}

function appHarness(overrides: Partial<AppCoreState> = {}) {
  const state = coreState(overrides);
  const bootstrap = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  const login = vi.fn(async () => {});
  const logout = vi.fn(async () => {});
  const request = vi.fn(async (_path: string, _options?: RequestInit) => ({}));
  const app: WorkoutAppStore = {
    state,
    api: {
      async request<T>(path: string, options?: RequestInit): Promise<T> {
        return await request(path, options) as T;
      },
      async response(): Promise<Response> {
        throw new Error("Unexpected raw response request");
      },
      idempotencyKey: () => "idempotency-test-key",
    },
    bootstrap,
    refresh,
    login,
    logout,
    setMessage(message: string) {
      state.message = message;
    },
    setError(error: unknown) {
      state.error = error instanceof Error ? error.message : String(error);
    },
    clearError() {
      state.error = null;
    },
  };
  return { app, bootstrap, refresh, login, logout, request };
}

function button(wrapper: VueWrapper, label: string) {
  const result = wrapper.findAll("button").find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

function appStubs(ensurePaused = vi.fn(async () => true), showAerobicDate = vi.fn(async () => {})) {
  const TodayPage = defineComponent({
    name: "TodayPage",
    emits: ["execution-focus-change", "show-aerobic"],
    setup(_props, { emit, expose }) {
      expose({ ensurePaused });
      return () => h("section", { "data-test": "today-page" }, [
        h("button", {
          type: "button",
          "data-test": "focus-session",
          onClick: () => emit("execution-focus-change", true),
        }, "进入训练"),
        h("button", {
          type: "button",
          "data-test": "show-today-aerobic",
          onClick: () => emit("show-aerobic", "2026-08-29"),
        }, "查看今日有氧记录"),
      ]);
    },
  });
  const CalendarPage = defineComponent({
    name: "CalendarPage",
    emits: ["show-aerobic"],
    setup(_props, { emit }) {
      return () => h("button", {
        type: "button",
        "data-test": "show-aerobic",
        onClick: () => emit("show-aerobic", "2026-08-24"),
      }, "查看有氧记录");
    },
  });
  const RecordsPage = defineComponent({
    name: "RecordsPage",
    setup(_props, { expose }) {
      expose({ showAerobicDate });
      return () => h("section", { "data-test": "records-page" }, "记录页");
    },
  });
  const SettingsPage = defineComponent({
    name: "SettingsPage",
    setup() {
      return () => h("section", { "data-test": "settings-page" }, "设置页");
    },
  });
  return { TodayPage, CalendarPage, RecordsPage, SettingsPage };
}

function mountApp(app: WorkoutAppStore, stubs = appStubs()) {
  return mount(App, {
    props: { app },
    global: { stubs },
  });
}

describe("App authentication", () => {
  it("bootstraps once and renders the login boundary without private navigation", async () => {
    const { app, bootstrap } = appHarness({
      authRequired: true,
      authMessage: "邮箱或密码不正确",
      today: null,
      plan: null,
      progress: null,
    });

    const wrapper = mountApp(app);
    await flushPromises();

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(wrapper.get('input[name="email"]').attributes("type")).toBe("email");
    expect(wrapper.get('input[name="password"]').attributes("type")).toBe("password");
    expect(wrapper.get('[role="alert"]').text()).toContain("邮箱或密码不正确");
    expect(wrapper.find('nav[aria-label="主导航"]').exists()).toBe(false);
  });

  it("submits credentials once while pending and clears the password after success", async () => {
    const gate = deferred<void>();
    const { app, login } = appHarness({ authRequired: true });
    login.mockImplementation(() => gate.promise);
    const wrapper = mountApp(app);

    await wrapper.get('input[name="email"]').setValue("athlete@example.com");
    await wrapper.get('input[name="password"]').setValue("secret-value");
    await wrapper.get("form").trigger("submit");
    await nextTick();

    expect(login).toHaveBeenCalledWith("athlete@example.com", "secret-value");
    expect(button(wrapper, "正在登录…").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "正在登录…").attributes("aria-busy")).toBe("true");

    await wrapper.get("form").trigger("submit");
    expect(login).toHaveBeenCalledTimes(1);

    gate.resolve();
    await flushPromises();
    expect(wrapper.get('input[name="password"]').element).toHaveProperty("value", "");
    expect(button(wrapper, "登录").attributes("disabled")).toBeUndefined();
  });
});

describe("App navigation", () => {
  it("marks the current destination and changes non-Today views directly", async () => {
    const { app } = appHarness({ view: "calendar" });
    const wrapper = mountApp(app);
    await flushPromises();

    expect(button(wrapper, "日历").attributes("aria-current")).toBe("page");
    await button(wrapper, "设置").trigger("click");

    expect(app.state.view).toBe("settings");
    expect(button(wrapper, "设置").attributes("aria-current")).toBe("page");
  });

  it("waits for Today to pause before changing view and disables navigation meanwhile", async () => {
    const pauseGate = deferred<boolean>();
    const ensurePaused = vi.fn(() => pauseGate.promise);
    const { app } = appHarness({ view: "today" });
    const wrapper = mountApp(app, appStubs(ensurePaused));
    await flushPromises();

    await button(wrapper, "设置").trigger("click");
    await nextTick();

    expect(ensurePaused).toHaveBeenCalledWith("navigation");
    expect(app.state.view).toBe("today");
    expect(wrapper.findAll('nav[aria-label="主导航"] button').every((item) => item.attributes("disabled") !== undefined)).toBe(true);

    pauseGate.resolve(true);
    await flushPromises();

    expect(app.state.view).toBe("settings");
    expect(wrapper.findAll('nav[aria-label="主导航"] button').every((item) => item.attributes("disabled") === undefined)).toBe(true);
  });

  it("keeps Today mounted when pausing is refused", async () => {
    const ensurePaused = vi.fn(async () => false);
    const { app } = appHarness({ view: "today" });
    const wrapper = mountApp(app, appStubs(ensurePaused));
    await flushPromises();

    await button(wrapper, "日历").trigger("click");
    await flushPromises();

    expect(app.state.view).toBe("today");
    expect(wrapper.find('[data-test="today-page"]').exists()).toBe(true);
    expect(button(wrapper, "日历").attributes("disabled")).toBeUndefined();
  });

  it("hides navigation while Today owns an execution focus", async () => {
    const { app } = appHarness({ view: "today" });
    const wrapper = mountApp(app);
    await flushPromises();

    await wrapper.get('[data-test="focus-session"]').trigger("click");

    expect(wrapper.find('nav[aria-label="主导航"]').exists()).toBe(false);
    expect(wrapper.get(".shell").classes()).toContain("session-shell");
  });

  it("routes Calendar aerobic intent to Records after the destination mounts", async () => {
    const showAerobicDate = vi.fn(async () => {});
    const { app } = appHarness({ view: "calendar" });
    const wrapper = mountApp(app, appStubs(vi.fn(async () => true), showAerobicDate));
    await flushPromises();

    await wrapper.get('[data-test="show-aerobic"]').trigger("click");
    await flushPromises();

    expect(app.state.view).toBe("progress");
    expect(wrapper.find('[data-test="records-page"]').exists()).toBe(true);
    expect(showAerobicDate).toHaveBeenCalledWith("2026-08-24");
  });

  it("routes Today aerobic intent to Records after the destination mounts", async () => {
    const showAerobicDate = vi.fn(async () => {});
    const { app } = appHarness({ view: "today" });
    const wrapper = mountApp(app, appStubs(vi.fn(async () => true), showAerobicDate));
    await flushPromises();

    await wrapper.get('[data-test="show-today-aerobic"]').trigger("click");
    await flushPromises();

    expect(app.state.view).toBe("progress");
    expect(wrapper.find('[data-test="records-page"]').exists()).toBe(true);
    expect(showAerobicDate).toHaveBeenCalledWith("2026-08-29");
  });

  it("keeps navigation fail-closed until a real delayed bootstrap mounts Today and pauses an open Session", async () => {
    const todayGate = deferred<TodayState>();
    const planGate = deferred<PlanState>();
    const progressGate = deferred<unknown>();
    const pauseGate = deferred<boolean>();
    const ensurePaused = vi.fn(() => pauseGate.promise);
    const showAerobicDate = vi.fn(async () => {});
    const { api } = apiWith(async (path) => {
      if (path === "/api/private/today") return todayGate.promise;
      if (path === "/api/private/plan") return planGate.promise;
      if (path.startsWith("/api/private/progress?")) return progressGate.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    setAppHash("#records-aerobic-2026-08-24");
    const wrapper = mountApp(store, appStubs(ensurePaused, showAerobicDate));

    await nextTick();
    expect(wrapper.find('nav[aria-label="主导航"]').exists()).toBe(false);
    expect(store.state.view).toBe("today");
    expect(ensurePaused).not.toHaveBeenCalled();

    todayGate.resolve({
      ...today,
      session: {
        session_key: "session-open-during-bootstrap",
        scheduled_date: "2026-08-29",
        local_date: "2026-08-29",
        title: "阈值跑",
        status: "in_progress",
        completion_fraction: 0.25,
        training_duration_sec: 600,
        session_rpe: null,
        exercise_keys: [],
        exercise_ids: [],
        updated_at: "2026-08-29T01:10:00.000Z",
        source_ref: "session:2026-08-29:session-open-during-bootstrap",
        training_intervals: [{ started_at: "2026-08-29T01:00:00.000Z", ended_at: null }],
      },
    });
    planGate.resolve(plan);
    await flushPromises();
    progressGate.resolve(progress);
    await flushPromises();

    expect(ensurePaused).toHaveBeenCalledWith("navigation");
    expect(store.state.view).toBe("today");
    expect(showAerobicDate).not.toHaveBeenCalled();

    pauseGate.resolve(true);
    await flushPromises();

    expect(store.state.view).toBe("progress");
    expect(showAerobicDate).toHaveBeenCalledWith("2026-08-24");
  });

  it("hides navigation when bootstrap fails before private state is available", async () => {
    const { app } = appHarness({
      loading: false,
      error: "Today response is unavailable",
      today: null,
      plan: null,
      progress: null,
    });
    const wrapper = mountApp(app);
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("Today response is unavailable");
    expect(wrapper.find('nav[aria-label="主导航"]').exists()).toBe(false);
    expect(app.state.view).toBe("today");
  });

  it("keeps an existing feature mounted when a non-fatal feature error is reported", async () => {
    const { app } = appHarness({
      view: "calendar",
      error: "保存失败，请重试",
    });
    const wrapper = mountApp(app);
    await flushPromises();

    expect(wrapper.find('[data-test="show-aerobic"]').exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain("保存失败，请重试");
    expect(wrapper.find('nav[aria-label="主导航"]').exists()).toBe(true);
  });

  it("routes a hashchange through the same Today pause gate", async () => {
    const pauseGate = deferred<boolean>();
    const ensurePaused = vi.fn(() => pauseGate.promise);
    const showAerobicDate = vi.fn(async () => {});
    const { app } = appHarness({ view: "today" });
    const wrapper = mountApp(app, appStubs(ensurePaused, showAerobicDate));
    await flushPromises();

    setAppHash("#records-aerobic-2026-08-24", true);
    await nextTick();

    expect(ensurePaused).toHaveBeenCalledWith("navigation");
    expect(app.state.view).toBe("today");
    expect(showAerobicDate).not.toHaveBeenCalled();

    pauseGate.resolve(true);
    await flushPromises();

    expect(app.state.view).toBe("progress");
    expect(showAerobicDate).toHaveBeenCalledWith("2026-08-24");
  });

  it.each([
    "#records-aerobic-2026-02-29",
    "#records-aerobic-2026-02-30",
    "#records-aerobic-2026-8-24",
    "#records-aerobic-2026-08-24-extra",
    "#records-aerobic-%32%30%32%36-08-24",
    "#records-aerobic-",
  ])("ignores an invalid aerobic deep link: %s", async (hash) => {
    const showAerobicDate = vi.fn(async () => {});
    const { app } = appHarness({ view: "calendar" });
    const wrapper = mountApp(app, appStubs(vi.fn(async () => true), showAerobicDate));
    await flushPromises();

    setAppHash(hash, true);
    await flushPromises();

    expect(app.state.view).toBe("calendar");
    expect(showAerobicDate).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight hash navigation when the auth epoch changes", async () => {
    const pauseGate = deferred<boolean>();
    const ensurePaused = vi.fn(() => pauseGate.promise);
    const showAerobicDate = vi.fn(async () => {});
    const { app } = appHarness({ view: "today", authEpoch: 7 });
    const wrapper = mountApp(app, appStubs(ensurePaused, showAerobicDate));
    await flushPromises();

    setAppHash("#records-aerobic-2026-08-24", true);
    await nextTick();
    expect(ensurePaused).toHaveBeenCalledTimes(1);

    Object.assign(app.state, {
      authEpoch: 8,
      authRequired: true,
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
    pauseGate.resolve(true);
    await flushPromises();

    expect(app.state.view).toBe("today");
    expect(showAerobicDate).not.toHaveBeenCalled();
  });

  it("re-evaluates the current deep link only after a new authenticated epoch is ready", async () => {
    const showAerobicDate = vi.fn(async () => {});
    const { app } = appHarness({
      authEpoch: 3,
      authRequired: true,
      loading: false,
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
    setAppHash("#records-aerobic-2024-02-29");
    const wrapper = mountApp(app, appStubs(vi.fn(async () => true), showAerobicDate));
    await flushPromises();

    expect(showAerobicDate).not.toHaveBeenCalled();

    Object.assign(app.state, {
      authEpoch: 4,
      authRequired: false,
      loading: false,
      today,
      plan,
      progress,
    });
    await flushPromises();

    expect(app.state.view).toBe("progress");
    expect(showAerobicDate).toHaveBeenCalledWith("2024-02-29");
  });
});

describe("createWorkoutAppStore lifecycle", () => {
  it("loads Today and Plan before the date-scoped progress read", async () => {
    const calls: string[] = [];
    const { api } = apiWith(async (path) => {
      calls.push(path);
      if (path === "/api/private/today") return today;
      if (path === "/api/private/plan") return plan;
      if (path === "/api/private/progress?from=2026-08-01&to=2026-08-29") return progress;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);

    await store.bootstrap();

    expect(calls.slice(0, 2).sort()).toEqual(["/api/private/plan", "/api/private/today"]);
    expect(calls[2]).toBe("/api/private/progress?from=2026-08-01&to=2026-08-29");
    expect(store.state).toMatchObject({
      loading: false,
      authRequired: false,
      today,
      plan,
      progress,
    });
  });

  it("keeps global loading false during a background refresh", async () => {
    const todayGate = deferred<TodayState>();
    const planGate = deferred<PlanState>();
    const progressGate = deferred<unknown>();
    const { api } = apiWith(async (path) => {
      if (path === "/api/private/today") return todayGate.promise;
      if (path === "/api/private/plan") return planGate.promise;
      if (path.startsWith("/api/private/progress?")) return progressGate.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.today = today;
    store.state.plan = plan;
    store.state.loading = false;

    const refreshing = store.refresh();
    expect(store.state.loading).toBe(false);

    todayGate.resolve({ ...today, date: "2026-08-30" });
    planGate.resolve(plan);
    await flushPromises();
    expect(store.state.loading).toBe(false);

    progressGate.resolve(progressWithCompletion(0.8));
    await refreshing;
    expect(store.state.today?.date).toBe("2026-08-30");
  });

  it("clears private state and enters login when refresh receives 401", async () => {
    const unauthorized = Object.assign(new Error("请先登录"), { status: 401 });
    const { api } = apiWith(async () => {
      throw unauthorized;
    });
    const store = createWorkoutAppStore(api);
    store.state.today = today;
    store.state.plan = plan;
    store.state.progress = progressWithCompletion(0.5);
    store.state.session = { session_key: "session-private" };
    store.state.loading = false;

    await store.refresh();

    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: false,
      authRequired: true,
      authMessage: "",
      error: null,
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
  });

  it("routes a feature private 401 through the global fail-closed transition", async () => {
    const unauthorized = Object.assign(new Error("请先登录"), { status: 401 });
    const { api } = apiWith(async (path) => {
      if (path === "/api/private/records/overview") throw unauthorized;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    Object.assign(store.state, {
      loading: false,
      message: "private success message",
      error: "private error",
      today,
      plan,
      progress: progressWithCompletion(0.5),
      session: { session_key: "private-session" },
    });

    await expect(store.api.request("/api/private/records/overview")).rejects.toBe(unauthorized);
    store.setError(unauthorized);
    store.setMessage("must not reappear");

    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: false,
      authRequired: true,
      authMessage: "",
      error: null,
      message: "",
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
  });

  it("routes an export response 401 through the same global transition", async () => {
    const api = createApiClient(async () => new Response(JSON.stringify({
      error: { code: "authentication_required", message: "请先登录", details: [] },
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));
    const store = createWorkoutAppStore(api);
    Object.assign(store.state, {
      loading: false,
      today,
      plan,
      progress: progressWithCompletion(0.5),
      session: { session_key: "private-session" },
    });

    await expect(store.api.response("/api/private/export")).rejects.toMatchObject({
      name: "WorkoutApiError",
      status: 401,
    });

    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: true,
      error: null,
      message: "",
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
  });

  it("runs the unauthorized transition only once for concurrent private 401 responses", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const { api } = apiWith(async (path) => {
      if (path === "/api/private/first") return first.promise;
      if (path === "/api/private/second") return second.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.today = today;
    store.state.plan = plan;
    const firstRequest = store.api.request("/api/private/first");
    const secondRequest = store.api.request("/api/private/second");
    const unauthorized = Object.assign(new Error("expired"), { status: 401 });

    first.reject(unauthorized);
    second.reject(unauthorized);
    await Promise.allSettled([firstRequest, secondRequest]);

    expect(store.state.authEpoch).toBe(1);
    expect(store.state.authRequired).toBe(true);
  });

  it("ignores an old private 401 that arrives after a successful new login", async () => {
    const oldRequest = deferred<unknown>();
    const { api } = apiWith(async (path) => {
      if (path === "/api/private/records/overview") return oldRequest.promise;
      if (path === "/api/auth/login") return {};
      if (path === "/api/private/today") return today;
      if (path === "/api/private/plan") return plan;
      if (path === "/api/private/progress?from=2026-08-01&to=2026-08-29") {
        return progressWithCompletion(1);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.authRequired = true;
    const stale = store.api.request("/api/private/records/overview");

    await store.login("athlete@example.com", "correct-password");
    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: false,
      today,
      plan,
      progress: progressWithCompletion(1),
    });

    const unauthorized = Object.assign(new Error("old session expired"), { status: 401 });
    oldRequest.reject(unauthorized);
    await expect(stale).rejects.toBe(unauthorized);
    store.setError(unauthorized);

    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: false,
      error: null,
      today,
      plan,
      progress: progressWithCompletion(1),
    });
  });

  it("does not deliver an old private success into a successful new login epoch", async () => {
    const oldRequest = deferred<unknown>();
    const { api } = apiWith(async (path) => {
      if (path === "/api/private/calendar-maintenance") return oldRequest.promise;
      if (path === "/api/auth/login") return {};
      if (path === "/api/private/today") return today;
      if (path === "/api/private/plan") return plan;
      if (path === "/api/private/progress?from=2026-08-01&to=2026-08-29") return progress;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.authRequired = true;
    const stale = store.api.request("/api/private/calendar-maintenance");

    await store.login("athlete@example.com", "correct-password");
    oldRequest.resolve({ normalized_count: 4 });

    await expect(stale).rejects.toMatchObject({ name: "StaleAuthEpochError" });
    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: false,
      error: null,
      message: "",
      today,
      plan,
    });
  });

  it("keeps invalid login credentials outside the private-request epoch transition", async () => {
    const unauthorized = Object.assign(new Error("邮箱或密码不正确"), { status: 401 });
    const { api } = apiWith(async (path) => {
      if (path === "/api/auth/login") throw unauthorized;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.authRequired = true;

    await expect(store.login("athlete@example.com", "wrong-password")).rejects.toBe(unauthorized);

    expect(store.state).toMatchObject({
      authEpoch: 0,
      authRequired: true,
      authMessage: "邮箱或密码不正确",
    });
  });

  it("treats a direct logout 401 as an auth-boundary failure", async () => {
    const unauthorized = Object.assign(new Error("already logged out"), { status: 401 });
    const { api } = apiWith(async (path) => {
      if (path === "/api/auth/logout") throw unauthorized;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.today = today;
    store.state.plan = plan;

    await expect(store.api.request("/api/auth/logout", { method: "POST" })).rejects.toBe(unauthorized);

    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: false,
      authRequired: true,
      today: null,
      plan: null,
    });
  });

  it("opens exactly one fail-closed epoch when explicit logout receives 401", async () => {
    const logoutRequest = deferred<unknown>();
    const { api } = apiWith(async (path) => {
      if (path === "/api/auth/logout") return logoutRequest.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    Object.assign(store.state, {
      view: "settings",
      loading: false,
      today,
      plan,
      progress: progressWithCompletion(0.5),
      session: { session_key: "private-session" },
      message: "private message",
      error: "private error",
    });

    const logout = store.logout();
    store.setMessage("late private message");
    store.setError(new Error("late private error"));
    expect(store.state).toMatchObject({
      view: "today",
      authEpoch: 1,
      loading: true,
      authRequired: false,
      message: "",
      error: null,
      today: null,
      plan: null,
      progress: null,
      session: null,
    });

    const unauthorized = Object.assign(new Error("already logged out"), { status: 401 });
    logoutRequest.reject(unauthorized);
    await expect(logout).rejects.toBe(unauthorized);
    expect(store.state.authEpoch).toBe(1);
    expect(store.state.authRequired).toBe(true);
    expect(store.state.loading).toBe(false);
  });

  it("queues a later logout behind an in-flight login so logout owns the final cookie", async () => {
    const loginRequest = deferred<unknown>();
    const logoutRequest = deferred<unknown>();
    const calls: string[] = [];
    const { api } = apiWith(async (path) => {
      calls.push(path);
      if (path === "/api/auth/login") return loginRequest.promise;
      if (path === "/api/auth/logout") return logoutRequest.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.authRequired = true;

    const login = store.login("athlete@example.com", "password");
    await flushPromises();
    expect(calls).toEqual(["/api/auth/login"]);

    const logout = store.logout();
    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: true,
      authRequired: false,
      today: null,
      plan: null,
    });
    expect(calls).toEqual(["/api/auth/login"]);

    loginRequest.resolve({});
    await login;
    await flushPromises();
    expect(calls).toEqual(["/api/auth/login", "/api/auth/logout"]);
    expect(calls.some((path) => path.startsWith("/api/private/"))).toBe(false);

    logoutRequest.resolve({});
    await logout;
    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: false,
      authRequired: true,
      error: null,
      message: "",
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
  });

  it("does not let refresh or late messages repopulate state while logout is pending", async () => {
    const logoutRequest = deferred<unknown>();
    const calls: string[] = [];
    const { api } = apiWith(async (path) => {
      calls.push(path);
      if (path === "/api/auth/logout") return logoutRequest.promise;
      throw new Error(`Unexpected request during logout: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.today = today;
    store.state.plan = plan;

    const logout = store.logout();
    await store.refresh();
    store.setMessage("late private message");
    store.setError(new Error("late private error"));

    expect(calls).toEqual(["/api/auth/logout"]);
    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: true,
      authRequired: false,
      message: "",
      error: null,
      today: null,
      plan: null,
    });

    logoutRequest.resolve({});
    await logout;
    expect(store.state.authRequired).toBe(true);
    expect(store.state.loading).toBe(false);
  });

  it("does not send a new login until the old logout response has settled", async () => {
    const logoutRequest = deferred<unknown>();
    const calls: string[] = [];
    const { api } = apiWith(async (path) => {
      calls.push(path);
      if (path === "/api/auth/logout") return logoutRequest.promise;
      if (path === "/api/auth/login") return {};
      if (path === "/api/private/today") return today;
      if (path === "/api/private/plan") return plan;
      if (path === "/api/private/progress?from=2026-08-01&to=2026-08-29") {
        return progressWithCompletion(1);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.today = today;
    store.state.plan = plan;

    const logout = store.logout();
    const login = store.login("athlete@example.com", "new-password");
    await flushPromises();

    expect(calls).toEqual(["/api/auth/logout"]);
    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: true,
      authRequired: false,
      today: null,
      plan: null,
    });

    logoutRequest.resolve({});
    await logout;
    await login;

    expect(calls).toEqual([
      "/api/auth/logout",
      "/api/auth/login",
      "/api/private/today",
      "/api/private/plan",
      "/api/private/progress?from=2026-08-01&to=2026-08-29",
    ]);
    expect(store.state).toMatchObject({
      authEpoch: 2,
      loading: false,
      authRequired: false,
      today,
      plan,
    });
  });

  it("does not let an in-flight refresh restore private state after logout", async () => {
    const todayGate = deferred<TodayState>();
    const planGate = deferred<PlanState>();
    const { api } = apiWith(async (path) => {
      if (path === "/api/private/today") return todayGate.promise;
      if (path === "/api/private/plan") return planGate.promise;
      if (path.startsWith("/api/private/progress?")) return progressWithCompletion(1);
      if (path === "/api/auth/logout") return {};
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = createWorkoutAppStore(api);
    store.state.today = today;
    store.state.plan = plan;
    store.state.loading = false;

    const refreshing = store.refresh();
    await store.logout();

    todayGate.resolve({ ...today, date: "2026-08-30" });
    planGate.resolve(plan);
    await refreshing;

    expect(store.state).toMatchObject({
      authEpoch: 1,
      loading: false,
      authRequired: true,
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
  });
});

describe("createApiClient response boundary", () => {
  it("preserves an authenticated successful response body for attachment consumers", async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousLocation = globalThis.location;
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => "athlete@example.invalid"),
    });
    vi.stubGlobal("location", { hostname: "localhost" });
    const attachment = new Response("private export", {
      headers: { "Content-Disposition": 'attachment; filename="workout.json"' },
    });
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => attachment);
    const api = createApiClient(fetchImpl as typeof fetch);

    try {
      const result = await api.response("/api/private/export");

      expect(result).toBe(attachment);
      expect(result.bodyUsed).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [, options] = fetchImpl.mock.calls[0];
      expect(options?.credentials).toBe("same-origin");
      const headers = new Headers(options?.headers);
      expect(headers.get("Content-Type")).toBeNull();
      expect(headers.get("x-athlete-email")).toBe("athlete@example.invalid");
    } finally {
      vi.stubGlobal("localStorage", previousLocalStorage);
      vi.stubGlobal("location", previousLocation);
    }
  });

  it("turns a non-OK raw response into a status-preserving WorkoutApiError", async () => {
    const api = createApiClient(async () => new Response(JSON.stringify({
      error: { code: "authentication_required", message: "请先登录", details: [] },
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(api.response("/api/private/export")).rejects.toMatchObject({
      name: "WorkoutApiError",
      status: 401,
      data: {
        error: {
          code: "authentication_required",
          message: "请先登录",
        },
      },
    });
  });

  it.each([
    ["null JSON", "null", "application/json"],
    ["array JSON", "[]", "application/json"],
    ["plain text", "not-json", "text/plain"],
    ["object-valued message", '{"error":{"message":{"private":true}}}', "application/json"],
    ["array-valued message", '{"error":{"message":[],"details":"invalid"}}', "application/json"],
  ])("normalizes a %s 401 body without bypassing the auth transition", async (
    _label,
    body,
    contentType,
  ) => {
    const api = createApiClient(async () => new Response(body, {
      status: 401,
      headers: { "Content-Type": contentType },
    }));
    const store = createWorkoutAppStore(api);
    store.state.loading = false;
    store.state.today = today;
    store.state.plan = plan;

    await expect(store.api.response("/api/private/export")).rejects.toMatchObject({
      name: "WorkoutApiError",
      status: 401,
      message: "请求失败",
      data: {},
    });
    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: true,
      today: null,
      plan: null,
    });
  });

  it("normalizes a resolved non-OK response from an injected ApiClient", async () => {
    const injected: ApiClient = {
      async request<T>(): Promise<T> {
        throw new Error("Unexpected JSON request");
      },
      async response(): Promise<Response> {
        return new Response("unauthorized", { status: 401 });
      },
      idempotencyKey: () => "injected-key",
    };
    const store = createWorkoutAppStore(injected);
    store.state.loading = false;
    store.state.today = today;
    store.state.plan = plan;

    await expect(store.api.response("/api/private/export")).rejects.toMatchObject({
      name: "WorkoutApiError",
      status: 401,
    });
    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: true,
      today: null,
      plan: null,
    });
  });
});
