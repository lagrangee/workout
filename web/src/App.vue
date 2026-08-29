<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CalendarPage from "./features/calendar/CalendarPage.vue";
import RecordsPage from "./features/records/RecordsPage.vue";
import TodayPage from "./features/session/TodayPage.vue";
import SettingsPage from "./features/settings/SettingsPage.vue";
import type {
  RecordsPageHandle,
  TodayPageHandle,
  WorkoutAppStore,
  WorkoutView,
} from "./core/contracts";

const props = defineProps<{ app: WorkoutAppStore }>();
const todayPage = ref<TodayPageHandle | null>(null);
const recordsPage = ref<RecordsPageHandle | null>(null);
const loginEmail = ref("");
const loginPassword = ref("");
const loginPending = ref(false);
const navigationPending = ref(false);
const executionFocused = ref(false);
const bootstrapSettled = ref(false);
let disposed = false;
let deepLinkGeneration = 0;
let deepLinkQueued = false;
let deepLinkProcessing = false;
let handledDeepLinkKey: string | null = null;

const navigationItems: ReadonlyArray<{ id: WorkoutView; label: string }> = [
  { id: "today", label: "今日" },
  { id: "calendar", label: "日历" },
  { id: "progress", label: "记录" },
  { id: "settings", label: "设置" },
];

const shellClass = computed(() => ({
  shell: true,
  "session-shell": props.app.state.view === "today" && executionFocused.value,
}));

const hasBootstrapData = computed(() => (
  props.app.state.today !== null
  && props.app.state.plan !== null
));

const showLoadingBoundary = computed(() => (
  !bootstrapSettled.value
  || (!hasBootstrapData.value && props.app.state.loading)
));

const fatalError = computed(() => {
  if (hasBootstrapData.value || showLoadingBoundary.value) return null;
  return props.app.state.error ?? "无法读取训练状态，请重新读取";
});

const featureError = computed(() => (
  hasBootstrapData.value ? props.app.state.error : null
));

const navigationReady = computed(() => (
  bootstrapSettled.value
  && hasBootstrapData.value
  && !props.app.state.loading
  && !props.app.state.authRequired
));

async function submitLogin(): Promise<void> {
  if (loginPending.value) return;
  loginPending.value = true;
  try {
    await props.app.login(loginEmail.value, loginPassword.value);
  } catch {
    // The store owns the user-facing authentication error.
  } finally {
    loginPassword.value = "";
    loginPending.value = false;
  }
}

type NavigationGuard = () => boolean;

function navigationContextIsCurrent(
  epoch: number,
  expectedView: WorkoutView,
  guard?: NavigationGuard,
): boolean {
  return navigationReady.value
    && props.app.state.authEpoch === epoch
    && props.app.state.view === expectedView
    && (guard?.() ?? true);
}

async function navigate(
  destination: WorkoutView,
  guard?: NavigationGuard,
): Promise<boolean> {
  if (!navigationReady.value || navigationPending.value) return false;
  if (destination === props.app.state.view) return guard?.() ?? true;

  const source = props.app.state.view;
  const epoch = props.app.state.authEpoch;
  const sourceTodayPage = source === "today" ? todayPage.value : null;
  // A missing Today handle is not equivalent to an already-paused Session.
  if (source === "today" && sourceTodayPage === null) return false;

  navigationPending.value = true;
  try {
    if (sourceTodayPage !== null) {
      const paused = await sourceTodayPage.ensurePaused("navigation");
      if (!paused) return false;
    }
    if (!navigationContextIsCurrent(epoch, source, guard)) return false;

    executionFocused.value = false;
    props.app.state.view = destination;
    await nextTick();

    if (navigationContextIsCurrent(epoch, destination, guard)) return true;

    // A same-epoch hash change can invalidate the route between commit and mount.
    if (props.app.state.authEpoch === epoch && props.app.state.view === destination && guard) {
      props.app.state.view = source;
      await nextTick();
    }
    return false;
  } catch {
    // TodayPage keeps the pause failure visible and the current view remains mounted.
    return false;
  } finally {
    navigationPending.value = false;
    if (deepLinkQueued) void processDeepLinkQueue();
  }
}

function isValidLocalDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

interface AerobicDeepLink {
  date: string;
  hash: string;
}

function currentAerobicDeepLink(): AerobicDeepLink | null {
  if (window.location.pathname !== "/app") return null;
  const match = /^#records-aerobic-(\d{4}-\d{2}-\d{2})$/.exec(window.location.hash);
  if (!match || !isValidLocalDate(match[1])) return null;
  return { date: match[1], hash: match[0] };
}

async function showAerobicDate(
  date: string,
  guard?: NavigationGuard,
): Promise<boolean> {
  if (!isValidLocalDate(date) || !navigationReady.value) return false;
  const epoch = props.app.state.authEpoch;
  const routed = await navigate("progress", guard);
  if (!routed || !navigationContextIsCurrent(epoch, "progress", guard)) return false;

  const destination = recordsPage.value;
  if (destination === null) return false;
  try {
    await destination.showAerobicDate(date);
  } catch {
    return false;
  }
  return navigationContextIsCurrent(epoch, "progress", guard);
}

