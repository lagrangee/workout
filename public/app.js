const weekdayLabels = { monday: "周一", tuesday: "周二", wednesday: "周三", thursday: "周四", friday: "周五", saturday: "周六", sunday: "周日" };
const state = { view: "today", today: null, plan: null, progress: null, session: null, focusIndex: 0, adjust: false, sheet: false, draft: "", error: null, loading: true, message: "" };

const app = document.querySelector("#app");
const athleteEmail = () => localStorage.getItem("workout-athlete-email") || "athlete-a@example.invalid";
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", "x-athlete-email": athleteEmail(), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "请求失败"), { data, status: response.status });
  return data;
}
const key = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const pct = (value) => `${Math.round((value || 0) * 100)}%`;

async function refresh() {
  state.loading = true; render();
  try {
    [state.today, state.plan, state.progress] = await Promise.all([api("/api/private/today"), api("/api/private/plan"), api("/api/private/progress?preset=30d")]);
    state.session = state.today.session;
    state.error = null;
  } catch (error) { state.error = error.data?.error?.message || error.message; }
  state.loading = false; render();
}

function shell(content) {
  return `<div class="shell"><header class="topbar"><span class="eyebrow">WORKOUT TRACKER</span><button class="ghost" data-action="settings" aria-label="设置">⚙</button></header><main>${content}</main><nav class="bottom-nav" aria-label="主导航">${[["today", "今日"], ["plan", "计划"], ["progress", "进展"], ["coach", "教练"], ["settings", "设置"]].map(([id, label]) => `<button class="nav-link ${state.view === id ? "active" : ""}" data-view="${id}">${label}</button>`).join("")}</nav></div>`;
}

function render() {
  if (state.loading) { app.innerHTML = shell(`<section class="loading"><span class="spinner"></span><p>正在读取你的训练状态…</p></section>`); return; }
  if (state.error) { app.innerHTML = shell(`<section class="error-card"><p>${escapeHtml(state.error)}</p><button class="primary" data-action="refresh">重新读取</button></section>`); bind(); return; }
  const content = state.view === "today" ? todayView() : state.view === "plan" ? planView() : state.view === "progress" ? progressView() : state.view === "coach" ? coachView() : settingsView();
  app.innerHTML = shell(content); bind();
}

function todayView() {
  const entry = state.today?.entry; const session = state.today?.session;
  if (!entry || entry.kind === "no_plan") return `<section class="hero"><p class="eyebrow">${state.today?.date || "今天"}</p><h1>今天没有计划</h1><p class="muted">Agent 可以为未来日期准备一份完整的 Weekly Template。</p><button class="secondary" data-view="plan">查看计划</button></section>`;
  if (entry.kind === "rest") return `<section class="hero"><p class="eyebrow">${state.today.date} · ${state.today.timezone}</p><span class="status-dot rest"></span><h1>休息日</h1><p class="muted">Rest Day 不创建 Session，也不影响训练统计。</p><div class="quiet-card">今天把恢复留给自己。</div></section>`;
  if (session) return sessionView(session, entry);
  return `<section class="hero"><p class="eyebrow">${state.today.date} · ${state.today.timezone}</p><h1>${escapeHtml(entry.title)}</h1><p class="muted">约 ${entry.estimated_duration_min} 分钟 · 只记录今天的 Scheduled Workout</p><div class="hero-actions"><button class="primary" data-action="start">开始训练</button><button class="secondary" data-action="skip">跳过今天</button></div></section><section class="quiet-card"><strong>今天的规则</strong><p>完成的是实际训练，不要求必须达到目标；计划快照会在开始时固定。</p></section>`;
}

