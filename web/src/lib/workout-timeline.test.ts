import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkoutTimeline,
  type AudioOutput,
  type CueEvent,
} from "./workout-timeline";

const cueSources = {
  warmup: "/cue.wav",
  prepare: "/cue.wav",
  tempo: "/cue.wav",
  "tempo-final": "/cue.wav",
  complete: "/cue.wav",
  "rest-final": "/cue.wav",
  "rest-complete": "/cue.wav",
};

interface FakeSourceRecord {
  stopped: boolean;
}

function installBrowserAudioHarness() {
  const starts: number[] = [];
  const sources: FakeSourceRecord[] = [];

  class FakeSource {
    buffer: AudioBuffer | null = null;
    stopped = false;
    private endedListener: (() => void) | null = null;

    connect(): void {}

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      if (type !== "ended") return;
      this.endedListener = () => {
        const event = new Event("ended");
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      };
    }

    start(at = 0): void {
      starts.push(at);
    }

    stop(): void {
      this.stopped = true;
    }

    finish(): void {
      this.endedListener?.();
    }
  }

  class FakeAudioContext {
    state: AudioContextState = "suspended";
    currentTime = 10;
    destination = {} as AudioDestinationNode;

    async decodeAudioData(): Promise<AudioBuffer> {
      return {} as AudioBuffer;
    }

    async resume(): Promise<void> {
      this.state = "running";
    }

    createBufferSource(): AudioBufferSourceNode {
      const source = new FakeSource();
      sources.push(source);
      return source as unknown as AudioBufferSourceNode;
    }

    getOutputTimestamp() {
      return { contextTime: 10, performanceTime: 1000 };
    }
  }

  const fetchMock = vi.fn(async () => (
    new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  ));
  vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
  vi.stubGlobal("fetch", fetchMock);

  return { fetchMock, sources, starts };
}

function eventRows(events: CueEvent[]) {
  return events.map(({ kind, value, atMs }) => [kind, value, atMs]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkoutTimeline browser audio scheduling", () => {
  it("schedules action cues against the shared presentation clock", async () => {
    const { fetchMock, starts } = installBrowserAudioHarness();
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      sources: cueSources,
    });

    expect(await timeline.prepareAudio()).toEqual({ ok: true });
    expect(await timeline.activateAudio()).toEqual({ ok: true });

    const scheduled = timeline.scheduleAction({
      phase: "preparing",
      remainingMs: 5000,
      targetSec: 5,
    });

    await expect(scheduled.result).resolves.toEqual({ ok: true });
    expect(scheduled.phaseEndsAtMs).toBe(6000);
    expect(starts).toEqual([
      10.05,
      11.05,
      12.05,
      13.05,
      14.05,
      15,
      16,
      17,
      18,
      19,
      20,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates a pending rendering-graph replacement when lifecycle cancellation wins", async () => {
    const { starts } = installBrowserAudioHarness();
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      sources: cueSources,
    });
    await timeline.prepareAudio();
    await timeline.activateAudio();

    const scheduled = timeline.scheduleAction({
      phase: "preparing",
      remainingMs: 5000,
      targetSec: 5,
    });
    timeline.cancel();

    await expect(scheduled.result).resolves.toEqual({ ok: true });
    expect(starts).toEqual([]);
  });

  it("lets only the newest consecutive replacement enter the rendering graph", async () => {
    const { starts } = installBrowserAudioHarness();
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      sources: cueSources,
    });
    await timeline.prepareAudio();
    await timeline.activateAudio();

    const staleAction = timeline.scheduleAction({
      phase: "preparing",
      remainingMs: 5000,
      targetSec: 5,
    });
    const currentRest = timeline.scheduleRest({ remainingMs: 3000 });

    await expect(Promise.all([staleAction.result, currentRest.result])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(starts).toEqual([10, 11, 12, 13]);
  });

  it("skips expired cues after a delayed scheduling microtask instead of catching them up", async () => {
    const { starts } = installBrowserAudioHarness();
    let nowMs = 1000;
    const timeline = createWorkoutTimeline({
      now: () => nowMs,
      leadTimeMs: 50,
      sources: cueSources,
    });
    await timeline.prepareAudio();
    await timeline.activateAudio();

    const scheduled = timeline.scheduleRest({ remainingMs: 3000 });
    nowMs = 2525;

    await expect(scheduled.result).resolves.toEqual({ ok: true });
    expect(eventRows(scheduled.events)).toEqual([
      ["rest-final", 3, 1000],
      ["rest-final", 2, 2000],
      ["rest-final", 1, 3000],
      ["rest-complete", 0, 4000],
    ]);
    expect(starts).toEqual([12, 13]);
  });

  it("keeps the rest completion tail scheduled until explicit lifecycle cancellation", async () => {
    const { sources, starts } = installBrowserAudioHarness();
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      sources: cueSources,
    });
    await timeline.prepareAudio();
    await timeline.activateAudio();

    const scheduled = timeline.scheduleRest({ remainingMs: 3000 });
    await scheduled.result;

    expect(scheduled.events.at(-1)).toEqual({
      kind: "rest-complete",
      value: 0,
      atMs: scheduled.endsAtMs,
    });
    expect(starts.at(-1)).toBe(13);
    expect(sources.every(({ stopped }) => !stopped)).toBe(true);

    timeline.cancel();
    expect(sources.every(({ stopped }) => stopped)).toBe(true);
  });
});

