<script setup lang="ts">
import { formatDistanceKm } from "../../lib/ui-formatters";
import type {
  RouteDetailResponse,
  RouteDirection,
  RouteHistoryActivity,
  RouteOrigin,
  RoutesListResponse,
} from "./records-types";

const props = defineProps<{
  variant: "sidebar" | "mobile";
  routes: RoutesListResponse | null;
  routeDetail: RouteDetailResponse | null;
  routesLoading: boolean;
  routeDetailLoading: boolean;
  routeOrigin: RouteOrigin | null;
}>();

const emit = defineEmits<{
  close: [];
  openRoute: [routeKey: string];
  backFromRoute: [];
  openActivity: [activityRef: string];
}>();

const aerobicSportLabels: Record<string, string> = {
  100: "户外跑",
  101: "室内运动",
  102: "越野跑",
  104: "徒步",
  200: "骑行",
};

function aerobicSportLabel(sportType: number | undefined, sportName?: string | null): string {
  return aerobicSportLabels[String(sportType)] || sportName || "有氧运动";
}

function aerobicDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const minutes = Math.round(Number(seconds) / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function activityDistance(activity: RouteHistoryActivity): string {
  const distance = activity.summary?.distance_km;
  return distance === null || distance === undefined ? "—" : `${distance} km`;
}

function activityHeartRate(activity: RouteHistoryActivity): string {
  const heartRate = activity.summary?.average_heart_rate_bpm;
  return heartRate === null || heartRate === undefined ? "" : ` · ${heartRate} bpm`;
}

function routeDirectionLabel(direction: RouteDirection): string {
  if (direction === "forward") return "正向";
  if (direction === "reverse") return "反向";
  return "方向未知";
}
</script>

<template>
  <component
    :is="props.variant === 'sidebar' ? 'aside' : 'section'"
    :class="props.variant === 'sidebar' ? 'route-sidebar' : 'route-mobile-page'"
    aria-label="路线浏览"
  >
    <div v-if="props.routeDetailLoading" class="loading compact-loading">
      <span class="spinner"></span>
      <p>正在读取路线历史…</p>
    </div>

    <template v-else-if="props.routeDetail">
      <div class="route-panel-head">
        <button class="text-button" data-action="route-detail-back" @click="emit('backFromRoute')">
          {{ props.routeOrigin === "activity" ? "← 返回活动详情" : "← 返回路线列表" }}
        </button>
      </div>
      <h2>{{ props.routeDetail.route_name || props.routeDetail.route_key }}</h2>
      <div class="route-summary">
        <span>
          <strong>{{ props.routeDetail.activity_count || 0 }}</strong>
          <small>次活动</small>
        </span>
        <span>
          <strong>{{ formatDistanceKm(props.routeDetail.total_distance_km) }}</strong>
          <small>累计距离</small>
        </span>
        <span>
          <strong>{{ aerobicDuration(props.routeDetail.total_duration_sec) }}</strong>
          <small>累计用时</small>
        </span>
      </div>
      <section class="route-history">
        <h3>历史活动</h3>
        <template v-if="props.routeDetail.history?.length">
          <button
            v-for="activity in props.routeDetail.history"
            :key="activity.activity_ref"
            class="route-history-row"
            data-action="aerobic-detail"
            :data-activity-ref="activity.activity_ref"
            @click="emit('openActivity', activity.activity_ref)"
          >
            <span>
              <strong>{{ activity.local_date || "未知日期" }}</strong>
              <small>
                {{ aerobicSportLabel(activity.sport_type, activity.sport_name) }} ·
                {{ activityDistance(activity) }} ·
                {{ aerobicDuration(activity.summary?.duration_sec) }}{{ activityHeartRate(activity) }}
              </small>
            </span>
            <span>{{ routeDirectionLabel(activity.route_direction) }} ›</span>
          </button>
        </template>
        <p v-else class="muted">这条路线还没有可展示的活动。</p>
      </section>
    </template>

    <div v-else-if="props.routesLoading || !props.routes" class="loading compact-loading">
      <span class="spinner"></span>
      <p>正在读取路线列表…</p>
    </div>

    <template v-else>
      <div class="route-panel-head">
        <button class="text-button" data-action="routes-close" @click="emit('close')">
          ← 返回有氧记录
        </button>
      </div>
      <div class="route-list">
        <template v-if="props.routes.items?.length">
          <button
            v-for="route in props.routes.items"
            :key="route.route_key"
            class="route-list-row"
            data-action="route-detail"
            :data-route-key="route.route_key"
            @click="emit('openRoute', route.route_key)"
          >
            <span>
              <strong>{{ route.route_name || route.route_key }}</strong>
              <small>
                {{ route.activity_count || 0 }} 次活动{{
                  route.total_distance_km == null ? "" : ` · ${formatDistanceKm(route.total_distance_km)}`
                }}
              </small>
            </span>
            <span>›</span>
          </button>
        </template>
        <p v-else class="muted">还没有已确认的路线。</p>
      </div>
    </template>
  </component>
</template>
