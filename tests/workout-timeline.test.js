import test from "node:test";
import assert from "node:assert/strict";
// The supported Node engines execute erasable TypeScript directly, so test:interfaces
// stays on the production web module while Vitest owns the broader unit coverage.
import { createWorkoutTimeline } from "../web/src/lib/workout-timeline.ts";

function browserAudioHarness() {
  const starts = [];
  class FakeSource {
    connect() {}
    addEventListener() {}
    start(at) { starts.push(at); }
    stop() {}
  }
  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.currentTime = 10;
      this.destination = {};
    }
    async decodeAudioData() { return {}; }
    async resume() { this.state = "running"; }
    createBufferSource() { return new FakeSource(); }
    getOutputTimestamp() { return { contextTime: 10, performanceTime: 1000 }; }
  }
  return { FakeAudioContext, starts };
}

async function withBrowserAudio(run) {
  const originalAudioContext = globalThis.AudioContext;
  const originalFetch = globalThis.fetch;
  const harness = browserAudioHarness();
  globalThis.AudioContext = harness.FakeAudioContext;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  try {
    await run(harness);
  } finally {
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
    globalThis.fetch = originalFetch;
  }
}

test("Web Audio output schedules the action against the shared presentation clock", async () => {
  await withBrowserAudio(async ({ starts }) => {
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      sources: { warmup: "/cue.wav", prepare: "/cue.wav", tempo: "/cue.wav", "tempo-final": "/cue.wav", complete: "/cue.wav" },
    });
    assert.deepEqual(await timeline.prepareAudio(), { ok: true });
    assert.deepEqual(await timeline.activateAudio(), { ok: true });

    const scheduled = timeline.scheduleAction({ phase: "preparing", remainingMs: 5000, targetSec: 5 });
    assert.deepEqual(await scheduled.result, { ok: true });

    assert.equal(scheduled.phaseEndsAtMs, 6000);
    assert.deepEqual(starts, [10.05, 11.05, 12.05, 13.05, 14.05, 15, 16, 17, 18, 19, 20]);
  });
});

test("scheduling lead time never extends the visible rest deadline", () => {
  const timeline = createWorkoutTimeline({
    now: () => 1000,
    leadTimeMs: 50,
    audioOutput: { replace: () => ({ ok: true }) },
  });

  const scheduled = timeline.scheduleRest({ remainingMs: 6000 });

  assert.equal(scheduled.startAtMs, 1050);
  assert.equal(scheduled.endsAtMs, 7000);
});

test("short rests retain the cue at the start of their final countdown", () => {
  const timeline = createWorkoutTimeline({
    now: () => 1000,
    leadTimeMs: 50,
    audioOutput: { replace: () => ({ ok: true }) },
  });

  const fiveSeconds = timeline.scheduleRest({ remainingMs: 5000 });
  const threeSeconds = timeline.scheduleRest({ remainingMs: 3000 });

  assert.deepEqual(fiveSeconds.events.map((event) => [event.kind, event.value, event.atMs]), [
    ["rest-final", 5, 1000],
    ["rest-final", 4, 2000],
    ["rest-final", 3, 3000],
    ["rest-final", 2, 4000],
    ["rest-final", 1, 5000],
    ["rest-complete", 0, 6000],
  ]);
  assert.deepEqual(threeSeconds.events.map((event) => [event.kind, event.value, event.atMs]), [
    ["rest-final", 3, 1000],
    ["rest-final", 2, 2000],
    ["rest-final", 1, 3000],
    ["rest-complete", 0, 4000],
  ]);
});

test("cancel invalidates a Web Audio replacement that has not reached the rendering graph", async () => {
  await withBrowserAudio(async ({ starts }) => {
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      sources: { warmup: "/cue.wav", prepare: "/cue.wav", tempo: "/cue.wav", "tempo-final": "/cue.wav", complete: "/cue.wav" },
    });
    await timeline.prepareAudio();
    await timeline.activateAudio();

    const scheduled = timeline.scheduleAction({ phase: "preparing", remainingMs: 5000, targetSec: 5 });
    timeline.cancel();
    await scheduled.result;

    assert.deepEqual(starts, []);
  });
});