describe("WorkoutTimeline fixed deadlines and lifecycle controls", () => {
  it("does not let audio lead time extend the visible rest deadline", () => {
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      audioOutput: { replace: () => ({ ok: true }) },
    });

    const scheduled = timeline.scheduleRest({ remainingMs: 6000 });

    expect(scheduled.startAtMs).toBe(1050);
    expect(scheduled.endsAtMs).toBe(7000);
  });

  it("keeps aligned action and rest deadlines fixed across pause-resume style rescheduling", () => {
    let nowMs = 1000;
    const replacements: CueEvent[][] = [];
    const cancel = vi.fn();
    const audioOutput: AudioOutput = {
      cancel,
      replace: (events) => {
        replacements.push(events.map((event) => ({ ...event })));
        return { ok: true };
      },
    };
    const timeline = createWorkoutTimeline({
      now: () => nowMs,
      leadTimeMs: 50,
      audioOutput,
    });

    const initialAction = timeline.scheduleAction({
      phase: "active",
      remainingMs: 5000,
      targetSec: 5,
      alignPhaseEndAtMs: 6000,
    });
    const initialRest = timeline.scheduleRest({
      remainingMs: 3000,
      alignEndAtMs: 4000,
    });
    timeline.cancel();
    nowMs = 3500;
    const resumedAction = timeline.scheduleAction({
      phase: "active",
      remainingMs: 2500,
      targetSec: 5,
      alignPhaseEndAtMs: initialAction.phaseEndsAtMs,
    });
    const resumedRest = timeline.scheduleRest({
      remainingMs: 500,
      alignEndAtMs: initialRest.endsAtMs,
    });

    expect(initialAction.phaseEndsAtMs).toBe(6000);
    expect(resumedAction.phaseEndsAtMs).toBe(6000);
    expect(eventRows(resumedAction.events)).toEqual([
      ["tempo-final", 2, 4000],
      ["tempo-final", 1, 5000],
      ["complete", 0, 6000],
    ]);
    expect(initialRest.endsAtMs).toBe(4000);
    expect(resumedRest.endsAtMs).toBe(4000);
    expect(resumedRest.events.at(-1)).toEqual({
      kind: "rest-complete",
      value: 0,
      atMs: 4000,
    });
    expect(replacements).toHaveLength(4);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retains the initial final-countdown cue and completion tail for short rests", () => {
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      leadTimeMs: 50,
      audioOutput: { replace: () => ({ ok: true }) },
    });

    const fiveSeconds = timeline.scheduleRest({ remainingMs: 5000 });
    const threeSeconds = timeline.scheduleRest({ remainingMs: 3000 });

    expect(eventRows(fiveSeconds.events)).toEqual([
      ["rest-final", 5, 1000],
      ["rest-final", 4, 2000],
      ["rest-final", 3, 3000],
      ["rest-final", 2, 4000],
      ["rest-final", 1, 5000],
      ["rest-complete", 0, 6000],
    ]);
    expect(eventRows(threeSeconds.events)).toEqual([
      ["rest-final", 3, 1000],
      ["rest-final", 2, 2000],
      ["rest-final", 1, 3000],
      ["rest-complete", 0, 4000],
    ]);
  });

  it("cancels audio without replacing cues when a schedule is inaudible", () => {
    const replace = vi.fn(() => ({ ok: true }));
    const cancel = vi.fn();
    const timeline = createWorkoutTimeline({
      now: () => 1000,
      audioOutput: { replace, cancel },
    });

    const action = timeline.scheduleAction({
      phase: "preparing",
      remainingMs: 5000,
      targetSec: 5,
      audible: false,
    });
    const rest = timeline.scheduleRest({
      remainingMs: 3000,
      audible: false,
    });
    timeline.cancel();

    expect(action.result).toEqual({ ok: true });
    expect(rest.result).toEqual({ ok: true });
    expect(replace).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(3);
  });
});
