<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { errorMessage } from "../../core/api-client";
import type { WorkoutAppStore } from "../../core/contracts";
import { formatActivityDateTime } from "../../lib/ui-formatters";
import RecordsHeader from "./RecordsHeader.vue";
import RouteBrowser from "./RouteBrowser.vue";
import {
  parseAerobicDetailResponse,
  parseAerobicListResponse,
  parseRecordsOverviewResponse,
  parseRouteDetailResponse,
  parseRoutesListResponse,
} from "./records-contracts";
import { getRecordsRuntime, resetRecordsRuntime } from "./records-runtime";
import { asProgressResponse } from "./records-types";
import type {
  AerobicActivity,
  ExerciseDetailResponse,
  ExerciseObservation,
  ProgressRange,
  RecordsTab,
  RouteOrigin,
  ScheduleKind,
} from "./records-types";

const props = defineProps<{ app: WorkoutAppStore }>();

const runtime = getRecordsRuntime(props.app);
const {
  activeTab,
  overview,
  overviewLoading,
  overviewError,
  progressRange,
  progress,
  progressLoading,
  progressError,
  exerciseDetail,
  exerciseLoading,
  aerobicList,
  aerobicDetail,
  aerobicListLoading,
  aerobicDetailLoading,
  aerobicError,
  aerobicErrorContext,
  selectedActivityRef,
  monthFilter,
  sportTypeFilter,
  dateFrom,
  dateTo,
  routes,
  routesOpen,
  routesLoading,
  routeDetail,
  routeDetailLoading,
  routeOrigin,
  selectedRouteKey,
} = runtime;

const aerobicSportLabels: Record<string, string> = {
  100: "户外跑",
  101: "室内运动",
  102: "越野跑",
  104: "徒步",
  200: "骑行",
};

const aerobicStatusLabels: Record<string, string> = {
  complete: "数据完整",
  partial: "部分数据",
  error: "读取失败",
  none: "暂无数据",
};

watch(() => props.app.state.progress, (value) => {
  if (progressRange.value === "current" && !progressLoading.value) {
    const parsed = asProgressResponse(value);
    progress.value = parsed;
    progressError.value = value !== null && !parsed ? "训练进展响应格式无效" : null;
  }
}, { immediate: true });

watch(() => props.app.state.authEpoch, (authEpoch) => {
  if (runtime.contextToken === authEpoch) return;
  resetRecordsRuntime(runtime, props.app);
  if (!props.app.state.authRequired) void loadOverview();
});

const recentDays = computed(() => (overview.value?.days || [])
  .filter((day) => day.workout_session_count || day.aerobic_activity_count)
  .slice(-8)
  .reverse());

const progressPeriod = computed(() => {
  const period = progress.value?.period;
  return period?.from && period?.to ? `${period.from} – ${period.to}` : "";
});

const progressEyebrow = computed(() => `RECORDS · STRENGTH${progressLoading.value ? "" : ` · ${progressRangeLabel(progressRange.value)}`}`);

const aerobicItems = computed(() => aerobicList.value?.items || []);

const monthOptions = computed(() => [...new Set(aerobicItems.value
  .map((item) => item.local_date?.slice(0, 7))
  .filter((month): month is string => Boolean(month)))]
  .sort()
  .reverse());

const sportTypeOptions = computed(() => [...new Set(aerobicItems.value
  .map((item) => item.sport_type))]
  .sort((left, right) => left - right));

const filteredAerobicItems = computed(() => aerobicItems.value.filter((item) => (
  (monthFilter.value === "all" || item.local_date?.startsWith(monthFilter.value))
  && (sportTypeFilter.value === "all" || String(item.sport_type) === sportTypeFilter.value)
)));

