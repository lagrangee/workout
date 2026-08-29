import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkoutAppStore } from "./app-store";
import {
  createApiClient,
  WorkoutApiError,
  WorkoutProtocolError,
} from "./api-client";
import type { ApiClient, JsonRecord, PlanState, TodayState } from "./contracts";

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

const progress: JsonRecord = {
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

const sessionDetail: JsonRecord = {
  session_key: "session-1",
  scheduled_date: "2026-08-29",
  local_date: "2026-08-29",
  title: "力量训练",
  status: "in_progress",
  completion_fraction: 0.5,
  training_duration_sec: 300,
  session_rpe: null,
  exercise_keys: ["squat"],
  exercise_ids: ["squat"],
  updated_at: "2026-08-29T10:00:00.000Z",
  source_ref: "session:2026-08-29:session-1",
  scheduled_workout_key: "scheduled-1",
  plan_id: null,
  plan_revision_key: null,
  timezone_at_session: "Asia/Shanghai",
  note: null,
  skip_reason: null,
  snapshot: {},
  completion_results: [],
  training_intervals: [],
  exercise_feedback: [],
  created_at: "2026-08-29T09:00:00.000Z",
};

function jsonResponse(value: unknown, contentType = "application/json; charset=utf-8"): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": contentType } });
}

function injectedApi(
  implementation: (path: string, options?: RequestInit) => Promise<unknown>,
): ApiClient {
  return {
    async request<T>(path: string, options?: RequestInit): Promise<T> {
      return await implementation(path, options) as T;
    },
    async response(): Promise<Response> {
      throw new Error("Unexpected raw response request");
    },
    idempotencyKey: () => "core-test-key",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createApiClient success protocol", () => {
  it("keeps GET and bodyless requests free of a synthetic Content-Type header", async () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => "athlete@example.invalid") });
    vi.stubGlobal("location", { hostname: "localhost" });
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _options?: RequestInit,
    ) => jsonResponse({ ok: true }));
    const api = createApiClient(fetchImpl as typeof fetch);

    await expect(api.request("/api/private/example")).resolves.toEqual({ ok: true });
    await api.response("/healthz", { method: "POST" });

    for (const [, options] of fetchImpl.mock.calls) {
      const headers = new Headers(options?.headers);
      expect(headers.get("Content-Type")).toBeNull();
      expect(headers.get("x-athlete-email")).toBe("athlete@example.invalid");
      expect(options?.credentials).toBe("same-origin");
    }
  });

  it("adds the JSON Content-Type only when a string body needs the default", async () => {
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _options?: RequestInit,
    ) => jsonResponse({ saved: true }));
    const api = createApiClient(fetchImpl as typeof fetch);

    await api.request("/api/private/example", {
      method: "POST",
      body: JSON.stringify({ value: 1 }),
    });

    const [, options] = fetchImpl.mock.calls[0];
    expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json");
  });

  it.each([
    "application/json; charset=utf-8",
    "application/vnd.workout+json",
  ])("accepts the JSON media type %s", async (contentType) => {
    const api = createApiClient(async () => jsonResponse({ ok: true }, contentType));

    await expect(api.request("/api/private/example")).resolves.toEqual({ ok: true });
  });

  it.each([
    ["HTML", "<html>logged out</html>", "text/html"],
    ["empty JSON", "", "application/json"],
    ["malformed JSON", "{", "application/json"],
    ["null JSON", "null", "application/json"],
    ["array JSON", "[]", "application/json"],
    ["error envelope", '{"error":{"message":"not really successful"}}', "application/json"],
  ])("rejects a successful %s body", async (_label, body, contentType) => {
    const api = createApiClient(async () => new Response(body, {
      headers: { "Content-Type": contentType },
    }));

    await expect(api.request("/api/private/example")).rejects.toBeInstanceOf(WorkoutProtocolError);
  });

  it("rejects JSON bytes when the success response omits its media type", async () => {
    const api = createApiClient(async () => new Response(
      new TextEncoder().encode('{"ok":true}'),
    ));

    await expect(api.request("/api/private/example")).rejects.toMatchObject({
      name: "WorkoutProtocolError",
      issue: "successful response must use a JSON media type",
    });
  });

  it("returns successful attachment responses without consuming their bodies", async () => {
    const attachment = new Response("private export", {
      headers: { "Content-Disposition": 'attachment; filename="workout.json"' },
    });
    const api = createApiClient(async () => attachment);

    const result = await api.response("/api/private/export");

    expect(result).toBe(attachment);
    expect(result.bodyUsed).toBe(false);
  });

  it("keeps logout JSON-compatible without restoring bodyless header defaults", async () => {
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _options?: RequestInit,
    ) => jsonResponse({ logged_out: true }));
    const store = createWorkoutAppStore(createApiClient(fetchImpl as typeof fetch));
    store.state.loading = false;

    await store.logout();

    const [, options] = fetchImpl.mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe("{}");
    expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json");
    expect(store.state).toMatchObject({ authEpoch: 1, authRequired: true, loading: false });
  });

  it("gives bodyless private mutations an explicit empty JSON command body", async () => {
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _options?: RequestInit,
    ) => jsonResponse({ revoked: true }));
    const store = createWorkoutAppStore(createApiClient(fetchImpl as typeof fetch));

    await store.api.request("/api/private/coach-share", { method: "DELETE" });

    const [, options] = fetchImpl.mock.calls[0];
    expect(options?.method).toBe("DELETE");
    expect(options?.body).toBe("{}");
    expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json");
  });
});

