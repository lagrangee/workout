<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import { errorMessage } from "../../core/api-client";
import type { WorkoutAppStore } from "../../core/contracts";
import {
  clearCorrectionDraft,
  correctionDraftFor,
  getCalendarRuntime,
  retainCorrectionDraft,
  syncCalendarRuntimeAuth,
  type CorrectionDraftInput,
  type CorrectionItemDraft,
  type NumericDraft,
  type RetainedCorrectionDraft,
} from "./calendar-runtime";

type ScheduleKind = "workout" | "rest" | "no_plan";
type SessionStatus = "planned" | "in_progress" | "completed" | "partial" | "abandoned" | "skipped";

interface AerobicSummary {
  activity_count: number;
  distance_km: number | null;
  duration_sec: number | null;
  source_status: string;
}

interface RecordingEvidence {
  status?: "awaiting_sync" | "recorded" | "needs_link";
}

interface ActualValue {
  metric: string;
  value: number;
}

interface Resistance {
  mode?: string;
  load_kg?: number | null;
  value?: number | null;
  unit?: string;
  quantity?: number;
  [key: string]: unknown;
}

interface Target {
  metric?: string;
  value?: number;
  min?: number;
  max?: number;
  target_rir?: number | null;
  target_rpe?: number | null;
  target_incline_percent?: number | null;
}

interface PrescribedSet {
  set_key?: string;
  set_id?: string;
  target?: Target;
  resistance?: Resistance | null;
  resistance_mode?: string;
  resistance_kg?: number | null;
  tempo?: string | Record<string, number | string | null> | null;
  rest_after_sec?: number | null;
}

interface PrescriptionExercise {
  exercise_occurrence_key?: string;
  occurrence_key?: string;
  name: string;
  execution_mode?: string;
  side_mode?: string;
  sets: PrescribedSet[];
}

interface PrescriptionBlock {
  title: string;
  exercises: PrescriptionExercise[];
}

interface Prescription {
  schema_version?: number;
  title?: string;
  recording_intent?: unknown;
  blocks: PrescriptionBlock[];
  completion_items?: CompletionItem[];
}

interface ScheduleEntry {
  date: string;
  weekday: string;
  kind: ScheduleKind;
  title?: string | null;
  module_count?: number | null;
  estimated_duration_min?: number | null;
  session_key?: string | null;
  is_overdue_unstarted?: boolean;
  moved_from_date?: string;
  moved_to_date?: string;
  recording_intent?: unknown;
  recording_evidence?: RecordingEvidence | null;
  aerobic_summary?: AerobicSummary | null;
  prescription?: Prescription | null;
}

interface CompletionItem {
  completion_item_key: string;
  exercise_occurrence_key?: string;
  set_key?: string;
  set_id?: string;
  side?: string;
  alternating?: boolean;
  target: Target;
  resistance?: Resistance | null;
  resistance_mode?: string;
  resistance_kg?: number | null;
}

interface CompletionResult {
  completion_item_key: string;
  status?: string;
  completed?: boolean;
  actual?: ActualValue | null;
  resistance?: Resistance | null;
  rir?: number | null;
  note?: string | null;
  completed_at?: string | null;
}

interface TrainingInterval {
  started_at: string;
  ended_at?: string | null;
}

interface ExerciseFeedback {
  exercise_occurrence_key: string;
  text: string;
}

interface SessionSummary {
  session_key: string;
  scheduled_date: string;
  status: SessionStatus;
}

interface SessionDetail extends SessionSummary {
  snapshot: Prescription & { completion_items: CompletionItem[] };
  completion_results: CompletionResult[];
  completion_fraction?: number | null;
  training_intervals: TrainingInterval[];
  session_rpe?: number | null;
  note?: string | null;
  skip_reason?: string | null;
  exercise_feedback: ExerciseFeedback[];
  updated_at: string;
}

interface ScheduleResponse {
  entries: ScheduleEntry[];
}

interface SessionsResponse {
  items: SessionSummary[];
}

interface NormalizeExpiredResponse {
  normalized_count: number;
}

interface SelectedDay {
  entry: ScheduleEntry;
  session: SessionDetail | null;
}

interface CalendarStatus {
  key: string;
  label: string;
}

interface CalendarRow {
  entry: ScheduleEntry;
  session: SessionSummary | undefined;
  status: CalendarStatus;
  beforePlan: boolean;
  aerobicMeta: string;
}

const props = defineProps<{ app: WorkoutAppStore }>();
const emit = defineEmits<{
  (event: "show-aerobic", date: string): void;
}>();

const weekdayLabels: Record<string, string> = {
  monday: "周一",
  tuesday: "周二",
  wednesday: "周三",
  thursday: "周四",
  friday: "周五",
  saturday: "周六",
  sunday: "周日",
};

const aerobicStatusLabels: Record<string, string> = {
  complete: "数据完整",
  partial: "部分数据",
  error: "读取失败",
  none: "暂无数据",
};

const from = ref<string | null>(null);
const to = ref<string | null>(null);
const selectedDate = ref<string | null>(null);
const entries = ref<ScheduleEntry[]>([]);
const sessions = ref<SessionSummary[]>([]);
const selectedDay = ref<SelectedDay | null>(null);
const calendarLoading = ref(false);
const calendarDayLoading = ref(false);
const calendarError = ref<string | null>(null);
const maintenancePending = ref(false);
const maintenanceError = ref<string | null>(null);
const correctionMode = ref(false);
const correctionSaving = ref(false);
const correctionDrafts = ref<Record<string, CorrectionItemDraft>>({});
const correctionRpe = ref<NumericDraft>("");
const correctionNote = ref("");
const correctionSkipReason = ref("");
const correctionFeedback = ref<Record<string, string>>({});
const activeCorrectionSessionKey = ref<string | null>(null);

const runtime = getCalendarRuntime(props.app);

let weekRequestGeneration = 0;
let dayRequestGeneration = 0;
let maintenanceRequestGeneration = 0;
let correctionSaveGeneration = 0;
let activeCorrectionVersion: number | null = null;
let hydratingCorrection = false;
let componentMounted = false;