function sessionView(session, entry) {
  const detail = state.sessionDetail;
  const items = detail?.snapshot?.completion_items || [];
  if (session.status === "skipped") return `<section class="hero"><span class="status-pill skipped">已跳过</span><h1>${escapeHtml(entry.title)}</h1><p class="muted">跳过保留在今天的记录中。你仍可以在今天重新开始。</p><button class="primary" data-action="restart">重新开始训练</button></section>`;
  if (!detail) return `<section class="hero"><span class="status-pill">${escapeHtml(session.status)}</span><h1>${escapeHtml(entry.title)}</h1><p class="muted">已完成 ${pct(session.completion_fraction)} · ${session.training_duration_sec} 秒</p><button class="primary" data-action="open-session">继续查看</button></section>`;
  const item = items[state.focusIndex] || items[0]; const result = detail.completion_results.find((candidate) => candidate.completion_item_key === item?.completion_item_key); const isDone = Boolean(result);
  if (session.status === "completed" || session.status === "partial") return `<section class="hero compact"><span class="status-pill ${session.status}">${session.status === "completed" ? "已完成" : "部分完成"}</span><h1>${escapeHtml(entry.title)}</h1><div class="metric-large">${pct(session.completion_fraction)}</div><p class="muted">训练时长 ${session.training_duration_sec} 秒${session.session_rpe == null ? "" : ` · RPE ${session.session_rpe}`}</p><div class="hero-actions">${session.status === "partial" ? `<button class="primary" data-action="continue">继续训练</button>` : ""}<button class="secondary" data-action="edit-session">校正记录</button></div></section>`;
  return `<section class="focus-header"><div><p class="eyebrow">${state.focusIndex + 1} / ${items.length}</p><h1>专注完成一项</h1><p class="muted">${escapeHtml(item?.side === "none" ? "" : item?.side)} ${escapeHtml(exerciseName(detail, item))}</p></div><strong>${pct(session.completion_fraction)}</strong></section><div class="progress-line"><span style="width:${pct(session.completion_fraction)}"></span></div><section class="focus-card"><p class="eyebrow">${escapeHtml(item?.target?.metric === "reps" ? "次数" : "时长")}</p><h2>${item ? `${item.target.min === item.target.max ? item.target.min : `${item.target.min}–${item.target.max}`} ${item.target.metric === "reps" ? "次" : "秒"}` : "没有可记录的项目"}</h2>${isDone ? `<div class="actual-badge">已记录 ${result.actual.value} ${result.actual.metric === "reps" ? "次" : "秒"}</div>` : `<p class="muted">默认值已预填，达到目标不等于必须完成。</p>`}<div class="focus-actions"><button class="secondary" data-action="previous" ${state.focusIndex === 0 ? "disabled" : ""}>上一个</button><button class="primary" data-action="complete">${isDone ? "已完成" : "完成此项"}</button><button class="secondary" data-action="next" ${state.focusIndex >= items.length - 1 ? "disabled" : ""}>下一个</button></div><button class="text-button" data-action="toggle-adjust">${state.adjust ? "收起调整" : "调整实际值"}</button>${state.adjust ? `<div class="adjust-panel"><label>实际 ${item?.target?.metric === "reps" ? "次数" : "秒数"}<input id="actual-value" type="number" min="1" value="${result?.actual?.value || item?.target?.min || 1}" /></label><label>RIR<input id="actual-rir" type="number" min="0" max="10" value="${result?.rir ?? ""}" /></label><button class="primary wide" data-action="save-adjust">保存并完成</button></div>` : ""}</section><section class="focus-footer"><button class="secondary wide" data-action="end">结束并保存</button><button class="text-button" data-action="open-progress-list">查看全部 ${items.length} 项</button></section>`;
}

function exerciseName(detail, item) { return detail?.snapshot?.blocks?.flatMap((block) => block.exercises).find((exercise) => exercise.exercise_occurrence_key === item?.exercise_occurrence_key)?.name || "训练项目"; }

function planView() {
  const current = state.plan?.current; const week = current?.week || {};
  return `<section class="page-head"><p class="eyebrow">READ-ONLY PLAN</p><h1>本周计划</h1><p class="muted">${current ? `从 ${current.effective_from} 生效 · ${state.plan.timezone}` : "还没有 Current Plan"}</p></section>${current ? `<section class="week-list">${Object.entries(week).map(([day, slot]) => `<article class="week-row"><span class="day-label">${weekdayLabels[day]}</span><div><strong>${slot?.kind === "workout" ? escapeHtml(slot.title) : slot?.kind === "rest" ? "休息日" : "无计划"}</strong><p>${slot?.kind === "workout" ? `${slot.blocks.length} 个 Block · 约 ${slot.estimated_duration_min} 分钟` : slot?.kind === "rest" ? "不创建 Session" : "Weekly Template 未安排内容"}</p></div></article>`).join("")}</section>` : `<div class="quiet-card">从 Agent 复制完整 JSON 后，可以创建第一份未来计划。</div>`}<section class="pending-card"><strong>${state.plan?.pending_count ? `已有 ${state.plan.pending_count} 个未来更新` : "没有待生效更新"}</strong><p>${state.plan?.next_effective_from ? `下一份计划从 ${state.plan.next_effective_from} 生效。` : "计划只通过 Agent JSON 更新，不提供手工编辑器。"}</p></section><button class="primary wide" data-action="open-plan-sheet">粘贴 Agent 计划 JSON</button>${state.sheet ? planSheet() : ""}`;
}

