export interface CueEvent {
  kind: string;
  value: number;
  atMs: number;
}

export interface AudioResult {
  ok: boolean;
  error?: string;
}

export type AudioResultLike = AudioResult | false | undefined;
export type AudioResultValue = AudioResultLike | Promise<AudioResultLike>;

export interface AudioOutput {
  prepare?: () => AudioResultValue;
  activate?: () => AudioResultValue;
  replace?: (events: CueEvent[]) => AudioResultValue;
  cancel?: () => void;
}

export interface WorkoutTimelineOptions {
  audioOutput?: AudioOutput | null;
  now?: () => number;
  leadTimeMs?: number;
  sources?: Record<string, string>;
}

export interface ActionSchedule {
  startAtMs: number;
  phaseEndsAtMs: number;
  events: CueEvent[];
  result: AudioResultValue;
}

export interface RestSchedule {
  startAtMs: number;
  endsAtMs: number;
  events: CueEvent[];
  result: AudioResultValue;
}

const defaultAudioSources: Record<string, string> = {
  warmup: "/audio/workout-warmup.wav",
  prepare: "/audio/workout-prepare.wav",
  tempo: "/audio/workout-tempo.wav",
  "tempo-final": "/audio/workout-tempo-final.wav",
  complete: "/audio/workout-complete.wav",
  "rest-final": "/audio/workout-tempo-final.wav",
  "rest-complete": "/audio/workout-complete.wav",
};

function failure(error: unknown, fallback: string): AudioResult {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message || "")
    : "";
  if (message) return { ok: false, error: message };
  return { ok: false, error: typeof error === "string" ? error : fallback };
}

function createBrowserAudioOutput({ sources, now }: { sources: Record<string, string>; now: () => number }): AudioOutput {
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextClass = globalThis.AudioContext || audioGlobal.webkitAudioContext;
  let context: AudioContext | null = null;
  let buffersPromise: Promise<Map<string, AudioBuffer>> | null = null;
  let scheduleGeneration = 0;
  const activeSources = new Set<AudioBufferSourceNode>();

  function ensureContext(): AudioContext | null {
    if (!AudioContextClass) return null;
    if (!context || context.state === "closed") context = new AudioContextClass({ latencyHint: "interactive" });
    return context;
  }

  function prepare(): Promise<AudioResult> {
    const audioContext = ensureContext();
    if (!audioContext) return Promise.resolve({ ok: false, error: "当前浏览器不支持 Web Audio" });
    if (!buffersPromise) {
      const uniqueSources = [...new Set(Object.values(sources))];
      buffersPromise = Promise.all(uniqueSources.map(async (source): Promise<[string, AudioBuffer]> => {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`提示音加载失败 (${response.status})`);
        return [source, await audioContext.decodeAudioData(await response.arrayBuffer())];
      })).then((entries) => new Map(entries)).catch((error: unknown) => {
        buffersPromise = null;
        throw error;
      });
    }
    return buffersPromise.then(() => ({ ok: true })).catch((error: unknown) => failure(error, "提示音加载失败"));
  }

  async function activate(): Promise<AudioResult> {
    try {
      const audioNavigator = navigator as Navigator & { audioSession?: { type?: string } };
      if (audioNavigator.audioSession && "type" in audioNavigator.audioSession) audioNavigator.audioSession.type = "playback";
    } catch {
      // audioSession is an optional browser extension.
    }
    const audioContext = ensureContext();
    if (!audioContext) return { ok: false, error: "当前浏览器不支持 Web Audio" };
    const prepared = prepare();
    try {
      if (audioContext.state !== "running") await audioContext.resume();
      const preparedResult = await prepared;
      if (!preparedResult.ok) return preparedResult;
      if (audioContext.state !== "running") return { ok: false, error: "音频播放被浏览器拒绝" };
      return { ok: true };
    } catch (error: unknown) {
      return failure(error, "音频播放被浏览器拒绝");
    }
  }

  function cancel(): void {
    scheduleGeneration += 1;
    for (const source of activeSources) {
      try {
        source.stop();
      } catch {
        // A source may already have ended.
      }
    }
    activeSources.clear();
  }

  function contextTimeFor(audioContext: AudioContext, atMs: number): number {
    const timestamp = audioContext.getOutputTimestamp?.();
    const contextTime = Number(timestamp?.contextTime);
    const performanceTime = Number(timestamp?.performanceTime);
    if (Number.isFinite(contextTime) && Number.isFinite(performanceTime) && performanceTime > 0) {
      return contextTime + (atMs - performanceTime) / 1000;
    }
    return audioContext.currentTime + (atMs - now()) / 1000;
  }

  function replace(events: CueEvent[]): AudioResult | Promise<AudioResult> {
    if (!context || context.state !== "running" || !buffersPromise) return { ok: false, error: "声音尚未准备好" };
    const audioContext = context;
    const preparedBuffers = buffersPromise;
    cancel();
    const generation = scheduleGeneration;
    try {
      return Promise.resolve(preparedBuffers).then((buffers) => {
        if (generation !== scheduleGeneration) return { ok: true };
        for (const event of events) {
          if (event.atMs < now() - 20) continue;
          const buffer = buffers.get(sources[event.kind] || sources.tempo);
          if (!buffer) throw new Error("提示音资源缺失");
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.connect(audioContext.destination);
          source.addEventListener("ended", () => activeSources.delete(source), { once: true });
          activeSources.add(source);
          source.start(Math.max(audioContext.currentTime, contextTimeFor(audioContext, event.atMs)));
        }
        return { ok: true };
      }).catch((error: unknown) => {
        cancel();
        return failure(error, "提示音调度失败");
      });
    } catch (error: unknown) {
      cancel();
      return failure(error, "提示音调度失败");
    }
  }

  return { prepare, activate, replace, cancel };
}

