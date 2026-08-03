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
const state = { view: "today", today: null, todayDetail: null, plan: null, progress: null, progressRange: "current", progressLoading: false, calendar: { from: null, to: null, selectedDate: null, entries: [], sessions: [] }, calendarDay: null, calendarLoading: false, calendarDayLoading: false, calendarError: null, session: null, sessionDetail: null, exercise: null, me: null, share: null, focusIndex: 0, progressOpen: false, feedbackOpen: null, feedbackDraft: {}, adjust: false, correction: false, sheet: false, preview: null, endSheet: false, endRpe: 8, endNote: "", endFeedback: {}, restUntil: null, restNextIndex: null, timerHandle: null, timerPaused: false, timerPauseStartedAt: null, timerPausedSec: 0, draft: "", error: null, planError: null, loading: true, authRequired: false, authMessage: "", message: "" };

const app = document.querySelector("#app");
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const localEmail = localStorage.getItem("workout-athlete-email");
  if (localEmail && ["localhost", "127.0.0.1"].includes(location.hostname)) headers["x-athlete-email"] = localEmail;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "请求失败"), { data, status: response.status });
  return data;
}
const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const pct = (value) => `${Math.round((value || 0) * 100)}%`;
const addCalendarDays = (date, days) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const calendarWeekday = (date) => { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return day === 0 ? 6 : day - 1; };
const calendarMonday = (date) => addCalendarDays(date, -calendarWeekday(date));
const calendarFirstDate = () => state.plan?.first_effective_from || null;
const calendarStatus = (entry, session) => { if (entry.kind === "rest") return { key: "rest", label: "休息日" }; if (entry.kind === "no_plan") return { key: "no_plan", label: "无计划" }; if (session?.status === "in_progress") return { key: "in_progress", label: "进行中" }; if (session?.status === "completed") return { key: "completed", label: "已完成" }; if (session?.status === "partial") return { key: "partial", label: "未完成" }; if (session?.status === "skipped") return { key: "skipped", label: "已跳过" }; if (entry.is_overdue_unstarted) return { key: "overdue", label: "未开始" }; if (entry.date === state.today?.date) return { key: "today", label: "未开始" }; return { key: "scheduled", label: "未开始" }; };
const monthStart = (date) => `${date.slice(0, 7)}-01`;
const shiftMonth = (date, offset) => { const [year, month] = date.slice(0, 7).split("-").map(Number); const shifted = new Date(Date.UTC(year, month - 1 + offset, 1)); return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`; };
const progressRangeLabel = (range) => ({ current: "当月", previous: "上月", all: "累计" }[range] || "当月");
function progressQuery(range = state.progressRange) { const today = state.today.date; if (range === "all") return "preset=all"; if (range === "previous") { const from = shiftMonth(today, -1); return `from=${from}&to=${addCalendarDays(monthStart(today), -1)}`; } return `from=${monthStart(today)}&to=${today}`; }

async function refresh() {
  state.loading = true; render();
  try {
    [state.today, state.plan] = await Promise.all([api("/api/private/today"), api("/api/private/plan")]);
    state.progress = await api(`/api/private/progress?${progressQuery()}`);
    state.session = state.today.session;
    state.todayDetail = null;
    if (state.session?.session_key) {
      try { state.todayDetail = await api(`/api/private/sessions/${state.session.session_key}`); } catch {}
    }
    state.error = null;
  } catch (error) {
    if (error.status === 401) { state.authRequired = true; state.error = null; }
    else state.error = error.data?.error?.message || error.message;
  }
  state.loading = false; render();
}

async function loadProgress(range) {
  state.progressRange = range;
  state.progressLoading = true;
  render();
  try { state.progress = await api(`/api/private/progress?${progressQuery(range)}`); state.error = null; }
  catch (error) { state.error = error.data?.error?.message || error.message; }
  state.progressLoading = false;
  render();
}

function shell(content) {
  const focused = state.view === "today" && state.sessionDetail?.status === "in_progress";
  return `<div class="shell ${focused ? "session-shell" : ""}"><main>${content}</main>${state.message ? `<div class="notice" role="status">${escapeHtml(state.message)}</div>` : ""}${focused ? "" : `<nav class="bottom-nav" aria-label="主导航">${[["today", "今日"], ["calendar", "日历"], ["progress", "进展"], ["settings", "设置"]].map(([id, label]) => `<button class="nav-link ${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}</nav>`}</div>`;
}

function render() {
  if (state.authRequired) { app.innerHTML = loginView(); bind(); syncSessionClock(); return; }
  if (state.loading) { stopSessionClock(); app.innerHTML = shell(`<section class="loading"><span class="spinner"></span><p>正在读取你的训练状态…</p></section>`); return; }
  if (state.error) { app.innerHTML = shell(`<section class="error-card"><p>${escapeHtml(state.error)}</p><button class="primary" data-action="refresh">重新读取</button></section>`); bind(); syncSessionClock(); return; }
  const content = state.view === "today" ? todayView() : state.view === "calendar" ? calendarView() : state.view === "progress" ? progressView() : settingsView();
  app.innerHTML = shell(content); bind(); syncSessionClock();
}

function loginView() {
  return `<div class="shell"><main><section class="hero"><p class="eyebrow">WORKOUT TRACKER</p><h1>登录你的训练空间</h1><p class="muted">使用已配置的登录凭据访问训练空间。</p></section><form class="settings-form" data-form="login"><label>邮箱<input name="email" type="email" autocomplete="username" required /></label><label>密码<input name="password" type="password" autocomplete="current-password" required /></label>${state.authMessage ? `<div class="validation-error">${escapeHtml(state.authMessage)}</div>` : ""}<button class="primary wide">登录</button></form></main></div>`;
}

function todayView() {
  const entry = state.today?.entry; const session = state.today?.session;
  if (!entry || entry.kind === "no_plan") return `<section class="today-page"><div class="today-content"><p class="eyebrow">${state.today?.date || "今天"}</p><h1>今天没有计划</h1><p class="muted">可以在设置中提交未来训练计划。</p></div></section>`;
  if (entry.kind === "rest") return `<section class="today-page"><div class="today-content"><p class="eyebrow">${state.today.date} · ${state.today.timezone}</p><span class="status-dot rest"></span><h1>休息日</h1><p class="muted">今天不安排训练。</p><div class="quiet-card">今天把恢复留给自己。</div></div></section>`;
  if (session) return state.correction && state.todayDetail ? correctionView(state.todayDetail, entry) : sessionView(session, entry);
  const plan = entry.prescription;
  return `<section class="today-page"><div class="today-content"><p class="eyebrow">${state.today.date} · ${state.today.timezone}</p><h1>${escapeHtml(entry.title)}</h1><p class="muted">约 ${entry.estimated_duration_min} 分钟 · 只记录今天的训练</p><div class="hero-actions"><button class="primary" data-action="start">开始训练</button><button class="secondary" data-action="skip">跳过今天</button></div><section class="today-plan calendar-prescription" aria-label="今日训练计划"><div class="today-plan-head"><h2>今日训练计划</h2><span>${entry.module_count} 个模块</span></div>${plan ? renderCalendarPrescription(plan) : `<p class="muted">今天的训练计划暂时无法读取。</p>`}</section></div></section>`;
}

function sessionView(session, entry) {
  const detail = state.sessionDetail;
  const items = detail?.snapshot?.completion_items || [];
  if (session.status === "skipped") return `<section class="hero"><span class="status-pill skipped">已跳过</span><h1>${escapeHtml(entry.title)}</h1><p class="muted">跳过保留在今天的记录中。你仍可以在今天重新开始。</p><button class="primary" data-action="restart">重新开始训练</button></section>`;
  if (!detail) return todayProgressView(session, entry, state.todayDetail);
  if (state.restUntil && state.restNextIndex != null) return restView(detail, items);
  const item = items[state.focusIndex] || items[0]; const result = detail.completion_results.find((candidate) => candidate.completion_item_key === item?.completion_item_key); const isDone = Boolean(result);
  if (session.status === "completed" || session.status === "partial") {
    if (state.correction) return correctionView(detail, entry);
    return sessionSummaryView(session, entry, detail);
  }
  const context = itemContext(detail, item); const target = focusTarget(item.target); const parts = [`计划：${target}`, focusResistance(context.set?.resistance ?? item.resistance), context.set?.target_rir == null ? null : `RIR ${context.set.target_rir}`, context.set?.rest_after_sec == null ? null : `休息 ${context.set.rest_after_sec} 秒`].filter(Boolean); const actual = result?.actual;
  const actualRows = `<div class="actual-row"><span>${item.target.metric === "reps" ? "次数" : "时长"}</span><strong>${actual ? `${target} / <em>${formatActual(actual)}</em>` : target}</strong></div>${context.set?.resistance ? `<div class="actual-row"><span>重量</span><strong>${focusResistance(context.set.resistance)}</strong></div>` : ""}${context.set?.target_rir != null || result?.rir != null ? `<div class="actual-row"><span>RIR</span><strong>${result?.rir == null ? context.set?.target_rir ?? "—" : `<em>${result.rir}</em>`}</strong></div>` : ""}`;
  const feedbackText = state.feedbackDraft[item.exercise_occurrence_key] ?? detail.exercise_feedback.find((entry) => entry.exercise_occurrence_key === item.exercise_occurrence_key)?.text ?? "";
  const feedback = `<textarea class="focus-feedback-input" id="feedback-${item.exercise_occurrence_key}" data-exercise-key="${item.exercise_occurrence_key}" maxlength="500" placeholder="记录感受">${escapeHtml(feedbackText)}</textarea>`;
  return `${sessionHeader(detail)}${progressDisclosure(detail, items)}<div class="focus-workout-scroll"><section class="focus-stage"><span class="focus-count">${state.focusIndex + 1} / ${items.length} · ${escapeHtml(context.block?.title || (item.target.metric === "reps" ? "力量" : "训练"))}</span><h2>${escapeHtml(itemLabel(detail, item))}</h2><p class="focus-prescription">${escapeHtml(parts.join(" · "))}</p><div class="actual-panel">${actualRows}</div><div class="feedback-area">${feedback}</div><div class="focus-actions"><button class="primary wide" data-action="complete" ${isDone ? "disabled" : ""}>${isDone ? "已完成" : "完成"}</button><div class="focus-secondary"><button class="secondary" data-action="previous" ${state.focusIndex === 0 ? "disabled" : ""}>上一项</button><button class="secondary" data-action="toggle-adjust">${state.adjust ? "收起调整" : "调整"}</button><button class="secondary" data-action="next" ${state.focusIndex >= items.length - 1 ? "disabled" : ""}>下一项</button></div>${state.adjust ? `<div class="adjust-panel"><label>实际 ${item?.target?.metric === "reps" ? "次数" : "秒数"}<input id="actual-value" type="number" min="1" value="${actual?.value || item?.target?.min || 1}" /></label><label>RIR<input id="actual-rir" type="number" min="0" max="10" value="${result?.rir ?? ""}" /></label><button class="primary wide" data-action="save-adjust">保存并完成</button></div>` : ""}</div></section></div>${sessionFooter(detail)}${state.endSheet ? endSheet(detail) : ""}`;
}

function restView(detail, items) {
  const next = items[state.restNextIndex] || items[state.focusIndex];
  const context = itemContext(detail, next);
  return `${sessionHeader(detail, false)}${progressDisclosure(detail, items)}<section class="rest-screen"><span class="rest-label">组间休息</span><h2>放松，准备下一项</h2><div class="rest-time" data-rest-remaining aria-live="polite">${formatRestRemaining()}</div><div class="next-context"><span>接下来</span><strong>${escapeHtml(itemLabel(detail, next))}</strong><small>${escapeHtml(focusTarget(next.target))}</small></div><button class="secondary" data-action="skip-rest">跳过休息</button></section>${sessionFooter(detail, false)}`;
}

function sessionSummaryView(session, entry, detail) {
  const items = detail.snapshot.completion_items || [];
  const results = new Map(detail.completion_results.map((result) => [result.completion_item_key, result]));
  const rows = items.map((item, index) => {
    const result = results.get(item.completion_item_key);
    const actual = result?.actual ? `实际：${formatActual(result.actual)}` : "未完成";
    return `<div class="session-item-row ${result ? "is-complete" : "is-unfinished"}"><span class="session-item-index">${result ? "✓" : index + 1}</span><div class="session-item-main"><strong>${escapeHtml(itemLabel(detail, item))}</strong><small>计划：${escapeHtml(focusTarget(item.target))} · ${escapeHtml(actual)}${result?.rir == null ? "" : ` · RIR ${result.rir}`}</small></div><span class="session-item-status">${result ? "已完成" : "未完成"}</span></div>`;
  }).join("");
  const feedback = (detail.exercise_feedback || []).filter((item) => item.text).map((item) => `<p><strong>${escapeHtml(exerciseName(detail, { exercise_occurrence_key: item.exercise_occurrence_key }))}</strong>${escapeHtml(item.text)}</p>`).join("");
  return `<section class="session-summary-page"><section class="session-summary-hero"><span class="status-pill ${session.status}">${session.status === "completed" ? "已完成" : "部分完成"}</span><h1>${escapeHtml(entry.title)}</h1><div class="metric-large">${pct(session.completion_fraction)}</div><p class="muted">训练时长 ${session.training_duration_sec} 秒${session.session_rpe == null ? "" : ` · RPE ${session.session_rpe}`}</p></section><section class="session-summary-card"><div class="session-summary-heading"><h2>训练项目</h2><span>${detail.completion_results.length} / ${items.length} 项完成</span></div>${rows}</section>${feedback ? `<section class="session-summary-feedback"><h2>动作反馈</h2>${feedback}</section>` : ""}<div class="hero-actions">${session.status === "partial" ? `<button class="primary" data-action="continue">继续训练</button>` : ""}<button class="secondary" data-action="edit-session">校正记录</button></div></section>`;
}

function todayProgressView(session, entry, detail) {
  const items = detail?.snapshot?.completion_items || [];
  const completed = detail?.completion_results || [];
  const results = new Map(completed.map((result) => [result.completion_item_key, result]));
  const fraction = detail?.completion_fraction ?? session.completion_fraction ?? 0;
  const rows = detail ? items.map((item, index) => {
    const result = results.get(item.completion_item_key);
    const context = itemContext(detail, item);
    const plan = [focusTarget(item.target), focusResistance(context.set?.resistance ?? item.resistance)].filter(Boolean).join(" · ");
    const actual = result?.actual ? `实际：${formatActual(result.actual)}` : "未完成";
    return `<div class="today-item-row ${result ? "is-complete" : "is-unfinished"}"><span class="today-item-index">${result ? "✓" : index + 1}</span><span class="today-item-main"><strong>${escapeHtml(itemLabel(detail, item))}</strong><small>计划：${escapeHtml(plan)} · ${escapeHtml(actual)}${result?.rir == null ? "" : ` · RIR ${result.rir}`}</small></span><span class="today-item-status">${result ? "已完成" : "未完成"}</span></div>`;
  }).join("") : "";
  const action = session.status === "in_progress" || session.status === "partial" ? `<button class="primary wide" data-action="${session.status === "partial" ? "continue" : "open-session"}">继续训练</button>` : `<button class="secondary wide" data-action="open-session">查看训练记录</button>`;
  return `<section class="today-page"><div class="today-content"><p class="eyebrow">${state.today?.date || "今天"} · ${state.today?.timezone || ""}</p><h1>${escapeHtml(entry.title)}</h1><section class="today-progress-card"><div class="today-progress-head"><strong>${completed.length} / ${items.length || Math.round(1 / (fraction || 1))} 项完成</strong><span>${pct(fraction)}</span></div><div class="progress-line"><span style="width:${pct(fraction)}"></span></div>${rows || `<p class="muted">训练记录已保存。</p>`}</section>${action}${session.status === "completed" || session.status === "partial" ? `<button class="text-button wide" data-action="edit-session">校正记录</button>` : ""}</div></section>`;
}

function sessionHeader(detail, showTimer = true) { const timerAction = showTimer && detail?.status === "in_progress" ? `<button class="session-timer-toggle" data-action="toggle-timer" aria-pressed="${state.timerPaused}">${state.timerPaused ? "继续" : "暂停"}</button>` : `<span aria-hidden="true"></span>`; return `<header class="session-header"><button class="session-header-side" data-action="minimize" aria-label="返回今日">‹</button><strong ${showTimer ? "data-session-elapsed" : ""}>${showTimer ? formatElapsed(detail) : "组间休息"}</strong>${timerAction}</header>`; }
function sessionFooter(detail, showTimer = true) { return `<footer class="session-footer"><strong ${showTimer ? "data-session-elapsed" : ""}>${showTimer ? formatElapsed(detail) : "组间休息"}</strong><button class="secondary" data-action="end">结束训练</button></footer>`; }
function progressDisclosure(detail, items) { const completed = detail.completion_results.length; const fraction = items.length ? completed / items.length : 0; return `<section class="session-progress"><button class="session-progress-toggle" data-action="toggle-progress" aria-expanded="${state.progressOpen}"><span><strong>${completed} / ${items.length} 完成</strong><span class="progress-line"><span style="width:${pct(fraction)}"></span></span></span><span class="progress-chevron">${state.progressOpen ? "⌃" : "⌄"}</span></button>${state.progressOpen ? `<div class="progress-list focus-progress">${items.map((candidate, index) => { const done = detail.completion_results.some((result) => result.completion_item_key === candidate.completion_item_key); return `<button class="list-row ${index === state.focusIndex ? "active" : ""}" data-action="jump-item" data-index="${index}"><span>${index + 1}. ${escapeHtml(itemLabel(detail, candidate))}</span><span>${done ? "✓" : "○"}</span></button>`; }).join("")}</div>` : ""}</section>`; }
function itemContext(detail, item) { const block = detail?.snapshot?.blocks?.find((candidate) => candidate.exercises.some((exercise) => exercise.exercise_occurrence_key === item?.exercise_occurrence_key)); const exercise = block?.exercises?.find((candidate) => candidate.exercise_occurrence_key === item?.exercise_occurrence_key); const setIndex = exercise?.sets?.findIndex((set) => set.set_key === item?.set_key) ?? -1; return { block, exercise, set: setIndex >= 0 ? exercise.sets[setIndex] : null, setNumber: setIndex >= 0 ? setIndex + 1 : null }; }
function itemLabel(detail, item) { const context = itemContext(detail, item); const side = item?.side === "left" ? "左" : item?.side === "right" ? "右" : ""; return `${exerciseName(detail, item)}${context.setNumber ? ` · 第 ${context.setNumber} 组` : ""}${side ? ` · ${side}` : ""}`; }
function focusTarget(target) { if (!target) return "未指定目标"; const unit = target.metric === "reps" ? "次" : target.metric === "duration_sec" ? "秒" : target.metric; return `${target.min === target.max ? target.min : `${target.min}–${target.max}`} ${unit}`; }
function focusResistance(resistance) { if (!resistance) return ""; if (resistance.mode === "bodyweight") return "自重"; if (resistance.mode === "external_weight") return `${resistance.load_kg ?? "—"} kg${resistance.quantity && resistance.quantity !== 1 ? ` × ${resistance.quantity}` : ""}`; return resistance.mode || "阻力未指定"; }
function formatElapsed(detail, now = Date.now()) { const seconds = (detail?.training_intervals || []).reduce((total, interval) => { const end = interval.ended_at ? Date.parse(interval.ended_at) : now; return total + Math.max(0, (end - Date.parse(interval.started_at)) / 1000); }, 0); const pausedSeconds = state.timerPausedSec + (state.timerPaused && state.timerPauseStartedAt ? Math.max(0, (now - state.timerPauseStartedAt) / 1000) : 0); const value = Math.max(0, Math.round(seconds - pausedSeconds)); const minutes = Math.floor(value / 60); const secs = value % 60; return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`; }
function formatRestRemaining() { const seconds = Math.max(0, Math.ceil((state.restUntil - Date.now()) / 1000)); const minutes = Math.floor(seconds / 60); return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function stopSessionClock() { if (state.timerHandle) clearInterval(state.timerHandle); state.timerHandle = null; }
function updateSessionClock() {
  if (!state.sessionDetail || state.sessionDetail.status !== "in_progress" || state.view !== "today") return stopSessionClock();
  if (state.restUntil) {
    const remaining = Math.max(0, Math.ceil((state.restUntil - Date.now()) / 1000));
    const element = document.querySelector("[data-rest-remaining]");
    if (element) element.textContent = formatRestRemaining();
    if (remaining === 0) { state.focusIndex = state.restNextIndex ?? state.focusIndex; state.restUntil = null; state.restNextIndex = null; render(); }
    return;
  }
  const elapsed = formatElapsed(state.sessionDetail);
  document.querySelectorAll("[data-session-elapsed]").forEach((element) => { element.textContent = elapsed; });
}
function syncSessionClock() {
  const shouldRun = Boolean(state.sessionDetail?.status === "in_progress" && state.view === "today" && !state.endSheet && !state.timerPaused);
  if (!shouldRun) return stopSessionClock();
  if (!state.timerHandle) state.timerHandle = setInterval(updateSessionClock, 1000);
  updateSessionClock();
}

function toggleTimer() {
  if (!state.sessionDetail || state.sessionDetail.status !== "in_progress") return;
  if (state.timerPaused) {
    state.timerPausedSec += state.timerPauseStartedAt ? Math.max(0, (Date.now() - state.timerPauseStartedAt) / 1000) : 0;
    state.timerPaused = false;
    state.timerPauseStartedAt = null;
  } else {
    state.timerPaused = true;
    state.timerPauseStartedAt = Date.now();
  }
  render();
}

function endSheet(detail) {
  const items = detail.snapshot.completion_items;
  const completed = detail.completion_results.length;
  const percent = items.length ? Math.round((completed / items.length) * 100) : 0;
  const unfinished = items.filter((item) => !detail.completion_results.some((result) => result.completion_item_key === item.completion_item_key));
  const exercises = detail.snapshot.blocks.flatMap((block) => block.exercises);
  const selectedRpe = Number.isInteger(state.endRpe) ? state.endRpe : 8;
  const rpeButtons = rpeMeanings.map((meaning, value) => `<button class="rpe-button ${selectedRpe === value ? "is-selected" : ""}" type="button" data-action="set-end-rpe" data-rpe="${value}" aria-label="RPE ${value}，${meaning.title}" aria-pressed="${selectedRpe === value}">${value}</button>`).join("");
  const unfinishedMarkup = unfinished.length ? `<section class="end-unfinished"><h3>未完成项目</h3><ul>${unfinished.map((item, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(itemLabel(detail, item))}</strong></li>`).join("")}</ul></section>` : "";
  const feedbackMarkup = exercises.map((exercise) => `<label>${escapeHtml(exercise.name)}<input data-end-feedback="${exercise.exercise_occurrence_key}" maxlength="1000" value="${escapeHtml(state.endFeedback[exercise.exercise_occurrence_key] || "")}" placeholder="记录感受（可留空）" /></label>`).join("");
  return `<div class="modal-backdrop" data-action="cancel-end"><section class="bottom-sheet end-sheet"><div class="sheet-handle"></div><div class="end-sheet-body"><h2>结束训练</h2><p class="muted">${unfinished.length ? `还有 ${unfinished.length} 项未完成，保存后会记为部分完成。` : "所有项目都已记录，可以完成训练。"}</p><section class="end-result"><span>${unfinished.length ? "部分完成" : "已完成"}</span><strong>${completed} / ${items.length}</strong><small>已完成 · ${percent}%</small><div class="progress-line"><span style="width:${percent}%"></span></div></section>${unfinishedMarkup}<section class="end-form-section"><div class="end-form-heading"><h3>训练 RPE</h3><span>整体感受</span></div><div class="rpe-scale">${rpeButtons}</div><div class="rpe-meaning" role="status" aria-live="polite"><strong>${selectedRpe} · ${rpeMeanings[selectedRpe].title}</strong><span>${rpeMeanings[selectedRpe].detail}</span></div></section><section class="end-form-section"><label for="end-note">训练备注 <span class="muted">可选</span></label><textarea id="end-note" class="end-note" maxlength="5000" placeholder="记录训练上下文（可留空）">${escapeHtml(state.endNote)}</textarea></section><section class="end-form-section end-feedback"><h3>动作反馈</h3>${feedbackMarkup}</section></div><div class="end-sheet-actions"><button class="secondary" data-action="cancel-end">返回训练</button><button class="primary" data-action="save-end">结束并保存</button></div></section></div>`;
}

function correctionView(detail, entry) { if (detail.status === "skipped") return `<section class="page-head"><p class="eyebrow">CORRECTION</p><h1>校正记录</h1><p class="muted">${escapeHtml(entry.title)} · 训练日期和跳过状态保持不变。</p></section><section class="list-card"><label>跳过原因<input id="correction-skip-reason" maxlength="500" value="${escapeHtml(detail.skip_reason || "")}" /></label><label>训练备注<textarea id="correction-note" maxlength="5000">${escapeHtml(detail.note || "")}</textarea></label></section><div class="sheet-actions"><button class="secondary" data-action="cancel-correction">取消</button><button class="primary" data-action="save-correction">保存校正</button></div>`; const existing = new Map(detail.completion_results.map((result) => [result.completion_item_key, result])); return `<section class="page-head"><p class="eyebrow">CORRECTION</p><h1>校正记录</h1><p class="muted">${escapeHtml(entry.title)} · 训练日期保持不变。留空的项目会被视为未完成。</p></section><section class="list-card">${detail.snapshot.completion_items.map((item, index) => { const result = existing.get(item.completion_item_key); return `<label>${index + 1}. ${escapeHtml(itemLabel(detail, item))}<input id="correction-value-${item.completion_item_key}" type="number" min="1" value="${result?.actual?.value ?? ""}" placeholder="实际值" /><input id="correction-rir-${item.completion_item_key}" type="number" min="0" max="10" value="${result?.rir ?? ""}" placeholder="RIR（可留空）" /></label>`; }).join("")}</section><section class="quiet-card"><label>训练 RPE<input id="correction-rpe" type="number" min="0" max="10" value="${detail.session_rpe ?? ""}" /></label><label>训练备注<textarea id="correction-note" maxlength="5000">${escapeHtml(detail.note || "")}</textarea></label><label>动作反馈</label>${detail.snapshot.blocks.flatMap((block) => block.exercises).map((exercise) => { const feedback = detail.exercise_feedback.find((item) => item.exercise_occurrence_key === exercise.exercise_occurrence_key); return `<input id="correction-feedback-${exercise.exercise_occurrence_key}" value="${escapeHtml(feedback?.text || "")}" placeholder="${escapeHtml(exercise.name)}（可留空）" />`; }).join("")}</section><div class="sheet-actions"><button class="secondary" data-action="cancel-correction">取消</button><button class="primary" data-action="save-correction">保存校正</button></div>`; }

function exerciseName(detail, item) { return detail?.snapshot?.blocks?.flatMap((block) => block.exercises).find((exercise) => exercise.exercise_occurrence_key === item?.exercise_occurrence_key)?.name || "训练项目"; }

function calendarView() {
  if (state.calendarLoading && !state.calendar.entries.length) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1></section><section class="loading"><span class="spinner"></span><p>正在读取日期安排…</p></section>`;
  if (state.calendarError) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1></section><section class="error-card"><p>${escapeHtml(state.calendarError)}</p><button class="primary" data-action="calendar-retry">重新读取</button></section>`;
  const from = state.calendar.from; const first = calendarFirstDate(); const selected = state.calendar.selectedDate;
  if (!first) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1><p class="muted">还没有生效的计划。</p></section><section class="quiet-card"><strong>日历暂不可用</strong><p>在设置中提交第一份计划后，这里会从其生效日期开始显示。</p></section>`;
  if (!from) return `<section class="page-head"><p class="eyebrow">CALENDAR</p><h1>日历</h1><p class="muted">还没有可浏览的计划。</p></section>`;
  const previous = addCalendarDays(from, -7); const next = addCalendarDays(from, 7);
  const previousDisabled = Boolean(first && addCalendarDays(previous, 6) < first);
  const sessions = new Map(state.calendar.sessions.map((session) => [session.session_key, session]));
  const rows = state.calendar.entries.map((entry) => {
    const beforePlan = Boolean(first && entry.date < first); const session = sessions.get(entry.session_key); const status = beforePlan ? { key: "before-plan", label: "计划尚未开始" } : calendarStatus(entry, session); const selectedClass = entry.date === selected ? " selected" : "";
    return `<button class="calendar-day ${status.key}${selectedClass}" data-action="calendar-select" data-date="${entry.date}" ${beforePlan ? "disabled" : ""}><span class="calendar-day-label">${weekdayLabels[entry.weekday]}</span><span class="calendar-day-date">${entry.date.slice(5)}</span><span class="calendar-day-summary">${entry.kind === "workout" ? escapeHtml(entry.title) : status.label}</span><span class="calendar-day-meta">${entry.kind === "workout" ? `${entry.module_count || 0} 个模块 · ${entry.estimated_duration_min} 分钟 · ${status.label}` : entry.kind === "rest" ? "恢复，不创建训练记录" : beforePlan ? "" : "未安排内容"}</span></button>`;
  }).join("");
  const detail = state.calendarDay && state.calendarDay.entry.date === selected ? (state.correction ? correctionView(state.calendarDay.session, state.calendarDay.entry) : calendarDayDetail(state.calendarDay.entry, state.calendarDay.session)) : `<section class="quiet-card"><strong>选择一天</strong><p>查看这一天的训练处方和完成情况。</p></section>`;
  return `<section class="page-head calendar-head"><p class="eyebrow">CALENDAR · ${state.today?.timezone || ""}</p><h1>日历</h1><div class="calendar-week-controls"><button class="secondary" data-action="calendar-previous" ${previousDisabled ? "disabled" : ""}>‹ 上一周</button><strong>${from} – ${state.calendar.to}</strong><button class="secondary" data-action="calendar-next">下一周 ›</button></div><div class="calendar-legend" aria-label="日历状态图例"><span class="calendar-legend-item completed"><i></i>已完成</span><span class="calendar-legend-item partial"><i></i>未完成</span><span class="calendar-legend-item skipped"><i></i>已跳过</span><span class="calendar-legend-item today"><i></i>未开始</span></div></section><section class="calendar-week" aria-label="七天训练安排">${rows}</section>${state.calendarDayLoading ? `<section class="loading compact-loading"><span class="spinner"></span><p>正在读取这一天…</p></section>` : detail}`;
}

function calendarDayDetail(entry, detail) {
  const status = calendarStatus(entry, detail); const items = detail?.snapshot?.completion_items || []; const completed = detail?.completion_results?.length || 0; const canCorrect = detail && ["completed", "partial", "skipped"].includes(detail.status);
  if (entry.kind === "rest") return `<section class="calendar-detail quiet-card"><span class="status-pill">休息日</span><h2>恢复日</h2><p class="muted">${entry.date} 不安排训练，也不会创建训练记录。</p></section>`;
  if (entry.kind === "no_plan") return `<section class="calendar-detail quiet-card"><span class="status-pill">无计划</span><h2>未安排内容</h2><p class="muted">${entry.date} 没有生效的 Weekly Template 槽位。</p></section>`;
  if (!entry.prescription) return `<section class="calendar-detail error-card"><p>这一天的训练处方暂时无法读取。</p></section>`;
  return `<section class="calendar-detail"><div class="calendar-detail-head"><div><p class="eyebrow">${entry.date} · ${entry.weekday}</p><h2>${escapeHtml(entry.title)}</h2><p class="muted">约 ${entry.estimated_duration_min} 分钟 · ${status.label}</p></div><span class="status-pill ${status.key}">${status.label}</span></div>${detail ? `<div class="calendar-session-summary"><strong>Session ${detail.status === "skipped" ? "已跳过" : "完成情况"} · 训练计划快照</strong><span>快照：${escapeHtml(detail.snapshot.title)} · ${pct(detail.completion_fraction)} · ${completed}/${items.length} 项已完成</span>${detail.skip_reason ? `<p class="muted">跳过原因：${escapeHtml(detail.skip_reason)}</p>` : ""}${canCorrect ? `<button class="secondary" data-action="calendar-correct">校正记录</button>` : ""}</div>` : status.key === "overdue" ? `<div class="calendar-session-summary"><strong>逾期未开始</strong><span>没有 Session 记录，也不会生成历史训练记录。</span></div>` : ""}<div class="calendar-prescription"><h3>训练处方</h3>${renderCalendarPrescription(detail?.snapshot || entry.prescription, detail)}</div></section>`;
}

function renderCalendarPrescription(prescription, detail) {
  const snapshotBlocks = detail?.snapshot?.blocks || [];
  return `<p class="muted">${prescription.blocks.length} 个训练模块 · ${prescription.title ? escapeHtml(prescription.title) : ""}</p>${prescription.blocks.map((block, blockIndex) => `<article class="prescription-block"><h4>${escapeHtml(block.title)}</h4>${block.exercises.map((exercise, exerciseIndex) => { const snapshotExercise = snapshotBlocks[blockIndex]?.exercises?.[exerciseIndex]; return `<div class="prescription-exercise"><strong>${escapeHtml(exercise.name)}</strong>${exercise.sets.map((set, index) => { const snapshotSet = snapshotExercise?.sets?.[index]; const actuals = detail && snapshotSet ? (detail.snapshot.completion_items || []).filter((item) => item.set_key === snapshotSet.set_key).map((item) => detail.completion_results.find((result) => result.completion_item_key === item.completion_item_key)?.actual ? `${item.side === "none" ? "" : `${item.side} `}${formatActual(detail.completion_results.find((result) => result.completion_item_key === item.completion_item_key).actual)}` : null).filter(Boolean) : []; const tempo = formatTempo(set.tempo); return `<div class="prescription-set"><span>第 ${index + 1} 组 · ${formatTarget(set.target)}</span><span>${formatResistance(set.resistance)}${tempo ? ` · 节奏 ${tempo}` : ""}${set.rest_after_sec == null ? "" : ` · 休息 ${set.rest_after_sec} 秒`}</span>${detail ? `<small class="${actuals.length ? "actual" : "unfinished"}">${actuals.length ? `实际：${actuals.join("，")}` : "未完成"}</small>` : ""}</div>`; }).join("")}</div>`; }).join("")}</article>`).join("")}`;
}

function formatTarget(target) { if (!target) return "未指定目标"; const unit = target.metric === "reps" ? "次" : target.metric === "duration_sec" || target.metric === "seconds" ? "秒" : target.metric; const qualifiers = [target.target_rir == null ? null : `RIR ${target.target_rir}`, target.target_rpe == null ? null : `RPE ${target.target_rpe}`, target.target_incline_percent == null ? null : `坡度 ${target.target_incline_percent}%`].filter(Boolean); return `${target.min === target.max ? target.min : `${target.min}–${target.max}`} ${unit}${qualifiers.length ? ` · ${qualifiers.join(" · ")}` : ""}`; }
function formatTempo(tempo) { if (!tempo || typeof tempo !== "object") return ""; return [["eccentric_sec", "离心"], ["bottom_hold_sec", "底部停顿"], ["concentric_sec", "向心"], ["top_hold_sec", "顶部停顿"]].filter(([key]) => tempo[key] != null).map(([key, label]) => `${label} ${escapeHtml(tempo[key])} 秒`).join(" · "); }
function formatResistance(resistance) { if (!resistance) return "阻力未指定"; if (resistance.mode === "bodyweight") return "自重"; if (resistance.mode === "external_weight") return `${resistance.load_kg ?? "—"} kg × ${resistance.quantity ?? 1}`; return escapeHtml(resistance.mode || "阻力"); }
function formatActual(actual) { const unit = actual.metric === "reps" ? "次" : actual.metric === "duration_sec" || actual.metric === "seconds" ? "秒" : actual.metric; return `${actual.value} ${unit}`; }

function planView() {
  const current = state.plan?.current; const week = current?.week || {};
  return `<section class="page-head"><p class="eyebrow">PLAN</p><h1>本周计划</h1><p class="muted">${current ? `从 ${current.effective_from} 生效 · ${state.plan.timezone}` : "还没有当前计划"}</p></section>${current ? `<section class="week-list">${Object.entries(week).map(([day, slot]) => `<article class="week-row"><span class="day-label">${weekdayLabels[day]}</span><div><strong>${slot?.kind === "workout" ? escapeHtml(slot.title) : slot?.kind === "rest" ? "休息日" : "无计划"}</strong><p>${slot?.kind === "workout" ? `${slot.blocks.length} 个训练模块 · 约 ${slot.estimated_duration_min} 分钟` : slot?.kind === "rest" ? "今天不创建训练记录" : "未安排内容"}</p></div></article>`).join("")}</section>` : `<div class="quiet-card">还没有当前计划。</div>`}<section class="pending-card"><strong>${state.plan?.pending_count ? `已有 ${state.plan.pending_count} 个未来更新` : "没有待生效更新"}</strong><p>${state.plan?.next_effective_from ? `下一份计划从 ${state.plan.next_effective_from} 生效。` : "未来更新通过设置提交。"}</p></section>`;
}

function planSheet() { if (state.preview) return `<div class="modal-backdrop" data-action="close-sheet"><section class="bottom-sheet"><div class="sheet-handle"></div><h2>确认更新计划</h2><p class="muted">${escapeHtml(state.preview.effective_from)} 生效 · ${state.preview.changed_weekday_slot_count} 个日期槽位发生变化</p><div class="preview-week">${Object.entries(state.preview.week).map(([day, slot]) => `<div class="week-row"><span class="day-label">${weekdayLabels[day]}</span><div><strong>${slot?.kind === "workout" ? escapeHtml(slot.title) : slot?.kind === "rest" ? "休息日" : "无计划"}</strong><p>${slot?.kind === "workout" ? `${slot.blocks.length} 个训练模块 · ${slot.estimated_duration_min} 分钟` : "今天不创建训练记录"}</p></div></div>`).join("")}</div><div class="sheet-actions"><button class="secondary" data-action="close-sheet">取消</button><button class="primary" data-action="confirm-plan">确认应用</button></div></section></div>`; return `<div class="modal-backdrop" data-action="close-sheet"><section class="bottom-sheet"><div class="sheet-handle"></div><h2>${state.planError ? "计划需要修正" : "更新计划"}</h2><p class="muted">粘贴完整 JSON，检查后预览并确认。</p><textarea id="plan-json" placeholder='{"schema_version":1,"effective_from":"2026-08-01","week":{...}}'>${escapeHtml(state.draft)}</textarea>${state.planError ? `<div class="validation-error"><strong>计划无法更新</strong><p>${escapeHtml(state.planError).replace(/\n/g, "<br>")}</p><button class="secondary" data-action="copy-error">复制错误详情</button></div>` : ""}<div class="sheet-actions"><button class="secondary" data-action="close-sheet">取消</button><button class="primary" data-action="validate-plan">检查计划</button></div></section></div>`; }

function formatHours(seconds) { const value = Math.round((Number(seconds) || 0) / 360) / 10; return `${Number.isInteger(value) ? value : value.toFixed(1)} 小时`; }
function progressView() { if (state.exercise) return exerciseView(); const metric = state.progress?.metrics; const rate = metric?.completion_rate; const tabs = [["current", "当月"], ["previous", "上月"], ["all", "累计"]].map(([range, label]) => `<button class="progress-range-tab ${state.progressRange === range ? "is-selected" : ""}" data-action="progress-range" data-range="${range}" role="tab" aria-selected="${state.progressRange === range}">${label}</button>`).join(""); if (state.progressLoading) return `<section class="page-head progress-head"><p class="eyebrow">PROGRESS</p><h1>进展</h1><div class="progress-range-tabs" role="tablist" aria-label="进展时间范围">${tabs}</div></section><section class="loading compact-loading"><span class="spinner"></span><p>正在读取${progressRangeLabel(state.progressRange)}数据…</p></section>`; return `<section class="page-head progress-head"><p class="eyebrow">PROGRESS · ${progressRangeLabel(state.progressRange)}</p><h1>进展</h1><p class="muted">${state.progress?.period?.from || ""} – ${state.progress?.period?.to || ""} · ${state.progress?.period?.timezone || ""}</p><div class="progress-range-tabs" role="tablist" aria-label="进展时间范围">${tabs}</div></section><div class="metric-grid"><article><span>完成率</span><strong>${rate?.value == null ? "—" : pct(rate.value)}</strong><small>${rate?.evidence?.due_workouts || 0} 个到期训练</small></article><article><span>训练时长</span><strong>${formatHours(metric?.training_duration?.value_sec)}</strong><small>只计已结束区间</small></article><article><span>力量训练日</span><strong>${metric?.strength_training_days?.value || 0}</strong><small>按日期计一次</small></article><article><span>平均 RPE</span><strong>${metric?.average_session_rpe?.value ?? "—"}</strong><small>${metric?.average_session_rpe?.included_count || 0} 个有效记录</small></article></div><section class="quiet-card"><strong>训练连续性</strong><p>${state.progress?.current_streak?.value || 0} 天连续完成 100% 训练；休息日和无计划日保持中性。</p></section><section class="list-card"><h2>动作进展</h2>${(state.progress?.exercises || []).length ? state.progress.exercises.map((exercise) => `<button class="list-row" data-exercise="${escapeHtml(exercise.exercise_key)}"><span><strong>${escapeHtml(exercise.current_name)}</strong><small>${exercise.performed_session_count} 次训练</small></span><span>›</span></button>`).join("") : `<p class="muted">还没有可展示的动作记录。</p>`}</section>`; }

function exerciseView() { return `<section class="page-head"><button class="text-button" data-action="close-exercise">← 返回进展</button><p class="eyebrow">动作记录</p><h1>${escapeHtml(state.exercise.exercise_key)}</h1><p class="muted">${state.exercise.performed_session_count} 次有实际完成结果的训练</p></section><section class="list-card">${state.exercise.observations.length ? state.exercise.observations.map((observation) => `<article class="week-row"><div><strong>${observation.scheduled_date}</strong><p>${observation.sets.map((set) => `${escapeHtml(set.side)} · ${set.actual.value} ${set.actual.metric}`).join("，")}</p></div></article>`).join("") : `<p class="muted">这个动作目前没有可展示的完成记录。</p>`}</section>`; }

function settingsView() { const current = state.plan?.current; const share = state.share; const shareActions = share?.active ? `<button class="primary" data-action="copy-share">复制分享链接</button><button class="secondary" data-action="regenerate-share">重新生成</button><button class="secondary" data-action="revoke-share">撤销分享</button>` : `<button class="primary" data-action="create-share">创建分享</button>`; return `<section class="page-head"><p class="eyebrow">SETTINGS</p><h1>设置</h1><p class="muted">管理你的个人信息、计划和分享。</p></section><form class="settings-form" data-form="settings"><label>显示名称<input name="display_name" maxlength="50" value="${escapeHtml(state.me?.display_name || "")}" /></label><label>Timezone<input name="timezone" value="${escapeHtml(state.me?.timezone || state.today?.timezone || "Asia/Shanghai")}" /></label><button class="primary wide">保存设置</button></form><section class="quiet-card"><h2>计划</h2><p>通过 JSON 更新未来训练计划。</p><div class="hero-actions"><button class="primary" data-action="open-plan-sheet">更新计划</button>${current ? `<button class="secondary" data-action="copy-current-plan">复制当前 JSON</button>` : ""}</div></section><section class="quiet-card"><h2>分享</h2><p>${share?.active ? "分享链接已启用，可复制、重新生成或撤销。" : "创建一个永久只读分享链接。"}</p>${share?.active ? `<label>分享链接<input aria-label="分享链接" readonly value="${escapeHtml(share.url || "")}" /></label>` : ""}<div class="hero-actions">${shareActions}<button class="secondary" data-action="export">下载训练数据</button></div></section><button class="secondary wide" data-action="logout">退出登录</button>${state.sheet ? planSheet() : ""}`; }

async function loadMe() { try { state.me = await api("/api/private/me"); } catch {} }
async function loadShare() { try { state.share = await api("/api/private/coach-share"); } catch { state.share = null; } }
function initialCalendarWeek() { const first = calendarFirstDate(); const current = calendarMonday(state.today.date); return first && addCalendarDays(current, 6) < first ? calendarMonday(first) : current; }
async function loadCalendarWeek(from, selectedDate = null) {
  state.calendarLoading = true; state.calendarError = null; state.calendarDay = null; state.correction = false; render();
  try {
    const to = addCalendarDays(from, 6);
    const [schedule, sessions] = await Promise.all([api(`/api/private/schedule?from=${from}&to=${to}`), api(`/api/private/sessions?from=${from}&to=${to}&limit=200`)]);
    const first = calendarFirstDate(); const requestedDate = selectedDate || from; const normalizedSelectedDate = first && requestedDate < first ? first : requestedDate;
    state.calendar = { from, to, selectedDate: normalizedSelectedDate >= from && normalizedSelectedDate <= to ? normalizedSelectedDate : from, entries: schedule.entries, sessions: sessions.items };
    state.calendarLoading = false;
    await loadCalendarDay(state.calendar.selectedDate, false);
  } catch (error) {
    state.calendarLoading = false; state.calendarDayLoading = false; state.calendarError = error.data?.error?.message || error.message;
  }
  render();
}
async function loadCalendarDay(date, shouldRender = true) {
  const first = calendarFirstDate();
  if (!date || (first && date < first)) return;
  state.calendar.selectedDate = date; state.calendarDay = null; state.calendarDayLoading = true; state.calendarError = null; if (shouldRender) render();
  try {
    const schedule = await api(`/api/private/schedule?from=${date}&to=${date}&expand=prescription`);
    const entry = schedule.entries[0]; const detail = entry?.session_key ? await api(`/api/private/sessions/${entry.session_key}`) : null;
    state.calendarDay = entry ? { entry, session: detail } : null;
  } catch (error) { state.calendarError = error.data?.error?.message || error.message; }
  state.calendarDayLoading = false; if (shouldRender) render();
}
function bind() {
  app.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", async () => { const wasCalendar = state.view === "calendar"; state.view = button.dataset.view; if (state.view === "settings") { await Promise.all([loadMe(), loadShare()]); render(); } else if (state.view === "calendar") { if (!calendarFirstDate()) return render(); await loadCalendarWeek(wasCalendar && state.calendar.from ? state.calendar.from : initialCalendarWeek(), wasCalendar ? state.calendar.selectedDate : state.today.date); } else render(); }));
  app.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", () => action(element.dataset.action, element.dataset.index ?? element.dataset.exerciseKey ?? element.dataset.rpe ?? element.dataset.range, element.dataset.date)));
  app.querySelectorAll(".bottom-sheet").forEach((sheet) => sheet.addEventListener("click", (event) => event.stopPropagation()));
  app.querySelectorAll("[data-exercise]").forEach((element) => element.addEventListener("click", () => openExercise(element.dataset.exercise)));
  const form = app.querySelector("[data-form=settings]"); if (form) form.addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); try { await api("/api/private/settings", { method: "PUT", body: JSON.stringify(values) }); state.message = "设置已保存"; await refresh(); } catch (error) { state.error = error.data?.error?.message || error.message; render(); } });
  const loginForm = app.querySelector("[data-form=login]"); if (loginForm) loginForm.addEventListener("submit", async (event) => { event.preventDefault(); state.authMessage = ""; const values = Object.fromEntries(new FormData(loginForm)); try { await api("/api/auth/login", { method: "POST", body: JSON.stringify(values) }); state.authRequired = false; await refresh(); } catch (error) { state.authMessage = error.data?.error?.message || "邮箱或密码不正确"; render(); } });
  const textarea = app.querySelector("#plan-json"); if (textarea) textarea.addEventListener("input", () => { state.draft = textarea.value; state.planError = null; });
  const focusFeedback = app.querySelector(".focus-feedback-input"); if (focusFeedback) focusFeedback.addEventListener("input", () => { state.feedbackDraft[focusFeedback.dataset.exerciseKey] = focusFeedback.value; });
  const endNote = app.querySelector("#end-note"); if (endNote) endNote.addEventListener("input", () => { state.endNote = endNote.value; });
  app.querySelectorAll("[data-end-feedback]").forEach((input) => input.addEventListener("input", () => { state.endFeedback[input.dataset.endFeedback] = input.value; }));
}

async function action(name, value, date) {
  try {
    if (name === "refresh") return refresh(); if (name === "logout") { await api("/api/auth/logout", { method: "POST" }); state.authRequired = true; state.me = null; state.share = null; return render(); } if (name === "settings") { state.view = "settings"; await Promise.all([loadMe(), loadShare()]); return render(); }
    if (name === "calendar-retry") return loadCalendarWeek(state.calendar.from || initialCalendarWeek(), state.calendar.selectedDate || state.today.date);
    if (name === "calendar-previous") return loadCalendarWeek(addCalendarDays(state.calendar.from, -7), addCalendarDays(state.calendar.selectedDate || state.calendar.from, -7));
    if (name === "calendar-next") return loadCalendarWeek(addCalendarDays(state.calendar.from, 7), addCalendarDays(state.calendar.selectedDate || state.calendar.from, 7));
    if (name === "calendar-select") return loadCalendarDay(date);
    if (name === "progress-range") return loadProgress(value);
    if (name === "calendar-correct") { state.correction = true; return render(); }
    if (name === "start" || name === "skip") { const date = state.today.date; const body = name === "skip" ? { skip_reason: null } : {}; const result = await api(`/api/private/scheduled-workouts/${date}/${name}`, { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify(body) }); state.session = result; await openSession(result.session_key); return; }
    if (name === "open-session" || name === "restart") { if (name === "restart") { const result = await api(`/api/private/sessions/${state.session.session_key}/restart`, { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); state.session = result; } await openSession(state.session.session_key); return; }
    if (name === "continue") { const result = await api(`/api/private/sessions/${state.session.session_key}/continue`, { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); state.session = result; await openSession(result.session_key); return; }
    if (name === "complete" || name === "save-adjust") return completeCurrent(); if (name === "previous") { state.focusIndex = Math.max(0, state.focusIndex - 1); state.adjust = false; return render(); } if (name === "next") { const max = state.sessionDetail?.snapshot?.completion_items?.length - 1 || 0; state.focusIndex = Math.min(max, state.focusIndex + 1); state.adjust = false; return render(); } if (name === "jump-item") { state.focusIndex = Number(value); state.progressOpen = false; state.adjust = false; state.restUntil = null; state.restNextIndex = null; return render(); } if (name === "toggle-adjust") { state.adjust = !state.adjust; return render(); } if (name === "toggle-progress") { state.progressOpen = !state.progressOpen; return render(); } if (name === "toggle-timer") { toggleTimer(); return; } if (name === "minimize") { stopSessionClock(); state.sessionDetail = null; state.progressOpen = false; state.adjust = false; state.feedbackOpen = null; state.restUntil = null; state.restNextIndex = null; state.endSheet = false; state.timerPaused = false; state.timerPauseStartedAt = null; state.timerPausedSec = 0; return refresh(); } if (name === "skip-rest") { state.focusIndex = state.restNextIndex ?? state.focusIndex; state.restUntil = null; state.restNextIndex = null; return render(); } if (name === "open-feedback") { state.feedbackOpen = value || null; return render(); } if (name === "close-feedback") { state.feedbackOpen = null; return render(); }
    if (name === "end") { beginEndSheet(); return render(); } if (name === "set-end-rpe") { state.endRpe = Number(value); return render(); } if (name === "save-end") return endCurrent(); if (name === "cancel-end") { state.endSheet = false; return render(); } if (name === "edit-session") { state.correction = true; return render(); } if (name === "cancel-correction") { state.correction = false; return render(); } if (name === "save-correction") return saveCorrection(); if (name === "open-progress-list") { state.focusIndex = 0; state.progressOpen = true; return render(); }
    if (name === "close-exercise") { state.exercise = null; return render(); }
    if (name === "open-plan-sheet") { state.sheet = true; state.preview = null; state.error = null; state.planError = null; return render(); } if (name === "copy-current-plan") return copyCurrentPlan(); if (name === "close-sheet") { state.sheet = false; state.preview = null; state.planError = null; return render(); }
    if (name === "validate-plan") return validatePlan(); if (name === "confirm-plan") return confirmPlan(); if (name === "copy-error") return navigator.clipboard?.writeText(state.planError || "计划需要修正"); if (name === "export") { window.location.href = "/api/private/export"; return; }
    if (name === "create-share") { await api("/api/private/coach-share", { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); await loadShare(); return copyShare("分享链接已创建并复制"); }
    if (name === "copy-share") return copyShare("分享链接已复制");
    if (name === "regenerate-share") { await api("/api/private/coach-share/regenerate", { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); await loadShare(); return copyShare("分享链接已重新生成并复制"); }
    if (name === "revoke-share") { await api("/api/private/coach-share", { method: "DELETE" }); state.share = { active: false, share_key: null, url: null }; state.message = "分享已撤销"; return render(); }
  } catch (error) { state.error = error.data?.error?.message || error.message; render(); }
}

function beginEndSheet() {
  const detail = state.sessionDetail;
  state.endSheet = true;
  state.endRpe = Number.isInteger(detail?.session_rpe) ? detail.session_rpe : 8;
  state.endNote = detail?.note || "";
  state.endFeedback = Object.fromEntries((detail?.exercise_feedback || []).map((item) => [item.exercise_occurrence_key, item.text]));
}
async function openSession(sessionKey, requestedIndex = null, options = {}) {
  state.sessionDetail = await api(`/api/private/sessions/${sessionKey}`);
  state.session = state.sessionDetail;
  state.timerPaused = false;
  state.timerPauseStartedAt = null;
  state.timerPausedSec = 0;
  const items = state.sessionDetail.snapshot?.completion_items || [];
  const firstIncomplete = items.findIndex((item) => !state.sessionDetail.completion_results.some((result) => result.completion_item_key === item.completion_item_key));
  state.focusIndex = requestedIndex == null ? (firstIncomplete >= 0 ? firstIncomplete : 0) : Math.max(0, Math.min(requestedIndex, Math.max(0, items.length - 1)));
  state.progressOpen = false;
  state.adjust = false;
  state.feedbackOpen = null;
  state.feedbackDraft = Object.fromEntries((state.sessionDetail.exercise_feedback || []).map((item) => [item.exercise_occurrence_key, item.text]));
  state.restUntil = options.restSeconds ? Date.now() + options.restSeconds * 1000 : null;
  state.restNextIndex = options.restSeconds ? options.nextIndex : null;
  state.endSheet = Boolean(options.openEnd);
  if (state.endSheet) beginEndSheet();
  state.view = "today";
  render();
}
async function copyShare(message) { let copied = false; try { if (state.share?.url && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(state.share.url); copied = true; } } catch {} state.message = copied ? message : "分享链接已准备好，请复制下方链接"; return render(); }
async function openExercise(exerciseKey) { try { state.exercise = await api(`/api/private/exercises/${encodeURIComponent(exerciseKey)}?preset=12w`); state.view = "progress"; render(); } catch (error) { state.error = error.data?.error?.message || error.message; render(); } }
async function copyCurrentPlan() { try { const packageValue = await api("/api/private/plan/update-package"); state.draft = JSON.stringify(packageValue, null, 2); state.sheet = true; state.preview = null; state.error = null; state.planError = null; await navigator.clipboard?.writeText(state.draft); state.message = "当前计划 JSON 已复制，请修改 effective_from 或内容后检查"; render(); } catch (error) { state.error = error.data?.error?.message || error.message; render(); } }
async function completeCurrent() {
  const detail = state.sessionDetail;
  const item = detail?.snapshot?.completion_items?.[state.focusIndex];
  if (!detail || !item) return;
  const currentIndex = state.focusIndex;
  const existing = detail.completion_results.filter((result) => result.completion_item_key !== item.completion_item_key);
  const value = Number(document.querySelector("#actual-value")?.value || item.target.min);
  const rirInput = document.querySelector("#actual-rir")?.value;
  const feedbackInput = document.querySelector(".focus-feedback-input");
  if (feedbackInput) state.feedbackDraft[feedbackInput.dataset.exerciseKey] = feedbackInput.value;
  const exerciseFeedback = Object.entries(state.feedbackDraft).map(([exercise_occurrence_key, text]) => ({ exercise_occurrence_key, text: text.trim() })).filter((item) => item.text);
  const result = { completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value }, resistance: item.resistance, rir: rirInput === "" || rirInput == null ? null : Number(rirInput), completed_at: new Date().toISOString() };
  await api(`/api/private/sessions/${detail.session_key}/record`, { method: "PUT", body: JSON.stringify({ record_schema_version: 1, completion_results: [...existing, result], training_intervals: detail.training_intervals, session_rpe: null, note: detail.note, exercise_feedback: exerciseFeedback, skip_reason: null }) });
  const nextIndex = detail.snapshot.completion_items.findIndex((candidate, index) => index > currentIndex && ![...existing, result].some((saved) => saved.completion_item_key === candidate.completion_item_key));
  const fallbackIndex = nextIndex >= 0 ? nextIndex : detail.snapshot.completion_items.findIndex((candidate) => ![...existing, result].some((saved) => saved.completion_item_key === candidate.completion_item_key));
  const restSeconds = itemContext(detail, item).set?.rest_after_sec || 0;
  await openSession(detail.session_key, fallbackIndex >= 0 ? fallbackIndex : 0, { restSeconds: fallbackIndex >= 0 ? restSeconds : 0, nextIndex: fallbackIndex >= 0 ? fallbackIndex : null, openEnd: fallbackIndex < 0 });
}
async function endCurrent() {
  const detail = state.sessionDetail;
  if (!detail) return;
  const endNote = document.querySelector("#end-note"); if (endNote) state.endNote = endNote.value;
  app.querySelectorAll("[data-end-feedback]").forEach((input) => { state.endFeedback[input.dataset.endFeedback] = input.value; });
  const feedback = Object.entries(state.endFeedback).map(([exercise_occurrence_key, text]) => ({ exercise_occurrence_key, text: text.trim() })).filter((item) => item.text);
  const record = { record_schema_version: 1, completion_results: detail.completion_results, training_intervals: detail.training_intervals, session_rpe: Number.isInteger(state.endRpe) ? state.endRpe : null, note: state.endNote.trim() || null, exercise_feedback: feedback, skip_reason: null };
  const result = await api(`/api/private/sessions/${detail.session_key}/end`, { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ record, ended_at: new Date().toISOString() }) });
  stopSessionClock(); state.session = result; state.sessionDetail = null; state.todayDetail = null; state.endSheet = false; state.restUntil = null; state.restNextIndex = null; await refresh();
}
async function saveCorrection() { const detail = state.view === "calendar" ? state.calendarDay?.session : state.sessionDetail; if (!detail) return; const isSkipped = detail.status === "skipped"; const correctionTimestamp = detail.training_intervals.at(-1)?.ended_at || detail.updated_at; const completion_results = isSkipped ? [] : detail.snapshot.completion_items.map((item) => { const value = document.querySelector(`#correction-value-${item.completion_item_key}`)?.value; if (!value) return null; const rir = document.querySelector(`#correction-rir-${item.completion_item_key}`)?.value; const existing = detail.completion_results.find((result) => result.completion_item_key === item.completion_item_key); return { completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value: Number(value) }, resistance: item.resistance, rir: rir === "" || rir == null ? null : Number(rir), completed_at: existing?.completed_at || correctionTimestamp }; }).filter(Boolean); const feedback = isSkipped ? [] : detail.snapshot.blocks.flatMap((block) => block.exercises).map((exercise) => ({ exercise_occurrence_key: exercise.exercise_occurrence_key, text: document.querySelector(`#correction-feedback-${exercise.exercise_occurrence_key}`)?.value.trim() })).filter((item) => item.text); const record = { record_schema_version: 1, completion_results, training_intervals: isSkipped ? [] : detail.training_intervals, session_rpe: isSkipped ? null : (document.querySelector("#correction-rpe")?.value ? Number(document.querySelector("#correction-rpe").value) : null), note: document.querySelector("#correction-note")?.value.trim() || null, exercise_feedback: feedback, skip_reason: isSkipped ? (document.querySelector("#correction-skip-reason")?.value.trim() || null) : null }; await api(`/api/private/sessions/${detail.session_key}/record`, { method: "PUT", body: JSON.stringify(record) }); state.correction = false; if (state.view === "calendar") return loadCalendarDay(state.calendar.selectedDate); await openSession(detail.session_key); }
async function validatePlan() { try { const result = await api("/api/private/plan-updates/validate", { method: "POST", body: JSON.stringify({ package_text: state.draft }) }); state.preview = result.preview; state.planError = null; render(); } catch (error) { state.planError = error.data?.error?.details?.map((detail) => `${detail.path}: ${detail.message}`).join("\n") || error.data?.error?.message || error.message; state.error = null; render(); } }
async function confirmPlan() { await api("/api/private/plan-updates/apply", { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ package_text: state.draft }) }); state.sheet = false; state.preview = null; await refresh(); }

refresh();
