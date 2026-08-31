<script setup lang="ts">
import { computed, reactive } from "vue";

import type { WorkoutAppStore } from "../../core/contracts";
import { canonicalSetResistance } from "./session-model";
import type {
  DisplayCompletionItem,
  ExerciseFeedback,
  ResistanceValue,
  SessionCompletionResult,
  SnapshotExercise,
  TargetValue,
  ExternalCompletion,
  ExternalRecordingSource,
} from "./session-types";
import {
  mutationPendingLabels,
  rpeMeanings,
  type SessionIntent,
  type TodayEntryView,
  useSessionExecution,
} from "./use-session-execution";

const props = defineProps<{ app: WorkoutAppStore }>();
const emit = defineEmits<{
  "execution-focus-change": [focused: boolean];
  "show-aerobic": [date: string];
}>();

const session = useSessionExecution(props.app, (focused) => emit("execution-focus-change", focused));
const view = session.view;
type ExternalCompletionChoice = ExternalRecordingSource | "unfinished";

const externalCompletionChoices: ReadonlyArray<{ value: ExternalCompletionChoice; label: string }> = [
  { value: "unfinished", label: "未完成" },
  { value: "coros", label: "COROS" },
  { value: "apple_watch", label: "Apple Watch" },
  { value: "none", label: "无记录" },
];
const externalChoiceDrafts = reactive<Record<string, ExternalCompletionChoice>>({});