function planSheet() { return `<div class="modal-backdrop" data-action="close-sheet"><section class="bottom-sheet" onclick="event.stopPropagation()"><div class="sheet-handle"></div><h2>${state.error ? "计划需要修正" : "更新计划"}</h2><p class="muted">粘贴完整 JSON。App 只检查、预览并原子应用，不提供手工计划编辑。</p><textarea id="plan-json" placeholder='{"schema_version":1,"effective_from":"2026-08-01","week":{...}}'>${escapeHtml(state.draft)}</textarea>${state.error ? `<div class="validation-error"><strong>计划无法更新</strong><p>${escapeHtml(state.error)}</p><button class="secondary" data-action="copy-error">复制错误详情</button></div>` : ""}<div class="sheet-actions"><button class="secondary" data-action="close-sheet">取消</button><button class="primary" data-action="validate-plan">检查计划</button></div></section></div>`; }

function progressView() { const metric = state.progress?.metrics; const rate = metric?.completion_rate; return `<section class="page-head"><p class="eyebrow">LAST 30 DAYS</p><h1>进展</h1><p class="muted">${state.progress?.period?.from || ""} – ${state.progress?.period?.to || ""} · ${state.progress?.period?.timezone || ""}</p></section><div class="metric-grid"><article><span>完成率</span><strong>${rate?.value == null ? "—" : pct(rate.value)}</strong><small>${rate?.evidence?.due_workouts || 0} 个到期训练</small></article><article><span>训练时长</span><strong>${metric?.training_duration?.value_sec || 0}<small> 秒</small></strong><small>只计已结束区间</small></article><article><span>力量训练日</span><strong>${metric?.strength_training_days?.value || 0}</strong><small>按日期计一次</small></article><article><span>平均 RPE</span><strong>${metric?.average_session_rpe?.value ?? "—"}</strong><small>${metric?.average_session_rpe?.included_count || 0} 个有效记录</small></article></div><section class="quiet-card"><strong>训练连续性</strong><p>${state.progress?.current_streak?.value || 0} 天连续完成 100% 训练；休息日和无计划日保持中性。</p></section><section class="list-card"><h2>Exercise Progress</h2>${(state.progress?.exercises || []).length ? state.progress.exercises.map((exercise) => `<button class="list-row" data-exercise="${escapeHtml(exercise.exercise_key)}"><span><strong>${escapeHtml(exercise.current_name)}</strong><small>${exercise.performed_session_count} 个 Session</small></span><span>›</span></button>`).join("") : `<p class="muted">还没有可展示的 Exercise evidence。</p>`}</section>`; }

function coachView() { return `<section class="page-head"><p class="eyebrow">AGENT-FIRST SHARING</p><h1>Coach Share</h1><p class="muted">永久、只读、可撤销的 Agent API。分享前请把链接当作秘密。</p></section><section class="quiet-card"><strong>隐私边界</strong><p>公开 API 不包含登录邮箱、内部 ID、token、遥测、症状、目标、路线或教练分析。</p></section><div class="hero-actions"><button class="primary" data-action="create-share">创建分享</button><button class="secondary" data-action="export">下载 Athlete Export</button></div>`; }
function settingsView() { return `<section class="page-head"><p class="eyebrow">ATHLETE SETTINGS</p><h1>设置</h1><p class="muted">只保存显示名称和 IANA timezone。</p></section><form class="settings-form" data-form="settings"><label>显示名称<input name="display_name" maxlength="50" value="${escapeHtml(state.me?.display_name || "")}" /></label><label>Timezone<input name="timezone" value="${escapeHtml(state.me?.timezone || state.today?.timezone || "Asia/Shanghai")}" /></label><button class="primary wide">保存设置</button></form><p class="muted tiny">本地开发可用 localStorage 的 workout-athlete-email 切换两个 fixture Athlete。</p>`; }

async function loadMe() { try { state.me = await api("/api/private/me"); } catch {} }
function bind() {
  app.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", async () => { state.view = button.dataset.view; if (state.view === "settings") await loadMe(); render(); }));
  app.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", () => action(element.dataset.action)));
  app.querySelectorAll("[data-exercise]").forEach((element) => element.addEventListener("click", () => { state.message = `Exercise detail: ${element.dataset.exercise}`; }));
  const form = app.querySelector("[data-form=settings]"); if (form) form.addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); try { await api("/api/private/settings", { method: "PUT", body: JSON.stringify(values) }); state.message = "设置已保存"; await refresh(); } catch (error) { state.error = error.data?.error?.message || error.message; render(); } });
  const textarea = app.querySelector("#plan-json"); if (textarea) textarea.addEventListener("input", () => { state.draft = textarea.value; state.error = null; });
}