const firstDate = computed(() => props.app.state.plan?.first_effective_from ?? null);
const todayDate = computed(() => props.app.state.today?.date ?? null);
const selectedEntry = computed(() => selectedDay.value?.entry ?? null);
const selectedSession = computed(() => selectedDay.value?.session ?? null);
const selectedStatus = computed(() => selectedEntry.value ? calendarStatus(selectedEntry.value, selectedSession.value ?? undefined) : null);
const selectedAerobicSummary = computed(() => {
  const entry = selectedEntry.value;
  if (!entry || entry.recording_intent || !entry.aerobic_summary?.activity_count) return null;
  return entry.aerobic_summary;
});
const selectedRecordingIntent = computed(() => selectedEntry.value?.recording_intent ?? selectedEntry.value?.prescription?.recording_intent ?? null);
const selectedRecordingStatus = computed(() => selectedEntry.value?.recording_evidence?.status ?? "awaiting_sync");
const selectedHasAerobicRecords = computed(() => (selectedEntry.value?.aerobic_summary?.activity_count ?? 0) > 0);
const selectedPrescription = computed(() => selectedSession.value?.snapshot ?? selectedEntry.value?.prescription ?? null);
const showSelectedPrescription = computed(() => Boolean(
  selectedPrescription.value
  && !(selectedRecordingIntent.value && !selectedSession.value),
));
const canCorrectSelectedSession = computed(() => Boolean(
  selectedSession.value && ["completed", "partial", "skipped"].includes(selectedSession.value.status),
));
const correctionItems = computed(() => selectedSession.value?.snapshot.completion_items ?? []);
const correctionExercises = computed(() => selectedSession.value?.snapshot.blocks.flatMap((block) => block.exercises) ?? []);

const sessionsByKey = computed(() => new Map(sessions.value.map((session) => [session.session_key, session])));
const calendarRows = computed<CalendarRow[]>(() => entries.value.map((entry) => {
  const beforePlan = Boolean(firstDate.value && entry.date < firstDate.value);
  const session = entry.session_key ? sessionsByKey.value.get(entry.session_key) : undefined;
  const status = beforePlan ? { key: "before-plan", label: "计划尚未开始" } : calendarStatus(entry, session);
  const aerobicCount = entry.aerobic_summary?.activity_count ?? 0;
  return {
    entry,
    session,
    status,
    beforePlan,
    aerobicMeta: aerobicCount ? ` · ${aerobicCount} 次有氧` : "",
  };
}));

const expiredCount = computed(() => sessions.value.filter(isExpiredSession).length);
const previousDisabled = computed(() => {
  if (!from.value || !firstDate.value) return false;
  return addCalendarDays(addCalendarDays(from.value, -7), 6) < firstDate.value;
});

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function calendarWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function calendarMonday(date: string): string {
  return addCalendarDays(date, -calendarWeekday(date));
}

function initialCalendarWeek(): string {
  const current = calendarMonday(todayDate.value ?? new Date().toISOString().slice(0, 10));
  return firstDate.value && addCalendarDays(current, 6) < firstDate.value
    ? calendarMonday(firstDate.value)
    : current;
}

function weekRequestIsCurrent(generation: number, authEpoch: number): boolean {
  return componentMounted
    && generation === weekRequestGeneration
    && authEpoch === props.app.state.authEpoch;
}

function dayRequestIsCurrent(
  generation: number,
  authEpoch: number,
  parentWeekGeneration?: number,
): boolean {
  return componentMounted
    && generation === dayRequestGeneration
    && authEpoch === props.app.state.authEpoch
    && (parentWeekGeneration === undefined || parentWeekGeneration === weekRequestGeneration);
}

function correctionRequestIsCurrent(
  generation: number,
  authEpoch: number,
  sessionKey: string,
  date: string | null,
): boolean {
  return componentMounted
    && generation === correctionSaveGeneration
    && authEpoch === props.app.state.authEpoch
    && selectedSession.value?.session_key === sessionKey
    && selectedDate.value === date;
}

function isExpiredSession(session: SessionSummary | SessionDetail | null | undefined): boolean {
  return Boolean(session?.status === "in_progress" && todayDate.value && session.scheduled_date < todayDate.value);
}

function calendarStatus(entry: ScheduleEntry, session?: SessionSummary | SessionDetail): CalendarStatus {
  if (entry.kind === "rest") return { key: "rest", label: "休息日" };
  if (entry.kind === "no_plan") return { key: "no_plan", label: "无计划" };
  if (isExpiredSession(session)) return { key: "partial", label: "未完成" };
  if (session?.status === "in_progress") return { key: "in_progress", label: "进行中" };
  if (session?.status === "completed") return { key: "completed", label: "已完成" };
  if (session?.status === "partial") return { key: "partial", label: "未完成" };
  if (session?.status === "skipped") return { key: "skipped", label: "已跳过" };
  if (entry.recording_evidence?.status === "recorded") return { key: "recorded", label: "已记录" };
  if (entry.is_overdue_unstarted) return { key: "overdue", label: "未开始" };
  if (entry.date === todayDate.value) return { key: "today", label: "未开始" };
  return { key: "scheduled", label: "未开始" };
}

function dateSummary(row: CalendarRow): string {
  return row.entry.kind === "workout" ? row.entry.title ?? "训练" : row.status.label;
}

function dateMeta(row: CalendarRow): string {
  const { entry, status, beforePlan, aerobicMeta } = row;
  if (entry.kind === "workout") {
    const modules = entry.recording_intent ? "" : `${entry.module_count ?? 0} 个模块 · `;
    const moved = entry.moved_from_date ? ` · 从 ${entry.moved_from_date} 调整` : "";
    return `${modules}${entry.estimated_duration_min ?? 0} 分钟 · ${status.label}${moved}${aerobicMeta}`;
  }
  if (entry.kind === "rest") return entry.moved_to_date ? `训练已移至 ${entry.moved_to_date}${aerobicMeta}` : `恢复，不创建训练记录${aerobicMeta}`;
  return beforePlan ? "" : `未安排内容${aerobicMeta}`;
}