function send(intent: SessionIntent): void {
  void session.dispatch(intent);
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

function mutationMatches(action: string): boolean {
  return view.state.mutation.action === action;
}

function mutationLabel(action: keyof typeof mutationPendingLabels, fallback: string): string {
  return view.state.mutation.pending && mutationMatches(action) ? mutationPendingLabels[action] : fallback;
}

function mutationHint(action: string): string {
  return action === "complete" ? "可以直接重试，未保存的实际值和动作反馈会保留。" : "可以直接重试。";
}

function resultFor(item: DisplayCompletionItem): SessionCompletionResult | null {
  return view.resultForDisplay(view.detail, item);
}

function plannedResistance(item: DisplayCompletionItem): ResistanceValue | null {
  const set = view.itemContext(view.detail, item).set;
  return set?.resistance ?? canonicalSetResistance(set) ?? item.resistance ?? canonicalSetResistance(item);
}

function actualSummary(item: DisplayCompletionItem): string {
  const result = resultFor(item);
  return result?.actual ? `实际：${view.formatActual(result.actual)}` : "未完成";
}

function recordingStatus(entry: TodayEntryView): "recorded" | "needs_link" | "awaiting_sync" {
  return entry.recording_evidence?.status ?? "awaiting_sync";
}

function showAerobicDate(): void {
  const date = String(view.entry?.date ?? view.today?.date ?? "");
  if (date) emit("show-aerobic", date);
}

function occurrenceKey(exercise: SnapshotExercise): string {
  return String(exercise.exercise_occurrence_key ?? exercise.occurrence_key ?? "");
}

const prescriptionExercises = computed<SnapshotExercise[]>(() => (view.entry?.prescription?.blocks ?? []).flatMap((block) => block.exercises ?? []));
const enduranceExercises = computed<SnapshotExercise[]>(() => {
  const detailExercises = (view.detail?.snapshot?.blocks ?? []).flatMap((block) => block.exercises ?? []);
  return (detailExercises.length ? detailExercises : prescriptionExercises.value).filter((exercise) => exercise.category === "endurance");
});
const hasStandardExecution = computed(() => prescriptionExercises.value.some((exercise) => exercise.category !== "endurance"));

function externalCompletion(exercise: SnapshotExercise): ExternalCompletion | null {
  const key = occurrenceKey(exercise);
  return view.detail?.external_completions?.find((completion) => completion.occurrence_key === key) ?? null;
}

function externalChoice(exercise: SnapshotExercise): ExternalCompletionChoice {
  const key = occurrenceKey(exercise);
  return externalChoiceDrafts[key] ?? externalCompletion(exercise)?.recording_source ?? "unfinished";
}

const externalMutationPending = computed(() => view.state.mutation.pending && [
  "complete-external",
  "update-external",
  "undo-external",
].includes(String(view.state.mutation.action)));

const externalMutationError = computed(() => view.state.mutation.error && [
  "complete-external",
  "update-external",
  "undo-external",
].includes(String(view.state.mutation.action)) ? view.state.mutation.error : null);

async function chooseExternalCompletion(exercise: SnapshotExercise, event: Event): Promise<void> {
  if (view.state.mutation.pending) return;
  const key = occurrenceKey(exercise);
  const choice = (event.target as HTMLInputElement).value as ExternalCompletionChoice;
  if (choice === externalChoice(exercise)) return;

  externalChoiceDrafts[key] = choice;
  if (choice === "unfinished") {
    await session.dispatch({ type: "undo-external", occurrenceKey: key });
  } else {
    await session.dispatch({
      type: externalCompletion(exercise) ? "update-external" : "complete-external",
      occurrenceKey: key,
      recordingSource: choice,
    });
  }
  if (externalChoiceDrafts[key] === choice) delete externalChoiceDrafts[key];
}

function enduranceRequirement(target: TargetValue | undefined): string {
  if (!target) return "按计划完成";
  const parts: string[] = [];
  if (target.metric === "duration_sec" && target.value != null) parts.push(`${Math.round(target.value / 60)} 分钟`);
  if (target.distance_km != null) parts.push(`${target.distance_km} 公里`);
  if (target.heart_rate_zone) parts.push(target.heart_rate_zone.min === target.heart_rate_zone.max ? `心率 Z${target.heart_rate_zone.min}` : `心率 Z${target.heart_rate_zone.min}–Z${target.heart_rate_zone.max}`);
  if (target.incline_percent != null) parts.push(`跑步机坡度 ${target.incline_percent}%`);
  if (target.rpe) parts.push(target.rpe.min === target.rpe.max ? `RPE ${target.rpe.min}` : `RPE ${target.rpe.min}–${target.rpe.max}`);
  if (target.effort_cue) parts.push(target.effort_cue);
  return parts.join(" · ") || view.formatTarget(target);
}

const focusPrescription = computed(() => {
  const item = view.focusedItem;
  if (!item) return "";
  const context = view.focusedContext;
  const tempo = view.formatTempo(context.set?.tempo ?? item.tempo);
  return [
    `计划：${view.focusTarget(item.target)}`,
    view.focusResistance(
      context.set?.resistance
        ?? canonicalSetResistance(context.set)
        ?? item.resistance
        ?? canonicalSetResistance(item),
    ),
    tempo ? `节奏 ${tempo}` : null,
    context.set?.target_rir == null ? null : `RIR ${context.set.target_rir}`,
    context.set?.rest_after_sec == null ? null : `休息 ${context.set.rest_after_sec} 秒`,
  ].filter(Boolean).join(" · ");
});

const timedStatus = computed(() => {
  if (view.state.timerPaused) {
    if (view.state.timerPauseReason === "visibility") return "页面已离开前台 · 计时已暂停 · 回到前台后点击顶部继续";
    if (view.state.timerPauseReason === "wake-lock") return "屏幕保持已中断 · 计时已暂停 · 点击顶部继续";
    return "已暂停 · 点击顶部继续";
  }
  if (view.timedAction.phase === "preparing") return "准备中 · 5 秒后开始";
  if (view.timedAction.phase === "active") return "动作进行中";
  if (view.timedAction.phase === "complete") return "时间到 · 修改实际值后点击完成";
  return "固定目标 · 点击开始动作";
});

const timerMutationPending = computed(() => view.state.pausePending || (
  view.state.mutation.pending
  && (view.state.mutation.action === "pause" || view.state.mutation.action === "resume")
));

const timerToggleLabel = computed(() => {
  if (view.state.pausePending) return mutationPendingLabels.pause;
  if (timerMutationPending.value && view.state.mutation.action) return mutationPendingLabels[view.state.mutation.action];
  if (view.state.timerPaused && view.state.mutation.action === "pause" && view.state.mutation.error) return "重试暂停";
  return view.state.timerPaused ? "继续" : "暂停";
});

type KeyedSnapshotExercise = SnapshotExercise & { exercise_occurrence_key: string };

const allExercises = computed<KeyedSnapshotExercise[]>(() => (view.detail?.snapshot?.blocks ?? [])
  .flatMap((block) => block.exercises ?? [])
  .flatMap((exercise) => {
    const exerciseOccurrenceKey = exercise.exercise_occurrence_key ?? exercise.occurrence_key;
    return exerciseOccurrenceKey ? [{ ...exercise, exercise_occurrence_key: exerciseOccurrenceKey }] : [];
  }));
const unfinishedItems = computed<DisplayCompletionItem[]>(() => view.items.filter(
  (item) => !view.displayItemDone(view.detail, item),
));
const endPercent = computed(() => view.items.length ? Math.round((view.completedCount / view.items.length) * 100) : 0);
const overviewCompletionFraction = computed(() => Number(
  view.detail?.completion_fraction ?? view.summary?.completion_fraction ?? 0,
));

const ensurePaused = session.ensurePaused;
const executionFocused = session.executionFocused;
defineExpose({ ensurePaused, executionFocused });
</script>

<template>
  <div v-if="view.state.navigationPauseError" class="mutation-feedback is-error" role="alert">
    <strong>{{ view.state.navigationPauseError }}</strong><span>当前页面会保留；确认暂停后再离开。</span>
  </div>
  <section v-if="!view.entry || view.entry.kind === 'no_plan'" class="today-page">
    <div class="today-content">
      <p class="eyebrow">{{ view.today?.date || "今天" }}</p>
      <h1>今天没有计划</h1>
      <p class="muted">可以在设置中提交未来训练计划。</p>
    </div>
  </section>

  <section v-else-if="view.entry.kind === 'rest'" class="today-page">
    <div class="today-content">
      <p class="eyebrow">{{ view.today?.date || "今天" }}</p>
      <span class="status-dot rest" />
      <h1>休息日</h1>
      <p class="muted">今天不安排训练。</p>
      <div class="quiet-card">今天把恢复留给自己。</div>
    </div>
  </section>

  <section v-else-if="!view.summary && view.entry.recording_intent && !enduranceExercises.length" class="today-page">
    <div class="today-content">
      <p class="eyebrow">{{ view.today?.date || "今天" }}</p>
      <h1>{{ view.entry.title }}</h1>
      <p class="muted">约 {{ view.entry.estimated_duration_min }} 分钟</p>
      <section
        v-if="recordingStatus(view.entry) === 'recorded'"
        class="calendar-recording-guide is-recorded"
        aria-label="COROS 路线记录状态"
      >
        <strong>COROS 记录</strong><span class="status-pill recorded">已记录</span>
      </section>
      <section
        v-else-if="recordingStatus(view.entry) === 'needs_link'"
        class="calendar-recording-guide needs-link"
        aria-label="COROS 路线记录状态"
      >
        <strong>COROS 记录</strong>
        <div class="calendar-recording-actions">
          <span class="status-pill partial">待关联</span>
          <button
            v-if="Number(view.entry.aerobic_summary?.activity_count) > 0"
            class="secondary"
            data-action="open-aerobic-date"
            :data-date="view.entry.date || view.today?.date"
            @click="showAerobicDate"
          >查看有氧记录</button>
        </div>
      </section>
      <section v-else class="calendar-recording-guide" aria-label="COROS 路线记录状态">
        <strong>COROS 记录</strong><span class="status-pill">待同步</span>
      </section>
    </div>
  </section>

  <section
    v-else-if="!view.summary || (view.state.mode === 'overview' && view.detail && (view.detail.external_completions?.length || 0) > 0 && (view.detail.completion_results?.length || 0) === 0 && (view.detail.training_intervals?.length || 0) === 0)"
    class="today-page"
  >
    <div class="today-content">
      <p class="eyebrow">{{ view.today?.date || "今天" }}</p>
      <h1>{{ view.entry.title }}</h1>
      <p class="muted">约 {{ view.entry.estimated_duration_min }} 分钟</p>
      <div v-if="!view.summary" class="hero-actions">
        <button
          v-if="hasStandardExecution"
          class="primary"
          data-action="start"
          :disabled="view.state.mutation.pending"
          :aria-disabled="view.state.mutation.pending || undefined"
          :aria-busy="mutationMatches('start') && view.state.mutation.pending || undefined"
          @click="send({ type: 'start' })"
        >{{ mutationLabel("start", "开始训练") }}</button>
        <button class="secondary" data-action="skip" @click="send({ type: 'skip' })">跳过今天</button>
      </div>
      <div v-else-if="view.summary.status === 'partial' && hasStandardExecution" class="hero-actions">
        <button class="primary" data-action="continue" :disabled="view.state.mutation.pending" @click="send({ type: 'continue' })">{{ mutationLabel("continue", "继续训练") }}</button>
      </div>
      <div
        v-if="mutationMatches('start') && view.state.mutation.pending"
        class="mutation-feedback is-pending"
        role="status"
        aria-live="polite"
      ><span class="mutation-indicator" aria-hidden="true" /><span>{{ mutationPendingLabels.start }}</span></div>
      <div v-else-if="mutationMatches('start') && view.state.mutation.error" class="mutation-feedback is-error" role="alert">
        <strong>{{ view.state.mutation.error }}</strong><span>{{ mutationHint("start") }}</span>
      </div>
      <div v-else-if="mutationMatches('continue') && view.state.mutation.pending" class="mutation-feedback is-pending" role="status" aria-live="polite"><span class="mutation-indicator" aria-hidden="true" /><span>{{ mutationPendingLabels.continue }}</span></div>
      <div v-else-if="mutationMatches('continue') && view.state.mutation.error" class="mutation-feedback is-error" role="alert"><strong>{{ view.state.mutation.error }}</strong><span>{{ mutationHint("continue") }}</span></div>
      <section class="today-plan calendar-prescription" aria-label="今日训练计划">
        <div class="today-plan-head"><h2>今日训练计划</h2><span>{{ view.entry.module_count }} 个模块</span></div>
        <template v-if="view.entry.prescription">
          <p class="muted">{{ view.entry.prescription.blocks?.length || 0 }} 个训练模块 · {{ view.entry.prescription.title || "" }}</p>
          <article v-for="block in view.entry.prescription.blocks || []" :key="block.title" class="prescription-block">
            <h4>{{ block.title }}</h4>
            <div v-for="exercise in block.exercises || []" :key="exercise.occurrence_key || exercise.exercise_occurrence_key" class="prescription-exercise">
              <div class="prescription-exercise-head">
                <strong>{{ exercise.name }}</strong><span class="prescription-execution">{{ view.exerciseExecutionModeLabel(exercise) }}</span>
              </div>
              <div v-for="(set, index) in exercise.sets || []" :key="set.set_id || set.set_key || index" class="prescription-set">
                <span>{{ exercise.category === "endurance" ? enduranceRequirement(set.target) : `第 ${Number(index) + 1} 组 · ${view.formatTarget(set.target)}` }}</span>
                <span v-if="exercise.category !== 'endurance'">{{ view.formatResistance(set.resistance ?? canonicalSetResistance(set)) }}<template v-if="view.formatTempo(set.tempo)"> · 节奏 {{ view.formatTempo(set.tempo) }}</template><template v-if="set.rest_after_sec != null"> · 休息 {{ set.rest_after_sec }} 秒</template></span>
              </div>
              <template v-if="exercise.category === 'endurance'">
                <div v-if="view.entry.recording_intent" class="calendar-recording-guide endurance-recording-guide">
                  <strong>COROS 路线证据</strong><span class="status-pill" :class="recordingStatus(view.entry) === 'recorded' ? 'recorded' : recordingStatus(view.entry) === 'needs_link' ? 'partial' : ''">{{ recordingStatus(view.entry) === "recorded" ? "已记录" : recordingStatus(view.entry) === "needs_link" ? "待关联" : "待同步" }}</span>
                </div>
                <fieldset
                  class="endurance-completion"
                  :disabled="externalMutationPending"
                  :aria-busy="externalMutationPending || undefined"
                >
                  <legend>完成状态</legend>
                  <span v-if="externalMutationPending" class="endurance-completion-saving" role="status" aria-live="polite">保存中…</span>
                  <div class="endurance-choice-grid">
                    <label
                      v-for="option in externalCompletionChoices"
                      :key="option.value"
                      class="endurance-choice"
                      :class="{ 'is-selected': externalChoice(exercise) === option.value }"
                    >
                      <input
                        type="radio"
                        :name="`endurance-completion-${occurrenceKey(exercise)}`"
                        :value="option.value"
                        :checked="externalChoice(exercise) === option.value"
                        :data-external-choice="option.value"
                        @change="chooseExternalCompletion(exercise, $event)"
                      />
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                </fieldset>
                <p v-if="externalChoice(exercise) === 'apple_watch'" class="endurance-source-note">仅记录完成来源；Apple Watch 数据未导入。</p>
                <div v-if="externalMutationError" class="mutation-feedback is-error endurance-completion-error" role="alert"><strong>{{ externalMutationError }}</strong><span>已恢复原状态，可以直接重试。</span></div>
              </template>
            </div>
          </article>
        </template>
        <p v-else class="muted">今天的训练计划暂时无法读取。</p>
      </section>
    </div>
  </section>

  <section v-else-if="view.state.detailLoading && !view.detail" class="loading">
    <span class="spinner" /><p>正在读取训练状态…</p>
  </section>

  <template v-else-if="!view.detail && view.summary">
    <section v-if="view.summary.status === 'skipped'" class="hero">
      <span class="status-pill skipped">已跳过</span><h1>{{ view.entry.title }}</h1>
      <p class="muted">跳过保留在今天的记录中。你仍可以在今天重新开始。</p>
      <button class="primary" data-action="restart" :disabled="view.state.mutation.pending" @click="send({ type: 'restart' })">{{ mutationLabel("restart", "重新开始训练") }}</button>
      <div v-if="mutationMatches('restart') && view.state.mutation.pending" class="mutation-feedback is-pending" role="status" aria-live="polite"><span class="mutation-indicator" aria-hidden="true" /><span>{{ mutationPendingLabels.restart }}</span></div>
      <div v-else-if="mutationMatches('restart') && view.state.mutation.error" class="mutation-feedback is-error" role="alert"><strong>{{ view.state.mutation.error }}</strong><span>{{ mutationHint("restart") }}</span></div>
    </section>
    <section v-else class="today-page">
      <div class="today-content">
        <p class="eyebrow">{{ view.today?.date || "今天" }}</p><h1>{{ view.entry.title }}</h1>
        <section class="today-progress-card">
          <div class="today-progress-head"><strong>训练进度</strong><span>{{ view.percentage(view.summary.completion_fraction) }}</span></div>
          <progress
            class="progress-line"
            :value="Number(view.summary.completion_fraction ?? 0)"
            max="1"
            aria-label="训练完成进度"
          >{{ view.percentage(view.summary.completion_fraction) }}</progress>
          <p class="muted">训练详情暂时无法读取，仍可继续或重新读取。</p>
        </section>
        <button v-if="view.summary.status === 'in_progress'" class="primary wide" data-action="open-session" @click="send({ type: 'open-session' })">继续训练</button>
        <button v-else-if="view.summary.status === 'partial'" class="primary wide" data-action="continue" :disabled="view.state.mutation.pending" @click="send({ type: 'continue' })">{{ mutationLabel("continue", "继续训练") }}</button>
        <button v-else class="secondary wide" data-action="open-session" @click="send({ type: 'open-session' })">查看训练记录</button>
      </div>
    </section>
  </template>

  <template v-else-if="view.detail">
    <template v-if="view.state.mode === 'correction'">
      <template v-if="view.detail.status === 'skipped'">
        <section class="page-head">
          <p class="eyebrow">CORRECTION</p><h1>校正记录</h1>
          <p class="muted">{{ view.entry.title }} · 训练日期和跳过状态保持不变。</p>
        </section>
        <section class="list-card">
          <label>跳过原因<input
            id="correction-skip-reason"
            maxlength="500"
            :value="view.state.correctionDraft.skipReason"
            @input="send({ type: 'draft-correction-skip-reason', value: inputValue($event) })"
          /></label>
          <label>训练备注<textarea
            id="correction-note"
            maxlength="5000"
            :value="view.state.correctionDraft.note"
            @input="send({ type: 'draft-correction-note', value: inputValue($event) })"
          /></label>
        </section>
      </template>
      <template v-else>
        <section class="page-head">
          <p class="eyebrow">CORRECTION</p><h1>校正记录</h1>
          <p class="muted">{{ view.entry.title }} · 训练日期保持不变。留空的项目会被视为未完成。</p>
        </section>
        <section class="list-card">
        <label v-for="(item, index) in view.items" :key="item.completion_item_key">
            {{ index + 1 }}. {{ view.itemLabel(view.detail, item) }}
            <input
              :id="`correction-value-${item.completion_item_key}`"
              type="number"
              min="1"
              :value="view.state.correctionDraft.items[item.completion_item_key]?.value || ''"
              placeholder="实际值"
              @input="send({ type: 'draft-correction-item', key: item.completion_item_key, field: 'value', value: inputValue($event) })"
            />
            <input
              v-if="view.editableResistance(item)"
              :id="`correction-weight-${item.completion_item_key}`"
              type="number"
              min="0"
              step="0.1"
              :value="view.state.correctionDraft.items[item.completion_item_key]?.weight || ''"
              placeholder="实际重量（kg，可留空）"
              @input="send({ type: 'draft-correction-item', key: item.completion_item_key, field: 'weight', value: inputValue($event) })"
            />
            <input
              :id="`correction-rir-${item.completion_item_key}`"
              type="number"
              min="0"
              max="10"
              :value="view.state.correctionDraft.items[item.completion_item_key]?.rir || ''"
              placeholder="RIR（可留空）"
              @input="send({ type: 'draft-correction-item', key: item.completion_item_key, field: 'rir', value: inputValue($event) })"
            />
          </label>
        </section>
        <section class="quiet-card">
          <label>训练 RPE<input
            id="correction-rpe"
            type="number"
            min="0"
            max="10"
            :value="view.state.correctionDraft.rpe"
            @input="send({ type: 'draft-correction-rpe', value: inputValue($event) })"
          /></label>
          <label>训练备注<textarea
            id="correction-note"
            maxlength="5000"
            :value="view.state.correctionDraft.note"
            @input="send({ type: 'draft-correction-note', value: inputValue($event) })"
          /></label>
          <label>动作反馈</label>
          <input
            v-for="exercise in allExercises"
            :id="`correction-feedback-${exercise.exercise_occurrence_key}`"
            :key="exercise.exercise_occurrence_key"
            :value="view.state.correctionDraft.feedback[exercise.exercise_occurrence_key] || ''"
            :placeholder="`${exercise.name}（可留空）`"
            @input="send({ type: 'draft-correction-feedback', key: exercise.exercise_occurrence_key, value: inputValue($event) })"
          />
        </section>
      </template>
      <div class="sheet-actions">
        <button class="secondary" data-action="cancel-correction" @click="send({ type: 'cancel-correction' })">取消</button>
        <button class="primary" data-action="save-correction" :disabled="view.state.correctionSaving" @click="send({ type: 'save-correction' })">{{ view.state.correctionSaving ? "保存中…" : "保存校正" }}</button>
      </div>
      <div v-if="view.state.correctionError" class="mutation-feedback is-error" role="alert"><strong>{{ view.state.correctionError }}</strong><span>输入已保留，可以直接重试。</span></div>
    </template>

    <template v-else-if="view.state.mode === 'execution' && view.detail.status === 'in_progress'">
      <header class="session-header">
        <button class="session-header-side" data-action="minimize" aria-label="返回今日" @click="send({ type: 'minimize' })">‹</button>
        <strong>{{ view.restActive ? "组间休息" : view.elapsedLabel }}</strong>
        <div class="session-header-actions">
          <button
            class="session-mute-toggle"
            data-action="toggle-mute"
            :aria-pressed="view.state.muted"
            :aria-label="view.state.muted ? '开启提示音' : '静音提示音'"
            @click="send({ type: 'toggle-mute' })"
          >{{ view.state.muted ? "开启声音" : "静音" }}</button>
          <button
            class="session-timer-toggle"
            data-action="toggle-timer"
            :aria-pressed="view.state.timerPaused"
            :disabled="timerMutationPending"
            :aria-disabled="timerMutationPending || undefined"
            :aria-busy="timerMutationPending || undefined"
            @click="send({ type: 'toggle-timer' })"
          >{{ timerToggleLabel }}</button>
        </div>
      </header>

      <div
        v-if="timerMutationPending"
        class="mutation-feedback is-pending"
        role="status"
        aria-live="polite"
      ><span class="mutation-indicator" aria-hidden="true" /><span>{{ view.state.pausePending ? mutationPendingLabels.pause : view.state.mutation.action ? mutationPendingLabels[view.state.mutation.action] : "" }}</span></div>
      <div
        v-else-if="(mutationMatches('pause') || mutationMatches('resume')) && view.state.mutation.error"
        class="mutation-feedback is-error"
        role="alert"
      ><strong>{{ view.state.mutation.error }}</strong><span>可以直接重试。</span></div>

      <section class="session-progress">
        <button class="session-progress-toggle" data-action="toggle-progress" :aria-expanded="view.state.progressOpen" @click="send({ type: 'toggle-progress' })">
          <span><strong>{{ view.completedCount }} / {{ view.items.length }} 完成</strong><progress
            class="progress-line"
            :value="view.completionFraction"
            max="1"
            aria-label="训练完成进度"
          >{{ view.percentage(view.completionFraction) }}</progress></span>
          <span class="progress-chevron">{{ view.state.progressOpen ? "⌃" : "⌄" }}</span>
        </button>
        <div v-if="view.state.progressOpen" class="progress-list focus-progress">
          <button
            v-for="(candidate, index) in view.items"
            :key="candidate.completion_item_key"
            class="list-row"
            :class="{ active: index === view.state.focusIndex }"
            data-action="jump-item"
            :data-index="index"
            @click="send({ type: 'jump', index })"
          ><span>{{ index + 1 }}. {{ view.itemLabel(view.detail, candidate) }}</span><span>{{ view.displayItemDone(view.detail, candidate) ? "✓" : "○" }}</span></button>
        </div>
      </section>

      <div v-if="view.wakeNotice" class="notice session-wake-notice" :class="view.wakeNotice.className" role="status" aria-live="polite">
        <strong>{{ view.wakeNotice.title }}</strong><span>{{ view.wakeNotice.detail }}</span>
      </div>
      <div v-if="view.audioFailed" class="notice timed-audio-notice" role="alert">
        <strong>声音未开启</strong><span>提示音播放失败，计时仍可继续。请检查 iPhone 的音量和静音开关后，再点击开始动作重试。</span>
      </div>

      <section v-if="view.restActive && view.restNextItem" class="rest-screen">
        <span class="rest-label">组间休息</span><h2>放松，准备下一项</h2>
        <div class="rest-time" data-rest-remaining aria-live="polite" aria-label="休息剩余时间">{{ view.restRemainingLabel }}</div>
        <div class="next-context">
          <span>接下来</span><strong>{{ view.itemLabel(view.detail, view.restNextItem) }}</strong><small>{{ view.focusTarget(view.restNextItem.target) }}</small>
        </div>
        <button class="secondary" data-action="skip-rest" @click="send({ type: 'skip-rest' })">跳过休息</button>
      </section>

      <div v-else-if="view.focusedItem" class="focus-workout-scroll">
        <section class="focus-stage">
          <span class="focus-count">{{ view.state.focusIndex + 1 }} / {{ view.items.length }} · {{ view.focusedContext.block?.title || (view.focusedItem.target.metric === "reps" ? "力量" : "训练") }}</span>
          <div class="focus-exercise-head">
            <h2>{{ view.itemLabel(view.detail, view.focusedItem) }}</h2>
            <span class="focus-execution-mode">{{ view.exerciseExecutionModeLabel(view.focusedContext.exercise) }}</span>
          </div>
          <p class="focus-prescription">{{ focusPrescription }}</p>

          <section v-if="view.timedTarget != null" class="timed-execution" aria-label="固定时长动作">
            <div class="timed-execution-heading"><span class="timed-execution-label">固定时长</span><span>{{ view.timedTarget }} 秒</span></div>
            <div class="timed-action-state" role="status" aria-live="polite">{{ timedStatus }}</div>
            <div class="timed-remaining" data-action-remaining aria-live="polite" aria-label="动作剩余时间">{{ view.actionRemainingLabel }}</div>
            <button
              class="primary wide timed-start"
              data-action="start-timed"
              :disabled="view.timedAction.phase !== 'idle' || view.state.timerPaused"
              :aria-disabled="view.timedAction.phase !== 'idle' || view.state.timerPaused || undefined"
              @click="send({ type: 'start-timed' })"
            >{{ view.timedAction.phase === "complete" ? "动作已结束" : view.timedAction.phase === "preparing" || view.timedAction.phase === "active" ? "计时进行中" : "开始动作" }}</button>
            <div class="timed-actual-fields">
              <label>实际时长（秒）<input
                id="actual-value"
                :data-completion-key="view.focusedItem.completion_item_key"
                type="number"
                min="1"
                :value="view.focusActualDraft"
                placeholder="归零后自动填入"
                :disabled="view.timedAction.phase !== 'complete' || mutationMatches('complete') && view.state.mutation.pending"
                @input="send({ type: 'draft-actual', key: view.focusedItem.completion_item_key, value: inputValue($event) })"
              /></label>
              <label v-if="view.focusedContext.set?.target_rir != null || view.focusedResult?.rir != null">RIR<input
                id="actual-rir"
                :data-completion-key="view.focusedItem.completion_item_key"
                type="number"
                min="0"
                max="10"
                :value="view.focusRirDraft"
                :disabled="view.timedAction.phase !== 'complete' || mutationMatches('complete') && view.state.mutation.pending"
                @input="send({ type: 'draft-rir', key: view.focusedItem.completion_item_key, value: inputValue($event) })"
              /></label>
            </div>
          </section>

          <div class="actual-panel">
            <div class="actual-row"><span>{{ view.focusedItem.target.metric === "reps" ? "次数" : "时长" }}</span><strong>{{ view.focusTarget(view.focusedItem.target) }}<template v-if="view.focusedResult?.actual"> / <em>{{ view.formatActual(view.focusedResult.actual) }}</em></template></strong></div>
            <div v-if="view.focusedContext.set?.resistance || view.focusedContext.set?.resistance_mode" class="actual-row"><span>重量</span><strong>{{ view.focusResistance(plannedResistance(view.focusedItem)) }}</strong></div>
            <div v-if="view.focusedContext.set?.target_rir != null || view.focusedResult?.rir != null" class="actual-row"><span>RIR</span><strong><em v-if="view.focusedResult?.rir != null">{{ view.focusedResult.rir }}</em><template v-else>{{ view.focusedContext.set?.target_rir ?? "—" }}</template></strong></div>
          </div>
          <div class="feedback-area">
            <textarea
              :id="`feedback-${view.focusedItem.exercise_occurrence_key}`"
              class="focus-feedback-input"
              :data-exercise-key="view.focusedItem.exercise_occurrence_key"
              maxlength="500"
              placeholder="记录感受"
              :value="view.focusFeedbackDraft"
              @input="send({ type: 'draft-feedback', key: view.focusedItem.exercise_occurrence_key, value: inputValue($event) })"
            />
          </div>
          <div class="focus-actions">
            <button
              class="primary wide"
              data-action="complete"
              :disabled="view.completeBlocked"
              :aria-disabled="mutationMatches('complete') && view.state.mutation.pending || undefined"
              :aria-busy="mutationMatches('complete') && view.state.mutation.pending || undefined"
              @click="send({ type: 'complete' })"
            >{{ view.focusedDone ? "已完成" : mutationLabel("complete", "完成") }}</button>
            <div class="focus-secondary" :class="{ 'is-timed': view.timedTarget != null }">
              <button class="secondary" data-action="previous" :disabled="view.state.focusIndex === 0" @click="send({ type: 'previous' })">上一项</button>
              <button v-if="view.timedTarget == null" class="secondary" data-action="toggle-adjust" @click="send({ type: 'toggle-adjust' })">{{ view.state.adjust ? "收起调整" : "调整" }}</button>
              <button class="secondary" data-action="next" :disabled="view.state.focusIndex >= view.items.length - 1" @click="send({ type: 'next' })">下一项</button>
            </div>
            <div v-if="view.timedTarget == null && view.state.adjust" class="adjust-panel">
              <label>实际 {{ view.focusedItem.target.metric === "reps" ? "次数" : "秒数" }}<input
                id="actual-value"
                :data-completion-key="view.focusedItem.completion_item_key"
                type="number"
                min="1"
                :value="view.focusActualDraft"
                @input="send({ type: 'draft-actual', key: view.focusedItem.completion_item_key, value: inputValue($event) })"
              /></label>
              <label v-if="view.editableResistance(view.focusedItem)">实际重量（kg）<input
                id="actual-weight"
                :data-completion-key="view.focusedItem.completion_item_key"
                type="number"
                min="0"
                step="0.1"
                :value="view.focusResistanceDraft"
                @input="send({ type: 'draft-weight', key: view.focusedItem.completion_item_key, value: inputValue($event) })"
              /></label>
              <label>RIR<input
                id="actual-rir"
                :data-completion-key="view.focusedItem.completion_item_key"
                type="number"
                min="0"
                max="10"
                :value="view.focusRirDraft"
                @input="send({ type: 'draft-rir', key: view.focusedItem.completion_item_key, value: inputValue($event) })"
              /></label>
              <button class="primary wide" data-action="save-adjust" :disabled="view.completeBlocked" @click="send({ type: 'complete' })">{{ mutationLabel("complete", "保存并完成") }}</button>
            </div>
            <div v-if="mutationMatches('complete') && view.state.mutation.pending" class="mutation-feedback is-pending" role="status" aria-live="polite">
              <span class="mutation-indicator" aria-hidden="true" /><span>{{ mutationPendingLabels.complete }}</span>
            </div>
            <div v-else-if="mutationMatches('complete') && view.state.mutation.error" class="mutation-feedback is-error" role="alert">
              <strong>{{ view.state.mutation.error }}</strong><span>{{ mutationHint("complete") }}</span>
            </div>
          </div>
        </section>
      </div>

      <footer class="session-footer">
        <strong>{{ view.restActive ? "组间休息" : view.elapsedLabel }}</strong>
        <button class="secondary" data-action="end" @click="send({ type: 'end' })">结束训练</button>
      </footer>

      <div v-if="view.state.endSheet" class="modal-backdrop" data-action="cancel-end" @click.self="send({ type: 'cancel-end' })">
        <section class="bottom-sheet end-sheet">
          <div class="sheet-handle" />
          <div class="end-sheet-body">
            <h2>结束训练</h2>
            <p class="muted">{{ unfinishedItems.length ? `还有 ${unfinishedItems.length} 项未完成，保存后会记为部分完成。` : "所有项目都已记录，可以完成训练。" }}</p>
            <section class="end-result">
              <span>{{ unfinishedItems.length ? "部分完成" : "已完成" }}</span><strong>{{ view.completedCount }} / {{ view.items.length }}</strong><small>已完成 · {{ endPercent }}%</small>
              <progress
                class="progress-line"
                :value="endPercent"
                max="100"
                aria-label="训练完成进度"
              >{{ endPercent }}%</progress>
            </section>
            <section v-if="unfinishedItems.length" class="end-unfinished">
              <h3>未完成项目</h3><ul><li v-for="(item, index) in unfinishedItems" :key="item.completion_item_key"><span>{{ index + 1 }}</span><strong>{{ view.itemLabel(view.detail, item) }}</strong></li></ul>
            </section>
            <section class="end-form-section">
              <div class="end-form-heading"><h3>训练 RPE</h3><span>整体感受</span></div>
              <div class="rpe-scale">
                <button
                  v-for="(meaning, value) in rpeMeanings"
                  :key="meaning.title"
                  class="rpe-button"
                  :class="{ 'is-selected': view.state.endRpe === value }"
                  type="button"
                  data-action="set-end-rpe"
                  :data-rpe="value"
                  :aria-label="`RPE ${value}，${meaning.title}`"
                  :aria-pressed="view.state.endRpe === value"
                  :disabled="view.state.endSaving || view.state.endReconciliationRequired"
                  @click="send({ type: 'set-end-rpe', value })"
                >{{ value }}</button>
              </div>
              <div class="rpe-meaning" role="status" aria-live="polite"><strong>{{ view.state.endRpe }} · {{ rpeMeanings[view.state.endRpe].title }}</strong><span>{{ rpeMeanings[view.state.endRpe].detail }}</span></div>
            </section>
            <section class="end-form-section">
              <label for="end-note">训练备注 <span class="muted">可选</span></label>
              <textarea id="end-note" class="end-note" maxlength="5000" placeholder="记录训练上下文（可留空）" :value="view.state.endNote" :disabled="view.state.endSaving || view.state.endReconciliationRequired" @input="send({ type: 'draft-end-note', value: inputValue($event) })" />
            </section>
            <section class="end-form-section end-feedback">
              <h3>动作反馈</h3>
              <label v-for="exercise in allExercises" :key="exercise.exercise_occurrence_key">{{ exercise.name }}<input
                :data-end-feedback="exercise.exercise_occurrence_key"
                maxlength="1000"
                :value="view.state.endFeedback[exercise.exercise_occurrence_key] || ''"
                placeholder="记录感受（可留空）"
                :disabled="view.state.endSaving || view.state.endReconciliationRequired"
                @input="send({ type: 'draft-end-feedback', key: exercise.exercise_occurrence_key, value: inputValue($event) })"
              /></label>
            </section>
          </div>
          <div class="end-sheet-actions">
            <button class="secondary" data-action="cancel-end" :disabled="view.state.endSaving || view.state.endReconciliationRequired" @click="send({ type: 'cancel-end' })">返回训练</button>
            <button class="primary" data-action="save-end" :disabled="view.state.endPausePending || view.state.endSaving" @click="send({ type: 'save-end' })">{{ view.state.endPausePending ? "正在暂停…" : view.state.endSaving ? "正在保存…" : view.state.endReconciliationRequired ? "确认上次提交" : "结束并保存" }}</button>
          </div>
          <div v-if="view.state.endError" class="mutation-feedback is-error" role="alert"><strong>{{ view.state.endError }}</strong><span>{{ view.state.endReconciliationRequired ? "将重放同一提交；不会接受新的表单修改。" : "输入已保留，可以直接重试。" }}</span></div>
        </section>
      </div>
    </template>

    <section v-else-if="view.detail.status === 'skipped'" class="hero">
      <span class="status-pill skipped">已跳过</span><h1>{{ view.entry.title }}</h1>
      <p class="muted">跳过保留在今天的记录中。你仍可以在今天重新开始。</p>
      <button class="primary" data-action="restart" :disabled="view.state.mutation.pending" @click="send({ type: 'restart' })">{{ mutationLabel("restart", "重新开始训练") }}</button>
      <div v-if="mutationMatches('restart') && view.state.mutation.pending" class="mutation-feedback is-pending" role="status" aria-live="polite"><span class="mutation-indicator" aria-hidden="true" /><span>{{ mutationPendingLabels.restart }}</span></div>
      <div v-else-if="mutationMatches('restart') && view.state.mutation.error" class="mutation-feedback is-error" role="alert"><strong>{{ view.state.mutation.error }}</strong><span>{{ mutationHint("restart") }}</span></div>
    </section>

    <section v-else-if="view.detail.status === 'completed' || view.detail.status === 'partial'" class="session-summary-page">
      <section class="session-summary-hero">
        <span class="status-pill" :class="view.detail.status">{{ view.detail.status === "completed" ? "已完成" : "部分完成" }}</span>
        <h1>{{ view.entry.title }}</h1><div class="metric-large">{{ view.percentage(view.detail.completion_fraction) }}</div>
        <p class="muted">训练时长 {{ view.detail.training_duration_sec }} 秒<template v-if="view.detail.session_rpe != null"> · RPE {{ view.detail.session_rpe }}</template></p>
      </section>
      <section class="session-summary-card">
        <div class="session-summary-heading"><h2>训练项目</h2><span>{{ view.completedCount }} / {{ view.items.length }} 项完成</span></div>
        <div
          v-for="(item, index) in view.items"
          :key="item.completion_item_key"
          class="session-item-row"
          :class="view.displayItemDone(view.detail, item) ? 'is-complete' : 'is-unfinished'"
        >
          <span class="session-item-index">{{ view.displayItemDone(view.detail, item) ? "✓" : index + 1 }}</span>
          <div class="session-item-main"><strong>{{ view.itemLabel(view.detail, item) }}</strong><small>计划：{{ view.focusTarget(item.target) }} · {{ actualSummary(item) }}<template v-if="resultFor(item)?.rir != null"> · RIR {{ resultFor(item)?.rir }}</template></small></div>
          <span class="session-item-status">{{ view.displayItemDone(view.detail, item) ? "已完成" : "未完成" }}</span>
        </div>
      </section>
      <section v-if="(view.detail.exercise_feedback || []).some((item: ExerciseFeedback) => item.text)" class="session-summary-feedback">
        <h2>动作反馈</h2><p v-for="feedback in (view.detail.exercise_feedback || []).filter((item: ExerciseFeedback) => item.text)" :key="feedback.exercise_occurrence_key"><strong>{{ allExercises.find((exercise) => exercise.exercise_occurrence_key === feedback.exercise_occurrence_key)?.name || "训练项目" }}</strong>{{ feedback.text }}</p>
      </section>
      <div class="hero-actions">
        <button v-if="view.detail.status === 'partial'" class="primary" data-action="continue" :disabled="view.state.mutation.pending" @click="send({ type: 'continue' })">{{ mutationLabel("continue", "继续训练") }}</button>
        <button class="secondary" data-action="edit-session" @click="send({ type: 'edit-session' })">校正记录</button>
      </div>
      <div v-if="mutationMatches('continue') && view.state.mutation.pending" class="mutation-feedback is-pending" role="status" aria-live="polite"><span class="mutation-indicator" aria-hidden="true" /><span>{{ mutationPendingLabels.continue }}</span></div>
      <div v-else-if="mutationMatches('continue') && view.state.mutation.error" class="mutation-feedback is-error" role="alert"><strong>{{ view.state.mutation.error }}</strong><span>{{ mutationHint("continue") }}</span></div>
    </section>

    <section v-else class="today-page">
      <div class="today-content">
        <p class="eyebrow">{{ view.today?.date || "今天" }}</p><h1>{{ view.entry.title }}</h1>
        <section class="today-progress-card">
          <div class="today-progress-head"><strong>{{ view.completedCount }} / {{ view.items.length || 0 }} 项完成</strong><span>{{ view.percentage(overviewCompletionFraction) }}</span></div>
          <progress
            class="progress-line"
            :value="overviewCompletionFraction"
            max="1"
            aria-label="训练完成进度"
          >{{ view.percentage(overviewCompletionFraction) }}</progress>
          <template v-if="view.items.length">
            <div
              v-for="(item, index) in view.items"
              :key="item.completion_item_key"
              class="today-item-row"
              :class="view.displayItemDone(view.detail, item) ? 'is-complete' : 'is-unfinished'"
            >
              <span class="today-item-index">{{ view.displayItemDone(view.detail, item) ? "✓" : index + 1 }}</span>
              <span class="today-item-main"><strong>{{ view.itemLabel(view.detail, item) }}</strong><small>计划：{{ view.focusTarget(item.target) }}<template v-if="view.focusResistance(plannedResistance(item))"> · {{ view.focusResistance(plannedResistance(item)) }}</template> · {{ actualSummary(item) }}<template v-if="resultFor(item)?.rir != null"> · RIR {{ resultFor(item)?.rir }}</template></small></span>
              <span class="today-item-status">{{ view.displayItemDone(view.detail, item) ? "已完成" : "未完成" }}</span>
            </div>
          </template>
          <p v-else class="muted">训练记录已保存。</p>
        </section>
        <button
          v-if="view.summary.status === 'in_progress'"
          class="primary wide"
          data-action="open-session"
          @click="send({ type: 'open-session' })"
        >继续训练</button>
        <button
          v-else-if="view.summary.status === 'partial'"
          class="primary wide"
          data-action="continue"
          :disabled="view.state.mutation.pending"
          @click="send({ type: 'continue' })"
        >{{ mutationLabel("continue", "继续训练") }}</button>
        <button v-else class="secondary wide" data-action="open-session" @click="send({ type: 'open-session' })">查看训练记录</button>
        <button v-if="view.summary.status === 'completed' || view.summary.status === 'partial'" class="text-button wide" data-action="edit-session" @click="send({ type: 'edit-session' })">校正记录</button>
      </div>
    </section>
  </template>

  <section v-else class="error-card">
    <p>训练详情暂时无法读取。</p><button class="primary" data-action="open-session" @click="send({ type: 'open-session' })">重新读取</button>
  </section>
</template>
