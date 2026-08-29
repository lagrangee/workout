import type {
  ActualValue,
  CanonicalResistanceInput,
  CanonicalSessionRecordInput,
  CanonicalSetResultInput,
  CompleteItemInput,
  CompletionItem,
  DisplayCompletionItem,
  EndSessionInput,
  ExecutionMode,
  ExerciseFeedback,
  ItemContext,
  LegacyCompletionResultInput,
  LegacyResistanceInput,
  LegacySessionRecordInput,
  ResistanceMode,
  ResistanceValue,
  SessionCompletionResult,
  SessionDetail,
  SessionRecordInput,
  SessionRecordOverrides,
  SnapshotExercise,
  SnapshotSet,
  TargetValue,
  TempoPhases,
  TempoValue,
} from "./session-types";

interface ResistanceCarrier {
  mode?: ResistanceMode | null;
  load_kg?: number | null;
  resistance?: ResistanceValue | null;
  resistance_mode?: ResistanceMode | null;
  resistance_kg?: number | null;
}

type CompletionItemLike = CompletionItem | DisplayCompletionItem;

function exerciseOccurrenceKey(exercise: SnapshotExercise): string | undefined {
  return exercise.exercise_occurrence_key ?? exercise.occurrence_key;
}

function itemSetKey(item: Pick<CompletionItem, "set_key">): string {
  return item.set_key;
}

function setKey(set: SnapshotSet): string | undefined {
  return set.set_key ?? set.set_id;
}

export function itemContext(
  detail: SessionDetail | null | undefined,
  item: CompletionItemLike | null | undefined,
): ItemContext {
  if (!detail || !item) {
    return { block: null, exercise: null, set: null, setNumber: null };
  }

  const block = detail.snapshot.blocks?.find((candidate) =>
    (candidate.exercises ?? []).some(
      (exercise) => exerciseOccurrenceKey(exercise) === item.exercise_occurrence_key,
    ),
  ) ?? null;
  const exercise = block?.exercises?.find(
    (candidate) => exerciseOccurrenceKey(candidate) === item.exercise_occurrence_key,
  ) ?? null;
  const setIndex = exercise?.sets?.findIndex(
    (candidate) => setKey(candidate) === itemSetKey(item),
  ) ?? -1;

  return {
    block,
    exercise,
    set: setIndex >= 0 ? exercise?.sets?.[setIndex] ?? null : null,
    setNumber: setIndex >= 0 ? setIndex + 1 : null,
  };
}

export function exerciseName(
  detail: SessionDetail | null | undefined,
  item: Pick<CompletionItem, "exercise_occurrence_key"> | null | undefined,
): string {
  return detail?.snapshot.blocks
    ?.flatMap((block) => block.exercises ?? [])
    .find((exercise) => exercise.exercise_occurrence_key === item?.exercise_occurrence_key)
    ?.name ?? "训练项目";
}

export function itemLabel(
  detail: SessionDetail | null | undefined,
  item: DisplayCompletionItem | null | undefined,
): string {
  const context = itemContext(detail, item);
  const side = item?.side === "left"
    ? "左"
    : item?.side === "right"
      ? "右"
      : item?.side === "both"
        ? "双侧"
        : item?.alternating
          ? "交替"
          : "";

  return `${exerciseName(detail, item)}${context.setNumber ? ` · 第 ${context.setNumber} 组` : ""}${side ? ` · ${side}` : ""}`;
}

export function displayCompletionItems(
  detail: SessionDetail | null | undefined,
): DisplayCompletionItem[] {
  const raw = detail?.snapshot.completion_items ?? [];
  const exercises = detail?.snapshot.blocks?.flatMap((block) => block.exercises ?? []) ?? [];
  const result: DisplayCompletionItem[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    const next = raw[index + 1];
    const exercise = exercises.find(
      (candidate) => exerciseOccurrenceKey(candidate) === item.exercise_occurrence_key,
    );

    if (
      exercise?.execution_mode === "alternating"
      && item.side === "left"
      && next?.side === "right"
      && next.exercise_occurrence_key === item.exercise_occurrence_key
      && itemSetKey(next) === itemSetKey(item)
    ) {
      result.push({
        ...item,
        side: "alternating",
        alternating: true,
        completion_item_keys: [item.completion_item_key, next.completion_item_key],
      });
      index += 1;
    } else {
      result.push(item);
    }
  }

  return result;
}

