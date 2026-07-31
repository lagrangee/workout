// PROTOTYPE ONLY — three mobile execution models, switchable via ?variant=A|B|C.

const variants = {
  A: "清单优先",
  B: "专注模式",
  C: "动作分段",
};

const items = [
  {
    id: "warmup",
    block: "热身",
    exercise: "跑步机热身",
    set: "连续时长",
    target: "10 分钟 · 目标 RPE 4",
    rest: 0,
    fields: [{ key: "duration", label: "实际时长", value: 10, suffix: "分钟" }],
  },
  {
    id: "goblet-1",
    block: "力量",
    exercise: "高脚杯深蹲",
    set: "第 1 组",
    target: "8 次 · 20 kg · RIR 2",
    rest: 90,
    fields: [
      { key: "reps", label: "次数", value: 8, suffix: "次" },
      { key: "load", label: "重量", value: 20, suffix: "kg" },
      { key: "rir", label: "RIR", value: 2, suffix: "" },
    ],
  },
  {
    id: "goblet-2",
    block: "力量",
    exercise: "高脚杯深蹲",
    set: "第 2 组",
    target: "8 次 · 20 kg · RIR 2",
    rest: 90,
    fields: [
      { key: "reps", label: "次数", value: 8, suffix: "次" },
      { key: "load", label: "重量", value: 20, suffix: "kg" },
      { key: "rir", label: "RIR", value: 2, suffix: "" },
    ],
  },
  {
    id: "goblet-3",
    block: "力量",
    exercise: "高脚杯深蹲",
    set: "第 3 组",
    target: "8 次 · 20 kg · RIR 2",
    rest: 90,
    fields: [
      { key: "reps", label: "次数", value: 8, suffix: "次" },
      { key: "load", label: "重量", value: 20, suffix: "kg" },
      { key: "rir", label: "RIR", value: 2, suffix: "" },
    ],
  },
  {
    id: "split-1-left",
    block: "力量",
    exercise: "保加利亚分腿蹲",
    set: "第 1 组 · 左",
    target: "8 次 · 12 kg × 2 · RIR 2",
    rest: 90,
    fields: [
      { key: "reps", label: "次数", value: 8, suffix: "次" },
      { key: "load", label: "每件重量", value: 12, suffix: "kg" },
      { key: "quantity", label: "哑铃数量", value: 2, suffix: "件" },
      { key: "rir", label: "RIR", value: 2, suffix: "" },
    ],
  },
  {
    id: "split-1-right",
    block: "力量",
    exercise: "保加利亚分腿蹲",
    set: "第 1 组 · 右",
    target: "8 次 · 12 kg × 2 · RIR 2",
    rest: 90,
    fields: [
      { key: "reps", label: "次数", value: 8, suffix: "次" },
      { key: "load", label: "每件重量", value: 12, suffix: "kg" },
      { key: "quantity", label: "哑铃数量", value: 2, suffix: "件" },
      { key: "rir", label: "RIR", value: 2, suffix: "" },
    ],
  },
  {
    id: "split-2-left",
    block: "力量",
    exercise: "保加利亚分腿蹲",
    set: "第 2 组 · 左",
    target: "8 次 · 12 kg × 2 · RIR 2",
    rest: 90,
    fields: [
      { key: "reps", label: "次数", value: 8, suffix: "次" },
      { key: "load", label: "每件重量", value: 12, suffix: "kg" },
      { key: "quantity", label: "哑铃数量", value: 2, suffix: "件" },
      { key: "rir", label: "RIR", value: 2, suffix: "" },
    ],
  },
  {
    id: "split-2-right",
    block: "力量",
    exercise: "保加利亚分腿蹲",
    set: "第 2 组 · 右",
    target: "8 次 · 12 kg × 2 · RIR 2",
    rest: 90,
    fields: [
      { key: "reps", label: "次数", value: 8, suffix: "次" },
      { key: "load", label: "每件重量", value: 12, suffix: "kg" },
      { key: "quantity", label: "哑铃数量", value: 2, suffix: "件" },
      { key: "rir", label: "RIR", value: 2, suffix: "" },
    ],
  },
  {
    id: "plank-1",
    block: "核心",
    exercise: "平板支撑",
    set: "第 1 组",
    target: "45 秒",
    rest: 60,
    fields: [{ key: "duration", label: "实际时长", value: 45, suffix: "秒" }],
  },
  {
    id: "plank-2",
    block: "核心",
    exercise: "平板支撑",
    set: "第 2 组",
    target: "45 秒",
    rest: 60,
    fields: [{ key: "duration", label: "实际时长", value: 45, suffix: "秒" }],
  },
  {
    id: "plank-3",
    block: "核心",
    exercise: "平板支撑",
    set: "第 3 组",
    target: "45 秒",
    rest: 60,
    fields: [{ key: "duration", label: "实际时长", value: 45, suffix: "秒" }],
  },
];

