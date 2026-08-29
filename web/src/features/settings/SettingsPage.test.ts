import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient, WorkoutApiError } from "../../core/api-client";
import { createWorkoutAppStore } from "../../core/app-store";
import type { ApiClient, AppCoreState, WorkoutAppStore } from "../../core/contracts";
import SettingsPage from "./SettingsPage.vue";

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

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

const singleDraft = JSON.stringify({
  schema_version: 2,
  effective_from: "2026-09-07",
  week: { monday: { kind: "rest" } },
});

const singlePreview = {
  effective_from: "2026-09-07",
  changed_weekday_slot_count: 1,
  week: { monday: { kind: "rest" } },
};

const batchDraft = JSON.stringify({
  schema_version: 1,
  updates: [
    { schema_version: 2, effective_from: "2026-09-07", week: { monday: { kind: "rest" } } },
    { schema_version: 2, effective_from: "2026-09-14", week: { monday: { kind: "rest" } } },
  ],
});

const batchPreview = {
  from: "2026-09-07",
  to: "2026-09-20",
  update_count: 2,
  updates: [
    { effective_from: "2026-09-07", changed_weekday_slot_count: 1, week: { monday: { kind: "rest" } } },
    { effective_from: "2026-09-14", changed_weekday_slot_count: 1, week: { monday: { kind: "rest" } } },
  ],
};

function state(): AppCoreState {
  return reactive({
    view: "settings",
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
      first_effective_from: "2026-08-25",
      current: { revision_key: "revision-current" },
      future: [],
    },
    progress: null,
    session: null,
  });
}