export function completionKeys(
  item: DisplayCompletionItem | CompletionItem | null | undefined,
): string[] {
  if (item && "completion_item_keys" in item && item.completion_item_keys) {
    return item.completion_item_keys;
  }
  return item?.completion_item_key ? [item.completion_item_key] : [];
}

export function resultForDisplay(
  detail: SessionDetail | null | undefined,
  item: DisplayCompletionItem | CompletionItem | null | undefined,
): SessionCompletionResult | null {
  const keys = new Set(completionKeys(item));
  return detail?.completion_results.find((result) => keys.has(result.completion_item_key)) ?? null;
}

export function displayItemDone(
  detail: SessionDetail | null | undefined,
  item: DisplayCompletionItem | CompletionItem | null | undefined,
): boolean {
  const keys = completionKeys(item);
  const results = new Map(
    (detail?.completion_results ?? []).map((result) => [result.completion_item_key, result]),
  );

  return keys.length > 0 && keys.every((key) => {
    const result = results.get(key);
    return Boolean(result && (result.status ? result.status === "completed" : result.completed === true));
  });
}

export function canonicalSetResistance(
  set: SnapshotSet | null | undefined,
): ResistanceValue | null {
  if (set?.resistance_mode === "bodyweight") return { mode: "bodyweight" };
  if (set?.resistance_mode === "external_load") {
    return { mode: "external_load", load_kg: set.resistance_kg ?? null, quantity: 1 };
  }
  return null;
}

export function isCanonicalSnapshotItem(
  item: CompletionItemLike | null | undefined,
): boolean {
  return Boolean(
    item
    && (Object.hasOwn(item, "set_id") || Object.hasOwn(item, "resistance_mode")),
  );
}

export function resistanceModeOf(
  value: ResistanceCarrier | null | undefined,
): ResistanceMode | null {
  return value?.resistance_mode ?? value?.resistance?.mode ?? value?.mode ?? null;
}

export function resistanceLoadKg(
  value: ResistanceCarrier | null | undefined,
): number | null {
  return value?.resistance_kg
    ?? value?.resistance?.load_kg
    ?? value?.resistance?.value
    ?? (value?.mode ? value.load_kg ?? null : null);
}

export function editableResistance(item: CompletionItemLike | null | undefined): boolean {
  const mode = resistanceModeOf(item);
  return mode === "external_load" || mode === "external_weight" || mode === "assisted_weight";
}

export function resistanceDraftValue(
  item: CompletionItemLike | null | undefined,
  result: SessionCompletionResult | null = null,
): string {
  const hasStoredResistance = result !== null
    && (
      Object.hasOwn(result, "resistance")
      || Object.hasOwn(result, "resistance_mode")
      || Object.hasOwn(result, "resistance_kg")
    );
  const value = hasStoredResistance ? resistanceLoadKg(result) : resistanceLoadKg(item);
  return value == null ? "" : String(value);
}

export function canonicalResultResistanceInput(
  item: CompletionItemLike | null | undefined,
  loadValue?: number | string | null,
): CanonicalResistanceInput {
  const mode = resistanceModeOf(item);
  if (mode === "bodyweight") return { mode: "bodyweight" };
  if (mode !== "external_load") return null;

  const loadKg = loadValue === undefined ? resistanceLoadKg(item) : loadValue;
  return loadKg === "" || loadKg == null
    ? null
    : { mode: "external_load", value: Number(loadKg), unit: "kg" };
}