async function action(name) {
  try {
    if (name === "refresh") return refresh(); if (name === "settings") { state.view = "settings"; await loadMe(); return render(); }
    if (name === "start" || name === "skip") { const date = state.today.date; const body = name === "skip" ? { skip_reason: null } : {}; const result = await api(`/api/private/scheduled-workouts/${date}/${name}`, { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify(body) }); state.session = result; await openSession(result.session_key); return; }
    if (name === "open-session" || name === "restart") { if (name === "restart") { const result = await api(`/api/private/sessions/${state.session.session_key}/restart`, { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); state.session = result; } await openSession(state.session.session_key); return; }
    if (name === "continue") { const result = await api(`/api/private/sessions/${state.session.session_key}/continue`, { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); state.session = result; await openSession(result.session_key); return; }
    if (name === "complete" || name === "save-adjust") return completeCurrent(); if (name === "previous") { state.focusIndex -= 1; return render(); } if (name === "next") { state.focusIndex += 1; return render(); } if (name === "toggle-adjust") { state.adjust = !state.adjust; return render(); }
    if (name === "end") return endCurrent(); if (name === "edit-session") return openSession(state.session.session_key); if (name === "open-progress-list") { state.focusIndex = 0; return render(); }
    if (name === "open-plan-sheet") { state.sheet = true; state.error = null; return render(); } if (name === "close-sheet") { state.sheet = false; state.error = null; return render(); }
    if (name === "validate-plan") return validatePlan(); if (name === "copy-error") return navigator.clipboard?.writeText(state.error || "计划需要修正"); if (name === "export") { window.location.href = "/api/private/export"; return; }
    if (name === "create-share") { await api("/api/private/coach-share", { method: "POST", headers: { "Idempotency-Key": key() }, body: "{}" }); const share = await api("/api/private/coach-share"); if (share.url) await navigator.clipboard?.writeText(share.url); state.message = "Coach Share 已创建并复制"; return render(); }
  } catch (error) { state.error = error.data?.error?.message || error.message; render(); }
}

async function openSession(sessionKey) { state.sessionDetail = await api(`/api/private/sessions/${sessionKey}`); state.focusIndex = 0; state.view = "today"; render(); }
async function completeCurrent() { const item = state.sessionDetail.snapshot.completion_items[state.focusIndex]; if (!item) return; const existing = state.sessionDetail.completion_results.filter((result) => result.completion_item_key !== item.completion_item_key); const value = Number(document.querySelector("#actual-value")?.value || item.target.min); const rirInput = document.querySelector("#actual-rir")?.value; const result = { completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value }, resistance: item.resistance, rir: rirInput === "" || rirInput == null ? null : Number(rirInput), completed_at: new Date().toISOString() }; const intervals = state.sessionDetail.training_intervals; await api(`/api/private/sessions/${state.sessionDetail.session_key}/record`, { method: "PUT", body: JSON.stringify({ record_schema_version: 1, completion_results: [...existing, result], training_intervals: intervals, session_rpe: null, note: state.sessionDetail.note, exercise_feedback: state.sessionDetail.exercise_feedback, skip_reason: null }) }); await openSession(state.sessionDetail.session_key); }
async function endCurrent() { const rpe = Number(window.prompt("Session RPE（0–10，可留空）", "") || "NaN"); const note = window.prompt("Session note（可留空）", "") || null; const record = { record_schema_version: 1, completion_results: state.sessionDetail.completion_results, training_intervals: state.sessionDetail.training_intervals, session_rpe: Number.isInteger(rpe) ? rpe : null, note, exercise_feedback: state.sessionDetail.exercise_feedback, skip_reason: null }; const result = await api(`/api/private/sessions/${state.sessionDetail.session_key}/end`, { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ record, ended_at: new Date().toISOString() }) }); state.session = result; await refresh(); }
async function validatePlan() { const result = await api("/api/private/plan-updates/validate", { method: "POST", body: JSON.stringify({ package_text: state.draft }) }); const confirm = window.confirm(`计划将于 ${result.preview.effective_from} 生效，${result.preview.changed_weekday_slot_count} 个 weekday slot 发生变化。确认应用？`); if (!confirm) return; await api("/api/private/plan-updates/apply", { method: "POST", headers: { "Idempotency-Key": key() }, body: JSON.stringify({ package_text: state.draft }) }); state.sheet = false; await refresh(); }

refresh();