async function loadCalendarWeek(requestedFrom: string, requestedSelectedDate: string | null = null): Promise<void> {
  const authEpoch = props.app.state.authEpoch;
  const generation = ++weekRequestGeneration;
  ++dayRequestGeneration;
  leaveCorrectionContext();
  calendarLoading.value = true;
  calendarError.value = null;
  selectedDay.value = null;

  try {
    const requestedTo = addCalendarDays(requestedFrom, 6);
    const [schedule, sessionList] = await Promise.all([
      props.app.api.request<ScheduleResponse>(`/api/private/schedule?from=${requestedFrom}&to=${requestedTo}&include=aerobic_summary`),
      props.app.api.request<SessionsResponse>(`/api/private/sessions?from=${requestedFrom}&to=${requestedTo}&limit=200`),
    ]);
    if (!weekRequestIsCurrent(generation, authEpoch)) return;

    const requestedDate = requestedSelectedDate ?? requestedFrom;
    const normalizedDate = firstDate.value && requestedDate < firstDate.value ? firstDate.value : requestedDate;
    const normalizedSelectedDate = normalizedDate >= requestedFrom && normalizedDate <= requestedTo
      ? normalizedDate
      : requestedFrom;

    from.value = requestedFrom;
    to.value = requestedTo;
    selectedDate.value = normalizedSelectedDate;
    entries.value = schedule.entries;
    sessions.value = sessionList.items;
    calendarLoading.value = false;
    await loadCalendarDay(normalizedSelectedDate, generation);
  } catch (error) {
    if (!weekRequestIsCurrent(generation, authEpoch)) return;
    calendarLoading.value = false;
    calendarDayLoading.value = false;
    calendarError.value = errorMessage(error);
  }
}

async function loadCalendarDay(date: string, parentWeekGeneration?: number): Promise<void> {
  if (!date || (firstDate.value && date < firstDate.value)) return;
  const authEpoch = props.app.state.authEpoch;
  const generation = ++dayRequestGeneration;
  leaveCorrectionContext();
  selectedDate.value = date;
  selectedDay.value = null;
  calendarDayLoading.value = true;
  calendarError.value = null;

  try {
    const schedule = await props.app.api.request<ScheduleResponse>(`/api/private/schedule?from=${date}&to=${date}&expand=prescription&include=aerobic_summary`);
    if (!dayRequestIsCurrent(generation, authEpoch, parentWeekGeneration)) return;
    const entry = schedule.entries[0];
    if (!entry) {
      selectedDay.value = null;
      return;
    }
    const session = entry.session_key
      ? await props.app.api.request<SessionDetail>(`/api/private/sessions/${entry.session_key}`)
      : null;
    if (!dayRequestIsCurrent(generation, authEpoch, parentWeekGeneration)) return;
    selectedDay.value = { entry, session };
    if (session) restoreCorrectionForSession(session);
  } catch (error) {
    if (!dayRequestIsCurrent(generation, authEpoch, parentWeekGeneration)) return;
    calendarError.value = errorMessage(error);
  } finally {
    if (dayRequestIsCurrent(generation, authEpoch, parentWeekGeneration)) calendarDayLoading.value = false;
  }
}

function previousWeek(): void {
  if (!from.value || previousDisabled.value) return;
  void loadCalendarWeek(
    addCalendarDays(from.value, -7),
    addCalendarDays(selectedDate.value ?? from.value, -7),
  );
}

function nextWeek(): void {
  if (!from.value) return;
  void loadCalendarWeek(
    addCalendarDays(from.value, 7),
    addCalendarDays(selectedDate.value ?? from.value, 7),
  );
}

function retryCalendar(): void {
  void loadCalendarWeek(from.value ?? initialCalendarWeek(), selectedDate.value ?? todayDate.value);
}

async function normalizeExpired(): Promise<void> {
  if (maintenancePending.value) return;
  const authEpoch = props.app.state.authEpoch;
  const generation = ++maintenanceRequestGeneration;
  maintenancePending.value = true;
  maintenanceError.value = null;
  try {
    const result = await props.app.api.request<NormalizeExpiredResponse>("/api/private/sessions/normalize-expired", {
      method: "POST",
      headers: { "Idempotency-Key": props.app.api.idempotencyKey() },
      body: "{}",
    });
    if (!componentMounted || generation !== maintenanceRequestGeneration || authEpoch !== props.app.state.authEpoch) return;
    props.app.setMessage(result.normalized_count
      ? `已整理 ${result.normalized_count} 条过期训练记录，统一标记为未完成`
      : "没有需要整理的过期训练记录");
    await props.app.refresh();
    if (componentMounted
      && generation === maintenanceRequestGeneration
      && authEpoch === props.app.state.authEpoch
      && from.value) await loadCalendarWeek(from.value, selectedDate.value);
  } catch (error) {
    if (componentMounted && generation === maintenanceRequestGeneration && authEpoch === props.app.state.authEpoch) {
      maintenanceError.value = errorMessage(error) || "整理失败，请重试";
    }
  } finally {
    if (generation === maintenanceRequestGeneration && authEpoch === props.app.state.authEpoch) {
      maintenancePending.value = false;
    }
  }
}

function showAerobic(date: string): void {
  emit("show-aerobic", date);
}

