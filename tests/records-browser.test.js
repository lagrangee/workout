// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { appFixture, today } from "./helpers.js";
import { weekdayKey } from "../src/util.js";

const [formatterSource, timelineSource, appModuleSource] = await Promise.all([
  readFile(new URL("../public/ui-formatters.js", import.meta.url), "utf8"),
  readFile(new URL("../public/workout-timeline.js", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
]);
const appSource = `${formatterSource.replace(/export\s+/g, "")}\n${timelineSource.replace(/export\s+/g, "")}\n${appModuleSource
  .replace('import { formatActivityDateTime, formatDistanceKm } from "./ui-formatters.js";\n', "")
  .replace('import { createWorkoutTimeline } from "./workout-timeline.js";\n', "")}`;

function decodeHtml(value) {
  return String(value ?? "").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attributes(source) {
  const result = {};
  const pattern = /([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) result[match[1]] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}

class Element {
  constructor(tagName, attrs, content = "") {
    this.tagName = tagName.toUpperCase();
    this.attributes = attrs;
    this.className = attrs.class ?? "";
    this.id = attrs.id ?? "";
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith("data-")).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    this.disabled = Object.hasOwn(attrs, "disabled");
    this.value = attrs.value ?? "";
    this.textContent = decodeHtml(content.replace(/<[^>]+>/g, ""));
    this.handlers = new Map();
  }
  addEventListener(type, handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]); }
  dispatchEvent(event) { const next = { preventDefault() {}, stopPropagation() {}, target: this, currentTarget: this, ...event }; for (const handler of this.handlers.get(next.type) ?? []) handler(next); return true; }
  click() { if (!this.disabled) this.dispatchEvent({ type: "click" }); }
}

function matches(element, selector) {
  if (selector.includes(",")) return selector.split(",").some((part) => matches(element, part));
  const tag = selector.match(/^[a-z]+/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  const id = selector.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;
  for (const className of selector.matchAll(/\.([\w-]+)/g)) if (!element.className.split(/\s+/).includes(className[1])) return false;
  for (const attr of selector.matchAll(/\[([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g)) {
    const name = attr[1]; const expected = attr[2] ?? attr[3] ?? attr[4]?.trim();
    if (!Object.hasOwn(element.attributes, name) || (expected != null && element.attributes[name] !== decodeHtml(expected))) return false;
  }
  return true;
}

class Root extends Element {
  constructor() { super("main", {}); this.html = ""; this.elements = []; }
  set innerHTML(value) {
    this.html = String(value);
    this.elements = [];
    const pattern = /<(button|input|textarea|form|select|option)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    let match;
    while ((match = pattern.exec(this.html))) this.elements.push(new Element(match[1], attributes(match[2]), match[3] ?? ""));
  }
  get innerHTML() { return this.html; }
  querySelectorAll(selector) { return this.elements.filter((element) => matches(element, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

async function openBrowser(handler, requests = []) {
  const root = new Root();
  const document = { hidden: false, handlers: new Map(), querySelector: (selector) => selector === "#app" ? root : root.querySelector(selector), querySelectorAll: (selector) => root.querySelectorAll(selector), addEventListener(type, handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]); } };
  const server = async (input, options = {}) => {
    const url = new URL(input, "https://workout.example");
    requests.push(`${url.pathname}${url.search}`);
    const headers = new Headers(options.headers ?? {});
    headers.set("x-athlete-email", "athlete-a@example.invalid");
    return handler.fetch(new Request(url, { ...options, headers }), { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "https://workout.example" });
  };
  const context = {
    document,
    window: { location: { hostname: "localhost" } },
    location: { hostname: "localhost" },
    localStorage: { getItem: () => null },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: server,
    setInterval: () => 1,
    clearInterval() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    console,
    Request,
    Response,
    Headers,
    FormData,
  };
  vm.createContext(context);
  new vm.Script(appSource, { filename: "public/app.js" }).runInContext(context);
  await settle();
  return { root, context };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function seededBrowser({ activities = [], routes = [], projectionStatus = activities.length ? "complete" : "none", configureState = null } = {}) {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  state.aerobic_activities = activities;
  state.routes = routes;
  state.aerobic_projection = { schema_version: 1, source_status: projectionStatus, data_as_of: "2026-08-16T23:59:00.000Z", updated_at: "2026-08-17T08:00:00.000Z", activity_count: activities.length };
  if (configureState) configureState(state);
  await store.save(state);
  const requests = [];
  return { ...(await openBrowser(handler, requests)), requests };
}

function routeRecordingSlot() {
  return {
    kind: "workout",
    title: "香山鸡腿线",
    start_time: "08:30",
    estimated_duration_min: 150,
    recording_intent: { schema_version: 1, source: "coros", sport_type: 102, route_key: "香山鸡腿线" },
    blocks: [{
      title: "越野专项",
      exercises: [{
        occurrence_key: "chicken_line_trail",
        exercise_id: "trail_run_hike",
        execution_mode: "none",
        name: "越野跑与爬升快走",
        definition_version: 1,
        sets: [{ set_id: "chicken_line_1", ordinal: 1, target: { metric: "duration_sec", value: 9000 }, resistance_mode: "bodyweight", resistance_kg: null, tempo: null, rest_after_sec: null }],
      }],
    }],
  };
}

function indoorActivity(overrides = {}) {
  return {
    schema_version: 1,
    activity_ref: "coros-indoor-1",
    source_ref: "coros:activity:coros-indoor-1",
    local_date: "2026-08-16",
    timezone: "Asia/Shanghai",
    started_at: "2026-08-16T02:00:00.000Z",
    ended_at: "2026-08-16T02:35:00.000Z",
    sport_type: 101,
    sport_name: "indoor_run",
    source_status: "partial",
    data_as_of: "2026-08-16T23:59:00.000Z",
    updated_at: "2026-08-17T08:00:00.000Z",
    summary: { duration_sec: 2100, distance_km: 5.25, average_heart_rate_bpm: 142, calories_kcal: null, sport_metrics: {} },
    route_key: null,
    route_direction: null,
    fit_status: "partial",
    ...overrides,
  };
}

function outdoorActivity(overrides = {}) {
  return {
    schema_version: 1,
    activity_ref: "coros-outdoor-1",
    source_ref: "coros:activity:coros-outdoor-1",
    local_date: "2026-08-15",
    timezone: "Asia/Shanghai",
    started_at: "2026-08-15T01:00:00.000Z",
    ended_at: "2026-08-15T03:00:00.000Z",
    sport_type: 100,
    sport_name: "run",
    source_status: "complete",
    data_as_of: "2026-08-16T23:59:00.000Z",
    updated_at: "2026-08-17T08:00:00.000Z",
    summary: { duration_sec: 7200, distance_km: 12.23, average_heart_rate_bpm: 142, calories_kcal: 820, sport_metrics: {} },
    route_key: "city-loop",
    route_direction: "reverse",
    route_match_status: "matched",
    fit_status: "complete",
    ...overrides,
  };
}

test("ticket 01 browser seam: Records aerobic tab lists partial indoor activity and opens safe detail", async () => {
  const browser = await seededBrowser({ activities: [indoorActivity()], projectionStatus: "partial" });
  const progress = browser.root.querySelector('[data-view="progress"]');
  assert.ok(progress);
  progress.click();
  await settle();
  assert.match(browser.root.innerHTML, />记录</);
  const aerobicTab = browser.root.querySelector('[data-action="records-tab"][data-tab="aerobic"]');
  assert.ok(aerobicTab);
  aerobicTab.click();
  await settle();
  assert.match(browser.root.innerHTML, /有氧/);
  assert.equal(browser.root.querySelectorAll('.records-tab').length, 3);
  assert.doesNotMatch(browser.root.innerHTML, />月份<|>运动</);
  assert.doesNotMatch(browser.root.querySelector('[data-action="aerobic-detail"]')?.textContent || "", /coros-indoor-1/);
  assert.doesNotMatch(browser.root.querySelector('[data-action="aerobic-detail"]')?.textContent || "", /平均心率/);
  assert.doesNotMatch(browser.root.innerHTML, /部分数据/);
  assert.match(browser.root.innerHTML, /室内运动/);
  assert.doesNotMatch(browser.root.innerHTML, /路线历史/);

  const activity = browser.root.querySelector('[data-action="aerobic-detail"]');
  assert.ok(activity);
  activity.click();
  await settle();
  assert.match(browser.root.innerHTML, /活动详情/);
  assert.equal(browser.root.querySelectorAll('.records-tab').length, 0);
  assert.doesNotMatch(browser.root.innerHTML, /coros-indoor-1/);
  assert.match(browser.root.innerHTML, /FIT.*partial|FIT.*部分/);
  assert.match(browser.root.innerHTML, /活动时间/);
  assert.match(browser.root.innerHTML, /室内运动 · 无路线/);
  assert.doesNotMatch(browser.root.innerHTML, /raw_fit|gps|路线历史/);
});

test("ticket 01 browser seam: empty aerobic projection has an explicit empty state", async () => {
  const browser = await seededBrowser();
  browser.root.querySelector('[data-view="progress"]').click();
  await settle();
  browser.root.querySelector('[data-action="records-tab"][data-tab="aerobic"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /还没有有氧记录/);
  assert.match(browser.root.innerHTML, /暂无有氧记录/);
});

test("ticket 04 browser seam: route browser keeps activity context and shows history", async () => {
  const browser = await seededBrowser({
    activities: [outdoorActivity()],
    routes: [{ schema_version: 1, route_key: "city-loop", route_name: "城市环线", sport_types: [100], distance_range_km: [10, 13] }],
  });
  browser.root.querySelector('[data-view="progress"]').click();
  await settle();
  browser.root.querySelector('[data-action="records-tab"][data-tab="aerobic"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /路线/);
  assert.match(browser.root.innerHTML, /city-loop/);

  browser.root.querySelector('[data-action="routes-open"]').click();
  await settle();
  assert.ok(browser.requests.some((path) => path === "/api/private/records/routes?limit=200"));
  assert.equal(browser.root.querySelectorAll('.records-tab').length, 0);
  assert.match(browser.root.innerHTML, /城市环线/);
  assert.match(browser.root.innerHTML, /route-sidebar/);
  assert.match(browser.root.innerHTML, /route-mobile-page/);

  browser.root.querySelector('[data-action="route-detail"][data-route-key="city-loop"]').click();
  await settle();
  assert.ok(browser.requests.some((path) => path === "/api/private/records/routes/city-loop?limit=200"));
  assert.equal(browser.root.querySelectorAll('.records-tab').length, 0);
  assert.match(browser.root.innerHTML, /历史活动/);
  assert.match(browser.root.innerHTML, /累计距离/);
  assert.match(browser.root.innerHTML, /2026-08-15/);

  browser.root.querySelector('[data-action="route-detail-back"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /城市环线/);
  browser.root.querySelector('[data-action="routes-close"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /coros-outdoor-1/);

  browser.root.querySelector('[data-action="aerobic-detail"]').click();
  await settle();
  assert.equal(browser.root.querySelectorAll('.records-tab').length, 0);
  assert.doesNotMatch(browser.root.innerHTML, /路线：|查看路线历史/);
  assert.ok(browser.root.querySelector('[data-action="route-detail"][data-route-key="city-loop"]'));
  browser.root.querySelector('[data-action="route-detail"][data-route-key="city-loop"]').click();
  await settle();
  browser.root.querySelector('[data-action="route-detail-back"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /活动详情/);
  assert.doesNotMatch(browser.root.innerHTML, /城市环线.*历史活动/);
});

test("ticket 03 browser seam: Records opens the source-separated overview", async () => {
  const browser = await seededBrowser({ activities: [indoorActivity()] });
  browser.root.querySelector('[data-view="progress"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /总览/);
  assert.equal(browser.root.querySelectorAll('.records-tab').length, 3);
  assert.ok(browser.root.querySelector('.records-overview-metric[data-action="records-tab"][data-tab="strength"]'));
  assert.ok(browser.root.querySelector('.records-overview-metric[data-action="records-tab"][data-tab="aerobic"]'));
  assert.doesNotMatch(browser.root.innerHTML, /Workout source|COROS source|不会因为 local date 相同而被判定为同一训练事件/);

  browser.root.querySelector('.records-overview-metric[data-action="records-tab"][data-tab="strength"]').click();
  await settle();
  assert.equal(browser.root.querySelectorAll('.records-tab').length, 3);
  assert.doesNotMatch(browser.root.innerHTML, /12 个到期训练|只计已结束区间|按日期计一次/);
});

test("ticket 03 browser seam: Calendar shows a compact aerobic summary and links into the date-filtered Records list", async () => {
  const targetDate = today;
  const browser = await seededBrowser({ activities: [indoorActivity({
    local_date: targetDate,
    started_at: `${targetDate}T02:00:00.000Z`,
    ended_at: `${targetDate}T02:35:00.000Z`,
  })] });
  browser.root.querySelector('[data-view="calendar"]').click();
  await settle();
  const day = browser.root.querySelector(`[data-action="calendar-select"][data-date="${targetDate}"]`);
  assert.ok(day);
  day.click();
  await settle();
  assert.equal(browser.requests.filter((path) => path.startsWith("/api/private/records/aerobic?")).length, 0);
  assert.match(browser.root.innerHTML, /有氧摘要/);
  assert.match(browser.root.innerHTML, /查看有氧记录/);
  assert.doesNotMatch(browser.root.innerHTML, /coros-indoor-1/);
  browser.root.querySelector('[data-action="open-aerobic-date"]').click();
  await settle();
  assert.equal(browser.requests.filter((path) => path.startsWith("/api/private/records/aerobic?")).length, 1);
  assert.match(browser.root.innerHTML, /coros-indoor-1/);
  assert.match(browser.root.innerHTML, new RegExp(`日期：${targetDate}`));
});

test("prescriptions align each Chinese execution mode with its Exercise heading", async () => {
  const browser = await seededBrowser();
  assert.match(browser.root.innerHTML, /class="prescription-exercise-head"><strong>[^<]+<\/strong><span class="prescription-execution">不分左右<\/span>/);
  assert.match(browser.root.innerHTML, /class="prescription-exercise-head"><strong>[^<]+<\/strong><span class="prescription-execution">左右分别完成<\/span>/);
  assert.doesNotMatch(browser.root.innerHTML, /执行方式：/);
});

test("COROS route plan keeps one compact status row and removes duplicate route prescription content", async () => {
  const matched = outdoorActivity({
    activity_ref: "coros-chicken-line",
    source_ref: "coros:activity:coros-chicken-line",
    local_date: today,
    started_at: `${today}T01:00:00.000Z`,
    ended_at: `${today}T03:00:00.000Z`,
    sport_type: 102,
    sport_name: "trail_run",
    route_key: "香山鸡腿线",
    route_direction: "forward",
    route_match_status: "matched",
  });
  const browser = await seededBrowser({
    activities: [matched],
    configureState(state) { state.plan_revisions.at(-1).week[weekdayKey(today)] = routeRecordingSlot(); },
  });

  assert.match(browser.root.innerHTML, /COROS 记录/);
  assert.match(browser.root.innerHTML, /已记录/);
  assert.doesNotMatch(browser.root.innerHTML, /COROS · ROUTE RECORDING/);
  assert.doesNotMatch(browser.root.innerHTML, /路线：香山鸡腿线/);
  assert.doesNotMatch(browser.root.innerHTML, /不需要在 Workout 页面重复记录/);
  assert.doesNotMatch(browser.root.innerHTML, /今日训练计划/);
  assert.equal(browser.root.querySelector('[data-action="start"]'), null);
  assert.equal(browser.root.querySelector('[data-action="skip"]'), null);

  browser.root.querySelector('[data-view="calendar"]').click();
  await settle();
  const day = browser.root.querySelector(`[data-action="calendar-select"][data-date="${today}"]`);
  assert.ok(day);
  day.click();
  await settle();
  assert.equal(browser.root.querySelector(".calendar-detail-head .eyebrow"), null);
  assert.equal(browser.root.querySelector(".calendar-detail .calendar-prescription"), null);
  assert.match(browser.root.innerHTML, /class="calendar-recording-guide is-recorded"[^>]*><strong>COROS 记录<\/strong>/);
});