function normalizeResult(result: AudioResultLike, fallback: string): AudioResult {
  if (result === false) return { ok: false, error: fallback };
  if (result && typeof result === "object" && result.ok === false) return result;
  return { ok: true };
}

export function createWorkoutTimeline({
  audioOutput = null,
  now = () => performance.now(),
  leadTimeMs = 50,
  sources = defaultAudioSources,
}: WorkoutTimelineOptions = {}) {
  const output = audioOutput || createBrowserAudioOutput({ sources, now });

  function prepareAudio(): Promise<AudioResult> {
    try {
      return Promise.resolve(output.prepare?.()).then((result) => normalizeResult(result, "提示音加载失败")).catch((error: unknown) => failure(error, "提示音加载失败"));
    } catch (error: unknown) {
      return Promise.resolve(failure(error, "提示音加载失败"));
    }
  }

  function activateAudio(): Promise<AudioResult> {
    try {
      return Promise.resolve(output.activate?.()).then((result) => normalizeResult(result, "音频播放被浏览器拒绝")).catch((error: unknown) => failure(error, "音频播放被浏览器拒绝"));
    } catch (error: unknown) {
      return Promise.resolve(failure(error, "音频播放被浏览器拒绝"));
    }
  }

  function replace(events: CueEvent[]): AudioResultValue {
    try {
      return output.replace?.(events) ?? { ok: false, error: "当前音频输出不支持精确调度" };
    } catch (error: unknown) {
      return failure(error, "提示音调度失败");
    }
  }

  function scheduleAction({ phase, remainingMs, targetSec, audible = true, alignPhaseEndAtMs = null }: {
    phase: "preparing" | "active";
    remainingMs: number;
    targetSec: number;
    audible?: boolean;
    alignPhaseEndAtMs?: number | null;
  }): ActionSchedule {
    const scheduledAtMs = now();
    const startAtMs = scheduledAtMs + leadTimeMs;
    const phaseEndsAtMs = alignPhaseEndAtMs ?? scheduledAtMs + Math.max(0, remainingMs);
    const effectiveRemainingMs = Math.max(0, phaseEndsAtMs - startAtMs);
    const events: CueEvent[] = [];
    if (phase === "preparing") {
      const preparationSeconds = Math.max(1, Math.ceil(effectiveRemainingMs / 1000));
      for (let value = preparationSeconds; value >= 1; value -= 1) {
        events.push({ kind: "warmup", value, atMs: startAtMs + (preparationSeconds - value) * 1000 });
      }
      const actionEndsAtMs = phaseEndsAtMs + targetSec * 1000;
      for (let value = targetSec; value >= 1; value -= 1) {
        events.push({ kind: value <= 3 ? "tempo-final" : "tempo", value, atMs: actionEndsAtMs - value * 1000 });
      }
      events.push({ kind: "complete", value: 0, atMs: actionEndsAtMs });
    } else if (phase === "active") {
      const currentSecond = Math.max(0, Math.ceil(effectiveRemainingMs / 1000));
      for (let value = currentSecond - 1; value >= 1; value -= 1) {
        events.push({ kind: value <= 3 ? "tempo-final" : "tempo", value, atMs: phaseEndsAtMs - value * 1000 });
      }
      events.push({ kind: "complete", value: 0, atMs: phaseEndsAtMs });
    }
    const result = audible ? replace(events) : (output.cancel?.(), { ok: true });
    return { startAtMs, phaseEndsAtMs, events, result };
  }

  function scheduleRest({ remainingMs, audible = true, alignEndAtMs = null }: {
    remainingMs: number;
    audible?: boolean;
    alignEndAtMs?: number | null;
  }): RestSchedule {
    const scheduledAtMs = now();
    const startAtMs = scheduledAtMs + leadTimeMs;
    const endsAtMs = alignEndAtMs ?? scheduledAtMs + Math.max(0, remainingMs);
    const effectiveRemainingMs = Math.max(0, endsAtMs - startAtMs);
    const currentSecond = Math.max(0, Math.ceil(effectiveRemainingMs / 1000));
    const events: CueEvent[] = [];
    for (let value = Math.min(5, currentSecond); value >= 1; value -= 1) {
      events.push({ kind: "rest-final", value, atMs: endsAtMs - value * 1000 });
    }
    events.push({ kind: "rest-complete", value: 0, atMs: endsAtMs });
    const result = audible ? replace(events) : (output.cancel?.(), { ok: true });
    return { startAtMs, endsAtMs, events, result };
  }

  function cancel(): void {
    try {
      output.cancel?.();
    } catch {
      // Cancellation is best-effort during navigation and lifecycle teardown.
    }
  }

  return { prepareAudio, activateAudio, scheduleAction, scheduleRest, cancel };
}
