// PROTOTYPE ONLY — three Plan + JSON-update variants, switchable via ?variant=A|B|C.

const variants = {
  A: "同页渐进",
  B: "专注两步",
  C: "底部面板",
};

const currentWeek = [
  { day: "周一", kind: "workout", title: "力量训练 · 上肢", detail: "引体向上、俯卧撑、平板支撑", meta: "60 分钟" },
  { day: "周二", kind: "workout", title: "有氧跑 · 节奏跑", detail: "连续时长 · RPE 5–6", meta: "45 分钟" },
  { day: "周三", kind: "rest", title: "休息日", detail: "不创建训练记录", meta: "" },
  { day: "周四", kind: "workout", title: "力量训练 · 下肢", detail: "保加利亚蹲、RDL、提踵", meta: "60 分钟" },
  { day: "周五", kind: "workout", title: "跑步机 · 间歇跑", detail: "目标坡度 5% · RPE 7", meta: "40 分钟" },
  { day: "周六", kind: "workout", title: "功能性训练", detail: "核心、活动度、稳定性", meta: "50 分钟" },
  { day: "周日", kind: "none", title: "无计划", detail: "Weekly Template 未安排内容", meta: "" },
];

const proposedWeek = [
  { day: "周一", kind: "workout", title: "有氧跑 · 轻松跑", detail: "连续时长 · RPE 3–4", meta: "45 分钟" },
  { day: "周二", kind: "workout", title: "力量训练 · 上肢", detail: "引体向上、俯卧撑、平板支撑", meta: "60 分钟" },
  { day: "周三", kind: "rest", title: "休息日", detail: "不创建训练记录", meta: "" },
  { day: "周四", kind: "workout", title: "力量训练 · 下肢", detail: "保加利亚蹲、RDL、提踵", meta: "60 分钟" },
  { day: "周五", kind: "workout", title: "跑步机 · 间歇跑", detail: "目标坡度 5% · RPE 7", meta: "40 分钟" },
  { day: "周六", kind: "workout", title: "功能性训练", detail: "核心、活动度、稳定性", meta: "50 分钟" },
  { day: "周日", kind: "rest", title: "休息日", detail: "不创建训练记录", meta: "" },
];

const validJson = JSON.stringify(
  {
    schema_version: 1,
    effective_from: "2026-08-03",
    week: {
      monday: { kind: "workout", title: "有氧跑 · 轻松跑" },
      tuesday: { kind: "workout", title: "力量训练 · 上肢" },
      wednesday: { kind: "rest" },
      thursday: { kind: "workout", title: "力量训练 · 下肢" },
      friday: { kind: "workout", title: "跑步机 · 间歇跑" },
      saturday: { kind: "workout", title: "功能性训练" },
      sunday: { kind: "rest" },
    },
  },
  null,
  2,
);

const invalidJson = `{
  "schema_version": 1,
  "effective_from": "2026-08-03",
  "week": {
    "monday": { "kind": "workout" }
  }
}`;

const state = {
  variant: getVariant(),
  mode: "plan",
  value: "",
  validation: "idle",
  expandedDay: null,
  pending: false,
};

const app = document.querySelector("#app");
const variantLabel = document.querySelector("#variant-label");
const toast = document.querySelector("#toast");

function getVariant() {
  const value = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "C";
}