async function evaluateCurrentDeepLink(): Promise<void> {
  if (!navigationReady.value || disposed) return;
  const deepLink = currentAerobicDeepLink();
  if (deepLink === null) return;

  const epoch = props.app.state.authEpoch;
  const generation = deepLinkGeneration;
  const key = `${epoch}:${deepLink.hash}`;
  if (handledDeepLinkKey === key) return;

  const guard = () => {
    const current = currentAerobicDeepLink();
    return !disposed
      && props.app.state.authEpoch === epoch
      && deepLinkGeneration === generation
      && current?.hash === deepLink.hash;
  };
  const handled = await showAerobicDate(deepLink.date, guard);
  if (handled && guard()) handledDeepLinkKey = key;
}

async function processDeepLinkQueue(): Promise<void> {
  if (disposed || deepLinkProcessing || navigationPending.value) return;
  deepLinkProcessing = true;
  try {
    while (deepLinkQueued && !disposed) {
      deepLinkQueued = false;
      await evaluateCurrentDeepLink();
    }
  } finally {
    deepLinkProcessing = false;
    if (deepLinkQueued && !navigationPending.value && !disposed) {
      void processDeepLinkQueue();
    }
  }
}

function queueDeepLinkEvaluation(invalidate = false): void {
  if (disposed) return;
  if (invalidate) {
    deepLinkGeneration += 1;
    handledDeepLinkKey = null;
  }
  deepLinkQueued = true;
  void processDeepLinkQueue();
}

function handleHashChange(): void {
  queueDeepLinkEvaluation(true);
}

watch(
  () => [
    props.app.state.authEpoch,
    props.app.state.authRequired,
    props.app.state.loading,
    props.app.state.today,
    props.app.state.plan,
    props.app.state.progress,
  ] as const,
  (current, previous) => {
    const authEpochChanged = current[0] !== previous[0];
    queueDeepLinkEvaluation(authEpochChanged);
  },
  { flush: "post" },
);

onMounted(async () => {
  window.addEventListener("hashchange", handleHashChange);
  try {
    await props.app.bootstrap();
  } catch (error) {
    props.app.setError(error);
  } finally {
    if (!disposed) {
      bootstrapSettled.value = true;
      await nextTick();
      queueDeepLinkEvaluation();
    }
  }
});

onBeforeUnmount(() => {
  disposed = true;
  deepLinkGeneration += 1;
  deepLinkQueued = false;
  window.removeEventListener("hashchange", handleHashChange);
});
</script>

<template>
  <div v-if="app.state.authRequired" class="shell">
    <main>
      <section class="hero">
        <p class="eyebrow">WORKOUT TRACKER</p>
        <h1>登录你的训练空间</h1>
        <p class="muted">使用已配置的登录凭据访问训练空间。</p>
      </section>

      <form class="settings-form" data-form="login" @submit.prevent="submitLogin">
        <label>
          邮箱
          <input
            v-model="loginEmail"
            name="email"
            type="email"
            autocomplete="username"
            required
          />
        </label>
        <label>
          密码
          <input
            v-model="loginPassword"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <div v-if="app.state.authMessage" class="validation-error" role="alert">
          {{ app.state.authMessage }}
        </div>
        <button class="primary wide" :disabled="loginPending" :aria-busy="loginPending">
          {{ loginPending ? "正在登录…" : "登录" }}
        </button>
      </form>
    </main>
  </div>

  <div v-else :class="shellClass">
    <main v-if="showLoadingBoundary">
      <section class="loading" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <p>正在读取你的训练状态…</p>
      </section>
    </main>

    <main v-else-if="fatalError">
      <section class="error-card" role="alert">
        <p>{{ fatalError }}</p>
        <button class="primary" data-action="refresh" type="button" @click="app.refresh()">
          重新读取
        </button>
      </section>
    </main>

    <main v-else>
      <TodayPage
        v-if="app.state.view === 'today'"
        ref="todayPage"
        :app="app"
        @execution-focus-change="executionFocused = $event"
        @show-aerobic="showAerobicDate"
      />
      <CalendarPage
        v-else-if="app.state.view === 'calendar'"
        :app="app"
        @show-aerobic="showAerobicDate"
      />
      <RecordsPage
        v-else-if="app.state.view === 'progress'"
        ref="recordsPage"
        :app="app"
      />
      <SettingsPage v-else :app="app" />
    </main>

    <div v-if="featureError" class="validation-error" role="alert">
      {{ featureError }}
      <button class="text-button" type="button" @click="app.clearError()">关闭</button>
    </div>

    <div v-if="app.state.message" class="notice" role="status">
      {{ app.state.message }}
    </div>

    <nav v-if="navigationReady && !executionFocused" class="bottom-nav" aria-label="主导航">
      <button
        v-for="item in navigationItems"
        :key="item.id"
        class="nav-link"
        :class="{ active: app.state.view === item.id }"
        :data-view="item.id"
        :disabled="navigationPending"
        :aria-current="app.state.view === item.id ? 'page' : undefined"
        type="button"
        @click="navigate(item.id)"
      >
        {{ item.label }}
      </button>
    </nav>
  </div>
</template>
