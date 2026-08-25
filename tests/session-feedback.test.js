// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { appFixture, call, json, post, today } from "./helpers.js";
import { addDays, weekdayKey } from "../src/util.js";
import { createSession } from "../src/session.js";

const [formatterSource, timelineSource, appModuleSource] = await Promise.all([
  readFile(new URL("../public/ui-formatters.js", import.meta.url), "utf8"),
  readFile(new URL("../public/workout-timeline.js", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
]);
const appSource = `${formatterSource.replace(/export\s+/g, "")}\n${timelineSource.replace(/export\s+/g, "")}\n${appModuleSource
  .replace('import { formatActivityDateTime, formatDistanceKm } from "./ui-formatters.js";\n', "")
  .replace('import { createWorkoutTimeline } from "./workout-timeline.js";\n', "")}`;

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readAttributes(source) {
  const attributes = {};
  const pattern = /([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) attributes[match[1]] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return attributes;
}

class FakeElement {
  constructor(tagName, attributes, content = "") {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.className = attributes.class ?? "";
    this.id = attributes.id ?? "";
    this.dataset = Object.fromEntries(Object.entries(attributes)
      .filter(([name]) => name.startsWith("data-"))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    this.disabled = Object.hasOwn(attributes, "disabled");
    this.value = this.tagName === "TEXTAREA" ? decodeHtml(content.replace(/<[^>]+>/g, "")) : attributes.value ?? "";
    this.textContent = decodeHtml(content.replace(/<[^>]+>/g, ""));
    this.handlers = new Map();
  }

  addEventListener(type, handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  dispatchEvent(event) {
    const nextEvent = {
      preventDefault() {},
      stopPropagation() {},
      target: this,
      currentTarget: this,
      ...event,
    };
    for (const handler of this.handlers.get(nextEvent.type) ?? []) handler(nextEvent);
    return true;
  }

  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: "click" });
  }
}

function parseElements(html) {
  const elements = [];
  const interactivePattern = /<(button|input|textarea|form|select|option)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  const displayPattern = /<(div|span|section|header|footer|strong|small)\b([^>]*?)(?:\/>|>([^<]*?)<\/\1>)/gi;
  for (const pattern of [interactivePattern, displayPattern]) {
    let match;
    while ((match = pattern.exec(html))) elements.push(new FakeElement(match[1], readAttributes(match[2]), match[3] ?? ""));
  }
  return elements;
}

function matchesSelector(element, selector) {
  const normalized = selector.trim();
  if (!normalized) return false;
  if (normalized.includes(",")) return normalized.split(",").some((part) => matchesSelector(element, part));
  const tag = normalized.match(/^[a-z]+/i)?.[0];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  const id = normalized.match(/#([\w-]+)/)?.[1];
  if (id && element.id !== id) return false;
  for (const className of normalized.matchAll(/\.([\w-]+)/g)) {
    if (!element.className.split(/\s+/).includes(className[1])) return false;
  }
  for (const attribute of normalized.matchAll(/\[([:\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g)) {
    const name = attribute[1];
    const expected = attribute[2] ?? attribute[3] ?? attribute[4]?.trim();
    if (!Object.hasOwn(element.attributes, name)) return false;
    if (expected != null && element.attributes[name] !== decodeHtml(expected)) return false;
  }
  return true;
}

class FakeRoot extends FakeElement {
  constructor() {
    super("main", {});
    this.html = "";
    this.elements = [];
  }

  set innerHTML(value) {
    this.html = String(value);
    this.elements = parseElements(this.html);
  }

  get innerHTML() {
    return this.html;
  }

  querySelectorAll(selector) {
    return this.elements.filter((element) => matchesSelector(element, selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function responseError(message, status = 503) {
  return new Response(JSON.stringify({ error: { code: "temporary_failure", message, details: [] } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deterministicClock() {
  let current = Date.now();
  let nextIntervalId = 0;
  let nextFrameId = 0;
  const intervals = new Map();
  const frames = new Map();
  const advanceHandlers = new Set();
  return {
    now: () => current,
    setInterval(callback) {
      const id = ++nextIntervalId;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    requestAnimationFrame(callback) {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    onAdvance(handler) { advanceHandlers.add(handler); },
    advance(milliseconds) {
      current += milliseconds;
      for (const handler of advanceHandlers) handler(current);
      const pendingFrames = [...frames.values()];
      frames.clear();
      for (const callback of pendingFrames) callback(current);
      for (const callback of intervals.values()) callback();
    },
  };
}

function wakeLockHarness({ reject = false } = {}) {
  const requests = [];
  const sentinels = [];
  const wakeLock = {
    request: async (type) => {
      requests.push(type);
      if (reject) throw new Error("屏幕保持请求被拒绝");
      const listeners = [];
      const sentinel = {
        released: false,
        addEventListener(type, listener) {
          if (type === "release") listeners.push(listener);
        },
        async release() {
          sentinel.released = true;
          for (const listener of listeners) listener();
        },
        releaseFromPlatform() {
          sentinel.released = true;
          for (const listener of listeners) listener();
        },
      };
      sentinels.push(sentinel);
      return sentinel;
    },
  };
  return { wakeLock, requests, sentinels };
}

async function openBrowser(handler, intercept = async () => null, options = {}) {
  const root = new FakeRoot();
  const calls = [];
  const origin = "https://workout.example";
  const server = async (path, options = {}) => {
    const requestHeaders = new Headers(options.headers ?? {});
    requestHeaders.set("x-athlete-email", "athlete-a@example.invalid");
    const request = new Request(new URL(path, origin), { ...options, headers: requestHeaders });
    return handler.fetch(request, { LOCAL_AUTH: "true", PUBLIC_ORIGIN: origin });
  };
  const fetchImpl = async (input, options = {}) => {
    const path = new URL(input, origin).pathname + new URL(input, origin).search;
    const method = (options.method ?? "GET").toUpperCase();
    calls.push({ path, method, options });
    const intercepted = await intercept({ path, method, options, server: () => server(path, options), calls });
    return intercepted ?? server(path, options);
  };
  const document = {
    hidden: false,
    handlers: new Map(),
    querySelector: (selector) => selector === "#app" ? root : root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    addEventListener(type, handler) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    },
    dispatchEvent(event) {
      for (const handler of this.handlers.get(event.type) ?? []) handler(event);
    },
  };
  const localStorage = { getItem: () => null };
  const navigator = { clipboard: { writeText: async () => {} }, ...(options.wakeLock ? { wakeLock: options.wakeLock } : {}) };
  const clock = options.clock ?? null;
  const audioEvents = options.audioEvents ?? [];
  let scheduledAudioEvents = [];
  const flushScheduledAudio = () => {
    const due = scheduledAudioEvents.filter((event) => event.atMs <= clock.now());
    scheduledAudioEvents = scheduledAudioEvents.filter((event) => event.atMs > clock.now());
    for (const event of due) audioEvents.push({ type: "cue", kind: event.kind, value: event.value, at: event.atMs });
  };
  const defaultAudio = clock ? {
    prepare: () => ({ ok: true }),
    activate: () => { audioEvents.push({ type: "activate" }); return { ok: true }; },
    replace: (events) => {
      scheduledAudioEvents = [...events];
      flushScheduledAudio();
      return { ok: true };
    },
    cancel: () => { scheduledAudioEvents = []; },
  } : null;
  if (clock && !options.audio) clock.onAdvance(flushScheduledAudio);
  const testSeams = clock ? {
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    requestAnimationFrame: clock.requestAnimationFrame,
    cancelAnimationFrame: clock.cancelAnimationFrame,
    audio: options.audio ?? defaultAudio,
  } : null;
  let intervalId = 0;
  let frameId = 0;
  const context = {
    document,
    window: { location: { hostname: "localhost" }, ...(testSeams ? { __workoutTestSeams: testSeams } : {}) },
    location: { hostname: "localhost" },
    localStorage,
    navigator,
    fetch: fetchImpl,
    setInterval: () => ++intervalId,
    clearInterval: () => {},
    requestAnimationFrame: testSeams?.requestAnimationFrame ?? (() => ++frameId),
    cancelAnimationFrame: testSeams?.cancelAnimationFrame ?? (() => {}),
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
  return { root, calls, server, context };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function seedPartialSession(handler) {
  const started = await call(handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "seed-partial-start"));
  const detail = await call(handler, `/api/private/sessions/${started.body.session_key}`);
  const item = detail.body.snapshot.completion_items[0];
  const completedAt = new Date().toISOString();
  const record = {
    record_schema_version: 1,
    completion_results: [{ completion_item_key: item.completion_item_key, completed: true, actual: { metric: item.target.metric, value: item.target.min }, resistance: item.resistance, rir: null, completed_at: completedAt }],
    training_intervals: detail.body.training_intervals,
    session_rpe: null,
    note: null,
    exercise_feedback: [],
    skip_reason: null,
  };
  await call(handler, `/api/private/sessions/${started.body.session_key}/record`, json({ method: "PUT" }, record));
  const endedAt = new Date(Date.now() + 5000).toISOString();
  const endedRecord = { ...record, training_intervals: record.training_intervals.map((interval) => ({ ...interval, ended_at: endedAt })) };
  await call(handler, `/api/private/sessions/${started.body.session_key}/end`, post({ record: endedRecord, ended_at: endedAt }, "seed-partial-end"));
  return started.body.session_key;
}

async function seedCanonicalPallofPlan(fixture, resistanceKg = null) {
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  state.plan_revisions.at(-1).week[weekdayKey(today)] = {
    kind: "workout",
    title: "核心稳定",
    start_time: "08:00",
    estimated_duration_min: 15,
    blocks: [{
      title: "核心",
      exercises: [{
        occurrence_key: "pallof_press_main",
        exercise_id: "pallof_press",
        execution_mode: "per_side",
        name: "Pallof Press",
        definition_version: 1,
        sets: [{
          set_id: "pallof_press_set_1",
          ordinal: 1,
          target: { metric: "reps", value: 10 },
          resistance_mode: "external_load",
          resistance_kg: resistanceKg,
          tempo: "0-0-0-1",
          rest_after_sec: 30,
        }],
      }],
    }],
  };
  await fixture.store.save(state);
}

async function seedCanonicalPartialSession(fixture) {
  await seedCanonicalPallofPlan(fixture, 10);
  const started = await call(fixture.handler, `/api/private/scheduled-workouts/${today}/start`, post({}, "seed-canonical-partial-start"));
  const detail = await call(fixture.handler, `/api/private/sessions/${started.body.session_key}`);
  const item = detail.body.snapshot.completion_items[0];
  const completedAt = new Date().toISOString();
  const record = {
    record_schema_version: 2,
    set_results: [{ completion_item_key: item.completion_item_key, status: "completed", actual: { metric: item.target.metric, value: item.target.value }, resistance: { mode: "external_load", value: 10, unit: "kg" }, rir: null, note: null, completed_at: completedAt }],
    training_intervals: detail.body.training_intervals,
    session_rpe: null,
    note: null,
    exercise_feedback: [],
    skip_reason: null,
  };
  await call(fixture.handler, `/api/private/sessions/${started.body.session_key}/record`, json({ method: "PUT" }, record));
  const endedAt = new Date(Date.now() + 5000).toISOString();
  const endedRecord = { ...record, training_intervals: record.training_intervals.map((interval) => ({ ...interval, ended_at: endedAt })) };
  await call(fixture.handler, `/api/private/sessions/${started.body.session_key}/end`, post({ record: endedRecord, ended_at: endedAt }, "seed-canonical-partial-end"));
  return started.body.session_key;
}

async function seedExpiredCalendarSession(store) {
  const state = await store.getByEmail("athlete-a@example.invalid");
  const scheduledDate = addDays(today, -7);
  const startedAt = new Date(`${scheduledDate}T02:00:00.000Z`);
  const created = createSession(state, scheduledDate, startedAt, "start");
  assert.ok(created.session);
  created.session.updated_at = startedAt.toISOString();
  await store.save(state);
  return scheduledDate;
}

test("browser seam: start shows pending, deduplicates taps, and consumes the mutation Session", async () => {
  const { handler } = appFixture();
  let releaseStart;
  const browser = await openBrowser(handler, async ({ path, server }) => {
    if (path === `/api/private/scheduled-workouts/${today}/start`) return new Promise((resolve) => { releaseStart = () => server().then(resolve); });
    return null;
  });
  const start = browser.root.querySelector('[data-action="start"]');
  assert.ok(start);
  start.click();
  assert.equal(browser.root.querySelector('[data-action="start"]').disabled, true);
  assert.match(browser.root.innerHTML, /正在开始训练/);
  start.click();
  assert.equal(browser.calls.filter((request) => request.path.endsWith(`/scheduled-workouts/${today}/start`)).length, 1);
  await releaseStart();
  await settle();
  assert.match(browser.root.innerHTML, /高脚杯深蹲/);
  assert.equal(browser.root.querySelector(".focus-execution-mode").textContent, "不分左右");
  browser.root.querySelector('[data-action="next"]').click();
  browser.root.querySelector('[data-action="next"]').click();
  assert.equal(browser.root.querySelector(".focus-execution-mode").textContent, "左右分别完成");
  assert.equal(browser.calls.filter((request) => request.method === "GET" && request.path.startsWith("/api/private/sessions/")).length, 0);
});

test("browser seam: focus shows the prescribed tempo", async () => {
  const fixture = appFixture();
  const state = await fixture.store.getByEmail("athlete-a@example.invalid");
  state.plan_revisions.at(-1).week[weekdayKey(today)].blocks[0].exercises[0].sets[0].tempo = "0-1-3-1";
  await fixture.store.save(state);
  const browser = await openBrowser(fixture.handler, async () => null);

  browser.root.querySelector('[data-action="start"]').click();
  await settle();

  assert.match(browser.root.innerHTML, /节奏 0-1-3-1/);
});

test("browser seam: terminal correction can change legacy actual weight", async () => {
  const fixture = appFixture();
  const sessionKey = await seedPartialSession(fixture.handler);
  const detail = await call(fixture.handler, `/api/private/sessions/${sessionKey}`);
  const itemKey = detail.body.snapshot.completion_items[0].completion_item_key;
  const browser = await openBrowser(fixture.handler, async () => null);

  browser.root.querySelector('[data-action="edit-session"]').click();
  const weight = browser.root.querySelector(`#correction-weight-${itemKey}`);
  assert.ok(weight);
  assert.equal(weight.value, "12");
  weight.value = "15";
  browser.root.querySelector('[data-action="save-correction"]').click();
  await settle();

  const recordRequest = browser.calls.find((request) => request.path.endsWith("/record"));
  assert.ok(recordRequest);
  const body = JSON.parse(recordRequest.options.body);
  assert.equal(body.completion_results[0].resistance.load_kg, 15);
});

test("browser seam: terminal correction can change canonical actual weight", async () => {
  const fixture = appFixture();
  const sessionKey = await seedCanonicalPartialSession(fixture);
  const detail = await call(fixture.handler, `/api/private/sessions/${sessionKey}`);
  const itemKey = detail.body.snapshot.completion_items[0].completion_item_key;
  const browser = await openBrowser(fixture.handler, async () => null);

  browser.root.querySelector('[data-action="edit-session"]').click();
  const weight = browser.root.querySelector(`#correction-weight-${itemKey}`);
  assert.ok(weight);
  assert.equal(weight.value, "10");
  weight.value = "15";
  browser.root.querySelector('[data-action="save-correction"]').click();
  await settle();

  const recordRequest = browser.calls.find((request) => request.path.endsWith("/record"));
  assert.ok(recordRequest);
  const body = JSON.parse(recordRequest.options.body);
  assert.deepEqual(body.set_results[0].resistance, { mode: "external_load", value: 15, unit: "kg" });
});

test("browser seam: continue and restart share pending behavior and avoid a follow-up Session read", async () => {
  const continueFixture = appFixture();
  const continueSessionKey = await seedPartialSession(continueFixture.handler);
  let releaseContinue;
  const continuing = await openBrowser(continueFixture.handler, async ({ path, server }) => {
    if (path === `/api/private/sessions/${continueSessionKey}/continue`) return new Promise((resolve) => { releaseContinue = () => server().then(resolve); });
    return null;
  });
  const detailReadsBeforeContinue = continuing.calls.filter((request) => request.method === "GET" && request.path === `/api/private/sessions/${continueSessionKey}`).length;
  continuing.root.querySelector('[data-action="continue"]').click();
  assert.equal(continuing.root.querySelector('[data-action="continue"]').disabled, true);
  assert.match(continuing.root.innerHTML, /正在继续训练/);
  await releaseContinue();
  await settle();
  assert.match(continuing.root.innerHTML, /高脚杯深蹲/);
  assert.equal(continuing.calls.filter((request) => request.method === "GET" && request.path === `/api/private/sessions/${continueSessionKey}`).length, detailReadsBeforeContinue);

  const restartFixture = appFixture();
  const skipped = await call(restartFixture.handler, `/api/private/scheduled-workouts/${today}/skip`, post({ skip_reason: null }, "seed-restart"));
  let releaseRestart;
  const restarting = await openBrowser(restartFixture.handler, async ({ path, server }) => {
    if (path === `/api/private/sessions/${skipped.body.session_key}/restart`) return new Promise((resolve) => { releaseRestart = () => server().then(resolve); });
    return null;
  });
  const detailReadsBeforeRestart = restarting.calls.filter((request) => request.method === "GET" && request.path === `/api/private/sessions/${skipped.body.session_key}`).length;
  restarting.root.querySelector('[data-action="restart"]').click();
  assert.equal(restarting.root.querySelector('[data-action="restart"]').disabled, true);
  assert.match(restarting.root.innerHTML, /正在重新开始训练/);
  await releaseRestart();
  await settle();
  assert.match(restarting.root.innerHTML, /高脚杯深蹲/);
  assert.equal(restarting.calls.filter((request) => request.method === "GET" && request.path === `/api/private/sessions/${skipped.body.session_key}`).length, detailReadsBeforeRestart);
});

test("browser seam: failed Completion Item save is retryable and retains actual value and feedback", async () => {
  const { handler } = appFixture();
  let startResponse;
  const recordBodies = [];
  const browser = await openBrowser(handler, async ({ path, options, server }) => {
    if (path === `/api/private/scheduled-workouts/${today}/start`) {
      startResponse = server();
      return startResponse;
    }
    if (path.endsWith("/record")) {
      recordBodies.push(JSON.parse(options.body));
      if (recordBodies.length === 1) return responseError("保存暂时失败，请重试");
      return server();
    }
    return null;
  });
  browser.root.querySelector('[data-action="start"]').click();
  await startResponse;
  await settle();
  browser.root.querySelector('[data-action="toggle-adjust"]').click();
  const actual = browser.root.querySelector("#actual-value");
  const feedback = browser.root.querySelector(".focus-feedback-input");
  actual.value = "11";
  actual.dispatchEvent({ type: "input" });
  feedback.value = "动作很稳";
  feedback.dispatchEvent({ type: "input" });
  const save = browser.root.querySelector('[data-action="save-adjust"]');
  save.click();
  assert.equal(browser.root.querySelector('[data-action="save-adjust"]').disabled, true);
  assert.match(browser.root.innerHTML, /正在保存/);
  save.click();
  await settle();
  assert.match(browser.root.innerHTML, /保存暂时失败，请重试/);
  assert.equal(browser.root.querySelector("#actual-value").value, "11");
  assert.equal(browser.root.querySelector(".focus-feedback-input").value, "动作很稳");
  assert.equal(browser.root.querySelector('[data-action="save-adjust"]').disabled, false);
  browser.root.querySelector('[data-action="save-adjust"]').click();
  await settle();
  assert.equal(recordBodies[1].completion_results[0].actual.value, 11);
  assert.equal(recordBodies[1].exercise_feedback[0].text, "动作很稳");
  assert.match(browser.root.innerHTML, /1 \/ 4 完成/);
  assert.match(browser.root.innerHTML, /组间休息/);
  assert.equal(browser.calls.filter((request) => request.method === "GET" && request.path.startsWith("/api/private/sessions/")).length, 0);
});

test("browser seam: canonical external-load action with unspecified load sends nullable resistance", async () => {
  const fixture = appFixture();
  await seedCanonicalPallofPlan(fixture);
  const browser = await openBrowser(fixture.handler, async () => null);

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="complete"]').click();
  await settle();

  const recordRequest = browser.calls.find((request) => request.path.endsWith("/record"));
  assert.ok(recordRequest);
  const body = JSON.parse(recordRequest.options.body);
  assert.equal(body.record_schema_version, 2);
  assert.equal(body.set_results[0].resistance, null);

  const saved = await fixture.store.getByEmail("athlete-a@example.invalid");
  assert.equal(saved.sessions[0].set_results.length, 1);
  assert.equal(saved.sessions[0].set_results[0].resistance_mode, null);
  assert.match(browser.root.innerHTML, /1 \/ 2 完成/);
});

test("browser seam: failed start restores a retryable Today control", async () => {
  const { handler } = appFixture();
  let attempts = 0;
  const browser = await openBrowser(handler, async ({ path, server }) => {
    if (path === `/api/private/scheduled-workouts/${today}/start` && attempts++ === 0) return responseError("开始暂时失败，请重试");
    return null;
  });
  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /开始暂时失败，请重试/);
  assert.equal(browser.root.querySelector('[data-action="start"]').disabled, false);
  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /高脚杯深蹲/);
});

test("browser seam: manual completion enters restrained rest, announces its end, and advances focus", async () => {
  const fixture = appFixture();
  fixture.store.athletes.get("athlete-a@example.invalid").plan_revisions.at(-1).week[weekdayKey(today)].blocks[0].exercises[0].sets[0].rest_after_sec = 6;
  const clock = deterministicClock();
  const audioEvents = [];
  const browser = await openBrowser(fixture.handler, async () => null, { clock, audioEvents });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  assert.equal(browser.root.querySelector('[data-action="toggle-mute"]').attributes["aria-pressed"], "false");
  browser.root.querySelector('[data-action="complete"]').click();
  await settle();

  assert.match(browser.root.innerHTML, /组间休息/);
  assert.equal(audioEvents.filter((event) => event.type === "activate").length, 1);
  assert.equal(browser.root.querySelector('[data-rest-remaining]').textContent, "00:06");
  assert.equal(browser.root.querySelector('[data-action="skip-rest"]').disabled, false);

  clock.advance(1000);
  clock.advance(1000);
  clock.advance(1000);
  clock.advance(1000);
  clock.advance(1000);
  assert.deepEqual(audioEvents.filter((event) => event.type === "cue").map((event) => [event.kind, event.value]), [
    ["rest-final", 5],
    ["rest-final", 4],
    ["rest-final", 3],
    ["rest-final", 2],
    ["rest-final", 1],
  ]);
  clock.advance(1000);

  assert.equal(audioEvents.at(-1).kind, "rest-complete");
  assert.doesNotMatch(browser.root.innerHTML, /组间休息/);
  assert.match(browser.root.innerHTML, /第 2 组/);
});

test("browser seam: leaving execution closes the active interval and resume excludes hidden time", async () => {
  const fixture = appFixture();
  const clock = deterministicClock();
  const browser = await openBrowser(fixture.handler, async () => null, { clock });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  const started = await fixture.store.getByEmail("athlete-a@example.invalid");
  const sessionKey = started.sessions[0].session_key;
  const elapsedBeforeExit = browser.root.querySelector("[data-session-elapsed]").textContent;

  browser.context.document.hidden = true;
  browser.context.document.dispatchEvent({ type: "pagehide" });
  await settle();

  const paused = await fixture.store.getByEmail("athlete-a@example.invalid");
  const pausedSession = paused.sessions.find((session) => session.session_key === sessionKey);
  assert.ok(pausedSession.training_intervals[0].ended_at);
  const pausedDetail = await call(fixture.handler, `/api/private/sessions/${sessionKey}`);
  assert.ok(pausedDetail.body.training_duration_sec < 60);
  const pauseRequest = browser.calls.find((request) => request.path === `/api/private/sessions/${sessionKey}/pause`);
  assert.ok(pauseRequest);
  const pauseBody = JSON.parse(pauseRequest.options.body);
  assert.ok(!Object.hasOwn(pauseBody, "close_at") || typeof pauseBody.close_at === "string");
  clock.advance(60_000);
  assert.equal(browser.root.querySelector("[data-session-elapsed]").textContent, elapsedBeforeExit);

  const reopened = await openBrowser(fixture.handler, async () => null, { clock });
  reopened.root.querySelector('[data-action="open-session"]').click();
  await settle();
  assert.equal(reopened.root.querySelector('[data-action="toggle-timer"]').textContent, "继续");
  assert.match(reopened.root.innerHTML, /点击顶部“继续”/);

  reopened.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  const resumed = await fixture.store.getByEmail("athlete-a@example.invalid");
  const resumedSession = resumed.sessions.find((session) => session.session_key === sessionKey);
  assert.equal(resumedSession.training_intervals.at(-1).ended_at, null);
  assert.ok(reopened.calls.some((request) => request.path === `/api/private/sessions/${sessionKey}/resume`));
  const elapsedAfterResume = reopened.root.querySelector("[data-session-elapsed]").textContent;
  clock.advance(2000);
  assert.notEqual(reopened.root.querySelector("[data-session-elapsed]").textContent, elapsedAfterResume);
});

test("browser seam: returning to Today pauses the server interval before navigation completes", async () => {
  const fixture = appFixture();
  const browser = await openBrowser(fixture.handler, async () => null);

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  const started = await fixture.store.getByEmail("athlete-a@example.invalid");
  const sessionKey = started.sessions[0].session_key;
  browser.root.querySelector('[data-action="minimize"]').click();
  await settle();

  const stateAfterNavigation = await fixture.store.getByEmail("athlete-a@example.invalid");
  const sessionAfterNavigation = stateAfterNavigation.sessions.find((session) => session.session_key === sessionKey);
  assert.ok(sessionAfterNavigation.training_intervals[0].ended_at);
  assert.ok(browser.root.querySelector('[data-view="calendar"]'));
  assert.equal(browser.root.querySelector('[data-session-elapsed]'), null);
});

test("browser seam: rest can be skipped to the next focus item", async () => {
  const fixture = appFixture();
  fixture.store.athletes.get("athlete-a@example.invalid").plan_revisions.at(-1).week[weekdayKey(today)].blocks[0].exercises[0].sets[0].rest_after_sec = 60;
  const clock = deterministicClock();
  const browser = await openBrowser(fixture.handler, async () => null, { clock });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="complete"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /组间休息/);

  browser.root.querySelector('[data-action="skip-rest"]').click();

  assert.doesNotMatch(browser.root.innerHTML, /组间休息/);
  assert.match(browser.root.innerHTML, /第 2 组/);
});

test("browser seam: mute suppresses action and rest cues without changing the saved actual value", async () => {
  const fixture = timedAppFixture();
  fixture.store.athletes.get("athlete-a@example.invalid").plan_revisions.at(-1).week[weekdayKey(today)].blocks[0].exercises[0].sets[0].rest_after_sec = 3;
  const clock = deterministicClock();
  const audioEvents = [];
  const browser = await openBrowser(fixture.handler, async () => null, { clock, audioEvents });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="toggle-mute"]').click();
  assert.equal(browser.root.querySelector('[data-action="toggle-mute"]').attributes["aria-pressed"], "true");
  browser.root.querySelector('[data-action="start-timed"]').click();

  clock.advance(5000);
  clock.advance(1000);
  clock.advance(1000);
  clock.advance(1000);
  clock.advance(1000);
  clock.advance(1000);
  assert.deepEqual(audioEvents.filter((event) => event.type === "cue"), []);

  const actual = browser.root.querySelector("#actual-value");
  actual.value = "4";
  actual.dispatchEvent({ type: "input" });
  browser.root.querySelector('[data-action="complete"]').click();
  await settle();

  const recordRequest = browser.calls.find((request) => request.path.endsWith("/record"));
  assert.equal(JSON.parse(recordRequest.options.body).completion_results[0].actual.value, 4);
  assert.match(browser.root.innerHTML, /组间休息/);
  assert.equal(browser.root.querySelector('[data-action="toggle-mute"]').attributes["aria-pressed"], "true");
  const cueCountAfterSave = audioEvents.filter((event) => event.type === "cue").length;
  clock.advance(3000);
  assert.equal(audioEvents.filter((event) => event.type === "cue").length, cueCountAfterSave);
});

test("browser seam: visibility loss pauses timed execution and foreground recovery waits for manual continue", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const audioEvents = [];
  const wakeLock = wakeLockHarness();
  const browser = await openBrowser(handler, async () => null, { clock, audioEvents, wakeLock: wakeLock.wakeLock });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  assert.deepEqual(wakeLock.requests, ["screen"]);

  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();
  clock.advance(5000);
  const remainingBeforeHidden = browser.root.querySelector('[data-action-remaining]').textContent;
  const sessionElapsedBeforeHidden = browser.root.querySelector("[data-session-elapsed]").textContent;

  browser.context.document.hidden = true;
  browser.context.document.dispatchEvent({ type: "visibilitychange" });
  assert.match(browser.root.innerHTML, /页面已离开前台，计时已暂停/);
  assert.equal(browser.root.querySelector('[data-action="toggle-timer"]').textContent, "继续");
  clock.advance(2000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, remainingBeforeHidden);
  assert.equal(browser.root.querySelector("[data-session-elapsed]").textContent, sessionElapsedBeforeHidden);
  assert.equal(audioEvents.filter((event) => event.type === "cue").length, 6);

  browser.context.document.hidden = false;
  browser.context.document.dispatchEvent({ type: "visibilitychange" });
  await settle();
  assert.deepEqual(wakeLock.requests, ["screen"]);
  assert.match(browser.root.innerHTML, /已回到前台，计时仍暂停/);
  browser.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  assert.equal(browser.root.querySelector('[data-action="toggle-timer"]').textContent, "暂停", browser.root.innerHTML);
  clock.advance(1000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "04");
});

test("browser seam: visibility loss during resume keeps client and server paused", async () => {
  const fixture = timedAppFixture();
  const clock = deterministicClock();
  const schedules = [];
  let releaseResume;
  const browser = await openBrowser(fixture.handler, async ({ path, server }) => {
    if (path.endsWith("/resume")) return new Promise((resolve) => { releaseResume = () => server().then(resolve); });
    return null;
  }, {
    clock,
    audio: {
      activate: () => ({ ok: true }),
      replace: (events) => { schedules.push(events); return { ok: true }; },
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();
  browser.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  schedules.length = 0;

  browser.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  browser.context.document.hidden = true;
  browser.context.document.dispatchEvent({ type: "visibilitychange" });
  await settle();
  releaseResume();
  await settle();

  assert.equal(browser.root.querySelector('[data-action="toggle-timer"]').textContent, "继续");
  assert.equal(schedules.length, 0);
  const stored = await fixture.store.getByEmail("athlete-a@example.invalid");
  assert.ok(stored.sessions[0].training_intervals.at(-1).ended_at);
});

test("browser seam: delayed resume audio cannot restart a hidden session", async () => {
  const fixture = timedAppFixture();
  const clock = deterministicClock();
  const schedules = [];
  let activationCount = 0;
  let resolveResumeAudio;
  const browser = await openBrowser(fixture.handler, async () => null, {
    clock,
    audio: {
      activate: () => {
        activationCount += 1;
        if (activationCount === 1) return { ok: true };
        return new Promise((resolve) => { resolveResumeAudio = resolve; });
      },
      replace: (events) => { schedules.push(events); return { ok: true }; },
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();
  browser.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  schedules.length = 0;

  browser.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  browser.context.document.hidden = true;
  browser.context.document.dispatchEvent({ type: "visibilitychange" });
  await settle();
  resolveResumeAudio({ ok: true });
  await settle();

  assert.equal(browser.root.querySelector('[data-action="toggle-timer"]').textContent, "继续");
  assert.equal(schedules.length, 0);
  const stored = await fixture.store.getByEmail("athlete-a@example.invalid");
  assert.ok(stored.sessions[0].training_intervals.at(-1).ended_at);
});

test("browser seam: Wake Lock release pauses active execution and manual continue can recover", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const wakeLock = wakeLockHarness();
  const browser = await openBrowser(handler, async () => null, { clock, wakeLock: wakeLock.wakeLock });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  clock.advance(5000);
  const remainingBeforeRelease = browser.root.querySelector('[data-action-remaining]').textContent;

  wakeLock.sentinels.at(-1).releaseFromPlatform();
  assert.match(browser.root.innerHTML, /屏幕保持已中断，计时已暂停/);
  clock.advance(2000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, remainingBeforeRelease);

  browser.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  assert.deepEqual(wakeLock.requests, ["screen", "screen"]);
  clock.advance(1000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "04");
});

test("browser seam: unsupported or denied Wake Lock shows fallback without blocking Start Action", async () => {
  const unsupported = timedAppFixture();
  const unsupportedClock = deterministicClock();
  const unsupportedBrowser = await openBrowser(unsupported.handler, async () => null, { clock: unsupportedClock });
  unsupportedBrowser.root.querySelector('[data-action="start"]').click();
  await settle();
  assert.match(unsupportedBrowser.root.innerHTML, /无法保持屏幕常亮/);
  assert.equal(unsupportedBrowser.root.querySelector('[data-action="start-timed"]').disabled, false);

  const denied = timedAppFixture();
  const deniedClock = deterministicClock();
  const deniedWakeLock = wakeLockHarness({ reject: true });
  const deniedBrowser = await openBrowser(denied.handler, async () => null, { clock: deniedClock, wakeLock: deniedWakeLock.wakeLock });
  deniedBrowser.root.querySelector('[data-action="start"]').click();
  await settle();
  assert.deepEqual(deniedWakeLock.requests, ["screen"]);
  assert.match(deniedBrowser.root.innerHTML, /屏幕保持未获允许/);
  assert.equal(deniedBrowser.root.querySelector('[data-action="start-timed"]').disabled, false);
});

function timedAppFixture() {
  const value = appFixture();
  const todaySlot = value.store.athletes.get("athlete-a@example.invalid").plan_revisions.at(-1).week[weekdayKey(today)];
  todaySlot.blocks[0].exercises[0].sets[0].target = { metric: "duration_sec", min: 3, max: 5 };
  return value;
}

test("browser seam: fixed duration runs preparation and tempo cues, pauses with the Session timer, and only saves after explicit completion", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const audioEvents = [];
  const browser = await openBrowser(handler, async () => null, { clock, audioEvents });

  assert.match(browser.root.innerHTML, /第 1 组 · 5 秒/);
  assert.doesNotMatch(browser.root.innerHTML, /3–5 秒/);
  browser.root.querySelector('[data-action="start"]').click();
  await settle();

  assert.match(browser.root.innerHTML, /计划：5 秒/);
  assert.doesNotMatch(browser.root.innerHTML, /计划：3–5 秒/);

  const startAction = browser.root.querySelector('[data-action="start-timed"]');
  assert.ok(startAction);
  startAction.click();
  await settle();
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "05");
  assert.deepEqual(audioEvents.map(({ type, kind, value }) => ({ type, ...(kind ? { kind, value } : {}) })), [{ type: "activate" }, { type: "cue", kind: "warmup", value: 5 }]);

  clock.advance(5000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "05");
  assert.equal(audioEvents.at(-1).kind, "tempo");
  assert.deepEqual(audioEvents.filter((event) => event.type === "cue").map((event) => [event.kind, event.value]), [["warmup", 5], ["warmup", 4], ["warmup", 3], ["warmup", 2], ["warmup", 1], ["tempo", 5]]);

  const sessionElapsedAtPause = browser.root.querySelector("[data-session-elapsed]").textContent;
  browser.root.querySelector('[data-action="toggle-timer"]').click();
  clock.advance(2000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "05");
  assert.equal(browser.root.querySelector("[data-session-elapsed]").textContent, sessionElapsedAtPause);
  assert.equal(audioEvents.filter((event) => event.type === "cue").length, 6);

  await settle();
  browser.root.querySelector('[data-action="toggle-timer"]').click();
  await settle();
  assert.equal(browser.root.querySelector('[data-action="toggle-timer"]').textContent, "暂停", browser.root.innerHTML);
  clock.advance(1000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "04");
  clock.advance(1000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "03");
  clock.advance(1000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "02");
  clock.advance(1000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "01");
  assert.deepEqual(audioEvents.slice(-4).map((event) => [event.kind, event.value]), [
    ["tempo", 4],
    ["tempo-final", 3],
    ["tempo-final", 2],
    ["tempo-final", 1],
  ]);

  const recordsBeforeZero = browser.calls.filter((request) => request.path.endsWith("/record"));
  assert.equal(recordsBeforeZero.length, 0);
  clock.advance(1000);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "00");
  assert.equal(browser.root.querySelector("#actual-value").value, "5");
  assert.equal(browser.root.querySelector('[data-action="complete"]').disabled, false);
  assert.equal(audioEvents.at(-1).kind, "complete");
  assert.equal(browser.calls.filter((request) => request.path.endsWith("/record")).length, 0);

  const actual = browser.root.querySelector("#actual-value");
  actual.value = "4";
  actual.dispatchEvent({ type: "input" });
  browser.root.querySelector('[data-action="complete"]').click();
  await settle();

  const recordRequests = browser.calls.filter((request) => request.path.endsWith("/record"));
  assert.equal(recordRequests.length, 1);
  assert.equal(JSON.parse(recordRequests[0].options.body).completion_results[0].actual.value, 4);
  assert.equal(browser.calls.filter((request) => request.method === "GET" && request.path.startsWith("/api/private/sessions/")).length, 0);
  assert.match(browser.root.innerHTML, /组间休息/);
});

test("browser seam: expired calendar Sessions show 未完成 and expose one-click normalization", async () => {
  const fixture = appFixture();
  const scheduledDate = await seedExpiredCalendarSession(fixture.store);
  const browser = await openBrowser(fixture.handler, async () => null);

  browser.root.querySelector('[data-view="calendar"]').click();
  await settle();
  browser.root.querySelector('[data-action="calendar-previous"]').click();
  await settle();

  const expiredDay = browser.root.querySelector(`[data-date="${scheduledDate}"]`);
  assert.ok(expiredDay);
  assert.match(expiredDay.className, /partial/);
  assert.match(expiredDay.textContent, /未完成/);
  assert.ok(browser.root.querySelector('[data-action="normalize-expired"]'));

  browser.root.querySelector('[data-action="normalize-expired"]').click();
  await settle();
  assert.equal(browser.calls.filter((request) => request.path === "/api/private/sessions/normalize-expired").length, 1);
  assert.equal(browser.root.querySelector('[data-action="normalize-expired"]'), null);
  assert.match(browser.root.innerHTML, /已整理 1 条过期训练记录/);
});

test("browser seam: audio initialization failure is visible while visual timing remains usable", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const browser = await openBrowser(handler, async () => null, {
    clock,
    audio: {
      activate: () => Promise.resolve({ ok: false, error: "音频播放被浏览器拒绝" }),
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();

  assert.match(browser.root.innerHTML, /声音未开启/);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "05");
  assert.equal(browser.root.querySelector('[data-action="start-timed"]').disabled, true);
});

test("browser seam: unmuting retries audio activation and clears a stale playback error", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  let activationAttempts = 0;
  const browser = await openBrowser(handler, async () => null, {
    clock,
    audio: {
      activate: () => Promise.resolve(++activationAttempts === 1
        ? { ok: false, error: "音频播放被浏览器拒绝" }
        : { ok: true }),
      replace: () => ({ ok: true }),
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();
  assert.match(browser.root.innerHTML, /声音未开启/);

  browser.root.querySelector('[data-action="toggle-mute"]').click();
  browser.root.querySelector('[data-action="toggle-mute"]').click();
  await settle();

  assert.equal(activationAttempts, 2);
  assert.doesNotMatch(browser.root.innerHTML, /声音未开启/);
});

test("browser seam: action cues are pre-scheduled on the countdown timeline", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const schedules = [];
  const browser = await openBrowser(handler, async () => null, {
    clock,
    audio: {
      activate: () => ({ ok: true }),
      replace: (events) => { schedules.push(events); return { ok: true }; },
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();

  assert.equal(schedules.length, 1);
  const events = schedules[0];
  assert.deepEqual(Array.from(events, (event) => [event.kind, event.value]), [
    ["warmup", 5],
    ["warmup", 4],
    ["warmup", 3],
    ["warmup", 2],
    ["warmup", 1],
    ["tempo", 5],
    ["tempo", 4],
    ["tempo-final", 3],
    ["tempo-final", 2],
    ["tempo-final", 1],
    ["complete", 0],
  ]);
  assert.deepEqual(Array.from(events).slice(1).map((event, index) => event.atMs - events[index].atMs), [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);

  const completeAt = events.at(-1).atMs;
  clock.advance(completeAt - clock.now());
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "00");
});

test("browser seam: delayed UI callbacks never catch-up play missed cues", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const schedules = [];
  const browser = await openBrowser(handler, async () => null, {
    clock,
    audio: {
      activate: () => ({ ok: true }),
      replace: (events) => { schedules.push(events); return { ok: true }; },
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();
  assert.equal(schedules.length, 1);
  clock.advance(5000);

  clock.advance(2200);
  assert.equal(schedules.length, 1);
});

test("browser seam: pausing while audio activation is pending cannot re-arm cancelled cues", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const schedules = [];
  let resolveActivation;
  const browser = await openBrowser(handler, async () => null, {
    clock,
    audio: {
      activate: () => new Promise((resolve) => { resolveActivation = resolve; }),
      replace: (events) => { schedules.push(events); return { ok: true }; },
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  browser.context.document.hidden = true;
  browser.context.document.dispatchEvent({ type: "visibilitychange" });
  await settle();
  resolveActivation({ ok: true });
  await settle();

  assert.equal(schedules.length, 0);
  assert.match(browser.root.innerHTML, /页面已离开前台，计时已暂停/);
  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "05");
});

test("browser seam: preparation countdown starts immediately while audio activation is pending", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const schedules = [];
  let resolveActivation;
  const browser = await openBrowser(handler, async () => null, {
    clock,
    audio: {
      activate: () => new Promise((resolve) => { resolveActivation = resolve; }),
      replace: (events) => { schedules.push(events); return { ok: true }; },
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  const startedAt = clock.now();
  browser.root.querySelector('[data-action="start-timed"]').click();
  clock.advance(2000);

  assert.equal(browser.root.querySelector('[data-action-remaining]').textContent, "03");
  resolveActivation({ ok: true });
  await settle();

  assert.equal(schedules.length, 1);
  assert.equal(schedules[0][0].kind, "warmup");
  assert.equal(schedules[0].at(-1).atMs, startedAt + 10000);
});

test("browser seam: muting again invalidates an in-flight unmute activation", async () => {
  const { handler } = timedAppFixture();
  const clock = deterministicClock();
  const schedules = [];
  let activationCount = 0;
  let resolveUnmute;
  const browser = await openBrowser(handler, async () => null, {
    clock,
    audio: {
      activate: () => {
        activationCount += 1;
        if (activationCount === 1) return { ok: true };
        return new Promise((resolve) => { resolveUnmute = resolve; });
      },
      replace: (events) => { schedules.push(events); return { ok: true }; },
      cancel: () => {},
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="start-timed"]').click();
  await settle();
  browser.root.querySelector('[data-action="toggle-mute"]').click();
  schedules.length = 0;

  browser.root.querySelector('[data-action="toggle-mute"]').click();
  browser.root.querySelector('[data-action="toggle-mute"]').click();
  resolveUnmute({ ok: true });
  await settle();

  assert.equal(browser.root.querySelector('[data-action="toggle-mute"]').attributes["aria-pressed"], "true");
  assert.equal(schedules.length, 0);
});

test("browser seam: natural rest completion does not cancel the completion sound tail", async () => {
  const fixture = appFixture();
  fixture.store.athletes.get("athlete-a@example.invalid").plan_revisions.at(-1).week[weekdayKey(today)].blocks[0].exercises[0].sets[0].rest_after_sec = 1;
  const clock = deterministicClock();
  let cancelCount = 0;
  const browser = await openBrowser(fixture.handler, async () => null, {
    clock,
    audio: {
      activate: () => ({ ok: true }),
      replace: () => ({ ok: true }),
      cancel: () => { cancelCount += 1; },
    },
  });

  browser.root.querySelector('[data-action="start"]').click();
  await settle();
  browser.root.querySelector('[data-action="complete"]').click();
  await settle();
  const cancelCountAtRestStart = cancelCount;

  clock.advance(1000);

  assert.doesNotMatch(browser.root.innerHTML, /组间休息/);
  assert.equal(cancelCount, cancelCountAtRestStart);
});