function formatPercent(value: number | null | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function aerobicStatusLabel(status: string): string {
  return aerobicStatusLabels[status] ?? "状态未知";
}

function aerobicDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const minutes = Math.round(Number(seconds) / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function formatDistance(distance: number | null): string {
  return distance == null ? "—" : `${distance} km`;
}

function executionModeLabel(exercise: PrescriptionExercise): string {
  const mode = exercise.execution_mode ?? (exercise.side_mode === "left_right" ? "per_side" : "none");
  return {
    none: "不分左右",
    bilateral: "双侧同时",
    per_side: "左右分别完成",
    alternating: "左右交替",
  }[mode] ?? "未指定";
}

function canonicalDurationSeconds(target: Target | undefined): number | null {
  if (target?.metric !== "duration_sec") return null;
  if (Number.isInteger(target.value) && Number(target.value) > 0) return Number(target.value);
  return Number.isInteger(target.max) && Number(target.max) > 0 ? Number(target.max) : null;
}

function formatTarget(target: Target | undefined): string {
  if (!target) return "未指定目标";
  const fixedDuration = canonicalDurationSeconds(target);
  const unit = target.metric === "reps"
    ? "次"
    : target.metric === "duration_sec" || target.metric === "seconds"
      ? "秒"
      : target.metric ?? "";
  const value = fixedDuration ?? target.value ?? (target.min === target.max ? target.min : `${target.min}–${target.max}`);
  const qualifiers = [
    target.target_rir == null ? null : `RIR ${target.target_rir}`,
    target.target_rpe == null ? null : `RPE ${target.target_rpe}`,
    target.target_incline_percent == null ? null : `坡度 ${target.target_incline_percent}%`,
  ].filter((item): item is string => Boolean(item));
  return `${value} ${unit}${qualifiers.length ? ` · ${qualifiers.join(" · ")}` : ""}`;
}

function formatTempo(tempo: PrescribedSet["tempo"]): string {
  if (typeof tempo === "string") return tempo;
  if (!tempo || typeof tempo !== "object") return "";
  const fields: Array<[string, string]> = [
    ["eccentric_sec", "离心"],
    ["bottom_hold_sec", "底部停顿"],
    ["concentric_sec", "向心"],
    ["top_hold_sec", "顶部停顿"],
  ];
  return fields
    .filter(([key]) => tempo[key] != null)
    .map(([key, label]) => `${label} ${tempo[key]} 秒`)
    .join(" · ");
}

function canonicalSetResistance(set: PrescribedSet): Resistance | null {
  if (set.resistance_mode === "bodyweight") return { mode: "bodyweight" };
  if (set.resistance_mode === "external_load") {
    return { mode: "external_load", load_kg: set.resistance_kg, quantity: 1 };
  }
  return null;
}

function formatResistance(resistance: Resistance | null | undefined): string {
  if (!resistance) return "阻力未指定";
  if (resistance.mode === "bodyweight") return "自重";
  if (resistance.mode === "external_weight" || resistance.mode === "external_load") {
    return `${resistance.load_kg ?? resistance.value ?? "—"} kg × ${resistance.quantity ?? 1}`;
  }
  return resistance.mode || "阻力";
}

function formatActual(actual: ActualValue): string {
  const unit = actual.metric === "reps"
    ? "次"
    : actual.metric === "duration_sec" || actual.metric === "seconds"
      ? "秒"
      : actual.metric;
  return `${actual.value} ${unit}`;
}

function actualsForSet(detail: SessionDetail | null, blockIndex: number, exerciseIndex: number, setIndex: number): string[] {
  if (!detail) return [];
  const snapshotSet = detail.snapshot.blocks[blockIndex]?.exercises[exerciseIndex]?.sets[setIndex];
  const snapshotSetKey = snapshotSet?.set_key ?? snapshotSet?.set_id;
  if (!snapshotSetKey) return [];
  return detail.snapshot.completion_items
    .filter((item) => (item.set_key ?? item.set_id) === snapshotSetKey)
    .map((item) => {
      const result = detail.completion_results.find((candidate) => candidate.completion_item_key === item.completion_item_key);
      if (!result?.actual) return null;
      const side = item.side === "none" || !item.side ? "" : `${item.side} `;
      return `${side}${formatActual(result.actual)}`;
    })
    .filter((item): item is string => Boolean(item));
}

function exerciseKey(exercise: PrescriptionExercise): string {
  return exercise.exercise_occurrence_key ?? exercise.occurrence_key ?? exercise.name;
}

function itemContext(detail: SessionDetail, item: CompletionItem): { exercise?: PrescriptionExercise; setNumber: number | null } {
  const exercise = detail.snapshot.blocks
    .flatMap((block) => block.exercises)
    .find((candidate) => exerciseKey(candidate) === item.exercise_occurrence_key);
  const setIndex = exercise?.sets.findIndex((set) => (set.set_key ?? set.set_id) === (item.set_key ?? item.set_id)) ?? -1;
  return { exercise, setNumber: setIndex >= 0 ? setIndex + 1 : null };
}

function itemLabel(detail: SessionDetail, item: CompletionItem): string {
  const context = itemContext(detail, item);
  const side = item.side === "left"
    ? "左"
    : item.side === "right"
      ? "右"
      : item.side === "both"
        ? "双侧"
        : item.alternating
          ? "交替"
          : "";
  return `${context.exercise?.name ?? "训练项目"}${context.setNumber ? ` · 第 ${context.setNumber} 组` : ""}${side ? ` · ${side}` : ""}`;
}

function isCanonicalSnapshotItem(item: CompletionItem): boolean {
  return Object.hasOwn(item, "set_id") || Object.hasOwn(item, "resistance_mode");
}

function resistanceModeOf(value: CompletionItem | CompletionResult | Resistance | null | undefined): string | null {
  if (!value) return null;
  if ("resistance_mode" in value && typeof value.resistance_mode === "string") return value.resistance_mode;
  if ("resistance" in value) {
    const resistance = value.resistance as Resistance | null | undefined;
    if (resistance?.mode) return resistance.mode;
  }
  return "mode" in value && typeof value.mode === "string" ? value.mode : null;
}

function resistanceLoadKg(value: CompletionItem | CompletionResult | Resistance | null | undefined): number | null {
  if (!value) return null;
  if ("resistance_kg" in value && typeof value.resistance_kg === "number") return value.resistance_kg;
  if ("resistance" in value) {
    const nested = value.resistance as Resistance | null | undefined;
    const nestedValue = nested?.load_kg ?? nested?.value;
    return typeof nestedValue === "number" ? nestedValue : null;
  }
  if ("load_kg" in value && typeof value.load_kg === "number") return value.load_kg;
  if ("value" in value && typeof value.value === "number") return value.value;
  return null;
}

function editableResistance(item: CompletionItem): boolean {
  return ["external_load", "external_weight", "assisted_weight"].includes(resistanceModeOf(item) ?? "");
}

function resultResistanceInput(item: CompletionItem, loadValue: NumericDraft): Resistance | null {
  const mode = resistanceModeOf(item);
  if (isCanonicalSnapshotItem(item)) {
    if (mode === "bodyweight") return { mode: "bodyweight" };
    if (mode === "external_load") {
      const value = loadValue === "" ? null : Number(loadValue);
      return value == null ? null : { mode: "external_load", value, unit: "kg" };
    }
    return null;
  }

  const resistance = item.resistance;
  if (!resistance) return null;
  if (resistance.mode === "bodyweight") return { ...resistance };
  if (resistance.mode === "external_weight" || resistance.mode === "assisted_weight") {
    const loadKg = loadValue === "" ? null : Number(loadValue);
    return { ...resistance, load_kg: loadKg ?? null };
  }
  return { ...resistance };
}

function correctionDraftFromDetail(detail: SessionDetail): CorrectionDraftInput {
  const results = new Map(detail.completion_results.map((result) => [result.completion_item_key, result]));
  const items: Record<string, CorrectionItemDraft> = Object.fromEntries(detail.snapshot.completion_items.map((item) => {
    const result = results.get(item.completion_item_key);
    const weight = resistanceLoadKg(result) ?? resistanceLoadKg(item);
    const itemDraft: CorrectionItemDraft = {
      value: result?.actual?.value ?? "",
      weight: weight ?? "",
      rir: result?.rir ?? "",
    };
    return [item.completion_item_key, itemDraft];
  }));
  return {
    authEpoch: props.app.state.authEpoch,
    sessionKey: detail.session_key,
    mode: true,
    items,
    rpe: detail.session_rpe ?? "",
    note: detail.note ?? "",
    skipReason: detail.skip_reason ?? "",
    feedback: Object.fromEntries(detail.exercise_feedback.map((feedback) => [feedback.exercise_occurrence_key, feedback.text])),
  };
}

function resetCorrectionEditor(): void {
  hydratingCorrection = true;
  correctionMode.value = false;
  correctionDrafts.value = {};
  correctionRpe.value = "";
  correctionNote.value = "";
  correctionSkipReason.value = "";
  correctionFeedback.value = {};
  activeCorrectionSessionKey.value = null;
  activeCorrectionVersion = null;
  correctionSaving.value = false;
  hydratingCorrection = false;
}

function leaveCorrectionContext(): void {
  correctionSaveGeneration += 1;
  resetCorrectionEditor();
}

function hydrateCorrectionEditor(
  detail: SessionDetail,
  draft: CorrectionDraftInput | RetainedCorrectionDraft,
): void {
  const baseline = correctionDraftFromDetail(detail);
  hydratingCorrection = true;
  correctionDrafts.value = Object.fromEntries(detail.snapshot.completion_items.map((item) => [
    item.completion_item_key,
    { ...(draft.items[item.completion_item_key] ?? baseline.items[item.completion_item_key]) },
  ]));
  correctionRpe.value = draft.rpe;
  correctionNote.value = draft.note;
  correctionSkipReason.value = draft.skipReason;
  correctionFeedback.value = { ...draft.feedback };
  activeCorrectionSessionKey.value = detail.session_key;
  activeCorrectionVersion = "version" in draft ? draft.version : null;
  correctionMode.value = draft.mode;
  hydratingCorrection = false;
}

function persistCorrectionEditor(): number | null {
  const sessionKey = activeCorrectionSessionKey.value;
  if (hydratingCorrection
    || !correctionMode.value
    || !sessionKey
    || runtime.authEpoch !== props.app.state.authEpoch
    || selectedSession.value?.session_key !== sessionKey) return activeCorrectionVersion;
  const retained = retainCorrectionDraft(runtime, {
    authEpoch: props.app.state.authEpoch,
    sessionKey,
    mode: correctionMode.value,
    items: correctionDrafts.value,
    rpe: correctionRpe.value,
    note: correctionNote.value,
    skipReason: correctionSkipReason.value,
    feedback: correctionFeedback.value,
  });
  activeCorrectionVersion = retained?.version ?? null;
  return activeCorrectionVersion;
}

function restoreCorrectionForSession(detail: SessionDetail): void {
  const retained = correctionDraftFor(runtime, props.app.state.authEpoch, detail.session_key);
  if (!retained?.mode) return;
  hydrateCorrectionEditor(detail, retained);
}

function openCorrection(): void {
  const detail = selectedSession.value;
  if (!detail || !canCorrectSelectedSession.value) return;
  const retained = correctionDraftFor(runtime, props.app.state.authEpoch, detail.session_key);
  if (retained?.mode) {
    hydrateCorrectionEditor(detail, retained);
    return;
  }
  hydrateCorrectionEditor(detail, correctionDraftFromDetail(detail));
  persistCorrectionEditor();
}

function closeCorrection(): void {
  const sessionKey = activeCorrectionSessionKey.value;
  const cleared = sessionKey
    ? clearCorrectionDraft(runtime, {
        authEpoch: props.app.state.authEpoch,
        sessionKey,
        reason: "cancelled",
      })
    : false;
  if (!cleared) resetCorrectionEditor();
}

async function saveCorrection(): Promise<void> {
  const detail = selectedSession.value;
  if (!detail || correctionSaving.value) return;
  const authEpoch = props.app.state.authEpoch;
  const sessionKey = detail.session_key;
  const date = selectedDate.value;
  const generation = ++correctionSaveGeneration;
  const expectedVersion = persistCorrectionEditor();
  if (expectedVersion === null) return;
  correctionSaving.value = true;
  try {
    const isSkipped = detail.status === "skipped";
    const lastInterval = detail.training_intervals.at(-1);
    const correctionTimestamp = lastInterval?.ended_at || detail.updated_at;
    const existingResults = new Map(detail.completion_results.map((result) => [result.completion_item_key, result]));
    const canonicalSetResults = isSkipped ? [] : detail.snapshot.completion_items.map((item) => {
      const draft = correctionDrafts.value[item.completion_item_key] ?? { value: "", weight: "", rir: "" };
      const existing = existingResults.get(item.completion_item_key);
      const hasValue = draft.value !== "";
      return {
        completion_item_key: item.completion_item_key,
        status: hasValue ? "completed" : "skipped",
        actual: hasValue ? { metric: item.target.metric, value: Number(draft.value) } : null,
        resistance: hasValue ? resultResistanceInput(item, draft.weight) : null,
        rir: hasValue && draft.rir !== "" ? Number(draft.rir) : null,
        note: existing?.note ?? null,
        completed_at: hasValue ? existing?.completed_at || correctionTimestamp : null,
      };
    });
    const completionResults = isSkipped ? [] : detail.snapshot.completion_items.flatMap((item) => {
      const draft = correctionDrafts.value[item.completion_item_key] ?? { value: "", weight: "", rir: "" };
      if (draft.value === "") return [];
      const existing = existingResults.get(item.completion_item_key);
      return [{
        completion_item_key: item.completion_item_key,
        completed: true,
        actual: { metric: item.target.metric, value: Number(draft.value) },
        resistance: resultResistanceInput(item, draft.weight),
        rir: draft.rir === "" ? null : Number(draft.rir),
        completed_at: existing?.completed_at || correctionTimestamp,
      }];
    });
    const feedback = isSkipped ? [] : correctionExercises.value.flatMap((exercise) => {
      const key = exerciseKey(exercise);
      const text = correctionFeedback.value[key]?.trim();
      return text ? [{ exercise_occurrence_key: key, text }] : [];
    });
    const sessionRpe = isSkipped || correctionRpe.value === "" ? null : Number(correctionRpe.value);
    const note = correctionNote.value.trim() || null;
    const skipReason = isSkipped ? correctionSkipReason.value.trim() || null : null;
    const record = detail.snapshot.schema_version === 2
      ? {
          record_schema_version: 2,
          set_results: canonicalSetResults,
          training_intervals: isSkipped ? [] : detail.training_intervals,
          session_rpe: sessionRpe,
          note,
          exercise_feedback: feedback,
          skip_reason: skipReason,
        }
      : {
          record_schema_version: 1,
          completion_results: completionResults,
          training_intervals: isSkipped ? [] : detail.training_intervals,
          session_rpe: sessionRpe,
          note,
          exercise_feedback: feedback,
          skip_reason: skipReason,
        };

    await props.app.api.request(`/api/private/sessions/${sessionKey}/record`, {
      method: "PUT",
      body: JSON.stringify(record),
    });
    const cleared = clearCorrectionDraft(runtime, {
      authEpoch,
      sessionKey,
      expectedVersion,
      reason: "saved",
    });
    if (!cleared || !correctionRequestIsCurrent(generation, authEpoch, sessionKey, date)) return;
    resetCorrectionEditor();
    if (date) await loadCalendarDay(date);
  } catch (error) {
    if (correctionRequestIsCurrent(generation, authEpoch, sessionKey, date)) {
      props.app.setError(error);
    }
  } finally {
    if (generation === correctionSaveGeneration && authEpoch === props.app.state.authEpoch) {
      correctionSaving.value = false;
    }
  }
}

watch(
  [
    correctionMode,
    correctionDrafts,
    correctionRpe,
    correctionNote,
    correctionSkipReason,
    correctionFeedback,
  ],
  () => {
    persistCorrectionEditor();
  },
  { deep: true, flush: "sync" },
);

watch(runtime.changeSequence, () => {
  const change = runtime.lastChange.value;
  if (!change || change.authEpoch !== props.app.state.authEpoch) return;
  if (change.kind === "identity") {
    leaveCorrectionContext();
    return;
  }
  if (!change.sessionKey || change.sessionKey !== activeCorrectionSessionKey.value) return;
  const reloadSavedSession = change.kind === "saved"
    && !correctionSaving.value
    && componentMounted
    && selectedSession.value?.session_key === change.sessionKey
    && selectedDate.value !== null;
  const date = selectedDate.value;
  resetCorrectionEditor();
  if (reloadSavedSession && date) void loadCalendarDay(date);
}, { flush: "sync" });

watch(() => props.app.state.authEpoch, (authEpoch) => {
  syncCalendarRuntimeAuth(runtime, authEpoch);
  weekRequestGeneration += 1;
  dayRequestGeneration += 1;
  maintenanceRequestGeneration += 1;
  correctionSaveGeneration += 1;
  resetCorrectionEditor();
  calendarLoading.value = false;
  calendarDayLoading.value = false;
  calendarError.value = null;
  maintenancePending.value = false;
  maintenanceError.value = null;
  from.value = null;
  to.value = null;
  selectedDate.value = null;
  entries.value = [];
  sessions.value = [];
  selectedDay.value = null;
}, { flush: "sync" });

onMounted(() => {
  componentMounted = true;
  if (!firstDate.value) return;
  void loadCalendarWeek(initialCalendarWeek(), todayDate.value);
});

onUnmounted(() => {
  componentMounted = false;
  weekRequestGeneration += 1;
  dayRequestGeneration += 1;
  maintenanceRequestGeneration += 1;
  correctionSaveGeneration += 1;
});
</script>

<template>
  <template v-if="calendarLoading && !entries.length">
    <section class="page-head">
      <p class="eyebrow">CALENDAR</p>
      <h1>日历</h1>
    </section>
    <section class="loading">
      <span class="spinner"></span>
      <p>正在读取日期安排…</p>
    </section>
  </template>

  <template v-else-if="calendarError">
    <section class="page-head">
      <p class="eyebrow">CALENDAR</p>
      <h1>日历</h1>
    </section>
    <section class="error-card">
      <p>{{ calendarError }}</p>
      <button class="primary" data-action="calendar-retry" type="button" @click="retryCalendar">重新读取</button>
    </section>
  </template>

  <template v-else-if="!firstDate">
    <section class="page-head">
      <p class="eyebrow">CALENDAR</p>
      <h1>日历</h1>
      <p class="muted">还没有生效的计划。</p>
    </section>
    <section class="quiet-card">
      <strong>日历暂不可用</strong>
      <p>在设置中提交第一份计划后，这里会从其生效日期开始显示。</p>
    </section>
  </template>

  <template v-else-if="!from">
    <section class="page-head">
      <p class="eyebrow">CALENDAR</p>
      <h1>日历</h1>
      <p class="muted">还没有可浏览的计划。</p>
    </section>
  </template>

  <template v-else>
    <section class="page-head calendar-head">
      <div class="calendar-title-row">
        <div>
          <p class="eyebrow">CALENDAR</p>
          <h1>日历</h1>
        </div>
        <button
          v-if="expiredCount > 0"
          class="secondary calendar-maintenance-button"
          data-action="normalize-expired"
          type="button"
          :disabled="maintenancePending"
          :aria-busy="maintenancePending"
          @click="normalizeExpired"
        >
          {{ maintenancePending ? "整理中…" : `整理 ${expiredCount} 条` }}
        </button>
      </div>
      <div v-if="maintenanceError" class="notice calendar-maintenance-notice" role="alert">
        {{ maintenanceError }}
      </div>
      <div class="calendar-week-controls">
        <button
          class="secondary"
          data-action="calendar-previous"
          type="button"
          :disabled="previousDisabled"
          @click="previousWeek"
        >‹ 上一周</button>
        <strong>{{ from }} – {{ to }}</strong>
        <button class="secondary" data-action="calendar-next" type="button" @click="nextWeek">下一周 ›</button>
      </div>
      <div class="calendar-legend" aria-label="日历状态图例">
        <span class="calendar-legend-item completed"><i></i>已完成</span>
        <span class="calendar-legend-item recorded"><i></i>已记录</span>
        <span class="calendar-legend-item partial"><i></i>未完成</span>
        <span class="calendar-legend-item skipped"><i></i>已跳过</span>
        <span class="calendar-legend-item today"><i></i>未开始</span>
      </div>
    </section>

    <section class="calendar-week" aria-label="七天训练安排">
      <button
        v-for="row in calendarRows"
        :key="row.entry.date"
        class="calendar-day"
        :class="[row.status.key, { selected: row.entry.date === selectedDate }]"
        data-action="calendar-select"
        :data-date="row.entry.date"
        type="button"
        :disabled="row.beforePlan"
        @click="loadCalendarDay(row.entry.date)"
      >
        <span class="calendar-day-label">{{ weekdayLabels[row.entry.weekday] }}</span>
        <span class="calendar-day-date">{{ row.entry.date.slice(5) }}</span>
        <span class="calendar-day-summary">{{ dateSummary(row) }}</span>
        <span class="calendar-day-meta">{{ dateMeta(row) }}</span>
      </button>
    </section>

    <section v-if="calendarDayLoading" class="loading compact-loading">
      <span class="spinner"></span>
      <p>正在读取这一天…</p>
    </section>

    <template v-else-if="selectedEntry && selectedEntry.date === selectedDate">
      <template v-if="correctionMode && selectedSession">
        <template v-if="selectedSession.status === 'skipped'">
          <section class="page-head">
            <p class="eyebrow">CORRECTION</p>
            <h1>校正记录</h1>
            <p class="muted">{{ selectedEntry.title }} · 训练日期和跳过状态保持不变。</p>
          </section>
          <section class="list-card">
            <label>
              跳过原因
              <input id="correction-skip-reason" v-model="correctionSkipReason" maxlength="500" />
            </label>
            <label>
              训练备注
              <textarea id="correction-note" v-model="correctionNote" maxlength="5000"></textarea>
            </label>
          </section>
        </template>

        <template v-else>
          <section class="page-head">
            <p class="eyebrow">CORRECTION</p>
            <h1>校正记录</h1>
            <p class="muted">{{ selectedEntry.title }} · 训练日期保持不变。留空的项目会被视为未完成。</p>
          </section>
          <section class="list-card">
            <label v-for="(item, index) in correctionItems" :key="item.completion_item_key">
              {{ index + 1 }}. {{ itemLabel(selectedSession, item) }}
              <input
                :id="`correction-value-${item.completion_item_key}`"
                v-model="correctionDrafts[item.completion_item_key].value"
                type="number"
                min="1"
                placeholder="实际值"
              />
              <input
                v-if="editableResistance(item)"
                :id="`correction-weight-${item.completion_item_key}`"
                v-model="correctionDrafts[item.completion_item_key].weight"
                type="number"
                min="0"
                step="0.1"
                placeholder="实际重量（kg，可留空）"
              />
              <input
                :id="`correction-rir-${item.completion_item_key}`"
                v-model="correctionDrafts[item.completion_item_key].rir"
                type="number"
                min="0"
                max="10"
                placeholder="RIR（可留空）"
              />
            </label>
          </section>
          <section class="quiet-card">
            <label>
              训练 RPE
              <input id="correction-rpe" v-model="correctionRpe" type="number" min="0" max="10" />
            </label>
            <label>
              训练备注
              <textarea id="correction-note" v-model="correctionNote" maxlength="5000"></textarea>
            </label>
            <label>动作反馈</label>
            <input
              v-for="exercise in correctionExercises"
              :id="`correction-feedback-${exerciseKey(exercise)}`"
              :key="exerciseKey(exercise)"
              v-model="correctionFeedback[exerciseKey(exercise)]"
              :placeholder="`${exercise.name}（可留空）`"
            />
          </section>
        </template>

        <div class="sheet-actions">
          <button class="secondary" data-action="cancel-correction" type="button" :disabled="correctionSaving" @click="closeCorrection">取消</button>
          <button class="primary" data-action="save-correction" type="button" :disabled="correctionSaving" @click="saveCorrection">
            {{ correctionSaving ? "保存中…" : "保存校正" }}
          </button>
        </div>
      </template>

      <template v-else>
        <template v-if="selectedEntry.kind === 'rest'">
          <section
            v-if="selectedAerobicSummary"
            class="calendar-aerobic-summary"
            :aria-label="`${selectedEntry.date} 有氧摘要`"
          >
            <div>
              <p class="eyebrow">COROS · AEROBIC SUMMARY</p>
              <h3>有氧摘要</h3>
              <p class="muted">
                {{ selectedAerobicSummary.activity_count }} 次活动 · {{ formatDistance(selectedAerobicSummary.distance_km) }} · {{ aerobicDuration(selectedAerobicSummary.duration_sec) }}
              </p>
            </div>
            <span class="status-pill" :class="selectedAerobicSummary.source_status">{{ aerobicStatusLabel(selectedAerobicSummary.source_status) }}</span>
            <button class="secondary" data-action="open-aerobic-date" :data-date="selectedEntry.date" type="button" @click="showAerobic(selectedEntry.date)">查看有氧记录</button>
          </section>
          <section class="calendar-detail quiet-card">
            <span class="status-pill">休息日</span>
            <h2>恢复日</h2>
            <p class="muted">不安排训练，也不会创建训练记录。</p>
          </section>
        </template>

        <template v-else-if="selectedEntry.kind === 'no_plan'">
          <section
            v-if="selectedAerobicSummary"
            class="calendar-aerobic-summary"
            :aria-label="`${selectedEntry.date} 有氧摘要`"
          >
            <div>
              <p class="eyebrow">COROS · AEROBIC SUMMARY</p>
              <h3>有氧摘要</h3>
              <p class="muted">
                {{ selectedAerobicSummary.activity_count }} 次活动 · {{ formatDistance(selectedAerobicSummary.distance_km) }} · {{ aerobicDuration(selectedAerobicSummary.duration_sec) }}
              </p>
            </div>
            <span class="status-pill" :class="selectedAerobicSummary.source_status">{{ aerobicStatusLabel(selectedAerobicSummary.source_status) }}</span>
            <button class="secondary" data-action="open-aerobic-date" :data-date="selectedEntry.date" type="button" @click="showAerobic(selectedEntry.date)">查看有氧记录</button>
          </section>
          <section class="calendar-detail quiet-card">
            <span class="status-pill">无计划</span>
            <h2>未安排内容</h2>
            <p class="muted">没有生效的 Weekly Template 槽位。</p>
          </section>
        </template>

        <template v-else-if="!selectedEntry.prescription">
          <section
            v-if="selectedAerobicSummary"
            class="calendar-aerobic-summary"
            :aria-label="`${selectedEntry.date} 有氧摘要`"
          >
            <div>
              <p class="eyebrow">COROS · AEROBIC SUMMARY</p>
              <h3>有氧摘要</h3>
              <p class="muted">
                {{ selectedAerobicSummary.activity_count }} 次活动 · {{ formatDistance(selectedAerobicSummary.distance_km) }} · {{ aerobicDuration(selectedAerobicSummary.duration_sec) }}
              </p>
            </div>
            <span class="status-pill" :class="selectedAerobicSummary.source_status">{{ aerobicStatusLabel(selectedAerobicSummary.source_status) }}</span>
            <button class="secondary" data-action="open-aerobic-date" :data-date="selectedEntry.date" type="button" @click="showAerobic(selectedEntry.date)">查看有氧记录</button>
          </section>
          <section class="calendar-detail error-card">
            <p>这一天的训练处方暂时无法读取。</p>
          </section>
        </template>

        <template v-else>
          <section class="calendar-detail">
            <div class="calendar-detail-head">
              <div>
                <h2>{{ selectedEntry.title }}</h2>
                <p class="muted">约 {{ selectedEntry.estimated_duration_min }} 分钟 · {{ selectedStatus?.label }}</p>
              </div>
              <span class="status-pill" :class="selectedStatus?.key">{{ selectedStatus?.label }}</span>
            </div>

            <section
              v-if="selectedRecordingIntent"
              class="calendar-recording-guide"
              :class="{
                'is-recorded': selectedRecordingStatus === 'recorded',
                'needs-link': selectedRecordingStatus === 'needs_link',
              }"
              aria-label="COROS 路线记录状态"
            >
              <strong>COROS 记录</strong>
              <div v-if="selectedRecordingStatus === 'needs_link'" class="calendar-recording-actions">
                <span class="status-pill partial">待关联</span>
                <button
                  v-if="selectedHasAerobicRecords"
                  class="secondary"
                  data-action="open-aerobic-date"
                  :data-date="selectedEntry.date"
                  type="button"
                  @click="showAerobic(selectedEntry.date)"
                >查看有氧记录</button>
              </div>
              <span v-else-if="selectedRecordingStatus === 'recorded'" class="status-pill recorded">已记录</span>
              <span v-else class="status-pill">待同步</span>
            </section>

            <div v-if="selectedSession" class="calendar-session-summary">
              <strong>Session {{ selectedSession.status === "skipped" ? "已跳过" : "完成情况" }} · 训练计划快照</strong>
              <span>
                快照：{{ selectedSession.snapshot.title }} · {{ formatPercent(selectedSession.completion_fraction) }} ·
                {{ selectedSession.completion_results.length }}/{{ selectedSession.snapshot.completion_items.length }} 项已完成
              </span>
              <p v-if="selectedSession.skip_reason" class="muted">跳过原因：{{ selectedSession.skip_reason }}</p>
              <button v-if="canCorrectSelectedSession" class="secondary" data-action="calendar-correct" type="button" @click="openCorrection">校正记录</button>
            </div>
            <div v-else-if="selectedStatus?.key === 'overdue' && !selectedEntry.recording_intent" class="calendar-session-summary">
              <strong>逾期未开始</strong>
              <span>没有 Session 记录，也不会生成历史训练记录。</span>
            </div>

            <div v-if="showSelectedPrescription && selectedPrescription" class="calendar-prescription">
              <h3>训练处方</h3>
              <p class="muted">{{ selectedPrescription.blocks.length }} 个训练模块 · {{ selectedPrescription.title ?? "" }}</p>
              <article v-for="(block, blockIndex) in selectedPrescription.blocks" :key="`${block.title}-${blockIndex}`" class="prescription-block">
                <h4>{{ block.title }}</h4>
                <div
                  v-for="(exercise, exerciseIndex) in block.exercises"
                  :key="`${blockIndex}-${exerciseIndex}-${exerciseKey(exercise)}`"
                  class="prescription-exercise"
                >
                  <div class="prescription-exercise-head">
                    <strong>{{ exercise.name }}</strong>
                    <span class="prescription-execution">{{ executionModeLabel(exercise) }}</span>
                  </div>
                  <div v-for="(set, setIndex) in exercise.sets" :key="set.set_key ?? set.set_id ?? setIndex" class="prescription-set">
                    <span>第 {{ setIndex + 1 }} 组 · {{ formatTarget(set.target) }}</span>
                    <span>
                      {{ formatResistance(set.resistance ?? canonicalSetResistance(set)) }}<template v-if="formatTempo(set.tempo)"> · 节奏 {{ formatTempo(set.tempo) }}</template><template v-if="set.rest_after_sec != null"> · 休息 {{ set.rest_after_sec }} 秒</template>
                    </span>
                    <small
                      v-if="selectedSession"
                      :class="actualsForSet(selectedSession, blockIndex, exerciseIndex, setIndex).length ? 'actual' : 'unfinished'"
                    >
                      {{ actualsForSet(selectedSession, blockIndex, exerciseIndex, setIndex).length
                        ? `实际：${actualsForSet(selectedSession, blockIndex, exerciseIndex, setIndex).join("，")}`
                        : "未完成" }}
                    </small>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section
            v-if="selectedAerobicSummary"
            class="calendar-aerobic-summary"
            :aria-label="`${selectedEntry.date} 有氧摘要`"
          >
            <div>
              <p class="eyebrow">COROS · AEROBIC SUMMARY</p>
              <h3>有氧摘要</h3>
              <p class="muted">
                {{ selectedAerobicSummary.activity_count }} 次活动 · {{ formatDistance(selectedAerobicSummary.distance_km) }} · {{ aerobicDuration(selectedAerobicSummary.duration_sec) }}
              </p>
            </div>
            <span class="status-pill" :class="selectedAerobicSummary.source_status">{{ aerobicStatusLabel(selectedAerobicSummary.source_status) }}</span>
            <button class="secondary" data-action="open-aerobic-date" :data-date="selectedEntry.date" type="button" @click="showAerobic(selectedEntry.date)">查看有氧记录</button>
          </section>
        </template>
      </template>
    </template>

    <section v-else class="quiet-card">
      <strong>选择一天</strong>
      <p>查看这一天的训练处方和完成情况。</p>
    </section>
  </template>
</template>
