import { ref, type Ref } from "vue";

import type { WorkoutAppStore } from "../../core/contracts";

export type NumericDraft = number | "";

export interface CorrectionItemDraft {
  value: NumericDraft;
  weight: NumericDraft;
  rir: NumericDraft;
}

export interface CorrectionDraftInput {
  authEpoch: number;
  sessionKey: string;
  mode: boolean;
  items: Record<string, CorrectionItemDraft>;
  rpe: NumericDraft;
  note: string;
  skipReason: string;
  feedback: Record<string, string>;
}

export interface RetainedCorrectionDraft extends CorrectionDraftInput {
  version: number;
}

export interface CalendarRuntimeChange {
  kind: "saved" | "cancelled" | "identity";
  authEpoch: number;
  sessionKey: string | null;
}

export interface CalendarRuntime {
  authEpoch: number;
  corrections: Map<string, RetainedCorrectionDraft>;
  changeSequence: Ref<number>;
  lastChange: Ref<CalendarRuntimeChange | null>;
}

const runtimes = new WeakMap<WorkoutAppStore, CalendarRuntime>();

function cloneItems(items: Record<string, CorrectionItemDraft>): Record<string, CorrectionItemDraft> {
  return Object.fromEntries(Object.entries(items).map(([key, item]) => [key, { ...item }]));
}

function cloneDraft(draft: RetainedCorrectionDraft): RetainedCorrectionDraft {
  return {
    ...draft,
    items: cloneItems(draft.items),
    feedback: { ...draft.feedback },
  };
}

function publishChange(runtime: CalendarRuntime, change: CalendarRuntimeChange): void {
  runtime.lastChange.value = change;
  runtime.changeSequence.value += 1;
}

export function syncCalendarRuntimeAuth(runtime: CalendarRuntime, authEpoch: number): boolean {
  if (runtime.authEpoch === authEpoch) return false;
  runtime.authEpoch = authEpoch;
  runtime.corrections.clear();
  publishChange(runtime, { kind: "identity", authEpoch, sessionKey: null });
  return true;
}

export function getCalendarRuntime(app: WorkoutAppStore): CalendarRuntime {
  let runtime = runtimes.get(app);
  if (!runtime) {
    runtime = {
      authEpoch: app.state.authEpoch,
      corrections: new Map(),
      changeSequence: ref(0),
      lastChange: ref(null),
    };
    runtimes.set(app, runtime);
    return runtime;
  }
  syncCalendarRuntimeAuth(runtime, app.state.authEpoch);
  return runtime;
}

export function correctionDraftFor(
  runtime: CalendarRuntime,
  authEpoch: number,
  sessionKey: string,
): RetainedCorrectionDraft | null {
  if (runtime.authEpoch !== authEpoch) return null;
  const draft = runtime.corrections.get(sessionKey);
  return draft?.authEpoch === authEpoch ? cloneDraft(draft) : null;
}

export function retainCorrectionDraft(
  runtime: CalendarRuntime,
  input: CorrectionDraftInput,
): RetainedCorrectionDraft | null {
  if (runtime.authEpoch !== input.authEpoch) return null;
  const previous = runtime.corrections.get(input.sessionKey);
  const draft: RetainedCorrectionDraft = {
    ...input,
    items: cloneItems(input.items),
    feedback: { ...input.feedback },
    version: (previous?.version ?? 0) + 1,
  };
  runtime.corrections.set(input.sessionKey, draft);
  return cloneDraft(draft);
}

export function clearCorrectionDraft(
  runtime: CalendarRuntime,
  options: {
    authEpoch: number;
    sessionKey: string;
    expectedVersion?: number;
    reason: "saved" | "cancelled";
  },
): boolean {
  if (runtime.authEpoch !== options.authEpoch) return false;
  const current = runtime.corrections.get(options.sessionKey);
  if (!current || current.authEpoch !== options.authEpoch) return false;
  if (options.expectedVersion !== undefined && current.version !== options.expectedVersion) return false;
  runtime.corrections.delete(options.sessionKey);
  publishChange(runtime, {
    kind: options.reason,
    authEpoch: options.authEpoch,
    sessionKey: options.sessionKey,
  });
  return true;
}