describe("known Workout JSON envelopes", () => {
  it.each([
    ["/api/private/me", { display_name: "Athlete", timezone: "Asia/Shanghai" }],
    ["/api/private/today", { date: "2026-08-29", timezone: "Asia/Shanghai", entry: null }],
    ["/api/private/today", { ...today, date: "2026-02-30" }],
    ["/api/private/plan", { timezone: "Asia/Shanghai", first_effective_from: null, current: null }],
    ["/api/private/progress", { ...progress, current_streak: undefined }],
    ["/api/private/sessions/session-1", { ...sessionDetail, snapshot: undefined }],
  ])("rejects invalid required fields from %s", async (path, body) => {
    const api = createApiClient(async () => jsonResponse(body));

    await expect(api.request(path)).rejects.toMatchObject({
      name: "WorkoutProtocolError",
      path,
    });
  });

  it("accepts the required me, today, plan, progress, and session shapes", async () => {
    const responses = new Map<string, unknown>([
      ["/api/private/me", {
        athlete_key: "athlete-1",
        display_name: "Athlete",
        timezone: "Asia/Shanghai",
      }],
      ["/api/private/today", today],
      ["/api/private/plan", plan],
      ["/api/private/progress?from=2026-08-01&to=2026-08-29", progress],
      ["/api/private/sessions/session-1", sessionDetail],
    ]);
    const api = createApiClient(async (path) => jsonResponse(responses.get(String(path))));

    for (const path of responses.keys()) {
      await expect(api.request(path)).resolves.toEqual(responses.get(path));
    }
  });
});

describe("store protocol and auth-epoch fences", () => {
  it("preserves an injected raw attachment body through the guarded API", async () => {
    const attachment = new Response("private export");
    const api: ApiClient = {
      async request<T>(): Promise<T> {
        throw new Error("Unexpected JSON request");
      },
      async response(): Promise<Response> {
        return attachment;
      },
      idempotencyKey: () => "core-test-key",
    };
    const store = createWorkoutAppStore(api);

    const result = await store.api.response("/api/private/export");

    expect(result).toBe(attachment);
    expect(result.bodyUsed).toBe(false);
    expect(store.state.authEpoch).toBe(0);
  });

  it("fails closed once for a current private 401", async () => {
    const unauthorized = new WorkoutApiError("请先登录", 401, {});
    const store = createWorkoutAppStore(injectedApi(async () => {
      throw unauthorized;
    }));
    Object.assign(store.state, { loading: false, today, plan, progress });

    await expect(store.api.request("/api/private/records/overview")).rejects.toBe(unauthorized);

    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: true,
      today: null,
      plan: null,
      progress: null,
      session: null,
    });
  });

  it("does not let an injected empty bootstrap response create authenticated state", async () => {
    const store = createWorkoutAppStore(injectedApi(async (path) => {
      if (path === "/api/private/today") return {};
      if (path === "/api/private/plan") return plan;
      if (path.startsWith("/api/private/progress?")) return progress;
      throw new Error(`Unexpected request: ${path}`);
    }));

    await store.bootstrap();

    expect(store.state).toMatchObject({
      authEpoch: 0,
      authRequired: false,
      loading: false,
      today: null,
      plan: null,
      progress: null,
      session: null,
      error: "服务器返回了无法验证的响应",
    });
  });

  it("ignores a malformed old private response after a successful new login epoch", async () => {
    const oldProfile = deferred<unknown>();
    const store = createWorkoutAppStore(injectedApi(async (path) => {
      if (path === "/api/private/me") return oldProfile.promise;
      if (path === "/api/auth/login") return {};
      if (path === "/api/private/today") return today;
      if (path === "/api/private/plan") return plan;
      if (path.startsWith("/api/private/progress?")) return progress;
      throw new Error(`Unexpected request: ${path}`);
    }));
    store.state.loading = false;
    const oldRequest = store.api.request("/api/private/me");

    await store.login("athlete@example.invalid", "password");
    oldProfile.resolve({});
    const staleError = await oldRequest.catch((error: unknown) => error);
    store.setError(staleError);

    expect(staleError).toBeInstanceOf(WorkoutProtocolError);
    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: false,
      error: null,
      today,
      plan,
      progress,
    });
  });

  it("ignores an old private 401 after a successful new login epoch", async () => {
    const oldPrivate = deferred<unknown>();
    const store = createWorkoutAppStore(injectedApi(async (path) => {
      if (path === "/api/private/records/overview") return oldPrivate.promise;
      if (path === "/api/auth/login") return {};
      if (path === "/api/private/today") return today;
      if (path === "/api/private/plan") return plan;
      if (path.startsWith("/api/private/progress?")) return progress;
      throw new Error(`Unexpected request: ${path}`);
    }));
    store.state.loading = false;
    const oldRequest = store.api.request("/api/private/records/overview");

    await store.login("athlete@example.invalid", "password");
    oldPrivate.reject(new WorkoutApiError("请先登录", 401, {}));

    await expect(oldRequest).rejects.toMatchObject({ status: 401 });
    expect(store.state).toMatchObject({
      authEpoch: 1,
      authRequired: false,
      error: null,
      today,
      plan,
      progress,
    });
  });
});