function exactLegacyResistanceInput(
  resistance: ResistanceValue | null | undefined,
  loadValue?: number | string | null,
): LegacyResistanceInput {
  if (!resistance) return null;
  if (resistance.mode === "bodyweight") {
    return { mode: "bodyweight", load_kg: null, quantity: null };
  }
  if (resistance.mode === "external_weight" || resistance.mode === "assisted_weight") {
    if (!Number.isInteger(resistance.quantity) || Number(resistance.quantity) <= 0) {
      throw new Error(`Legacy ${resistance.mode} resistance requires a positive quantity`);
    }
    const loadKg = loadValue === undefined ? resistance.load_kg : loadValue;
    return {
      mode: resistance.mode,
      load_kg: loadKg === "" || loadKg == null ? null : Number(loadKg),
      quantity: Number(resistance.quantity),
    };
  }
  throw new Error(`Unsupported legacy resistance mode: ${resistance.mode}`);
}

export function legacyResultResistanceInput(
  item: CompletionItemLike | null | undefined,
  loadValue?: number | string | null,
): LegacyResistanceInput {
  return exactLegacyResistanceInput(item?.resistance, loadValue);
}

export function resultResistanceInput(
  item: CompletionItemLike | null | undefined,
  loadValue?: number | string | null,
): CanonicalResistanceInput | LegacyResistanceInput {
  return isCanonicalSnapshotItem(item)
    ? canonicalResultResistanceInput(item, loadValue)
    : legacyResultResistanceInput(item, loadValue);
}

export function canonicalStoredResultInput(
  result: SessionCompletionResult,
  detail: SessionDetail,
): CanonicalSetResultInput {
  const item = detail.snapshot.completion_items?.find(
    (candidate) => candidate.completion_item_key === result.completion_item_key,
  );
  const status = result.status ?? (result.completed ? "completed" : "partial");
  const mode = resistanceModeOf(result);
  const hasStoredResistance = Object.hasOwn(result, "resistance")
    || Object.hasOwn(result, "resistance_mode")
    || Object.hasOwn(result, "resistance_kg");
  let resistance: CanonicalResistanceInput;

  if (mode === "bodyweight") {
    resistance = { mode: "bodyweight" };
  } else if (mode === "external_load") {
    const loadKg = resistanceLoadKg(result);
    const unit = result.resistance_kg == null
      && result.resistance?.load_kg == null
      && result.resistance?.unit === "lb"
      ? "lb"
      : "kg";
    resistance = loadKg == null
      ? null
      : { mode: "external_load", value: loadKg, unit };
  } else if (hasStoredResistance) {
    // A canonical result may explicitly clear an otherwise prescribed load.
    // Only an older result with no resistance projection at all falls back to
    // the frozen snapshot item.
    resistance = null;
  } else {
    resistance = canonicalResultResistanceInput(item);
  }

  return {
    completion_item_key: result.completion_item_key,
    status,
    actual: result.actual ?? null,
    resistance,
    rir: result.rir ?? null,
    note: result.note ?? null,
    completed_at: result.completed_at ?? null,
  };
}

export function canonicalDurationSeconds(
  target: TargetValue | null | undefined,
): number | null {
  if (target?.metric !== "duration_sec") return null;
  if (Number.isInteger(target.value) && Number(target.value) > 0) return Number(target.value);
  return Number.isInteger(target.max) && Number(target.max) > 0 ? Number(target.max) : null;
}

function targetUnit(metric: string): string {
  if (metric === "reps") return "次";
  if (metric === "duration_sec" || metric === "seconds") return "秒";
  return metric;
}

function targetDisplayValue(target: TargetValue): number | string | undefined {
  return target.value
    ?? (target.min === target.max ? target.min : `${target.min}–${target.max}`);
}

export function focusTarget(target: TargetValue | null | undefined): string {
  if (!target) return "未指定目标";
  const fixedDuration = canonicalDurationSeconds(target);
  if (fixedDuration != null) return `${fixedDuration} 秒`;
  const unit = target.metric === "reps"
    ? "次"
    : target.metric === "duration_sec"
      ? "秒"
      : target.metric;
  return `${targetDisplayValue(target)} ${unit}`;
}