const exerciseOutline = [
  { block: "热身", name: "跑步机热身", detail: "10 分钟 · 目标 RPE 4" },
  { block: "力量", name: "高脚杯深蹲", detail: "3 × 8 · 20 kg · RIR 2 · 休息 90 秒" },
  { block: "力量", name: "保加利亚分腿蹲", detail: "2 × 8 / 侧 · 12 kg × 2 · RIR 2" },
  { block: "核心", name: "平板支撑", detail: "3 × 45 秒 · 休息 60 秒" },
];

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

const state = {
  variant: getVariant(),
  view: "today",
  sessionStatus: "not_started",
  completed: new Set(),
  current: 0,
  restFrom: null,
  rpe: 8,
  sessionNote: "",
  feedbackOpen: null,
  expandedExercise: "跑步机热身",
  adjustOpen: false,
  progressOpen: false,
  correctionTarget: null,
  actual: {},
};

const app = document.querySelector("#app");
const variantLabel = document.querySelector("#variant-label");
const toast = document.querySelector("#toast");

function getVariant() {
  const value = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "B";
}

function escapeHTML(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

function icon(name) {
  const paths = {
    today: '<path d="M5 11h14M8 3v3m8-3v3M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z"/><path d="M8 15h3v3H8z"/>',
    calendar: '<path d="M5 11h14M8 3v3m8-3v3M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z"/>',
    progress: '<path d="M5 19V9m7 10V4m7 15v-7"/>',
    plan: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
    coach: '<path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21a6 6 0 0 1 12 0m0 0a5 5 0 0 1 8 0"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    minimize: '<path d="M6 12h12"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a8 8 0 0 0-1.7 1L5 6.1 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1Z"/>',
    skip: '<circle cx="12" cy="12" r="9"/><path d="m7 7 10 10"/>',
    saved: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function nav() {
  const entries = [
    ["today", "今日"],
    ["calendar", "日历"],
    ["progress", "进展"],
    ["plan", "计划"],
    ["coach", "教练"],
  ];
  return `<nav class="app-nav" aria-label="主导航">${entries
    .map(
      ([key, label]) =>
        `<button class="nav-item ${key === "today" ? "is-active" : ""}" type="button">${icon(key)}<span>${label}</span></button>`,
    )
    .join("")}</nav>`;
}

function header({ title, action = "settings", back = false, timer = false } = {}) {
  const left = back
    ? `<button class="header-side" type="button" data-action="${back}" aria-label="返回">${icon("back")}</button>`
    : `<span class="header-side" aria-hidden="true"></span>`;
  const right = timer
    ? `<span class="header-timer">18:42</span>`
    : action
      ? `<button class="header-side" type="button" aria-label="设置">${icon(action)}</button>`
      : `<span class="header-side" aria-hidden="true"></span>`;
  return `<header class="app-header">${left}<h1>${title}</h1>${right}</header>`;
}

function todayExerciseProgress() {
  return exerciseOutline
    .map((exercise) => {
      const matching = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.exercise === exercise.name);
      const done = matching.filter(({ index }) => state.completed.has(index)).length;
      return `<div class="today-progress-row">
        <span class="item-main"><strong>${exercise.name}</strong><span>${done ? `${done} 项已完成` : "尚未开始"}</span></span>
        <strong class="${done === matching.length ? "is-complete" : ""}">${done} / ${matching.length}</strong>
      </div>`;
    })
    .join("");
}

function renderToday() {
  const hasSession = state.sessionStatus !== "not_started";
  let currentBlock = "";
  const rows = exerciseOutline
    .map((exercise, index) => {
      const block = exercise.block !== currentBlock ? `<div class="outline-block">${exercise.block}</div>` : "";
      currentBlock = exercise.block;
      return `${block}<div class="outline-row"><span class="outline-number">${index + 1}</span><div><strong>${exercise.name}</strong><span>${exercise.detail}</span></div></div>`;
    })
    .join("");
  return `
    ${header({ title: "今日" })}
    <div class="content-scroll">
      <section class="today-hero">
        <p class="date-line">今天 · 7月31日</p>
        <h2>力量 + 核心 + 热身</h2>
        <p class="today-meta">${
          state.sessionStatus === "in_progress"
            ? `进行中 · 已完成 ${state.completed.size} / ${items.length}`
            : state.sessionStatus === "partial"
              ? `部分完成 · 已完成 ${state.completed.size} / ${items.length}`
              : state.sessionStatus === "completed"
                ? `已完成 · ${items.length} / ${items.length}`
                : "预计 55 分钟 · 11 个完成项"
        }</p>
      </section>
      ${
        hasSession
          ? `<section class="today-session-progress">
              <div class="today-progress-head"><strong>${state.sessionStatus === "partial" ? "已保存的训练进度" : "今日训练进度"}</strong><span>${Math.round((state.completed.size / items.length) * 100)}%</span></div>
              <div class="progress-track"><span style="width:${Math.round((state.completed.size / items.length) * 100)}%"></span></div>
              <div class="today-progress-list">${todayExerciseProgress()}</div>
            </section>`
          : `<div class="plan-outline">${rows}</div>`
      }
      <div class="today-actions">
        ${
          state.sessionStatus === "not_started"
            ? '<button class="primary-button" type="button" data-action="start">开始训练</button><button class="secondary-button" type="button" data-action="skip">跳过训练</button>'
            : state.sessionStatus === "completed"
              ? '<button class="secondary-button" type="button" data-action="open-saved">查看训练记录</button>'
              : '<button class="primary-button" type="button" data-action="continue">继续训练</button><button class="secondary-button" type="button" data-action="open-saved">查看已保存记录</button>'
        }
      </div>
    </div>
    ${nav()}
  `;
}

function sessionHeader() {
  return `<header class="app-header">
    <button class="header-side" type="button" data-action="minimize" aria-label="最小化训练">${icon("back")}</button>
    <h1>18:42</h1>
    <button class="header-side header-minimize" type="button" data-action="minimize">最小化</button>
  </header>`;
}

function progress(interactive = false) {
  const count = state.completed.size;
  const bar = `<div class="progress-track" aria-hidden="true"><span style="width:${Math.round((count / items.length) * 100)}%"></span></div>`;
  if (!interactive) {
    return `<div class="session-progress"><span>${count} / ${items.length} 完成</span>${bar}</div>`;
  }
  const list = state.progressOpen
    ? `<div class="progress-list" aria-label="全部训练项目">${items
        .map((item, index) => {
          const done = state.completed.has(index);
          const current = state.current === index;
          return `<button class="progress-item ${done ? "is-done" : ""} ${current ? "is-current" : ""}" type="button" data-action="jump-item" data-index="${index}">
            <span class="completion-index">${index + 1}</span>
            <span class="item-main"><strong>${item.exercise} · ${item.set}</strong><span>${item.target}</span></span>
            <span class="progress-item-state">${done ? "✓" : current ? "当前" : ""}</span>
          </button>`;
        })
        .join("")}</div>`
    : "";
  return `<div class="progress-disclosure">
    <button class="session-progress is-interactive" type="button" data-action="toggle-progress" aria-expanded="${state.progressOpen}" aria-label="训练进度 ${count} / ${items.length} 完成，${state.progressOpen ? "收起" : "展开"}项目列表">
      <span>${count} / ${items.length} 完成</span>${bar}<span class="progress-chevron">${state.progressOpen ? "⌃" : "⌄"}</span>
    </button>
    ${list}
  </div>`;
}

function itemRow(item, index, compact = false) {
  const done = state.completed.has(index);
  const current = state.current === index;
  return `
    <button class="completion-row ${done ? "is-done" : ""} ${current ? "is-current" : ""}" type="button" data-action="complete-item" data-index="${index}" aria-label="${done ? "已完成" : "完成"} ${item.exercise} ${item.set}">
      <span class="completion-index">${index + 1}</span>
      <span class="item-main"><strong>${compact ? item.set : `${item.exercise} · ${item.set}`}</strong><span>${item.target}</span></span>
      <span class="completion-mark">${done ? "✓" : current ? "完成" : ""}</span>
    </button>
  `;
}

function feedbackControl(exercise) {
  if (state.feedbackOpen === exercise) {
    return `<div class="exercise-feedback"><textarea class="feedback-input" placeholder="例如：左侧今天明显偏弱" aria-label="${exercise}动作反馈"></textarea><button class="text-button" type="button" data-action="close-feedback">收起动作反馈</button></div>`;
  }
  return `<div class="exercise-feedback"><button class="text-button" type="button" data-action="open-feedback" data-exercise="${exercise}">添加动作反馈</button></div>`;
}

function renderVariantA() {
  let block = "";
  let exercise = "";
  let content = "";
  items.forEach((item, index) => {
    if (exercise && item.exercise !== exercise) content += feedbackControl(exercise);
    if (item.block !== block) {
      block = item.block;
      content += `<div class="list-block-label">${block}</div>`;
    }
    exercise = item.exercise;
    content += itemRow(item, index);
    if (index === items.length - 1) content += feedbackControl(exercise);
  });
  return `${sessionHeader()}${progress()}<div class="content-scroll workout-content">${content}</div>${sessionFooter()}`;
}

function actualValue(item, field) {
  return state.actual[item.id]?.[field.key] ?? field.value;
}

function actualDisplay(item, field) {
  const actual = actualValue(item, field);
  const changed = String(actual) !== String(field.value);
  if (!changed) {
    return `<strong>${field.value}${field.suffix ? ` ${field.suffix}` : ""}</strong>`;
  }
  return `<span class="value-comparison" aria-label="${field.label}，计划 ${field.value}，实际 ${actual}${field.suffix}">
    <span class="planned-value">${field.value}</span>
    <span class="value-divider">/</span>
    <strong class="actual-value">${actual}</strong>
    ${field.suffix ? `<span class="value-suffix">${field.suffix}</span>` : ""}
  </span>`;
}

function renderVariantB() {
  const item = items[state.current];
  const done = state.completed.has(state.current);
  const actualRows = item.fields
    .map((field) => `<div class="actual-row"><span>${field.label}</span>${actualDisplay(item, field)}</div>`)
    .join("");
  return `
    ${sessionHeader()}
    ${progress(true)}
    <div class="content-scroll workout-content">
      <section class="focus-stage">
        <span class="focus-count">${state.current + 1} / ${items.length} · ${item.block}</span>
        <h2>${item.exercise} · ${item.set}</h2>
        <p class="focus-prescription">计划：${item.target}${item.rest ? ` · 休息 ${item.rest} 秒` : ""}</p>
        <div class="actual-panel">${actualRows}</div>
        <div class="feedback-area">${feedbackControl(item.exercise)}</div>
        <div class="focus-actions">
          <button class="primary-button" type="button" data-action="complete-current" ${done ? "disabled" : ""}>${done ? "已完成" : "完成"}</button>
          <div class="focus-secondary">
            <button class="compact-button" type="button" data-action="view-prev" ${state.current === 0 ? "disabled" : ""}>上一项</button>
            <button class="compact-button" type="button" data-action="adjust">调整</button>
            <button class="compact-button" type="button" data-action="view-next" ${state.current === items.length - 1 ? "disabled" : ""}>下一项</button>
          </div>
        </div>
      </section>
    </div>
    ${sessionFooter()}
  `;
}

function exerciseGroups() {
  const groups = [];
  items.forEach((item, index) => {
    let group = groups.find((entry) => entry.name === item.exercise);
    if (!group) {
      group = { name: item.exercise, block: item.block, entries: [] };
      groups.push(group);
    }
    group.entries.push({ item, index });
  });
  return groups;
}

function renderVariantC() {
  const groups = exerciseGroups();
  const body = groups
    .map((group, groupIndex) => {
      const doneCount = group.entries.filter(({ index }) => state.completed.has(index)).length;
      const expanded = state.expandedExercise === group.name;
      return `
        <section class="exercise-section">
          <button class="exercise-head" type="button" data-action="toggle-exercise" data-exercise="${group.name}">
            <span class="completion-index">${groupIndex + 1}</span>
            <span><strong>${group.name}</strong><span>${group.entries[0].item.target}</span></span>
            <span class="exercise-count">${doneCount} / ${group.entries.length} ${expanded ? "⌃" : "⌄"}</span>
          </button>
          ${
            expanded
              ? `<div class="exercise-items">${group.entries.map(({ item, index }) => itemRow(item, index, true)).join("")}${feedbackControl(group.name)}</div>`
              : ""
          }
        </section>
      `;
    })
    .join("");
  return `${sessionHeader()}${progress()}<div class="content-scroll workout-content">${body}</div>${sessionFooter()}`;
}

function sessionFooter() {
  return `<footer class="session-footer"><span class="elapsed">18:42</span><button class="primary-button" type="button" data-action="end">结束训练</button></footer>`;
}

function renderActive() {
  if (state.variant === "A") return renderVariantA();
  if (state.variant === "B") return renderVariantB();
  return renderVariantC();
}

function renderRest() {
  const next = items[state.current];
  return `
    ${sessionHeader()}
    ${progress(true)}
    <section class="rest-screen">
      <div class="rest-label">组间休息</div>
      <h2>放松，准备下一项</h2>
      <div class="rest-time" aria-label="剩余休息时间 1 分 12 秒">01:12</div>
      <div class="next-context"><span>接下来</span><strong>${next.exercise} · ${next.set}</strong><small>${next.target}</small></div>
      <button class="secondary-button" type="button" data-action="skip-rest">跳过休息</button>
    </section>
    ${sessionFooter()}
  `;
}

function completionSummary() {
  const count = state.completed.size;
  const percent = Math.round((count / items.length) * 100);
  return { count, percent, outcome: count === items.length ? "已完成" : "部分完成" };
}

function renderSummary() {
  const result = completionSummary();
  const rpe = Array.from(
    { length: 11 },
    (_, value) =>
      `<button class="rpe-button ${state.rpe === value ? "is-selected" : ""}" type="button" data-action="set-rpe" data-rpe="${value}" aria-label="RPE ${value}，${rpeMeanings[value].title}" aria-pressed="${state.rpe === value}">${value}</button>`,
  ).join("");
  const selectedRpe = rpeMeanings[state.rpe];
  const unfinished = items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !state.completed.has(index))
    .map(
      ({ item, index }) => `<li>
        <span class="unfinished-index">${index + 1}</span>
        <span><strong>${item.exercise} · ${item.set}</strong><small>${item.target}</small></span>
      </li>`,
    )
    .join("");
  return `
    ${header({ title: "结束训练", back: "back-active", action: null })}
    <div class="result-scroll">
      <section class="result-screen">
        <div class="result-main">
          <span class="result-kicker">${result.outcome}</span>
          <h2>${result.count} / ${items.length}</h2>
          <p>已完成 · ${result.percent}%</p>
          <div class="result-progress progress-track" aria-hidden="true"><span style="width:${result.percent}%"></span></div>
        </div>
        <div class="form-section rpe-section">
          <div class="form-heading"><label class="form-label">训练 RPE</label><span>整体感受</span></div>
          <div class="rpe-scale">${rpe}</div>
          <div class="rpe-meaning" role="status" aria-live="polite">
            <strong>${state.rpe} · ${selectedRpe.title}</strong>
            <span>${selectedRpe.detail}</span>
          </div>
        </div>
        <div class="form-section note-section">
          <label class="form-label" for="session-note">训练备注 <span>可选</span></label>
          <textarea id="session-note" class="note-input" placeholder="例如：最后一组左侧明显偏弱">${escapeHTML(state.sessionNote)}</textarea>
        </div>
        ${
          unfinished
            ? `<div class="unfinished-section"><h3>以下项目未完成：</h3><ul>${unfinished}</ul></div>`
            : ""
        }
      </section>
    </div>
    <footer class="summary-footer">
      <button class="primary-button" type="button" data-action="save-session">结束并保存</button>
    </footer>
  `;
}

function renderSkipped() {
  return `
    ${header({ title: "今日" })}
    <section class="skipped-screen">
      <div class="status-icon">${icon("skip")}</div>
      <h2>已跳过</h2>
      <p class="muted-copy">今天的 Scheduled Workout 已保留。</p>
      <div class="skip-reason"><span>原因</span><p>今天身体状态不佳，改日再练。</p></div>
      <button class="primary-button" type="button" data-action="restart">重新开始</button>
    </section>
    ${nav()}
  `;
}

function renderSaved() {
  const result = completionSummary();
  return `
    ${header({ title: "训练记录" })}
    <section class="saved-screen">
      <div class="status-icon">${icon("saved")}</div>
      <h2>${result.outcome}</h2>
      <p class="muted-copy">7月31日 · 力量 + 核心 + 热身</p>
      <div class="saved-stats">
        <div class="saved-row"><span>完成度</span><strong>${result.count} / ${items.length} · ${result.percent}%</strong></div>
        <div class="saved-row"><span>实际时长</span><strong>42 分钟</strong></div>
        <div class="saved-row"><span>训练 RPE</span><strong>${state.rpe}</strong></div>
      </div>
      <button class="secondary-button" type="button" data-action="correct">更正记录</button>
      <button class="text-button" type="button" data-action="return-today">返回今日</button>
    </section>
    ${nav()}
  `;
}

function renderCorrection() {
  if (state.correctionTarget === null) return renderCorrectionList();
  if (state.correctionTarget === "session") return renderSessionCorrection();
  return renderItemCorrection(Number(state.correctionTarget));
}

function correctionActualSummary(item) {
  return item.fields
    .map((field) => {
      const value = actualValue(item, field);
      if (field.key === "rir") return `RIR ${value}`;
      if (field.key === "quantity") return `× ${value}`;
      return `${value}${field.suffix ? ` ${field.suffix}` : ""}`;
    })
    .join(" · ");
}

function renderCorrectionList() {
  const rows = items
    .map((item, index) => {
      const done = state.completed.has(index);
      return `<button class="correction-option" type="button" data-action="select-correction" data-target="${index}">
        <span class="completion-index">${index + 1}</span>
        <span class="item-main"><strong>${item.exercise} · ${item.set}</strong><span>${done ? correctionActualSummary(item) : "未完成"}</span></span>
        <span class="correction-chevron">›</span>
      </button>`;
    })
    .join("");
  return `
    ${header({ title: "更正记录", back: "back-saved", action: null })}
    <div class="correction-body">
      <div class="correction-title"><h2>选择要更正的项目</h2><p>计划快照不会改变；保存后完成度与进展立即重算。</p></div>
      <button class="correction-option is-session" type="button" data-action="select-correction" data-target="session">
        <span class="completion-index">整体</span>
        <span class="item-main"><strong>训练整体</strong><span>开始/结束时间、训练 RPE、训练备注</span></span>
        <span class="correction-chevron">›</span>
      </button>
      <div class="list-block-label">训练项目</div>
      <div class="correction-list">${rows}</div>
    </div>
  `;
}

function renderSessionCorrection() {
  return `
    ${header({ title: "训练整体", back: "back-correction-list", action: null })}
    <div class="correction-body">
      <div class="correction-title"><h2>更正训练整体</h2><p>实际时长由各训练时段自动汇总。</p></div>
      <div class="edit-fields">
        <div class="edit-field"><label for="correct-start">本时段开始</label><input id="correct-start" class="field-input" type="time" value="09:20" /></div>
        <div class="edit-field"><label for="correct-end">本时段结束</label><input id="correct-end" class="field-input" type="time" value="10:02" /></div>
        <div class="edit-field"><label for="correct-session-rpe">训练 RPE</label><input id="correct-session-rpe" class="field-input" inputmode="numeric" value="${state.rpe}" /></div>
      </div>
      <div class="form-section"><label class="form-label" for="correct-session-note">训练备注（可选）</label><textarea id="correct-session-note" class="feedback-input" placeholder="记录本次训练的整体感受…">${escapeHTML(state.sessionNote)}</textarea></div>
    </div>
    <div class="correction-actions"><button class="primary-button" type="button" data-action="save-correction">保存更正</button></div>
  `;
}

function renderItemCorrection(index) {
  const item = items[index];
  const fields = item.fields
    .map(
      (field) =>
        `<div class="edit-field"><label for="correct-${field.key}">${field.label}${field.suffix ? `（${field.suffix}）` : ""}</label><input id="correct-${field.key}" class="field-input" data-correction-field="${field.key}" inputmode="decimal" value="${actualValue(item, field)}" /></div>`,
    )
    .join("");
  return `
    ${header({ title: "更正项目", back: "back-correction-list", action: null })}
    <div class="correction-body">
      <div class="correction-title"><h2>${item.exercise} · ${item.set}</h2><p>最新记录：7月31日 10:02</p></div>
      <div class="snapshot-box"><span>计划（不可更改）</span><strong>${item.target}${item.rest ? ` · 休息 ${item.rest} 秒` : ""}</strong></div>
      <label class="completion-toggle" for="correct-completed"><input id="correct-completed" type="checkbox" ${state.completed.has(index) ? "checked" : ""} />此项已完成</label>
      <div class="edit-fields">${fields}</div>
      <div class="form-section"><label class="form-label" for="correct-feedback">动作反馈（可选）</label><textarea id="correct-feedback" class="feedback-input" placeholder="对该动作的反馈…"></textarea></div>
    </div>
    <div class="correction-actions"><button class="primary-button" type="button" data-action="save-correction">保存更正</button></div>
  `;
}

function renderAdjustSheet() {
  if (!state.adjustOpen) return "";
  const item = items[state.current];
  const fields = item.fields
    .map(
      (field) =>
        `<div class="edit-field"><label for="adjust-${field.key}">${field.label}${field.suffix ? `（${field.suffix}）` : ""}</label><input id="adjust-${field.key}" class="field-input" data-field="${field.key}" inputmode="decimal" value="${actualValue(item, field)}" /></div>`,
    )
    .join("");
  return `
    <div class="overlay" data-action="close-adjust">
      <section class="sheet" role="dialog" aria-modal="true" aria-label="调整实际值" onclick="event.stopPropagation()">
        <div class="sheet-handle"></div>
        <div class="sheet-head"><h2>调整实际值</h2><button class="close-button" type="button" data-action="close-adjust" aria-label="关闭">×</button></div>
        <p class="muted-copy">${item.exercise} · ${item.set}<br>计划保持：${item.target}</p>
        <div class="edit-fields">${fields}</div>
        <button class="primary-button" type="button" data-action="save-adjust">保存并返回</button>
      </section>
    </div>
  `;
}

function render() {
  variantLabel.textContent = `${state.variant} — ${variants[state.variant]}`;
  let content = "";
  if (state.view === "today") content = renderToday();
  if (state.view === "active") content = renderActive();
  if (state.view === "rest") content = renderRest();
  if (state.view === "summary") content = renderSummary();
  if (state.view === "skipped") content = renderSkipped();
  if (state.view === "saved") content = renderSaved();
  if (state.view === "correction") content = renderCorrection();
  app.innerHTML = `<div class="app">${content}${renderAdjustSheet()}</div>`;
  bindEvents();
}

function bindEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action, element));
  });
  app.querySelector("#session-note")?.addEventListener("input", (event) => {
    state.sessionNote = event.currentTarget.value;
  });
}

