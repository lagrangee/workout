import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  readonly,
  shallowReadonly,
  watch,
} from "vue";

import { errorMessage, WorkoutApiError } from "../../core/api-client";
import type { JsonRecord, WorkoutAppStore } from "../../core/contracts";
import {
  createWorkoutTimeline,
  type AudioOutput,
  type AudioResultLike,
} from "../../lib/workout-timeline";
import {
  canonicalDurationSeconds,
  canonicalResultResistanceInput,
  canonicalStoredResultInput,
  completionKeys,
  displayCompletionItems,
  displayItemDone,
  editableResistance,
  exerciseExecutionModeLabel,
  focusResistance,
  focusTarget,
  formatActual,
  formatResistance,
  formatTarget,
  formatTempo,
  itemContext,
  itemLabel,
  legacyResultResistanceInput,
  resistanceDraftValue,
  resultForDisplay,
  resultResistanceInput,
} from "./session-model";
import type {
  CanonicalSetResultInput,
  CompletionItem,
  DisplayCompletionItem,
  ExerciseFeedback,
  ResistanceValue,
  SessionCompletionResult,
  SessionDetail,
  SessionSnapshot,
  SnapshotBlock,
  SnapshotExercise,
  SnapshotSet,
  TargetValue,
  TrainingInterval,
} from "./session-types";

type MutationAction = "start" | "continue" | "restart" | "complete" | "pause" | "resume";
type PauseReason = "manual" | "visibility" | "wake-lock" | "navigation" | "pagehide" | "end-form" | string;
type TimedPhase = "idle" | "preparing" | "active" | "complete";
type SessionMode = "overview" | "execution" | "correction";
type WakeLockStatus = "idle" | "requesting" | "active" | "released" | "hidden" | "unsupported" | "denied";

interface WorkoutTestSeams {
  now?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  audio?: AudioOutput;
}

interface TimedActionState {
  itemKey: string | null;
  phase: TimedPhase;
  targetSec: number | null;
  deadlineMs: number | null;
  remainingMs: number | null;
  remainingSec: number | null;
}

interface ShowSessionOptions {
  active?: boolean;
  forcePaused?: boolean;
  pauseReason?: PauseReason;
  pausedAt?: number;
  restSeconds?: number;
  nextIndex?: number | null;
  openEnd?: boolean;
}

interface CorrectionItemDraft {
  value: string;
  weight: string;
  rir: string;
}

interface CorrectionDraft {
  items: Record<string, CorrectionItemDraft>;
  feedback: Record<string, string>;
  rpe: string;
  note: string;
  skipReason: string;
}

interface RetryableJsonRequest {
  path: string;
  method: "POST";
  body: string;
  idempotencyKey: string;
  uncertainAtMs?: number;
  uncertainReason?: PauseReason;
}

interface CompletionAttempt {
  sessionKey: string;
  itemKey: string;
  inputFingerprint: string;
  completedAt: string;
}

interface ExecutionDraftBucket {
  actual: Record<string, string>;
  resistance: Record<string, string>;
  rir: Record<string, string>;
  feedback: Record<string, string>;
}

export interface TodayEntryView extends JsonRecord {
  kind?: string;
  date?: string;
  title?: string;
  estimated_duration_min?: number;
  module_count?: number;
  recording_intent?: boolean | JsonRecord | null;
  recording_evidence?: { status?: "recorded" | "needs_link" | "awaiting_sync" } | null;
  aerobic_summary?: { activity_count?: number } | null;
  prescription?: SessionSnapshot | null;
}

// Today is conditionally mounted by the app shell. Draft ownership therefore
// has to outlive an individual Vue component while remaining isolated to the
// authenticated app instance and the authoritative Session identity.
const executionDraftsByApp = new WeakMap<WorkoutAppStore, Map<string, ExecutionDraftBucket>>();

interface RuntimeState {
  detail: SessionDetail | null;
  detailLoading: boolean;
  mode: SessionMode;
  focusIndex: number;
  progressOpen: boolean;
  adjust: boolean;
  actualDrafts: Record<string, string>;
  resistanceDrafts: Record<string, string>;
  rirDrafts: Record<string, string>;
  feedbackDraft: Record<string, string>;
  mutation: { action: MutationAction | null; pending: boolean; error: string | null };
  timedAction: TimedActionState;
  audio: { status: "idle" | "starting" | "ready" | "error"; error: string | null };
  muted: boolean;
  restUntil: number | null;
  restRemainingMs: number | null;
  restNextIndex: number | null;
  timerPaused: boolean;
  timerPauseReason: PauseReason | null;
  timerPauseStartedAt: number | null;
  pausePending: boolean;
  wakeLockStatus: WakeLockStatus;
  endSheet: boolean;
  endRpe: number;
  endNote: string;
  endFeedback: Record<string, string>;
  correctionDraft: CorrectionDraft;
  endPausePending: boolean;
  endSaving: boolean;
  endError: string | null;
  endReconciliationRequired: boolean;
  correctionSaving: boolean;
  correctionError: string | null;
  navigationPauseError: string | null;
  nowMs: number;
}

export type SessionIntent =
  | { type: "start" }
  | { type: "skip" }
  | { type: "restart" }
  | { type: "open-session" }
  | { type: "continue" }
  | { type: "start-timed" }
  | { type: "complete" }
  | { type: "previous" }
  | { type: "next" }
  | { type: "jump"; index: number }
  | { type: "toggle-adjust" }
  | { type: "toggle-progress" }
  | { type: "toggle-timer" }
  | { type: "toggle-mute" }
  | { type: "minimize" }
  | { type: "skip-rest" }
  | { type: "end" }
  | { type: "cancel-end" }
  | { type: "save-end" }
  | { type: "set-end-rpe"; value: number }
  | { type: "edit-session" }
  | { type: "cancel-correction" }
  | { type: "save-correction" }
  | { type: "draft-actual"; key: string; value: string }
  | { type: "draft-weight"; key: string; value: string }
  | { type: "draft-rir"; key: string; value: string }
  | { type: "draft-feedback"; key: string; value: string }
  | { type: "draft-end-note"; value: string }
  | { type: "draft-end-feedback"; key: string; value: string }
  | { type: "draft-correction-item"; key: string; field: keyof CorrectionItemDraft; value: string }
  | { type: "draft-correction-feedback"; key: string; value: string }
  | { type: "draft-correction-rpe"; value: string }
  | { type: "draft-correction-note"; value: string }
  | { type: "draft-correction-skip-reason"; value: string };

export const mutationPendingLabels: Record<MutationAction, string> = {
  start: "正在开始训练…",
  continue: "正在继续训练…",
  restart: "正在重新开始训练…",
  complete: "正在保存…",
  pause: "正在暂停…",
  resume: "正在继续…",
};

export const rpeMeanings = [
  { title: "休息状态", detail: "几乎没有用力。" },
  { title: "极轻松", detail: "呼吸平稳，完全不费力。" },
  { title: "很轻松", detail: "有活动感，但可以轻松持续。" },
  { title: "轻松", detail: "稍有用力，仍能自在交谈。" },
  { title: "中等偏轻", detail: "开始发热，但整体从容。" },
  { title: "中等", detail: "有明确训练感，仍可稳定维持。" },
  { title: "有些吃力", detail: "需要专注，但动作仍然稳定。" },
  { title: "吃力", detail: "呼吸明显加快，仍能保持标准。" },
  { title: "非常吃力", detail: "只能短时间维持，需要高度专注。" },
  { title: "接近极限", detail: "非常吃力，但仍能按标准完成。" },
  { title: "最大用力", detail: "已到极限；若有未完成，请在备注说明。" },
] as const;

const preparationDurationSec = 5;

function blankTimedAction(): TimedActionState {
  return {
    itemKey: null,
    phase: "idle",
    targetSec: null,
    deadlineMs: null,
    remainingMs: null,
    remainingSec: null,
  };
}

function blankCorrectionDraft(): CorrectionDraft {
  return { items: {}, feedback: {}, rpe: "", note: "", skipReason: "" };
}

function hasOpenTrainingInterval(detail: SessionDetail | null | undefined): boolean {
  return Boolean(detail?.training_intervals.some((interval) => interval.ended_at === null));
}

