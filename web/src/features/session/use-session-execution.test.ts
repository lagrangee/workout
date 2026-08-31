import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  ApiClient,
  AppCoreState,
  JsonRecord,
  WorkoutAppStore,
} from "../../core/contracts";
import { WorkoutApiError } from "../../core/api-client";
import type { AudioOutput, CueEvent } from "../../lib/workout-timeline";
import type { CompletionItem, SessionDetail } from "./session-types";
import { useSessionExecution } from "./use-session-execution";

const initialNow = Date.parse("2026-08-29T04:00:00.000Z");

interface ApiCall {
  path: string;
  options?: RequestInit;
}

interface ApiHarness {
  app: WorkoutAppStore;
  calls: ApiCall[];
}

interface TestAudio extends AudioOutput {
  activations: number;
  schedules: CueEvent[][];
  cancellations: number;
}

interface FrameClock {
  now(): number;
  advance(milliseconds: number): Promise<void>;
  pendingFrameCount(): number;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

type SessionExecution = ReturnType<typeof useSessionExecution>;

const mountedWrappers: VueWrapper[] = [];

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

function sessionDetail(options: {
  timed?: boolean;
  restSeconds?: number;
  intervals?: SessionDetail["training_intervals"];
} = {}): SessionDetail {
  const target = options.timed
    ? { metric: "duration_sec", min: 3, max: 5 }
    : { metric: "reps", min: 8, max: 8 };
  const firstItem: CompletionItem = {
    completion_item_key: "item-1",
    exercise_occurrence_key: "exercise-1",
    set_key: "set-1",
    side: "none" as const,
    target,
    resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
  };
  const secondItem: CompletionItem = {
    completion_item_key: "item-2",
    exercise_occurrence_key: "exercise-1",
    set_key: "set-2",
    side: "none" as const,
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
              target,
              resistance: firstItem.resistance,
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
    training_intervals: options.intervals ?? [{
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

function pausedDetail(detail: SessionDetail, endedAt = "2026-08-29T04:00:03.000Z"): SessionDetail {
  const result = clone(detail);
  const open = result.training_intervals.find((interval) => interval.ended_at === null);
  if (open) open.ended_at = endedAt;
  result.updated_at = endedAt;
  return result;
}

function resumedDetail(detail: SessionDetail, startedAt = "2026-08-29T04:00:04.000Z"): SessionDetail {
  const result = pausedDetail(detail);
  result.training_intervals.push({
    interval_key: `interval-${result.training_intervals.length + 1}`,
    started_at: startedAt,
    ended_at: null,
  });
  result.updated_at = startedAt;
  return result;
}

function completedFirstItem(detail: SessionDetail, actualValue = 8): SessionDetail {
  const result = clone(detail);
  result.completion_results = [{
    completion_item_key: "item-1",
    completed: true,
    actual: { metric: result.snapshot.completion_items?.[0]?.target.metric ?? "reps", value: actualValue },
    resistance: result.snapshot.completion_items?.[0]?.resistance ?? null,
    rir: null,
    completed_at: new Date(initialNow + 10_000).toISOString(),
  }];
  result.completion_fraction = 0.5;
  return result;
}

function terminalDetail(schemaVersion: 1 | 2): SessionDetail {
  const result = sessionDetail();
  const completedAt = "2026-08-29T04:00:10.000Z";
  const item = result.snapshot.completion_items?.[0];
  const set = result.snapshot.blocks?.[0]?.exercises?.[0]?.sets?.[0];
  result.status = "completed";
  result.snapshot.schema_version = schemaVersion;
  result.training_intervals[0].ended_at = completedAt;
  result.updated_at = completedAt;
  result.completion_fraction = 0.5;
  result.session_rpe = 7;
  result.note = "原训练备注";
  result.exercise_feedback = [{ exercise_occurrence_key: "exercise-1", text: "原动作反馈" }];

  if (schemaVersion === 2) {
    if (item) {
      item.resistance_mode = "external_load";
      item.resistance_kg = 12;
      item.resistance = { mode: "external_load", value: 12, unit: "kg" };
    }
    if (set) {
      set.resistance_mode = "external_load";
      set.resistance_kg = 12;
      set.resistance = { mode: "external_load", value: 12, unit: "kg" };
    }
    result.completion_results = [{
      completion_item_key: "item-1",
      status: "completed",
      actual: { metric: "reps", value: 8 },
      resistance: { mode: "external_load", value: 12, unit: "kg" },
      rir: 2,
      note: "原组备注",
      completed_at: completedAt,
    }];
  } else {
    result.completion_results = [{
      completion_item_key: "item-1",
      completed: true,
      actual: { metric: "reps", value: 8 },
      resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
      rir: 2,
      completed_at: completedAt,
    }];
  }
  return result;
}

function createApiHarness(
  responder: (path: string, options?: RequestInit) => Promise<JsonRecord>,
): ApiHarness {
  const calls: ApiCall[] = [];
  let key = 0;
  const api: ApiClient = {
    async request<T = JsonRecord>(path: string, options?: RequestInit): Promise<T> {
      calls.push({ path, options });
      return responder(path, options) as Promise<T>;
    },
    async response(path: string): Promise<Response> {
      throw new Error(`unexpected raw response request: ${path}`);
    },
    idempotencyKey: () => `ui-test-${++key}`,
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
      entry: { kind: "workout", title: "下肢力量" },
      session: null,
    },
    plan: null,
    progress: null,
    session: null,
  });
  const app: WorkoutAppStore = {
    state,
    api,
    bootstrap: async () => {},
    refresh: async () => {},
    login: async () => {},
    logout: async () => {},
    setMessage(message: string) { state.message = message; },
    setError(error: unknown) { state.error = error instanceof Error ? error.message : String(error); },
    clearError() { state.error = null; },
  };
  return { app, calls };
}

function frameClock(): FrameClock {
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
    pendingFrameCount: () => frames.size,
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

function testAudio(overrides: Partial<AudioOutput> = {}): TestAudio {
  const audio: TestAudio = {
    activations: 0,
    schedules: [],
    cancellations: 0,
    prepare: () => ({ ok: true }),
    activate() {
      audio.activations += 1;
      return overrides.activate?.() ?? { ok: true };
    },
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

function installSeams(clock: FrameClock, audio: AudioOutput): void {
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

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
}

function installWakeLock(value: unknown): void {
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value });
}

function mountExecution(app: WorkoutAppStore): {
  execution: SessionExecution;
  focusChanges: ReturnType<typeof vi.fn>;
  wrapper: VueWrapper;
} {
  const focusChanges = vi.fn();
  const Harness = defineComponent({
    name: "SessionExecutionHarness",
    setup() {
      return useSessionExecution(app, focusChanges);
    },
    template: "<div />",
  });
  const wrapper = mount(Harness);
  mountedWrappers.push(wrapper);
  return {
    execution: wrapper.vm as unknown as SessionExecution,
    focusChanges,
    wrapper,
  };
}

async function settle(): Promise<void> {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

function requestBody(call: ApiCall): JsonRecord {
  return JSON.parse(String(call.options?.body ?? "{}")) as JsonRecord;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(initialNow));
  setDocumentHidden(false);
  installWakeLock(undefined);
});

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
  await settle();
  Reflect.deleteProperty(window, "__workoutTestSeams");
  installWakeLock(undefined);
  setDocumentHidden(false);
  vi.useRealTimers();
});

describe("useSessionExecution", () => {
  function mixedEnduranceSession(options: { laterVisibleDone?: boolean } = {}): SessionDetail {
    const detail = sessionDetail();
    const block = detail.snapshot.blocks?.[0];
    const exercise = block?.exercises?.[0];
    if (!block || !exercise?.sets || !detail.snapshot.blocks || !detail.snapshot.completion_items) {
      throw new Error("expected executable Session fixture");
    }
    exercise.category = "strength";
    const thirdItem: CompletionItem = {
      completion_item_key: "item-3",
      exercise_occurrence_key: "exercise-1",
      set_key: "set-3",
      side: "none",
      target: { metric: "reps", min: 4, max: 4 },
      resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
    };
    exercise.sets.push({
      set_key: "set-3",
      ordinal: 3,
      target: thirdItem.target,
      resistance: thirdItem.resistance,
      rest_after_sec: 0,
    });
    const enduranceItem: CompletionItem = {
      completion_item_key: "endurance-item",
      exercise_occurrence_key: "endurance-1",
      set_key: "endurance-set-1",
      side: "none",
      target: { metric: "duration_sec", value: 3000 },
      resistance: { mode: "bodyweight" },
    };
    detail.snapshot.blocks.unshift({
      block_key: "endurance-block",
      title: "轻松跑",
      exercises: [{
        exercise_occurrence_key: "endurance-1",
        name: "户外轻松跑",
        category: "endurance",
        execution_mode: "none",
        sets: [{
          set_key: "endurance-set-1",
          ordinal: 1,
          target: enduranceItem.target,
          resistance: enduranceItem.resistance,
          rest_after_sec: 0,
        }],
      }],
    });
    detail.snapshot.completion_items = [
      enduranceItem,
      ...detail.snapshot.completion_items,
      thirdItem,
    ];
    detail.snapshot.exercise_occurrence_keys = ["endurance-1", "exercise-1"];
    if (options.laterVisibleDone) {
      detail.completion_results = ["item-2", "item-3"].map((completion_item_key) => ({
        completion_item_key,
        completed: true,
        actual: { metric: "reps", value: 6 },
        resistance: { mode: "external_weight", load_kg: 12, quantity: 1 },
        rir: null,
        completed_at: new Date(initialNow + 5_000).toISOString(),
      }));
      detail.completion_fraction = 0.5;
    }
    return detail;
  }

  test("a mixed endurance Session rests toward the immediate next executable item", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    let authority = mixedEnduranceSession();
    const harness = createApiHarness(async (path, options) => {
      if (path.endsWith("/start")) return clone(authority);
      if (path.endsWith("/record")) {
        authority = clone(authority);
        authority.completion_results = requestBody({ path, options }).completion_results as SessionDetail["completion_results"];
        return clone(authority);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    expect(execution.view.focusedItem?.completion_item_key).toBe("item-1");

    await execution.dispatch({ type: "complete" });

    expect(execution.view.restNextItem?.completion_item_key).toBe("item-2");
    await clock.advance(60_000);
    expect(execution.view.focusedItem?.completion_item_key).toBe("item-2");
  });

  test("a mixed endurance Session opens the end sheet after every executable item is done", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    let authority = mixedEnduranceSession({ laterVisibleDone: true });
    const harness = createApiHarness(async (path, options) => {
      if (path.endsWith("/start")) return clone(authority);
      if (path.endsWith("/record")) {
        authority = clone(authority);
        authority.completion_results = requestBody({ path, options }).completion_results as SessionDetail["completion_results"];
        authority.status = "partial";
        authority.completion_fraction = 0.75;
        return clone(authority);
      }
      if (path.endsWith("/pause")) {
        authority = pausedDetail(authority);
        return clone(authority);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    expect(execution.view.focusedItem?.completion_item_key).toBe("item-1");

    await execution.dispatch({ type: "complete" });

    expect(execution.view.state.endSheet).toBe(true);
    expect(execution.view.focusedItem?.completion_item_key).toBe("item-1");
  });

  test("start is immediately pending, deduplicates commands, and consumes its Session response", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const start = deferred<SessionDetail>();
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return start.promise;
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);

    const first = execution.dispatch({ type: "start" });
    const duplicate = execution.dispatch({ type: "start" });

    expect(execution.view.state.mutation).toEqual({ action: "start", pending: true, error: null });
    expect(harness.calls.filter((call) => call.path.endsWith("/start"))).toHaveLength(1);

    start.resolve(sessionDetail());
    await Promise.all([first, duplicate]);
    await settle();

    expect(execution.view.executionFocused).toBe(true);
    expect(execution.view.focusedItem?.completion_item_key).toBe("item-1");
    expect(execution.view.state.mutation).toEqual({ action: null, pending: false, error: null });
    expect(harness.calls.filter((call) => call.options?.method !== "POST")).toHaveLength(0);
  });

  test("a start response that arrives after the page is hidden is compensating-paused at the hidden boundary", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const requestWakeLock = vi.fn();
    installWakeLock({ request: requestWakeLock });
    const startGate = deferred<SessionDetail>();
    const started = sessionDetail();
    const paused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    let startResolved = false;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return startGate.promise;
      if (path.endsWith("/pause")) {
        expect(startResolved).toBe(true);
        return clone(paused);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);

    const start = execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    setDocumentHidden(true);
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(0);

    startResolved = true;
    startGate.resolve(clone(started));
    await start;
    await settle();

    const pauseCall = harness.calls.find((call) => call.path.endsWith("/pause"));
    expect(pauseCall).toBeDefined();
    expect(pauseCall?.options?.keepalive).toBe(true);
    expect(requestBody(pauseCall!)).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("visibility");
    expect(requestWakeLock).not.toHaveBeenCalled();
    expect(audio.schedules).toHaveLength(0);
  });

  test("an unmounted pending start is compensating-paused without rearming frames or Wake Lock", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const requestWakeLock = vi.fn(async () => ({
      released: false,
      release: async () => {},
      addEventListener: () => {},
    }));
    installWakeLock({ request: requestWakeLock });
    const startGate = deferred<SessionDetail>();
    const started = sessionDetail();
    const paused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return startGate.promise;
      if (path.endsWith("/pause")) return clone(paused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution, focusChanges, wrapper } = mountExecution(harness.app);

    const start = execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    wrapper.unmount();
    mountedWrappers.splice(mountedWrappers.indexOf(wrapper), 1);
    startGate.resolve(clone(started));
    await start;
    await settle();

    const pauseCall = harness.calls.find((call) => call.path.endsWith("/pause"));
    expect(pauseCall).toBeDefined();
    expect(requestBody(pauseCall!)).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(clock.pendingFrameCount()).toBe(0);
    expect(requestWakeLock).not.toHaveBeenCalled();
    expect(audio.schedules).toHaveLength(0);
    expect(focusChanges).toHaveBeenLastCalledWith(false);
  });

  test("failed start is retryable without leaving the Today surface", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    let attempts = 0;
    const harness = createApiHarness(async (path) => {
      if (!path.endsWith("/start")) throw new Error(`unexpected request: ${path}`);
      attempts += 1;
      if (attempts === 1) throw new WorkoutApiError("开始暂时失败，请重试", 503, {});
      return sessionDetail();
    });
    const { execution } = mountExecution(harness.app);

    await execution.dispatch({ type: "start" });
    expect(execution.view.state.mutation).toEqual({
      action: "start",
      pending: false,
      error: "开始暂时失败，请重试",
    });
    expect(execution.view.executionFocused).toBe(false);

    await execution.dispatch({ type: "start" });
    expect(attempts).toBe(2);
    expect(execution.view.executionFocused).toBe(true);
    expect(execution.view.state.mutation.error).toBeNull();
  });

  test("failed Completion Item save keeps drafts and mute never changes the retried Athlete input", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail({ restSeconds: 6 });
    let recordAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/record")) {
        recordAttempts += 1;
        if (recordAttempts === 1) throw new WorkoutApiError("保存暂时失败，请重试", 503, {});
        return completedFirstItem(started, 11);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await execution.dispatch({ type: "draft-actual", key: "item-1", value: "11" });
    await execution.dispatch({ type: "draft-feedback", key: "exercise-1", value: "动作很稳" });
    await execution.dispatch({ type: "toggle-mute" });
    expect(execution.view.state.muted).toBe(true);

    await execution.dispatch({ type: "complete" });

    expect(execution.view.state.mutation.error).toBe("保存暂时失败，请重试");
    expect(execution.view.focusActualDraft).toBe("11");
    expect(execution.view.focusFeedbackDraft).toBe("动作很稳");

    await execution.dispatch({ type: "complete" });

    const recordCalls = harness.calls.filter((call) => call.path.endsWith("/record"));
    expect(recordCalls).toHaveLength(2);
    expect(requestBody(recordCalls[1])).toMatchObject({
      completion_results: [{ actual: { metric: "reps", value: 11 } }],
      exercise_feedback: [{ exercise_occurrence_key: "exercise-1", text: "动作很稳" }],
    });
    expect(execution.view.completedCount).toBe(1);
    expect(execution.view.restActive).toBe(true);
    expect(harness.calls.filter((call) => call.path === "/api/private/sessions/session-1")).toHaveLength(0);
  });

