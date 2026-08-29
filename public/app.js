// @ts-check

import { formatActivityDateTime, formatDistanceKm } from "./ui-formatters.js";
import { createWorkoutTimeline } from "./workout-timeline.js";

/** @typedef {import("../types/interfaces.js").AppState} AppState */
/** @typedef {import("../types/interfaces.js").JsonRecord} JsonRecord */
/** @typedef {import("../src/types.js").WorkoutSession} WorkoutSession */
/** @typedef {"start"|"continue"|"restart"|"complete"|"pause"|"resume"} MutationAction */
/** @typedef {{ active?: boolean, forcePaused?: boolean, pauseReason?: string, pausedAt?: number, restSeconds?: number, nextIndex?: number|null, openEnd?: boolean }} ShowSessionOptions */

/** @type {Record<string, string>} */
const weekdayLabels = { monday: "周一", tuesday: "周二", wednesday: "周三", thursday: "周四", friday: "周五", saturday: "周六", sunday: "周日" };
const rpeMeanings = [
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
];
const sessionMutationActions = new Set(["start", "continue", "restart", "complete", "pause", "resume"]);
/** @type {Record<MutationAction, string>} */
const mutationPendingLabels = { start: "正在开始训练…", continue: "正在继续训练…", restart: "正在重新开始训练…", complete: "正在保存…", pause: "正在暂停…", resume: "正在继续…" };
const preparationDurationSec = 5;
const workoutTestSeams = typeof window !== "undefined" ? window.__workoutTestSeams || {} : {};
const clockNow = () => typeof workoutTestSeams.now === "function" ? Number(workoutTestSeams.now()) : Date.now();
const countdownNow = () => typeof workoutTestSeams.now === "function" ? Number(workoutTestSeams.now()) : typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
/** @param {FrameRequestCallback} callback */
const scheduleFrame = (callback) => typeof workoutTestSeams.requestAnimationFrame === "function" ? workoutTestSeams.requestAnimationFrame(callback) : requestAnimationFrame(callback);
/** @param {number} handle */
const cancelFrame = (handle) => typeof workoutTestSeams.cancelAnimationFrame === "function" ? workoutTestSeams.cancelAnimationFrame(handle) : cancelAnimationFrame(handle);
const workoutTimeline = createWorkoutTimeline({ audioOutput: workoutTestSeams.audio || null, now: countdownNow, leadTimeMs: workoutTestSeams.audio ? 0 : 50 });
let audioActivationGeneration = 0;
let resumeGeneration = 0;
/** @type {Promise<unknown>|null} */
let resumeRequestPromise = null;
void workoutTimeline.prepareAudio();
const blankTimedAction = () => ({ itemKey: null, phase: "idle", targetSec: null, deadlineMs: null, remainingMs: null, remainingSec: null });
/** @type {AppState} */
const state = { view: "today", today: null, todayDetail: null, plan: null, progress: null, progressRange: "current", progressLoading: false, recordsTab: "overview", recordsOverview: null, recordsOverviewLoading: false, aerobic: { list: null, detail: null, loading: false, detailLoading: false, error: null, month: "all", sportType: "all", from: null, to: null, routes: null, routesOpen: false, routesLoading: false, routeDetail: null, routeDetailLoading: false, routeOrigin: null }, calendar: { from: null, to: null, selectedDate: null, entries: [], sessions: [], expiredCount: 0 }, calendarDay: null, calendarLoading: false, calendarDayLoading: false, calendarError: null, calendarMaintenance: { pending: false, error: null }, session: null, sessionDetail: null, exercise: null, me: null, share: null, agentAccess: null, agentAccessToken: null, focusIndex: 0, progressOpen: false, feedbackOpen: null, feedbackDraft: {}, actualDrafts: {}, resistanceDrafts: {}, rirDrafts: {}, sessionMutation: { action: null, pending: false, error: null }, timedAction: blankTimedAction(), audio: { status: "idle", error: null }, muted: false, adjust: false, correction: false, sheet: false, preview: null, endSheet: false, endRpe: 8, endNote: "", endFeedback: {}, restUntil: null, restRemainingMs: null, restNextIndex: null, timerHandle: null, timerPaused: false, timerPauseReason: null, timerPauseStartedAt: null, timerPausedSec: 0, wakeLock: { sentinel: null, requestPending: false, requestId: 0, status: "idle" }, draft: "", error: null, planError: null, loading: true, authRequired: false, authMessage: "", message: "" };
state.planEvidence = null;
state.planEditorMode = null;