export function formatTarget(target: TargetValue | null | undefined): string {
  if (!target) return "未指定目标";
  const fixedDuration = canonicalDurationSeconds(target);
  const value = fixedDuration ?? targetDisplayValue(target);
  const qualifiers = [
    target.target_rir == null ? null : `RIR ${target.target_rir}`,
    target.target_rpe == null ? null : `RPE ${target.target_rpe}`,
    target.target_incline_percent == null ? null : `坡度 ${target.target_incline_percent}%`,
  ].filter((part): part is string => part !== null);
  return `${value} ${targetUnit(target.metric)}${qualifiers.length ? ` · ${qualifiers.join(" · ")}` : ""}`;
}

export function focusResistance(resistance: ResistanceValue | null | undefined): string {
  if (!resistance) return "";
  if (resistance.mode === "bodyweight") return "自重";
  if (resistance.mode === "external_weight" || resistance.mode === "external_load") {
    const load = resistance.load_kg ?? resistance.value ?? "—";
    const unit = resistance.load_kg != null ? "kg" : resistance.unit ?? "kg";
    const quantity = resistance.quantity && resistance.quantity !== 1
      ? ` × ${resistance.quantity}`
      : "";
    return `${load} ${unit}${quantity}`;
  }
  return resistance.mode || "阻力未指定";
}

export function formatResistance(resistance: ResistanceValue | null | undefined): string {
  if (!resistance) return "阻力未指定";
  if (resistance.mode === "bodyweight") return "自重";
  if (resistance.mode === "external_weight" || resistance.mode === "external_load") {
    const unit = resistance.load_kg != null ? "kg" : resistance.unit ?? "kg";
    return `${resistance.load_kg ?? resistance.value ?? "—"} ${unit} × ${resistance.quantity ?? 1}`;
  }
  return resistance.mode || "阻力";
}

const tempoParts: Array<[keyof TempoPhases, string]> = [
  ["eccentric_sec", "离心"],
  ["bottom_hold_sec", "底部停顿"],
  ["concentric_sec", "向心"],
  ["top_hold_sec", "顶部停顿"],
];

export function formatTempo(tempo: TempoValue | undefined): string {
  if (typeof tempo === "string") return tempo;
  if (!tempo || typeof tempo !== "object") return "";
  return tempoParts
    .filter(([key]) => tempo[key] != null)
    .map(([key, label]) => `${label} ${tempo[key]} 秒`)
    .join(" · ");
}

export function formatActual(actual: ActualValue | null | undefined): string {
  if (!actual) return "";
  return `${actual.value} ${targetUnit(actual.metric)}`;
}

