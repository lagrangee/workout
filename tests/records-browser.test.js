// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { appFixture } from "./helpers.js";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

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

async function openBrowser(handler) {
  const root = new Root();
  const document = { hidden: false, handlers: new Map(), querySelector: (selector) => selector === "#app" ? root : root.querySelector(selector), querySelectorAll: (selector) => root.querySelectorAll(selector), addEventListener(type, handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]); } };
  const server = async (input, options = {}) => {
    const url = new URL(input, "https://workout.example");
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

async function seededBrowser({ activities = [], projectionStatus = activities.length ? "complete" : "none" } = {}) {
  const { handler, store } = appFixture();
  const state = await store.getByEmail("athlete-a@example.invalid");
  state.aerobic_activities = activities;
  state.aerobic_projection = { schema_version: 1, source_status: projectionStatus, data_as_of: "2026-08-16T23:59:00.000Z", updated_at: "2026-08-17T08:00:00.000Z", activity_count: activities.length };
  await store.save(state);
  return openBrowser(handler);
}

function indoorActivity() {
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
  assert.match(browser.root.innerHTML, /coros-indoor-1/);
  assert.match(browser.root.innerHTML, /部分数据/);
  assert.match(browser.root.innerHTML, /室内运动/);
  assert.match(browser.root.innerHTML, /无路线/);
  assert.doesNotMatch(browser.root.innerHTML, /路线历史/);

  const activity = browser.root.querySelector('[data-action="aerobic-detail"]');
  assert.ok(activity);
  activity.click();
  await settle();
  assert.match(browser.root.innerHTML, /活动详情/);
  assert.match(browser.root.innerHTML, /coros-indoor-1/);
  assert.match(browser.root.innerHTML, /FIT.*partial|FIT.*部分/);
  assert.doesNotMatch(browser.root.innerHTML, /raw_fit|gps|路线历史/);
});

test("ticket 01 browser seam: empty aerobic projection has an explicit empty state", async () => {
  const browser = await seededBrowser();
  browser.root.querySelector('[data-view="progress"]').click();
  await settle();
  browser.root.querySelector('[data-action="records-tab"][data-tab="aerobic"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /还没有有氧记录/);
  assert.match(browser.root.innerHTML, /暂无 COROS aerobic activity/);
});