function nextIncomplete(start = 0) {
  for (let index = start; index < items.length; index += 1) {
    if (!state.completed.has(index)) return index;
  }
  for (let index = 0; index < start; index += 1) {
    if (!state.completed.has(index)) return index;
  }
  return items.length - 1;
}

function completeIndex(index) {
  if (state.completed.has(index)) return;
  state.completed.add(index);
  state.restFrom = index;
  state.current = nextIncomplete(index + 1);
  state.expandedExercise = items[state.current].exercise;
  if (state.completed.size === items.length) {
    state.view = "summary";
  } else if (items[index].rest > 0) {
    state.view = "rest";
  } else {
    state.view = "active";
  }
}

function handleAction(action, element) {
  if (action === "start" || action === "continue" || action === "restart") {
    if (action === "restart") {
      state.completed = new Set();
      state.current = 0;
    }
    const resumedPartial = action === "continue" && state.sessionStatus === "partial";
    state.sessionStatus = "in_progress";
    state.progressOpen = false;
    state.view = "active";
    if (resumedPartial) showToast("继续同一次训练，已开始新的训练时段");
  } else if (action === "minimize") {
    state.view = "today";
  } else if (action === "skip") {
    state.sessionStatus = "skipped";
    state.view = "skipped";
  } else if (action === "complete-item") {
    completeIndex(Number(element.dataset.index));
  } else if (action === "complete-current") {
    completeIndex(state.current);
  } else if (action === "skip-rest") {
    state.view = "active";
  } else if (action === "view-prev" || action === "view-next") {
    state.current = Math.max(0, Math.min(items.length - 1, state.current + (action === "view-next" ? 1 : -1)));
    state.feedbackOpen = null;
    state.progressOpen = false;
    state.expandedExercise = items[state.current].exercise;
  } else if (action === "toggle-progress") {
    state.progressOpen = !state.progressOpen;
  } else if (action === "jump-item") {
    state.current = Number(element.dataset.index);
    state.feedbackOpen = null;
    state.progressOpen = false;
    state.expandedExercise = items[state.current].exercise;
    if (state.view === "rest") state.view = "active";
  } else if (action === "end") {
    state.progressOpen = false;
    state.view = "summary";
  } else if (action === "back-active") {
    state.view = "active";
  } else if (action === "set-rpe") {
    state.rpe = Number(element.dataset.rpe);
  } else if (action === "save-session") {
    state.sessionStatus = state.completed.size === items.length ? "completed" : "partial";
    state.view = "saved";
    showToast(state.sessionStatus === "partial" ? "当前进度已保存，今天仍可继续" : "训练记录已保存");
  } else if (action === "correct") {
    state.correctionTarget = null;
    state.view = "correction";
  } else if (action === "select-correction") {
    state.correctionTarget = element.dataset.target === "session" ? "session" : Number(element.dataset.target);
  } else if (action === "back-correction-list") {
    state.correctionTarget = null;
  } else if (action === "back-saved") {
    state.view = "saved";
  } else if (action === "save-correction") {
    if (typeof state.correctionTarget === "number") {
      const values = {};
      app.querySelectorAll("[data-correction-field]").forEach((input) => {
        values[input.dataset.correctionField] = input.value;
      });
      state.actual[items[state.correctionTarget].id] = values;
      const completedInput = app.querySelector("#correct-completed");
      if (completedInput?.checked) state.completed.add(state.correctionTarget);
      else state.completed.delete(state.correctionTarget);
    } else if (state.correctionTarget === "session") {
      const correctedRpe = Number(app.querySelector("#correct-session-rpe")?.value);
      if (Number.isInteger(correctedRpe) && correctedRpe >= 0 && correctedRpe <= 10) state.rpe = correctedRpe;
      state.sessionNote = app.querySelector("#correct-session-note")?.value ?? state.sessionNote;
    }
    state.sessionStatus = state.completed.size === items.length ? "completed" : "partial";
    state.correctionTarget = null;
    state.view = "correction";
    showToast("更正已保存，完成度与进展已重新计算");
  } else if (action === "return-today") {
    state.view = "today";
  } else if (action === "open-saved") {
    state.view = "saved";
  } else if (action === "open-feedback") {
    state.feedbackOpen = element.dataset.exercise;
  } else if (action === "close-feedback") {
    state.feedbackOpen = null;
  } else if (action === "toggle-exercise") {
    state.expandedExercise = state.expandedExercise === element.dataset.exercise ? null : element.dataset.exercise;
  } else if (action === "adjust") {
    state.adjustOpen = true;
  } else if (action === "close-adjust") {
    state.adjustOpen = false;
  } else if (action === "save-adjust") {
    const values = {};
    app.querySelectorAll("[data-field]").forEach((input) => {
      values[input.dataset.field] = input.value;
    });
    state.actual[items[state.current].id] = values;
    state.adjustOpen = false;
    showToast("实际值已调整");
  }
  render();
}

function switchVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  state.progressOpen = false;
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  window.history.replaceState({}, "", url);
  render();
}

function loadSample(sample) {
  state.adjustOpen = false;
  state.progressOpen = false;
  state.correctionTarget = null;
  state.sessionNote = "";
  state.feedbackOpen = null;
  if (sample === "active") {
    state.sessionStatus = "in_progress";
    state.completed = new Set([0, 1]);
    state.current = 2;
    state.expandedExercise = items[2].exercise;
    state.view = "active";
  }
  if (sample === "summary") {
    state.sessionStatus = "in_progress";
    state.completed = new Set(items.map((_, index) => index).filter((index) => index !== 6));
    state.current = 6;
    state.expandedExercise = items[6].exercise;
    state.view = "summary";
  }
  if (sample === "skipped") {
    state.sessionStatus = "skipped";
    state.completed = new Set();
    state.current = 0;
    state.view = "skipped";
  }
  render();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

document.querySelectorAll("[data-switch]").forEach((button) => {
  button.addEventListener("click", () => switchVariant(button.dataset.switch === "next" ? 1 : -1));
});

document.querySelectorAll("[data-sample]").forEach((button) => {
  button.addEventListener("click", () => loadSample(button.dataset.sample));
});

window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, [contenteditable]")) return;
  if (event.key === "ArrowLeft") switchVariant(-1);
  if (event.key === "ArrowRight") switchVariant(1);
});

render();