  test("unsaved execution drafts survive a Today-equivalent component remount for the same auth epoch and Session", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const paused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return clone(paused);
      if (path === "/api/private/sessions/session-1") return clone(paused);
      throw new Error(`unexpected request: ${path}`);
    });
    const first = mountExecution(harness.app);
    await first.execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    await first.execution.dispatch({ type: "draft-actual", key: "item-1", value: "17" });
    await first.execution.dispatch({ type: "draft-weight", key: "item-1", value: "27.5" });
    await first.execution.dispatch({ type: "draft-rir", key: "item-1", value: "2" });
    await first.execution.dispatch({ type: "draft-feedback", key: "exercise-1", value: "跨页仍然稳定" });

    first.wrapper.unmount();
    mountedWrappers.splice(mountedWrappers.indexOf(first.wrapper), 1);
    await settle();

    const second = mountExecution(harness.app);
    await settle();

    expect(second.execution.view.detail?.session_key).toBe("session-1");
    expect(second.execution.view.focusActualDraft).toBe("17");
    expect(second.execution.view.focusResistanceDraft).toBe("27.5");
    expect(second.execution.view.focusRirDraft).toBe("2");
    expect(second.execution.view.focusFeedbackDraft).toBe("跨页仍然稳定");
  });

  test("an authentication epoch change clears execution drafts even when the next identity reuses the Session key", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await execution.dispatch({ type: "draft-actual", key: "item-1", value: "17" });
    await execution.dispatch({ type: "draft-weight", key: "item-1", value: "27.5" });
    await execution.dispatch({ type: "draft-rir", key: "item-1", value: "2" });
    await execution.dispatch({ type: "draft-feedback", key: "exercise-1", value: "旧认证身份输入" });

    harness.app.state.authEpoch += 1;
    await settle();

    expect(execution.view.focusActualDraft).toBe("8");
    expect(execution.view.focusResistanceDraft).toBe("12");
    expect(execution.view.focusRirDraft).toBe("");
    expect(execution.view.focusFeedbackDraft).toBe("");
  });

  test("a successful Completion Item submission clears only its cached drafts before a later remount", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const updated = completedFirstItem(started, 18);
    updated.exercise_feedback = [{ exercise_occurrence_key: "exercise-1", text: "服务端确认反馈" }];
    const pausedUpdated = pausedDetail(updated, "2026-08-29T04:00:01.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/record")) return clone(updated);
      if (path.endsWith("/pause")) return clone(pausedUpdated);
      if (path === "/api/private/sessions/session-1") return clone(pausedUpdated);
      throw new Error(`unexpected request: ${path}`);
    });
    const first = mountExecution(harness.app);
    await first.execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    await first.execution.dispatch({ type: "draft-actual", key: "item-1", value: "17" });
    await first.execution.dispatch({ type: "draft-weight", key: "item-1", value: "27.5" });
    await first.execution.dispatch({ type: "draft-rir", key: "item-1", value: "2" });
    await first.execution.dispatch({ type: "draft-feedback", key: "exercise-1", value: "尚未提交反馈" });
    await first.execution.dispatch({ type: "complete" });

    first.wrapper.unmount();
    mountedWrappers.splice(mountedWrappers.indexOf(first.wrapper), 1);
    await settle();
    const second = mountExecution(harness.app);
    await settle();
    await second.execution.dispatch({ type: "jump", index: 0 });

    expect(second.execution.view.focusActualDraft).toBe("18");
    expect(second.execution.view.focusResistanceDraft).toBe("12");
    expect(second.execution.view.focusRirDraft).toBe("");
    expect(second.execution.view.focusFeedbackDraft).toBe("服务端确认反馈");
  });

  test("binding a replacement Session deletes the prior Session draft bucket", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const sessionOne = sessionDetail();
    const sessionTwo = sessionDetail();
    sessionTwo.session_key = "session-2";
    sessionTwo.training_intervals[0].interval_key = "interval-2";
    let authority = sessionOne;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(sessionOne);
      if (path.endsWith("/pause")) {
        authority = pausedDetail(authority, "2026-08-29T04:00:01.000Z");
        return clone(authority);
      }
      if (path.startsWith("/api/private/sessions/")) return clone(authority);
      throw new Error(`unexpected request: ${path}`);
    });
    const first = mountExecution(harness.app);
    await first.execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    await first.execution.dispatch({ type: "draft-actual", key: "item-1", value: "17" });
    first.wrapper.unmount();
    mountedWrappers.splice(mountedWrappers.indexOf(first.wrapper), 1);
    await settle();

    authority = clone(sessionTwo);
    harness.app.state.session = clone(sessionTwo);
    if (harness.app.state.today) harness.app.state.today.session = clone(sessionTwo);
    const replacement = mountExecution(harness.app);
    await settle();
    replacement.wrapper.unmount();
    mountedWrappers.splice(mountedWrappers.indexOf(replacement.wrapper), 1);
    await settle();

    authority = pausedDetail(sessionOne, "2026-08-29T04:00:01.000Z");
    harness.app.state.session = clone(authority);
    if (harness.app.state.today) harness.app.state.today.session = clone(authority);
    const returned = mountExecution(harness.app);
    await settle();

    expect(returned.execution.view.detail?.session_key).toBe("session-1");
    expect(returned.execution.view.focusActualDraft).toBe("8");
  });

  test.each([1, 2] as const)(
    "terminal schema v%s correction sends the exact record PUT shape",
    async (schemaVersion) => {
      const clock = frameClock();
      installSeams(clock, testAudio());
      const terminal = terminalDetail(schemaVersion);
      const harness = createApiHarness(async (path) => {
        if (path === "/api/private/sessions/session-1") return clone(terminal);
        if (path.endsWith("/record")) return clone(terminal);
        throw new Error(`unexpected request: ${path}`);
      });
      harness.app.state.session = clone(terminal);
      if (harness.app.state.today) harness.app.state.today.session = clone(terminal);
      const { execution } = mountExecution(harness.app);
      await settle();

      await execution.dispatch({ type: "edit-session" });
      await execution.dispatch({ type: "draft-correction-item", key: "item-1", field: "value", value: "9" });
      await execution.dispatch({ type: "draft-correction-item", key: "item-1", field: "weight", value: "14" });
      await execution.dispatch({ type: "draft-correction-item", key: "item-1", field: "rir", value: "1" });
      await execution.dispatch({ type: "draft-correction-feedback", key: "exercise-1", value: "校正后动作反馈" });
      await execution.dispatch({ type: "draft-correction-rpe", value: "8" });
      await execution.dispatch({ type: "draft-correction-note", value: "校正后训练备注" });
      await execution.dispatch({ type: "save-correction" });

      const recordCall = harness.calls.find((call) => call.path.endsWith("/record"));
      expect(harness.app.state.error).toBeNull();
      expect(recordCall).toBeDefined();
      expect(recordCall?.options?.method).toBe("PUT");
      const commonRecord = {
        training_intervals: [{
          interval_key: "interval-1",
          started_at: "2026-08-29T04:00:00.000Z",
          ended_at: "2026-08-29T04:00:10.000Z",
        }],
        session_rpe: 8,
        note: "校正后训练备注",
        exercise_feedback: [{ exercise_occurrence_key: "exercise-1", text: "校正后动作反馈" }],
        skip_reason: null,
      };
      const record = requestBody(recordCall!);
      if (schemaVersion === 1) {
        expect(record).toEqual({
          record_schema_version: 1,
          completion_results: [{
            completion_item_key: "item-1",
            completed: true,
            actual: { metric: "reps", value: 9 },
            resistance: { mode: "external_weight", load_kg: 14, quantity: 1 },
            rir: 1,
            completed_at: "2026-08-29T04:00:10.000Z",
          }],
          ...commonRecord,
        });
        expect(record).not.toHaveProperty("set_results");
      } else {
        expect(record).toEqual({
          record_schema_version: 2,
          set_results: [{
            completion_item_key: "item-1",
            status: "completed",
            actual: { metric: "reps", value: 9 },
            resistance: { mode: "external_load", value: 14, unit: "kg" },
            rir: 1,
            note: "原组备注",
            completed_at: "2026-08-29T04:00:10.000Z",
          }],
          ...commonRecord,
        });
        expect(record).not.toHaveProperty("completion_results");
      }
    },
  );

  test("canonical no-op correction preserves partial status and explicit null resistance", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const terminal = terminalDetail(2);
    terminal.status = "partial";
    terminal.completion_results = [{
      completion_item_key: "item-1",
      status: "partial",
      actual: { metric: "reps", value: 5 },
      resistance: null,
      rir: 2,
      note: "保留组备注",
      completed_at: "2026-08-29T04:00:10.000Z",
    }];
    const harness = createApiHarness(async (path) => {
      if (path === "/api/private/sessions/session-1") return clone(terminal);
      if (path.endsWith("/record")) return clone(terminal);
      throw new Error(`unexpected request: ${path}`);
    });
    harness.app.state.session = clone(terminal);
    if (harness.app.state.today) harness.app.state.today.session = clone(terminal);
    const { execution } = mountExecution(harness.app);
    await settle();

    await execution.dispatch({ type: "edit-session" });
    await execution.dispatch({ type: "save-correction" });

    const recordCall = harness.calls.find((call) => call.path.endsWith("/record"));
    expect(recordCall).toBeDefined();
    expect(requestBody(recordCall!)).toMatchObject({
      record_schema_version: 2,
      set_results: [{
        completion_item_key: "item-1",
        status: "partial",
        actual: { metric: "reps", value: 5 },
        resistance: null,
        rir: 2,
        note: "保留组备注",
        completed_at: "2026-08-29T04:00:10.000Z",
      }],
    });
    expect(requestBody(recordCall!)).not.toHaveProperty("completion_results");
  });

  test("legacy no-op correction preserves the frozen resistance quantity", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const terminal = terminalDetail(1);
    const item = terminal.snapshot.completion_items?.[0];
    const set = terminal.snapshot.blocks?.[0]?.exercises?.[0]?.sets?.[0];
    if (!item || !set || !terminal.completion_results[0]) throw new Error("expected legacy terminal fixture");
    item.resistance = { mode: "external_weight", load_kg: 12, quantity: 2 };
    set.resistance = { mode: "external_weight", load_kg: 12, quantity: 2 };
    terminal.completion_results[0].resistance = { mode: "external_weight", load_kg: 12, quantity: 2 };
    const harness = createApiHarness(async (path) => {
      if (path === "/api/private/sessions/session-1") return clone(terminal);
      if (path.endsWith("/record")) return clone(terminal);
      throw new Error(`unexpected request: ${path}`);
    });
    harness.app.state.session = clone(terminal);
    if (harness.app.state.today) harness.app.state.today.session = clone(terminal);
    const { execution } = mountExecution(harness.app);
    await settle();

    await execution.dispatch({ type: "edit-session" });
    await execution.dispatch({ type: "save-correction" });

    const recordCall = harness.calls.find((call) => call.path.endsWith("/record"));
    expect(recordCall).toBeDefined();
    expect(requestBody(recordCall!)).toMatchObject({
      record_schema_version: 1,
      completion_results: [{
        completion_item_key: "item-1",
        completed: true,
        actual: { metric: "reps", value: 8 },
        resistance: { mode: "external_weight", load_kg: 12, quantity: 2 },
        rir: 2,
        completed_at: "2026-08-29T04:00:10.000Z",
      }],
    });
    expect(requestBody(recordCall!)).not.toHaveProperty("set_results");
  });

  test("pause and resume failures remain retryable without reopening time locally", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const paused = pausedDetail(started);
    const resumed = resumedDetail(started);
    let pauseAttempts = 0;
    let resumeAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        if (pauseAttempts === 1) throw new WorkoutApiError("暂停同步失败，请重试", 503, {});
        return clone(paused);
      }
      if (path.endsWith("/resume")) {
        resumeAttempts += 1;
        if (resumeAttempts === 1) throw new WorkoutApiError("继续同步失败，请重试", 503, {});
        return clone(resumed);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(3_000);

    await execution.dispatch({ type: "toggle-timer" });
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.mutation).toEqual({
      action: "pause",
      pending: false,
      error: "暂停同步失败，请重试",
    });

    await execution.dispatch({ type: "toggle-timer" });
    expect(pauseAttempts).toBe(2);
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).not.toBeNull();

    await execution.dispatch({ type: "toggle-timer" });
    expect(resumeAttempts).toBe(1);
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.mutation.error).toBe("继续同步失败，请重试");

    await execution.dispatch({ type: "toggle-timer" });
    expect(resumeAttempts).toBe(2);
    expect(execution.view.state.timerPaused).toBe(false);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBeNull();
  });

  test("a pending manual pause gates foreground resume until its authoritative response arrives", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const requestWakeLock = vi.fn(async () => ({
      released: false,
      release: async () => {},
      addEventListener: () => {},
    }));
    installWakeLock({ request: requestWakeLock });
    const started = sessionDetail();
    const paused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const pauseGate = deferred<SessionDetail>();
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return pauseGate.promise;
      if (path.endsWith("/resume")) throw new Error("resume must remain gated while pause is pending");
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await settle();
    const wakeRequestsBeforePause = requestWakeLock.mock.calls.length;
    await clock.advance(1_000);

    const pause = execution.dispatch({ type: "toggle-timer" });
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.mutation).toEqual({ action: "pause", pending: true, error: null });
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await execution.dispatch({ type: "toggle-timer" });

    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);
    expect(harness.calls.filter((call) => call.path.endsWith("/resume"))).toHaveLength(0);
    expect(requestWakeLock.mock.calls.length).toBe(wakeRequestsBeforePause);
    pauseGate.resolve(clone(paused));
    await pause;
    await settle();

    expect(execution.view.state.timerPaused).toBe(true);
    expect(["manual", "visibility"]).toContain(execution.view.state.timerPauseReason);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(clock.pendingFrameCount()).toBe(0);
    const elapsedAtPause = execution.view.elapsedLabel;
    await clock.advance(5_000);
    expect(execution.view.elapsedLabel).toBe(elapsedAtPause);
    expect(harness.calls.filter((call) => call.path.endsWith("/resume"))).toHaveLength(0);
  });

  test("manual, visibility, and pagehide share one logical pause descriptor when the first attempt never settles", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const closed = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const neverSettlingPause = new Promise<SessionDetail>(() => {});
    let pauseAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        return pauseAttempts === 1 ? neverSettlingPause : clone(closed);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    void execution.dispatch({ type: "toggle-timer" });
    await settle();

    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await clock.advance(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const pauseCalls = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(pauseCalls).toHaveLength(2);
    expect(new Headers(pauseCalls[1].options?.headers).get("Idempotency-Key"))
      .toBe(new Headers(pauseCalls[0].options?.headers).get("Idempotency-Key"));
    expect(pauseCalls[1].options?.body).toBe(pauseCalls[0].options?.body);
    expect(requestBody(pauseCalls[1])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
  });

  test("visibility and pagehide pause the server interval and foreground waits for manual continue", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const paused = pausedDetail(started, "2026-08-29T04:00:02.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return clone(paused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await execution.dispatch({ type: "start-timed" });
    await settle();
    await clock.advance(2_000);
    const remainingBeforeHidden = execution.view.actionRemainingLabel;

    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    const elapsedAtPause = execution.view.elapsedLabel;
    await clock.advance(30_000);

    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("visibility");
    expect(execution.view.actionRemainingLabel).toBe(remainingBeforeHidden);
    expect(execution.view.elapsedLabel).toBe(elapsedAtPause);
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);

    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.wakeNotice?.title).toBe("已回到前台，计时仍暂停");

    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(audio.cancellations).toBeGreaterThan(0);
    expect(execution.view.state.timerPauseReason).toBe("pagehide");
  });

  test("pagehide from an active interval persists a keepalive pause boundary", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const paused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return clone(paused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);

    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const pauseCall = harness.calls.find((call) => call.path.endsWith("/pause"));
    expect(pauseCall).toBeDefined();
    expect(pauseCall?.options?.method).toBe("POST");
    expect(pauseCall?.options?.headers).toMatchObject({
      "Idempotency-Key": expect.stringMatching(/^ui-test-\d+$/),
    });
    expect(pauseCall?.options?.keepalive).toBe(true);
    expect(requestBody(pauseCall!)).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("pagehide");
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
  });

  test.each(["start", "continue", "restart"] as const)(
    "pagehide recovers a never-settling %s with the same keepalive request before pausing",
    async (command) => {
      const clock = frameClock();
      installSeams(clock, testAudio());
      const originalRequest = new Promise<SessionDetail>(() => {});
      const current = sessionDetail({
        intervals: command === "continue"
          ? [{
              interval_key: "interval-previous",
              started_at: "2026-08-29T03:59:00.000Z",
              ended_at: "2026-08-29T03:59:59.000Z",
            }]
          : [],
      });
      current.status = command === "continue" ? "partial" : "skipped";
      current.skip_reason = command === "restart" ? "今天不适" : null;
      const recoveredActive = sessionDetail();
      const recoveredPaused = pausedDetail(recoveredActive, "2026-08-29T04:00:01.000Z");
      const harness = createApiHarness(async (path, options) => {
        if (path === "/api/private/sessions/session-1") return clone(current);
        if (path.endsWith(`/${command}`)) {
          return options?.keepalive ? clone(recoveredActive) : originalRequest;
        }
        if (path.endsWith("/pause")) return clone(recoveredPaused);
        throw new Error(`unexpected request: ${path}`);
      });
      if (command !== "start") {
        harness.app.state.session = clone(current);
        if (harness.app.state.today) harness.app.state.today.session = clone(current);
      }
      const { execution } = mountExecution(harness.app);
      await settle();

      let originalDispatchSettled = false;
      void execution.dispatch({ type: command }).then(
        () => { originalDispatchSettled = true; },
        () => { originalDispatchSettled = true; },
      );
      await settle();
      await clock.advance(1_000);
      window.dispatchEvent(new Event("pagehide"));
      await settle();

      const commandCalls = harness.calls.filter((call) => call.path.endsWith(`/${command}`));
      const pauseCalls = harness.calls.filter((call) => call.path.endsWith("/pause"));
      expect(commandCalls).toHaveLength(2);
      expect(commandCalls[0].options?.keepalive).toBe(false);
      expect(commandCalls[1].options?.keepalive).toBe(true);
      expect(commandCalls[1].options?.body).toBe(commandCalls[0].options?.body);
      expect(new Headers(commandCalls[1].options?.headers).get("Idempotency-Key"))
        .toBe(new Headers(commandCalls[0].options?.headers).get("Idempotency-Key"));
      expect(pauseCalls).toHaveLength(1);
      expect(pauseCalls[0].options?.method).toBe("POST");
      expect(pauseCalls[0].options?.keepalive).toBe(true);
      expect(new Headers(pauseCalls[0].options?.headers).get("Idempotency-Key"))
        .not.toBe(new Headers(commandCalls[0].options?.headers).get("Idempotency-Key"));
      expect(requestBody(pauseCalls[0])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
      expect(harness.calls.indexOf(pauseCalls[0])).toBeGreaterThan(harness.calls.indexOf(commandCalls[1]));
      expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
      expect(execution.view.state.timerPaused).toBe(true);
      expect(execution.view.state.timerPauseReason).toBe("pagehide");
      expect(originalDispatchSettled).toBe(false);
    },
  );

  test("pagehide upgrades a visibility interruption stuck on a never-settling start", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const originalStart = new Promise<SessionDetail>(() => {});
    const recoveredActive = sessionDetail();
    const recoveredPaused = pausedDetail(recoveredActive, "2026-08-29T04:00:01.000Z");
    const harness = createApiHarness(async (path, options) => {
      if (path.endsWith("/start")) {
        return options?.keepalive ? clone(recoveredActive) : originalStart;
      }
      if (path.endsWith("/pause")) return clone(recoveredPaused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);

    let originalDispatchSettled = false;
    void execution.dispatch({ type: "start" }).then(
      () => { originalDispatchSettled = true; },
      () => { originalDispatchSettled = true; },
    );
    await settle();
    await clock.advance(1_000);
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();

    expect(harness.calls.filter((call) => call.path.endsWith("/start"))).toHaveLength(1);
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(0);
    await clock.advance(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const startCalls = harness.calls.filter((call) => call.path.endsWith("/start"));
    const pauseCalls = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(startCalls).toHaveLength(2);
    expect(startCalls[0].options?.keepalive).toBe(false);
    expect(startCalls[1].options?.keepalive).toBe(true);
    expect(startCalls[1].options?.body).toBe(startCalls[0].options?.body);
    expect(new Headers(startCalls[1].options?.headers).get("Idempotency-Key"))
      .toBe(new Headers(startCalls[0].options?.headers).get("Idempotency-Key"));
    expect(pauseCalls).toHaveLength(1);
    expect(pauseCalls[0].options?.keepalive).toBe(true);
    expect(requestBody(pauseCalls[0])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(harness.calls.indexOf(pauseCalls[0])).toBeGreaterThan(harness.calls.indexOf(startCalls[1]));
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("pagehide");
    expect(originalDispatchSettled).toBe(false);
  });

  test("BFCache pageshow abandons a never-settling pagehide pause and reconciles the authoritative open Session", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const closed = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const neverSettlingPause = new Promise<SessionDetail>(() => {});
    let pauseAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path === "/api/private/sessions/session-1") return clone(started);
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        return pauseAttempts === 1 ? neverSettlingPause : clone(closed);
      }
      if (path.endsWith("/resume")) throw new Error("resume is forbidden before BFCache recovery closes the interval");
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);

    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);
    await settle();

    const pauseCalls = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(harness.calls.filter((call) => call.path === "/api/private/sessions/session-1")).toHaveLength(1);
    expect(pauseCalls).toHaveLength(2);
    expect(new Headers(pauseCalls[1].options?.headers).get("Idempotency-Key"))
      .toBe(new Headers(pauseCalls[0].options?.headers).get("Idempotency-Key"));
    expect(pauseCalls[1].options?.body).toBe(pauseCalls[0].options?.body);
    expect(pauseCalls[1].options?.keepalive).toBe(true);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(harness.calls.filter((call) => call.path.endsWith("/resume"))).toHaveLength(0);
  });

  test("a late response from the abandoned pagehide pause cannot overwrite BFCache authority", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const closed = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const stalePause = deferred<SessionDetail>();
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path === "/api/private/sessions/session-1") return clone(closed);
      if (path.endsWith("/pause")) return stalePause.promise;
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);
    await settle();
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");

    stalePause.resolve(clone(started));
    await settle();

    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);
  });

  test("repeated persisted pageshow events join one authoritative reconciliation", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const closed = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const stalePause = new Promise<SessionDetail>(() => {});
    const authority = deferred<SessionDetail>();
    let pauseAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path === "/api/private/sessions/session-1") return authority.promise;
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        return pauseAttempts === 1 ? stalePause : clone(closed);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const firstPageshow = new Event("pageshow");
    Object.defineProperty(firstPageshow, "persisted", { value: true });
    const secondPageshow = new Event("pageshow");
    Object.defineProperty(secondPageshow, "persisted", { value: true });
    window.dispatchEvent(firstPageshow);
    window.dispatchEvent(secondPageshow);
    await settle();
    expect(harness.calls.filter((call) => call.path === "/api/private/sessions/session-1")).toHaveLength(1);

    authority.resolve(clone(started));
    await settle();
    expect(harness.calls.filter((call) => call.path === "/api/private/sessions/session-1")).toHaveLength(1);
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(2);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
  });

  test("a failed BFCache authority read blocks resume and the first Continue retries reconciliation", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const closed = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const resumed = resumedDetail(closed, "2026-08-29T04:00:02.000Z");
    const neverSettlingPause = new Promise<SessionDetail>(() => {});
    let detailReads = 0;
    let pauseAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path === "/api/private/sessions/session-1") {
        detailReads += 1;
        if (detailReads === 1) throw new Error("BFCache authority unavailable");
        return clone(started);
      }
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        return pauseAttempts === 1 ? neverSettlingPause : clone(closed);
      }
      if (path.endsWith("/resume")) return clone(resumed);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    window.dispatchEvent(pageshow);
    await settle();

    expect(detailReads).toBe(1);
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.mutation.action).toBe("pause");
    expect(execution.view.state.mutation.error).toContain("BFCache authority unavailable");
    expect(harness.calls.filter((call) => call.path.endsWith("/resume"))).toHaveLength(0);

    await execution.dispatch({ type: "toggle-timer" });
    await settle();
    expect(detailReads).toBe(2);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(harness.calls.filter((call) => call.path.endsWith("/resume"))).toHaveLength(0);

    await execution.dispatch({ type: "toggle-timer" });
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/resume"))).toHaveLength(1);
    expect(execution.view.state.timerPaused).toBe(false);
  });

  test("navigation pause failure rejects ensurePaused and keeps the open interval visible", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) throw new Error("暂停写入失败");
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);

    await expect(execution.ensurePaused("navigation")).rejects.toThrow("暂停写入失败");

    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBeNull();
    expect(execution.view.state.mutation.error).toBe("暂停写入失败");
  });

  test("a pending resume response self-compensates when hidden changes without a visibility event", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const initiallyPaused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const resumed = resumedDetail(initiallyPaused, "2026-08-29T04:00:02.000Z");
    const finallyPaused = pausedDetail(resumed, "2026-08-29T04:00:03.000Z");
    const pendingResume = deferred<SessionDetail>();
    let pauseCalls = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) {
        pauseCalls += 1;
        return pauseCalls === 1 ? clone(initiallyPaused) : clone(finallyPaused);
      }
      if (path.endsWith("/resume")) return pendingResume.promise;
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    await execution.dispatch({ type: "toggle-timer" });
    await clock.advance(1_000);

    const resume = execution.dispatch({ type: "toggle-timer" });
    await clock.advance(1_000);
    setDocumentHidden(true);
    expect(pauseCalls).toBe(1);
    pendingResume.resolve(clone(resumed));
    await resume;
    await settle();

    const pauses = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(pauses).toHaveLength(2);
    expect(requestBody(pauses[0])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(requestBody(pauses[1])).toEqual({ close_at: "2026-08-29T04:00:03.000Z" });
    expect(pauses[1].options?.keepalive).toBe(true);
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("visibility");
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:03.000Z");
    expect(audio.schedules).toHaveLength(0);
  });

  test("pagehide recovers a never-settling resume with the same keepalive request before pausing", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const originalResume = new Promise<SessionDetail>(() => {});
    const started = sessionDetail();
    const manuallyPaused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const recoveredResume = resumedDetail(manuallyPaused, "2026-08-29T04:00:02.000Z");
    const pagehidePaused = pausedDetail(recoveredResume, "2026-08-29T04:00:03.000Z");
    let pauseAttempts = 0;
    const harness = createApiHarness(async (path, options) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/resume")) {
        return options?.keepalive ? clone(recoveredResume) : originalResume;
      }
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        return clone(pauseAttempts === 1 ? manuallyPaused : pagehidePaused);
      }
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    await execution.dispatch({ type: "toggle-timer" });
    await clock.advance(1_000);

    let originalDispatchSettled = false;
    void execution.dispatch({ type: "toggle-timer" }).then(
      () => { originalDispatchSettled = true; },
      () => { originalDispatchSettled = true; },
    );
    await settle();
    await clock.advance(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const resumeCalls = harness.calls.filter((call) => call.path.endsWith("/resume"));
    const pauseCalls = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(resumeCalls).toHaveLength(2);
    expect(resumeCalls[0].options?.keepalive).toBe(false);
    expect(resumeCalls[1].options?.keepalive).toBe(true);
    expect(resumeCalls[1].options?.body).toBe(resumeCalls[0].options?.body);
    expect(new Headers(resumeCalls[1].options?.headers).get("Idempotency-Key"))
      .toBe(new Headers(resumeCalls[0].options?.headers).get("Idempotency-Key"));
    expect(pauseCalls).toHaveLength(2);
    expect(requestBody(pauseCalls[0])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(requestBody(pauseCalls[1])).toEqual({ close_at: "2026-08-29T04:00:03.000Z" });
    expect(pauseCalls[1].options?.keepalive).toBe(true);
    expect(harness.calls.indexOf(pauseCalls[1])).toBeGreaterThan(harness.calls.indexOf(resumeCalls[1]));
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:03.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("pagehide");
    expect(originalDispatchSettled).toBe(false);
  });

  test("a second visibility interruption closes a deferred resume at the second hidden boundary", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const firstPaused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const resumed = resumedDetail(firstPaused, "2026-08-29T04:00:02.000Z");
    const finallyPaused = pausedDetail(resumed, "2026-08-29T04:00:03.000Z");
    const resumeGate = deferred<SessionDetail>();
    let pauseAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        return clone(pauseAttempts === 1 ? firstPaused : finallyPaused);
      }
      if (path.endsWith("/resume")) return resumeGate.promise;
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);

    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await clock.advance(1_000);

    const resume = execution.dispatch({ type: "toggle-timer" });
    await clock.advance(1_000);
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    resumeGate.resolve(clone(resumed));
    await resume;
    await settle();

    const pauseCalls = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(pauseCalls).toHaveLength(2);
    expect(requestBody(pauseCalls[0])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(requestBody(pauseCalls[1])).toEqual({ close_at: "2026-08-29T04:00:03.000Z" });
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:03.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("visibility");
    expect(audio.schedules).toHaveLength(0);
  });

  test("a record response that returns open after visibility loss is reconciled through an authoritative pause", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const recordGate = deferred<SessionDetail>();
    const updatedButOpen = completedFirstItem(started, 8);
    const paused = pausedDetail(updatedButOpen, "2026-08-29T04:00:01.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/record")) return recordGate.promise;
      if (path.endsWith("/pause")) return clone(paused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);

    const complete = execution.dispatch({ type: "complete" });
    expect(execution.view.state.mutation).toMatchObject({ action: "complete", pending: true });
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(0);

    recordGate.resolve(clone(updatedButOpen));
    await complete;
    await settle();

    const paths = harness.calls.map((call) => call.path);
    const recordIndex = paths.findIndex((path) => path.endsWith("/record"));
    const pauseIndex = paths.findIndex((path) => path.endsWith("/pause"));
    expect(recordIndex).toBeGreaterThanOrEqual(0);
    expect(pauseIndex).toBeGreaterThan(recordIndex);
    const pauseCall = harness.calls[pauseIndex];
    expect(pauseCall.options?.keepalive).toBe(true);
    expect(requestBody(pauseCall)).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(execution.view.completedCount).toBe(1);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("visibility");
    expect(execution.view.restActive).toBe(false);
  });

  test("pagehide skips a never-settling record request and immediately persists a new keepalive pause", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const originalRecord = new Promise<SessionDetail>(() => {});
    const started = sessionDetail({ restSeconds: 0 });
    const pagehidePaused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/record")) return originalRecord;
      if (path.endsWith("/pause")) return clone(pagehidePaused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });

    let originalDispatchSettled = false;
    void execution.dispatch({ type: "complete" }).then(
      () => { originalDispatchSettled = true; },
      () => { originalDispatchSettled = true; },
    );
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/record"))).toHaveLength(1);

    await clock.advance(1_000);
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    const recordCalls = harness.calls.filter((call) => call.path.endsWith("/record"));
    const pauseCalls = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0].options?.method).toBe("PUT");
    expect(recordCalls[0].options?.keepalive).not.toBe(true);
    expect(pauseCalls).toHaveLength(1);
    expect(pauseCalls[0].options?.method).toBe("POST");
    expect(pauseCalls[0].options?.keepalive).toBe(true);
    expect(requestBody(pauseCalls[0])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(harness.calls.indexOf(pauseCalls[0])).toBeGreaterThan(harness.calls.indexOf(recordCalls[0]));
    expect(execution.view.completedCount).toBe(0);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("pagehide");
    expect(execution.view.restActive).toBe(false);
    expect(clock.pendingFrameCount()).toBe(0);
    expect(audio.schedules).toHaveLength(0);
    expect(originalDispatchSettled).toBe(false);
  });

  test("pagehide cannot re-adopt a resume response whose HTTP settled before audio activation", async () => {
    const clock = frameClock();
    const resumeAudio = deferred<{ ok: true }>();
    const audio = testAudio({ activate: () => resumeAudio.promise });
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const firstPaused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const resumed = resumedDetail(firstPaused, "2026-08-29T04:00:02.000Z");
    const visibilityPaused = pausedDetail(resumed, "2026-08-29T04:00:03.000Z");
    let pauseAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) {
        pauseAttempts += 1;
        return clone(pauseAttempts === 1 ? firstPaused : visibilityPaused);
      }
      if (path.endsWith("/resume")) return clone(resumed);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);
    await execution.dispatch({ type: "toggle-timer" });
    await clock.advance(1_000);

    const resuming = execution.dispatch({ type: "toggle-timer" });
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/resume"))).toHaveLength(1);
    expect(audio.activations).toBe(1);
    expect(execution.view.state.mutation).toEqual({ action: null, pending: false, error: null });
    expect(execution.view.state.timerPaused).toBe(false);
    expect(execution.view.detail?.training_intervals.at(-1)).toMatchObject({
      started_at: "2026-08-29T04:00:02.000Z",
      ended_at: null,
    });

    await clock.advance(1_000);
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(2);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:03.000Z");

    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(2);

    resumeAudio.resolve({ ok: true });
    await resuming;
    await settle();

    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(2);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:03.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(audio.schedules).toHaveLength(0);
  });

  test("pagehide cannot re-adopt a record response whose HTTP settled before audio activation", async () => {
    const clock = frameClock();
    const recordAudio = deferred<{ ok: true }>();
    const audio = testAudio({ activate: () => recordAudio.promise });
    installSeams(clock, audio);
    const started = sessionDetail({ restSeconds: 60 });
    const recordedOpen = completedFirstItem(started, 8);
    const visibilityPaused = pausedDetail(recordedOpen, "2026-08-29T04:00:01.000Z");
    let recordSettled = false;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/record")) {
        recordSettled = true;
        return clone(recordedOpen);
      }
      if (path.endsWith("/pause")) return clone(visibilityPaused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });

    const completing = execution.dispatch({ type: "complete" });
    await settle();
    expect(recordSettled).toBe(true);
    expect(audio.activations).toBe(1);
    expect(execution.view.state.mutation).toEqual({ action: null, pending: false, error: null });
    expect(execution.view.completedCount).toBe(1);
    expect(execution.view.restActive).toBe(true);

    await clock.advance(1_000);
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    const restAtPause = execution.view.restRemainingLabel;

    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);

    recordAudio.resolve({ ok: true });
    await completing;
    await settle();

    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);
    expect(execution.view.completedCount).toBe(1);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.restActive).toBe(true);
    expect(audio.schedules).toHaveLength(0);
    await clock.advance(5_000);
    expect(execution.view.restRemainingLabel).toBe(restAtPause);
  });

  test("saving End waits for the authoritative pause response and submits its closed interval", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail();
    const paused = pausedDetail(started, "2026-08-29T04:00:01.000Z");
    const terminal = terminalDetail(1);
    const pauseGate = deferred<SessionDetail>();
    const endGate = deferred<SessionDetail>();
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return pauseGate.promise;
      if (path.endsWith("/end")) return endGate.promise;
      if (path === "/api/private/sessions/session-1") return clone(terminal);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await clock.advance(1_000);

    const openingEndSheet = execution.dispatch({ type: "end" });
    await settle();
    const saving = execution.dispatch({ type: "save-end" });
    await settle();

    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);
    expect(harness.calls.filter((call) => call.path.endsWith("/end"))).toHaveLength(0);

    pauseGate.resolve(clone(paused));
    await openingEndSheet;
    await settle();

    const pauseIndex = harness.calls.findIndex((call) => call.path.endsWith("/pause"));
    const endIndex = harness.calls.findIndex((call) => call.path.endsWith("/end"));
    expect(endIndex).toBeGreaterThan(pauseIndex);
    const endCall = harness.calls[endIndex];
    expect(requestBody(endCall)).toMatchObject({
      ended_at: expect.any(String),
      record: {
        record_schema_version: 1,
        training_intervals: [{
          interval_key: "interval-1",
          started_at: "2026-08-29T04:00:00.000Z",
          ended_at: "2026-08-29T04:00:01.000Z",
        }],
      },
    });

    endGate.resolve(clone(terminal));
    await saving;
    await settle();
  });

  test("late audio activation cannot re-arm cues after a visibility interruption", async () => {
    const clock = frameClock();
    const activation = deferred<{ ok: true }>();
    const audio = testAudio({ activate: () => activation.promise });
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const paused = pausedDetail(started);
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return clone(paused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });

    await execution.dispatch({ type: "start-timed" });
    await clock.advance(2_000);
    expect(execution.view.actionRemainingLabel).toBe("03");

    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    activation.resolve({ ok: true });
    await settle();

    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.actionRemainingLabel).toBe("03");
    expect(audio.schedules).toHaveLength(0);
  });

  test("deferred audio activation never blocks the visual countdown or shifts its absolute deadline", async () => {
    const clock = frameClock();
    const activation = deferred<{ ok: true }>();
    const audio = testAudio({ activate: () => activation.promise });
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });

    await execution.dispatch({ type: "start-timed" });
    expect(execution.view.actionRemainingLabel).toBe("05");
    expect(execution.view.state.timedAction.deadlineMs).toBe(initialNow + 5_000);
    expect(audio.schedules).toHaveLength(0);

    await clock.advance(2_000);
    expect(execution.view.actionRemainingLabel).toBe("03");
    expect(execution.view.state.timedAction.deadlineMs).toBe(initialNow + 5_000);

    activation.resolve({ ok: true });
    await settle();

    expect(audio.schedules).toHaveLength(1);
    expect(audio.schedules[0].find((event) => event.kind === "tempo" && event.value === 5)?.atMs).toBe(initialNow + 5_000);
    expect(audio.schedules[0].at(-1)).toEqual({ kind: "complete", value: 0, atMs: initialNow + 10_000 });
    expect(execution.view.state.timedAction.deadlineMs).toBe(initialNow + 5_000);

    await clock.advance(3_000);
    expect(execution.view.state.timedAction.phase).toBe("active");
    expect(execution.view.actionRemainingLabel).toBe("05");
    expect(execution.view.state.timedAction.deadlineMs).toBe(initialNow + 10_000);
    await clock.advance(5_000);
    expect(execution.view.state.timedAction.phase).toBe("complete");
    expect(execution.view.actionRemainingLabel).toBe("00");
  });

  test("Wake Lock release pauses execution and manual continue requests a new lock", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const listeners: Array<() => void> = [];
    const requests: string[] = [];
    const sentinels: Array<{ released: boolean; release(): Promise<void>; addEventListener(type: string, listener: () => void): void }> = [];
    installWakeLock({
      async request(type: string) {
        requests.push(type);
        const sentinel = {
          released: false,
          async release() { sentinel.released = true; },
          addEventListener(eventType: string, listener: () => void) {
            if (eventType === "release") listeners.push(listener);
          },
        };
        sentinels.push(sentinel);
        return sentinel;
      },
    });
    const started = sessionDetail({ timed: true });
    const paused = pausedDetail(started);
    const resumed = resumedDetail(started);
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return clone(paused);
      if (path.endsWith("/resume")) return clone(resumed);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await settle();
    expect(requests).toEqual(["screen"]);

    sentinels[0].released = true;
    listeners[0]();
    await settle();

    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("wake-lock");
    expect(execution.view.wakeNotice?.title).toBe("屏幕保持已中断，计时已暂停");

    await execution.dispatch({ type: "toggle-timer" });
    await settle();
    expect(execution.view.state.timerPaused).toBe(false);
    expect(requests).toEqual(["screen", "screen"]);
  });

  test("an already-released sentinel pauses reps, while a new start requests a fresh Wake Lock", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const firstWakeRequest = deferred<{
      released: boolean;
      release(): Promise<void>;
      addEventListener(type: string, listener: () => void): void;
    }>();
    const firstAddEventListener = vi.fn();
    const alreadyReleasedSentinel = {
      released: true,
      release: vi.fn(async () => {}),
      addEventListener: firstAddEventListener,
    };
    const secondSentinel = {
      released: false,
      async release() { secondSentinel.released = true; },
      addEventListener: vi.fn(),
    };
    let wakeAttempts = 0;
    const requestWakeLock = vi.fn(() => {
      wakeAttempts += 1;
      return wakeAttempts === 1 ? firstWakeRequest.promise : Promise.resolve(secondSentinel);
    });
    installWakeLock({ request: requestWakeLock });
    const firstStarted = sessionDetail();
    const firstPaused = pausedDetail(firstStarted, "2026-08-29T04:00:01.000Z");
    const secondStarted = sessionDetail();
    secondStarted.session_key = "session-2";
    secondStarted.training_intervals = [{
      interval_key: "interval-2",
      started_at: "2026-08-29T04:00:02.000Z",
      ended_at: null,
    }];
    secondStarted.updated_at = "2026-08-29T04:00:02.000Z";
    const secondPaused = pausedDetail(secondStarted, "2026-08-29T04:00:03.000Z");
    let startAttempts = 0;
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) {
        startAttempts += 1;
        return clone(startAttempts === 1 ? firstStarted : secondStarted);
      }
      if (path === "/api/private/sessions/session-1/pause") return clone(firstPaused);
      if (path === "/api/private/sessions/session-2/pause") return clone(secondPaused);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await settle();
    expect(requestWakeLock).toHaveBeenCalledTimes(1);
    expect(execution.view.state.timedAction.phase).toBe("idle");

    await clock.advance(1_000);
    firstWakeRequest.resolve(alreadyReleasedSentinel);
    await settle();

    const firstPause = harness.calls.find((call) => call.path === "/api/private/sessions/session-1/pause");
    expect(firstPause).toBeDefined();
    expect(firstPause?.options?.keepalive).toBe(true);
    expect(requestBody(firstPause!)).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(firstAddEventListener).not.toHaveBeenCalled();
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("wake-lock");
    expect(execution.view.state.wakeLockStatus).toBe("released");
    expect(execution.view.detail?.training_intervals.some((interval) => interval.ended_at === null)).toBe(false);

    await clock.advance(1_000);
    await execution.dispatch({ type: "start" });
    await settle();

    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(requestWakeLock.mock.calls).toEqual([["screen"], ["screen"]]);
    expect(secondSentinel.addEventListener).toHaveBeenCalledWith("release", expect.any(Function));
    expect(execution.view.detail?.session_key).toBe("session-2");
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBeNull();
    expect(execution.view.state.timerPaused).toBe(false);
    expect(execution.view.state.wakeLockStatus).toBe("active");
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(1);
  });

  test("unsupported Wake Lock is visible but never blocks a timed action", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const started = sessionDetail({ timed: true });
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });

    expect(execution.view.wakeNotice?.title).toBe("无法保持屏幕常亮");
    await execution.dispatch({ type: "start-timed" });
    expect(execution.view.state.timedAction.phase).toBe("preparing");
  });

  test("denied Wake Lock is visible but never blocks a timed action", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const requestWakeLock = vi.fn(async () => { throw new Error("denied"); });
    installWakeLock({ request: requestWakeLock });
    const started = sessionDetail({ timed: true });
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await settle();

    expect(requestWakeLock).toHaveBeenCalledTimes(1);
    expect(requestWakeLock).toHaveBeenCalledWith("screen");
    expect(execution.view.wakeNotice?.title).toBe("屏幕保持未获允许");
    await execution.dispatch({ type: "start-timed" });
    expect(execution.view.state.timedAction.phase).toBe("preparing");
  });

  test("a pending Wake Lock rejection cannot pause an already-started timed action", async () => {
    const clock = frameClock();
    installSeams(clock, testAudio());
    const wakeRequest = deferred<{
      released: boolean;
      release(): Promise<void>;
      addEventListener(type: string, listener: () => void): void;
    }>();
    const requestWakeLock = vi.fn(() => wakeRequest.promise);
    installWakeLock({ request: requestWakeLock });
    const started = sessionDetail({ timed: true });
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) throw new Error("Wake Lock denial must not pause execution");
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await settle();

    expect(requestWakeLock).toHaveBeenCalledTimes(1);
    expect(requestWakeLock).toHaveBeenCalledWith("screen");
    expect(execution.view.state.wakeLockStatus).toBe("requesting");
    await execution.dispatch({ type: "start-timed" });
    expect(execution.view.state.timedAction.phase).toBe("preparing");
    expect(execution.view.state.timerPaused).toBe(false);

    wakeRequest.reject(new Error("denied after timed action started"));
    await settle();
    await clock.advance(1_000);

    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(0);
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBeNull();
    expect(execution.view.state.timerPaused).toBe(false);
    expect(execution.view.state.wakeLockStatus).toBe("denied");
    expect(execution.view.wakeNotice?.title).toBe("屏幕保持未获允许");
    expect(execution.view.state.timedAction.phase).toBe("preparing");
    expect(execution.view.actionRemainingLabel).toBe("04");
  });

  test("fixed action and Session elapsed time freeze and resume on the same pause boundary", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const paused = pausedDetail(started, "2026-08-29T04:00:05.000Z");
    const resumed = resumedDetail(paused, "2026-08-29T04:00:15.000Z");
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/pause")) return clone(paused);
      if (path.endsWith("/resume")) return clone(resumed);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await execution.dispatch({ type: "start-timed" });
    await settle();
    await clock.advance(5_000);
    expect(execution.view.actionRemainingLabel).toBe("05");

    const cancellationsBeforePause = audio.cancellations;
    await execution.dispatch({ type: "toggle-timer" });
    const actionAtPause = execution.view.actionRemainingLabel;
    const elapsedAtPause = execution.view.elapsedLabel;
    const schedulesAtPause = audio.schedules.length;
    expect(audio.cancellations).toBeGreaterThan(cancellationsBeforePause);
    await clock.advance(10_000);

    expect(execution.view.actionRemainingLabel).toBe(actionAtPause);
    expect(execution.view.elapsedLabel).toBe(elapsedAtPause);
    expect(audio.schedules).toHaveLength(schedulesAtPause);

    await execution.dispatch({ type: "toggle-timer" });
    expect(execution.view.state.timerPaused).toBe(false);
    await clock.advance(1_000);

    expect(execution.view.actionRemainingLabel).toBe("04");
    expect(execution.view.elapsedLabel).toBe("00:06");
    expect(audio.schedules.at(-1)?.map(({ kind, value }) => [kind, value])).toEqual([
      ["tempo", 4],
      ["tempo-final", 3],
      ["tempo-final", 2],
      ["tempo-final", 1],
      ["complete", 0],
    ]);
  });

  test("audio activation failure leaves visual timing usable and unmute retries clear the error", async () => {
    const clock = frameClock();
    let activationAttempts = 0;
    const audio = testAudio({
      activate: () => ++activationAttempts === 1
        ? { ok: false, error: "音频播放被浏览器拒绝" }
        : { ok: true },
    });
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await execution.dispatch({ type: "start-timed" });
    await settle();

    expect(execution.view.audioFailed).toBe(true);
    expect(execution.view.state.timedAction.phase).toBe("preparing");
    await clock.advance(2_000);
    expect(execution.view.actionRemainingLabel).toBe("03");

    await execution.dispatch({ type: "toggle-mute" });
    await execution.dispatch({ type: "toggle-mute" });
    await settle();

    expect(activationAttempts).toBe(2);
    expect(execution.view.audioFailed).toBe(false);
    expect(execution.view.state.audio.error).toBeNull();
    expect(audio.schedules).toHaveLength(1);
  });

  test.each(["continue", "restart"] as const)(
    "%s is pending, deduplicated, and consumes the command Session response",
    async (command) => {
      const clock = frameClock();
      installSeams(clock, testAudio());
      const current = sessionDetail();
      current.status = command === "continue" ? "partial" : "skipped";
      current.training_intervals = command === "continue"
        ? [{ interval_key: "interval-1", started_at: current.training_intervals[0].started_at, ended_at: "2026-08-29T04:00:03.000Z" }]
        : [];
      current.skip_reason = command === "restart" ? "今天不适" : null;
      const active = clone(sessionDetail());
      active.snapshot.title = `${command}-response-session`;
      const response = deferred<SessionDetail>();
      const harness = createApiHarness(async (path) => {
        if (path === "/api/private/sessions/session-1") return clone(current);
        if (path.endsWith(`/${command}`)) return response.promise;
        throw new Error(`unexpected request: ${path}`);
      });
      harness.app.state.session = clone(current);
      if (harness.app.state.today) harness.app.state.today.session = clone(current);
      const { execution } = mountExecution(harness.app);
      await settle();
      const detailReadsBefore = harness.calls.filter((call) => call.path === "/api/private/sessions/session-1").length;
      expect(detailReadsBefore).toBe(1);

      const first = execution.dispatch({ type: command });
      const duplicate = execution.dispatch({ type: command });

      expect(execution.view.state.mutation).toEqual({ action: command, pending: true, error: null });
      expect(harness.calls.filter((call) => call.path.endsWith(`/${command}`))).toHaveLength(1);

      response.resolve(active);
      await Promise.all([first, duplicate]);
      await settle();

      expect(execution.view.executionFocused).toBe(true);
      expect(execution.view.detail?.snapshot.title).toBe(`${command}-response-session`);
      expect(execution.view.state.mutation).toEqual({ action: null, pending: false, error: null });
      expect(harness.calls.filter((call) => call.path === "/api/private/sessions/session-1")).toHaveLength(detailReadsBefore);
    },
  );

  test("a pending continue response self-compensates when hidden changes without a visibility event", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const current = sessionDetail({
      intervals: [{
        interval_key: "interval-1",
        started_at: "2026-08-29T03:59:00.000Z",
        ended_at: "2026-08-29T03:59:59.000Z",
      }],
    });
    current.status = "partial";
    const active = sessionDetail();
    const closed = pausedDetail(active, "2026-08-29T04:00:01.000Z");
    const continueGate = deferred<SessionDetail>();
    const harness = createApiHarness(async (path) => {
      if (path === "/api/private/sessions/session-1") return clone(current);
      if (path.endsWith("/continue")) return continueGate.promise;
      if (path.endsWith("/pause")) return clone(closed);
      throw new Error(`unexpected request: ${path}`);
    });
    harness.app.state.session = clone(current);
    if (harness.app.state.today) harness.app.state.today.session = clone(current);
    const { execution } = mountExecution(harness.app);
    await settle();
    const detailReadsBefore = harness.calls.filter((call) => call.path === "/api/private/sessions/session-1").length;

    const continuing = execution.dispatch({ type: "continue" });
    await clock.advance(1_000);
    setDocumentHidden(true);
    expect(harness.calls.filter((call) => call.path.endsWith("/pause"))).toHaveLength(0);

    continueGate.resolve(clone(active));
    await continuing;
    await settle();

    const pauses = harness.calls.filter((call) => call.path.endsWith("/pause"));
    expect(pauses).toHaveLength(1);
    expect(pauses[0].options?.method).toBe("POST");
    expect(pauses[0].options?.keepalive).toBe(true);
    expect(pauses[0].options?.headers).toMatchObject({
      "Idempotency-Key": expect.stringMatching(/^ui-test-\d+$/),
    });
    expect(requestBody(pauses[0])).toEqual({ close_at: "2026-08-29T04:00:01.000Z" });
    expect(execution.view.detail?.training_intervals.at(-1)?.ended_at).toBe("2026-08-29T04:00:01.000Z");
    expect(execution.view.state.timerPaused).toBe(true);
    expect(execution.view.state.timerPauseReason).toBe("visibility");
    expect(execution.view.executionFocused).toBe(true);
    expect(audio.schedules).toHaveLength(0);
    expect(harness.calls.filter((call) => call.path === "/api/private/sessions/session-1")).toHaveLength(detailReadsBefore);
  });

  test("fixed duration starts immediately, saves only on confirmation, and preserves the rest completion tail", async () => {
    const clock = frameClock();
    const audio = testAudio();
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true, restSeconds: 1 });
    const updated = completedFirstItem(started, 4);
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      if (path.endsWith("/record")) return clone(updated);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });

    await execution.dispatch({ type: "start-timed" });
    await settle();
    expect(execution.view.actionRemainingLabel).toBe("05");
    expect(audio.schedules[0].map(({ kind, value }) => [kind, value])).toEqual([
      ["warmup", 5],
      ["warmup", 4],
      ["warmup", 3],
      ["warmup", 2],
      ["warmup", 1],
      ["tempo", 5],
      ["tempo", 4],
      ["tempo-final", 3],
      ["tempo-final", 2],
      ["tempo-final", 1],
      ["complete", 0],
    ]);

    await clock.advance(5_000);
    expect(execution.view.actionRemainingLabel).toBe("05");
    await clock.advance(5_000);
    expect(execution.view.actionRemainingLabel).toBe("00");
    expect(execution.view.focusActualDraft).toBe("5");
    expect(harness.calls.filter((call) => call.path.endsWith("/record"))).toHaveLength(0);

    await execution.dispatch({ type: "draft-actual", key: "item-1", value: "4" });
    await execution.dispatch({ type: "complete" });

    const recordCall = harness.calls.find((call) => call.path.endsWith("/record"));
    expect(recordCall).toBeDefined();
    expect(requestBody(recordCall!)).toMatchObject({
      completion_results: [{ actual: { metric: "duration_sec", value: 4 } }],
    });
    expect(execution.view.restActive).toBe(true);
    expect(execution.view.restRemainingLabel).toBe("00:01");
    const cancellationsAtRestStart = audio.cancellations;

    await clock.advance(1_000);

    expect(execution.view.restActive).toBe(false);
    expect(execution.view.focusedItem?.completion_item_key).toBe("item-2");
    expect(audio.cancellations).toBe(cancellationsAtRestStart);
    expect(audio.schedules.at(-1)?.at(-1)).toMatchObject({ kind: "rest-complete", value: 0 });
  });

  test("muting again invalidates an in-flight unmute activation", async () => {
    const clock = frameClock();
    const unmute = deferred<{ ok: true }>();
    let activations = 0;
    const audio = testAudio({
      activate: () => {
        activations += 1;
        return activations === 1 ? { ok: true } : unmute.promise;
      },
    });
    installSeams(clock, audio);
    const started = sessionDetail({ timed: true });
    const harness = createApiHarness(async (path) => {
      if (path.endsWith("/start")) return clone(started);
      throw new Error(`unexpected request: ${path}`);
    });
    const { execution } = mountExecution(harness.app);
    await execution.dispatch({ type: "start" });
    await execution.dispatch({ type: "start-timed" });
    await settle();
    await execution.dispatch({ type: "toggle-mute" });
    audio.schedules.length = 0;

    const pendingUnmute = execution.dispatch({ type: "toggle-mute" });
    await execution.dispatch({ type: "toggle-mute" });
    unmute.resolve({ ok: true });
    await pendingUnmute;
    await settle();

    expect(execution.view.state.muted).toBe(true);
    expect(audio.schedules).toHaveLength(0);
  });
});