export function formatElapsed(
  detail: Pick<SessionDetail, "training_intervals"> | null | undefined,
  pausedAtMs: number | null = null,
  nowMs: number = Date.now(),
): string {
  const seconds = (detail?.training_intervals ?? []).reduce((total, interval) => {
    const start = Date.parse(interval.started_at);
    const end = interval.ended_at
      ? Date.parse(interval.ended_at)
      : pausedAtMs ?? nowMs;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return total;
    return total + Math.max(0, (end - start) / 1000);
  }, 0);
  const value = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(value / 60);
  const remainingSeconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function executionModeLabel(mode: ExecutionMode | null | undefined): string {
  if (mode === "none") return "不分左右";
  if (mode === "bilateral") return "双侧同时";
  if (mode === "per_side") return "左右分别完成";
  if (mode === "alternating") return "左右交替";
  return "未指定";
}

export function exerciseExecutionModeLabel(
  exercise: SnapshotExercise | null | undefined,
): string {
  return executionModeLabel(
    exercise?.execution_mode ?? (exercise?.side_mode === "left_right" ? "per_side" : "none"),
  );
}

function normalizeRir(value: CompleteItemInput["rir"]): number | null {
  return value === "" || value == null ? null : Number(value);
}

export function completedCanonicalResults(
  item: CompletionItem | DisplayCompletionItem,
  input: CompleteItemInput,
): CanonicalSetResultInput[] {
  const actual: ActualValue = {
    metric: item.target.metric,
    value: Number(input.actualValue),
  };
  const resistance = canonicalResultResistanceInput(item, input.resistanceLoad);
  const rir = normalizeRir(input.rir);

  return completionKeys(item).map((completionItemKey) => ({
    completion_item_key: completionItemKey,
    status: "completed",
    actual,
    resistance,
    rir,
    note: null,
    completed_at: input.completedAt,
  }));
}

export function completedLegacyResult(
  item: CompletionItem | DisplayCompletionItem,
  input: CompleteItemInput,
): LegacyCompletionResultInput {
  return {
    completion_item_key: item.completion_item_key,
    completed: true,
    actual: {
      metric: item.target.metric,
      value: Number(input.actualValue),
    },
    resistance: legacyResultResistanceInput(item, input.resistanceLoad),
    rir: normalizeRir(input.rir),
    completed_at: input.completedAt,
  };
}

function legacyStoredResultInput(
  result: SessionCompletionResult,
): LegacyCompletionResultInput {
  if (!result.actual || !result.completed_at) {
    throw new Error(`Legacy completion result ${result.completion_item_key} is incomplete`);
  }
  return {
    completion_item_key: result.completion_item_key,
    completed: true,
    actual: result.actual,
    resistance: exactLegacyResistanceInput(result.resistance),
    rir: result.rir ?? null,
    completed_at: result.completed_at,
  };
}

function recordCommon(
  detail: SessionDetail,
  overrides: SessionRecordOverrides,
) {
  return {
    training_intervals: (overrides.trainingIntervals ?? detail.training_intervals).slice(),
    session_rpe: overrides.sessionRpe === undefined ? detail.session_rpe : overrides.sessionRpe,
    note: overrides.note === undefined ? detail.note : overrides.note,
    exercise_feedback: (overrides.exerciseFeedback ?? detail.exercise_feedback).slice(),
    skip_reason: overrides.skipReason === undefined ? detail.skip_reason : overrides.skipReason,
  };
}

export function sessionRecordFromDetail(
  detail: SessionDetail,
  overrides: SessionRecordOverrides = {},
): SessionRecordInput {
  const results = overrides.results ?? detail.completion_results;
  const common = recordCommon(detail, overrides);

  if (detail.snapshot.schema_version === 2) {
    const record: CanonicalSessionRecordInput = {
      record_schema_version: 2,
      set_results: results.map((result) => canonicalStoredResultInput(result, detail)),
      ...common,
    };
    return record;
  }

  const record: LegacySessionRecordInput = {
    record_schema_version: 1,
    completion_results: results.map(legacyStoredResultInput),
    ...common,
  };
  return record;
}

export function recordWithCompletedItem(
  detail: SessionDetail,
  item: CompletionItem | DisplayCompletionItem,
  input: CompleteItemInput,
  overrides: Omit<SessionRecordOverrides, "results"> = {},
): SessionRecordInput {
  const keys = new Set(completionKeys(item));
  const existing = detail.completion_results.filter(
    (result) => !keys.has(result.completion_item_key),
  );
  const results: SessionCompletionResult[] = detail.snapshot.schema_version === 2
    ? [...existing, ...completedCanonicalResults(item, input)]
    : [...existing, completedLegacyResult(item, input)];

  return sessionRecordFromDetail(detail, { ...overrides, results });
}

export function endSessionInput(record: SessionRecordInput, endedAt: string): EndSessionInput {
  return { record, ended_at: endedAt };
}

export const buildSessionRecord = sessionRecordFromDetail;
export const buildCompletionRecord = recordWithCompletedItem;
export const buildEndSessionInput = endSessionInput;
