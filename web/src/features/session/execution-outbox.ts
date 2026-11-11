import type { ApiClient } from "../../core/contracts";
import type {
  CanonicalSetResultInput, ExerciseFeedback, LegacyCompletionResultInput,
  SessionDetail, TrainingInterval,
} from "./session-types";

export type ExecutionAction =
  | { type: "pause" | "resume"; at: string }
  | { type: "record"; results: Array<CanonicalSetResultInput | LegacyCompletionResultInput>; exercise_feedback: ExerciseFeedback[] };

interface Journal {
  base: string;
  actions: ExecutionAction[];
  sending?: { key: string; count: number };
  end?: { body: string; key: string };
}

interface SyncResponse extends SessionDetail {
  synced_updated_at: string;
}

const prefix = "workout-execution-v1:";
const pageKey = "workout-execution-tab";
const batchSize = 32;
const requests = new Map<string, Promise<SyncResponse | null>>();

function namespace(athlete: string): string {
  let tab = sessionStorage.getItem(pageKey);
  if (!tab) {
    tab = crypto.randomUUID();
    sessionStorage.setItem(pageKey, tab);
  }
  return `${prefix}${athlete}:${tab}:`;
}

export function pendingExecutionSession(athlete: string): string | null {
  const scope = namespace(athlete);
  const key = Object.keys(localStorage).find((value) => value.startsWith(scope));
  return key?.slice(scope.length) || null;
}

export function executionOutbox(api: ApiClient, athlete: string, sessionKey: string) {
  const key = namespace(athlete) + sessionKey;
  const storage = localStorage;

  function read(): Journal | null {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw) as Journal;
    if (typeof value.base !== "string" || !Array.isArray(value.actions)
      || (!value.actions.length && !value.end)
      || (value.sending && (!Number.isInteger(value.sending.count) || value.sending.count < 1
        || value.sending.count > Math.min(value.actions.length, batchSize) || typeof value.sending.key !== "string"))
      || (value.end && (typeof value.end.body !== "string" || typeof value.end.key !== "string"))) {
      throw new Error("本机训练草稿无法读取");
    }
    return value;
  }

  function enqueue(base: string, action: ExecutionAction): void {
    const journal = read() ?? { base, actions: [] };
    if (journal.end) throw new Error("请先确认上次结束训练的提交");
    storage.setItem(key, JSON.stringify({ ...journal, actions: [...journal.actions, action] }));
  }

  function freezeEnd(base: string, body: string, idempotencyKey: string): void {
    const current = read();
    if (current?.actions.length) throw new Error("还有训练操作待同步");
    if (current?.end && (current.end.body !== body || current.end.key !== idempotencyKey)) {
      throw new Error("请先确认上次结束训练的提交");
    }
    storage.setItem(key, JSON.stringify({ base, actions: [], end: { body, key: idempotencyKey } }));
  }

  function sync(keepalive = false): Promise<SyncResponse | null> {
    const existing = requests.get(key);
    if (existing) return existing;
    const journal = read();
    if (!journal?.actions.length) return Promise.resolve(null);
    const sending = journal.sending ?? { key: api.idempotencyKey(), count: Math.min(batchSize, journal.actions.length) };
    storage.setItem(key, JSON.stringify({ ...journal, sending }));
    const body = JSON.stringify({ base_updated_at: journal.base, actions: journal.actions.slice(0, sending.count) });
    const request = api.request<SyncResponse>(`/api/private/sessions/${encodeURIComponent(sessionKey)}/sync`, {
      method: "POST",
      headers: { "Idempotency-Key": sending.key },
      body,
      keepalive: keepalive && new Blob([body]).size < 60_000,
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15_000) : undefined,
    }).then((result) => {
      const current = read();
      if (current?.sending?.key === sending.key) {
        const remaining = current.actions.slice(sending.count);
        if (remaining.length) {
          storage.setItem(key, JSON.stringify({ base: result.synced_updated_at, actions: remaining }));
        } else {
          storage.removeItem(key);
        }
      }
      return result;
    }).finally(() => {
      if (requests.get(key) === request) requests.delete(key);
    });
    requests.set(key, request);
    return request;
  }

  function discard(): void {
    storage.removeItem(key);
  }

  return { read, enqueue, freezeEnd, sync, discard };
}

export function projectExecutionAction(detail: SessionDetail, action: ExecutionAction): SessionDetail {
  if (action.type === "record") {
    const keys = new Set(action.results.map((result) => result.completion_item_key));
    const results = action.results.map((result) => {
      if (!("status" in result)) return result;
      const { resistance } = result;
      return {
        ...result,
        resistance: resistance?.mode === "external_load" ? { mode: "external_load" as const, load_kg: resistance.value, quantity: 1 } : resistance,
        resistance_mode: resistance?.mode ?? null,
        resistance_kg: resistance?.mode === "external_load" ? resistance.value : null,
        completed: result.status === "completed",
      };
    });
    return {
      ...detail,
      completion_results: [...detail.completion_results.filter((result) => !keys.has(result.completion_item_key)), ...results],
      exercise_feedback: action.exercise_feedback,
    };
  }
  const intervals: TrainingInterval[] = detail.training_intervals.map((interval) => (
    action.type === "pause" && interval.ended_at === null ? { ...interval, ended_at: action.at } : interval
  ));
  if (action.type === "resume") {
    intervals.push({ interval_key: "pending:" + action.at, started_at: action.at, ended_at: null });
  }
  return { ...detail, training_intervals: intervals };
}