function icon(name) {
  const paths = {
    today: '<path d="M5 11h14M8 3v3m8-3v3M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z"/><path d="M8 15h3v3H8z"/>',
    calendar: '<path d="M5 11h14M8 3v3m8-3v3M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z"/>',
    progress: '<path d="M5 19V9m7 10V4m7 15v-7"/>',
    plan: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
    coach: '<path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21a6 6 0 0 1 12 0m0 0a5 5 0 0 1 8 0"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a8 8 0 0 0-1.7 1L5 6.1 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function nav() {
  const items = [
    ["today", "今日"],
    ["calendar", "日历"],
    ["progress", "进展"],
    ["plan", "计划"],
    ["coach", "教练"],
  ];
  return `<nav class="app-nav" aria-label="主导航">${items
    .map(
      ([key, label]) =>
        `<button class="nav-item ${key === "plan" ? "is-active" : ""}" type="button">${icon(key)}<span>${label}</span></button>`,
    )
    .join("")}</nav>`;
}

function weekRows(week, preview = false) {
  return `<div class="${preview ? "preview-week" : "week-list"}">${week
    .map(
      (item, index) => `
        <button class="day-row is-${item.kind}" type="button" data-day="${preview ? "" : index}" ${preview ? "disabled" : ""}>
          <span class="day-name">${item.day}</span>
          <span class="day-main">
            <span class="day-title">${item.title}</span>
            <span class="day-detail">${item.detail}</span>
          </span>
          <span class="day-meta">${item.meta}</span>
          <span class="chevron">${preview || item.kind !== "workout" ? "" : "›"}</span>
        </button>
        ${
          !preview && state.expandedDay === index && item.kind === "workout"
            ? `<div class="day-expanded">这是正常计划查看状态。训练项目、组数、目标次数与休息时间会在这里展开；页面没有任何手动编辑入口。</div>`
            : ""
        }
      `,
    )
    .join("")}</div>`;
}

function header({ back = false, title = "计划", action = "" } = {}) {
  return `<header class="app-header">
    ${
      back
        ? `<button class="icon-button" type="button" data-action="back" aria-label="返回">${icon("back")}</button>`
        : `<span class="icon-button" aria-hidden="true"></span>`
    }
    <h1>${title}</h1>
    ${
      action
        ? `<button class="header-action" type="button" data-action="${action}">更新计划</button>`
        : `<button class="icon-button" type="button" aria-label="设置">${icon("settings")}</button>`
    }
  </header>`;
}

function planBase(extra = "", action = "open-update") {
  return `
    ${header()}
    <div class="content-scroll">
      <div class="section-head">
        <div><h2>本周计划</h2><p>7月27日–8月2日 · Asia/Shanghai</p></div>
        <button class="secondary-action" type="button" data-action="${action}">更新计划</button>
      </div>
      ${
        state.pending
          ? `<div class="pending-banner"><strong>新计划将于 8月3日 生效</strong><span>当前周保持不变；新的 Weekly Template 已确认。</span></div>`
          : ""
      }
      ${weekRows(currentWeek)}
      ${extra}
    </div>
    ${nav()}
  `;
}

function pasteForm({ compact = false } = {}) {
  return `
    <label class="field-label" for="json-input">粘贴 Agent 返回的 JSON</label>
    <textarea id="json-input" class="json-input" placeholder="在 ChatGPT 中复制完整 JSON，然后粘贴到这里">${escapeHtml(state.value)}</textarea>
    ${
      state.validation === "error"
        ? `<div class="validation-error">
            <strong>计划无法更新</strong>
            <p>请复制错误详情，让 Agent 返回修正后的完整计划 JSON。</p>
            <button class="danger-copy" type="button" data-action="copy-errors">复制错误详情给 Agent</button>
          </div>`
        : ""
    }
    <div class="action-row">
      ${compact ? "" : `<button class="secondary-button" type="button" data-action="cancel">取消</button>`}
      <button class="primary-button" type="button" data-action="validate">检查计划</button>
    </div>
    <button class="copy-current" type="button" data-action="copy-current">复制当前计划 JSON</button>
  `;
}

function previewBody() {
  return `
    <div class="preview-head">
      <h3>更新后的每周计划</h3>
      <p class="effective-date">8月3日（周一）</p>
      <p class="change-summary">✓ 3 个训练日发生变化</p>
    </div>
    ${weekRows(proposedWeek, true)}
  `;
}

function renderVariantA() {
  let extra = "";
  if (state.mode === "paste") {
    extra = `<section class="update-inline"><h3>更新计划</h3>${pasteForm()}</section>`;
  }
  if (state.mode === "preview") {
    extra = `<section class="update-inline">${previewBody()}<div class="action-row"><button class="secondary-button" type="button" data-action="cancel">取消</button><button class="primary-button" type="button" data-action="confirm">确认更新</button></div></section>`;
  }
  return planBase(extra);
}

function renderVariantB() {
  if (state.mode === "plan") return planBase("", "open-route");
  if (state.mode === "preview") {
    return `<div class="route-page">${header({ back: true, title: "确认更新计划" })}<div class="route-body">${previewBody()}</div><div class="sticky-actions"><button class="primary-button" type="button" data-action="confirm">确认更新</button></div></div>`;
  }
  return `<div class="route-page">${header({ back: true, title: "更新计划" })}<div class="route-body"><div class="route-title"><h2>粘贴新的计划</h2><p>JSON 由你的 Agent 生成；App 只负责检查和应用。</p></div>${pasteForm({ compact: true })}</div></div>`;
}

function renderVariantC() {
  const sheet =
    state.mode === "plan"
      ? ""
      : `<div class="overlay" data-action="cancel">
          <section class="sheet" aria-modal="true" role="dialog" onclick="event.stopPropagation()">
            <div class="sheet-handle"></div>
            <div class="sheet-head"><h3>${state.mode === "preview" ? "确认更新计划" : "更新计划"}</h3><button class="close-button" type="button" data-action="cancel" aria-label="关闭">×</button></div>
            ${state.mode === "preview" ? `${previewBody()}<div class="action-row"><button class="primary-button" type="button" data-action="confirm">确认更新</button></div>` : pasteForm({ compact: true })}
          </section>
        </div>`;
  return `${planBase("", "open-sheet")}${sheet}`;
}

function render() {
  variantLabel.textContent = `${state.variant} — ${variants[state.variant]}`;
  const content =
    state.variant === "A"
      ? renderVariantA()
      : state.variant === "B"
        ? renderVariantB()
        : renderVariantC();
  app.innerHTML = `<div class="app">${content}</div>`;
  bindEvents();
}

function bindEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action));
  });
  app.querySelectorAll("[data-day]").forEach((element) => {
    element.addEventListener("click", () => {
      const index = Number(element.dataset.day);
      state.expandedDay = state.expandedDay === index ? null : index;
      render();
    });
  });
  const input = app.querySelector("#json-input");
  if (input) {
    input.addEventListener("input", (event) => {
      state.value = event.target.value;
      state.validation = "idle";
    });
  }
}