function percentage(value: unknown): string {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function audioFailureFor(result: AudioResultLike): string | null {
  if (result === false) return "音频播放失败";
  if (result && typeof result === "object" && result.ok === false) return result.error || "音频播放失败";
  return null;
}

function numberOrNull(value: string | null | undefined): number | null {
  return value == null || value === "" ? null : Number(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
}

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isTargetValue(value: unknown): value is TargetValue {
  return isRecord(value)
    && typeof value.metric === "string"
    && optionalNumber(value.value)
    && optionalNumber(value.min)
    && optionalNumber(value.max)
    && optionalNumber(value.target_rir)
    && optionalNumber(value.target_rpe)
    && optionalNumber(value.target_incline_percent);
}

function isResistanceValue(value: unknown): value is ResistanceValue {
  return isRecord(value)
    && ["bodyweight", "external_load", "external_weight", "assisted_weight"].includes(String(value.mode))
    && optionalNumber(value.load_kg)
    && optionalNumber(value.value)
    && optionalString(value.unit)
    && optionalNumber(value.quantity);
}

function isTempoValue(value: unknown): boolean {
  return value === undefined
    || value === null
    || typeof value === "string"
    || (isRecord(value)
      && optionalNumber(value.eccentric_sec)
      && optionalNumber(value.bottom_hold_sec)
      && optionalNumber(value.concentric_sec)
      && optionalNumber(value.top_hold_sec));
}

function isSnapshotSet(value: unknown): value is SnapshotSet {
  return isRecord(value)
    && isTargetValue(value.target)
    && optionalString(value.set_key)
    && optionalString(value.set_id)
    && optionalNumber(value.ordinal)
    && (value.resistance === undefined || value.resistance === null || isResistanceValue(value.resistance))
    && optionalString(value.resistance_mode)
    && optionalNumber(value.resistance_kg)
    && isTempoValue(value.tempo)
    && optionalNumber(value.rest_after_sec)
    && optionalNumber(value.target_rir)
    && optionalNumber(value.target_rpe)
    && optionalNumber(value.target_incline_percent);
}

function isSnapshotExercise(value: unknown): value is SnapshotExercise {
  return isRecord(value)
    && optionalString(value.exercise_occurrence_key)
    && optionalString(value.occurrence_key)
    && optionalString(value.exercise_key)
    && optionalString(value.exercise_id)
    && optionalString(value.name)
    && optionalString(value.execution_mode)
    && optionalString(value.side_mode)
    && (value.sets === undefined || (Array.isArray(value.sets) && value.sets.every(isSnapshotSet)));
}

function isSnapshotBlock(value: unknown): value is SnapshotBlock {
  return isRecord(value)
    && optionalString(value.block_key)
    && optionalString(value.title)
    && (value.exercises === undefined
      || (Array.isArray(value.exercises) && value.exercises.every(isSnapshotExercise)));
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  return isRecord(value)
    && optionalNumber(value.schema_version)
    && optionalString(value.title)
    && optionalString(value.start_time)
    && optionalNumber(value.estimated_duration_min)
    && (value.blocks === undefined || (Array.isArray(value.blocks) && value.blocks.every(isSnapshotBlock)));
}

function isTodayEntryView(value: unknown): value is TodayEntryView {
  if (!isRecord(value)
    || !optionalString(value.kind)
    || !optionalString(value.date)
    || !optionalString(value.title)
    || !optionalNumber(value.estimated_duration_min)
    || !optionalNumber(value.module_count)
    || !(value.recording_intent === undefined
      || value.recording_intent === null
      || typeof value.recording_intent === "boolean"
      || isRecord(value.recording_intent))) return false;
  if (value.recording_evidence !== undefined && value.recording_evidence !== null) {
    if (!isRecord(value.recording_evidence)
      || (value.recording_evidence.status !== undefined
        && !["recorded", "needs_link", "awaiting_sync"].includes(String(value.recording_evidence.status)))) return false;
  }
  if (value.aerobic_summary !== undefined && value.aerobic_summary !== null) {
    if (!isRecord(value.aerobic_summary) || !optionalNumber(value.aerobic_summary.activity_count)) return false;
  }
  return value.prescription === undefined
    || value.prescription === null
    || isSessionSnapshot(value.prescription);
}

function isoNow(): string {
  return new Date().toISOString();
}

export function useSessionExecution(
  app: WorkoutAppStore,
  onExecutionFocusChange: (focused: boolean) => void = () => {},
) {
  const seams = typeof window === "undefined"
    ? {}
    : ((window as Window & { __workoutTestSeams?: WorkoutTestSeams }).__workoutTestSeams ?? {});
  const clockNow = (): number => typeof seams.now === "function" ? Number(seams.now()) : Date.now();
  const countdownNow = (): number => typeof seams.now === "function"
    ? Number(seams.now())
    : typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const requestFrame: (callback: FrameRequestCallback) => number = seams.requestAnimationFrame
    ?? (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame.bind(globalThis)
      : ((callback: FrameRequestCallback) => Number(globalThis.setTimeout(() => callback(countdownNow()), 16))));
  const cancelFrame: (handle: number) => void = seams.cancelAnimationFrame
    ?? (typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame.bind(globalThis)
      : ((handle: number) => globalThis.clearTimeout(handle)));
  const timeline = createWorkoutTimeline({
    audioOutput: seams.audio ?? null,
    now: countdownNow,
    leadTimeMs: seams.audio ? 0 : 50,
  });

  const state = reactive<RuntimeState>({
    detail: null,
    detailLoading: false,
    mode: "overview",
    focusIndex: 0,
    progressOpen: false,
    adjust: false,
    actualDrafts: {},
    resistanceDrafts: {},
    rirDrafts: {},
    feedbackDraft: {},
    mutation: { action: null, pending: false, error: null },
    timedAction: blankTimedAction(),
    audio: { status: "idle", error: null },
    muted: false,
    restUntil: null,
    restRemainingMs: null,
    restNextIndex: null,
    timerPaused: false,
    timerPauseReason: null,
    timerPauseStartedAt: null,
    pausePending: false,
    wakeLockStatus: "idle",
    endSheet: false,
    endRpe: 8,
    endNote: "",
    endFeedback: {},
    correctionDraft: blankCorrectionDraft(),
    endPausePending: false,
    endSaving: false,
    endError: null,
    endReconciliationRequired: false,
    correctionSaving: false,
    correctionError: null,
    navigationPauseError: null,
    nowMs: countdownNow(),
  });

  let timerHandle: number | null = null;
  let wakeLockSentinel: WakeLockSentinel | null = null;
  let wakeLockRequestPending = false;
  let wakeLockRequestId = 0;
  let audioActivationGeneration = 0;
  let resumeGeneration = 0;
  let resumeRequestPromise: Promise<SessionDetail> | null = null;
  let resumeRequestRecovery: (() => Promise<SessionDetail>) | null = null;
  let retryableResumeRequest: RetryableJsonRequest | null = null;
  let pendingActiveMutation: Promise<SessionDetail> | null = null;
  let pendingActiveRecovery: (() => Promise<SessionDetail>) | null = null;
  let pendingPauseRequest: Promise<SessionDetail> | null = null;
  let retryablePauseRequest: RetryableJsonRequest | null = null;
  let pauseRequestAttemptGeneration = 0;
  let interruptionPausePromise: Promise<SessionDetail | null> | null = null;
  let interruptionPauseUrgent = false;
  let interruptionPauseGeneration = 0;
  let endPausePromise: Promise<SessionDetail | null> | null = null;
  const retryableActiveRequests = new Map<"start" | "continue" | "restart", RetryableJsonRequest>();
  let retryableEndRequest: RetryableJsonRequest | null = null;
  let completionAttempt: CompletionAttempt | null = null;
  let detailLoadGeneration = 0;
  let disposed = false;
  let pagehideBoundaryMs: number | null = null;
  let bfcacheRecoveryRequired = false;
  let bfcacheRecoveryPromise: Promise<boolean> | null = null;
  let draftAuthEpoch = app.state.authEpoch;
  let draftSessionKey: string | null = null;

  const summary = computed<JsonRecord | null>(() => app.state.session ?? app.state.today?.session ?? null);
  const entry = computed<TodayEntryView | null>(() => {
    const candidate = app.state.today?.entry;
    return isTodayEntryView(candidate) ? candidate : null;
  });
  const items = computed<DisplayCompletionItem[]>(() => state.detail ? displayCompletionItems(state.detail) : []);
  const focusedItem = computed<DisplayCompletionItem | null>(() => items.value[state.focusIndex] ?? items.value[0] ?? null);
  const focusedContext = computed(() => itemContext(state.detail, focusedItem.value));
  const focusedResult = computed<SessionCompletionResult | null>(() => resultForDisplay(state.detail, focusedItem.value));
  const focusedDone = computed<boolean>(() => displayItemDone(state.detail, focusedItem.value));
  const completedCount = computed<number>(() => items.value.filter((item) => displayItemDone(state.detail, item)).length);
  const executionFocused = computed<boolean>(() => state.mode === "execution" && state.detail?.status === "in_progress");
  const restActive = computed<boolean>(() => (state.restUntil !== null || state.restRemainingMs !== null) && state.restNextIndex !== null);
  const restNextItem = computed<DisplayCompletionItem | null>(() => items.value[state.restNextIndex ?? state.focusIndex] ?? focusedItem.value);
  const timedTarget = computed<number | null>(() => canonicalDurationSeconds(focusedItem.value?.target));
  const timedForFocus = computed<TimedActionState>(() => state.timedAction.itemKey === focusedItem.value?.completion_item_key
    ? state.timedAction
    : blankTimedAction());
  const focusActualDraft = computed<string>(() => {
    const item = focusedItem.value;
    if (!item) return "";
    const timed = timedForFocus.value;
    if (timedTarget.value !== null) {
      return state.actualDrafts[item.completion_item_key]
        ?? String(focusedResult.value?.actual?.value ?? (timed.phase === "complete" ? timedTarget.value : ""));
    }
    return state.actualDrafts[item.completion_item_key]
      ?? String(focusedResult.value?.actual?.value ?? item.target?.value ?? item.target?.min ?? 1);
  });
  const focusResistanceDraft = computed<string>(() => {
    const item = focusedItem.value;
    if (!item) return "";
    return state.resistanceDrafts[item.completion_item_key] ?? resistanceDraftValue(item, focusedResult.value);
  });
  const focusRirDraft = computed<string>(() => {
    const item = focusedItem.value;
    if (!item) return "";
    return state.rirDrafts[item.completion_item_key] ?? String(focusedResult.value?.rir ?? "");
  });
  const focusFeedbackDraft = computed<string>(() => {
    const item = focusedItem.value;
    if (!item) return "";
    return state.feedbackDraft[item.exercise_occurrence_key]
      ?? state.detail?.exercise_feedback?.find((candidate) => candidate.exercise_occurrence_key === item.exercise_occurrence_key)?.text
      ?? "";
  });
  const completeBlocked = computed<boolean>(() => {
    const timed = timedTarget.value !== null;
    return focusedDone.value
      || state.timerPaused
      || (state.mutation.pending && state.mutation.action === "complete")
      || (timed && timedForFocus.value.phase !== "complete");
  });

  function draftIdentity(sessionKey: string, authEpoch = draftAuthEpoch): string {
    return `${authEpoch}:${sessionKey}`;
  }

  function draftBuckets(): Map<string, ExecutionDraftBucket> {
    const existing = executionDraftsByApp.get(app);
    if (existing) return existing;
    const created = new Map<string, ExecutionDraftBucket>();
    executionDraftsByApp.set(app, created);
    return created;
  }

  function executionDraftBucket(sessionKey: string, create = false): ExecutionDraftBucket | null {
    const buckets = draftBuckets();
    const identity = draftIdentity(sessionKey);
    const existing = buckets.get(identity);
    if (existing || !create) return existing ?? null;
    const created: ExecutionDraftBucket = { actual: {}, resistance: {}, rir: {}, feedback: {} };
    buckets.set(identity, created);
    return created;
  }

  function resetExecutionDraftState(detail: SessionDetail | null = state.detail): void {
    state.actualDrafts = {};
    state.resistanceDrafts = {};
    state.rirDrafts = {};
    state.feedbackDraft = Object.fromEntries((detail?.exercise_feedback ?? []).map(
      (feedback) => [feedback.exercise_occurrence_key, feedback.text],
    ));
  }

  function bindExecutionDrafts(detail: SessionDetail): void {
    const nextSessionKey = detail.session_key;
    const buckets = draftBuckets();
    const nextIdentity = draftIdentity(nextSessionKey);
    for (const identity of buckets.keys()) {
      if (identity.startsWith(`${draftAuthEpoch}:`) && identity !== nextIdentity) {
        buckets.delete(identity);
      }
    }
    if (draftSessionKey && draftSessionKey !== nextSessionKey) {
      buckets.delete(draftIdentity(draftSessionKey));
    }
    draftSessionKey = nextSessionKey;
    const bucket = detail.status === "in_progress" ? executionDraftBucket(nextSessionKey) : null;
    if (detail.status !== "in_progress") buckets.delete(nextIdentity);
    state.actualDrafts = { ...(bucket?.actual ?? {}) };
    state.resistanceDrafts = { ...(bucket?.resistance ?? {}) };
    state.rirDrafts = { ...(bucket?.rir ?? {}) };
    state.feedbackDraft = {
      ...Object.fromEntries(detail.exercise_feedback.map(
        (feedback) => [feedback.exercise_occurrence_key, feedback.text],
      )),
      ...(bucket?.feedback ?? {}),
    };
  }

  function writeExecutionDraft(
    field: keyof ExecutionDraftBucket,
    key: string,
    value: string,
  ): void {
    const sessionKey = state.detail?.session_key ?? draftSessionKey;
    if (field === "actual") state.actualDrafts[key] = value;
    else if (field === "resistance") state.resistanceDrafts[key] = value;
    else if (field === "rir") state.rirDrafts[key] = value;
    else state.feedbackDraft[key] = value;
    if (sessionKey) executionDraftBucket(sessionKey, true)![field][key] = value;
  }

  function documentIsVisible(): boolean {
    return typeof document === "undefined" || document.hidden !== true;
  }

  function currentInterruptionReason(): PauseReason {
    if (disposed) return "navigation";
    if (!documentIsVisible()) return "visibility";
    return state.timerPauseReason ?? "navigation";
  }

  function isExecutionSurface(): boolean {
    return executionFocused.value && !state.endSheet;
  }

  function isVisibleSession(): boolean {
    return isExecutionSurface() && !state.timerPaused && documentIsVisible();
  }

  function wakeLockSupported(): boolean {
    return typeof navigator !== "undefined"
      && typeof navigator.wakeLock?.request === "function";
  }

  function syncDetail(detail: SessionDetail): void {
    bindExecutionDrafts(detail);
    state.detail = detail;
    if (completionAttempt
      && (completionAttempt.sessionKey !== detail.session_key
        || detail.completion_results.some(
          (result) => result.completion_item_key === completionAttempt?.itemKey,
        ))) {
      completionAttempt = null;
    }
    app.state.session = detail as unknown as JsonRecord;
    if (app.state.today) app.state.today.session = detail as unknown as JsonRecord;
  }

  function beginMutation(action: MutationAction): boolean {
    if (state.mutation.pending) return false;
    state.mutation = { action, pending: true, error: null };
    app.clearError();
    return true;
  }

  function clearMutation(): void {
    state.mutation = { action: null, pending: false, error: null };
  }

  function failMutation(action: MutationAction, error: unknown): void {
    state.mutation = { action, pending: false, error: errorMessage(error) || "请求失败，请重试" };
  }

  function observeAudioResult(result: ReturnType<typeof timeline.scheduleAction>["result"]): Promise<AudioResultLike> | AudioResultLike {
    if (result && typeof (result as Promise<AudioResultLike>).then === "function") {
      return Promise.resolve(result).then((outcome) => {
        const failure = audioFailureFor(outcome);
        state.audio = failure ? { status: "error", error: failure } : { status: "ready", error: null };
        return outcome;
      }).catch((error: unknown) => {
        state.audio = { status: "error", error: errorMessage(error) || "音频播放失败" };
        return { ok: false, error: errorMessage(error) };
      });
    }
    const failure = audioFailureFor(result as AudioResultLike);
    state.audio = failure ? { status: "error", error: failure } : { status: "ready", error: null };
    return result as AudioResultLike;
  }

  function invalidateAudioActivation(): void {
    audioActivationGeneration += 1;
  }

  function resetTimedAction(): void {
    invalidateAudioActivation();
    state.timedAction = blankTimedAction();
    timeline.cancel();
  }

  function clearRestCountdown({ cancelAudio = true }: { cancelAudio?: boolean } = {}): void {
    invalidateAudioActivation();
    state.restUntil = null;
    state.restRemainingMs = null;
    state.restNextIndex = null;
    if (cancelAudio) timeline.cancel();
  }

  function updateTimedAction(now = countdownNow()): boolean {
    const timer = state.timedAction;
    if (timer.phase !== "preparing" && timer.phase !== "active") return false;
    let changed = false;
    if (timer.phase === "preparing") {
      if (timer.deadlineMs === null) return false;
      const remainingMs = Math.max(0, timer.deadlineMs - now);
      timer.remainingMs = remainingMs;
      timer.remainingSec = remainingMs === 0 ? 0 : Math.ceil(remainingMs / 1000);
      if (now < timer.deadlineMs) return false;
      timer.phase = "active";
      timer.deadlineMs += Number(timer.targetSec) * 1000;
      timer.remainingMs = Number(timer.targetSec) * 1000;
      timer.remainingSec = Number(timer.targetSec);
      changed = true;
    }
    if (timer.phase === "active") {
      const remainingMs = Math.max(0, (timer.deadlineMs ?? now) - now);
      const remainingSec = remainingMs === 0 ? 0 : Math.ceil(remainingMs / 1000);
      timer.remainingMs = remainingMs;
      timer.remainingSec = remainingSec;
      if (remainingSec === 0) {
        timer.phase = "complete";
        timer.deadlineMs = null;
        if (timer.itemKey) writeExecutionDraft("actual", timer.itemKey, String(timer.targetSec));
        changed = true;
      }
    }
    return changed;
  }

  function pauseTimedAction(now = countdownNow()): void {
    updateTimedAction(now);
    const timer = state.timedAction;
    if ((timer.phase === "preparing" || timer.phase === "active") && timer.deadlineMs !== null) {
      timer.remainingMs = Math.max(0, timer.deadlineMs - now);
      timer.remainingSec = timer.remainingMs === 0 ? 0 : Math.ceil(timer.remainingMs / 1000);
      timer.deadlineMs = null;
    }
  }

  function resumeTimedAction(): void {
    const timer = state.timedAction;
    if ((timer.phase !== "preparing" && timer.phase !== "active") || !(Number(timer.remainingMs) > 0)) return;
    const audible = !state.muted && state.audio.status === "ready";
    const scheduled = timeline.scheduleAction({
      phase: timer.phase,
      remainingMs: Number(timer.remainingMs),
      targetSec: Number(timer.targetSec),
      audible,
    });
    timer.deadlineMs = scheduled.phaseEndsAtMs;
    if (audible) void observeAudioResult(scheduled.result);
  }

  function pauseRestCountdown(now = countdownNow()): void {
    if (state.restUntil === null) return;
    state.restRemainingMs = Math.max(0, state.restUntil - now);
    state.restUntil = null;
  }

  function resumeRestCountdown(): void {
    if (state.restRemainingMs === null) return;
    const audible = !state.muted && state.audio.status === "ready";
    const scheduled = timeline.scheduleRest({ remainingMs: state.restRemainingMs, audible });
    state.restUntil = scheduled.endsAtMs;
    state.restRemainingMs = null;
    if (audible) void observeAudioResult(scheduled.result);
  }

  function pauseExecutionTimers(): void {
    invalidateAudioActivation();
    const now = countdownNow();
    pauseTimedAction(now);
    pauseRestCountdown(now);
    timeline.cancel();
  }

  function resumeExecutionTimers(): void {
    resumeTimedAction();
    resumeRestCountdown();
  }

  function stopSessionClock(): void {
    if (timerHandle !== null) cancelFrame(timerHandle);
    timerHandle = null;
  }

  function sessionElapsed(now = clockNow()): string {
    const seconds = (state.detail?.training_intervals ?? []).reduce((total: number, interval: TrainingInterval) => {
      const end = interval.ended_at
        ? Date.parse(interval.ended_at)
        : state.timerPaused && state.timerPauseStartedAt
          ? state.timerPauseStartedAt
          : now;
      return total + Math.max(0, (end - Date.parse(interval.started_at)) / 1000);
    }, 0);
    const rounded = Math.max(0, Math.round(seconds));
    return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
  }

  function restRemainingLabel(): string {
    const milliseconds = state.restUntil === null
      ? state.restRemainingMs ?? 0
      : Math.max(0, state.restUntil - state.nowMs);
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function actionRemainingLabel(): string {
    const timer = timedForFocus.value;
    if (timer.phase === "idle") return "—";
    return String(Math.max(0, Math.ceil(Number(timer.remainingSec) || 0))).padStart(2, "0");
  }

  function updateSessionClock(): void {
    if (!isVisibleSession()) return stopSessionClock();
    state.nowMs = countdownNow();
    if (state.restUntil !== null) {
      const remaining = Math.max(0, Math.ceil((state.restUntil - state.nowMs) / 1000));
      if (remaining === 0) {
        state.focusIndex = state.restNextIndex ?? state.focusIndex;
        clearRestCountdown({ cancelAudio: false });
      }
      return;
    }
    updateTimedAction(state.nowMs);
  }

  function runSessionClockFrame(): void {
    timerHandle = null;
    updateSessionClock();
    if (isVisibleSession() && timerHandle === null) timerHandle = requestFrame(runSessionClockFrame);
  }

  function syncSessionClock(): void {
    if (!isVisibleSession()) return stopSessionClock();
    if (timerHandle === null) timerHandle = requestFrame(runSessionClockFrame);
    updateSessionClock();
  }

  function releaseWakeLock(): void {
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    wakeLockRequestPending = false;
    wakeLockRequestId += 1;
    try {
      const released = sentinel?.release?.();
      if (released && typeof (released as Promise<void>).catch === "function") {
        void Promise.resolve(released).catch(() => {});
      }
    } catch {
      // Releasing a browser-owned resource is best effort.
    }
  }

  function handleWakeLockRelease(sentinel: WakeLockSentinel): void {
    if (wakeLockSentinel !== sentinel) return;
    wakeLockSentinel = null;
    wakeLockRequestPending = false;
    state.wakeLockStatus = documentIsVisible() ? "released" : "hidden";
    void pauseForInterruption(documentIsVisible() ? "wake-lock" : "visibility").catch(() => {});
  }

  async function requestWakeLock({ force = false }: { force?: boolean } = {}): Promise<boolean> {
    if (!isVisibleSession() || !wakeLockSupported()) {
      if (isVisibleSession() && !wakeLockSupported()) state.wakeLockStatus = "unsupported";
      return false;
    }
    if (wakeLockSentinel && !wakeLockSentinel.released) {
      state.wakeLockStatus = "active";
      return true;
    }
    if (wakeLockRequestPending) return false;
    if (!force && ["unsupported", "denied", "released"].includes(state.wakeLockStatus)) return false;
    const requestId = ++wakeLockRequestId;
    wakeLockRequestPending = true;
    state.wakeLockStatus = "requesting";
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (requestId !== wakeLockRequestId || !isVisibleSession()) {
        try { await sentinel.release?.(); } catch { /* stale request */ }
        return false;
      }
      if (sentinel.released) {
        wakeLockRequestPending = false;
        state.wakeLockStatus = "released";
        void pauseForInterruption(documentIsVisible() ? "wake-lock" : "visibility").catch(() => {});
        return false;
      }
      wakeLockSentinel = sentinel;
      wakeLockRequestPending = false;
      state.wakeLockStatus = "active";
      const onRelease = (): void => handleWakeLockRelease(sentinel);
      if (typeof sentinel.addEventListener === "function") sentinel.addEventListener("release", onRelease);
      else sentinel.onrelease = onRelease;
      return true;
    } catch {
      if (requestId !== wakeLockRequestId) return false;
      wakeLockRequestPending = false;
      state.wakeLockStatus = "denied";
      // Permission/platform failure is a visible degraded mode, not an
      // execution interruption. Only losing an acquired sentinel pauses.
      return false;
    }
  }

  function syncWakeLock(): void {
    if (!isVisibleSession()) {
      if (wakeLockSentinel || wakeLockRequestPending) releaseWakeLock();
      return;
    }
    if (wakeLockSentinel || wakeLockRequestPending || ["unsupported", "denied", "released"].includes(state.wakeLockStatus)) return;
    void requestWakeLock();
  }

  function pauseBoundary(detail: SessionDetail, now: number): string | null {
    const open = detail.training_intervals.find((interval) => interval.ended_at === null);
    if (!open || now <= Date.parse(open.started_at) || now > Date.now()) return null;
    return new Date(now).toISOString();
  }

  function recoveredOpenBoundaryMs(detail: SessionDetail): number {
    const open = detail.training_intervals.find((interval) => interval.ended_at === null);
    const startedAt = Date.parse(open?.started_at ?? "");
    const updatedAt = Date.parse(detail.updated_at ?? "");
    if (!Number.isFinite(startedAt)) return clockNow();
    return Math.max(
      startedAt + 1,
      Math.min(Number.isFinite(updatedAt) ? updatedAt : startedAt + 1, Date.now()),
    );
  }

  function interruptionBoundary(detail: SessionDetail, interruptedAt: number): string | null {
    const open = detail.training_intervals.find((interval) => interval.ended_at === null);
    if (!open) return null;
    const startedAt = Date.parse(open.started_at);
    if (!Number.isFinite(startedAt)) return null;
    // The server may commit a pending start/resume after the browser is already
    // hidden. Close at the interruption instant when possible, otherwise at
    // the first valid millisecond after the server-created interval begins.
    const boundary = Math.max(interruptedAt, startedAt + 1);
    return boundary <= Date.now() ? new Date(boundary).toISOString() : null;
  }

  function postSessionCommand(
    sessionKey: string,
    command: "pause" | "resume" | "continue" | "restart",
    body: JsonRecord = {},
    options: RequestInit = {},
    idempotencyKey = app.api.idempotencyKey(),
  ): Promise<SessionDetail> {
    return app.api.request<SessionDetail>(`/api/private/sessions/${sessionKey}/${command}`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
      ...options,
    });
  }

  function sendRetryableRequest(request: RetryableJsonRequest, keepalive = false): Promise<SessionDetail> {
    return app.api.request<SessionDetail>(request.path, {
      method: request.method,
      headers: { "Idempotency-Key": request.idempotencyKey },
      body: request.body,
      keepalive,
    });
  }

  function activeRequest(
    action: "start" | "continue" | "restart",
    path: string,
    body = "{}",
  ): { request: RetryableJsonRequest; response: Promise<SessionDetail> } {
    const prior = retryableActiveRequests.get(action);
    const request = prior?.path === path && prior.body === body
      ? prior
      : {
          path,
          method: "POST" as const,
          body,
          idempotencyKey: app.api.idempotencyKey(),
        };
    retryableActiveRequests.set(action, request);
    return { request, response: sendRetryableRequest(request) };
  }

  function latestRetryableActiveRequest(): ["start" | "continue" | "restart", RetryableJsonRequest] | null {
    return Array.from(retryableActiveRequests.entries()).at(-1) ?? null;
  }

  function markOutcomeUnknown(
    request: RetryableJsonRequest | null,
    reason: PauseReason = "request-failure",
    atMs = clockNow(),
  ): number {
    if (request && (request.uncertainAtMs === undefined || atMs < request.uncertainAtMs)) {
      request.uncertainAtMs = atMs;
      request.uncertainReason = reason;
    }
    return request?.uncertainAtMs ?? atMs;
  }

  async function settlePotentiallyCommittedRequest(
    pending: Promise<SessionDetail> | null,
    recovery: (() => Promise<SessionDetail>) | null,
    onDefinitiveOutcome: () => void,
    preferRecovery = false,
  ): Promise<SessionDetail | null> {
    if (preferRecovery && recovery) {
      try {
        const detail = await recovery();
        onDefinitiveOutcome();
        return detail;
      } catch (error: unknown) {
        if (error instanceof WorkoutApiError) {
          onDefinitiveOutcome();
          return null;
        }
        throw error;
      }
    }
    if (pending) {
      try {
        const detail = await pending;
        onDefinitiveOutcome();
        return detail;
      } catch (error: unknown) {
        // An HTTP response is a definitive outcome. A transport failure is
        // not: the server may have committed before the response was lost.
        if (error instanceof WorkoutApiError) {
          onDefinitiveOutcome();
          return null;
        }
        if (!recovery) return null;
      }
    }
    if (!recovery) return null;
    try {
      const detail = await recovery();
      onDefinitiveOutcome();
      return detail;
    } catch (error: unknown) {
      if (error instanceof WorkoutApiError) {
        onDefinitiveOutcome();
        return null;
      }
      // Keep the stable request descriptor for a later navigation retry. An
      // ambiguous second transport failure must block ensurePaused instead of
      // claiming that no server interval exists.
      throw error;
    }
  }

  async function persistSessionPause(
    closeAt: string | null = null,
    forceNewRequest = false,
  ): Promise<SessionDetail | null> {
    const detail = state.detail;
    if (!detail || detail.status !== "in_progress") return null;
    if (!hasOpenTrainingInterval(detail)) return detail;
    if (pendingPauseRequest && !forceNewRequest) return pendingPauseRequest;
    const sessionKey = detail.session_key;
    const path = `/api/private/sessions/${sessionKey}/pause`;
    const body = JSON.stringify(closeAt ? { close_at: closeAt } : {});
    const descriptor = retryablePauseRequest?.path === path
      ? retryablePauseRequest
      : {
          path,
          method: "POST" as const,
          body,
          idempotencyKey: app.api.idempotencyKey(),
        };
    retryablePauseRequest = descriptor;
    const attemptGeneration = ++pauseRequestAttemptGeneration;
    const request = sendRetryableRequest(descriptor, true);
    pendingPauseRequest = request;
    try {
      const result = await request;
      if (retryablePauseRequest !== descriptor || attemptGeneration !== pauseRequestAttemptGeneration) {
        return state.detail;
      }
      retryablePauseRequest = null;
      if (state.detail?.session_key === sessionKey) syncDetail(result);
      return result;
    } catch (error: unknown) {
      if (retryablePauseRequest === descriptor
        && attemptGeneration === pauseRequestAttemptGeneration
        && state.detail?.session_key === sessionKey) {
        state.mutation = { action: "pause", pending: false, error: errorMessage(error) || "暂停同步失败，请重试" };
      }
      throw error;
    } finally {
      if (pendingPauseRequest === request) pendingPauseRequest = null;
    }
  }

  function pauseForInterruption(
    reason: PauseReason,
    boundaryOverride: number | null = null,
  ): Promise<SessionDetail | null> {
    const interruptedAt = boundaryOverride ?? clockNow();
    const urgentLifecycle = reason === "pagehide" || disposed;
    const detailAtInterruption = state.detail;
    invalidateAudioActivation();
    if (detailAtInterruption?.status === "in_progress" && !state.timerPaused) {
      pauseExecutionTimers();
      state.timerPaused = true;
      state.timerPauseStartedAt = interruptedAt;
    }
    state.timerPauseReason = reason;
    timeline.cancel();
    releaseWakeLock();
    stopSessionClock();

    if (interruptionPausePromise && (!urgentLifecycle || interruptionPauseUrgent)) {
      return interruptionPausePromise;
    }

    // Browsers normally dispatch visibilitychange(hidden) before pagehide.
    // The visibility task may be waiting on an ordinary request whose Promise
    // will never settle after the page is frozen. Pagehide must therefore
    // upgrade that task instead of joining it: the upgraded task immediately
    // replays stable commands with keepalive and force-sends the closing pause.
    // A generation guard prevents the abandoned visibility task from later
    // re-adopting an open response if the original Promise eventually settles.
    const interruptionGeneration = ++interruptionPauseGeneration;

    resumeGeneration += 1;
    const pendingResume = resumeRequestPromise;
    const retryableResume = retryableResumeRequest;
    if (retryableResume) markOutcomeUnknown(retryableResume, reason, interruptedAt);
    const resumeRecovery = urgentLifecycle && retryableResume
      ? () => sendRetryableRequest(retryableResume, true)
      : resumeRequestRecovery
        ?? (retryableResume ? () => sendRetryableRequest(retryableResume) : null);
    const pendingActive = pendingActiveMutation;
    const retryableActive = latestRetryableActiveRequest();
    if (retryableActive) markOutcomeUnknown(retryableActive[1], reason, interruptedAt);
    const activeRecovery = urgentLifecycle && retryableActive
      ? () => sendRetryableRequest(retryableActive[1], true)
      : pendingActiveRecovery
        ?? (retryableActive ? () => sendRetryableRequest(retryableActive[1]) : null);
    const pendingPause = pendingPauseRequest;
    state.pausePending = true;

    const task = (async (): Promise<SessionDetail | null> => {
      const [activeDetail, resumedDetail, pausedDetail] = await Promise.all([
        settlePotentiallyCommittedRequest(
          urgentLifecycle && !activeRecovery ? null : pendingActive,
          activeRecovery,
          () => {
          if (retryableActive && retryableActiveRequests.get(retryableActive[0]) === retryableActive[1]) {
            retryableActiveRequests.delete(retryableActive[0]);
          }
          },
          urgentLifecycle,
        ),
        settlePotentiallyCommittedRequest(pendingResume, resumeRecovery, () => {
          if (retryableResumeRequest === retryableResume) retryableResumeRequest = null;
        }, urgentLifecycle),
        urgentLifecycle ? Promise.resolve(null) : Promise.resolve(pendingPause).catch(() => null),
      ]);
      if (interruptionGeneration !== interruptionPauseGeneration) return state.detail;
      const authoritativeDetail = pausedDetail
        ?? activeDetail
        ?? resumedDetail
        ?? state.detail
        ?? detailAtInterruption;
      if (!authoritativeDetail) return null;
      if (authoritativeDetail !== state.detail) syncDetail(authoritativeDetail);
      if (authoritativeDetail.status !== "in_progress") return authoritativeDetail;

      if (!state.timerPaused) {
        pauseExecutionTimers();
        state.timerPaused = true;
        state.timerPauseStartedAt = interruptedAt;
      }
      if ((activeDetail || resumedDetail) && !disposed) state.mode = "execution";

      const returnedOpenInterval = Boolean(activeDetail || resumedDetail);
      const recoveredBoundary = Math.min(
        ...[
          activeDetail ? retryableActive?.[1].uncertainAtMs : undefined,
          resumedDetail ? retryableResume?.uncertainAtMs : undefined,
          interruptedAt,
        ].filter((value): value is number => value !== undefined),
      );
      const closeAt = returnedOpenInterval
        ? interruptionBoundary(authoritativeDetail, recoveredBoundary)
        : pauseBoundary(authoritativeDetail, state.timerPauseStartedAt ?? interruptedAt);
      const paused = await persistSessionPause(closeAt, urgentLifecycle);
      if (paused && state.mutation.action === "pause") clearMutation();
      return paused;
    })();

    interruptionPausePromise = task;
    interruptionPauseUrgent = urgentLifecycle;
    return task.finally(() => {
      if (interruptionPausePromise === task) {
        interruptionPausePromise = null;
        interruptionPauseUrgent = false;
        state.pausePending = false;
      }
    });
  }

  async function ensurePaused(reason: PauseReason = "navigation"): Promise<boolean> {
    state.navigationPauseError = null;
    try {
      if (bfcacheRecoveryRequired || bfcacheRecoveryPromise) {
        const recovered = await reconcileAfterBfcacheRestore();
        if (!recovered) throw new Error(state.mutation.error || "无法确认训练已暂停，请重试");
      }
      if (
      pendingActiveMutation
      || resumeRequestPromise
      || pendingPauseRequest
      || interruptionPausePromise
      || retryableActiveRequests.size > 0
      || retryableResumeRequest
      ) {
        await pauseForInterruption(reason);
        if (state.detail?.status === "in_progress") return !hasOpenTrainingInterval(state.detail);
      }
      const currentSummary = summary.value;
      if (
        currentSummary?.status === "in_progress"
        && (
          !state.detail
          || state.detail.session_key !== currentSummary.session_key
          || state.detail.status !== "in_progress"
        )
      ) {
        if (!currentSummary.session_key) throw new Error("进行中的训练缺少 Session 标识，无法安全离开");
        const loaded = await loadDetail(true);
        if (!loaded) throw new Error("训练详情暂时无法读取，无法确认暂停状态");
      }
      if (!state.detail || state.detail.status !== "in_progress") return true;
      await pauseForInterruption(reason);
      return !hasOpenTrainingInterval(state.detail);
    } catch (error: unknown) {
      if (!app.state.authRequired && !(error instanceof WorkoutApiError && error.status === 401)) {
        state.navigationPauseError = errorMessage(error) || "无法确认训练已暂停，请重试";
      }
      throw error;
    }
  }

  function handleVisibilityChange(): void {
    if (!documentIsVisible()) {
      if (
        pendingActiveMutation
        || resumeRequestPromise
        || retryableActiveRequests.size > 0
        || retryableResumeRequest
        || (state.detail?.status === "in_progress" && hasOpenTrainingInterval(state.detail))
      ) {
        state.wakeLockStatus = "hidden";
        releaseWakeLock();
        void pauseForInterruption("visibility").catch(() => {});
      }
      return;
    }
    if (!executionFocused.value || state.detail?.status !== "in_progress") return;
    if (state.timerPaused) {
      if (state.timerPauseReason === "visibility") state.wakeLockStatus = "idle";
      return;
    }
    if (wakeLockSupported()) {
      state.wakeLockStatus = "idle";
      void requestWakeLock({ force: true });
    } else {
      state.wakeLockStatus = "unsupported";
    }
  }

  function handlePageHide(): void {
    const hiddenBoundary = state.timerPauseReason === "visibility" && state.timerPauseStartedAt !== null
      ? state.timerPauseStartedAt
      : clockNow();
    pagehideBoundaryMs = pagehideBoundaryMs === null
      ? hiddenBoundary
      : Math.min(pagehideBoundaryMs, hiddenBoundary);
    bfcacheRecoveryRequired = true;
    timeline.cancel();
    releaseWakeLock();
    stopSessionClock();
    void pauseForInterruption("pagehide").catch(() => {});
  }

  function reconcileAfterBfcacheRestore(): Promise<boolean> {
    if (bfcacheRecoveryPromise) return bfcacheRecoveryPromise;
    bfcacheRecoveryRequired = true;
    state.pausePending = true;
    pauseExecutionTimers();
    state.timerPaused = true;
    state.timerPauseReason = "pagehide";
    state.timerPauseStartedAt = pagehideBoundaryMs ?? clockNow();
    timeline.cancel();
    releaseWakeLock();
    stopSessionClock();

    // A page restored from BFCache must not join the Promise that belonged to
    // the frozen pagehide turn. Invalidate its local ownership while keeping
    // the stable pause descriptor available for an idempotent replay.
    interruptionPauseGeneration += 1;
    interruptionPausePromise = null;
    interruptionPauseUrgent = false;
    pendingPauseRequest = null;
    const detailGeneration = ++detailLoadGeneration;

    let task!: Promise<boolean>;
    task = (async (): Promise<boolean> => {
      try {
        const sessionKey = summary.value?.session_key ?? state.detail?.session_key;
        if (!sessionKey) {
          bfcacheRecoveryRequired = false;
          pagehideBoundaryMs = null;
          retryablePauseRequest = null;
          pauseRequestAttemptGeneration += 1;
          return true;
        }
        const authoritative = await app.api.request<SessionDetail>(`/api/private/sessions/${sessionKey}`);
        if (disposed || detailGeneration !== detailLoadGeneration) return false;
        syncDetail(authoritative);
        if (authoritative.status !== "in_progress" || !hasOpenTrainingInterval(authoritative)) {
          retryablePauseRequest = null;
          pauseRequestAttemptGeneration += 1;
          bfcacheRecoveryRequired = false;
          pagehideBoundaryMs = null;
          if (state.mutation.action === "pause") clearMutation();
          return true;
        }
        const boundary = pagehideBoundaryMs ?? clockNow();
        state.timerPaused = true;
        state.timerPauseReason = "pagehide";
        state.timerPauseStartedAt = boundary;
        const closeAt = interruptionBoundary(authoritative, boundary);
        const paused = await persistSessionPause(closeAt, true);
        if (!paused || hasOpenTrainingInterval(paused)) {
          throw new Error("无法确认训练已暂停，请重试");
        }
        bfcacheRecoveryRequired = false;
        pagehideBoundaryMs = null;
        if (state.mutation.action === "pause") clearMutation();
        return true;
      } catch (error: unknown) {
        bfcacheRecoveryRequired = true;
        state.mutation = {
          action: "pause",
          pending: false,
          error: errorMessage(error) || "无法确认训练已暂停，请重试",
        };
        return false;
      } finally {
        if (bfcacheRecoveryPromise === task) {
          bfcacheRecoveryPromise = null;
          state.pausePending = false;
        }
      }
    })();
    bfcacheRecoveryPromise = task;
    return task;
  }

  function handlePageShow(event: Event): void {
    if ((event as PageTransitionEvent).persisted !== true) return;
    void reconcileAfterBfcacheRestore();
  }

  async function loadDetail(explicit: boolean): Promise<SessionDetail | null> {
    const sessionKey = summary.value?.session_key;
    if (!sessionKey) {
      state.detail = null;
      return null;
    }
    if (!explicit && state.detail?.session_key === sessionKey) return state.detail;
    const generation = ++detailLoadGeneration;
    state.detailLoading = true;
    try {
      const detail = await app.api.request<SessionDetail>(`/api/private/sessions/${sessionKey}`);
      if (generation !== detailLoadGeneration || disposed) return null;
      syncDetail(detail);
      if (detail.status === "in_progress" && hasOpenTrainingInterval(detail) && !isExecutionSurface()) {
        const recoveredBoundary = recoveredOpenBoundaryMs(detail);
        // An open interval recovered outside the execution surface is stale
        // browser ownership (for example after a crash). Never auto-resume it
        // or count the offline gap; close at the last authoritative activity.
        state.timerPaused = true;
        state.timerPauseReason = "navigation";
        state.timerPauseStartedAt = recoveredBoundary;
        await pauseForInterruption("navigation");
      }
      return state.detail ?? detail;
    } catch (error: unknown) {
      if (!explicit && !app.state.authRequired) {
        state.navigationPauseError = errorMessage(error) || "无法确认训练已暂停，请重试";
      }
      if (explicit) throw error;
      return null;
    } finally {
      if (generation === detailLoadGeneration) state.detailLoading = false;
    }
  }

  function pruneSavedDrafts(detail: SessionDetail): void {
    const savedKeys = new Set<string>(detail.completion_results.map((result) => result.completion_item_key));
    state.actualDrafts = Object.fromEntries(Object.entries(state.actualDrafts).filter(([key]) => !savedKeys.has(key)));
    state.resistanceDrafts = Object.fromEntries(Object.entries(state.resistanceDrafts).filter(([key]) => !savedKeys.has(key)));
    state.rirDrafts = Object.fromEntries(Object.entries(state.rirDrafts).filter(([key]) => !savedKeys.has(key)));
    const bucket = executionDraftBucket(detail.session_key);
    for (const key of savedKeys) {
      delete bucket?.actual[key];
      delete bucket?.resistance[key];
      delete bucket?.rir[key];
    }
  }

  function clearSubmittedExecutionDrafts(
    sessionKey: string,
    itemKeys: Iterable<string>,
    feedbackKeys: Iterable<string>,
  ): void {
    const bucket = executionDraftBucket(sessionKey);
    for (const key of itemKeys) {
      delete state.actualDrafts[key];
      delete state.resistanceDrafts[key];
      delete state.rirDrafts[key];
      delete bucket?.actual[key];
      delete bucket?.resistance[key];
      delete bucket?.rir[key];
    }
    for (const key of feedbackKeys) {
      delete bucket?.feedback[key];
    }
  }

  function beginEndSheet(): void {
    const detail = state.detail;
    state.endSheet = true;
    if (!state.endReconciliationRequired) state.endError = null;
    state.endRpe = Number.isInteger(detail?.session_rpe) ? Number(detail?.session_rpe) : 8;
    state.endNote = detail?.note ?? "";
    state.endFeedback = {
      ...Object.fromEntries((detail?.exercise_feedback ?? []).map(
        (feedback) => [feedback.exercise_occurrence_key, feedback.text],
      )),
      ...state.feedbackDraft,
    };
  }

  function pauseForEnd(): Promise<SessionDetail | null> {
    if (endPausePromise) return endPausePromise;
    state.endPausePending = true;
    const task = pauseForInterruption("end-form");
    endPausePromise = task;
    return task.finally(() => {
      if (endPausePromise === task) {
        endPausePromise = null;
        state.endPausePending = false;
      }
    });
  }

  function showSession(detail: SessionDetail, requestedIndex: number | null = null, options: ShowSessionOptions = {}): void {
    clearMutation();
    state.navigationPauseError = null;
    resetTimedAction();
    syncDetail(detail);
    state.mode = detail.status === "in_progress" ? "execution" : "overview";
    const pausedOnEntry = detail.status === "in_progress"
      && options.active !== true
      && (options.forcePaused === true || !hasOpenTrainingInterval(detail));
    state.timerPaused = pausedOnEntry;
    state.timerPauseReason = pausedOnEntry ? options.pauseReason ?? "navigation" : null;
    state.timerPauseStartedAt = pausedOnEntry ? options.pausedAt ?? clockNow() : null;
    pruneSavedDrafts(detail);
    const displayItems = displayCompletionItems(detail);
    const firstIncomplete = displayItems.findIndex((item) => !displayItemDone(detail, item));
    state.focusIndex = requestedIndex === null
      ? (firstIncomplete >= 0 ? firstIncomplete : 0)
      : Math.max(0, Math.min(requestedIndex, Math.max(0, displayItems.length - 1)));
    state.progressOpen = false;
    state.adjust = false;
    bindExecutionDrafts(detail);
    const restSeconds = Number(options.restSeconds) || 0;
    const scheduledRest = restSeconds > 0
      ? timeline.scheduleRest({ remainingMs: restSeconds * 1000, audible: !state.muted && state.audio.status === "ready" })
      : null;
    state.restUntil = scheduledRest?.endsAtMs ?? null;
    state.restRemainingMs = restSeconds > 0 ? restSeconds * 1000 : null;
    state.restNextIndex = restSeconds > 0 ? options.nextIndex ?? null : null;
    if (scheduledRest && !state.muted && state.audio.status === "ready") void observeAudioResult(scheduledRest.result);
    state.endSheet = Boolean(options.openEnd);
    if (state.endSheet) beginEndSheet();
    if (options.active === true
      && hasOpenTrainingInterval(detail)
      && state.wakeLockStatus === "released") {
      state.wakeLockStatus = "idle";
    }
    state.nowMs = countdownNow();
    syncSessionClock();
    syncWakeLock();
  }

  async function openSession(): Promise<void> {
    const sessionKey = summary.value?.session_key;
    if (!sessionKey) return app.refresh();
    let detail = await app.api.request<SessionDetail>(`/api/private/sessions/${sessionKey}`);
    if (detail.status === "in_progress" && hasOpenTrainingInterval(detail)) {
      try {
        const recoveredBoundary = recoveredOpenBoundaryMs(detail);
        syncDetail(detail);
        state.timerPaused = true;
        state.timerPauseReason = "navigation";
        state.timerPauseStartedAt = recoveredBoundary;
        const closeAt = pauseBoundary(detail, recoveredBoundary);
        const paused = await persistSessionPause(closeAt);
        if (!paused) throw new Error("无法确认训练已暂停，请重试");
        detail = paused;
      } catch (error: unknown) {
        showSession(detail, null, {
          forcePaused: true,
          pauseReason: "navigation",
          pausedAt: recoveredOpenBoundaryMs(detail),
        });
        state.mutation = {
          action: "pause",
          pending: false,
          error: errorMessage(error) || "暂停同步失败，请重试",
        };
        return;
      }
    }
    showSession(detail, null, { active: false });
  }

  async function startSession(): Promise<void> {
    if (!app.state.today) return app.refresh();
    if (!beginMutation("start")) return;
    const mutationGeneration = resumeGeneration;
    let request: Promise<SessionDetail> | null = null;
    let recovery: (() => Promise<SessionDetail>) | null = null;
    let requestDescriptor: RetryableJsonRequest | null = null;
    try {
      const active = activeRequest(
        "start",
        `/api/private/scheduled-workouts/${app.state.today.date}/start`,
      );
      requestDescriptor = active.request;
      request = active.response;
      recovery = () => sendRetryableRequest(active.request);
      pendingActiveMutation = request;
      pendingActiveRecovery = recovery;
      const detail = await request;
      const reconciliationBoundary = requestDescriptor.uncertainAtMs ?? null;
      if (reconciliationBoundary !== null
        || mutationGeneration !== resumeGeneration
        || disposed
        || !documentIsVisible()) {
        if (state.mutation.action === "start") clearMutation();
        await pauseForInterruption(
          reconciliationBoundary === null
            ? currentInterruptionReason()
            : requestDescriptor.uncertainReason ?? "request-failure",
          reconciliationBoundary,
        );
        return;
      }
      retryableActiveRequests.delete("start");
      showSession(detail, null, { active: true });
    } catch (error: unknown) {
      if (state.mutation.action === "pause" && state.mutation.error) return;
      if (!(error instanceof WorkoutApiError)) {
        const reconciliationBoundary = markOutcomeUnknown(requestDescriptor);
        try {
          const reconciled = await pauseForInterruption(
            requestDescriptor?.uncertainReason ?? "request-failure",
            reconciliationBoundary,
          );
          if (reconciled?.status === "in_progress" && !hasOpenTrainingInterval(reconciled)) {
            if (state.mutation.action === "start") clearMutation();
          } else {
            failMutation("start", error);
          }
        } catch (recoveryError: unknown) {
          if (state.mutation.action !== "pause") failMutation("start", recoveryError);
        }
        return;
      }
      if (error instanceof WorkoutApiError) retryableActiveRequests.delete("start");
      failMutation("start", error);
    } finally {
      if (pendingActiveMutation === request) pendingActiveMutation = null;
      if (pendingActiveRecovery === recovery) pendingActiveRecovery = null;
    }
  }

  async function skipToday(): Promise<void> {
    if (!app.state.today) return app.refresh();
    const skipped = await app.api.request<SessionDetail>(`/api/private/scheduled-workouts/${app.state.today.date}/skip`, {
      method: "POST",
      headers: { "Idempotency-Key": app.api.idempotencyKey() },
      body: JSON.stringify({ skip_reason: null }),
    });
    syncDetail(skipped);
    state.mode = "overview";
  }

  async function resumeTerminalSession(command: "continue" | "restart"): Promise<void> {
    const current = summary.value;
    if (!current) return app.refresh();
    if (!beginMutation(command)) return;
    const mutationGeneration = resumeGeneration;
    let request: Promise<SessionDetail> | null = null;
    let recovery: (() => Promise<SessionDetail>) | null = null;
    let requestDescriptor: RetryableJsonRequest | null = null;
    try {
      const active = activeRequest(
        command,
        `/api/private/sessions/${String(current.session_key)}/${command}`,
      );
      requestDescriptor = active.request;
      request = active.response;
      recovery = () => sendRetryableRequest(active.request);
      pendingActiveMutation = request;
      pendingActiveRecovery = recovery;
      const detail = await request;
      const reconciliationBoundary = requestDescriptor.uncertainAtMs ?? null;
      if (reconciliationBoundary !== null
        || mutationGeneration !== resumeGeneration
        || disposed
        || !documentIsVisible()) {
        if (state.mutation.action === command) clearMutation();
        await pauseForInterruption(
          reconciliationBoundary === null
            ? currentInterruptionReason()
            : requestDescriptor.uncertainReason ?? "request-failure",
          reconciliationBoundary,
        );
        return;
      }
      completionAttempt = null;
      retryableActiveRequests.delete(command);
      showSession(detail, null, { active: true });
    } catch (error: unknown) {
      if (state.mutation.action === "pause" && state.mutation.error) return;
      if (!(error instanceof WorkoutApiError)) {
        const reconciliationBoundary = markOutcomeUnknown(requestDescriptor);
        try {
          const reconciled = await pauseForInterruption(
            requestDescriptor?.uncertainReason ?? "request-failure",
            reconciliationBoundary,
          );
          if (reconciled?.status === "in_progress" && !hasOpenTrainingInterval(reconciled)) {
            completionAttempt = null;
            if (state.mutation.action === command) clearMutation();
          } else {
            failMutation(command, error);
          }
        } catch (recoveryError: unknown) {
          if (state.mutation.action !== "pause") failMutation(command, recoveryError);
        }
        return;
      }
      if (error instanceof WorkoutApiError) retryableActiveRequests.delete(command);
      failMutation(command, error);
    } finally {
      if (pendingActiveMutation === request) pendingActiveMutation = null;
      if (pendingActiveRecovery === recovery) pendingActiveRecovery = null;
    }
  }

  function startTimedAction(): void {
    const detail = state.detail;
    const item = focusedItem.value;
    const targetSec = canonicalDurationSeconds(item?.target);
    if (!detail || !item || targetSec === null || state.timerPaused || state.timedAction.phase !== "idle") return;
    const activationGeneration = ++audioActivationGeneration;
    const itemKey = item.completion_item_key;
    const deadlineMs = countdownNow() + preparationDurationSec * 1000;
    state.timedAction = {
      itemKey,
      phase: "preparing",
      targetSec,
      deadlineMs,
      remainingMs: preparationDurationSec * 1000,
      remainingSec: preparationDurationSec,
    };
    state.audio = state.muted ? state.audio : { status: "starting", error: null };
    syncSessionClock();
    const activation = state.muted ? Promise.resolve({ ok: true }) : timeline.activateAudio();
    void Promise.resolve(activation).then((result) => {
      if (activationGeneration !== audioActivationGeneration
        || state.timedAction.itemKey !== itemKey
        || state.timerPaused
        || !isExecutionSurface()
        || !documentIsVisible()) return;
      const failure = audioFailureFor(result);
      if (!state.muted) state.audio = failure ? { status: "error", error: failure } : { status: "ready", error: null };
      const now = countdownNow();
      updateTimedAction(now);
      const timer = state.timedAction;
      if (timer.phase !== "preparing" && timer.phase !== "active") return;
      const scheduled = timeline.scheduleAction({
        phase: timer.phase,
        remainingMs: Math.max(0, Number(timer.deadlineMs) - now),
        targetSec,
        audible: !state.muted && !failure,
        alignPhaseEndAtMs: timer.deadlineMs,
      });
      if (!state.muted && !failure) void observeAudioResult(scheduled.result);
    }).catch((error: unknown) => {
      if (activationGeneration !== audioActivationGeneration) return;
      state.audio = { status: "error", error: errorMessage(error) || "音频播放失败" };
    });
  }

  async function rescheduleCurrentAudio(): Promise<AudioResultLike> {
    const now = countdownNow();
    const timer = state.timedAction;
    if ((timer.phase === "preparing" || timer.phase === "active") && timer.deadlineMs !== null) {
      const scheduled = timeline.scheduleAction({
        phase: timer.phase,
        remainingMs: Math.max(0, timer.deadlineMs - now),
        targetSec: Number(timer.targetSec),
        alignPhaseEndAtMs: timer.deadlineMs,
      });
      return Promise.resolve(observeAudioResult(scheduled.result));
    }
    if (state.restUntil !== null) {
      const scheduled = timeline.scheduleRest({
        remainingMs: Math.max(0, state.restUntil - now),
        alignEndAtMs: state.restUntil,
      });
      return Promise.resolve(observeAudioResult(scheduled.result));
    }
    timeline.cancel();
    return { ok: true };
  }

  async function toggleAudioMuted(): Promise<void> {
    if (!state.muted) {
      invalidateAudioActivation();
      state.muted = true;
      timeline.cancel();
      return;
    }
    const generation = ++audioActivationGeneration;
    state.muted = false;
    state.audio = { status: "starting", error: null };
    const result = await timeline.activateAudio();
    if (generation !== audioActivationGeneration || state.muted) return;
    const failure = audioFailureFor(result);
    if (failure) {
      state.audio = { status: "error", error: failure };
      return;
    }
    state.audio = { status: "ready", error: null };
    await rescheduleCurrentAudio();
  }

  async function toggleTimer(): Promise<void> {
    if (bfcacheRecoveryRequired || bfcacheRecoveryPromise) {
      await reconcileAfterBfcacheRestore();
      return;
    }
    const detail = state.detail;
    if (!detail || detail.status !== "in_progress" || state.mutation.pending || state.pausePending) return;
    const retryPause = state.timerPaused && state.mutation.action === "pause" && state.mutation.error;
    const command: "pause" | "resume" = retryPause ? "pause" : state.timerPaused ? "resume" : "pause";
    if (!beginMutation(command)) return;
    const now = clockNow();
    const currentResumeGeneration = command === "resume" ? ++resumeGeneration : resumeGeneration;
    const currentAudioGeneration = command === "resume" ? ++audioActivationGeneration : audioActivationGeneration;
    const resumeAudio = command === "resume" && !state.muted ? timeline.activateAudio() : Promise.resolve(null);
    if (command === "pause") {
      if (!state.timerPaused) {
        pauseExecutionTimers();
        state.timerPaused = true;
        state.timerPauseStartedAt = now;
      }
      state.timerPauseReason = "manual";
      releaseWakeLock();
      stopSessionClock();
    }
    let requestPromise: Promise<SessionDetail> | null = null;
    let requestRecovery: (() => Promise<SessionDetail>) | null = null;
    let resumeRequest: RetryableJsonRequest | null = null;
    try {
      const closeAt = command === "pause"
        ? pauseBoundary(detail, state.timerPauseStartedAt ?? now)
        : null;
      if (command === "resume") {
        const path = `/api/private/sessions/${detail.session_key}/resume`;
        const stableRequest: RetryableJsonRequest = retryableResumeRequest?.path === path
          ? retryableResumeRequest
          : {
              path,
              method: "POST",
              body: "{}",
              idempotencyKey: app.api.idempotencyKey(),
            };
        resumeRequest = stableRequest;
        retryableResumeRequest = stableRequest;
        requestPromise = sendRetryableRequest(stableRequest);
        requestRecovery = () => sendRetryableRequest(stableRequest);
        resumeRequestPromise = requestPromise;
        resumeRequestRecovery = requestRecovery;
      } else {
        requestPromise = persistSessionPause(closeAt).then((paused) => {
          if (!paused) throw new Error("无法确认训练已暂停，请重试");
          return paused;
        });
      }
      const result = await requestPromise;
      const reconciliationBoundary = command === "resume"
        ? resumeRequest?.uncertainAtMs ?? null
        : null;
      if (command === "resume" && (
        reconciliationBoundary !== null
        || currentResumeGeneration !== resumeGeneration
        || !documentIsVisible()
        || !isExecutionSurface()
      )) {
        if (state.mutation.action === command) clearMutation();
        await pauseForInterruption(
          reconciliationBoundary === null
            ? currentInterruptionReason()
            : resumeRequest?.uncertainReason ?? "request-failure",
          reconciliationBoundary,
        );
        return;
      }
      if (command === "resume" && retryableResumeRequest === resumeRequest) retryableResumeRequest = null;
      // Once the HTTP response has settled, the authoritative open interval is
      // either in `result` or already captured by an interruption task. Do not
      // leave this pointer alive while browser audio activation is pending:
      // a later pagehide must not re-adopt the stale open response.
      if (command === "resume" && resumeRequestPromise === requestPromise) resumeRequestPromise = null;
      if (command === "resume" && resumeRequestRecovery === requestRecovery) resumeRequestRecovery = null;
      syncDetail(result);
      if (command === "resume") {
        if (!state.muted) state.audio = { status: "starting", error: null };
        state.timerPaused = false;
        state.timerPauseReason = null;
        state.timerPauseStartedAt = null;
        state.wakeLockStatus = "idle";
        resumeExecutionTimers();
        syncSessionClock();
        syncWakeLock();
        clearMutation();
        void Promise.resolve(resumeAudio).then(async (audioResult) => {
          if (!audioResult
            || currentAudioGeneration !== audioActivationGeneration
            || state.muted
            || !isVisibleSession()) return;
          const failure = audioFailureFor(audioResult);
          state.audio = failure ? { status: "error", error: failure } : { status: "ready", error: null };
          if (!failure) await rescheduleCurrentAudio();
        });
      } else {
        state.timerPaused = true;
        state.timerPauseReason = "manual";
        clearMutation();
      }
    } catch (error: unknown) {
      if (state.mutation.action === "pause" && state.mutation.error) return;
      if (command === "resume" && !(error instanceof WorkoutApiError)) {
        const reconciliationBoundary = markOutcomeUnknown(resumeRequest);
        try {
          const reconciled = await pauseForInterruption(
            resumeRequest?.uncertainReason ?? "request-failure",
            reconciliationBoundary,
          );
          const recoveredResume = reconciled?.status === "in_progress"
            && !hasOpenTrainingInterval(reconciled)
            && reconciled.training_intervals.length > detail.training_intervals.length;
          if (recoveredResume) {
            if (state.mutation.action === "resume") clearMutation();
          } else {
            failMutation("resume", error);
          }
        } catch (recoveryError: unknown) {
          if (state.mutation.action !== "pause") failMutation("resume", recoveryError);
        }
        return;
      }
      if (command === "resume" && error instanceof WorkoutApiError && retryableResumeRequest === resumeRequest) {
        retryableResumeRequest = null;
      }
      failMutation(command, error);
    } finally {
      if (command === "resume" && resumeRequestPromise === requestPromise) resumeRequestPromise = null;
      if (command === "resume" && resumeRequestRecovery === requestRecovery) resumeRequestRecovery = null;
      if (command === "pause" && pendingPauseRequest === requestPromise) pendingPauseRequest = null;
    }
    if (command === "pause") stopSessionClock();
    else if (state.timerPaused) pauseExecutionTimers();
  }

  function exerciseFeedbackPayload(): ExerciseFeedback[] {
    return Object.entries(state.feedbackDraft)
      .map(([exercise_occurrence_key, text]) => ({ exercise_occurrence_key, text: text.trim() }))
      .filter((item) => item.text);
  }

  async function completeCurrent(): Promise<void> {
    const detail = state.detail;
    const item = focusedItem.value;
    if (!detail || !item || completeBlocked.value) return;
    const timed = canonicalDurationSeconds(item.target);
    if (timed !== null && (state.timedAction.itemKey !== item.completion_item_key || state.timedAction.phase !== "complete")) return;
    const currentIndex = state.focusIndex;
    const restSeconds = Number(itemContext(detail, item).set?.rest_after_sec) || 0;
    const keys = new Set<string>(completionKeys(item));
    const existing = detail.completion_results.filter((result) => !keys.has(result.completion_item_key));
    const actualDraft = state.actualDrafts[item.completion_item_key];
    const rawValue = actualDraft?.trim()
      ? actualDraft
      : String(canonicalDurationSeconds(item.target) ?? item.target.value ?? item.target.min ?? 1);
    const rawWeight = state.resistanceDrafts[item.completion_item_key];
    const rawRir = state.rirDrafts[item.completion_item_key] ?? "";
    writeExecutionDraft("actual", item.completion_item_key, rawValue);
    if (rawWeight !== undefined) writeExecutionDraft("resistance", item.completion_item_key, rawWeight);
    writeExecutionDraft("rir", item.completion_item_key, rawRir);
    const inputFingerprint = JSON.stringify({ rawValue, rawWeight: rawWeight ?? null, rawRir });
    const completedAt = completionAttempt?.sessionKey === detail.session_key
      && completionAttempt.itemKey === item.completion_item_key
      && completionAttempt.inputFingerprint === inputFingerprint
      ? completionAttempt.completedAt
      : isoNow();
    completionAttempt = {
      sessionKey: detail.session_key,
      itemKey: item.completion_item_key,
      inputFingerprint,
      completedAt,
    };
    const resistance = resultResistanceInput(item, rawWeight);
    const resultValues = completionKeys(item).map((completionItemKey) => ({
      completion_item_key: completionItemKey,
      status: "completed",
      actual: { metric: item.target.metric, value: Number(rawValue) },
      resistance,
      rir: numberOrNull(rawRir),
      note: null,
      completed_at: completedAt,
    }));
    const legacyResult = {
      completion_item_key: item.completion_item_key,
      completed: true,
      actual: { metric: item.target.metric, value: Number(rawValue) },
      resistance,
      rir: numberOrNull(rawRir),
      completed_at: completedAt,
    };
    if (!beginMutation("complete")) return;
    const mutationGeneration = resumeGeneration;
    let recordRequest: Promise<SessionDetail> | null = null;
    try {
      const audioActivation = restSeconds > 0 && !state.muted
        ? timeline.activateAudio()
        : Promise.resolve(null);
      const body = detail.snapshot.schema_version === 2
        ? {
            record_schema_version: 2,
            set_results: [...existing.map((saved) => canonicalStoredResultInput(saved, detail)), ...resultValues],
            training_intervals: detail.training_intervals,
            session_rpe: null,
            note: detail.note,
            exercise_feedback: exerciseFeedbackPayload(),
            skip_reason: null,
          }
        : {
            record_schema_version: 1,
            completion_results: [...existing, legacyResult],
            training_intervals: detail.training_intervals,
            session_rpe: null,
            note: detail.note,
            exercise_feedback: exerciseFeedbackPayload(),
            skip_reason: null,
          };
      recordRequest = app.api.request<SessionDetail>(`/api/private/sessions/${detail.session_key}/record`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      pendingActiveMutation = recordRequest;
      void recordRequest.then(
        () => {
          if (pendingActiveMutation === recordRequest) pendingActiveMutation = null;
        },
        () => {
          if (pendingActiveMutation === recordRequest) pendingActiveMutation = null;
        },
      );
      const updated = await recordRequest;
      clearSubmittedExecutionDrafts(detail.session_key, keys, Object.keys(state.feedbackDraft));
      completionAttempt = null;
      if (mutationGeneration !== resumeGeneration || disposed || !documentIsVisible()) {
        if (!state.detail || hasOpenTrainingInterval(state.detail)) syncDetail(updated);
        if (state.mutation.action === "complete") clearMutation();
        await pauseForInterruption(currentInterruptionReason());
        return;
      }
      const updatedItems = displayCompletionItems(updated);
      const nextIndex = updatedItems.findIndex((candidate, index) => index > currentIndex && !displayItemDone(updated, candidate));
      const fallbackIndex = nextIndex >= 0 ? nextIndex : updatedItems.findIndex((candidate) => !displayItemDone(updated, candidate));
      if (fallbackIndex >= 0 && restSeconds > 0 && !state.muted) {
        state.audio = { status: "starting", error: null };
      }
      showSession(updated, fallbackIndex >= 0 ? fallbackIndex : 0, {
        restSeconds: fallbackIndex >= 0 ? restSeconds : 0,
        nextIndex: fallbackIndex >= 0 ? fallbackIndex : null,
        openEnd: fallbackIndex < 0,
        active: true,
      });
      if (fallbackIndex < 0) {
        try {
          await pauseForEnd();
        } catch (error: unknown) {
          if (app.state.authRequired || (error instanceof WorkoutApiError && error.status === 401)) throw error;
          state.endError = errorMessage(error) || "暂停同步失败，请重试";
        }
      } else {
        const completionAudioGeneration = ++audioActivationGeneration;
        void Promise.resolve(audioActivation).then(async (audioResult) => {
          if (!audioResult
            || completionAudioGeneration !== audioActivationGeneration
            || state.muted
            || !isVisibleSession()
            || !restActive.value) return;
          const failure = audioFailureFor(audioResult);
          state.audio = failure ? { status: "error", error: failure } : { status: "ready", error: null };
          if (!failure) await rescheduleCurrentAudio();
        });
      }
    } catch (error: unknown) {
      if (state.mutation.action === "pause" && state.mutation.error) return;
      if (!(error instanceof WorkoutApiError)) {
        try {
          const reconciled = await pauseForInterruption("request-failure");
          const committed = Boolean(reconciled)
            && completionKeys(item).every((key) => reconciled?.completion_results.some(
              (result) => result.completion_item_key === key,
            ));
          if (reconciled && committed) {
            completionAttempt = null;
            const reconciledItems = displayCompletionItems(reconciled);
            const nextIndex = reconciledItems.findIndex(
              (candidate, index) => index > currentIndex && !displayItemDone(reconciled, candidate),
            );
            const fallbackIndex = nextIndex >= 0
              ? nextIndex
              : reconciledItems.findIndex((candidate) => !displayItemDone(reconciled, candidate));
            showSession(reconciled, fallbackIndex >= 0 ? fallbackIndex : 0, {
              openEnd: fallbackIndex < 0,
              forcePaused: true,
              pauseReason: "request-failure",
            });
          } else {
            failMutation("complete", error);
          }
        } catch {
          // persistSessionPause already exposes its retryable local error.
        }
        return;
      }
      completionAttempt = null;
      failMutation("complete", error);
    } finally {
      if (pendingActiveMutation === recordRequest) pendingActiveMutation = null;
    }
  }

  async function minimize(): Promise<void> {
    try {
      await ensurePaused("navigation");
    } catch (error: unknown) {
      if (app.state.authRequired || (error instanceof WorkoutApiError && error.status === 401)) throw error;
      // persistSessionPause already leaves a retryable local pause error. Keep
      // the execution surface mounted so drafts and browser ownership remain
      // visible instead of escalating into App's global error boundary.
      return;
    }
    stopSessionClock();
    resetTimedAction();
    state.mode = "overview";
    state.progressOpen = false;
    state.adjust = false;
    clearRestCountdown();
    state.endSheet = false;
    state.timerPaused = false;
    state.timerPauseReason = null;
    state.timerPauseStartedAt = null;
    await app.refresh();
    await loadDetail(false);
  }

  async function finishEndedSession(ended: SessionDetail): Promise<void> {
    retryableEndRequest = null;
    state.endReconciliationRequired = false;
    completionAttempt = null;
    syncDetail(ended);
    stopSessionClock();
    releaseWakeLock();
    resetTimedAction();
    clearRestCountdown();
    state.endSheet = false;
    state.timerPauseReason = null;
    state.mode = "overview";
    await app.refresh();
    if (app.state.error) {
      state.navigationPauseError = app.state.error;
      app.clearError();
      return;
    }
    try {
      await loadDetail(true);
    } catch (error: unknown) {
      // End is already authoritative and terminal. A readback failure must not
      // reopen or lock the End transaction; keep the returned detail visible.
      state.navigationPauseError = errorMessage(error) || "训练已结束，但最新详情暂时无法重新读取";
    }
  }

  async function endCurrent(): Promise<void> {
    if (!state.detail || state.endSaving) return;
    state.endSaving = true;
    state.endError = null;
    try {
      await pauseForEnd();
      const detail = state.detail;
      if (!detail) throw new Error("训练详情暂时无法读取，无法结束训练");
      if (hasOpenTrainingInterval(detail)) throw new Error("训练尚未完成暂停同步，请重试");
      const feedback = Object.entries(state.endFeedback)
        .map(([exercise_occurrence_key, text]) => ({ exercise_occurrence_key, text: text.trim() }))
        .filter((item) => item.text);
      const record = detail.snapshot.schema_version === 2
        ? {
            record_schema_version: 2,
            set_results: detail.completion_results.map((result) => canonicalStoredResultInput(result, detail)),
            training_intervals: detail.training_intervals,
            session_rpe: Number.isInteger(state.endRpe) ? state.endRpe : null,
            note: state.endNote.trim() || null,
            exercise_feedback: feedback,
            skip_reason: null,
          }
        : {
            record_schema_version: 1,
            completion_results: detail.completion_results,
            training_intervals: detail.training_intervals,
            session_rpe: Number.isInteger(state.endRpe) ? state.endRpe : null,
            note: state.endNote.trim() || null,
            exercise_feedback: feedback,
            skip_reason: null,
          };
      const path = `/api/private/sessions/${detail.session_key}/end`;
      const request: RetryableJsonRequest = retryableEndRequest?.path === path
        ? retryableEndRequest
        : {
            path,
            method: "POST",
            idempotencyKey: app.api.idempotencyKey(),
            // Keep both the authoritative closed intervals and ended_at fixed
            // across transport retries. A new body/key cannot recover an End
            // that the server committed before its response was lost.
            body: JSON.stringify({ record, ended_at: isoNow() }),
          };
      retryableEndRequest = request;
      let ended: SessionDetail;
      try {
        try {
          ended = await sendRetryableRequest(request);
        } catch (error: unknown) {
          if (error instanceof WorkoutApiError) throw error;
          state.endReconciliationRequired = true;
          // A transport error leaves the End outcome unknown. Replay the
          // exact frozen body/key once immediately; if transport is still
          // unavailable the sheet becomes a locked reconciliation surface.
          ended = await sendRetryableRequest(request);
        }
      } catch (error: unknown) {
        if (error instanceof WorkoutApiError && retryableEndRequest === request) {
          retryableEndRequest = null;
          state.endReconciliationRequired = false;
        } else if (!(error instanceof WorkoutApiError)) {
          state.endReconciliationRequired = true;
        }
        throw error;
      }
      if (retryableEndRequest === request) retryableEndRequest = null;
      state.endReconciliationRequired = false;
      await finishEndedSession(ended);
    } catch (error: unknown) {
      if (app.state.authRequired || (error instanceof WorkoutApiError && error.status === 401)) throw error;
      state.endError = state.endReconciliationRequired
        ? "上次结束提交的结果尚未确认。表单已锁定；请重试确认同一份提交。"
        : errorMessage(error) || "结束训练失败，请重试";
    } finally {
      state.endSaving = false;
    }
  }

  function beginCorrection(): void {
    const detail = state.detail;
    if (!detail) return;
    state.correctionError = null;
    const existing = new Map<string, SessionCompletionResult>(detail.completion_results.map((result) => [result.completion_item_key, result]));
    const itemDrafts: Record<string, CorrectionItemDraft> = {};
    for (const item of detail.snapshot?.completion_items ?? []) {
      const result = existing.get(item.completion_item_key);
      itemDrafts[item.completion_item_key] = {
        value: String(result?.actual?.value ?? ""),
        weight: resistanceDraftValue(item, result),
        rir: String(result?.rir ?? ""),
      };
    }
    state.correctionDraft = {
      items: itemDrafts,
      feedback: Object.fromEntries(detail.exercise_feedback.map((feedback) => [feedback.exercise_occurrence_key, feedback.text ?? ""])),
      rpe: String(detail.session_rpe ?? ""),
      note: detail.note ?? "",
      skipReason: detail.skip_reason ?? "",
    };
    state.mode = "correction";
  }

  async function saveCorrection(): Promise<void> {
    const detail = state.detail;
    if (!detail || state.correctionSaving) return;
    state.correctionSaving = true;
    state.correctionError = null;
    try {
      const skipped = detail.status === "skipped";
      const correctionTimestamp = detail.training_intervals?.at(-1)?.ended_at || detail.updated_at;
      const existing = new Map<string, SessionCompletionResult>(detail.completion_results.map((result) => [result.completion_item_key, result]));
      const canonicalSetResults: CanonicalSetResultInput[] = skipped || detail.snapshot.schema_version !== 2
        ? []
        : (detail.snapshot.completion_items ?? []).flatMap((item) => {
          const draft = state.correctionDraft.items[item.completion_item_key]
            ?? { value: "", weight: "", rir: "" };
          const prior = existing.get(item.completion_item_key);
          const hasValue = Boolean(draft.value);

          if (!hasValue) {
            if (!prior) return [];
            // A partial result with no actual value and an explicit skipped
            // result both render as blank. Preserve that canonical fact on a
            // no-op save; clearing a previously recorded actual marks it
            // skipped intentionally.
            if (prior.actual == null) {
              const stored = canonicalStoredResultInput(prior, detail);
              if (prior.status !== "partial") return [stored];
              return [{
                ...stored,
                resistance: draft.weight === resistanceDraftValue(item, prior)
                  ? stored.resistance
                  : canonicalResultResistanceInput(item, draft.weight),
                rir: draft.rir === String(prior.rir ?? "")
                  ? stored.rir
                  : numberOrNull(draft.rir),
              }];
            }
            return [{
              completion_item_key: item.completion_item_key,
              status: "skipped" as const,
              actual: null,
              resistance: null,
              rir: null,
              note: prior.note ?? null,
              completed_at: null,
            }];
          }

          const completedAt = prior?.completed_at ?? correctionTimestamp;
          if (!completedAt) throw new Error("训练记录缺少可用的完成时间，无法安全校正");
          const resistance = prior && draft.weight === resistanceDraftValue(item, prior)
            ? canonicalStoredResultInput(prior, detail).resistance
            : canonicalResultResistanceInput(item, draft.weight);
          return [{
            completion_item_key: item.completion_item_key,
            status: prior?.status === "partial" ? "partial" as const : "completed" as const,
            actual: { metric: item.target.metric, value: Number(draft.value) },
            resistance,
            rir: numberOrNull(draft.rir),
            note: prior?.note ?? null,
            completed_at: completedAt,
          }];
        });
      const legacyResults = skipped || detail.snapshot.schema_version === 2 ? [] : (detail.snapshot.completion_items ?? []).flatMap((item) => {
        const draft = state.correctionDraft.items[item.completion_item_key] ?? { value: "", weight: "", rir: "" };
        if (!draft.value) return [];
        const prior = existing.get(item.completion_item_key);
        // Legacy quantity/mode belong to the stored result, not the mutable
        // plan snapshot. Preserve that shape even when only its load changes.
        const resistanceCarrier = prior
          ? { ...item, resistance: prior.resistance ?? null }
          : item;
        const resistance = legacyResultResistanceInput(
          resistanceCarrier,
          prior && draft.weight === resistanceDraftValue(item, prior) ? undefined : draft.weight,
        );
        return [{
          completion_item_key: item.completion_item_key,
          completed: true,
          actual: { metric: item.target.metric, value: Number(draft.value) },
          resistance,
          rir: numberOrNull(draft.rir),
          completed_at: prior?.completed_at || correctionTimestamp,
        }];
      });
      const feedback: ExerciseFeedback[] = skipped
        ? []
        : (detail.snapshot.blocks ?? []).flatMap((block) => block.exercises ?? [])
          .flatMap((exercise) => {
            const exerciseOccurrenceKey = exercise.exercise_occurrence_key ?? exercise.occurrence_key;
            if (!exerciseOccurrenceKey) return [];
            const text = (state.correctionDraft.feedback[exerciseOccurrenceKey] ?? "").trim();
            return text ? [{ exercise_occurrence_key: exerciseOccurrenceKey, text }] : [];
          });
      const record = detail.snapshot.schema_version === 2
        ? {
            record_schema_version: 2,
            set_results: canonicalSetResults,
            training_intervals: skipped ? [] : detail.training_intervals,
            session_rpe: skipped ? null : numberOrNull(state.correctionDraft.rpe),
            note: state.correctionDraft.note.trim() || null,
            exercise_feedback: feedback,
            skip_reason: skipped ? state.correctionDraft.skipReason.trim() || null : null,
          }
        : {
            record_schema_version: 1,
            completion_results: legacyResults,
            training_intervals: skipped ? [] : detail.training_intervals,
            session_rpe: skipped ? null : numberOrNull(state.correctionDraft.rpe),
            note: state.correctionDraft.note.trim() || null,
            exercise_feedback: feedback,
            skip_reason: skipped ? state.correctionDraft.skipReason.trim() || null : null,
          };
      const updated = await app.api.request<SessionDetail>(`/api/private/sessions/${detail.session_key}/record`, {
        method: "PUT",
        body: JSON.stringify(record),
      });
      completionAttempt = null;
      syncDetail(updated);
      state.mode = "overview";
    } catch (error: unknown) {
      if (app.state.authRequired || (error instanceof WorkoutApiError && error.status === 401)) throw error;
      state.correctionError = errorMessage(error) || "校正保存失败，请重试";
    } finally {
      state.correctionSaving = false;
    }
  }

  async function dispatch(intent: SessionIntent): Promise<void> {
    if (state.endReconciliationRequired && intent.type !== "save-end") return;
    if (state.endSaving && [
      "cancel-end",
      "set-end-rpe",
      "draft-end-note",
      "draft-end-feedback",
    ].includes(intent.type)) return;
    try {
      switch (intent.type) {
        case "start": await startSession(); break;
        case "skip": await skipToday(); break;
        case "restart": await resumeTerminalSession("restart"); break;
        case "open-session": await openSession(); break;
        case "continue": await resumeTerminalSession("continue"); break;
        case "start-timed": startTimedAction(); break;
        case "complete": await completeCurrent(); break;
        case "previous":
          resetTimedAction();
          state.focusIndex = Math.max(0, state.focusIndex - 1);
          state.adjust = false;
          break;
        case "next":
          resetTimedAction();
          state.focusIndex = Math.min(Math.max(0, items.value.length - 1), state.focusIndex + 1);
          state.adjust = false;
          break;
        case "jump":
          resetTimedAction();
          clearRestCountdown();
          state.focusIndex = Math.max(0, Math.min(intent.index, Math.max(0, items.value.length - 1)));
          state.progressOpen = false;
          state.adjust = false;
          break;
        case "toggle-adjust": state.adjust = !state.adjust; break;
        case "toggle-progress": state.progressOpen = !state.progressOpen; break;
        case "toggle-timer": await toggleTimer(); break;
        case "toggle-mute": await toggleAudioMuted(); break;
        case "minimize": await minimize(); break;
        case "skip-rest":
          resetTimedAction();
          state.focusIndex = state.restNextIndex ?? state.focusIndex;
          clearRestCountdown();
          break;
        case "end":
          beginEndSheet();
          try {
            await pauseForEnd();
          } catch (error: unknown) {
            if (app.state.authRequired || (error instanceof WorkoutApiError && error.status === 401)) throw error;
            state.endError = errorMessage(error) || "暂停同步失败，请重试";
          }
          break;
        case "cancel-end":
          if (!state.endSaving) state.endSheet = false;
          break;
        case "save-end": await endCurrent(); break;
        case "set-end-rpe": state.endRpe = intent.value; break;
        case "edit-session": beginCorrection(); break;
        case "cancel-correction": state.mode = "overview"; break;
        case "save-correction": await saveCorrection(); break;
        case "draft-actual": writeExecutionDraft("actual", intent.key, intent.value); break;
        case "draft-weight": writeExecutionDraft("resistance", intent.key, intent.value); break;
        case "draft-rir": writeExecutionDraft("rir", intent.key, intent.value); break;
        case "draft-feedback": writeExecutionDraft("feedback", intent.key, intent.value); break;
        case "draft-end-note": state.endNote = intent.value; break;
        case "draft-end-feedback": state.endFeedback[intent.key] = intent.value; break;
        case "draft-correction-item": {
          const draft = state.correctionDraft.items[intent.key] ?? { value: "", weight: "", rir: "" };
          draft[intent.field] = intent.value;
          state.correctionDraft.items[intent.key] = draft;
          break;
        }
        case "draft-correction-feedback": state.correctionDraft.feedback[intent.key] = intent.value; break;
        case "draft-correction-rpe": state.correctionDraft.rpe = intent.value; break;
        case "draft-correction-note": state.correctionDraft.note = intent.value; break;
        case "draft-correction-skip-reason": state.correctionDraft.skipReason = intent.value; break;
      }
    } catch (error: unknown) {
      app.setError(error);
    }
  }

  const wakeNotice = computed(() => {
    const status = state.wakeLockStatus === "idle" && !wakeLockSupported() ? "unsupported" : state.wakeLockStatus;
    if (state.timerPaused && state.timerPauseReason === "visibility") {
      const foreground = documentIsVisible();
      return {
        className: "is-paused",
        title: foreground ? "已回到前台，计时仍暂停" : "页面已离开前台，计时已暂停",
        detail: foreground
          ? "准备好后点击顶部“继续”；后台时间不会计入动作或 Session 计时。"
          : "回到训练后点击顶部“继续”；后台时间不会计入动作或 Session 计时。",
      };
    }
    if (state.timerPaused && state.timerPauseReason === "wake-lock") {
      return {
        className: "is-paused",
        title: status === "active" ? "已回到前台，计时仍暂停" : "屏幕保持已中断，计时已暂停",
        detail: status === "active"
          ? "屏幕保持已重新请求。准备好后点击顶部“继续”。"
          : "准备好后点击顶部“继续”；未保持期间的时间不会计入动作或 Session 计时。",
      };
    }
    if (state.timerPaused) return {
      className: "is-paused",
      title: "训练已暂停，计时已停止",
      detail: "当前不在主动训练中；准备好后点击顶部“继续”。暂停期间不会计入 Session 计时。",
    };
    if (status === "unsupported") return {
      className: "is-fallback",
      title: "无法保持屏幕常亮",
      detail: "当前浏览器不支持屏幕保持。计时仍可手动执行；若页面隐藏或锁屏，回到训练后会暂停并等待你继续。",
    };
    if (status === "denied") return {
      className: "is-fallback",
      title: "屏幕保持未获允许",
      detail: "应用不能保证屏幕常亮，但“开始动作”和手动计时仍可使用；若页面隐藏或锁屏，回到训练后会暂停并等待你继续。",
    };
    return null;
  });

  const elapsedLabel = computed(() => {
    // The wall-clock calculation stays server-authoritative; reading the
    // monotonic frame tick makes Vue refresh the visible label each frame.
    void state.nowMs;
    return sessionElapsed();
  });

  const view = shallowReadonly(reactive({
    state,
    get today() { return app.state.today; },
    get entry() { return entry.value; },
    get summary() { return summary.value; },
    get detail() { return state.detail; },
    get items() { return items.value; },
    get focusedItem() { return focusedItem.value; },
    get focusedContext() { return focusedContext.value; },
    get focusedResult() { return focusedResult.value; },
    get focusedDone() { return focusedDone.value; },
    get completedCount() { return completedCount.value; },
    get completionFraction() { return items.value.length ? completedCount.value / items.value.length : Number(state.detail?.completion_fraction ?? summary.value?.completion_fraction ?? 0); },
    get executionFocused() { return executionFocused.value; },
    get restActive() { return restActive.value; },
    get restNextItem() { return restNextItem.value; },
    get timedTarget() { return timedTarget.value; },
    get timedAction() { return timedForFocus.value; },
    get focusActualDraft() { return focusActualDraft.value; },
    get focusResistanceDraft() { return focusResistanceDraft.value; },
    get focusRirDraft() { return focusRirDraft.value; },
    get focusFeedbackDraft() { return focusFeedbackDraft.value; },
    get completeBlocked() { return completeBlocked.value; },
    get wakeNotice() { return wakeNotice.value; },
    get audioFailed() { return !state.muted && state.audio.status === "error"; },
    get elapsedLabel() { return elapsedLabel.value; },
    get restRemainingLabel() { return restRemainingLabel(); },
    get actionRemainingLabel() { return actionRemainingLabel(); },
    percentage,
    canonicalDurationSeconds,
    editableResistance,
    exerciseExecutionModeLabel,
    focusResistance,
    focusTarget,
    formatActual,
    formatResistance,
    formatTarget,
    formatTempo,
    itemContext,
    itemLabel,
    resultForDisplay,
    displayItemDone,
    resistanceDraftValue,
  }));

  watch(executionFocused, (focused) => onExecutionFocusChange(focused), { immediate: true });
  watch(
    () => app.state.authEpoch,
    (authEpoch, previousAuthEpoch) => {
      if (authEpoch === previousAuthEpoch) return;
      executionDraftsByApp.delete(app);
      draftAuthEpoch = authEpoch;
      draftSessionKey = state.detail?.session_key ?? null;
      completionAttempt = null;
      resetExecutionDraftState();
    },
  );
  watch(
    () => [app.state.session?.session_key, app.state.session?.status] as const,
    ([sessionKey], previous) => {
      if (!sessionKey) {
        state.detail = null;
        state.mode = "overview";
        return;
      }
      if (sessionKey !== previous?.[0] && state.mode === "overview") void loadDetail(false);
    },
  );
  watch(
    () => [executionFocused.value, state.timerPaused, state.endSheet, state.wakeLockStatus] as const,
    () => {
      syncSessionClock();
      syncWakeLock();
    },
  );

  onMounted(() => {
    disposed = false;
    void timeline.prepareAudio();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      // Keep the document listener for older embedded harnesses. Real
      // browsers dispatch pagehide on Window and it does not bubble.
      document.addEventListener("pagehide", handlePageHide);
    }
    if (typeof window !== "undefined") window.addEventListener("pagehide", handlePageHide);
    if (typeof window !== "undefined") window.addEventListener("pageshow", handlePageShow);
    void loadDetail(false);
  });

  onBeforeUnmount(() => {
    disposed = true;
    detailLoadGeneration += 1;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("pagehide", handlePageHide);
    }
    if (typeof window !== "undefined") window.removeEventListener("pagehide", handlePageHide);
    if (typeof window !== "undefined") window.removeEventListener("pageshow", handlePageShow);
    timeline.cancel();
    releaseWakeLock();
    stopSessionClock();
    if (
      pendingActiveMutation
      || resumeRequestPromise
      || retryableActiveRequests.size > 0
      || retryableResumeRequest
      || (state.detail?.status === "in_progress" && hasOpenTrainingInterval(state.detail))
    ) {
      void pauseForInterruption("navigation").catch(() => {});
    }
    onExecutionFocusChange(false);
  });

  return {
    view,
    dispatch,
    ensurePaused,
    executionFocused: readonly(executionFocused),
  };
}
