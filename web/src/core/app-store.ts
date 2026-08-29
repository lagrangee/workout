import { reactive } from "vue";
import {
  createApiClient,
  errorMessage,
  validateWorkoutJsonResponse,
  workoutApiErrorFromResponse,
  WorkoutApiError,
} from "./api-client";
import type {
  ApiClient,
  AppCoreState,
  PlanState,
  TodayState,
  WorkoutAppStore,
} from "./contracts";

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function progressQuery(today: string | null): string {
  return today ? `from=${monthStart(today)}&to=${today}` : "preset=all";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof WorkoutApiError
    ? error.status === 401
    : typeof error === "object"
      && error !== null
      && "status" in error
      && error.status === 401;
}

class StaleAuthEpochError extends Error {
  constructor() {
    super("认证状态已变化，请重新操作");
    this.name = "StaleAuthEpochError";
  }
}

function initialState(): AppCoreState {
  return {
    view: "today",
    authEpoch: 0,
    loading: true,
    authRequired: false,
    authMessage: "",
    error: null,
    message: "",
    today: null,
    plan: null,
    progress: null,
    session: null,
  };
}

export function createWorkoutAppStore(api: ApiClient = createApiClient()): WorkoutAppStore {
  const state = reactive<AppCoreState>(initialState());
  let refreshGeneration = 0;
  let authIntent = 0;
  let authMutationTail = Promise.resolve();
  let logoutOperation: Promise<void> | null = null;
  let logoutPending = false;
  const requestErrorEpochs = new WeakMap<object, number>();

  function clearPrivateState(options: {
    authRequired: boolean;
    loading: boolean;
    resetView?: boolean;
  }): void {
    if (options.resetView) state.view = "today";
    state.loading = options.loading;
    state.authRequired = options.authRequired;
    state.authMessage = "";
    state.error = null;
    state.message = "";
    state.today = null;
    state.plan = null;
    state.progress = null;
    state.session = null;
  }

  function openAuthEpoch(options: {
    authRequired: boolean;
    loading: boolean;
    resetView?: boolean;
  }): number {
    refreshGeneration += 1;
    state.authEpoch += 1;
    clearPrivateState(options);
    return state.authEpoch;
  }

  function isAuthBoundary(path: string): boolean {
    let pathname = path;
    try {
      pathname = new URL(path, "https://workout.invalid").pathname;
    } catch {
      // A malformed URL will be rejected by the underlying client.
    }
    return pathname === "/api/private"
      || pathname.startsWith("/api/private/")
      || pathname === "/api/auth/logout";
  }

  function transitionUnauthorized(requestEpoch: number): void {
    if (requestEpoch !== state.authEpoch) return;
    openAuthEpoch({ authRequired: true, loading: false });
  }

  async function guardedRequest<T>(
    path: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const requestEpoch = state.authEpoch;
    try {
      const result = await operation();
      if (isAuthBoundary(path) && requestEpoch !== state.authEpoch) {
        throw new StaleAuthEpochError();
      }
      return result;
    } catch (error) {
      const normalizedError = (typeof error === "object" && error !== null) || typeof error === "function"
        ? error
        : new Error(errorMessage(error));
      requestErrorEpochs.set(normalizedError, requestEpoch);
      if (isAuthBoundary(path) && isUnauthorized(normalizedError)) {
        transitionUnauthorized(requestEpoch);
      }
      throw normalizedError;
    }
  }

  function enqueueAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = authMutationTail.then(operation, operation);
    authMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function workoutRequestOptions(path: string, options?: RequestInit): RequestInit | undefined {
    if (!options || options.body !== undefined || !isAuthBoundary(path)) return options;
    const method = (options.method ?? "GET").toUpperCase();
    if (!["POST", "PUT", "DELETE"].includes(method)) return options;
    return { ...options, body: JSON.stringify({}) };
  }

  const guardedApi: ApiClient = {
    request<T>(path: string, options?: RequestInit): Promise<T> {
      return guardedRequest(path, async () => (
        validateWorkoutJsonResponse(
          path,
          await api.request<unknown>(path, workoutRequestOptions(path, options)),
        ) as T
      ));
    },
    response(path: string, options?: RequestInit): Promise<Response> {
      return guardedRequest(path, async () => {
        const result = await api.response(path, options);
        if (!result.ok) throw await workoutApiErrorFromResponse(result);
        return result;
      });
    },
    idempotencyKey(): string {
      return api.idempotencyKey();
    },
  };

  const store: WorkoutAppStore = {
    state,
    api: guardedApi,

    async bootstrap() {
      await store.refresh();
    },

    async refresh() {
      if (logoutPending || state.authRequired) return;
      const generation = ++refreshGeneration;
      const isInitialLoad = state.today === null || state.plan === null;
      if (isInitialLoad) state.loading = true;
      state.authMessage = "";

      try {
        const [today, plan] = await Promise.all([
          guardedApi.request<TodayState>("/api/private/today"),
          guardedApi.request<PlanState>("/api/private/plan"),
        ]);
        if (!today) throw new Error("Today response is missing");
        if (generation !== refreshGeneration) return;

        const progress = await guardedApi.request(`/api/private/progress?${progressQuery(today.date)}`);
        if (generation !== refreshGeneration) return;

        state.today = today;
        state.plan = plan;
        state.progress = progress;
        state.session = today.session;
        state.authRequired = false;
        state.error = null;
      } catch (error) {
        if (generation !== refreshGeneration) return;
        state.error = errorMessage(error);
      } finally {
        if (generation === refreshGeneration && isInitialLoad) state.loading = false;
      }
    },

    async login(email: string, password: string) {
      const intent = ++authIntent;
      const result = await enqueueAuthMutation(async () => {
        state.authMessage = "";
        try {
          await api.request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          if (intent !== authIntent) return null;
          openAuthEpoch({ authRequired: false, loading: true });
          return { refresh: store.refresh() };
        } catch (error) {
          if (intent === authIntent) {
            state.loading = false;
            state.authRequired = true;
            const message = errorMessage(error);
            state.authMessage = isUnauthorized(error) && message === "请求失败"
              ? "邮箱或密码不正确"
              : message;
          }
          throw error;
        }
      });
      if (result) await result.refresh;
    },

    async logout() {
      if (logoutOperation) return await logoutOperation;
      const intent = ++authIntent;
      logoutPending = true;
      const logoutEpoch = openAuthEpoch({
        authRequired: false,
        loading: true,
        resetView: true,
      });
      let operation!: Promise<void>;
      operation = enqueueAuthMutation(async () => {
        try {
          await api.request("/api/auth/logout", {
            method: "POST",
            body: JSON.stringify({}),
          });
        } finally {
          logoutPending = false;
          if (intent === authIntent && state.authEpoch === logoutEpoch) {
            clearPrivateState({ authRequired: true, loading: false, resetView: true });
          }
        }
      });
      logoutOperation = operation;
      void operation.then(
        () => {
          if (logoutOperation === operation) logoutOperation = null;
        },
        () => {
          if (logoutOperation === operation) logoutOperation = null;
        },
      );
      return await operation;
    },

    setMessage(message: string) {
      if (logoutPending || state.authRequired) return;
      state.message = message;
    },

    setError(error: unknown) {
      if (logoutPending || state.authRequired) return;
      if ((typeof error === "object" && error !== null) || typeof error === "function") {
        const requestEpoch = requestErrorEpochs.get(error);
        if (requestEpoch !== undefined && requestEpoch !== state.authEpoch) return;
      }
      state.error = errorMessage(error);
    },

    clearError() {
      state.error = null;
    },
  };

  return store;
}

// Kept as a small compatibility alias for callers that prefer the filename's wording.
export const createAppStore = createWorkoutAppStore;