async function handleAction(action) {
  if (["open-update", "open-route", "open-sheet"].includes(action)) {
    state.mode = "paste";
    state.validation = "idle";
    render();
    requestAnimationFrame(() => app.querySelector("#json-input")?.focus());
    return;
  }
  if (action === "cancel" || action === "back") {
    state.mode = "plan";
    state.validation = "idle";
    render();
    return;
  }
  if (action === "validate") {
    const value = app.querySelector("#json-input")?.value ?? state.value;
    state.value = value;
    const result = validate(value);
    if (result.ok) {
      state.validation = "valid";
      state.mode = "preview";
    } else {
      state.validation = "error";
    }
    render();
    return;
  }
  if (action === "confirm") {
    state.pending = true;
    state.mode = "plan";
    state.value = "";
    state.validation = "idle";
    render();
    showToast("计划已确认，将于 8月3日 生效");
    return;
  }
  if (action === "copy-current") {
    await copyText(validJson);
    showToast("当前计划 JSON 已复制");
    return;
  }
  if (action === "copy-errors") {
    await copyText(
      "Plan Update Package validation failed:\n- week.tuesday is required\n- week.wednesday is required\n- week.thursday is required\n- week.friday is required\n- week.saturday is required\n- week.sunday is required",
    );
    showToast("错误详情已复制，可直接交给 Agent");
  }
}

function validate(value) {
  if (!value.trim()) return { ok: false };
  try {
    const parsed = JSON.parse(value);
    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    return {
      ok:
        parsed.schema_version === 1 &&
        typeof parsed.effective_from === "string" &&
        parsed.week &&
        weekdays.every((day) => Object.hasOwn(parsed.week, day)),
    };
  } catch {
    return { ok: false };
  }
}

function switchVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  state.mode = "plan";
  state.validation = "idle";
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  window.history.replaceState({}, "", url);
  render();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showToast("浏览器未开放剪贴板权限");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.querySelectorAll("[data-switch]").forEach((button) => {
  button.addEventListener("click", () => switchVariant(button.dataset.switch === "next" ? 1 : -1));
});

document.querySelectorAll("[data-sample]").forEach((button) => {
  button.addEventListener("click", () => {
    state.value = button.dataset.sample === "valid" ? validJson : invalidJson;
    state.validation = "idle";
    if (state.mode === "plan") state.mode = "paste";
    render();
    showToast(button.dataset.sample === "valid" ? "已填入有效示例" : "已填入错误示例");
  });
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target.matches("input, textarea, [contenteditable]")) return;
  if (event.key === "ArrowLeft") switchVariant(-1);
  if (event.key === "ArrowRight") switchVariant(1);
});

render();
