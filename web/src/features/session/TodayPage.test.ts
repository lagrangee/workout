import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ApiClient,
  AppCoreState,
  JsonRecord,
  TodayPageHandle,
  WorkoutAppStore,
} from "../../core/contracts";
import { WorkoutApiError } from "../../core/api-client";
import type { AudioOutput, CueEvent } from "../../lib/workout-timeline";
import TodayPage from "./TodayPage.vue";
import type { CompletionItem, SessionDetail } from "./session-types";

const initialNow = Date.parse("2026-08-29T04:00:00.000Z");

interface ApiCall {
  path: string;
  options?: RequestInit;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface ComponentClock {
  now(): number;
  advance(milliseconds: number): Promise<void>;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

interface ComponentAudio extends AudioOutput {
  schedules: CueEvent[][];
  cancellations: number;
}

const wrappers: VueWrapper[] = [];

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function detail(options: { timed?: boolean; restSeconds?: number } = {}): SessionDetail {
  const firstTarget = options.timed
    ? { metric: "duration_sec", min: 3, max: 5 }
    : { metric: "reps", min: 8, max: 8 };
  const firstItem: CompletionItem = {
    completion_item_key: "item-1",
    exercise_occurrence_key: "exercise-1",
    set_key: "set-1",
    side: "none",
    target: firstTarget,
    resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
  };
  const secondItem: CompletionItem = {
    completion_item_key: "item-2",
    exercise_occurrence_key: "exercise-1",
    set_key: "set-2",
    side: "none",
    target: { metric: "reps", min: 6, max: 6 },
    resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
  };
  return {
    session_key: "session-1",
    status: "in_progress",
    scheduled_date: "2026-08-29",
    updated_at: "2026-08-29T04:00:00.000Z",
    completion_fraction: 0,
    snapshot: {
      schema_version: 1,
      title: "下肢力量",
      blocks: [{
        block_key: "block-1",
        title: "主训练",
        exercises: [{
          exercise_occurrence_key: "exercise-1",
          exercise_key: "goblet_squat",
          name: "高脚杯深蹲",
          execution_mode: "none",
          sets: [
            {
              set_key: "set-1",
              ordinal: 1,
              target: firstTarget,
              resistance: firstItem.resistance,
              tempo: "0-1-3-1",
              rest_after_sec: options.restSeconds ?? 60,
            },
            {
              set_key: "set-2",
              ordinal: 2,
              target: secondItem.target,
              resistance: secondItem.resistance,
              rest_after_sec: 0,
            },
          ],
        }],
      }],
      completion_items: [firstItem, secondItem],
      exercise_occurrence_keys: ["exercise-1"],
    },
    completion_results: [],
    training_intervals: [{
      interval_key: "interval-1",
      started_at: "2026-08-29T04:00:00.000Z",
      ended_at: null,
    }],
    session_rpe: null,
    note: null,
    skip_reason: null,
    exercise_feedback: [],
  };
}

function paused(detailValue: SessionDetail, endedAt = "2026-08-29T04:00:03.000Z"): SessionDetail {
  const result = clone(detailValue);
  const interval = result.training_intervals.find((candidate) => candidate.ended_at === null);
  if (interval) interval.ended_at = endedAt;
  result.updated_at = endedAt;
  return result;
}

function completedFirst(detailValue: SessionDetail, value: number): SessionDetail {
  const result = clone(detailValue);
  result.completion_results = [{
    completion_item_key: "item-1",
    completed: true,
    actual: {
      metric: result.snapshot.completion_items?.[0]?.target.metric ?? "reps",
      value,
    },
    resistance: result.snapshot.completion_items?.[0]?.resistance ?? null,
    rir: null,
    completed_at: new Date(initialNow + 10_000).toISOString(),
  }];
  result.completion_fraction = 0.5;
  return result;
}

function terminal(detailValue: SessionDetail, status: "completed" | "partial" = "completed"): SessionDetail {
  const result = paused(completedFirst(detailValue, 8), "2026-08-29T04:00:10.000Z");
  result.status = status;
  result.updated_at = "2026-08-29T04:00:10.000Z";
  result.training_duration_sec = 10;
  result.session_rpe = 7;
  result.note = "原训练备注";
  result.exercise_feedback = [{ exercise_occurrence_key: "exercise-1", text: "原动作反馈" }];
  return result;
}

function appHarness(
  responder: (path: string, options?: RequestInit) => Promise<JsonRecord>,
): { app: WorkoutAppStore; calls: ApiCall[] } {
  const calls: ApiCall[] = [];
  let requestKey = 0;
  const api: ApiClient = {
    async request<T = JsonRecord>(path: string, options?: RequestInit): Promise<T> {
      calls.push({ path, options });
      return responder(path, options) as Promise<T>;
    },
    async response(path: string): Promise<Response> {
      throw new Error(`unexpected raw response request: ${path}`);
    },
    idempotencyKey: () => `component-test-${++requestKey}`,
  };
  const state = reactive<AppCoreState>({
    view: "today",
    authEpoch: 0,
    loading: false,
    authRequired: false,
    authMessage: "",
    error: null,
    message: "",
    today: {
      date: "2026-08-29",
      timezone: "Asia/Shanghai",
      entry: {
        kind: "workout",
        title: "下肢力量",
        estimated_duration_min: 45,
        module_count: 1,
        prescription: {
          title: "下肢力量",
          blocks: [{
            title: "主训练",
            exercises: [{
              occurrence_key: "exercise-1",
              name: "高脚杯深蹲",
              execution_mode: "none",
              sets: [{
                set_key: "set-1",
                target: { metric: "reps", min: 8, max: 8 },
                resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
                tempo: "0-1-3-1",
                rest_after_sec: 60,
              }],
            }],
          }],
        },
      },
      session: null,
    },
    plan: null,
    progress: null,
    session: null,
  });
  return {
    calls,
    app: {
      state,
      api,
      bootstrap: async () => {},
      refresh: async () => {},
      login: async () => {},
      logout: async () => {},
      setMessage(message: string) { state.message = message; },
      setError(error: unknown) { state.error = error instanceof Error ? error.message : String(error); },
      clearError() { state.error = null; },
    },
  };
}

function componentClock(): ComponentClock {
  let current = initialNow;
  let nextHandle = 0;
  const frames = new Map<number, FrameRequestCallback>();
  return {
    now: () => current,
    requestAnimationFrame(callback) {
      const handle = ++nextHandle;
      frames.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle);
    },
    async advance(milliseconds) {
      current += milliseconds;
      vi.setSystemTime(new Date(current));
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(current);
      await settle();
    },
  };
}

function componentAudio(overrides: Partial<AudioOutput> = {}): ComponentAudio {
  const audio: ComponentAudio = {
    schedules: [],
    cancellations: 0,
    prepare: () => overrides.prepare?.() ?? { ok: true },
    activate: () => overrides.activate?.() ?? { ok: true },
    replace(events) {
      audio.schedules.push(clone(events));
      return overrides.replace?.(events) ?? { ok: true };
    },
    cancel() {
      audio.cancellations += 1;
      overrides.cancel?.();
    },
  };
  return audio;
}

function installSeams(clock: ComponentClock, audio: AudioOutput): void {
  Object.defineProperty(window, "__workoutTestSeams", {
    configurable: true,
    value: {
      now: clock.now,
      requestAnimationFrame: clock.requestAnimationFrame,
      cancelAnimationFrame: clock.cancelAnimationFrame,
      audio,
    },
  });
}

function requestBody(call: ApiCall): JsonRecord {
  return JSON.parse(String(call.options?.body ?? "{}")) as JsonRecord;
}

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(initialNow));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
});

afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  await settle();
  Reflect.deleteProperty(window, "__workoutTestSeams");
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  vi.useRealTimers();
});

describe("TodayPage", () => {
  test("renders summary and overview progress with native semantics and no inline style", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    const summaryOnly = appHarness(async (path) => {
      if (path === "/api/private/sessions/session-1") throw new Error("detail temporarily unavailable");
      throw new Error(`unexpected request: ${path}`);
    });
    const summary = {
      session_key: "session-1",
      status: "partial",
      completion_fraction: 0.5,
    };
    summaryOnly.app.state.session = clone(summary);
    if (summaryOnly.app.state.today) summaryOnly.app.state.today.session = clone(summary);
    const summaryWrapper = mount(TodayPage, { props: { app: summaryOnly.app } });
    wrappers.push(summaryWrapper);
    await settle();

    const summaryProgress = summaryWrapper.get('progress[aria-label="训练完成进度"]');
    expect(summaryProgress.attributes("value")).toBe("0.5");
    expect(summaryProgress.attributes("max")).toBe("1");
    expect(summaryProgress.attributes("style")).toBeUndefined();
    expect(summaryWrapper.html()).not.toMatch(/\sstyle=/);

    const overview = appHarness(async (path) => {
      if (path === "/api/private/sessions/session-1") {
        return completedFirst(paused(detail()), 8) as unknown as JsonRecord;
      }
      throw new Error(`unexpected request: ${path}`);
    });
    overview.app.state.session = clone(summary);
    if (overview.app.state.today) overview.app.state.today.session = clone(summary);
    const overviewWrapper = mount(TodayPage, { props: { app: overview.app } });
    wrappers.push(overviewWrapper);
    await settle();

    const overviewProgress = overviewWrapper.get('.today-progress-card progress[aria-label="训练完成进度"]');
    expect(overviewProgress.attributes("value")).toBe("0.5");
    expect(overviewProgress.attributes("max")).toBe("1");
    expect(overviewProgress.attributes("style")).toBeUndefined();
    expect(overviewWrapper.html()).not.toMatch(/\sstyle=/);
  });

  test("renders a recorded COROS workout without strength-session start, skip, or prescription controls", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    const harness = appHarness(async (path) => {
      throw new Error(`unexpected request: ${path}`);
    });
    if (!harness.app.state.today) throw new Error("expected Today fixture");
    harness.app.state.today.entry = {
      kind: "workout",
      title: "越野跑",
      estimated_duration_min: 90,
      module_count: 1,
      recording_intent: { provider: "coros", activity_type: "trail_run" },
      recording_evidence: { status: "recorded" },
      prescription: {
        title: "不应展示的力量处方",
        blocks: [{ title: "不应展示", exercises: [] }],
      },
    };
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await settle();

    expect(wrapper.get("h1").text()).toBe("越野跑");
    expect(wrapper.get('[aria-label="COROS 路线记录状态"]').classes()).toContain("is-recorded");
    expect(wrapper.get('[aria-label="COROS 路线记录状态"]').text()).toContain("已记录");
    expect(wrapper.find('[data-action="start"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="skip"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="今日训练计划"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("不应展示的力量处方");
    expect(harness.calls).toHaveLength(0);
  });

  test("embeds endurance completion in today's plan and saves reversible radio choices", async () => {
    const completedRun: SessionDetail = {
      session_key: "session-run",
      status: "completed",
      scheduled_date: "2026-08-29",
      updated_at: "2026-08-29T05:00:00.000Z",
      completion_fraction: 1,
      training_duration_sec: 0,
      snapshot: {
        schema_version: 2,
        title: "轻松跑",
        blocks: [{ title: "有氧", exercises: [{ exercise_occurrence_key: "easy_run_main", occurrence_key: "easy_run_main", exercise_id: "outdoor_easy_run", category: "endurance", name: "户外轻松跑", execution_mode: "none", sets: [{ set_id: "easy_run_set_1", target: { metric: "duration_sec", value: 2700, heart_rate_zone: { min: 1, max: 3 }, rpe: { min: 2, max: 4 }, effort_cue: "测试结构化有氧处方" } }] }] }],
        completion_items: [{ completion_item_key: "run-item", exercise_occurrence_key: "easy_run_main", set_key: "easy_run_set_1", side: "none", target: { metric: "duration_sec", value: 2700, heart_rate_zone: { min: 1, max: 3 }, rpe: { min: 2, max: 4 }, effort_cue: "测试结构化有氧处方" } }],
      },
      completion_results: [],
      external_completions: [{ schema_version: 1, occurrence_key: "easy_run_main", completed_at: "2026-08-29T05:00:00.000Z", recording_source: "apple_watch" }],
      training_intervals: [],
      session_rpe: null,
      note: null,
      skip_reason: null,
      exercise_feedback: [],
    };
    const firstCompletion = deferred<SessionDetail>();
    let updateAttempts = 0;
    const completedWithSource = (recordingSource: "apple_watch" | "none"): SessionDetail => ({
      ...clone(completedRun),
      external_completions: [{
        schema_version: 1,
        occurrence_key: "easy_run_main",
        completed_at: "2026-08-29T05:00:00.000Z",
        recording_source: recordingSource,
      }],
    });
    const harness = appHarness(async (path, options) => {
      if (path.endsWith("/external-completion")) {
        if (options?.method === "DELETE") return { session: null };
        if (options?.method === "PUT") {
          updateAttempts += 1;
          if (updateAttempts === 1) throw new Error("网络暂时不可用");
          return completedWithSource("none") as unknown as JsonRecord;
        }
        return firstCompletion.promise as unknown as Promise<JsonRecord>;
      }
      throw new Error(`unexpected request: ${path}`);
    });
    if (!harness.app.state.today) throw new Error("expected Today fixture");
    harness.app.state.today.entry = {
      kind: "workout",
      date: "2026-08-29",
      title: "轻松跑",
      estimated_duration_min: 45,
      module_count: 1,
      prescription: completedRun.snapshot,
    };
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await settle();

    const plan = wrapper.get('[aria-label="今日训练计划"]');
    expect(wrapper.find('[aria-label="有氧训练要求"]').exists()).toBe(false);
    expect(plan.text()).toContain("45 分钟");
    expect(plan.text()).toContain("心率 Z1–Z3");
    expect(plan.text()).toContain("RPE 2–4");
    expect(plan.text()).not.toContain("2700");
    expect(plan.text()).not.toContain("Workout 不做倒计时");
    expect(plan.find("select").exists()).toBe(false);
    expect(plan.findAll('input[type="radio"]')).toHaveLength(4);
    expect((plan.get('[data-external-choice="unfinished"]').element as HTMLInputElement).checked).toBe(true);
    expect(plan.text()).toContain("无记录");
    expect(wrapper.find('[data-action="start"]').exists()).toBe(false);
    await plan.get('[data-external-choice="apple_watch"]').setValue(true);
    await nextTick();

    expect(wrapper.get(".endurance-completion").attributes("disabled")).toBeDefined();
    expect(wrapper.get('[role="status"]').text()).toContain("保存中…");
    const createCall = harness.calls.find((candidate) => candidate.path.endsWith("/external-completion"));
    expect(createCall?.options?.method).toBe("POST");
    expect(createCall?.options?.headers).toEqual({ "Idempotency-Key": "component-test-1" });
    expect(createCall?.options?.body).toBe(JSON.stringify({ recording_source: "apple_watch" }));

    firstCompletion.resolve(completedWithSource("apple_watch"));
    await settle();

    expect(wrapper.find('[aria-label="今日训练计划"]').exists()).toBe(true);
    expect((wrapper.get('[data-external-choice="apple_watch"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain("Apple Watch 数据未导入");

    await wrapper.get('[data-external-choice="none"]').setValue(true);
    await settle();

    expect(wrapper.get('.endurance-completion-error[role="alert"]').text()).toContain("网络暂时不可用");
    expect(wrapper.get('.endurance-completion-error[role="alert"]').text()).toContain("已恢复原状态");
    expect((wrapper.get('[data-external-choice="apple_watch"]').element as HTMLInputElement).checked).toBe(true);

    await wrapper.get('[data-external-choice="none"]').setValue(true);
    await settle();

    expect((wrapper.get('[data-external-choice="none"]').element as HTMLInputElement).checked).toBe(true);
    const updateCalls = harness.calls.filter((candidate) => candidate.options?.method === "PUT");
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]?.options?.body).toBe(JSON.stringify({ recording_source: "none" }));

    await wrapper.get('[data-external-choice="unfinished"]').setValue(true);
    await settle();

    const deleteCall = harness.calls.find((candidate) => candidate.options?.method === "DELETE");
    expect(deleteCall?.options?.body).toBe("{}");
    expect((wrapper.get('[data-external-choice="unfinished"]').element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-action="toggle-timer"]').exists()).toBe(false);
  });

  test("renders an immediate pending state, blocks duplicate starts, and enters execution from the mutation response", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    const pendingStart = deferred<SessionDetail>();
    const harness = appHarness(async (path) => {
      if (path.endsWith("/start")) return pendingStart.promise;
      if (path.endsWith("/pause")) return paused(detail());
      throw new Error(`unexpected request: ${path}`);
    });
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);

    const start = wrapper.get('[data-action="start"]');
    await start.trigger("click");
    await start.trigger("click");

    expect(start.attributes("disabled")).toBeDefined();
    expect(start.attributes("aria-busy")).toBe("true");
    expect(start.text()).toBe("正在开始训练…");
    expect(wrapper.get('[role="status"]').text()).toContain("正在开始训练…");
    expect(harness.calls.filter((call) => call.path.endsWith("/start"))).toHaveLength(1);

    pendingStart.resolve(detail());
    await settle();

    expect(wrapper.get(".focus-exercise-head h2").text()).toContain("高脚杯深蹲");
    expect(wrapper.get(".focus-execution-mode").text()).toBe("不分左右");
    expect(wrapper.get(".focus-prescription").text()).toContain("节奏 0-1-3-1");
    const progress = wrapper.get('.session-progress progress[aria-label="训练完成进度"]');
    expect(progress.attributes("value")).toBe("0");
    expect(progress.attributes("max")).toBe("1");
    expect(progress.attributes("style")).toBeUndefined();
    expect(wrapper.html()).not.toMatch(/\sstyle=/);
    expect(wrapper.emitted("execution-focus-change")?.at(-1)).toEqual([true]);
    expect(harness.calls.filter((call) => call.path === "/api/private/sessions/session-1")).toHaveLength(0);
  });

  test("shows a retryable start error and restores the enabled Today control", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    let attempts = 0;
    const harness = appHarness(async (path) => {
      if (path.endsWith("/start")) {
        attempts += 1;
        if (attempts === 1) throw new WorkoutApiError("开始暂时失败，请重试", 503, {});
        return detail();
      }
      if (path.endsWith("/pause")) return paused(detail());
      throw new Error(`unexpected request: ${path}`);
    });
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);

    await wrapper.get('[data-action="start"]').trigger("click");
    await settle();

    expect(attempts).toBe(1);
    expect(wrapper.get('[role="alert"]').text()).toContain("开始暂时失败，请重试");
    expect(wrapper.get('[data-action="start"]').attributes("disabled")).toBeUndefined();

    await wrapper.get('[data-action="start"]').trigger("click");
    await settle();

    expect(attempts).toBe(2);
    expect(wrapper.find('[data-action="start"]').exists()).toBe(false);
    expect(wrapper.get(".focus-exercise-head h2").text()).toContain("高脚杯深蹲");
  });

  test("renders pause failure as a retry command and does not claim the Session resumed", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    const started = detail();
    let pauses = 0;
    const harness = appHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) {
        pauses += 1;
        if (pauses === 1) throw new Error("暂停同步失败，请重试");
        return paused(started);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await wrapper.get('[data-action="start"]').trigger("click");
    await settle();
    await clock.advance(3_000);

    await wrapper.get('[data-action="toggle-timer"]').trigger("click");
    await settle();

    expect(wrapper.get('[role="alert"]').text()).toContain("暂停同步失败，请重试");
    expect(wrapper.get('[data-action="toggle-timer"]').text()).toBe("重试暂停");
    expect(wrapper.get('[data-action="toggle-timer"]').attributes("aria-pressed")).toBe("true");

    await wrapper.get('[data-action="toggle-timer"]').trigger("click");
    await settle();

    expect(pauses).toBe(2);
    expect(wrapper.get('[data-action="toggle-timer"]').text()).toBe("继续");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  test("fixed duration stays manual at zero and then renders rest from the saved Session response", async () => {
    const clock = componentClock();
    const audio = componentAudio();
    installSeams(clock, audio);
    const started = detail({ timed: true, restSeconds: 1 });
    const updated = completedFirst(started, 4);
    const harness = appHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/record")) return clone(updated);
      if (path.endsWith("/pause")) return paused(updated, "2026-08-29T04:00:11.000Z");
      throw new Error(`unexpected request: ${path}`);
    });
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await wrapper.get('[data-action="start"]').trigger("click");
    await settle();

    expect(wrapper.get('[aria-label="固定时长动作"]').text()).toContain("5 秒");
    await wrapper.get('[data-action="start-timed"]').trigger("click");
    await settle();
    expect(wrapper.get("[data-action-remaining]").text()).toBe("05");
    expect(wrapper.get('[data-action="complete"]').attributes("disabled")).toBeDefined();

    await clock.advance(5_000);
    expect(wrapper.get("[data-action-remaining]").text()).toBe("05");
    await clock.advance(5_000);

    expect(wrapper.get("[data-action-remaining]").text()).toBe("00");
    expect((wrapper.get("#actual-value").element as HTMLInputElement).value).toBe("5");
    expect(wrapper.get('[data-action="complete"]').attributes("disabled")).toBeUndefined();
    expect(harness.calls.filter((call) => call.path.endsWith("/record"))).toHaveLength(0);

    await wrapper.get("#actual-value").setValue("4");
    await wrapper.get('[data-action="complete"]').trigger("click");
    await settle();

    const recordCall = harness.calls.find((call) => call.path.endsWith("/record"));
    expect(recordCall).toBeDefined();
    expect(harness.calls.filter((call) => call.path.endsWith("/record"))).toHaveLength(1);
    expect(requestBody(recordCall!)).toMatchObject({
      completion_results: [{ actual: { metric: "duration_sec", value: 4 } }],
    });
    expect(wrapper.get(".rest-screen").text()).toContain("组间休息");
    expect(wrapper.get("[data-rest-remaining]").text()).toBe("00:01");

    await clock.advance(1_000);
    expect(wrapper.find(".rest-screen").exists()).toBe(false);
    expect(wrapper.get(".focus-exercise-head h2").text()).toContain("第 2 组");
    expect(audio.schedules.at(-1)?.at(-1)).toMatchObject({ kind: "rest-complete", value: 0 });
  });

  test("keeps the visual timer usable after audio activation fails and clears the notice after unmute retry", async () => {
    const clock = componentClock();
    let activationAttempts = 0;
    const audio = componentAudio({
      activate: () => ++activationAttempts === 1
        ? { ok: false, error: "音频播放被浏览器拒绝" }
        : { ok: true },
    });
    installSeams(clock, audio);
    const started = detail({ timed: true });
    const harness = appHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      throw new Error(`unexpected request: ${path}`);
    });
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await wrapper.get('[data-action="start"]').trigger("click");
    await settle();

    await wrapper.get('[data-action="start-timed"]').trigger("click");
    await settle();

    expect(wrapper.get(".timed-audio-notice").text()).toContain("声音未开启");
    expect(wrapper.get(".timed-audio-notice").text()).toContain("计时仍可继续");
    await clock.advance(2_000);
    expect(wrapper.get("[data-action-remaining]").text()).toBe("03");

    await wrapper.get('[data-action="toggle-mute"]').trigger("click");
    expect(wrapper.get('[data-action="toggle-mute"]').text()).toBe("开启声音");
    await wrapper.get('[data-action="toggle-mute"]').trigger("click");
    await settle();

    expect(activationAttempts).toBe(2);
    expect(wrapper.find(".timed-audio-notice").exists()).toBe(false);
    expect(wrapper.get('[data-action="toggle-mute"]').text()).toBe("静音");
    expect(audio.schedules).toHaveLength(1);
  });

  test("locks the End sheet after two transport failures, then retries the identical frozen request", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    const started = detail();
    const stopped = paused(started, "2026-08-29T04:00:01.000Z");
    const ended = clone(stopped);
    ended.status = "partial";
    ended.session_rpe = 7;
    ended.note = "保留这次训练上下文";
    ended.exercise_feedback = [{ exercise_occurrence_key: "exercise-1", text: "膝盖稳定" }];
    ended.updated_at = "2026-08-29T04:00:01.000Z";
    ended.training_duration_sec = 1;
    let endAttempts = 0;
    const harness = appHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return clone(stopped);
      if (path.endsWith("/end")) {
        endAttempts += 1;
        if (endAttempts <= 2) throw new Error("结束保存暂时失败");
        return clone(ended);
      }
      if (path === "/api/private/sessions/session-1") return clone(ended);
      throw new Error(`unexpected request: ${path}`);
    });
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await wrapper.get('[data-action="start"]').trigger("click");
    await settle();
    await clock.advance(1_000);

    await wrapper.get('[data-action="end"]').trigger("click");
    await settle();
    await wrapper.get('[data-action="set-end-rpe"][data-rpe="7"]').trigger("click");
    await wrapper.get("#end-note").setValue("保留这次训练上下文");
    await wrapper.get('[data-end-feedback="exercise-1"]').setValue("膝盖稳定");
    await wrapper.get('[data-action="save-end"]').trigger("click");
    await settle();

    const failedEndCalls = harness.calls.filter((call) => call.path.endsWith("/end"));
    expect(failedEndCalls).toHaveLength(2);
    expect(new Headers(failedEndCalls[1].options?.headers).get("Idempotency-Key"))
      .toBe(new Headers(failedEndCalls[0].options?.headers).get("Idempotency-Key"));
    expect(failedEndCalls[1].options?.body).toBe(failedEndCalls[0].options?.body);
    expect(wrapper.find(".end-sheet").exists()).toBe(true);
    const endProgress = wrapper.get('.end-sheet progress[aria-label="训练完成进度"]');
    expect(endProgress.attributes("value")).toBe("0");
    expect(endProgress.attributes("max")).toBe("100");
    expect(endProgress.attributes("style")).toBeUndefined();
    expect(wrapper.html()).not.toMatch(/\sstyle=/);
    expect((wrapper.get("#end-note").element as HTMLTextAreaElement).value).toBe("保留这次训练上下文");
    expect((wrapper.get('[data-end-feedback="exercise-1"]').element as HTMLInputElement).value).toBe("膝盖稳定");
    expect(wrapper.get('[data-action="set-end-rpe"][data-rpe="7"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.get("#end-note").attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-end-feedback="exercise-1"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-action="set-end-rpe"][data-rpe="7"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('button[data-action="cancel-end"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-action="save-end"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-action="save-end"]').text()).toBe("确认上次提交");
    expect(wrapper.get('[role="alert"]').text()).toContain("上次结束提交的结果尚未确认");
    expect(wrapper.get('[role="alert"]').text()).toContain("将重放同一提交；不会接受新的表单修改");
    expect(wrapper.find(".error-card").exists()).toBe(false);
    expect(harness.app.state.error).toBeNull();

    await wrapper.get('[data-action="save-end"]').trigger("click");
    await settle();

    const endCalls = harness.calls.filter((call) => call.path.endsWith("/end"));
    expect(endCalls).toHaveLength(3);
    for (const retriedCall of endCalls.slice(1)) {
      expect(new Headers(retriedCall.options?.headers).get("Idempotency-Key"))
        .toBe(new Headers(endCalls[0].options?.headers).get("Idempotency-Key"));
      expect(retriedCall.options?.body).toBe(endCalls[0].options?.body);
    }
    expect(requestBody(endCalls[2])).toMatchObject({
      record: {
        session_rpe: 7,
        note: "保留这次训练上下文",
        exercise_feedback: [{ exercise_occurrence_key: "exercise-1", text: "膝盖稳定" }],
      },
      ended_at: "2026-08-29T04:00:01.000Z",
    });
    expect(wrapper.find(".end-sheet").exists()).toBe(false);
    expect(wrapper.find(".session-summary-page").exists()).toBe(true);
  });

  test("keeps the correction surface and drafts after a non-auth save failure", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    const completed = terminal(detail());
    const harness = appHarness(async (path) => {
      if (path === "/api/private/sessions/session-1") return clone(completed);
      if (path.endsWith("/record")) throw new Error("校正保存暂时失败");
      throw new Error(`unexpected request: ${path}`);
    });
    harness.app.state.session = clone(completed);
    if (harness.app.state.today) harness.app.state.today.session = clone(completed);
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await settle();

    await wrapper.get('[data-action="edit-session"]').trigger("click");
    await wrapper.get("#correction-value-item-1").setValue("9");
    await wrapper.get("#correction-note").setValue("保留校正备注");
    await wrapper.get("#correction-feedback-exercise-1").setValue("下蹲更稳定");
    await wrapper.get('[data-action="save-correction"]').trigger("click");
    await settle();

    expect(wrapper.find('[data-action="save-correction"]').exists()).toBe(true);
    expect(wrapper.get('[data-action="save-correction"]').attributes("disabled")).toBeUndefined();
    expect((wrapper.get("#correction-value-item-1").element as HTMLInputElement).value).toBe("9");
    expect((wrapper.get("#correction-note").element as HTMLTextAreaElement).value).toBe("保留校正备注");
    expect((wrapper.get("#correction-feedback-exercise-1").element as HTMLInputElement).value).toBe("下蹲更稳定");
    expect(wrapper.get('[role="alert"]').text()).toContain("校正保存暂时失败");
    expect(wrapper.get('[role="alert"]').text()).toContain("输入已保留，可以直接重试");
    expect(wrapper.find(".error-card").exists()).toBe(false);
    expect(harness.app.state.error).toBeNull();

    const correctionCall = harness.calls.find((call) => call.path.endsWith("/record"));
    expect(correctionCall).toBeDefined();
    expect(correctionCall?.options?.method).toBe("PUT");
    expect(requestBody(correctionCall!)).toMatchObject({
      completion_results: [{
        completion_item_key: "item-1",
        actual: { metric: "reps", value: 9 },
      }],
      note: "保留校正备注",
      exercise_feedback: [{ exercise_occurrence_key: "exercise-1", text: "下蹲更稳定" }],
    });
  });

  test("exposes a rejecting ensurePaused boundary so the shell can keep navigation mounted", async () => {
    const clock = componentClock();
    installSeams(clock, componentAudio());
    const started = detail();
    const harness = appHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) throw new Error("暂停写入失败");
      throw new Error(`unexpected request: ${path}`);
    });
    const wrapper = mount(TodayPage, { props: { app: harness.app } });
    wrappers.push(wrapper);
    await wrapper.get('[data-action="start"]').trigger("click");
    await settle();
    await clock.advance(1_000);
    const exposed = wrapper.vm as unknown as TodayPageHandle;

    await expect(exposed.ensurePaused("navigation")).rejects.toThrow("暂停写入失败");

    expect(wrapper.find(".session-header").exists()).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain("暂停写入失败");
    expect(wrapper.emitted("execution-focus-change")?.at(-1)).toEqual([true]);
  });
});