function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonth(date: string, offset: number): string {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function progressRangeLabel(range: ProgressRange): string {
  return ({ current: "当月", previous: "上月", all: "累计" } as const)[range];
}

function progressQuery(range = progressRange.value): string {
  const today = props.app.state.today?.date;
  if (!today || range === "all") return "preset=all";
  if (range === "previous") {
    return `from=${shiftMonth(today, -1)}&to=${addCalendarDays(monthStart(today), -1)}`;
  }
  return `from=${monthStart(today)}&to=${today}`;
}

function formatPercent(value: number | null | undefined): string {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatHours(seconds: number | null | undefined): string {
  const value = Math.round((Number(seconds) || 0) / 360) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} 小时`;
}

function aerobicSportLabel(sportType: number | undefined, sportName?: string | null): string {
  return aerobicSportLabels[String(sportType)] || sportName || "有氧运动";
}

function aerobicStatusLabel(status: string | undefined): string {
  return aerobicStatusLabels[String(status)] || "状态未知";
}

function aerobicDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const minutes = Math.round(Number(seconds) / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function activityDistance(activity: AerobicActivity): string {
  const distance = activity.summary?.distance_km;
  return distance === null || distance === undefined ? "—" : `${distance} km`;
}

function activityHeartRate(activity: AerobicActivity): string {
  const heartRate = activity.summary?.average_heart_rate_bpm;
  return heartRate === null || heartRate === undefined ? "" : ` · ${heartRate} bpm`;
}

function scheduleKindLabel(kind: ScheduleKind): string {
  if (kind === "workout") return "计划日";
  if (kind === "rest") return "休息日";
  return "无计划";
}

function observationSets(observation: ExerciseObservation): string {
  return (observation.sets || []).map((set) => {
    const side = set.side || "none";
    const actual = set.actual;
    const value = actual?.value ?? "—";
    const metric = actual?.metric || "";
    return `${side} · ${value}${metric ? ` ${metric}` : ""}`;
  }).join("，");
}

function clearRecordDetails(): void {
  runtime.requests.exercise += 1;
  runtime.requests.aerobicDetail += 1;
  runtime.requests.routes += 1;
  runtime.requests.routeDetail += 1;
  exerciseDetail.value = null;
  exerciseLoading.value = false;
  aerobicDetail.value = null;
  aerobicDetailLoading.value = false;
  routesOpen.value = false;
  routesLoading.value = false;
  routeDetail.value = null;
  routeDetailLoading.value = false;
  routeOrigin.value = null;
  aerobicError.value = null;
  aerobicErrorContext.value = "list";
  selectedActivityRef.value = null;
  selectedRouteKey.value = null;
}

async function selectTab(tab: RecordsTab): Promise<void> {
  activeTab.value = tab;
  clearRecordDetails();
  if (tab === "overview" && !overview.value) await loadOverview();
  if (tab === "strength" && !progress.value) await loadProgress(progressRange.value);
  if (tab === "aerobic" && !aerobicList.value) await loadAerobicActivities();
}

async function loadOverview(): Promise<void> {
  const request = ++runtime.requests.overview;
  overviewLoading.value = true;
  overviewError.value = null;
  try {
    const result = parseRecordsOverviewResponse(await props.app.api.request<unknown>("/api/private/records/overview"));
    if (request === runtime.requests.overview) overview.value = result;
  } catch (error) {
    if (request === runtime.requests.overview) overviewError.value = errorMessage(error);
  } finally {
    if (request === runtime.requests.overview) overviewLoading.value = false;
  }
}

async function loadProgress(range: ProgressRange): Promise<void> {
  progressRange.value = range;
  const request = ++runtime.requests.progress;
  progressLoading.value = true;
  progressError.value = null;
  try {
    const result = asProgressResponse(await props.app.api.request<unknown>(`/api/private/progress?${progressQuery(range)}`));
    if (!result) throw new Error("训练进展响应格式无效");
    if (request === runtime.requests.progress) progress.value = result;
  } catch (error) {
    if (request === runtime.requests.progress) progressError.value = errorMessage(error);
  } finally {
    if (request === runtime.requests.progress) progressLoading.value = false;
  }
}

async function openExercise(exerciseKey: string): Promise<void> {
  const request = ++runtime.requests.exercise;
  exerciseLoading.value = true;
  progressError.value = null;
  try {
    const result = await props.app.api.request<ExerciseDetailResponse>(`/api/private/exercises/${encodeURIComponent(exerciseKey)}?preset=12w`);
    if (request === runtime.requests.exercise) {
      exerciseDetail.value = result;
      activeTab.value = "strength";
    }
  } catch (error) {
    if (request === runtime.requests.exercise) progressError.value = errorMessage(error);
  } finally {
    if (request === runtime.requests.exercise) exerciseLoading.value = false;
  }
}

function closeExercise(): void {
  exerciseDetail.value = null;
  activeTab.value = "strength";
}

async function loadAerobicActivities(): Promise<void> {
  const request = ++runtime.requests.aerobicList;
  aerobicListLoading.value = true;
  aerobicError.value = null;
  aerobicErrorContext.value = "list";
  try {
    const query = ["limit=200"];
    if (dateFrom.value && dateTo.value) {
      query.push(`from=${encodeURIComponent(dateFrom.value)}`, `to=${encodeURIComponent(dateTo.value)}`);
    }
    const result = parseAerobicListResponse(await props.app.api.request<unknown>(`/api/private/records/aerobic?${query.join("&")}`));
    if (request === runtime.requests.aerobicList) aerobicList.value = result;
  } catch (error) {
    if (request === runtime.requests.aerobicList) aerobicError.value = errorMessage(error);
  } finally {
    if (request === runtime.requests.aerobicList) aerobicListLoading.value = false;
  }
}

async function openAerobicDetail(activityRef: string): Promise<void> {
  const request = ++runtime.requests.aerobicDetail;
  runtime.requests.routes += 1;
  runtime.requests.routeDetail += 1;
  selectedActivityRef.value = activityRef;
  aerobicDetailLoading.value = true;
  aerobicDetail.value = null;
  routesOpen.value = false;
  routesLoading.value = false;
  routeDetail.value = null;
  routeDetailLoading.value = false;
  routeOrigin.value = null;
  aerobicError.value = null;
  aerobicErrorContext.value = "detail";
  try {
    const result = parseAerobicDetailResponse(await props.app.api.request<unknown>(`/api/private/records/aerobic/${encodeURIComponent(activityRef)}`));
    if (request === runtime.requests.aerobicDetail) aerobicDetail.value = result;
  } catch (error) {
    if (request === runtime.requests.aerobicDetail) aerobicError.value = errorMessage(error);
  } finally {
    if (request === runtime.requests.aerobicDetail) aerobicDetailLoading.value = false;
  }
}

function backFromAerobicDetail(): void {
  aerobicDetail.value = null;
  routesOpen.value = false;
  routeDetail.value = null;
  routeOrigin.value = null;
}

async function openRoutes(): Promise<void> {
  routesOpen.value = true;
  routeDetail.value = null;
  routeOrigin.value = null;
  await loadRoutes();
}

async function loadRoutes(): Promise<void> {
  const request = ++runtime.requests.routes;
  routesLoading.value = true;
  aerobicError.value = null;
  aerobicErrorContext.value = "routes";
  try {
    const result = parseRoutesListResponse(await props.app.api.request<unknown>("/api/private/records/routes?limit=200"));
    if (request === runtime.requests.routes) routes.value = result;
  } catch (error) {
    if (request === runtime.requests.routes) aerobicError.value = errorMessage(error);
  } finally {
    if (request === runtime.requests.routes) routesLoading.value = false;
  }
}

function closeRoutes(): void {
  runtime.requests.routes += 1;
  runtime.requests.routeDetail += 1;
  routesOpen.value = false;
  routesLoading.value = false;
  routeDetail.value = null;
  routeDetailLoading.value = false;
  routeOrigin.value = null;
  selectedRouteKey.value = null;
  aerobicError.value = null;
  aerobicErrorContext.value = "list";
}

async function openRouteDetail(routeKey: string, origin: RouteOrigin = "list"): Promise<void> {
  const request = ++runtime.requests.routeDetail;
  selectedRouteKey.value = routeKey;
  routesOpen.value = true;
  routeOrigin.value = origin;
  routeDetailLoading.value = true;
  routeDetail.value = null;
  aerobicError.value = null;
  aerobicErrorContext.value = "route-detail";
  try {
    const result = parseRouteDetailResponse(await props.app.api.request<unknown>(`/api/private/records/routes/${encodeURIComponent(routeKey)}?limit=200`));
    if (request === runtime.requests.routeDetail) routeDetail.value = result;
  } catch (error) {
    if (request === runtime.requests.routeDetail) aerobicError.value = errorMessage(error);
  } finally {
    if (request === runtime.requests.routeDetail) routeDetailLoading.value = false;
  }
}

function backFromRouteDetail(): void {
  const fromActivity = routeOrigin.value === "activity";
  routeDetail.value = null;
  routeOrigin.value = null;
  routesOpen.value = !fromActivity;
}

async function retryAerobic(): Promise<void> {
  if (aerobicErrorContext.value === "detail" && selectedActivityRef.value) {
    await openAerobicDetail(selectedActivityRef.value);
    return;
  }
  if (aerobicErrorContext.value === "routes") {
    await loadRoutes();
    return;
  }
  if (aerobicErrorContext.value === "route-detail" && selectedRouteKey.value) {
    await openRouteDetail(selectedRouteKey.value, routeOrigin.value || "list");
    return;
  }
  await loadAerobicActivities();
}

async function showAerobicDate(date: string): Promise<void> {
  activeTab.value = "aerobic";
  clearRecordDetails();
  dateFrom.value = date;
  dateTo.value = date;
  monthFilter.value = "all";
  sportTypeFilter.value = "all";
  await loadAerobicActivities();
}

defineExpose({ showAerobicDate });

onMounted(() => {
  if (activeTab.value === "overview" && !overview.value && !overviewLoading.value) void loadOverview();
  if (activeTab.value === "strength" && !progress.value && !progressLoading.value) void loadProgress(progressRange.value);
  if (activeTab.value === "aerobic" && !aerobicList.value && !aerobicListLoading.value) void loadAerobicActivities();
});
</script>

<template>
  <div class="records-page">
    <template v-if="exerciseDetail">
      <section class="page-head">
        <button class="text-button" data-action="close-exercise" @click="closeExercise">← 返回进展</button>
        <p class="eyebrow">动作记录</p>
        <h1>{{ exerciseDetail.exercise_key }}</h1>
        <p class="muted">{{ exerciseDetail.performed_session_count || 0 }} 次有实际完成结果的训练</p>
      </section>
      <section class="list-card">
        <template v-if="exerciseDetail.observations?.length">
          <article
            v-for="observation in exerciseDetail.observations"
            :key="`${observation.scheduled_date || ''}:${observation.session_key || ''}`"
            class="week-row"
          >
            <div>
              <strong>{{ observation.scheduled_date }}</strong>
              <p>{{ observationSets(observation) }}</p>
            </div>
          </article>
        </template>
        <p v-else class="muted">这个动作目前没有可展示的完成记录。</p>
      </section>
    </template>

    <template v-else-if="activeTab === 'overview'">
      <RecordsHeader
        active="overview"
        eyebrow="RECORDS · OVERVIEW"
        heading="总览"
        @select-tab="selectTab"
      />
      <section v-if="overviewError" class="error-card">
        <p>{{ overviewError }}</p>
        <button class="primary" @click="loadOverview">重新读取</button>
      </section>
      <section v-else-if="overviewLoading || !overview" class="loading compact-loading">
        <span class="spinner"></span>
        <p>正在读取训练记录…</p>
      </section>
      <template v-else>
        <div class="metric-grid records-overview-metrics">
          <button
            class="records-overview-metric"
            data-action="records-tab"
            data-tab="strength"
            aria-label="查看力量记录"
            @click="selectTab('strength')"
          >
            <span>力量 Session</span>
            <strong>{{ overview.workout?.session_count || 0 }}</strong>
          </button>
          <button
            class="records-overview-metric"
            data-action="records-tab"
            data-tab="aerobic"
            aria-label="查看有氧记录"
            @click="selectTab('aerobic')"
          >
            <span>有氧活动</span>
            <strong>{{ overview.aerobic?.activity_count || 0 }}</strong>
          </button>
          <article class="records-overview-metric">
            <span>记录天数</span>
            <strong>{{ recentDays.length }}</strong>
          </article>
        </div>
        <section class="list-card records-overview-days">
          <h2>最近记录日期</h2>
          <template v-if="recentDays.length">
            <article v-for="day in recentDays" :key="day.local_date" class="records-overview-day">
              <div>
                <strong>{{ day.local_date }}</strong>
                <small>{{ scheduleKindLabel(day.schedule_kind) }}</small>
              </div>
              <div>
                <span>{{ day.workout_session_count ? `${day.workout_session_count} 次力量` : "无力量 Session" }}</span>
                <span>{{ day.aerobic_activity_count ? `${day.aerobic_activity_count} 次有氧` : "无有氧活动" }}</span>
              </div>
            </article>
          </template>
          <p v-else class="muted">还没有可展示的训练记录。</p>
        </section>
      </template>
    </template>

    <template v-else-if="activeTab === 'strength'">
      <RecordsHeader
        active="strength"
        :eyebrow="progressEyebrow"
        heading="力量"
        :subtitle="progressPeriod"
        @select-tab="selectTab"
      />
      <div class="progress-range-tabs" role="tablist" aria-label="力量记录时间范围">
        <button
          v-for="range in (['current', 'previous', 'all'] as ProgressRange[])"
          :key="range"
          class="progress-range-tab"
          :class="{ 'is-selected': progressRange === range }"
          data-action="progress-range"
          :data-range="range"
          role="tab"
          :aria-selected="progressRange === range"
          @click="loadProgress(range)"
        >
          {{ progressRangeLabel(range) }}
        </button>
      </div>
      <section v-if="progressLoading || exerciseLoading" class="loading compact-loading">
        <span class="spinner"></span>
        <p>{{ exerciseLoading ? "正在读取动作记录…" : `正在读取${progressRangeLabel(progressRange)}数据…` }}</p>
      </section>
      <section v-else-if="progressError" class="error-card">
        <p>{{ progressError }}</p>
        <button class="primary" @click="loadProgress(progressRange)">重新读取</button>
      </section>
      <template v-else>
        <div class="metric-grid">
          <article>
            <span>完成率</span>
            <strong>{{ progress?.metrics?.completion_rate?.value == null ? "—" : formatPercent(progress.metrics.completion_rate.value) }}</strong>
          </article>
          <article>
            <span>训练时长</span>
            <strong>{{ formatHours(progress?.metrics?.training_duration?.value_sec) }}</strong>
          </article>
          <article>
            <span>力量训练日</span>
            <strong>{{ progress?.metrics?.strength_training_days?.value || 0 }}</strong>
          </article>
          <article>
            <span>平均 RPE</span>
            <strong>{{ progress?.metrics?.average_session_rpe?.value ?? "—" }}</strong>
            <small>{{ progress?.metrics?.average_session_rpe?.included_count || 0 }} 个有效记录</small>
          </article>
        </div>
        <section class="quiet-card">
          <strong>训练连续性</strong>
          <p>{{ progress?.current_streak?.value || 0 }} 天连续完成 100% 训练；休息日和无计划日保持中性。</p>
        </section>
        <section class="list-card">
          <h2>动作进展</h2>
          <template v-if="progress?.exercises?.length">
            <button
              v-for="exercise in progress.exercises"
              :key="exercise.exercise_key"
              class="list-row"
              :data-exercise="exercise.exercise_key"
              @click="openExercise(exercise.exercise_key)"
            >
              <span>
                <strong>{{ exercise.current_name }}</strong>
                <small>{{ exercise.performed_session_count || 0 }} 次训练</small>
              </span>
              <span>›</span>
            </button>
          </template>
          <p v-else class="muted">还没有可展示的动作记录。</p>
        </section>
      </template>
    </template>

    <template v-else>
      <template v-if="aerobicDetail && !routesOpen">
        <RecordsHeader
          active="aerobic"
          eyebrow="RECORDS · AEROBIC"
          heading="活动详情"
          :subtitle="`${aerobicDetail.local_date || '未知日期'} · ${aerobicSportLabel(aerobicDetail.sport_type, aerobicDetail.sport_name)}`"
          :show-tabs="false"
          back-label="← 返回有氧记录"
          @back="backFromAerobicDetail"
        />
        <section class="aerobic-detail-card">
          <div class="aerobic-detail-status">
            <span class="status-pill" :class="aerobicDetail.source_status || 'none'">
              {{ aerobicStatusLabel(aerobicDetail.source_status) }}
            </span>
            <span v-if="aerobicDetail.sport_type === 101">室内运动 · 无路线</span>
            <button
              v-else-if="aerobicDetail.route_key"
              class="route-status-button"
              data-action="route-detail"
              :data-route-key="aerobicDetail.route_key"
              @click="openRouteDetail(aerobicDetail.route_key, 'activity')"
            >
              {{ aerobicDetail.route_key }}
            </button>
            <span v-else>未匹配路线</span>
          </div>
          <div class="metric-grid aerobic-metrics">
            <article>
              <span>距离</span>
              <strong>{{ activityDistance(aerobicDetail) }}</strong>
            </article>
            <article>
              <span>用时</span>
              <strong>{{ aerobicDuration(aerobicDetail.summary?.duration_sec) }}</strong>
            </article>
            <article>
              <span>平均心率</span>
              <strong>{{ aerobicDetail.summary?.average_heart_rate_bpm == null ? "—" : `${aerobicDetail.summary.average_heart_rate_bpm} bpm` }}</strong>
            </article>
            <article>
              <span>消耗</span>
              <strong>{{ aerobicDetail.summary?.calories_kcal == null ? "—" : `${aerobicDetail.summary.calories_kcal} kcal` }}</strong>
            </article>
          </div>
          <dl class="aerobic-source">
            <div>
              <dt>活动时间</dt>
              <dd>{{ formatActivityDateTime(aerobicDetail.started_at, aerobicDetail.timezone || props.app.state.today?.timezone) }}</dd>
            </div>
            <div>
              <dt>FIT</dt>
              <dd>{{ aerobicDetail.fit_status || "—" }}</dd>
            </div>
          </dl>
        </section>
      </template>

      <template v-else>
        <RecordsHeader
          active="aerobic"
          eyebrow="RECORDS · AEROBIC"
          heading="有氧"
          :show-tabs="!routesOpen"
          @select-tab="selectTab"
        />

        <section v-if="aerobicError" class="error-card">
          <p>{{ aerobicError }}</p>
          <button class="primary" data-action="aerobic-retry" @click="retryAerobic">重新读取</button>
        </section>

        <template v-else-if="aerobicListLoading || !aerobicList">
          <div v-if="!routesOpen" class="aerobic-filters">
            <select v-model="monthFilter" aria-label="月份" data-aerobic-filter="month">
              <option value="all">全部月份</option>
              <option v-for="month in monthOptions" :key="month" :value="month">{{ month }}</option>
            </select>
            <select v-model="sportTypeFilter" aria-label="运动" data-aerobic-filter="sportType">
              <option value="all">全部运动</option>
              <option v-for="sportType in sportTypeOptions" :key="sportType" :value="String(sportType)">
                {{ aerobicSportLabel(sportType) }}
              </option>
            </select>
            <button class="secondary routes-button" data-action="routes-open" @click="openRoutes">路线</button>
          </div>
          <section class="loading compact-loading">
            <span class="spinner"></span>
            <p>正在读取有氧记录…</p>
          </section>
        </template>

        <template v-else>
          <div v-if="!routesOpen" class="aerobic-filters">
            <select v-model="monthFilter" aria-label="月份" data-aerobic-filter="month">
              <option value="all">全部月份</option>
              <option v-for="month in monthOptions" :key="month" :value="month">{{ month }}</option>
            </select>
            <select v-model="sportTypeFilter" aria-label="运动" data-aerobic-filter="sportType">
              <option value="all">全部运动</option>
              <option v-for="sportType in sportTypeOptions" :key="sportType" :value="String(sportType)">
                {{ aerobicSportLabel(sportType) }}
              </option>
            </select>
            <button class="secondary routes-button" data-action="routes-open" @click="openRoutes">
              路线{{ routes?.items?.length ? ` · ${routes.items.length}` : "" }}
            </button>
          </div>

          <div v-if="!routesOpen && dateFrom && dateTo" class="aerobic-date-scope">
            <span class="records-context">日期：{{ dateFrom }}{{ dateFrom === dateTo ? "" : ` – ${dateTo}` }}</span>
          </div>

          <div class="aerobic-route-layout" :class="{ 'route-focus': routesOpen }">
            <section class="aerobic-activity-pane">
              <div class="aerobic-activity-list" aria-label="有氧活动列表">
                <template v-if="filteredAerobicItems.length">
                  <button
                    v-for="activity in filteredAerobicItems"
                    :key="activity.activity_ref"
                    class="aerobic-activity-card"
                    data-action="aerobic-detail"
                    :data-activity-ref="activity.activity_ref"
                    :aria-busy="aerobicDetailLoading && selectedActivityRef === activity.activity_ref"
                    @click="openAerobicDetail(activity.activity_ref)"
                  >
                    <span class="aerobic-activity-main">
                      <span class="aerobic-activity-title">
                        <strong>{{ activity.local_date || "未知日期" }} · {{ aerobicSportLabel(activity.sport_type, activity.sport_name) }}</strong>
                        <span v-if="activity.sport_type !== 101 && activity.route_key" class="aerobic-activity-route">
                          {{ activity.route_key }}
                        </span>
                      </span>
                      <span>
                        {{ activityDistance(activity) }} · {{ aerobicDuration(activity.summary?.duration_sec) }}{{ activityHeartRate(activity) }}
                      </span>
                    </span>
                    <span class="aerobic-activity-arrow">›</span>
                  </button>
                </template>
                <div v-else class="quiet-card">
                  <strong>还没有有氧记录</strong>
                  <p>暂无有氧记录，完成一次 sync data 后会显示在这里。</p>
                </div>
              </div>
            </section>

            <template v-if="routesOpen">
              <RouteBrowser
                variant="sidebar"
                :routes="routes"
                :route-detail="routeDetail"
                :routes-loading="routesLoading"
                :route-detail-loading="routeDetailLoading"
                :route-origin="routeOrigin"
                @close="closeRoutes"
                @open-route="(routeKey) => openRouteDetail(routeKey, 'list')"
                @back-from-route="backFromRouteDetail"
                @open-activity="openAerobicDetail"
              />
              <RouteBrowser
                variant="mobile"
                :routes="routes"
                :route-detail="routeDetail"
                :routes-loading="routesLoading"
                :route-detail-loading="routeDetailLoading"
                :route-origin="routeOrigin"
                @close="closeRoutes"
                @open-route="(routeKey) => openRouteDetail(routeKey, 'list')"
                @back-from-route="backFromRouteDetail"
                @open-activity="openAerobicDetail"
              />
            </template>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