function settingsHarness(
  implementation?: (path: string, options?: RequestInit) => Promise<unknown>,
) {
  const core = state();
  const request = vi.fn(implementation ?? (async (path: string) => {
    if (path === "/api/private/me") {
      return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
    }
    if (path === "/api/private/coach-share") {
      return { active: false, share_key: null, url: null };
    }
    if (path === "/api/private/agent-access") {
      return { active: false, created_at: null, rotated_at: null, revoked_at: null };
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  const refresh = vi.fn(async () => {});
  const logout = vi.fn(async () => {});
  const setMessage = vi.fn((message: string) => {
    core.message = message;
  });
  const setError = vi.fn((error: unknown) => {
    core.error = error instanceof Error ? error.message : String(error);
  });
  const clearError = vi.fn(() => {
    core.error = null;
  });
  const api: ApiClient = {
    async request<T>(path: string, options?: RequestInit): Promise<T> {
      return await request(path, options) as T;
    },
    async response(): Promise<Response> {
      throw new Error("Unexpected raw response request");
    },
    idempotencyKey: vi.fn(() => "plan-idempotency-key"),
  };
  const app: WorkoutAppStore = {
    state: core,
    api,
    bootstrap: vi.fn(async () => {}),
    refresh,
    login: vi.fn(async () => {}),
    logout,
    setMessage,
    setError,
    clearError,
  };
  return { app, request, refresh, logout, setError, clearError };
}

function button(wrapper: VueWrapper, label: string) {
  const result = wrapper.findAll("button").find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

function callFor(request: ReturnType<typeof vi.fn>, path: string) {
  return request.mock.calls.find(([candidate]) => candidate === path);
}

async function openEditor(wrapper: VueWrapper, draft: string): Promise<void> {
  await button(wrapper, "编排未来计划").trigger("click");
  await wrapper.get("#plan-json").setValue(draft);
}

function installStaleUiSideEffectSpies() {
  const clipboardWrite = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
  const createObjectURL = vi.fn(() => "blob:stale-settings-effect");
  const revokeObjectURL = vi.fn();
  class SideEffectUrl extends URL {}
  Object.defineProperties(SideEffectUrl, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  vi.stubGlobal("URL", SideEffectUrl);
  const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { clipboardWrite, createObjectURL, revokeObjectURL, downloadClick };
}

describe("Settings plan preview boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("validates a single-week package before exposing the mutating confirmation", async () => {
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan-updates/validate") return { preview: singlePreview };
      if (path === "/api/private/plan-updates/apply") return { applied: true };
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await openEditor(wrapper, singleDraft);
    expect(wrapper.findAll("button").some((item) => item.text() === "确认应用")).toBe(false);

    await button(wrapper, "检查计划").trigger("click");
    await flushPromises();

    const validationCall = callFor(harness.request, "/api/private/plan-updates/validate");
    expect(validationCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(validationCall?.[1]?.body))).toEqual({ package_text: singleDraft });
    expect(callFor(harness.request, "/api/private/plan-updates/apply")).toBeUndefined();
    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("确认更新计划");
    expect(wrapper.get('[role="dialog"]').text()).toContain("2026-09-07 生效");

    await button(wrapper, "确认应用").trigger("click");
    await flushPromises();

    const applyCall = callFor(harness.request, "/api/private/plan-updates/apply");
    expect(applyCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Idempotency-Key": "plan-idempotency-key" },
    });
    expect(JSON.parse(String(applyCall?.[1]?.body))).toEqual({ package_text: singleDraft });
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("refreshes authoritative state after an unmounted confirmed apply without stale UI effects", async () => {
    const applyGate = deferred<unknown>();
    const sideEffects = installStaleUiSideEffectSpies();
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") {
        return { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" };
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan-updates/validate") return { preview: singlePreview };
      if (path === "/api/private/plan-updates/apply") return applyGate.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const windowOne = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await openEditor(windowOne, singleDraft);
    await button(windowOne, "检查计划").trigger("click");
    await flushPromises();
    await button(windowOne, "确认应用").trigger("click");
    await nextTick();

    expect(harness.request.mock.calls.filter(([path]) => (
      path === "/api/private/plan-updates/apply"
    ))).toHaveLength(1);
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(harness.app.state.authEpoch).toBe(0);
    windowOne.unmount();

    applyGate.resolve({ applied: true });
    await flushPromises();

    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(harness.app.setMessage).not.toHaveBeenCalled();
    expect(harness.app.state.message).toBe("");
    expect(harness.setError).not.toHaveBeenCalled();
    expect(sideEffects.clipboardWrite).not.toHaveBeenCalled();
    expect(sideEffects.createObjectURL).not.toHaveBeenCalled();
    expect(sideEffects.revokeObjectURL).not.toHaveBeenCalled();
    expect(sideEffects.downloadClick).not.toHaveBeenCalled();
  });

  it("binds batch confirmation to the exact validation evidence", async () => {
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan-update-batches/validate") {
        return {
          preview: batchPreview,
          batch_digest: "batch-digest",
          base_plan_digest: "base-plan-digest",
        };
      }
      if (path === "/api/private/plan-update-batches/apply") return { applied: true };
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await openEditor(wrapper, batchDraft);
    await button(wrapper, "检查计划").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("确认 2 周计划");
    expect(callFor(harness.request, "/api/private/plan-update-batches/apply")).toBeUndefined();

    await button(wrapper, "确认应用").trigger("click");
    await flushPromises();

    const applyCall = callFor(harness.request, "/api/private/plan-update-batches/apply");
    expect(applyCall?.[1]).toMatchObject({
      method: "POST",
      headers: { "Idempotency-Key": "plan-idempotency-key" },
    });
    expect(JSON.parse(String(applyCall?.[1]?.body))).toEqual({
      batch_text: batchDraft,
      batch_digest: "batch-digest",
      base_plan_digest: "base-plan-digest",
      confirmed: true,
    });
  });

  it("cancels a validated preview without applying and retains the editable draft", async () => {
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan-updates/validate") return { preview: singlePreview };
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await openEditor(wrapper, singleDraft);
    await button(wrapper, "检查计划").trigger("click");
    await flushPromises();
    await button(wrapper, "取消").trigger("click");

    expect(callFor(harness.request, "/api/private/plan-updates/apply")).toBeUndefined();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);

    await button(wrapper, "编排未来计划").trigger("click");
    expect((wrapper.get("#plan-json").element as HTMLTextAreaElement).value).toBe(singleDraft);
    expect(wrapper.findAll("button").some((item) => item.text() === "确认应用")).toBe(false);
  });

  it("renders structured validation failures inside the editor and never exposes apply", async () => {
    const validationError = Object.assign(new Error("invalid plan"), {
      data: {
        error: {
          message: "计划需要修正",
          details: [
            { path: "updates[0].effective_from", message: "必须是连续周一" },
            { path: "updates", message: "至少需要 2 周" },
          ],
        },
      },
    });
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan-update-batches/validate") throw validationError;
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await openEditor(wrapper, batchDraft);
    await button(wrapper, "检查计划").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("计划需要修正");
    expect(wrapper.get('[role="dialog"]').text()).toContain("updates[0].effective_from: 必须是连续周一");
    expect(wrapper.get('[role="dialog"]').text()).toContain("updates: 至少需要 2 周");
    expect(wrapper.findAll("button").some((item) => item.text() === "确认应用")).toBe(false);
    expect(callFor(harness.request, "/api/private/plan-update-batches/apply")).toBeUndefined();
    expect(harness.setError).not.toHaveBeenCalled();

    await wrapper.get("#plan-json").setValue(`${batchDraft} `);
    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("编排未来计划");
  });

  it("does not close or refresh when the confirmed apply fails", async () => {
    const applyError = new Error("计划基线已经变化，请重新检查");
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan-updates/validate") return { preview: singlePreview };
      if (path === "/api/private/plan-updates/apply") throw applyError;
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await openEditor(wrapper, singleDraft);
    await button(wrapper, "检查计划").trigger("click");
    await flushPromises();
    await button(wrapper, "确认应用").trigger("click");
    await flushPromises();

    expect(harness.setError).toHaveBeenCalledWith(applyError);
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(button(wrapper, "确认应用").attributes("disabled")).toBeUndefined();
  });

  it("discards a late validation response after the athlete edits the draft", async () => {
    const validationGate = deferred<unknown>();
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan-updates/validate") return validationGate.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await openEditor(wrapper, singleDraft);
    await button(wrapper, "检查计划").trigger("click");
    expect(button(wrapper, "检查计划").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "取消").attributes("disabled")).toBeDefined();

    const revisedDraft = singleDraft.replace("2026-09-07", "2026-09-14");
    await wrapper.get("#plan-json").setValue(revisedDraft);
    validationGate.resolve({ preview: singlePreview });
    await flushPromises();

    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("编排未来计划");
    expect((wrapper.get("#plan-json").element as HTMLTextAreaElement).value).toBe(revisedDraft);
    expect(wrapper.findAll("button").some((item) => item.text() === "确认应用")).toBe(false);
  });
});

describe("Settings supporting state boundaries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("does not append a profile read while a private 401 opens one auth epoch", async () => {
    const unauthorized = new WorkoutApiError("请先登录", 401, {
      error: { code: "authentication_required", message: "请先登录", details: [] },
    });
    const request = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/api/private/me") {
        return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      }
      if (path === "/api/private/coach-share" && options?.method === "POST") throw unauthorized;
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const api: ApiClient = {
      async request<T>(path: string, options?: RequestInit): Promise<T> {
        return await request(path, options) as T;
      },
      async response(): Promise<Response> {
        throw new Error("Unexpected raw response request");
      },
      idempotencyKey: () => "settings-401-key",
    };
    const app = createWorkoutAppStore(api);
    Object.assign(app.state, {
      view: "settings",
      loading: false,
      today: {
        date: "2026-08-29",
        timezone: "Asia/Shanghai",
        entry: null,
        session: null,
      },
      plan: {
        timezone: "Asia/Shanghai",
        first_effective_from: "2026-08-25",
        current: null,
        future: [],
      },
    });
    const wrapper = mount(SettingsPage, { props: { app } });
    await flushPromises();
    expect(request.mock.calls.filter(([path]) => path === "/api/private/me")).toHaveLength(1);

    await button(wrapper, "创建分享").trigger("click");
    await flushPromises();

    expect(app.state.authRequired).toBe(true);
    expect(app.state.authEpoch).toBe(1);
    expect(request.mock.calls.filter(([path]) => path === "/api/private/me")).toHaveLength(1);
    expect(request.mock.calls.filter(([path, options]) => (
      path === "/api/private/coach-share" && options?.method === "POST"
    ))).toHaveLength(1);
  });

  it("fails closed when share and Agent access status cannot be read", async () => {
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") throw new Error("share unavailable");
      if (path === "/api/private/agent-access") throw new Error("agent unavailable");
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    expect(wrapper.text()).toContain("分享状态暂时无法读取");
    expect(wrapper.text()).toContain("Agent access 状态暂时无法读取");
    expect(wrapper.findAll("button").some((item) => item.text() === "创建分享")).toBe(false);
    expect(wrapper.findAll("button").some((item) => item.text() === "创建 Token")).toBe(false);
  });

  it("does not overwrite a dirty profile field when the initial read arrives late", async () => {
    const profileGate = deferred<unknown>();
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return profileGate.promise;
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await wrapper.get('input[name="display_name"]').setValue("尚未保存的名称");
    profileGate.resolve({ athlete_key: "athlete", display_name: "服务器名称", timezone: "America/New_York" });
    await flushPromises();

    expect((wrapper.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("尚未保存的名称");
    expect((wrapper.get('input[name="timezone"]').element as HTMLInputElement).value).toBe("Asia/Shanghai");
  });

  it("refreshes authoritative state after an unmounted profile PUT without stale UI effects", async () => {
    const profileMutation = deferred<unknown>();
    const sideEffects = installStaleUiSideEffectSpies();
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") {
        return { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" };
      }
      if (path === "/api/private/settings" && options?.method === "PUT") {
        return profileMutation.promise;
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const windowOne = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await windowOne.get('input[name="timezone"]').setValue("America/New_York");
    await windowOne.get("form.settings-form").trigger("submit");
    await nextTick();

    const putCalls = harness.request.mock.calls.filter(([path, options]) => (
      path === "/api/private/settings" && options?.method === "PUT"
    ));
    expect(putCalls).toHaveLength(1);
    expect(JSON.parse(String(putCalls[0]?.[1]?.body))).toEqual({
      display_name: "Athlete A",
      timezone: "America/New_York",
    });
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(harness.app.state.authEpoch).toBe(0);
    windowOne.unmount();

    profileMutation.resolve({
      display_name: "Athlete A",
      timezone: "America/New_York",
    });
    await flushPromises();

    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(harness.app.setMessage).not.toHaveBeenCalled();
    expect(harness.app.state.message).toBe("");
    expect(harness.setError).not.toHaveBeenCalled();
    expect(sideEffects.clipboardWrite).not.toHaveBeenCalled();
    expect(sideEffects.createObjectURL).not.toHaveBeenCalled();
    expect(sideEffects.revokeObjectURL).not.toHaveBeenCalled();
    expect(sideEffects.downloadClick).not.toHaveBeenCalled();
  });

  it("opens the current-plan editor even when copying to the clipboard fails", async () => {
    const clipboardWrite = vi.fn(async () => {
      throw new Error("clipboard denied");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const packageValue = {
      schema_version: 2,
      effective_from: "2026-09-07",
      week: { monday: { kind: "rest" } },
    };
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      if (path === "/api/private/plan/update-package") return packageValue;
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(wrapper, "复制当前单周 JSON").trigger("click");
    await flushPromises();

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("编排未来计划");
    expect((wrapper.get("#plan-json").element as HTMLTextAreaElement).value).toBe(JSON.stringify(packageValue, null, 2));
    expect(harness.setError).not.toHaveBeenCalled();
    expect(harness.app.state.message).toContain("编辑框复制");
  });

  it("sends share creation and Agent Token creation only once on double click", async () => {
    const shareGate = deferred<unknown>();
    const tokenGate = deferred<unknown>();
    let shareReads = 0;
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") return { athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" };
      if (path === "/api/private/coach-share" && options?.method === "POST") return shareGate.promise;
      if (path === "/api/private/coach-share") {
        shareReads += 1;
        return shareReads === 1
          ? { active: false, share_key: null, url: null }
          : { active: true, share_key: "share", url: "https://example.test/share" };
      }
      if (path === "/api/private/agent-access" && options?.method === "POST") return tokenGate.promise;
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(wrapper, "创建分享").trigger("click");
    await button(wrapper, "创建分享").trigger("click");
    expect(harness.request.mock.calls.filter(([path, options]) => (
      path === "/api/private/coach-share" && options?.method === "POST"
    ))).toHaveLength(1);

    await button(wrapper, "创建 Token").trigger("click");
    await button(wrapper, "创建 Token").trigger("click");
    expect(harness.request.mock.calls.filter(([path, options]) => (
      path === "/api/private/agent-access" && options?.method === "POST"
    ))).toHaveLength(1);

    shareGate.resolve({});
    tokenGate.resolve({
      active: true,
      token: "agent-token",
      created_at: "2026-08-29T12:00:00Z",
      rotated_at: null,
      revoked_at: null,
    });
    await flushPromises();
  });

  it("does not carry an Athlete A draft or Token through logout into Athlete B", async () => {
    let athleteKey = "athlete-a";
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") {
        return {
          athlete_key: athleteKey,
          display_name: athleteKey === "athlete-a" ? "Athlete A" : "Athlete B",
          timezone: "Asia/Shanghai",
        };
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access" && options?.method === "POST") {
        return {
          active: true,
          token: "athlete-a-secret-token",
          created_at: "2026-08-29T12:00:00Z",
          rotated_at: null,
          revoked_at: null,
        };
      }
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    harness.logout.mockImplementation(async () => {
      harness.app.state.authEpoch += 1;
      harness.app.state.authRequired = true;
    });
    const athleteA = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(athleteA, "创建 Token").trigger("click");
    await flushPromises();
    expect((athleteA.get('input[aria-label="本次 Agent Token"]').element as HTMLInputElement).value)
      .toBe("athlete-a-secret-token");

    await openEditor(athleteA, "athlete-a-private-draft");
    await button(athleteA, "取消").trigger("click");
    await button(athleteA, "退出登录").trigger("click");
    await flushPromises();

    expect(athleteA.find('input[aria-label="本次 Agent Token"]').exists()).toBe(false);
    athleteA.unmount();

    athleteKey = "athlete-b";
    harness.app.state.authRequired = false;
    harness.app.state.authEpoch += 1;
    const athleteB = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();
    await button(athleteB, "编排未来计划").trigger("click");

    expect((athleteB.get("#plan-json").element as HTMLTextAreaElement).value).toBe("");
    expect(athleteB.find('input[aria-label="本次 Agent Token"]').exists()).toBe(false);
    expect(athleteB.html()).not.toContain("athlete-a-secret-token");
    expect(athleteB.html()).not.toContain("athlete-a-private-draft");
  });

  it("discards an in-flight Athlete A Token response after Athlete B is bound", async () => {
    const tokenGate = deferred<unknown>();
    let athleteKey = "athlete-a";
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") {
        return {
          athlete_key: athleteKey,
          display_name: athleteKey === "athlete-a" ? "Athlete A" : "Athlete B",
          timezone: "Asia/Shanghai",
        };
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access" && options?.method === "POST") return tokenGate.promise;
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const athleteA = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(athleteA, "创建 Token").trigger("click");
    expect(harness.request.mock.calls.filter(([path, options]) => (
      path === "/api/private/agent-access" && options?.method === "POST"
    ))).toHaveLength(1);

    athleteA.unmount();
    athleteKey = "athlete-b";
    const athleteB = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    tokenGate.resolve({
      active: true,
      token: "late-athlete-a-secret-token",
      created_at: "2026-08-29T12:00:00Z",
      rotated_at: null,
      revoked_at: null,
    });
    await flushPromises();

    expect(athleteB.find('input[aria-label="本次 Agent Token"]').exists()).toBe(false);
    expect(athleteB.html()).not.toContain("late-athlete-a-secret-token");
    expect(harness.app.state.message).not.toContain("Token 已创建");
    expect(harness.setError).not.toHaveBeenCalled();
  });

  it("does not trust retained Athlete A data before a same-epoch Athlete B profile bind", async () => {
    const athleteBProfile = deferred<unknown>();
    let backendAthlete: "a" | "b" = "a";
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") {
        return backendAthlete === "a"
          ? { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" }
          : athleteBProfile.promise;
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access" && options?.method === "POST") {
        return {
          active: true,
          token: "athlete-a-retained-token",
          created_at: "2026-08-29T12:00:00Z",
          rotated_at: null,
          revoked_at: null,
        };
      }
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const athleteA = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();
    await button(athleteA, "创建 Token").trigger("click");
    await flushPromises();
    await openEditor(athleteA, "athlete-a-retained-draft");
    await button(athleteA, "取消").trigger("click");
    athleteA.unmount();

    backendAthlete = "b";
    const athleteB = mount(SettingsPage, { props: { app: harness.app } });
    await athleteB.vm.$nextTick();

    expect((athleteB.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("");
    expect(button(athleteB, "保存设置").attributes("disabled")).toBeDefined();
    expect(button(athleteB, "编排未来计划").attributes("disabled")).toBeDefined();
    expect(athleteB.html()).not.toContain("athlete-a-retained-token");
    expect(athleteB.html()).not.toContain("athlete-a-retained-draft");

    athleteBProfile.resolve({
      athlete_key: "athlete-b",
      display_name: "Athlete B",
      timezone: "Asia/Shanghai",
    });
    await flushPromises();
    await button(athleteB, "编排未来计划").trigger("click");

    expect((athleteB.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Athlete B");
    expect((athleteB.get("#plan-json").element as HTMLTextAreaElement).value).toBe("");
    expect(athleteB.html()).not.toContain("athlete-a-retained-token");
    expect(athleteB.html()).not.toContain("athlete-a-retained-draft");
  });

  it.each(["plan copy", "export", "token rotation"] as const)(
    "drops an unmounted Athlete A %s continuation before same-epoch Athlete B binds",
    async (operation) => {
      const athleteBProfile = deferred<unknown>();
      const planCopy = deferred<unknown>();
      const exportBlob = deferred<Blob>();
      const tokenRotation = deferred<unknown>();
      let backendAthlete: "a" | "b" = "a";
      let tokenPosts = 0;
      const clipboardWrite = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: clipboardWrite },
      });
      const createObjectURL = vi.fn(() => "blob:old-athlete-export");
      const revokeObjectURL = vi.fn();
      class ExportUrl extends URL {}
      Object.defineProperties(ExportUrl, {
        createObjectURL: { configurable: true, value: createObjectURL },
        revokeObjectURL: { configurable: true, value: revokeObjectURL },
      });
      vi.stubGlobal("URL", ExportUrl);
      const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const harness = settingsHarness(async (path, options) => {
        if (path === "/api/private/me") {
          return backendAthlete === "a"
            ? { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" }
            : athleteBProfile.promise;
        }
        if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
        if (path === "/api/private/agent-access" && options?.method === "POST") {
          tokenPosts += 1;
          return tokenPosts === 1
            ? {
              active: true,
              token: "athlete-a-retained-token",
              created_at: "2026-08-29T12:00:00Z",
              rotated_at: null,
              revoked_at: null,
            }
            : tokenRotation.promise;
        }
        if (path === "/api/private/agent-access") return { active: false };
        if (path === "/api/private/plan/update-package") return planCopy.promise;
        throw new Error(`Unexpected request: ${path}`);
      });
      const response = new Response("pending old athlete export", {
        headers: { "Content-Disposition": 'attachment; filename="athlete-a.json"' },
      });
      vi.spyOn(response, "blob").mockImplementation(() => exportBlob.promise);
      harness.app.api.response = vi.fn(async () => response);

      const athleteA = mount(SettingsPage, { props: { app: harness.app } });
      await flushPromises();
      await button(athleteA, "创建 Token").trigger("click");
      await flushPromises();
      await openEditor(athleteA, "athlete-a-retained-draft");
      await button(athleteA, "取消").trigger("click");
      harness.app.state.message = "";

      if (operation === "plan copy") {
        await button(athleteA, "复制当前单周 JSON").trigger("click");
      } else if (operation === "export") {
        await button(athleteA, "下载训练数据").trigger("click");
      } else {
        await button(athleteA, "重新生成 Token").trigger("click");
      }
      await athleteA.vm.$nextTick();
      athleteA.unmount();

      backendAthlete = "b";
      const athleteB = mount(SettingsPage, { props: { app: harness.app } });
      await athleteB.vm.$nextTick();
      expect(button(athleteB, "保存设置").attributes("disabled")).toBeDefined();
      expect(athleteB.html()).not.toContain("athlete-a-retained-token");
      expect(athleteB.html()).not.toContain("athlete-a-retained-draft");

      if (operation === "plan copy") {
        planCopy.resolve({
          schema_version: 2,
          effective_from: "2026-09-07",
          old_athlete_marker: "athlete-a-plan-copy",
        });
      } else if (operation === "export") {
        exportBlob.resolve(new Blob(["athlete-a-export"]));
      } else {
        tokenRotation.resolve({
          active: true,
          token: "athlete-a-late-rotated-token",
          created_at: "2026-08-29T12:00:00Z",
          rotated_at: "2026-08-29T13:00:00Z",
          revoked_at: null,
        });
      }
      await flushPromises();

      expect(clipboardWrite).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(downloadClick).not.toHaveBeenCalled();
      expect(harness.app.state.message).toBe("");
      expect(athleteB.html()).not.toMatch(/athlete-a-(?:plan-copy|late-rotated-token|retained-token|retained-draft)/);

      athleteBProfile.resolve({
        athlete_key: "athlete-b",
        display_name: "Athlete B",
        timezone: "Asia/Shanghai",
      });
      await flushPromises();

      expect((athleteB.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Athlete B");
      expect(button(athleteB, "保存设置").attributes("disabled")).toBeUndefined();
      expect(button(athleteB, "编排未来计划").attributes("disabled")).toBeUndefined();
      expect(button(athleteB, "下载训练数据").attributes("disabled")).toBeUndefined();
      await button(athleteB, "编排未来计划").trigger("click");
      expect((athleteB.get("#plan-json").element as HTMLTextAreaElement).value).toBe("");
      expect(athleteB.html()).not.toMatch(/athlete-a-(?:plan-copy|late-rotated-token|retained-token|retained-draft)/);
    },
  );

  it.each(["token before profile", "profile before token"] as const)(
    "releases a same-A rotation only after the fresh identity bind when %s settles first",
    async (settlementOrder) => {
      const freshAthleteProfile = deferred<unknown>();
      const tokenRotation = deferred<unknown>();
      let profileReads = 0;
      let tokenPosts = 0;
      const token = `same-athlete-${settlementOrder.replaceAll(" ", "-")}`;
      const harness = settingsHarness(async (path, options) => {
        if (path === "/api/private/me") {
          profileReads += 1;
          return profileReads === 1
            ? { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" }
            : freshAthleteProfile.promise;
        }
        if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
        if (path === "/api/private/agent-access" && options?.method === "POST") {
          tokenPosts += 1;
          return tokenRotation.promise;
        }
        if (path === "/api/private/agent-access") {
          return {
            active: true,
            created_at: "2026-08-01T12:00:00Z",
            rotated_at: null,
            revoked_at: null,
          };
        }
        throw new Error(`Unexpected request: ${path}`);
      });
      const windowOne = mount(SettingsPage, { props: { app: harness.app } });
      await flushPromises();
      harness.app.state.message = "";

      await button(windowOne, "重新生成 Token").trigger("click");
      await windowOne.vm.$nextTick();
      expect(tokenPosts).toBe(1);
      windowOne.unmount();

      const windowTwo = mount(SettingsPage, { props: { app: harness.app } });
      await windowTwo.vm.$nextTick();
      expect(profileReads).toBe(2);
      expect(windowTwo.find('input[aria-label="本次 Agent Token"]').exists()).toBe(false);
      expect(windowTwo.html()).not.toContain(token);
      expect(harness.app.state.message).toBe("");

      const tokenResponse = {
        active: true,
        token,
        created_at: "2026-08-01T12:00:00Z",
        rotated_at: "2026-08-29T14:00:00Z",
        revoked_at: null,
      };
      const profileResponse = {
        athlete_key: "athlete-a",
        display_name: "Athlete A reauthenticated",
        timezone: "Asia/Shanghai",
      };

      if (settlementOrder === "token before profile") {
        tokenRotation.resolve(tokenResponse);
        await flushPromises();
        expect(windowTwo.find('input[aria-label="本次 Agent Token"]').exists()).toBe(false);
        expect(windowTwo.html()).not.toContain(token);
        expect(harness.app.state.message).toBe("");

        freshAthleteProfile.resolve(profileResponse);
      } else {
        freshAthleteProfile.resolve(profileResponse);
        await flushPromises();
        expect((windowTwo.get('input[name="display_name"]').element as HTMLInputElement).value)
          .toBe("Athlete A reauthenticated");
        expect(windowTwo.find('input[aria-label="本次 Agent Token"]').exists()).toBe(false);
        expect(windowTwo.html()).not.toContain(token);
        expect(harness.app.state.message).toBe("");

        tokenRotation.resolve(tokenResponse);
      }
      await flushPromises();

      expect((windowTwo.get('input[name="display_name"]').element as HTMLInputElement).value)
        .toBe("Athlete A reauthenticated");
      expect((windowTwo.get('input[aria-label="本次 Agent Token"]').element as HTMLInputElement).value)
        .toBe(token);
      expect(harness.app.state.message).toBe("Agent Token 已重新生成，旧 Token 已失效");
      expect(tokenPosts).toBe(1);
    },
  );

  it("does not restore the same Athlete's retained Token or draft after a 401 reauthentication", async () => {
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") {
        return { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" };
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access" && options?.method === "POST") {
        return {
          active: true,
          token: "pre-401-secret-token",
          created_at: "2026-08-29T12:00:00Z",
          rotated_at: null,
          revoked_at: null,
        };
      }
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const before401 = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(before401, "创建 Token").trigger("click");
    await flushPromises();
    await openEditor(before401, "pre-401-private-draft");
    await button(before401, "取消").trigger("click");
    expect(before401.find('input[aria-label="本次 Agent Token"]').exists()).toBe(true);

    harness.app.state.authRequired = true;
    harness.app.state.authEpoch += 1;
    before401.unmount();
    harness.app.state.authRequired = false;

    const afterReauthentication = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();
    await button(afterReauthentication, "编排未来计划").trigger("click");

    expect((afterReauthentication.get("#plan-json").element as HTMLTextAreaElement).value).toBe("");
    expect(afterReauthentication.find('input[aria-label="本次 Agent Token"]').exists()).toBe(false);
    expect(afterReauthentication.html()).not.toContain("pre-401-secret-token");
    expect(afterReauthentication.html()).not.toContain("pre-401-private-draft");
  });

  it("discards Athlete A's late profile read after logout and Athlete B login epochs", async () => {
    const athleteAProfile = deferred<unknown>();
    let profileReads = 0;
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") {
        profileReads += 1;
        return profileReads === 1
          ? athleteAProfile.promise
          : { athlete_key: "athlete-b", display_name: "Athlete B", timezone: "Asia/Shanghai" };
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const athleteA = mount(SettingsPage, { props: { app: harness.app } });
    await athleteA.vm.$nextTick();
    expect(profileReads).toBe(1);

    harness.app.state.authRequired = true;
    harness.app.state.authEpoch += 1;
    athleteA.unmount();
    harness.app.state.authRequired = false;
    harness.app.state.authEpoch += 1;

    const athleteB = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();
    expect((athleteB.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Athlete B");

    athleteAProfile.resolve({
      athlete_key: "athlete-a",
      display_name: "Late Athlete A",
      timezone: "America/New_York",
    });
    await flushPromises();

    expect((athleteB.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Athlete B");
    expect((athleteB.get('input[name="timezone"]').element as HTMLInputElement).value).toBe("Asia/Shanghai");
    expect(athleteB.html()).not.toContain("Late Athlete A");
  });

  it("keeps the PUT profile snapshot when another window's stale GET settles", async () => {
    const staleProfile = deferred<unknown>();
    let profileReads = 0;
    const p0 = { athlete_key: "athlete-a", display_name: "Profile P0", timezone: "Asia/Shanghai" };
    const p1 = { athlete_key: "athlete-a", display_name: "Profile P1", timezone: "Asia/Shanghai" };
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") {
        profileReads += 1;
        if (profileReads === 1) return p0;
        if (profileReads === 2) return staleProfile.promise;
        return p1;
      }
      if (path === "/api/private/settings" && options?.method === "PUT") return p1;
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    const windowOne = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();
    const windowTwo = mount(SettingsPage, { props: { app: harness.app } });
    await windowTwo.vm.$nextTick();
    expect(profileReads).toBe(2);

    await windowOne.get('input[name="display_name"]').setValue("Profile P1");
    await windowOne.get("form.settings-form").trigger("submit");
    await flushPromises();

    const putCall = harness.request.mock.calls.find(([path, options]) => (
      path === "/api/private/settings" && options?.method === "PUT"
    ));
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      display_name: "Profile P1",
      timezone: "Asia/Shanghai",
    });
    expect((windowOne.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Profile P1");
    expect((windowTwo.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Profile P1");
    expect(profileReads).toBeGreaterThan(2);

    staleProfile.resolve(p0);
    await flushPromises();

    expect((windowOne.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Profile P1");
    expect((windowTwo.get('input[name="display_name"]').element as HTMLInputElement).value).toBe("Profile P1");
  });

  it("keeps the newer same-Athlete rotation when the pre-401 response arrives late", async () => {
    const firstRotation = deferred<unknown>();
    const secondRotation = deferred<unknown>();
    let rotationCount = 0;
    const harness = settingsHarness(async (path, options) => {
      if (path === "/api/private/me") {
        return { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" };
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access" && options?.method === "POST") {
        rotationCount += 1;
        return rotationCount === 1 ? firstRotation.promise : secondRotation.promise;
      }
      if (path === "/api/private/agent-access") {
        return {
          active: true,
          created_at: "2026-08-01T12:00:00Z",
          rotated_at: null,
          revoked_at: null,
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const windowOne = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();
    const windowOnePeer = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(windowOne, "重新生成 Token").trigger("click");
    await nextTick();
    expect(button(windowOnePeer, "重新生成 Token").attributes("disabled")).toBeDefined();
    await button(windowOnePeer, "重新生成 Token").trigger("click");
    expect(rotationCount).toBe(1);

    harness.app.state.authRequired = true;
    harness.app.state.authEpoch += 1;
    windowOne.unmount();
    windowOnePeer.unmount();
    harness.app.state.authRequired = false;

    const windowTwo = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();
    await button(windowTwo, "重新生成 Token").trigger("click");
    expect(rotationCount).toBe(2);

    secondRotation.resolve({
      active: true,
      token: "new-window-token",
      created_at: "2026-08-01T12:00:00Z",
      rotated_at: "2026-08-29T13:00:00Z",
      revoked_at: null,
    });
    await flushPromises();
    expect((windowTwo.get('input[aria-label="本次 Agent Token"]').element as HTMLInputElement).value)
      .toBe("new-window-token");

    firstRotation.resolve({
      active: true,
      token: "late-old-window-token",
      created_at: "2026-08-01T12:00:00Z",
      rotated_at: "2026-08-29T12:30:00Z",
      revoked_at: null,
    });
    await flushPromises();

    expect((windowTwo.get('input[aria-label="本次 Agent Token"]').element as HTMLInputElement).value)
      .toBe("new-window-token");
    expect(windowTwo.html()).not.toContain("late-old-window-token");
  });

  it("disables Token rotation while logout is in flight and sends no mutation", async () => {
    const logoutGate = deferred<void>();
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") {
        return { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" };
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") {
        return {
          active: true,
          created_at: "2026-08-01T12:00:00Z",
          rotated_at: null,
          revoked_at: null,
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    harness.logout.mockImplementation(() => logoutGate.promise);
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(wrapper, "退出登录").trigger("click");
    await nextTick();

    expect(button(wrapper, "正在退出…").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "重新生成 Token").attributes("disabled")).toBeDefined();
    await button(wrapper, "重新生成 Token").trigger("click");
    expect(harness.request.mock.calls.filter(([path, options]) => (
      path === "/api/private/agent-access" && options?.method === "POST"
    ))).toHaveLength(0);

    logoutGate.resolve();
    await flushPromises();
  });

  it("downloads a local export with the Athlete header and server attachment filename", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => key === "workout-athlete-email" ? "athlete@example.test" : null),
    });
    const fetchExport = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const path = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      if (path === "/api/private/me") {
        return json({ athlete_key: "athlete", display_name: "Athlete", timezone: "Asia/Shanghai" });
      }
      if (path === "/api/private/coach-share") {
        return json({ active: false, share_key: null, url: null });
      }
      if (path === "/api/private/agent-access") return json({ active: false });
      if (path === "/api/private/export") {
        return new Response(JSON.stringify({ schema_version: 1 }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="workout-data-2026-08-29.json"',
          },
        });
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    const createObjectURL = vi.fn(() => "blob:workout-export");
    const revokeObjectURL = vi.fn();
    class ExportUrl extends URL {}
    Object.defineProperties(ExportUrl, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    vi.stubGlobal("location", { hostname: "localhost" });
    vi.stubGlobal("URL", ExportUrl);
    let downloadedFilename = "";
    let downloadedHref = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function captureDownload(this: HTMLAnchorElement) {
      downloadedFilename = this.download;
      downloadedHref = this.href;
    });
    const harness = settingsHarness();
    harness.app.api = createApiClient(fetchExport as typeof fetch);
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(wrapper, "下载训练数据").trigger("click");
    await flushPromises();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const exportCall = fetchExport.mock.calls.find(([path]) => String(path) === "/api/private/export");
    expect(exportCall).toBeDefined();
    const [path, options] = exportCall!;
    expect(path).toBe("/api/private/export");
    expect(options).toMatchObject({ credentials: "same-origin" });
    expect(new Headers(options?.headers).get("x-athlete-email")).toBe("athlete@example.test");
    expect(downloadedFilename).toBe("workout-data-2026-08-29.json");
    expect(downloadedHref).toContain("blob:workout-export");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workout-export");
    expect(harness.setError).not.toHaveBeenCalled();

  });

  it("releases a same-A export after its owner unmounts without continuing the stale download", async () => {
    const freshAthleteProfile = deferred<unknown>();
    const exportResponse = deferred<Response>();
    const exportBlob = deferred<Blob>();
    const sideEffects = installStaleUiSideEffectSpies();
    const staleResponse = new Response("pending same-athlete export", {
      headers: { "Content-Disposition": 'attachment; filename="stale-athlete-a.json"' },
    });
    vi.spyOn(staleResponse, "blob").mockImplementation(() => exportBlob.promise);
    const rawResponse = vi.fn(async (_path: string) => exportResponse.promise);
    let profileReads = 0;
    const harness = settingsHarness(async (path) => {
      if (path === "/api/private/me") {
        profileReads += 1;
        return profileReads === 1
          ? { athlete_key: "athlete-a", display_name: "Athlete A", timezone: "Asia/Shanghai" }
          : freshAthleteProfile.promise;
      }
      if (path === "/api/private/coach-share") return { active: false, share_key: null, url: null };
      if (path === "/api/private/agent-access") return { active: false };
      throw new Error(`Unexpected request: ${path}`);
    });
    harness.app.api.response = rawResponse;
    const windowOne = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(windowOne, "下载训练数据").trigger("click");
    await nextTick();
    expect(rawResponse).toHaveBeenCalledTimes(1);
    expect(rawResponse).toHaveBeenCalledWith("/api/private/export");
    expect(button(windowOne, "正在准备下载…").attributes("disabled")).toBeDefined();
    expect(button(windowOne, "退出登录").attributes("disabled")).toBeDefined();
    windowOne.unmount();

    const windowTwo = mount(SettingsPage, { props: { app: harness.app } });
    await nextTick();
    expect(profileReads).toBe(2);

    freshAthleteProfile.resolve({
      athlete_key: "athlete-a",
      display_name: "Athlete A revalidated",
      timezone: "Asia/Shanghai",
    });
    await flushPromises();
    expect((windowTwo.get('input[name="display_name"]').element as HTMLInputElement).value)
      .toBe("Athlete A revalidated");
    expect(button(windowTwo, "正在准备下载…").attributes("disabled")).toBeDefined();
    expect(button(windowTwo, "退出登录").attributes("disabled")).toBeDefined();

    exportResponse.resolve(staleResponse);
    await nextTick();
    exportBlob.resolve(new Blob(["stale athlete A export"]));
    await flushPromises();

    expect(sideEffects.createObjectURL).not.toHaveBeenCalled();
    expect(sideEffects.downloadClick).not.toHaveBeenCalled();
    expect(sideEffects.revokeObjectURL).not.toHaveBeenCalled();
    expect(harness.setError).not.toHaveBeenCalled();
    expect(harness.app.state.message).toBe("");
    expect(button(windowTwo, "下载训练数据").attributes("disabled")).toBeUndefined();
    expect(button(windowTwo, "退出登录").attributes("disabled")).toBeUndefined();
    expect(rawResponse).toHaveBeenCalledTimes(1);
  });

  it("does not download an export whose Blob resolves after the auth epoch changes", async () => {
    const blobGate = deferred<Blob>();
    const response = new Response("pending export", {
      headers: { "Content-Disposition": 'attachment; filename="old-athlete.json"' },
    });
    vi.spyOn(response, "blob").mockImplementation(() => blobGate.promise);
    const rawResponse = vi.fn(async (_path: string) => response);
    const createObjectURL = vi.fn(() => "blob:stale-export");
    const revokeObjectURL = vi.fn();
    class ExportUrl extends URL {}
    Object.defineProperties(ExportUrl, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    vi.stubGlobal("URL", ExportUrl);
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const harness = settingsHarness();
    harness.app.api.response = rawResponse;
    const wrapper = mount(SettingsPage, { props: { app: harness.app } });
    await flushPromises();

    await button(wrapper, "下载训练数据").trigger("click");
    await flushPromises();
    expect(rawResponse).toHaveBeenCalledWith("/api/private/export");

    harness.app.state.authRequired = true;
    harness.app.state.authEpoch += 1;
    blobGate.resolve(new Blob(["old athlete export"]));
    await flushPromises();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloadClick).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(harness.setError).not.toHaveBeenCalled();
  });
});