const app = /** @type {HTMLElement} */ (document.querySelector("#app"));
/** @param {string} selector */
const queryElement = (selector) => /** @type {HTMLElement|null} */ (document.querySelector(selector));
/** @param {string} selector */
const queryElements = (selector) => /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(selector));
/** @param {string} selector */
const queryControl = (selector) => /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (document.querySelector(selector));
/** @param {string} selector */
const queryForm = (selector) => /** @type {HTMLFormElement|null} */ (document.querySelector(selector));
/** @param {string} path @param {RequestInit} [options] @returns {Promise<any>} */
async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const localEmail = localStorage.getItem("workout-athlete-email");
  if (localEmail && ["localhost", "127.0.0.1"].includes(location.hostname)) headers.set("x-athlete-email", localEmail);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "请求失败"), { data, status: response.status });
  return data;
}
const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** @param {unknown} value */
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] ?? c));
/** @param {number|null|undefined} value */
const pct = (value) => `${Math.round((value || 0) * 100)}%`;
/** @param {string} date @param {number} days */
const addCalendarDays = (date, days) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
/** @param {string} date */
const calendarWeekday = (date) => { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return day === 0 ? 6 : day - 1; };
/** @param {string} date */
const calendarMonday = (date) => addCalendarDays(date, -calendarWeekday(date));
const calendarFirstDate = () => state.plan?.first_effective_from || null;
/** @param {MutationAction} action */
const isSessionMutationPending = (action) => state.sessionMutation.pending && state.sessionMutation.action === action;
/** @param {MutationAction} action */
const mutationDisabled = (action) => isSessionMutationPending(action) ? 'disabled aria-disabled="true" aria-busy="true"' : "";
/** @param {MutationAction} action @param {string} fallback */
const mutationLabel = (action, fallback) => isSessionMutationPending(action) ? mutationPendingLabels[action] : fallback;
/** @param {MutationAction} action */
function sessionMutationNotice(action) {
  const mutation = state.sessionMutation;
  if (mutation.action !== action) return "";
  if (mutation.pending) return `<div class="mutation-feedback is-pending" role="status" aria-live="polite"><span class="mutation-indicator" aria-hidden="true"></span><span>${mutationPendingLabels[action]}</span></div>`;
  if (!mutation.error) return "";
  const hint = action === "complete" ? "可以直接重试，未保存的实际值和动作反馈会保留。" : "可以直接重试。";
  return `<div class="mutation-feedback is-error" role="alert"><strong>${escapeHtml(mutation.error)}</strong><span>${hint}</span></div>`;
}
/** @param {MutationAction} action */
function beginSessionMutation(action) {
  if (state.sessionMutation.pending) return false;
  state.sessionMutation = { action, pending: true, error: null };
  state.error = null;
  render();
  return true;
}
function clearSessionMutation() { state.sessionMutation = { action: null, pending: false, error: null }; }
/** @param {MutationAction} action @param {any} error */
function failSessionMutation(action, error) {
  state.error = null;
  state.sessionMutation = { action, pending: false, error: error.data?.error?.message || error.message || "请求失败，请重试" };
  render();
}
/** @param {any} result */
function audioFailureFor(result) {
  if (result === false) return "音频播放失败";
  if (result && typeof result === "object" && result.ok === false) return result.error || "音频播放失败";
  return null;
}
/** @param {unknown} error */
function setAudioFailure(error) {
  const message = typeof error === "string" ? error : "音频播放失败";
  if (state.audio.status === "error" && state.audio.error === message) return;
  state.audio = { status: "error", error: message };
  render();
}
function setAudioReady() {
  if (state.audio.status === "ready" && state.audio.error === null) return;
  state.audio = { status: "ready", error: null };
  render();
}
/** @param {any} result */
function observeAudioResult(result) {
  if (result && typeof result.then === "function") {
    return result.then((/** @type {any} */ outcome) => {
      const error = audioFailureFor(outcome);
      if (error) setAudioFailure(error);
      else setAudioReady();
      return outcome;
    }).catch((/** @type {any} */ error) => { setAudioFailure(error?.message || "音频播放失败"); return { ok: false, error }; });
  }
  const error = audioFailureFor(result);
  if (error) setAudioFailure(error);
  else setAudioReady();
  return result;
}
function documentIsVisible() { return typeof document === "undefined" || document.hidden !== true; }
function wakeLockSupported() { return typeof navigator !== "undefined" && navigator.wakeLock && typeof navigator.wakeLock.request === "function"; }
function isExecutionSurface() { return state.view === "today" && state.sessionDetail?.status === "in_progress" && !state.endSheet; }
function isVisibleSession() { return isExecutionSurface() && !state.timerPaused && documentIsVisible(); }
/** @param {WorkoutSession|null|undefined} detail */
function hasOpenTrainingInterval(detail) { return Boolean(detail?.training_intervals?.some((interval) => interval.ended_at === null)); }
function shouldKeepWakeLock() { return isVisibleSession(); }
/** @param {string} reason */
function canPauseSession(reason) { return state.view === "today" && state.sessionDetail?.status === "in_progress" && (!state.endSheet || reason === "end-form"); }
function releaseWakeLock() {
  const sentinel = state.wakeLock.sentinel;
  state.wakeLock.sentinel = null;
  state.wakeLock.requestPending = false;
  state.wakeLock.requestId += 1;
  try {
    const result = sentinel?.release?.();
    result?.catch?.(() => {});
  } catch {}
}
/** @param {string} reason */
function pauseForInterruption(reason) {
  if (!canPauseSession(reason)) return Promise.resolve(null);
  const interruptionGeneration = ++resumeGeneration;
  invalidateAudioActivation();
  if (state.timerPaused && state.timerPauseReason === "manual") {
    const pendingResume = resumeRequestPromise;
    state.timerPauseReason = reason;
    workoutTimeline.cancel();
    releaseWakeLock();
    render();
    return Promise.resolve(pendingResume).catch(() => null).then(() => {
      if (interruptionGeneration !== resumeGeneration) return null;
      return persistSessionPause(pauseBoundary(state.sessionDetail, clockNow()));
    });
  }
  const now = clockNow();
  if (!state.timerPaused) {
    pauseExecutionTimers();
    state.timerPaused = true;
    state.timerPauseStartedAt = now;
  }
  state.timerPauseReason = reason;
  releaseWakeLock();
  render();
  return persistSessionPause(pauseBoundary(state.sessionDetail, now));
}
/** @param {string} reason */
async function ensureSessionPaused(reason) {
  if (state.sessionDetail?.status !== "in_progress" || state.view !== "today") return true;
  await pauseForInterruption(reason);
  return !hasOpenTrainingInterval(state.sessionDetail);
}
/** @param {WakeLockSentinel} sentinel */
function handleWakeLockRelease(sentinel) {
  if (state.wakeLock.sentinel !== sentinel) return;
  state.wakeLock.sentinel = null;
  state.wakeLock.requestPending = false;
  state.wakeLock.status = documentIsVisible() ? "released" : "hidden";
  void pauseForInterruption(documentIsVisible() ? "wake-lock" : "visibility");
}
async function requestWakeLock({ force = false } = {}) {
  if (!isVisibleSession() || !wakeLockSupported()) {
    if (isVisibleSession() && !wakeLockSupported()) state.wakeLock.status = "unsupported";
    return false;
  }
  if (state.wakeLock.sentinel && !state.wakeLock.sentinel.released) {
    state.wakeLock.status = "active";
    return true;
  }
  if (state.wakeLock.requestPending) return false;
  if (!force && ["unsupported", "denied", "released"].includes(state.wakeLock.status)) return false;
  const requestId = ++state.wakeLock.requestId;
  state.wakeLock.requestPending = true;
  state.wakeLock.status = "requesting";
  try {
    const sentinel = await navigator.wakeLock.request("screen");
    if (requestId !== state.wakeLock.requestId || !isVisibleSession()) {
      try { await sentinel?.release?.(); } catch {}
      return false;
    }
    if (sentinel?.released) {
      state.wakeLock.requestPending = false;
      state.wakeLock.status = "released";
      if (["preparing", "active"].includes(state.timedAction.phase)) pauseForInterruption("wake-lock");
      else render();
      return false;
    }
    state.wakeLock.sentinel = sentinel;
    state.wakeLock.requestPending = false;
    state.wakeLock.status = "active";
    const onRelease = () => handleWakeLockRelease(sentinel);
    if (typeof sentinel.addEventListener === "function") sentinel.addEventListener("release", onRelease);
    else sentinel.onrelease = onRelease;
    render();
    return true;
  } catch {
    if (requestId !== state.wakeLock.requestId) return false;
    state.wakeLock.requestPending = false;
    state.wakeLock.status = "denied";
    if (["preparing", "active"].includes(state.timedAction.phase)) pauseForInterruption("wake-lock");
    else render();
    return false;
  }
}
function syncWakeLock() {
  if (!isVisibleSession()) {
    if (state.wakeLock.sentinel || state.wakeLock.requestPending) releaseWakeLock();
    return;
  }
  if (!shouldKeepWakeLock()) {
    if (state.wakeLock.sentinel) releaseWakeLock();
    return;
  }
  if (state.wakeLock.sentinel || state.wakeLock.requestPending || ["unsupported", "denied", "released"].includes(state.wakeLock.status)) return;
  void requestWakeLock();
}
function wakeLockNotice() {
  if (!state.sessionDetail || state.sessionDetail.status !== "in_progress") return "";
  const status = state.wakeLock.status === "idle" && !wakeLockSupported() ? "unsupported" : state.wakeLock.status;
  if (state.timerPaused && state.timerPauseReason === "visibility") { const foreground = documentIsVisible(); return `<div class="notice session-wake-notice is-paused" role="status" aria-live="polite"><strong>${foreground ? "已回到前台，计时仍暂停" : "页面已离开前台，计时已暂停"}</strong><span>${foreground ? "准备好后点击顶部“继续”；后台时间不会计入动作或 Session 计时。" : "回到训练后点击顶部“继续”；后台时间不会计入动作或 Session 计时。"}</span></div>`; }
  if (state.timerPaused && state.timerPauseReason === "wake-lock") return `<div class="notice session-wake-notice is-paused" role="status" aria-live="polite"><strong>${status === "active" ? "已回到前台，计时仍暂停" : "屏幕保持已中断，计时已暂停"}</strong><span>${status === "active" ? "屏幕保持已重新请求。准备好后点击顶部“继续”。" : "准备好后点击顶部“继续”；未保持期间的时间不会计入动作或 Session 计时。"}</span></div>`;
  if (state.timerPaused) return `<div class="notice session-wake-notice is-paused" role="status" aria-live="polite"><strong>训练已暂停，计时已停止</strong><span>当前不在主动训练中；准备好后点击顶部“继续”。暂停期间不会计入 Session 计时。</span></div>`;
  if (status === "unsupported") return `<div class="notice session-wake-notice is-fallback" role="status" aria-live="polite"><strong>无法保持屏幕常亮</strong><span>当前浏览器不支持屏幕保持。计时仍可手动执行；若页面隐藏或锁屏，回到训练后会暂停并等待你继续。</span></div>`;
  if (status === "denied") return `<div class="notice session-wake-notice is-fallback" role="status" aria-live="polite"><strong>屏幕保持未获允许</strong><span>应用不能保证屏幕常亮，但“开始动作”和手动计时仍可使用；若页面隐藏或锁屏，回到训练后会暂停并等待你继续。</span></div>`;
  return "";
}
function handleVisibilityChange() {
  if (!documentIsVisible()) {
    if (state.sessionDetail?.status === "in_progress" && state.view === "today") {
      state.wakeLock.status = "hidden";
      releaseWakeLock();
      void pauseForInterruption("visibility");
    }
    return;
  }
  if (state.sessionDetail?.status !== "in_progress" || state.view !== "today") return;
  if (state.timerPaused) {
    if (state.timerPauseReason === "visibility") state.wakeLock.status = "idle";
    return render();
  }
  if (wakeLockSupported()) {
    state.wakeLock.status = "idle";
    void requestWakeLock({ force: true });
  } else state.wakeLock.status = "unsupported";
  render();
}
/** @param {WorkoutSession|null|undefined} session */
const isExpiredSession = (session) => Boolean(session?.status === "in_progress" && state.today?.date && session.scheduled_date < state.today.date);
/** @param {JsonRecord} entry @param {WorkoutSession|null|undefined} session */
const calendarStatus = (entry, session) => { if (entry.kind === "rest") return { key: "rest", label: "休息日" }; if (entry.kind === "no_plan") return { key: "no_plan", label: "无计划" }; if (isExpiredSession(session)) return { key: "partial", label: "未完成" }; if (session?.status === "in_progress") return { key: "in_progress", label: "进行中" }; if (session?.status === "completed") return { key: "completed", label: "已完成" }; if (session?.status === "partial") return { key: "partial", label: "未完成" }; if (session?.status === "skipped") return { key: "skipped", label: "已跳过" }; if (entry.recording_evidence?.status === "recorded") return { key: "recorded", label: "已记录" }; if (entry.is_overdue_unstarted) return { key: "overdue", label: "未开始" }; if (entry.date === state.today?.date) return { key: "today", label: "未开始" }; return { key: "scheduled", label: "未开始" }; };
/** @param {string} date */
const monthStart = (date) => `${date.slice(0, 7)}-01`;
/** @param {string} date @param {number} offset */
const shiftMonth = (date, offset) => { const [year, month] = date.slice(0, 7).split("-").map(Number); const shifted = new Date(Date.UTC(year, month - 1 + offset, 1)); return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`; };
/** @param {string} range */
const progressRangeLabel = (range) => ({ current: "当月", previous: "上月", all: "累计" }[range] || "当月");
function progressQuery(range = state.progressRange) { const today = state.today?.date; if (!today) return "preset=all"; if (range === "all") return "preset=all"; if (range === "previous") { const from = shiftMonth(today, -1); return `from=${from}&to=${addCalendarDays(monthStart(today), -1)}`; } return `from=${monthStart(today)}&to=${today}`; }

async function refresh() {
  state.loading = true; render();
  try {
    [state.today, state.plan] = await Promise.all([api("/api/private/today"), api("/api/private/plan")]);
    if (!state.today) throw new Error("Today response is missing");
    state.progress = await api(`/api/private/progress?${progressQuery()}`);
    state.session = state.today.session;
    state.todayDetail = null;
    if (state.session?.session_key) {
      try { state.todayDetail = await api(`/api/private/sessions/${state.session.session_key}`); } catch {}
    }
    state.error = null;
  } catch (/** @type {any} */ error) {
    if (error.status === 401) { state.authRequired = true; state.error = null; }
    else state.error = error.data?.error?.message || error.message;
  }
  state.loading = false; render();
}

/** @param {string} range */
async function loadProgress(range) {
  state.progressRange = range;
  state.progressLoading = true;
  render();
  try { state.progress = await api(`/api/private/progress?${progressQuery(range)}`); state.error = null; }
  catch (/** @type {any} */ error) { state.error = error.data?.error?.message || error.message; }
  state.progressLoading = false;
  render();
}

async function loadRecordsOverview() {
  state.recordsOverviewLoading = true;
  state.error = null;
  render();
  try {
    state.recordsOverview = await api("/api/private/records/overview");
  } catch (/** @type {any} */ error) {
    state.error = error.data?.error?.message || error.message;
  }
  state.recordsOverviewLoading = false;
  if (state.view === "progress" && state.recordsTab === "overview") render();
}

async function loadAerobicActivities() {
  state.aerobic.loading = true;
  state.aerobic.error = null;
  render();
  try {
    const query = [`limit=200`];
    if (state.aerobic.from && state.aerobic.to) { query.push(`from=${encodeURIComponent(state.aerobic.from)}`, `to=${encodeURIComponent(state.aerobic.to)}`); }
    state.aerobic.list = await api(`/api/private/records/aerobic?${query.join("&")}`);
    state.aerobic.error = null;
  } catch (/** @type {any} */ error) {
    state.aerobic.error = error.data?.error?.message || error.message;
  }
  state.aerobic.loading = false;
  if (state.view === "progress" && state.recordsTab === "aerobic") render();
}

/** @param {string} activityRef */
async function openAerobicDetail(activityRef) {
  state.aerobic.detailLoading = true;
  state.aerobic.detail = null;
  state.aerobic.routesOpen = false;
  state.aerobic.routeDetail = null;
  state.aerobic.routeOrigin = null;
  state.aerobic.error = null;
  render();
  try {
    state.aerobic.detail = await api(`/api/private/records/aerobic/${encodeURIComponent(activityRef)}`);
  } catch (/** @type {any} */ error) {
    state.aerobic.error = error.data?.error?.message || error.message;
  }
  state.aerobic.detailLoading = false;
  render();
}

async function loadRoutes() {
  state.aerobic.routesLoading = true;
  state.aerobic.error = null;
  render();
  try {
    state.aerobic.routes = await api("/api/private/records/routes?limit=200");
  } catch (/** @type {any} */ error) {
    state.aerobic.error = error.data?.error?.message || error.message;
  }
  state.aerobic.routesLoading = false;
  if (state.view === "progress" && state.recordsTab === "aerobic") render();
}

/** @param {string} routeKey @param {string} [origin] */
async function openRouteDetail(routeKey, origin = "list") {
  if (!routeKey) return;
  state.aerobic.routesOpen = true;
  state.aerobic.routeOrigin = origin;
  state.aerobic.routeDetailLoading = true;
  state.aerobic.routeDetail = null;
  state.aerobic.error = null;
  render();
  try {
    state.aerobic.routeDetail = await api(`/api/private/records/routes/${encodeURIComponent(routeKey)}?limit=200`);
  } catch (/** @type {any} */ error) {
    state.aerobic.error = error.data?.error?.message || error.message;
  }
  state.aerobic.routeDetailLoading = false;
  if (state.view === "progress" && state.recordsTab === "aerobic") render();
}

/** @param {string} content */
function shell(content) {
  const focused = state.view === "today" && state.sessionDetail?.status === "in_progress";
  return `<div class="shell ${focused ? "session-shell" : ""}"><main>${content}</main>${state.message ? `<div class="notice" role="status">${escapeHtml(state.message)}</div>` : ""}${focused ? "" : `<nav class="bottom-nav" aria-label="主导航">${[["today", "今日"], ["calendar", "日历"], ["progress", "记录"], ["settings", "设置"]].map(([id, label]) => `<button class="nav-link ${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}</nav>`}</div>`;
}

function render() {
  if (state.authRequired) { app.innerHTML = loginView(); bind(); syncSessionClock(); syncWakeLock(); return; }
  if (state.loading) { stopSessionClock(); app.innerHTML = shell(`<section class="loading"><span class="spinner"></span><p>正在读取你的训练状态…</p></section>`); syncWakeLock(); return; }
  if (state.error) { app.innerHTML = shell(`<section class="error-card"><p>${escapeHtml(state.error)}</p><button class="primary" data-action="refresh">重新读取</button></section>`); bind(); syncSessionClock(); syncWakeLock(); return; }
  const content = state.view === "today" ? todayView() : state.view === "calendar" ? calendarView() : state.view === "progress" ? recordsView() : settingsView();
  app.innerHTML = shell(content); bind(); syncSessionClock(); syncWakeLock();
}

function loginView() {
  return `<div class="shell"><main><section class="hero"><p class="eyebrow">WORKOUT TRACKER</p><h1>登录你的训练空间</h1><p class="muted">使用已配置的登录凭据访问训练空间。</p></section><form class="settings-form" data-form="login"><label>邮箱<input name="email" type="email" autocomplete="username" required /></label><label>密码<input name="password" type="password" autocomplete="current-password" required /></label>${state.authMessage ? `<div class="validation-error">${escapeHtml(state.authMessage)}</div>` : ""}<button class="primary wide">登录</button></form></main></div>`;
}

function todayView() {
  const today = state.today; const entry = today?.entry; const session = state.session || today?.session;
  if (!entry || entry.kind === "no_plan") return `<section class="today-page"><div class="today-content"><p class="eyebrow">${state.today?.date || "今天"}</p><h1>今天没有计划</h1><p class="muted">可以在设置中提交未来训练计划。</p></div></section>`;
  if (entry.kind === "rest") return `<section class="today-page"><div class="today-content"><p class="eyebrow">${today?.date ?? "今天"}</p><span class="status-dot rest"></span><h1>休息日</h1><p class="muted">今天不安排训练。</p><div class="quiet-card">今天把恢复留给自己。</div></div></section>`;
  if (session) return state.correction && state.todayDetail ? correctionView(state.todayDetail, entry) : sessionView(session, entry);
  const plan = entry.prescription;
  if (entry.recording_intent) return `<section class="today-page"><div class="today-content"><p class="eyebrow">${today?.date ?? "今天"}</p><h1>${escapeHtml(entry.title)}</h1><p class="muted">约 ${entry.estimated_duration_min} 分钟</p>${recordingGuide(entry)}</div></section>`;
  return `<section class="today-page"><div class="today-content"><p class="eyebrow">${today?.date ?? "今天"}</p><h1>${escapeHtml(entry.title)}</h1><p class="muted">约 ${entry.estimated_duration_min} 分钟</p><div class="hero-actions"><button class="primary" data-action="start" ${mutationDisabled("start")}>${mutationLabel("start", "开始训练")}</button><button class="secondary" data-action="skip">跳过今天</button></div>${sessionMutationNotice("start")}<section class="today-plan calendar-prescription" aria-label="今日训练计划"><div class="today-plan-head"><h2>今日训练计划</h2><span>${entry.module_count} 个模块</span></div>${plan ? renderCalendarPrescription(plan) : `<p class="muted">今天的训练计划暂时无法读取。</p>`}</section></div></section>`;
}

function canonicalDurationSeconds(/** @type {any} */ target) {
  if (target?.metric !== "duration_sec") return null;
  if (Number.isInteger(target.value) && target.value > 0) return target.value;
  return Number.isInteger(target.max) && target.max > 0 ? target.max : null;
}

function timedActionFor(/** @type {any} */ item) {
  return state.timedAction.itemKey === item?.completion_item_key ? state.timedAction : blankTimedAction();
}

function formatActionRemaining(/** @type {any} */ seconds) { if (seconds == null) return "—"; return String(Math.max(0, Math.ceil(Number(seconds) || 0))).padStart(2, "0"); }

function timedActionView(/** @type {any} */ item, /** @type {any} */ context, /** @type {any} */ result) {
  const targetSec = canonicalDurationSeconds(item.target);
  const timer = timedActionFor(item);
  const isComplete = timer.phase === "complete";
  const isRunning = timer.phase === "preparing" || timer.phase === "active";
  const pausedStatus = state.timerPauseReason === "visibility" ? "页面已离开前台 · 计时已暂停 · 回到前台后点击顶部继续" : state.timerPauseReason === "wake-lock" ? "屏幕保持已中断 · 计时已暂停 · 点击顶部继续" : "已暂停 · 点击顶部继续";
  const status = state.timerPaused ? pausedStatus : timer.phase === "preparing" ? "准备中 · 5 秒后开始" : timer.phase === "active" ? "动作进行中" : isComplete ? "时间到 · 修改实际值后点击完成" : "固定目标 · 点击开始动作";
  const actionLabel = isComplete ? "动作已结束" : isRunning ? "计时进行中" : "开始动作";
  const actionDisabled = isRunning || isComplete || state.timerPaused;
  const actualDraft = state.actualDrafts[item.completion_item_key] ?? result?.actual?.value ?? (isComplete ? targetSec : "");
  const actualDisabled = !isComplete || isSessionMutationPending("complete");
  const rirDraft = state.rirDrafts[item.completion_item_key] ?? result?.rir ?? "";
  const rirField = context.set?.target_rir != null || result?.rir != null ? `<label>RIR<input id="actual-rir" data-completion-key="${item.completion_item_key}" type="number" min="0" max="10" value="${escapeHtml(rirDraft)}" ${actualDisabled ? "disabled" : ""} /></label>` : "";
  return `<section class="timed-execution" aria-label="固定时长动作"><div class="timed-execution-heading"><span class="timed-execution-label">固定时长</span><span>${targetSec} 秒</span></div><div class="timed-action-state" role="status" aria-live="polite">${escapeHtml(status)}</div><div class="timed-remaining" data-action-remaining aria-live="polite" aria-label="动作剩余时间">${formatActionRemaining(timer.phase === "idle" ? null : timer.remainingSec ?? targetSec)}</div><button class="primary wide timed-start" data-action="start-timed" ${actionDisabled ? "disabled aria-disabled=\"true\"" : ""}>${actionLabel}</button><div class="timed-actual-fields"><label>实际时长（秒）<input id="actual-value" data-completion-key="${item.completion_item_key}" type="number" min="1" value="${escapeHtml(actualDraft)}" placeholder="归零后自动填入" ${actualDisabled ? "disabled" : ""} /></label>${rirField}</div></section>`;
}

function sessionView(/** @type {any} */ session, /** @type {any} */ entry) {
  const detail = state.sessionDetail;
  const items = detail ? displayCompletionItems(detail) : [];
  if (session.status === "skipped") return `<section class="hero"><span class="status-pill skipped">已跳过</span><h1>${escapeHtml(entry.title)}</h1><p class="muted">跳过保留在今天的记录中。你仍可以在今天重新开始。</p><button class="primary" data-action="restart" ${mutationDisabled("restart")}>${mutationLabel("restart", "重新开始训练")}</button>${sessionMutationNotice("restart")}</section>`;
  if (!detail) return todayProgressView(session, entry, state.todayDetail);
  if ((state.restUntil || state.restRemainingMs != null) && state.restNextIndex != null) return restView(detail, items);
  const item = items[state.focusIndex] || items[0]; const result = resultForDisplay(detail, item); const isDone = displayItemDone(detail, item);
  if (session.status === "completed" || session.status === "partial") {
    if (state.correction) return correctionView(detail, entry);
    return sessionSummaryView(session, entry, detail);
  }
  const context = itemContext(detail, item); const target = focusTarget(item.target); const tempoValue = context.set?.tempo ?? item.tempo; const tempo = typeof tempoValue === "string" ? tempoValue : formatTempo(tempoValue); const parts = [`计划：${target}`, focusResistance(context.set?.resistance ?? canonicalSetResistance(context.set) ?? item.resistance), tempo ? `节奏 ${tempo}` : null, context.set?.target_rir == null ? null : `RIR ${context.set.target_rir}`, context.set?.rest_after_sec == null ? null : `休息 ${context.set.rest_after_sec} 秒`].filter(Boolean); const actual = result?.actual;
  const timedDuration = canonicalDurationSeconds(item.target); const isTimed = timedDuration != null; const timedTimer = timedActionFor(item);
  const actualRows = `<div class="actual-row"><span>${item.target.metric === "reps" ? "次数" : "时长"}</span><strong>${actual ? `${target} / <em>${formatActual(actual)}</em>` : target}</strong></div>${context.set?.resistance ? `<div class="actual-row"><span>重量</span><strong>${focusResistance(context.set.resistance)}</strong></div>` : ""}${context.set?.target_rir != null || result?.rir != null ? `<div class="actual-row"><span>RIR</span><strong>${result?.rir == null ? context.set?.target_rir ?? "—" : `<em>${result.rir}</em>`}</strong></div>` : ""}`;
  const feedbackText = state.feedbackDraft[item.exercise_occurrence_key] ?? detail.exercise_feedback.find((entry) => entry.exercise_occurrence_key === item.exercise_occurrence_key)?.text ?? "";
  const feedback = `<textarea class="focus-feedback-input" id="feedback-${item.exercise_occurrence_key}" data-exercise-key="${item.exercise_occurrence_key}" maxlength="500" placeholder="记录感受">${escapeHtml(feedbackText)}</textarea>`;
  const actualDraft = state.actualDrafts[item.completion_item_key] ?? actual?.value ?? item?.target?.value ?? item?.target?.min ?? 1;
  const rirDraft = state.rirDrafts[item.completion_item_key] ?? result?.rir ?? "";
  const completeBlocked = isDone || state.timerPaused || isSessionMutationPending("complete") || (isTimed && timedTimer.phase !== "complete");
  const adjustButton = isTimed ? "" : `<button class="secondary" data-action="toggle-adjust">${state.adjust ? "收起调整" : "调整"}</button>`;
  const resistanceDraft = state.resistanceDrafts[item.completion_item_key] ?? resistanceDraftValue(item, result);
  const resistanceField = editableResistance(item) ? `<label>实际重量（kg）<input id="actual-weight" data-completion-key="${item.completion_item_key}" type="number" min="0" step="0.1" value="${escapeHtml(resistanceDraft)}" /></label>` : "";
  const adjustPanel = isTimed ? "" : state.adjust ? `<div class="adjust-panel"><label>实际 ${item?.target?.metric === "reps" ? "次数" : "秒数"}<input id="actual-value" data-completion-key="${item.completion_item_key}" type="number" min="1" value="${escapeHtml(actualDraft)}" /></label>${resistanceField}<label>RIR<input id="actual-rir" data-completion-key="${item.completion_item_key}" type="number" min="0" max="10" value="${escapeHtml(rirDraft)}" /></label><button class="primary wide" data-action="save-adjust" ${mutationDisabled("complete")}>${mutationLabel("complete", "保存并完成")}</button></div>` : "";
  return `${sessionHeader(detail)}${timerMutationNotice()}${progressDisclosure(detail, items)}${wakeLockNotice()}${audioNotice()}<div class="focus-workout-scroll"><section class="focus-stage"><span class="focus-count">${state.focusIndex + 1} / ${items.length} · ${escapeHtml(context.block?.title || (item.target.metric === "reps" ? "力量" : "训练"))}</span><div class="focus-exercise-head"><h2>${escapeHtml(itemLabel(detail, item))}</h2><span class="focus-execution-mode">${exerciseExecutionModeLabel(context.exercise)}</span></div><p class="focus-prescription">${escapeHtml(parts.join(" · "))}</p>${isTimed ? timedActionView(item, context, result) : ""}<div class="actual-panel">${actualRows}</div><div class="feedback-area">${feedback}</div><div class="focus-actions"><button class="primary wide" data-action="complete" ${completeBlocked ? "disabled" : ""} ${isSessionMutationPending("complete") ? 'aria-disabled="true" aria-busy="true"' : ""}>${isDone ? "已完成" : mutationLabel("complete", "完成")}</button><div class="focus-secondary ${isTimed ? "is-timed" : ""}"><button class="secondary" data-action="previous" ${state.focusIndex === 0 ? "disabled" : ""}>上一项</button>${adjustButton}<button class="secondary" data-action="next" ${state.focusIndex >= items.length - 1 ? "disabled" : ""}>下一项</button></div>${adjustPanel}${sessionMutationNotice("complete")}</div></section></div>${sessionFooter(detail)}${state.endSheet ? endSheet(detail) : ""}`;
}

function restView(/** @type {any} */ detail, /** @type {any} */ items) {
  const next = items[state.restNextIndex] || items[state.focusIndex];
  const context = itemContext(detail, next);
  return `${sessionHeader(detail, false)}${timerMutationNotice()}${progressDisclosure(detail, items)}${wakeLockNotice()}${audioNotice()}<section class="rest-screen"><span class="rest-label">组间休息</span><h2>放松，准备下一项</h2><div class="rest-time" data-rest-remaining aria-live="polite" aria-label="休息剩余时间">${formatRestRemaining()}</div><div class="next-context"><span>接下来</span><strong>${escapeHtml(itemLabel(detail, next))}</strong><small>${escapeHtml(focusTarget(next.target))}</small></div><button class="secondary" data-action="skip-rest">跳过休息</button></section>${sessionFooter(detail, false)}`;
}

function sessionSummaryView(/** @type {any} */ session, /** @type {any} */ entry, /** @type {any} */ detail) {
  const items = displayCompletionItems(detail);
  const rows = items.map((item, index) => {
    const result = resultForDisplay(detail, item);
    const done = displayItemDone(detail, item);
    const actual = result?.actual ? `实际：${formatActual(result.actual)}` : "未完成";
    return `<div class="session-item-row ${done ? "is-complete" : "is-unfinished"}"><span class="session-item-index">${done ? "✓" : index + 1}</span><div class="session-item-main"><strong>${escapeHtml(itemLabel(detail, item))}</strong><small>计划：${escapeHtml(focusTarget(item.target))} · ${escapeHtml(actual)}${result?.rir == null ? "" : ` · RIR ${result.rir}`}</small></div><span class="session-item-status">${done ? "已完成" : "未完成"}</span></div>`;
  }).join("");
  const feedback = (detail.exercise_feedback || []).filter((/** @type {any} */ item) => item.text).map((/** @type {any} */ item) => `<p><strong>${escapeHtml(exerciseName(detail, { exercise_occurrence_key: item.exercise_occurrence_key }))}</strong>${escapeHtml(item.text)}</p>`).join("");
  const completedCount = items.filter((item) => displayItemDone(detail, item)).length;
  return `<section class="session-summary-page"><section class="session-summary-hero"><span class="status-pill ${session.status}">${session.status === "completed" ? "已完成" : "部分完成"}</span><h1>${escapeHtml(entry.title)}</h1><div class="metric-large">${pct(session.completion_fraction)}</div><p class="muted">训练时长 ${session.training_duration_sec} 秒${session.session_rpe == null ? "" : ` · RPE ${session.session_rpe}`}</p></section><section class="session-summary-card"><div class="session-summary-heading"><h2>训练项目</h2><span>${completedCount} / ${items.length} 项完成</span></div>${rows}</section>${feedback ? `<section class="session-summary-feedback"><h2>动作反馈</h2>${feedback}</section>` : ""}<div class="hero-actions">${session.status === "partial" ? `<button class="primary" data-action="continue" ${mutationDisabled("continue")}>${mutationLabel("continue", "继续训练")}</button>${sessionMutationNotice("continue")}` : ""}<button class="secondary" data-action="edit-session">校正记录</button></div></section>`;
}

function todayProgressView(/** @type {any} */ session, /** @type {any} */ entry, /** @type {any} */ detail) {
  const items = detail ? displayCompletionItems(detail) : [];
  const completed = detail?.completion_results || [];
  const fraction = detail?.completion_fraction ?? session.completion_fraction ?? 0;
  const rows = detail ? items.map((item, index) => {
    const result = resultForDisplay(detail, item);
    const done = displayItemDone(detail, item);
    const context = itemContext(detail, item);
    const plan = [focusTarget(item.target), focusResistance(context.set?.resistance ?? canonicalSetResistance(context.set) ?? item.resistance)].filter(Boolean).join(" · ");
    const actual = result?.actual ? `实际：${formatActual(result.actual)}` : "未完成";
    return `<div class="today-item-row ${done ? "is-complete" : "is-unfinished"}"><span class="today-item-index">${done ? "✓" : index + 1}</span><span class="today-item-main"><strong>${escapeHtml(itemLabel(detail, item))}</strong><small>计划：${escapeHtml(plan)} · ${escapeHtml(actual)}${result?.rir == null ? "" : ` · RIR ${result.rir}`}</small></span><span class="today-item-status">${done ? "已完成" : "未完成"}</span></div>`;
  }).join("") : "";
  const actionName = session.status === "partial" ? "continue" : "open-session";
  const action = session.status === "in_progress" || session.status === "partial" ? `<button class="primary wide" data-action="${actionName}" ${actionName === "continue" ? mutationDisabled("continue") : ""}>${actionName === "continue" ? mutationLabel("continue", "继续训练") : "继续训练"}</button>${actionName === "continue" ? sessionMutationNotice("continue") : ""}` : `<button class="secondary wide" data-action="open-session">查看训练记录</button>`;
  const completedCount = items.filter((item) => displayItemDone(detail, item)).length;
  return `<section class="today-page"><div class="today-content"><p class="eyebrow">${state.today?.date || "今天"}</p><h1>${escapeHtml(entry.title)}</h1><section class="today-progress-card"><div class="today-progress-head"><strong>${completedCount} / ${items.length || Math.round(1 / (fraction || 1))} 项完成</strong><span>${pct(fraction)}</span></div><div class="progress-line"><span style="width:${pct(fraction)}"></span></div>${rows || `<p class="muted">训练记录已保存。</p>`}</section>${action}${session.status === "completed" || session.status === "partial" ? `<button class="text-button wide" data-action="edit-session">校正记录</button>` : ""}</div></section>`;
}

function sessionMuteControl() { const label = state.muted ? "开启提示音" : "静音提示音"; return `<button class="session-mute-toggle" data-action="toggle-mute" aria-pressed="${state.muted}" aria-label="${label}">${state.muted ? "开启声音" : "静音"}</button>`; }
function timerMutationPending() { return isSessionMutationPending("pause") || isSessionMutationPending("resume"); }
function sessionHeader(/** @type {any} */ detail, showTimer = true) { const retryPause = state.timerPaused && state.sessionMutation.action === "pause" && state.sessionMutation.error; const mutationAction = /** @type {MutationAction} */ (state.sessionMutation.action); const timerLabel = timerMutationPending() ? mutationPendingLabels[mutationAction] : retryPause ? "重试暂停" : state.timerPaused ? "继续" : "暂停"; const timerAction = detail?.status === "in_progress" ? `<button class="session-timer-toggle" data-action="toggle-timer" aria-pressed="${state.timerPaused}" ${timerMutationPending() ? 'disabled aria-disabled="true" aria-busy="true"' : ""}>${timerLabel}</button>` : ""; return `<header class="session-header"><button class="session-header-side" data-action="minimize" aria-label="返回今日">‹</button><strong ${showTimer ? "data-session-elapsed" : ""}>${showTimer ? formatElapsed(detail) : "组间休息"}</strong><div class="session-header-actions">${sessionMuteControl()}${timerAction}</div></header>`; }
function timerMutationNotice() { return sessionMutationNotice("pause") || sessionMutationNotice("resume"); }
function sessionFooter(/** @type {any} */ detail, showTimer = true) { return `<footer class="session-footer"><strong ${showTimer ? "data-session-elapsed" : ""}>${showTimer ? formatElapsed(detail) : "组间休息"}</strong><button class="secondary" data-action="end">结束训练</button></footer>`; }
function progressDisclosure(/** @type {any} */ detail, /** @type {any} */ items) { const completed = items.filter((/** @type {any} */ item) => displayItemDone(detail, item)).length; const fraction = items.length ? completed / items.length : 0; return `<section class="session-progress"><button class="session-progress-toggle" data-action="toggle-progress" aria-expanded="${state.progressOpen}"><span><strong>${completed} / ${items.length} 完成</strong><span class="progress-line"><span style="width:${pct(fraction)}"></span></span></span><span class="progress-chevron">${state.progressOpen ? "⌃" : "⌄"}</span></button>${state.progressOpen ? `<div class="progress-list focus-progress">${items.map((/** @type {any} */ candidate, /** @type {any} */ index) => { const done = displayItemDone(detail, candidate); return `<button class="list-row ${index === state.focusIndex ? "active" : ""}" data-action="jump-item" data-index="${index}"><span>${index + 1}. ${escapeHtml(itemLabel(detail, candidate))}</span><span>${done ? "✓" : "○"}</span></button>`; }).join("")}</div>` : ""}</section>`; }
function itemContext(/** @type {any} */ detail, /** @type {any} */ item) { const block = detail?.snapshot?.blocks?.find((/** @type {any} */ candidate) => candidate.exercises.some((/** @type {any} */ exercise) => (exercise.exercise_occurrence_key || exercise.occurrence_key) === item?.exercise_occurrence_key)); const exercise = block?.exercises?.find((/** @type {any} */ candidate) => (candidate.exercise_occurrence_key || candidate.occurrence_key) === item?.exercise_occurrence_key); const setIndex = exercise?.sets?.findIndex((/** @type {any} */ set) => (set.set_key || set.set_id) === item?.set_key) ?? -1; return { block, exercise, set: setIndex >= 0 ? exercise.sets[setIndex] : null, setNumber: setIndex >= 0 ? setIndex + 1 : null }; }
function itemLabel(/** @type {any} */ detail, /** @type {any} */ item) { const context = itemContext(detail, item); const side = item?.side === "left" ? "左" : item?.side === "right" ? "右" : item?.side === "both" ? "双侧" : item?.alternating ? "交替" : ""; return `${exerciseName(detail, item)}${context.setNumber ? ` · 第 ${context.setNumber} 组` : ""}${side ? ` · ${side}` : ""}`; }
function displayCompletionItems(/** @type {any} */ detail) { const raw = detail?.snapshot?.completion_items || []; const result = []; for (let index = 0; index < raw.length; index += 1) { const item = raw[index]; const next = raw[index + 1]; const exercise = detail.snapshot.blocks?.flatMap((/** @type {any} */ block) => block.exercises || []).find((/** @type {any} */ candidate) => (candidate.exercise_occurrence_key || candidate.occurrence_key) === item.exercise_occurrence_key); if (exercise?.execution_mode === "alternating" && item.side === "left" && next?.side === "right" && next.exercise_occurrence_key === item.exercise_occurrence_key && next.set_key === item.set_key) { result.push({ ...item, side: "alternating", alternating: true, completion_item_keys: [item.completion_item_key, next.completion_item_key] }); index += 1; } else result.push(item); } return result; }
function completionKeys(/** @type {any} */ item) { return item?.completion_item_keys || (item?.completion_item_key ? [item.completion_item_key] : []); }
function resultForDisplay(/** @type {any} */ detail, /** @type {any} */ item) { const keys = new Set(completionKeys(item)); const results = (detail?.completion_results || []).filter((/** @type {any} */ result) => keys.has(result.completion_item_key)); return results[0] || null; }
function displayItemDone(/** @type {any} */ detail, /** @type {any} */ item) { const keys = completionKeys(item); const results = new Map((detail?.completion_results || []).map((/** @type {any} */ result) => [result.completion_item_key, result])); return keys.length > 0 && keys.every((/** @type {any} */ key) => { const result = results.get(key); return result && (result.status ? result.status === "completed" : result.completed === true); }); }
function canonicalSetResistance(/** @type {any} */ set) { if (set?.resistance_mode === "bodyweight") return { mode: "bodyweight" }; if (set?.resistance_mode === "external_load") return { mode: "external_load", load_kg: set.resistance_kg, quantity: 1 }; return null; }
function isCanonicalSnapshotItem(/** @type {any} */ item) { return Boolean(item && (Object.hasOwn(item, "set_id") || Object.hasOwn(item, "resistance_mode"))); }
function resistanceModeOf(/** @type {any} */ value) { return value?.resistance_mode ?? value?.resistance?.mode ?? value?.mode ?? null; }
function resistanceLoadKg(/** @type {any} */ value) { return value?.resistance_kg ?? value?.resistance?.load_kg ?? value?.resistance?.value ?? (value?.mode ? value.load_kg : null); }
function editableResistance(/** @type {any} */ item) { return ["external_load", "external_weight", "assisted_weight"].includes(resistanceModeOf(item)); }
function resistanceDraftValue(/** @type {any} */ item, result = null) { const value = resistanceLoadKg(result) ?? resistanceLoadKg(item); return value == null ? "" : String(value); }
function canonicalResultResistanceInput(/** @type {any} */ item, loadValue = undefined) { const mode = resistanceModeOf(item); if (mode === "bodyweight") return { mode: "bodyweight" }; if (mode === "external_load") { const loadKg = loadValue === undefined ? resistanceLoadKg(item) : loadValue; return loadKg === "" || loadKg == null ? null : { mode: "external_load", value: Number(loadKg), unit: "kg" }; } return null; }
function legacyResultResistanceInput(/** @type {any} */ item, loadValue = undefined) { const resistance = item?.resistance; if (!resistance) return null; if (resistance.mode === "bodyweight") return { ...resistance }; if (["external_weight", "assisted_weight"].includes(resistance.mode)) { const loadKg = loadValue === undefined ? resistance.load_kg : loadValue; return { ...resistance, load_kg: loadKg === "" || loadKg == null ? null : Number(loadKg) }; } return { ...resistance }; }
function resultResistanceInput(/** @type {any} */ item, /** @type {any} */ loadValue = undefined) { return isCanonicalSnapshotItem(item) ? canonicalResultResistanceInput(item, loadValue) : legacyResultResistanceInput(item, loadValue); }
function canonicalStoredResultInput(/** @type {any} */ result, /** @type {any} */ detail) { const item = detail.snapshot.completion_items.find((/** @type {any} */ candidate) => candidate.completion_item_key === result.completion_item_key); const status = result.status || (result.completed ? "completed" : "partial"); const mode = resistanceModeOf(result); const resistance = mode === "bodyweight" ? { mode: "bodyweight" } : mode === "external_load" ? (() => { const loadKg = resistanceLoadKg(result); return loadKg == null ? null : { mode: "external_load", value: loadKg, unit: "kg" }; })() : canonicalResultResistanceInput(item); return { completion_item_key: result.completion_item_key, status, actual: result.actual ?? null, resistance, rir: result.rir ?? null, note: result.note ?? null, completed_at: result.completed_at ?? null }; }
function focusTarget(/** @type {any} */ target) { if (!target) return "未指定目标"; const fixedDuration = canonicalDurationSeconds(target); if (fixedDuration != null) return `${fixedDuration} 秒`; const unit = target.metric === "reps" ? "次" : target.metric === "duration_sec" ? "秒" : target.metric; const value = target.value ?? (target.min === target.max ? target.min : `${target.min}–${target.max}`); return `${value} ${unit}`; }
function focusResistance(/** @type {any} */ resistance) { if (!resistance) return ""; if (resistance.mode === "bodyweight") return "自重"; if (resistance.mode === "external_weight" || resistance.mode === "external_load") return `${resistance.load_kg ?? resistance.value ?? "—"} kg${resistance.quantity && resistance.quantity !== 1 ? ` × ${resistance.quantity}` : ""}`; return resistance.mode || "阻力未指定"; }
function formatElapsed(/** @type {any} */ detail, now = clockNow()) { const seconds = (detail?.training_intervals || []).reduce((/** @type {any} */ total, /** @type {any} */ interval) => { const end = interval.ended_at ? Date.parse(interval.ended_at) : state.timerPaused && state.timerPauseStartedAt ? state.timerPauseStartedAt : now; return total + Math.max(0, (end - Date.parse(interval.started_at)) / 1000); }, 0); const value = Math.max(0, Math.round(seconds)); const minutes = Math.floor(value / 60); const secs = value % 60; return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`; }
function formatRestRemaining() { const milliseconds = state.restUntil == null ? state.restRemainingMs ?? 0 : Math.max(0, state.restUntil - countdownNow()); const seconds = Math.max(0, Math.ceil(milliseconds / 1000)); const minutes = Math.floor(seconds / 60); return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function invalidateAudioActivation() { audioActivationGeneration += 1; }
function resetTimedAction() { invalidateAudioActivation(); state.timedAction = blankTimedAction(); workoutTimeline.cancel(); }
function clearRestCountdown({ cancelAudio = true } = {}) { invalidateAudioActivation(); state.restUntil = null; state.restRemainingMs = null; state.restNextIndex = null; if (cancelAudio) workoutTimeline.cancel(); }
function pauseRestCountdown(now = countdownNow()) {
  if (state.restUntil == null) return;
  state.restRemainingMs = Math.max(0, state.restUntil - now);
  state.restUntil = null;
}
function resumeRestCountdown(now = countdownNow()) {
  if (state.restRemainingMs == null) return;
  const audible = !state.muted && state.audio.status === "ready";
  const scheduled = workoutTimeline.scheduleRest({ remainingMs: state.restRemainingMs, audible });
  state.restUntil = scheduled.endsAtMs;
  state.restRemainingMs = null;
  if (audible) observeAudioResult(scheduled.result);
}
function pauseExecutionTimers() { invalidateAudioActivation(); pauseTimedAction(countdownNow()); pauseRestCountdown(countdownNow()); workoutTimeline.cancel(); }
function resumeExecutionTimers() { resumeTimedAction(countdownNow()); resumeRestCountdown(countdownNow()); }
function audioNotice() {
  if (state.muted || state.audio.status !== "error") return "";
  return `<div class="notice timed-audio-notice" role="alert"><strong>声音未开启</strong><span>提示音播放失败，计时仍可继续。请检查 iPhone 的音量和静音开关后，再点击开始动作重试。</span></div>`;
}
function updateTimedAction(now = countdownNow()) {
  const timer = state.timedAction;
  if (timer.phase !== "preparing" && timer.phase !== "active") return false;
  let shouldRender = false;
  if (timer.phase === "preparing") {
    if (timer.deadlineMs == null) return false;
    const remainingMs = Math.max(0, (timer.deadlineMs ?? now) - now);
    timer.remainingMs = remainingMs;
    timer.remainingSec = remainingMs === 0 ? 0 : Math.ceil(remainingMs / 1000);
    if (timer.deadlineMs == null || now < timer.deadlineMs) return false;
    timer.phase = "active";
    timer.deadlineMs += timer.targetSec * 1000;
    timer.remainingMs = timer.targetSec * 1000;
    timer.remainingSec = timer.targetSec;
    shouldRender = true;
  }
  if (timer.phase === "active") {
    const remainingMs = Math.max(0, (timer.deadlineMs ?? now) - now);
    const remainingSec = remainingMs === 0 ? 0 : Math.ceil(remainingMs / 1000);
    timer.remainingMs = remainingMs;
    timer.remainingSec = remainingSec;
    if (remainingSec === 0) {
      timer.phase = "complete";
      timer.deadlineMs = null;
      state.actualDrafts[timer.itemKey] = String(timer.targetSec);
      shouldRender = true;
    }
  }
  return shouldRender;
}
function updateActionRemaining() { const element = queryElement("[data-action-remaining]"); if (element) element.textContent = formatActionRemaining(state.timedAction.remainingSec); }
function startTimedAction() {
  const detail = state.sessionDetail;
  const item = detail ? displayCompletionItems(detail)[state.focusIndex] : null;
  const targetSec = canonicalDurationSeconds(item?.target);
  if (!detail || !item || targetSec == null || state.timerPaused || state.timedAction.phase !== "idle") return;
  const activationGeneration = ++audioActivationGeneration;
  const itemKey = item.completion_item_key;
  state.timedAction = { itemKey: item.completion_item_key, phase: "preparing", targetSec, deadlineMs: countdownNow() + preparationDurationSec * 1000, remainingMs: preparationDurationSec * 1000, remainingSec: preparationDurationSec };
  state.audio = state.muted ? state.audio : { status: "starting", error: null };
  const activation = /** @type {any} */ (state.muted ? { ok: true } : workoutTimeline.activateAudio());
  const finish = (/** @type {any} */ result) => {
    if (activationGeneration !== audioActivationGeneration || state.timedAction.itemKey !== itemKey || state.timerPaused || !isExecutionSurface() || !documentIsVisible()) return;
    const error = audioFailureFor(result);
    if (!state.muted) state.audio = error ? { status: "error", error } : { status: "ready", error: null };
    const now = countdownNow();
    updateTimedAction(now);
    const timer = state.timedAction;
    if (timer.phase !== "preparing" && timer.phase !== "active") { render(); return; }
    const scheduled = workoutTimeline.scheduleAction({ phase: timer.phase, remainingMs: Math.max(0, timer.deadlineMs - now), targetSec, audible: !state.muted && !error, alignPhaseEndAtMs: timer.deadlineMs });
    if (!state.muted && !error) observeAudioResult(scheduled.result);
    render();
  };
  if (activation && typeof activation.then === "function") {
    render();
    void Promise.resolve(activation).then(finish).catch((/** @type {any} */ error) => finish({ ok: false, error: error?.message || "音频播放失败" }));
  } else {
    finish(activation);
  }
}
function pauseTimedAction(now = countdownNow()) {
  updateTimedAction(now);
  const timer = state.timedAction;
  if ((timer.phase === "preparing" || timer.phase === "active") && timer.deadlineMs != null) {
    timer.remainingMs = Math.max(0, timer.deadlineMs - now);
    timer.remainingSec = timer.remainingMs === 0 ? 0 : Math.ceil(timer.remainingMs / 1000);
    timer.deadlineMs = null;
  }
}
function resumeTimedAction(now = countdownNow()) {
  const timer = state.timedAction;
  if ((timer.phase === "preparing" || timer.phase === "active") && timer.remainingMs > 0) {
    const audible = !state.muted && state.audio.status === "ready";
    const scheduled = workoutTimeline.scheduleAction({ phase: timer.phase, remainingMs: timer.remainingMs, targetSec: timer.targetSec, audible });
    timer.deadlineMs = scheduled.phaseEndsAtMs;
    if (audible) observeAudioResult(scheduled.result);
  }
}

function rescheduleCurrentAudio() {
  const now = countdownNow();
  const timer = state.timedAction;
  if ((timer.phase === "preparing" || timer.phase === "active") && timer.deadlineMs != null) {
    const scheduled = workoutTimeline.scheduleAction({
      phase: timer.phase,
      remainingMs: Math.max(0, timer.deadlineMs - now),
      targetSec: timer.targetSec,
      alignPhaseEndAtMs: timer.deadlineMs,
    });
    return observeAudioResult(scheduled.result);
  }
  if (state.restUntil != null) {
    const scheduled = workoutTimeline.scheduleRest({
      remainingMs: Math.max(0, state.restUntil - now),
      alignEndAtMs: state.restUntil,
    });
    return observeAudioResult(scheduled.result);
  }
  workoutTimeline.cancel();
  return { ok: true };
}

async function toggleAudioMuted() {
  if (!state.muted) {
    invalidateAudioActivation();
    state.muted = true;
    workoutTimeline.cancel();
    render();
    return;
  }
  const activationGeneration = ++audioActivationGeneration;
  state.muted = false;
  state.audio = { status: "starting", error: null };
  render();
  const result = await workoutTimeline.activateAudio();
  if (activationGeneration !== audioActivationGeneration || state.muted) return;
  const error = audioFailureFor(result);
  if (error) {
    state.audio = { status: "error", error };
    render();
    return;
  }
  state.audio = { status: "ready", error: null };
  await Promise.resolve(rescheduleCurrentAudio());
  render();
}
function stopSessionClock() { if (state.timerHandle) cancelFrame(state.timerHandle); state.timerHandle = null; }
function updateSessionClock() {
  if (!isVisibleSession()) return stopSessionClock();
  const now = countdownNow();
  if (state.restUntil) {
    const remaining = Math.max(0, Math.ceil((state.restUntil - now) / 1000));
    const element = queryElement("[data-rest-remaining]");
    if (element) element.textContent = formatRestRemaining();
    if (remaining === 0) {
      state.focusIndex = state.restNextIndex ?? state.focusIndex;
      clearRestCountdown({ cancelAudio: false });
      render();
    }
    return;
  }
  const shouldRender = updateTimedAction(now);
  updateActionRemaining();
  const elapsed = formatElapsed(state.sessionDetail, clockNow());
  queryElements("[data-session-elapsed]").forEach((element) => { element.textContent = elapsed; });
  if (shouldRender) render();
}
function runSessionClockFrame() {
  state.timerHandle = null;
  updateSessionClock();
  if (isVisibleSession() && !state.timerHandle) state.timerHandle = scheduleFrame(runSessionClockFrame);
}
function syncSessionClock() {
  const shouldRun = isVisibleSession();
  if (!shouldRun) return stopSessionClock();
  if (!state.timerHandle) state.timerHandle = scheduleFrame(runSessionClockFrame);
  updateSessionClock();
}

function syncSessionDetail(/** @type {any} */ detail) {
  state.sessionDetail = detail;
  state.todayDetail = detail;
  state.session = detail;
  if (state.today) state.today.session = detail;
}
function postSessionCommand(/** @type {any} */ detail, /** @type {any} */ command, body = {}, options = {}) {
  return api(`/api/private/sessions/${detail.session_key}/${command}`, { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify(body), ...options });
}
function pauseBoundary(/** @type {any} */ detail, /** @type {any} */ now) {
  const open = detail?.training_intervals?.find((/** @type {any} */ interval) => interval.ended_at === null);
  if (!open || now <= Date.parse(open.started_at) || now > Date.now()) return null;
  return new Date(now).toISOString();
}
function persistSessionPause(/** @type {string|null} */ closeAt = null) {
  const detail = state.sessionDetail;
  if (!detail || detail.status !== "in_progress") return Promise.resolve(null);
  const sessionKey = detail.session_key;
  const body = closeAt ? { close_at: closeAt } : {};
  return postSessionCommand(detail, "pause", body, { keepalive: true }).then((result) => {
    if (state.sessionDetail?.session_key === sessionKey) syncSessionDetail(result);
    return result;
  }).catch((error) => {
    if (state.sessionDetail?.session_key === sessionKey) {
      state.sessionMutation = { action: "pause", pending: false, error: error.data?.error?.message || error.message || "暂停同步失败，请重试" };
      render();
    }
    return null;
  });
}
async function toggleTimer() {
  if (!state.sessionDetail || state.sessionDetail.status !== "in_progress") return;
  if (state.sessionMutation.pending) return;
  const retryPause = state.timerPaused && state.sessionMutation.action === "pause" && state.sessionMutation.error;
  const command = retryPause ? "pause" : state.timerPaused ? "resume" : "pause";
  if (!beginSessionMutation(command)) return;
  const now = clockNow();
  const currentResumeGeneration = command === "resume" ? ++resumeGeneration : resumeGeneration;
  const currentAudioGeneration = command === "resume" ? ++audioActivationGeneration : audioActivationGeneration;
  const resumeAudio = command === "resume" && !state.muted ? workoutTimeline.activateAudio() : Promise.resolve(null);
  if (command === "pause") {
    if (!state.timerPaused) {
      pauseExecutionTimers();
      state.timerPaused = true;
      state.timerPauseStartedAt = now;
    }
    state.timerPauseReason = "manual";
    releaseWakeLock();
    render();
  }
  let requestPromise = null;
  try {
    const closeAt = command === "pause" ? pauseBoundary(state.sessionDetail, now) : null;
    const body = closeAt ? { close_at: closeAt } : {};
    requestPromise = postSessionCommand(state.sessionDetail, command, body, { keepalive: true });
    if (command === "resume") resumeRequestPromise = requestPromise;
    const result = await requestPromise;
    if (command === "resume" && (currentResumeGeneration !== resumeGeneration || !documentIsVisible() || !isExecutionSurface())) {
      if (state.sessionMutation.action === "resume") clearSessionMutation();
      render();
      return;
    }
    syncSessionDetail(result);
    if (command === "resume") {
      const audioResult = await resumeAudio;
      if (currentResumeGeneration !== resumeGeneration || !documentIsVisible() || !isExecutionSurface()) {
        if (state.sessionMutation.action === "resume") clearSessionMutation();
        render();
        return;
      }
      if (audioResult && currentAudioGeneration === audioActivationGeneration && !state.muted) {
        const audioError = audioFailureFor(audioResult);
        state.audio = audioError ? { status: "error", error: audioError } : { status: "ready", error: null };
      }
      state.timerPaused = false;
      state.timerPauseReason = null;
      state.timerPauseStartedAt = null;
      state.timerPausedSec = 0;
      state.wakeLock.status = "idle";
      resumeExecutionTimers();
    } else {
      state.timerPaused = true;
      state.timerPauseReason = "manual";
    }
    clearSessionMutation();
    render();
  } catch (/** @type {any} */ error) {
    failSessionMutation(command, error);
  } finally {
    if (command === "resume" && resumeRequestPromise === requestPromise) resumeRequestPromise = null;
  }
  /* The server owns the active interval; the visual timers only run after a successful resume. */
  if (command === "pause") {
    stopSessionClock();
  } else if (state.timerPaused) {
    pauseExecutionTimers();
  }
}

function endSheet(/** @type {any} */ detail) {
  const items = displayCompletionItems(detail);
  const completed = items.filter((item) => displayItemDone(detail, item)).length;
  const percent = items.length ? Math.round((completed / items.length) * 100) : 0;
  const unfinished = items.filter((item) => !displayItemDone(detail, item));
  const exercises = detail.snapshot.blocks.flatMap((/** @type {any} */ block) => block.exercises);
  const selectedRpe = Number.isInteger(state.endRpe) ? state.endRpe : 8;
  const rpeButtons = rpeMeanings.map((meaning, value) => `<button class="rpe-button ${selectedRpe === value ? "is-selected" : ""}" type="button" data-action="set-end-rpe" data-rpe="${value}" aria-label="RPE ${value}，${meaning.title}" aria-pressed="${selectedRpe === value}">${value}</button>`).join("");
  const unfinishedMarkup = unfinished.length ? `<section class="end-unfinished"><h3>未完成项目</h3><ul>${unfinished.map((item, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(itemLabel(detail, item))}</strong></li>`).join("")}</ul></section>` : "";
  const feedbackMarkup = exercises.map((/** @type {any} */ exercise) => `<label>${escapeHtml(exercise.name)}<input data-end-feedback="${exercise.exercise_occurrence_key}" maxlength="1000" value="${escapeHtml(state.endFeedback[exercise.exercise_occurrence_key] || "")}" placeholder="记录感受（可留空）" /></label>`).join("");
  return `<div class="modal-backdrop" data-action="cancel-end"><section class="bottom-sheet end-sheet"><div class="sheet-handle"></div><div class="end-sheet-body"><h2>结束训练</h2><p class="muted">${unfinished.length ? `还有 ${unfinished.length} 项未完成，保存后会记为部分完成。` : "所有项目都已记录，可以完成训练。"}</p><section class="end-result"><span>${unfinished.length ? "部分完成" : "已完成"}</span><strong>${completed} / ${items.length}</strong><small>已完成 · ${percent}%</small><div class="progress-line"><span style="width:${percent}%"></span></div></section>${unfinishedMarkup}<section class="end-form-section"><div class="end-form-heading"><h3>训练 RPE</h3><span>整体感受</span></div><div class="rpe-scale">${rpeButtons}</div><div class="rpe-meaning" role="status" aria-live="polite"><strong>${selectedRpe} · ${rpeMeanings[selectedRpe].title}</strong><span>${rpeMeanings[selectedRpe].detail}</span></div></section><section class="end-form-section"><label for="end-note">训练备注 <span class="muted">可选</span></label><textarea id="end-note" class="end-note" maxlength="5000" placeholder="记录训练上下文（可留空）">${escapeHtml(state.endNote)}</textarea></section><section class="end-form-section end-feedback"><h3>动作反馈</h3>${feedbackMarkup}</section></div><div class="end-sheet-actions"><button class="secondary" data-action="cancel-end">返回训练</button><button class="primary" data-action="save-end">结束并保存</button></div></section></div>`;
}

function correctionView(/** @type {any} */ detail, /** @type {any} */ entry) {
  if (detail.status === "skipped") return `<section class="page-head"><p class="eyebrow">CORRECTION</p><h1>校正记录</h1><p class="muted">${escapeHtml(entry.title)} · 训练日期和跳过状态保持不变。</p></section><section class="list-card"><label>跳过原因<input id="correction-skip-reason" maxlength="500" value="${escapeHtml(detail.skip_reason || "")}" /></label><label>训练备注<textarea id="correction-note" maxlength="5000">${escapeHtml(detail.note || "")}</textarea></label></section><div class="sheet-actions"><button class="secondary" data-action="cancel-correction">取消</button><button class="primary" data-action="save-correction">保存校正</button></div>`;
  const existing = new Map(detail.completion_results.map((/** @type {any} */ result) => [result.completion_item_key, result]));
  const itemRows = detail.snapshot.completion_items.map((/** @type {any} */ item, /** @type {any} */ index) => {
    const result = existing.get(item.completion_item_key);
    const weightField = editableResistance(item) ? `<input id="correction-weight-${item.completion_item_key}" type="number" min="0" step="0.1" value="${escapeHtml(resistanceDraftValue(item, result))}" placeholder="实际重量（kg，可留空）" />` : "";
    return `<label>${index + 1}. ${escapeHtml(itemLabel(detail, item))}<input id="correction-value-${item.completion_item_key}" type="number" min="1" value="${result?.actual?.value ?? ""}" placeholder="实际值" />${weightField}<input id="correction-rir-${item.completion_item_key}" type="number" min="0" max="10" value="${result?.rir ?? ""}" placeholder="RIR（可留空）" /></label>`;
  }).join("");
  return `<section class="page-head"><p class="eyebrow">CORRECTION</p><h1>校正记录</h1><p class="muted">${escapeHtml(entry.title)} · 训练日期保持不变。留空的项目会被视为未完成。</p></section><section class="list-card">${itemRows}</section><section class="quiet-card"><label>训练 RPE<input id="correction-rpe" type="number" min="0" max="10" value="${detail.session_rpe ?? ""}" /></label><label>训练备注<textarea id="correction-note" maxlength="5000">${escapeHtml(detail.note || "")}</textarea></label><label>动作反馈</label>${detail.snapshot.blocks.flatMap((/** @type {any} */ block) => block.exercises).map((/** @type {any} */ exercise) => { const feedback = detail.exercise_feedback.find((/** @type {any} */ item) => item.exercise_occurrence_key === exercise.exercise_occurrence_key); return `<input id="correction-feedback-${exercise.exercise_occurrence_key}" value="${escapeHtml(feedback?.text || "")}" placeholder="${escapeHtml(exercise.name)}（可留空）" />`; }).join("")}</section><div class="sheet-actions"><button class="secondary" data-action="cancel-correction">取消</button><button class="primary" data-action="save-correction">保存校正</button></div>`;
}

function exerciseName(/** @type {any} */ detail, /** @type {any} */ item) { return detail?.snapshot?.blocks?.flatMap((/** @type {any} */ block) => block.exercises).find((/** @type {any} */ exercise) => exercise.exercise_occurrence_key === item?.exercise_occurrence_key)?.name || "训练项目"; }

function calendarView() {
  if (state.calendarLoading && !state.calendar.entries.length) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1></section><section class="loading"><span class="spinner"></span><p>正在读取日期安排…</p></section>`;
  if (state.calendarError) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1></section><section class="error-card"><p>${escapeHtml(state.calendarError)}</p><button class="primary" data-action="calendar-retry">重新读取</button></section>`;
  const from = state.calendar.from; const first = calendarFirstDate(); const selected = state.calendar.selectedDate;
  if (!first) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1><p class="muted">还没有生效的计划。</p></section><section class="quiet-card"><strong>日历暂不可用</strong><p>在设置中提交第一份计划后，这里会从其生效日期开始显示。</p></section>`;
  if (!from) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1><p class="muted">还没有可浏览的计划。</p></section>`;
  const previous = addCalendarDays(from, -7); const next = addCalendarDays(from, 7);
  const previousDisabled = Boolean(first && addCalendarDays(previous, 6) < first);
  const sessions = new Map(state.calendar.sessions.map((/** @type {any} */ session) => [session.session_key, session]));
  const rows = state.calendar.entries.map((/** @type {any} */ entry) => {
    const beforePlan = Boolean(first && entry.date < first); const session = sessions.get(entry.session_key); const status = beforePlan ? { key: "before-plan", label: "计划尚未开始" } : calendarStatus(entry, session); const selectedClass = entry.date === selected ? " selected" : "";
    const aerobicCount = entry.aerobic_summary?.activity_count || 0;
    const aerobicMeta = aerobicCount ? ` · ${aerobicCount} 次有氧` : "";
    return `<button class="calendar-day ${status.key}${selectedClass}" data-action="calendar-select" data-date="${entry.date}" ${beforePlan ? "disabled" : ""}><span class="calendar-day-label">${weekdayLabels[entry.weekday]}</span><span class="calendar-day-date">${entry.date.slice(5)}</span><span class="calendar-day-summary">${entry.kind === "workout" ? escapeHtml(entry.title) : status.label}</span><span class="calendar-day-meta">${entry.kind === "workout" ? `${entry.recording_intent ? "" : `${entry.module_count || 0} 个模块 · `}${entry.estimated_duration_min} 分钟 · ${status.label}${aerobicMeta}` : entry.kind === "rest" ? `恢复，不创建训练记录${aerobicMeta}` : beforePlan ? "" : `未安排内容${aerobicMeta}`}</span></button>`;
  }).join("");
  const detail = state.calendarDay && state.calendarDay.entry.date === selected ? (state.correction ? correctionView(state.calendarDay.session, state.calendarDay.entry) : calendarDayDetail(state.calendarDay.entry, state.calendarDay.session)) : `<section class="quiet-card"><strong>选择一天</strong><p>查看这一天的训练处方和完成情况。</p></section>`;
  const maintenance = state.calendar.expiredCount > 0 ? `<button class="secondary calendar-maintenance-button" data-action="normalize-expired" ${state.calendarMaintenance.pending ? "disabled aria-busy=\"true\"" : ""}>${state.calendarMaintenance.pending ? "整理中…" : `整理 ${state.calendar.expiredCount} 条`}</button>` : "";
  const maintenanceError = state.calendarMaintenance.error ? `<div class="notice calendar-maintenance-notice" role="alert">${escapeHtml(state.calendarMaintenance.error)}</div>` : "";
  return `<section class="page-head calendar-head"><div class="calendar-title-row"><div><p class="eyebrow">CALENDAR</p><h1>日历</h1></div>${maintenance}</div>${maintenanceError}<div class="calendar-week-controls"><button class="secondary" data-action="calendar-previous" ${previousDisabled ? "disabled" : ""}>‹ 上一周</button><strong>${from} – ${state.calendar.to}</strong><button class="secondary" data-action="calendar-next">下一周 ›</button></div><div class="calendar-legend" aria-label="日历状态图例"><span class="calendar-legend-item completed"><i></i>已完成</span><span class="calendar-legend-item recorded"><i></i>已记录</span><span class="calendar-legend-item partial"><i></i>未完成</span><span class="calendar-legend-item skipped"><i></i>已跳过</span><span class="calendar-legend-item today"><i></i>未开始</span></div></section><section class="calendar-week" aria-label="七天训练安排">${rows}</section>${state.calendarDayLoading ? `<section class="loading compact-loading"><span class="spinner"></span><p>正在读取这一天…</p></section>` : detail}`;
}

function calendarDayDetail(/** @type {any} */ entry, /** @type {any} */ detail) {
  const status = calendarStatus(entry, detail); const items = detail?.snapshot?.completion_items || []; const completed = detail?.completion_results?.length || 0; const canCorrect = detail && ["completed", "partial", "skipped"].includes(detail.status);
  const aerobic = calendarAerobicSummary(entry);
  if (entry.kind === "rest") return `${aerobic}<section class="calendar-detail quiet-card"><span class="status-pill">休息日</span><h2>恢复日</h2><p class="muted">不安排训练，也不会创建训练记录。</p></section>`;
  if (entry.kind === "no_plan") return `${aerobic}<section class="calendar-detail quiet-card"><span class="status-pill">无计划</span><h2>未安排内容</h2><p class="muted">没有生效的 Weekly Template 槽位。</p></section>`;
  if (!entry.prescription) return `${aerobic}<section class="calendar-detail error-card"><p>这一天的训练处方暂时无法读取。</p></section>`;
  const sessionSummary = detail ? `<div class="calendar-session-summary"><strong>Session ${detail.status === "skipped" ? "已跳过" : "完成情况"} · 训练计划快照</strong><span>快照：${escapeHtml(detail.snapshot.title)} · ${pct(detail.completion_fraction)} · ${completed}/${items.length} 项已完成</span>${detail.skip_reason ? `<p class="muted">跳过原因：${escapeHtml(detail.skip_reason)}</p>` : ""}${canCorrect ? `<button class="secondary" data-action="calendar-correct">校正记录</button>` : ""}</div>` : status.key === "overdue" && !entry.recording_intent ? `<div class="calendar-session-summary"><strong>逾期未开始</strong><span>没有 Session 记录，也不会生成历史训练记录。</span></div>` : "";
  const prescription = entry.recording_intent && !detail ? "" : `<div class="calendar-prescription"><h3>训练处方</h3>${renderCalendarPrescription(detail?.snapshot || entry.prescription, detail)}</div>`;
  return `<section class="calendar-detail"><div class="calendar-detail-head"><div><h2>${escapeHtml(entry.title)}</h2><p class="muted">约 ${entry.estimated_duration_min} 分钟 · ${status.label}</p></div><span class="status-pill ${status.key}">${status.label}</span></div>${recordingGuide(entry)}${sessionSummary}${prescription}</section>${aerobic}`;
}

function recordingGuide(/** @type {any} */ entry) {
  const intent = entry?.recording_intent ?? entry?.prescription?.recording_intent;
  if (!intent) return "";
  const evidence = entry.recording_evidence;
  const status = evidence?.status ?? "awaiting_sync";
  const hasRecords = (entry.aerobic_summary?.activity_count ?? 0) > 0;
  const action = hasRecords ? `<button class="secondary" data-action="open-aerobic-date" data-date="${entry.date}">查看有氧记录</button>` : "";
  if (status === "recorded") return `<section class="calendar-recording-guide is-recorded" aria-label="COROS 路线记录状态"><strong>COROS 记录</strong><span class="status-pill recorded">已记录</span></section>`;
  if (status === "needs_link") return `<section class="calendar-recording-guide needs-link" aria-label="COROS 路线记录状态"><strong>COROS 记录</strong><div class="calendar-recording-actions"><span class="status-pill partial">待关联</span>${action}</div></section>`;
  return `<section class="calendar-recording-guide" aria-label="COROS 路线记录状态"><strong>COROS 记录</strong><span class="status-pill">待同步</span></section>`;
}

function calendarAerobicSummary(/** @type {any} */ entry) {
  if (entry?.recording_intent) return "";
  const summary = entry?.aerobic_summary;
  if (!summary || !summary.activity_count) return "";
  const distance = summary.distance_km == null ? "—" : `${summary.distance_km} km`;
  const duration = aerobicDuration(summary.duration_sec);
  return `<section class="calendar-aerobic-summary" aria-label="${entry.date} 有氧摘要"><div><p class="eyebrow">COROS · AEROBIC SUMMARY</p><h3>有氧摘要</h3><p class="muted">${summary.activity_count} 次活动 · ${distance} · ${duration}</p></div><span class="status-pill ${escapeHtml(summary.source_status)}">${escapeHtml(aerobicStatusLabel(summary.source_status))}</span><button class="secondary" data-action="open-aerobic-date" data-date="${entry.date}">查看有氧记录</button></section>`;
}

function renderCalendarPrescription(/** @type {any} */ prescription, /** @type {any} */ detail = null) {
  const snapshotBlocks = detail?.snapshot?.blocks || [];
  return `<p class="muted">${prescription.blocks.length} 个训练模块 · ${prescription.title ? escapeHtml(prescription.title) : ""}</p>${prescription.blocks.map((/** @type {any} */ block, /** @type {any} */ blockIndex) => `<article class="prescription-block"><h4>${escapeHtml(block.title)}</h4>${block.exercises.map((/** @type {any} */ exercise, /** @type {any} */ exerciseIndex) => { const snapshotExercise = snapshotBlocks[blockIndex]?.exercises?.[exerciseIndex]; return `<div class="prescription-exercise"><div class="prescription-exercise-head"><strong>${escapeHtml(exercise.name)}</strong><span class="prescription-execution">${exerciseExecutionModeLabel(exercise)}</span></div>${exercise.sets.map((/** @type {any} */ set, /** @type {any} */ index) => { const snapshotSet = snapshotExercise?.sets?.[index]; const actuals = detail && snapshotSet ? (detail.snapshot.completion_items || []).filter((/** @type {any} */ item) => item.set_key === (snapshotSet.set_key || snapshotSet.set_id)).map((/** @type {any} */ item) => detail.completion_results.find((/** @type {any} */ result) => result.completion_item_key === item.completion_item_key)?.actual ? `${item.side === "none" ? "" : `${item.side} `}${formatActual(detail.completion_results.find((/** @type {any} */ result) => result.completion_item_key === item.completion_item_key).actual)}` : null).filter(Boolean) : []; const tempo = formatTempo(set.tempo); return `<div class="prescription-set"><span>第 ${index + 1} 组 · ${formatTarget(set.target)}</span><span>${formatResistance(set.resistance ?? canonicalSetResistance(set))}${tempo ? ` · 节奏 ${tempo}` : ""}${set.rest_after_sec == null ? "" : ` · 休息 ${set.rest_after_sec} 秒`}</span>${detail ? `<small class="${actuals.length ? "actual" : "unfinished"}">${actuals.length ? `实际：${actuals.join("，")}` : "未完成"}</small>` : ""}</div>`; }).join("")}</div>`; }).join("")}</article>`).join("")}`;
}

function executionModeLabel(/** @type {any} */ mode) { return /** @type {Record<string, string>} */ ({ none: "不分左右", bilateral: "双侧同时", per_side: "左右分别完成", alternating: "左右交替" })[String(mode)] || "未指定"; }
function exerciseExecutionModeLabel(/** @type {any} */ exercise) { return executionModeLabel(exercise?.execution_mode ?? (exercise?.side_mode === "left_right" ? "per_side" : "none")); }

function formatTarget(/** @type {any} */ target) { if (!target) return "未指定目标"; const fixedDuration = canonicalDurationSeconds(target); const unit = target.metric === "reps" ? "次" : target.metric === "duration_sec" || target.metric === "seconds" ? "秒" : target.metric; const value = fixedDuration != null ? fixedDuration : target.value ?? (target.min === target.max ? target.min : `${target.min}–${target.max}`); const qualifiers = [target.target_rir == null ? null : `RIR ${target.target_rir}`, target.target_rpe == null ? null : `RPE ${target.target_rpe}`, target.target_incline_percent == null ? null : `坡度 ${target.target_incline_percent}%`].filter(Boolean); return `${value} ${unit}${qualifiers.length ? ` · ${qualifiers.join(" · ")}` : ""}`; }
function formatTempo(/** @type {any} */ tempo) { if (typeof tempo === "string") return escapeHtml(tempo); if (!tempo || typeof tempo !== "object") return ""; return [["eccentric_sec", "离心"], ["bottom_hold_sec", "底部停顿"], ["concentric_sec", "向心"], ["top_hold_sec", "顶部停顿"]].filter(([key]) => tempo[key] != null).map(([key, label]) => `${label} ${escapeHtml(tempo[key])} 秒`).join(" · "); }
function formatResistance(/** @type {any} */ resistance) { if (!resistance) return "阻力未指定"; if (resistance.mode === "bodyweight") return "自重"; if (resistance.mode === "external_weight" || resistance.mode === "external_load") return `${resistance.load_kg ?? resistance.value ?? "—"} kg × ${resistance.quantity ?? 1}`; return escapeHtml(resistance.mode || "阻力"); }
function formatActual(/** @type {any} */ actual) { const unit = actual.metric === "reps" ? "次" : actual.metric === "duration_sec" || actual.metric === "seconds" ? "秒" : actual.metric; return `${actual.value} ${unit}`; }

function planWeekRows(/** @type {any} */ week) {
  return Object.entries(week || {}).map(([day, slot]) => `<div class="week-row"><span class="day-label">${weekdayLabels[day]}</span><div><strong>${slot?.kind === "workout" ? escapeHtml(slot.title ?? slot.prescription?.title) : slot?.kind === "rest" ? "休息日" : "无计划"}</strong><p>${slot?.kind === "workout" ? `${(slot.blocks ?? slot.prescription?.blocks ?? []).length} 个训练模块 · 约 ${slot.estimated_duration_min ?? slot.prescription?.estimated_duration_min} 分钟` : slot?.kind === "rest" ? "今天不创建训练记录" : "未安排内容"}</p></div></div>`).join("");
}

function futurePlanTimeline() {
  const future = state.plan?.future || [];
  if (!future.length) return `<section class="pending-card"><strong>没有待生效更新</strong><p>可以在设置中一次编排未来 2–4 周。</p></section>`;
  return `<section class="future-plan"><div class="future-plan-head"><div><p class="eyebrow">FUTURE REVISIONS</p><h2>未来计划时间线</h2></div><span>${future.length} 周</span></div>${future.map((revision, index) => `<details class="future-week" ${index === 0 ? "open" : ""}><summary><span>第 ${index + 1} 周</span><strong>${escapeHtml(revision.effective_from)} 生效</strong></summary><div class="future-week-body">${planWeekRows(revision.week)}</div></details>`).join("")}</section>`;
}

function planView() {
  const current = state.plan?.current; const week = current?.week || {};
  return `<section class="page-head"><p class="eyebrow">PLAN</p><h1>本周计划</h1><p class="muted">${current ? `从 ${current.effective_from} 生效 · ${state.plan?.timezone ?? state.today?.timezone ?? "Asia/Shanghai"}` : "还没有当前计划"}</p></section>${current ? `<section class="week-list">${planWeekRows(week)}</section>` : `<div class="quiet-card">还没有当前计划。</div>`}${futurePlanTimeline()}`;
}

function batchPreviewWeeks(/** @type {any} */ preview) {
  return `<div class="batch-preview">${preview.updates.map((/** @type {any} */ update, /** @type {any} */ index) => `<details class="future-week" ${index === 0 ? "open" : ""}><summary><span>第 ${index + 1} 周</span><strong>${escapeHtml(update.effective_from)} · 变更 ${update.changed_weekday_slot_count} 天</strong></summary><div class="future-week-body">${planWeekRows(update.week)}</div></details>`).join("")}</div>`;
}

function planSheet() {
  if (state.preview) {
    const isBatch = state.planEditorMode === "batch";
    const heading = isBatch ? `确认 ${state.preview.update_count} 周计划` : "确认更新计划";
    const meta = isBatch ? `${escapeHtml(state.preview.from)} – ${escapeHtml(state.preview.to)} · 原子化一次应用` : `${escapeHtml(state.preview.effective_from)} 生效 · ${state.preview.changed_weekday_slot_count} 个日期槽位发生变化`;
    const content = isBatch ? batchPreviewWeeks(state.preview) : `<div class="preview-week">${planWeekRows(state.preview.week)}</div>`;
    return `<div class="modal-backdrop" data-action="close-sheet"><section class="bottom-sheet"><div class="sheet-handle"></div><h2>${heading}</h2><p class="muted">${meta}</p>${content}<div class="sheet-actions"><button class="secondary" data-action="close-sheet">取消</button><button class="primary" data-action="confirm-plan">确认应用</button></div></section></div>`;
  }
  return `<div class="modal-backdrop" data-action="close-sheet"><section class="bottom-sheet"><div class="sheet-handle"></div><h2>${state.planError ? "计划需要修正" : "编排未来计划"}</h2><p class="muted">支持单个 Plan Update Package，或包含 2–4 个连续周一的 Plan Update Batch。检查不会写入；确认后批量更新会原子化应用。</p><textarea id="plan-json" placeholder='{"schema_version":1,"updates":[{"schema_version":2,"effective_from":"2026-08-24","week":{...}}]}'>${escapeHtml(state.draft)}</textarea>${state.planError ? `<div class="validation-error"><strong>计划无法更新</strong><p>${escapeHtml(state.planError).replace(/\n/g, "<br>")}</p><button class="secondary" data-action="copy-error">复制错误详情</button></div>` : ""}<div class="sheet-actions"><button class="secondary" data-action="close-sheet">取消</button><button class="primary" data-action="validate-plan">检查计划</button></div></section></div>`;
}

function formatHours(/** @type {any} */ seconds) { const value = Math.round((Number(seconds) || 0) / 360) / 10; return `${Number.isInteger(value) ? value : value.toFixed(1)} 小时`; }
function progressView() {
  if (state.exercise) return exerciseView();
  const metric = state.progress?.metrics;
  const rate = metric?.completion_rate;
  const tabs = [["current", "当月"], ["previous", "上月"], ["all", "累计"]].map(([range, label]) => `<button class="progress-range-tab ${state.progressRange === range ? "is-selected" : ""}" data-action="progress-range" data-range="${range}" role="tab" aria-selected="${state.progressRange === range}">${label}</button>`).join("");
  const heading = state.recordsTab === "strength" ? "力量" : "进展";
  const period = state.progress?.period?.from && state.progress?.period?.to ? `${state.progress.period.from} – ${state.progress.period.to}` : "";
  const head = recordsPageHead("strength", `RECORDS · STRENGTH${state.progressLoading ? "" : ` · ${progressRangeLabel(state.progressRange)}`}`, heading, { subtitle: period });
  if (state.progressLoading) return `${head}<div class="progress-range-tabs" role="tablist" aria-label="力量记录时间范围">${tabs}</div><section class="loading compact-loading"><span class="spinner"></span><p>正在读取${progressRangeLabel(state.progressRange)}数据…</p></section>`;
  return `${head}<div class="progress-range-tabs" role="tablist" aria-label="力量记录时间范围">${tabs}</div><div class="metric-grid"><article><span>完成率</span><strong>${rate?.value == null ? "—" : pct(rate.value)}</strong></article><article><span>训练时长</span><strong>${formatHours(metric?.training_duration?.value_sec)}</strong></article><article><span>力量训练日</span><strong>${metric?.strength_training_days?.value || 0}</strong></article><article><span>平均 RPE</span><strong>${metric?.average_session_rpe?.value ?? "—"}</strong><small>${metric?.average_session_rpe?.included_count || 0} 个有效记录</small></article></div><section class="quiet-card"><strong>训练连续性</strong><p>${state.progress?.current_streak?.value || 0} 天连续完成 100% 训练；休息日和无计划日保持中性。</p></section><section class="list-card"><h2>动作进展</h2>${(state.progress?.exercises || []).length ? state.progress.exercises.map((/** @type {any} */ exercise) => `<button class="list-row" data-exercise="${escapeHtml(exercise.exercise_key)}"><span><strong>${escapeHtml(exercise.current_name)}</strong><small>${exercise.performed_session_count} 次训练</small></span><span>›</span></button>`).join("") : `<p class="muted">还没有可展示的动作记录。</p>`}</section>`;
}

function exerciseView() { return `<section class="page-head"><button class="text-button" data-action="close-exercise">← 返回进展</button><p class="eyebrow">动作记录</p><h1>${escapeHtml(state.exercise.exercise_key)}</h1><p class="muted">${state.exercise.performed_session_count} 次有实际完成结果的训练</p></section><section class="list-card">${state.exercise.observations.length ? state.exercise.observations.map((/** @type {any} */ observation) => `<article class="week-row"><div><strong>${observation.scheduled_date}</strong><p>${observation.sets.map((/** @type {any} */ set) => `${escapeHtml(set.side)} · ${set.actual.value} ${set.actual.metric}`).join("，")}</p></div></article>`).join("") : `<p class="muted">这个动作目前没有可展示的完成记录。</p>`}</section>`; }

function recordsTabs(/** @type {any} */ active) {
  return `<div class="records-tabs" role="tablist" aria-label="训练记录类型">${[["overview", "总览"], ["strength", "力量"], ["aerobic", "有氧"]].map(([tab, label]) => `<button class="records-tab ${active === tab ? "is-selected" : ""}" data-action="records-tab" data-tab="${tab}" role="tab" aria-selected="${active === tab}">${label}</button>`).join("")}</div>`;
}

function recordsPageHead(/** @type {any} */ active, /** @type {any} */ eyebrow, /** @type {any} */ heading, { subtitle = "", aside = "", backLabel = "", backAction = "", showTabs = true } = {}) {
  const back = backLabel ? `<button class="text-button records-back-button" data-action="${backAction}">${backLabel}</button>` : "";
  const tabs = showTabs ? recordsTabs(active) : "";
  const actions = tabs || aside ? `<div class="records-page-actions">${tabs}${aside}</div>` : "";
  const titleRow = `<div class="records-page-title-row"><h1>${heading}</h1>${actions}</div>`;
  return `<section class="page-head records-page-head"><div class="records-page-heading">${back}<p class="eyebrow">${eyebrow}</p>${titleRow}${subtitle ? `<p class="muted">${subtitle}</p>` : ""}</div></section>`;
}

function recordsView() {
  if (state.exercise) return exerciseView();
  if (state.recordsTab === "overview") return recordsOverviewView();
  if (state.recordsTab === "aerobic") return aerobicView();
  return progressView();
}

function recordsOverviewView() {
  if (state.recordsOverviewLoading || !state.recordsOverview) return `${recordsPageHead("overview", "RECORDS · OVERVIEW", "总览")}<section class="loading compact-loading"><span class="spinner"></span><p>正在读取训练记录…</p></section>`;
  const overview = state.recordsOverview;
  const days = (overview.days || []).filter((/** @type {any} */ day) => day.workout_session_count || day.aerobic_activity_count).slice(-8).reverse();
  return `${recordsPageHead("overview", "RECORDS · OVERVIEW", "总览")}<div class="metric-grid records-overview-metrics"><button class="records-overview-metric" data-action="records-tab" data-tab="strength" aria-label="查看力量记录"><span>力量 Session</span><strong>${overview.workout?.session_count || 0}</strong></button><button class="records-overview-metric" data-action="records-tab" data-tab="aerobic" aria-label="查看有氧记录"><span>有氧活动</span><strong>${overview.aerobic?.activity_count || 0}</strong></button><article class="records-overview-metric"><span>记录天数</span><strong>${days.length}</strong></article></div><section class="list-card records-overview-days"><h2>最近记录日期</h2>${days.length ? days.map((/** @type {any} */ day) => `<article class="records-overview-day"><div><strong>${escapeHtml(day.local_date)}</strong><small>${day.schedule_kind === "rest" ? "休息日" : day.schedule_kind === "no_plan" ? "无计划" : "计划日"}</small></div><div><span>${day.workout_session_count ? `${day.workout_session_count} 次力量` : "无力量 Session"}</span><span>${day.aerobic_activity_count ? `${day.aerobic_activity_count} 次有氧` : "无有氧活动"}</span></div></article>`).join("") : `<p class="muted">还没有可展示的训练记录。</p>`}</section>`;
}

/** @type {Record<string, string>} */
const aerobicSportLabels = { 100: "户外跑", 101: "室内运动", 102: "越野跑", 104: "徒步", 200: "骑行" };
/** @type {Record<string, string>} */
const aerobicStatusLabels = { complete: "数据完整", partial: "部分数据", error: "读取失败", none: "暂无数据" };

function aerobicStatusLabel(/** @type {any} */ status) { return aerobicStatusLabels[String(status)] || "状态未知"; }
function aerobicSportLabel(/** @type {any} */ sportType, /** @type {any} */ sportName = null) { return aerobicSportLabels[String(sportType)] || sportName || "有氧运动"; }
function aerobicDuration(/** @type {any} */ seconds) { if (seconds == null) return "—"; const minutes = Math.round(Number(seconds) / 60); return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`; }
function aerobicMonthOptions(/** @type {any} */ items) {
  const months = [...new Set(items.map((/** @type {any} */ item) => item.local_date?.slice(0, 7)).filter(Boolean))].sort().reverse();
  return ["<option value=\"all\">全部月份</option>", ...months.map((month) => `<option value="${month}" ${state.aerobic.month === month ? "selected" : ""}>${month}</option>`)].join("");
}
function aerobicSportOptions(/** @type {any} */ items) {
  const sports = [...new Set(items.map((/** @type {any} */ item) => String(item.sport_type)).filter(Boolean))].sort((left, right) => Number(left) - Number(right));
  return ["<option value=\"all\">全部运动</option>", ...sports.map((sportType) => `<option value="${sportType}" ${state.aerobic.sportType === sportType ? "selected" : ""}>${aerobicSportLabel(Number(sportType))}</option>`)].join("");
}

function filteredAerobicItems() {
  const items = state.aerobic.list?.items || [];
  return items.filter((/** @type {any} */ item) => (state.aerobic.month === "all" || item.local_date?.startsWith(state.aerobic.month)) && (state.aerobic.sportType === "all" || String(item.sport_type) === state.aerobic.sportType));
}

function aerobicActivityCard(/** @type {any} */ activity) {
  const summary = activity.summary || {};
  const indoor = activity.sport_type === 101;
  const route = !indoor && activity.route_key ? `<span class="aerobic-activity-route">${escapeHtml(activity.route_key)}</span>` : "";
  const heartRate = summary.average_heart_rate_bpm == null ? "" : ` · ${summary.average_heart_rate_bpm} bpm`;
  const distance = summary.distance_km == null ? "—" : `${summary.distance_km} km`;
  return `<button class="aerobic-activity-card" data-action="aerobic-detail" data-activity-ref="${escapeHtml(activity.activity_ref)}"><span class="aerobic-activity-main"><span class="aerobic-activity-title"><strong>${escapeHtml(activity.local_date || "未知日期")} · ${escapeHtml(aerobicSportLabel(activity.sport_type, activity.sport_name))}</strong>${route}</span><span>${distance} · ${aerobicDuration(summary.duration_sec)}${heartRate}</span></span><span class="aerobic-activity-arrow">›</span></button>`;
}

function aerobicDetailView(/** @type {any} */ detail) {
  const summary = detail.summary || {};
  const indoor = detail.sport_type === 101;
  const confirmedRoute = !indoor && typeof detail.route_key === "string" && detail.route_key;
  const routeStatus = indoor ? "室内运动 · 无路线" : confirmedRoute ? `<button class="route-status-button" data-action="route-detail" data-route-key="${escapeHtml(detail.route_key)}">${escapeHtml(detail.route_name || detail.route_key)}</button>` : "未匹配路线";
  const activityTime = formatActivityDateTime(detail.started_at, detail.timezone || state.today?.timezone);
  const distance = summary.distance_km == null ? "—" : `${summary.distance_km} km`;
  return `${recordsPageHead("aerobic", "RECORDS · AEROBIC", "活动详情", { subtitle: `${escapeHtml(detail.local_date || "未知日期")} · ${escapeHtml(aerobicSportLabel(detail.sport_type, detail.sport_name))}`, backLabel: "← 返回有氧记录", backAction: "aerobic-back", showTabs: false })}<section class="aerobic-detail-card"><div class="aerobic-detail-status"><span class="status-pill ${escapeHtml(detail.source_status || "none")}">${escapeHtml(aerobicStatusLabel(detail.source_status))}</span>${routeStatus}</div><div class="metric-grid aerobic-metrics"><article><span>距离</span><strong>${distance}</strong></article><article><span>用时</span><strong>${aerobicDuration(summary.duration_sec)}</strong></article><article><span>平均心率</span><strong>${summary.average_heart_rate_bpm == null ? "—" : `${summary.average_heart_rate_bpm} bpm`}</strong></article><article><span>消耗</span><strong>${summary.calories_kcal == null ? "—" : `${summary.calories_kcal} kcal`}</strong></article></div><dl class="aerobic-source"><div><dt>活动时间</dt><dd>${activityTime}</dd></div><div><dt>FIT</dt><dd>${escapeHtml(detail.fit_status || "—")}</dd></div></dl></section>`;
}

function routeHistoryRow(/** @type {any} */ activity) {
  const summary = activity.summary || {};
  const heartRate = summary.average_heart_rate_bpm == null ? "" : ` · ${summary.average_heart_rate_bpm} bpm`;
  const distance = summary.distance_km == null ? "—" : `${summary.distance_km} km`;
  return `<button class="route-history-row" data-action="aerobic-detail" data-activity-ref="${escapeHtml(activity.activity_ref)}"><span><strong>${escapeHtml(activity.local_date || "未知日期")}</strong><small>${escapeHtml(aerobicSportLabel(activity.sport_type, activity.sport_name))} · ${distance} · ${aerobicDuration(summary.duration_sec)}${heartRate}</small></span><span>${activity.route_direction === "reverse" ? "反向" : "正向"} ›</span></button>`;
}

function routePanelContent() {
  if (state.aerobic.routeDetailLoading) return `<div class="loading compact-loading"><span class="spinner"></span><p>正在读取路线历史…</p></div>`;
  if (state.aerobic.routeDetail) {
    const route = state.aerobic.routeDetail;
    const history = route.history || [];
    const backLabel = state.aerobic.routeOrigin === "activity" ? "← 返回活动详情" : "← 返回路线列表";
    return `<div class="route-panel-head"><button class="text-button" data-action="route-detail-back">${backLabel}</button></div><h2>${escapeHtml(route.route_name || route.route_key)}</h2><div class="route-summary"><span><strong>${route.activity_count || 0}</strong><small>次活动</small></span><span><strong>${formatDistanceKm(route.total_distance_km)}</strong><small>累计距离</small></span><span><strong>${route.total_duration_sec == null ? "—" : aerobicDuration(route.total_duration_sec)}</strong><small>累计用时</small></span></div><section class="route-history"><h3>历史活动</h3>${history.length ? history.map(routeHistoryRow).join("") : `<p class="muted">这条路线还没有可展示的活动。</p>`}</section>`;
  }
  if (state.aerobic.routesLoading || !state.aerobic.routes) return `<div class="loading compact-loading"><span class="spinner"></span><p>正在读取路线列表…</p></div>`;
  const routes = state.aerobic.routes.items || [];
  return `<div class="route-panel-head"><button class="text-button" data-action="routes-close">← 返回有氧记录</button></div><div class="route-list">${routes.length ? routes.map((/** @type {any} */ route) => `<button class="route-list-row" data-action="route-detail" data-route-key="${escapeHtml(route.route_key)}"><span><strong>${escapeHtml(route.route_name || route.route_key)}</strong><small>${route.activity_count || 0} 次活动${route.total_distance_km == null ? "" : ` · ${formatDistanceKm(route.total_distance_km)}`}</small></span><span>›</span></button>`).join("") : `<p class="muted">还没有已确认的路线。</p>`}</div>`;
}

function routeBrowser() {
  const content = routePanelContent();
  return `<aside class="route-sidebar" aria-label="路线浏览">${content}</aside><section class="route-mobile-page" aria-label="路线浏览">${content}</section>`;
}

function aerobicView() {
  const list = state.aerobic.list;
  const items = list?.items || [];
  if (state.aerobic.detail && !state.aerobic.routesOpen) return aerobicDetailView(state.aerobic.detail);
  const routesOpen = state.aerobic.routesOpen;
  const routeButton = `<button class="secondary routes-button" data-action="routes-open">路线${state.aerobic.routes?.items?.length ? ` · ${state.aerobic.routes.items.length}` : ""}</button>`;
  const filters = `<div class="aerobic-filters"><select aria-label="月份" data-aerobic-filter="month">${aerobicMonthOptions(items)}</select><select aria-label="运动" data-aerobic-filter="sportType">${aerobicSportOptions(items)}</select>${routeButton}</div>`;
  const head = recordsPageHead("aerobic", "RECORDS · AEROBIC", "有氧", { showTabs: !routesOpen });
  if (state.aerobic.loading || !list) return `${head}${filters}<section class="loading compact-loading"><span class="spinner"></span><p>正在读取有氧记录…</p></section>`;
  if (state.aerobic.error) return `${head}<section class="error-card"><p>${escapeHtml(state.aerobic.error)}</p><button class="primary" data-action="aerobic-retry">重新读取</button></section>`;
  const filtered = filteredAerobicItems();
  const dateScope = state.aerobic.from && state.aerobic.to ? `<span class="records-context">日期：${escapeHtml(state.aerobic.from)}${state.aerobic.from === state.aerobic.to ? "" : ` – ${escapeHtml(state.aerobic.to)}`}</span>` : "";
  const routeFocusClass = routesOpen ? " route-focus" : "";
  const activityPane = `<section class="aerobic-activity-pane"><div class="aerobic-activity-list" aria-label="有氧活动列表">${filtered.length ? filtered.map(aerobicActivityCard).join("") : `<div class="quiet-card"><strong>还没有有氧记录</strong><p>暂无有氧记录，完成一次 sync data 后会显示在这里。</p></div>`}</div></section>`;
  return `${head}${routesOpen ? "" : filters}${routesOpen ? "" : dateScope ? `<div class="aerobic-date-scope">${dateScope}</div>` : ""}<div class="aerobic-route-layout${routeFocusClass}">${activityPane}${routesOpen ? routeBrowser() : ""}</div>`;
}

function agentAccessView() { const access = state.agentAccess; const active = access?.active; const token = state.agentAccessToken; const actions = active ? `<button class="secondary" data-action="rotate-agent-token">重新生成 Token</button><button class="secondary" data-action="revoke-agent-token">撤销 Token</button>` : `<button class="primary" data-action="create-agent-token">创建 Token</button>`; return `<section class="quiet-card"><h2>Agent access</h2><p>${active ? "Agent API 访问已启用。Token 只在创建或重新生成后显示一次。" : "为训练数据 Agent API 创建一个可撤销的访问 Token。"}</p>${token ? `<label>本次 Token（请立即保存）<input aria-label="本次 Agent Token" readonly value="${escapeHtml(token)}" /></label><p class="muted">出于安全考虑，之后的状态读取不会再次返回完整 Token。</p>` : ""}<div class="hero-actions">${actions}${token ? `<button class="secondary" data-action="copy-agent-token">复制 Token</button>` : ""}</div></section>`; }
function settingsView() { const current = state.plan?.current; const share = state.share; const shareActions = share?.active ? `<button class="primary" data-action="copy-share">复制分享链接</button><button class="secondary" data-action="regenerate-share">重新生成</button><button class="secondary" data-action="revoke-share">撤销分享</button>` : `<button class="primary" data-action="create-share">创建分享</button>`; return `<section class="page-head"><p class="eyebrow">SETTINGS</p><h1>设置</h1><p class="muted">管理你的个人信息、计划和分享。</p></section><form class="settings-form" data-form="settings"><label>显示名称<input name="display_name" maxlength="50" value="${escapeHtml(state.me?.display_name || "")}" /></label><label>Timezone<input name="timezone" value="${escapeHtml(state.me?.timezone || state.today?.timezone || "Asia/Shanghai")}" /></label><button class="primary wide">保存设置</button></form><section class="quiet-card"><h2>计划</h2><p>一次检查并原子化应用未来 2–4 周；每周仍保存为独立、不可变的 Plan Revision。</p><div class="hero-actions"><button class="primary" data-action="open-plan-sheet">编排未来计划</button>${current ? `<button class="secondary" data-action="copy-current-plan">复制当前单周 JSON</button>` : ""}</div></section>${futurePlanTimeline()}${agentAccessView()}<section class="quiet-card"><h2>分享</h2><p>${share?.active ? "分享链接已启用，可复制、重新生成或撤销。" : "创建一个永久只读分享链接。"}</p>${share?.active ? `<label>分享链接<input aria-label="分享链接" readonly value="${escapeHtml(share.url || "")}" /></label>` : ""}<div class="hero-actions">${shareActions}<button class="secondary" data-action="export">下载训练数据</button></div></section><button class="secondary wide" data-action="logout">退出登录</button>${state.sheet ? planSheet() : ""}`; }

async function loadMe() { try { state.me = await api("/api/private/me"); } catch {} }
async function loadShare() { try { state.share = await api("/api/private/coach-share"); } catch { state.share = null; } }
async function loadAgentAccess() { try { state.agentAccess = await api("/api/private/agent-access"); } catch { state.agentAccess = null; } }
function initialCalendarWeek() { const first = calendarFirstDate(); const current = calendarMonday(state.today?.date ?? new Date().toISOString().slice(0, 10)); return first && addCalendarDays(current, 6) < first ? calendarMonday(first) : current; }
async function loadCalendarWeek(/** @type {string} */ from, /** @type {string|null|undefined} */ selectedDate = null) {
  state.calendarLoading = true; state.calendarError = null; state.calendarDay = null; state.correction = false; render();
  try {
    const to = addCalendarDays(from, 6);
    const [schedule, sessions] = await Promise.all([api(`/api/private/schedule?from=${from}&to=${to}&include=aerobic_summary`), api(`/api/private/sessions?from=${from}&to=${to}&limit=200`)]);
    const first = calendarFirstDate(); const requestedDate = selectedDate || from; const normalizedSelectedDate = first && requestedDate < first ? first : requestedDate;
    state.calendar = { from, to, selectedDate: normalizedSelectedDate >= from && normalizedSelectedDate <= to ? normalizedSelectedDate : from, entries: schedule.entries, sessions: sessions.items, expiredCount: sessions.items.filter(isExpiredSession).length };
    state.calendarLoading = false;
    await loadCalendarDay(state.calendar.selectedDate, false);
  } catch (/** @type {any} */ error) {
    state.calendarLoading = false; state.calendarDayLoading = false; state.calendarError = error.data?.error?.message || error.message;
  }
  render();
}
async function normalizeExpiredFromCalendar() {
  if (state.calendarMaintenance.pending) return;
  state.calendarMaintenance = { pending: true, error: null };
  render();
  try {
    const result = await api("/api/private/sessions/normalize-expired", { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" });
    state.calendarMaintenance = { pending: false, error: null };
    state.message = result.normalized_count ? `已整理 ${result.normalized_count} 条过期训练记录，统一标记为未完成` : "没有需要整理的过期训练记录";
    await refresh();
    if (state.calendar.from) await loadCalendarWeek(state.calendar.from, state.calendar.selectedDate);
  } catch (/** @type {any} */ error) {
    state.calendarMaintenance = { pending: false, error: error.data?.error?.message || error.message || "整理失败，请重试" };
    render();
  }
}
async function loadCalendarDay(/** @type {any} */ date, shouldRender = true) {
  const first = calendarFirstDate();
  if (!date || (first && date < first)) return;
  state.calendar.selectedDate = date; state.calendarDay = null; state.calendarDayLoading = true; state.calendarError = null; if (shouldRender) render();
  try {
    const schedule = await api(`/api/private/schedule?from=${date}&to=${date}&expand=prescription&include=aerobic_summary`);
    const entry = schedule.entries[0]; const detail = entry?.session_key ? await api(`/api/private/sessions/${entry.session_key}`) : null;
    state.calendarDay = entry ? { entry, session: detail } : null;
  } catch (/** @type {any} */ error) { state.calendarError = error.data?.error?.message || error.message; }
  state.calendarDayLoading = false; if (shouldRender) render();
}
function bind() {
  queryElements("[data-view]").forEach((button) => button.addEventListener("click", async () => { const destination = button.dataset.view; if (destination !== "today" && state.view === "today" && !(await ensureSessionPaused("navigation"))) return; const wasCalendar = state.view === "calendar"; state.view = destination; if (state.view === "settings") { await Promise.all([loadMe(), loadShare(), loadAgentAccess()]); render(); } else if (state.view === "calendar") { if (!calendarFirstDate()) return render(); await loadCalendarWeek(wasCalendar && state.calendar.from ? state.calendar.from : initialCalendarWeek(), wasCalendar ? state.calendar.selectedDate : state.today?.date); } else if (state.view === "progress" && state.recordsTab === "overview" && !state.recordsOverview) { await loadRecordsOverview(); } else render(); }));
  queryElements("[data-action]").forEach((element) => element.addEventListener("click", () => action(element.dataset.action, element.dataset.index ?? element.dataset.exerciseKey ?? element.dataset.rpe ?? element.dataset.range ?? element.dataset.tab ?? element.dataset.activityRef ?? element.dataset.routeKey, element.dataset.date)));
  queryElements("[data-aerobic-filter]").forEach((element) => element.addEventListener("change", () => { const filterKey = element.dataset.aerobicFilter; if (filterKey) state.aerobic[filterKey] = /** @type {HTMLInputElement} */ (element).value; render(); }));
  queryElements(".bottom-sheet").forEach((sheet) => sheet.addEventListener("click", (event) => event.stopPropagation()));
  queryElements("[data-exercise]").forEach((element) => element.addEventListener("click", () => openExercise(element.dataset.exercise)));
  const form = queryForm("[data-form=settings]"); if (form) form.addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); try { await api("/api/private/settings", { method: "PUT", body: JSON.stringify(values) }); state.message = "设置已保存"; await refresh(); } catch (/** @type {any} */ error) { state.error = error.data?.error?.message || error.message; render(); } });
  const loginForm = queryForm("[data-form=login]"); if (loginForm) loginForm.addEventListener("submit", async (event) => { event.preventDefault(); state.authMessage = ""; const values = Object.fromEntries(new FormData(loginForm)); try { await api("/api/auth/login", { method: "POST", body: JSON.stringify(values) }); state.authRequired = false; await refresh(); } catch (/** @type {any} */ error) { state.authMessage = error.data?.error?.message || "邮箱或密码不正确"; render(); } });
  const textarea = queryControl("#plan-json"); if (textarea) textarea.addEventListener("input", () => { state.draft = textarea.value; state.planError = null; state.planEvidence = null; state.planEditorMode = null; });
  const focusFeedback = queryControl(".focus-feedback-input"); if (focusFeedback) focusFeedback.addEventListener("input", () => { const exerciseKey = focusFeedback.dataset.exerciseKey; if (exerciseKey) state.feedbackDraft[exerciseKey] = focusFeedback.value; });
  const actualValue = queryControl("#actual-value"); if (actualValue) actualValue.addEventListener("input", () => { const completionKey = actualValue.dataset.completionKey; if (completionKey) state.actualDrafts[completionKey] = actualValue.value; });
  const actualWeight = queryControl("#actual-weight"); if (actualWeight) actualWeight.addEventListener("input", () => { const completionKey = actualWeight.dataset.completionKey; if (completionKey) state.resistanceDrafts[completionKey] = actualWeight.value; });
  const actualRir = queryControl("#actual-rir"); if (actualRir) actualRir.addEventListener("input", () => { const completionKey = actualRir.dataset.completionKey; if (completionKey) state.rirDrafts[completionKey] = actualRir.value; });
  const endNote = queryControl("#end-note"); if (endNote) endNote.addEventListener("input", () => { state.endNote = endNote.value; });
  queryElements("[data-end-feedback]").forEach((input) => input.addEventListener("input", () => { const feedbackKey = input.dataset.endFeedback; if (feedbackKey) state.endFeedback[feedbackKey] = /** @type {HTMLInputElement} */ (input).value; }));
}

async function action(/** @type {any} */ name, /** @type {any} */ value, /** @type {any} */ date) {
  const mutationAction = name === "save-adjust" ? "complete" : name;
  if (sessionMutationActions.has(mutationAction) && state.sessionMutation.pending) return;
  try {
    if (name === "refresh") return refresh(); if (name === "logout") { await api("/api/auth/logout", { method: "POST" }); state.authRequired = true; state.me = null; state.share = null; state.agentAccess = null; state.agentAccessToken = null; return render(); } if (name === "settings") { state.view = "settings"; await Promise.all([loadMe(), loadShare(), loadAgentAccess()]); return render(); }
    if (name === "calendar-retry") return loadCalendarWeek(state.calendar.from || initialCalendarWeek(), state.calendar.selectedDate || state.today?.date);
    if (name === "calendar-previous") return loadCalendarWeek(addCalendarDays(state.calendar.from, -7), addCalendarDays(state.calendar.selectedDate || state.calendar.from, -7));
    if (name === "calendar-next") return loadCalendarWeek(addCalendarDays(state.calendar.from, 7), addCalendarDays(state.calendar.selectedDate || state.calendar.from, 7));
    if (name === "calendar-select") return loadCalendarDay(date);
    if (name === "progress-range") return loadProgress(value);
    if (name === "records-tab") { state.recordsTab = value; state.exercise = null; state.aerobic.detail = null; state.aerobic.routesOpen = false; state.aerobic.routeDetail = null; state.aerobic.routeOrigin = null; if (value === "overview" && !state.recordsOverview) return loadRecordsOverview(); if (value === "aerobic" && !state.aerobic.list) return loadAerobicActivities(); return render(); }
    if (name === "open-aerobic-date") { state.view = "progress"; state.recordsTab = "aerobic"; state.exercise = null; state.aerobic.detail = null; state.aerobic.routesOpen = false; state.aerobic.routeDetail = null; state.aerobic.routeOrigin = null; state.aerobic.from = date; state.aerobic.to = date; state.aerobic.month = "all"; state.aerobic.sportType = "all"; return loadAerobicActivities(); }
    if (name === "aerobic-retry") return loadAerobicActivities();
    if (name === "aerobic-detail") return openAerobicDetail(value);
    if (name === "aerobic-back") { state.aerobic.detail = null; state.aerobic.routesOpen = false; state.aerobic.routeDetail = null; state.aerobic.routeOrigin = null; return render(); }
    if (name === "routes-open") { state.aerobic.routesOpen = true; state.aerobic.routeDetail = null; state.aerobic.routeOrigin = null; return loadRoutes(); }
    if (name === "routes-close") { state.aerobic.routesOpen = false; state.aerobic.routeDetail = null; state.aerobic.routeOrigin = null; return render(); }
    if (name === "route-detail") return openRouteDetail(value, state.aerobic.detail ? "activity" : "list");
    if (name === "route-detail-back") { const fromActivity = state.aerobic.routeOrigin === "activity"; state.aerobic.routeDetail = null; state.aerobic.routeOrigin = null; state.aerobic.routesOpen = !fromActivity; return render(); }
    if (name === "calendar-correct") { state.correction = true; return render(); }
    if (name === "normalize-expired") return normalizeExpiredFromCalendar();
    if (name === "start") {
      if (!state.today) return refresh();
      if (!beginSessionMutation("start")) return;
      const result = await api(`/api/private/scheduled-workouts/${state.today.date}/start`, { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" });
      showSession(result, null, { active: true });
      return;
    }
    if (name === "skip") { if (!state.today) return refresh(); const result = await api(`/api/private/scheduled-workouts/${state.today.date}/skip`, { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ skip_reason: null }) }); state.session = result; await openSession(result.session_key); return; }
    if (name === "restart") {
      if (!state.session) return refresh();
      if (!beginSessionMutation("restart")) return;
      const result = await api(`/api/private/sessions/${state.session.session_key}/restart`, { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" });
      showSession(result, null, { active: true });
      return;
    }
    if (name === "open-session") return state.session ? openSession(state.session.session_key) : refresh();
    if (name === "continue") {
      if (!state.session) return refresh();
      if (!beginSessionMutation("continue")) return;
      const result = await api(`/api/private/sessions/${state.session.session_key}/continue`, { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" });
      showSession(result, null, { active: true });
      return;
    }
    if (name === "start-timed") { startTimedAction(); return; }
    if (name === "complete" || name === "save-adjust") return await completeCurrent(); if (name === "previous") { resetTimedAction(); state.focusIndex = Math.max(0, state.focusIndex - 1); state.adjust = false; return render(); } if (name === "next") { resetTimedAction(); const max = displayCompletionItems(state.sessionDetail).length - 1 || 0; state.focusIndex = Math.min(max, state.focusIndex + 1); state.adjust = false; return render(); } if (name === "jump-item") { resetTimedAction(); state.focusIndex = Number(value); state.progressOpen = false; state.adjust = false; clearRestCountdown(); return render(); } if (name === "toggle-adjust") { state.adjust = !state.adjust; return render(); } if (name === "toggle-progress") { state.progressOpen = !state.progressOpen; return render(); } if (name === "toggle-timer") return await toggleTimer(); if (name === "toggle-mute") return toggleAudioMuted(); if (name === "minimize") { if (!(await ensureSessionPaused("navigation"))) return; stopSessionClock(); resetTimedAction(); state.sessionDetail = null; state.progressOpen = false; state.adjust = false; state.feedbackOpen = null; clearRestCountdown(); state.endSheet = false; state.timerPaused = false; state.timerPauseStartedAt = null; state.timerPausedSec = 0; return refresh(); } if (name === "skip-rest") { resetTimedAction(); state.focusIndex = state.restNextIndex ?? state.focusIndex; clearRestCountdown(); return render(); } if (name === "open-feedback") { state.feedbackOpen = value || null; return render(); } if (name === "close-feedback") { state.feedbackOpen = null; return render(); }
    if (name === "end") { beginEndSheet(); await pauseForInterruption("end-form"); return render(); } if (name === "set-end-rpe") { state.endRpe = Number(value); return render(); } if (name === "save-end") return endCurrent(); if (name === "cancel-end") { state.endSheet = false; return render(); } if (name === "edit-session") { state.correction = true; return render(); } if (name === "cancel-correction") { state.correction = false; return render(); } if (name === "save-correction") return saveCorrection(); if (name === "open-progress-list") { state.focusIndex = 0; state.progressOpen = true; return render(); }
    if (name === "close-exercise") { state.exercise = null; state.recordsTab = "strength"; return render(); }
    if (name === "open-plan-sheet") { state.sheet = true; state.preview = null; state.planEvidence = null; state.planEditorMode = null; state.error = null; state.planError = null; return render(); } if (name === "copy-current-plan") return copyCurrentPlan(); if (name === "close-sheet") { state.sheet = false; state.preview = null; state.planEvidence = null; state.planEditorMode = null; state.planError = null; return render(); }
    if (name === "validate-plan") return validatePlan(); if (name === "confirm-plan") return confirmPlan(); if (name === "copy-error") return navigator.clipboard?.writeText(state.planError || "计划需要修正"); if (name === "export") { window.location.href = "/api/private/export"; return; }
    if (name === "create-share") { await api("/api/private/coach-share", { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); await loadShare(); return copyShare("分享链接已创建并复制"); }
    if (name === "copy-share") return copyShare("分享链接已复制");
    if (name === "regenerate-share") { await api("/api/private/coach-share/regenerate", { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); await loadShare(); return copyShare("分享链接已重新生成并复制"); }
    if (name === "revoke-share") { await api("/api/private/coach-share", { method: "DELETE" }); state.share = { active: false, share_key: null, url: null }; state.message = "分享已撤销"; return render(); }
    if (name === "create-agent-token" || name === "rotate-agent-token") { const result = await api("/api/private/agent-access", { method: "POST", body: "{}" }); state.agentAccess = { active: true, created_at: result.created_at, rotated_at: result.rotated_at, revoked_at: null }; state.agentAccessToken = result.token; state.message = name === "create-agent-token" ? "Agent Token 已创建，请立即保存" : "Agent Token 已重新生成，旧 Token 已失效"; return render(); }
    if (name === "revoke-agent-token") { const result = await api("/api/private/agent-access", { method: "DELETE" }); state.agentAccess = { active: false, created_at: state.agentAccess?.created_at ?? null, rotated_at: state.agentAccess?.rotated_at ?? null, revoked_at: new Date().toISOString() }; state.agentAccessToken = null; state.message = result.revoked ? "Agent Token 已撤销" : "没有启用的 Agent Token"; return render(); }
    if (name === "copy-agent-token") { let copied = false; try { if (state.agentAccessToken && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(state.agentAccessToken); copied = true; } } catch {} state.message = copied ? "Agent Token 已复制，请妥善保存" : "请复制上方显示的 Agent Token"; return render(); }
  } catch (/** @type {any} */ error) {
    if (sessionMutationActions.has(mutationAction) && state.sessionMutation.action === mutationAction) return failSessionMutation(mutationAction, error);
    state.error = error.data?.error?.message || error.message;
    render();
  }
}

function beginEndSheet() {
  const detail = state.sessionDetail;
  state.endSheet = true;
  state.endRpe = typeof detail?.session_rpe === "number" && Number.isInteger(detail.session_rpe) ? detail.session_rpe : 8;
  state.endNote = detail?.note || "";
  state.endFeedback = Object.fromEntries((detail?.exercise_feedback || []).map((item) => [item.exercise_occurrence_key, item.text]));
}
function showSession(/** @type {any} */ detail, /** @type {number|null} */ requestedIndex = null, /** @type {ShowSessionOptions} */ options = {}) {
  clearSessionMutation();
  resetTimedAction();
  syncSessionDetail(detail);
  const pausedOnEntry = detail.status === "in_progress" && options.active !== true && (options.forcePaused === true || !hasOpenTrainingInterval(detail));
  state.timerPaused = pausedOnEntry;
  state.timerPauseReason = pausedOnEntry ? options.pauseReason || "navigation" : null;
  state.timerPauseStartedAt = pausedOnEntry ? options.pausedAt || clockNow() : null;
  state.timerPausedSec = 0;
  const items = displayCompletionItems(detail);
  const savedKeys = new Set((detail.completion_results || []).map((/** @type {any} */ result) => result.completion_item_key));
  state.actualDrafts = Object.fromEntries(Object.entries(state.actualDrafts).filter(([completionItemKey]) => !savedKeys.has(completionItemKey)));
  state.resistanceDrafts = Object.fromEntries(Object.entries(state.resistanceDrafts).filter(([completionItemKey]) => !savedKeys.has(completionItemKey)));
  state.rirDrafts = Object.fromEntries(Object.entries(state.rirDrafts).filter(([completionItemKey]) => !savedKeys.has(completionItemKey)));
  const firstIncomplete = items.findIndex((item) => !displayItemDone(detail, item));
  state.focusIndex = requestedIndex == null ? (firstIncomplete >= 0 ? firstIncomplete : 0) : Math.max(0, Math.min(requestedIndex, Math.max(0, items.length - 1)));
  state.progressOpen = false;
  state.adjust = false;
  state.feedbackOpen = null;
  state.feedbackDraft = Object.fromEntries((detail.exercise_feedback || []).map((/** @type {any} */ item) => [item.exercise_occurrence_key, item.text]));
  const restSeconds = Number(options.restSeconds) || 0;
  const scheduledRest = restSeconds > 0 ? workoutTimeline.scheduleRest({ remainingMs: restSeconds * 1000, audible: !state.muted && state.audio.status === "ready" }) : null;
  state.restUntil = scheduledRest?.endsAtMs ?? null;
  state.restRemainingMs = restSeconds > 0 ? restSeconds * 1000 : null;
  state.restNextIndex = restSeconds > 0 ? options.nextIndex : null;
  if (scheduledRest && !state.muted && state.audio.status === "ready") observeAudioResult(scheduledRest.result);
  state.endSheet = Boolean(options.openEnd);
  if (state.endSheet) beginEndSheet();
  state.view = "today";
  render();
}
async function openSession(/** @type {string} */ sessionKey, /** @type {number|null} */ requestedIndex = null, /** @type {ShowSessionOptions} */ options = {}) {
  let detail = await api(`/api/private/sessions/${sessionKey}`);
  if (detail.status === "in_progress" && hasOpenTrainingInterval(detail)) {
    try {
      detail = await postSessionCommand(detail, "pause", { close_at: detail.updated_at });
    } catch {
      showSession(detail, requestedIndex, { ...options, forcePaused: true, pauseReason: "navigation", pausedAt: Date.parse(detail.updated_at) || clockNow() });
      return;
    }
  }
  showSession(detail, requestedIndex, { ...options, active: false });
}
async function copyShare(/** @type {any} */ message) { let copied = false; try { if (state.share?.url && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(state.share.url); copied = true; } } catch {} state.message = copied ? message : "分享链接已准备好，请复制下方链接"; return render(); }
async function openExercise(/** @type {any} */ exerciseKey) { try { if (!(await ensureSessionPaused("navigation"))) return; state.exercise = await api(`/api/private/exercises/${encodeURIComponent(exerciseKey)}?preset=12w`); state.recordsTab = "strength"; state.view = "progress"; render(); } catch (/** @type {any} */ error) { state.error = error.data?.error?.message || error.message; render(); } }
async function copyCurrentPlan() { try { const packageValue = await api("/api/private/plan/update-package"); state.draft = JSON.stringify(packageValue, null, 2); state.sheet = true; state.preview = null; state.planEvidence = null; state.planEditorMode = null; state.error = null; state.planError = null; await navigator.clipboard?.writeText(state.draft); state.message = "当前计划 JSON 已复制，请修改 effective_from 或内容后检查"; render(); } catch (/** @type {any} */ error) { state.error = error.data?.error?.message || error.message; render(); } }
async function completeCurrent() {
  const detail = state.sessionDetail;
  const item = detail ? displayCompletionItems(detail)[state.focusIndex] : null;
  if (!detail || !item) return;
  const timedTarget = canonicalDurationSeconds(item.target);
  if (timedTarget != null && (state.timedAction.itemKey !== item.completion_item_key || state.timedAction.phase !== "complete")) return;
  const currentIndex = state.focusIndex;
  const restSeconds = itemContext(detail, item).set?.rest_after_sec || 0;
  const itemKeys = new Set(completionKeys(item));
  const existing = detail.completion_results.filter((result) => !itemKeys.has(result.completion_item_key));
  const actualInput = queryControl("#actual-value");
  const rawValue = actualInput?.value || state.actualDrafts[item.completion_item_key] || String(canonicalDurationSeconds(item.target) ?? item.target.value ?? item.target.min ?? 1);
  const weightInput = queryControl("#actual-weight");
  const rawWeight = weightInput?.value ?? state.resistanceDrafts[item.completion_item_key];
  const rirInput = queryControl("#actual-rir")?.value ?? state.rirDrafts[item.completion_item_key] ?? "";
  state.actualDrafts[item.completion_item_key] = String(rawValue);
  if (rawWeight !== undefined) state.resistanceDrafts[item.completion_item_key] = String(rawWeight);
  state.rirDrafts[item.completion_item_key] = String(rirInput);
  const feedbackInput = queryControl(".focus-feedback-input");
  if (feedbackInput?.dataset.exerciseKey) state.feedbackDraft[feedbackInput.dataset.exerciseKey] = feedbackInput.value;
  const exerciseFeedback = Object.entries(state.feedbackDraft).map(([exercise_occurrence_key, text]) => ({ exercise_occurrence_key, text: text.trim() })).filter((item) => item.text);
  const completedAt = new Date().toISOString();
  const resultResistance = resultResistanceInput(item, rawWeight);
  const resultValues = completionKeys(item).map((/** @type {any} */ completion_item_key) => ({ completion_item_key, status: "completed", actual: { metric: item.target.metric, value: Number(rawValue) }, resistance: resultResistance, rir: rirInput === "" || rirInput == null ? null : Number(rirInput), note: null, completed_at: completedAt }));
  const result = { completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value: Number(rawValue) }, resistance: resultResistance, rir: rirInput === "" || rirInput == null ? null : Number(rirInput), completed_at: completedAt };
  if (!beginSessionMutation("complete")) return;
  const audioActivation = restSeconds > 0 && !state.muted ? workoutTimeline.activateAudio() : Promise.resolve(null);
  const [updated, audioResult] = await Promise.all([
    api(`/api/private/sessions/${detail.session_key}/record`, { method: "PUT", body: JSON.stringify(detail.snapshot.schema_version === 2 ? { record_schema_version: 2, set_results: [...existing.map((saved) => canonicalStoredResultInput(saved, detail)), ...resultValues], training_intervals: detail.training_intervals, session_rpe: null, note: detail.note, exercise_feedback: exerciseFeedback, skip_reason: null } : { record_schema_version: 1, completion_results: [...existing, result], training_intervals: detail.training_intervals, session_rpe: null, note: detail.note, exercise_feedback: exerciseFeedback, skip_reason: null }) }),
    audioActivation,
  ]);
  if (audioResult) {
    const audioError = audioFailureFor(audioResult);
    state.audio = audioError ? { status: "error", error: audioError } : { status: "ready", error: null };
  }
  const updatedItems = displayCompletionItems(updated);
  const nextIndex = updatedItems.findIndex((candidate, index) => index > currentIndex && !displayItemDone(updated, candidate));
  const fallbackIndex = nextIndex >= 0 ? nextIndex : updatedItems.findIndex((candidate) => !displayItemDone(updated, candidate));
  showSession(updated, fallbackIndex >= 0 ? fallbackIndex : 0, { restSeconds: fallbackIndex >= 0 ? restSeconds : 0, nextIndex: fallbackIndex >= 0 ? fallbackIndex : null, openEnd: fallbackIndex < 0, active: true });
}
async function endCurrent() {
  const detail = state.sessionDetail;
  if (!detail) return;
  const endNote = queryControl("#end-note"); if (endNote) state.endNote = endNote.value;
  queryElements("[data-end-feedback]").forEach((input) => { const feedbackKey = input.dataset.endFeedback; if (feedbackKey) state.endFeedback[feedbackKey] = /** @type {HTMLInputElement} */ (input).value; });
  const feedback = Object.entries(state.endFeedback).map(([exercise_occurrence_key, text]) => ({ exercise_occurrence_key, text: text.trim() })).filter((item) => item.text);
  const record = detail.snapshot.schema_version === 2
    ? { record_schema_version: 2, set_results: detail.completion_results.map((result) => canonicalStoredResultInput(result, detail)), training_intervals: detail.training_intervals, session_rpe: Number.isInteger(state.endRpe) ? state.endRpe : null, note: state.endNote.trim() || null, exercise_feedback: feedback, skip_reason: null }
    : { record_schema_version: 1, completion_results: detail.completion_results, training_intervals: detail.training_intervals, session_rpe: Number.isInteger(state.endRpe) ? state.endRpe : null, note: state.endNote.trim() || null, exercise_feedback: feedback, skip_reason: null };
  const result = await api(`/api/private/sessions/${detail.session_key}/end`, { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ record, ended_at: new Date().toISOString() }) });
  stopSessionClock(); releaseWakeLock(); state.session = result; state.sessionDetail = null; state.todayDetail = null; state.endSheet = false; state.timerPauseReason = null; clearRestCountdown(); await refresh();
}
async function saveCorrection() {
  const detail = state.view === "calendar" ? state.calendarDay?.session : state.sessionDetail || state.todayDetail;
  if (!detail) return;
  const isSkipped = detail.status === "skipped";
  const correctionTimestamp = detail.training_intervals.at(-1)?.ended_at || detail.updated_at;
  const existingResults = new Map(detail.completion_results.map((/** @type {any} */ result) => [result.completion_item_key, result]));
  const canonicalSetResults = isSkipped ? [] : detail.snapshot.completion_items.map((/** @type {any} */ item) => {
    const value = queryControl(`#correction-value-${item.completion_item_key}`)?.value;
    const weight = queryControl(`#correction-weight-${item.completion_item_key}`)?.value;
    const rir = queryControl(`#correction-rir-${item.completion_item_key}`)?.value;
    const existing = existingResults.get(item.completion_item_key);
    const hasValue = Boolean(value);
    return {
      completion_item_key: item.completion_item_key,
      status: hasValue ? "completed" : "skipped",
      actual: hasValue ? { metric: item.target.metric, value: Number(value) } : null,
      resistance: hasValue ? resultResistanceInput(item, weight) : null,
      rir: hasValue && rir !== "" && rir != null ? Number(rir) : null,
      note: existing?.note ?? null,
      completed_at: hasValue ? existing?.completed_at || correctionTimestamp : null,
    };
  });
  const completion_results = isSkipped ? [] : detail.snapshot.completion_items.map((/** @type {any} */ item) => {
    const value = queryControl(`#correction-value-${item.completion_item_key}`)?.value;
    if (!value) return null;
    const weight = queryControl(`#correction-weight-${item.completion_item_key}`)?.value;
    const rir = queryControl(`#correction-rir-${item.completion_item_key}`)?.value;
    const existing = existingResults.get(item.completion_item_key);
    return { completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value: Number(value) }, resistance: resultResistanceInput(item, weight), rir: rir === "" || rir == null ? null : Number(rir), completed_at: existing?.completed_at || correctionTimestamp };
  }).filter(Boolean);
  const feedback = isSkipped ? [] : detail.snapshot.blocks.flatMap((/** @type {any} */ block) => block.exercises).map((/** @type {any} */ exercise) => ({ exercise_occurrence_key: exercise.exercise_occurrence_key, text: queryControl(`#correction-feedback-${exercise.exercise_occurrence_key}`)?.value.trim() })).filter((/** @type {any} */ item) => item.text);
  const correctionRpe = queryControl("#correction-rpe")?.value;
  const sessionRpe = isSkipped ? null : (correctionRpe ? Number(correctionRpe) : null);
  const note = queryControl("#correction-note")?.value.trim() || null;
  const skipReason = isSkipped ? (queryControl("#correction-skip-reason")?.value.trim() || null) : null;
  const record = detail.snapshot.schema_version === 2
    ? { record_schema_version: 2, set_results: canonicalSetResults, training_intervals: isSkipped ? [] : detail.training_intervals, session_rpe: sessionRpe, note, exercise_feedback: feedback, skip_reason: skipReason }
    : { record_schema_version: 1, completion_results, training_intervals: isSkipped ? [] : detail.training_intervals, session_rpe: sessionRpe, note, exercise_feedback: feedback, skip_reason: skipReason };
  await api(`/api/private/sessions/${detail.session_key}/record`, { method: "PUT", body: JSON.stringify(record) });
  state.correction = false;
  if (state.view === "calendar") return loadCalendarDay(state.calendar.selectedDate);
  await openSession(detail.session_key);
}
async function validatePlan() { try { const parsed = JSON.parse(state.draft); const isBatch = Array.isArray(parsed?.updates); const path = isBatch ? "/api/private/plan-update-batches/validate" : "/api/private/plan-updates/validate"; const body = isBatch ? { batch_text: state.draft } : { package_text: state.draft }; const result = await api(path, { method: "POST", body: JSON.stringify(body) }); state.preview = result.preview; state.planEditorMode = isBatch ? "batch" : "single"; state.planEvidence = isBatch ? { batch_digest: result.batch_digest, base_plan_digest: result.base_plan_digest } : null; state.planError = null; render(); } catch (/** @type {any} */ error) { state.planEvidence = null; state.planEditorMode = null; state.planError = error.data?.error?.details?.map((/** @type {any} */ detail) => `${detail.path}: ${detail.message}`).join("\n") || error.data?.error?.message || error.message; state.error = null; render(); } }
async function confirmPlan() { if (state.planEditorMode === "batch") { if (!state.planEvidence) throw new Error("批量计划缺少已验证证据，请重新检查"); await api("/api/private/plan-update-batches/apply", { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ batch_text: state.draft, batch_digest: state.planEvidence.batch_digest, base_plan_digest: state.planEvidence.base_plan_digest, confirmed: true }) }); } else { await api("/api/private/plan-updates/apply", { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ package_text: state.draft }) }); } state.sheet = false; state.preview = null; state.planEvidence = null; state.planEditorMode = null; await refresh(); }

function handlePageHide() { void pauseForInterruption("pagehide"); }
if (typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("pagehide", handlePageHide);
}
refresh();
