/** @typedef {{ kind: string, value: number, atMs: number }} CueEvent */
/** @typedef {{ ok: boolean, error?: string }} AudioResult */
/** @typedef {AudioResult | false | undefined} AudioResultLike */
/** @typedef {AudioResultLike | Promise<AudioResultLike>} AudioResultValue */
/** @typedef {{ prepare?: () => AudioResultValue, activate?: () => AudioResultValue, replace?: (events: CueEvent[]) => AudioResultValue, cancel?: () => void }} AudioOutput */

/** @type {Record<string, string>} */
const defaultAudioSources = {
  warmup: "/audio/workout-warmup.wav",
  prepare: "/audio/workout-prepare.wav",
  tempo: "/audio/workout-tempo.wav",
  "tempo-final": "/audio/workout-tempo-final.wav",
  complete: "/audio/workout-complete.wav",
  "rest-final": "/audio/workout-tempo-final.wav",
  "rest-complete": "/audio/workout-complete.wav",
};

/** @param {any} error @param {string} fallback @returns {AudioResult} */
function failure(error, fallback) {
  return { ok: false, error: error?.message || (typeof error === "string" ? error : fallback) };
}

/** @param {{ sources: Record<string, string>, now: () => number }} options @returns {AudioOutput} */
function createBrowserAudioOutput({ sources, now }) {
  const audioGlobal = /** @type {typeof globalThis & { webkitAudioContext?: typeof AudioContext }} */ (globalThis);
  const AudioContextClass = audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
  /** @type {AudioContext|null} */
  let context = null;
  /** @type {Promise<Map<string, AudioBuffer>>|null} */
  let buffersPromise = null;
  let scheduleGeneration = 0;
  /** @type {Set<AudioBufferSourceNode>} */
  const activeSources = new Set();

  /** @returns {AudioContext|null} */
  function ensureContext() {
    if (!AudioContextClass) return null;
    if (!context || context.state === "closed") context = new AudioContextClass({ latencyHint: "interactive" });
    return context;
  }

  function prepare() {
    const audioContext = ensureContext();
    if (!audioContext) return Promise.resolve({ ok: false, error: "当前浏览器不支持 Web Audio" });
    if (!buffersPromise) {
      const uniqueSources = [...new Set(Object.values(sources))];
      buffersPromise = Promise.all(uniqueSources.map(async (source) => {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`提示音加载失败 (${response.status})`);
        return /** @type {[string, AudioBuffer]} */ ([source, await audioContext.decodeAudioData(await response.arrayBuffer())]);
      })).then((entries) => new Map(entries)).catch((error) => {
        buffersPromise = null;
        throw error;
      });
    }
    return buffersPromise.then(() => ({ ok: true })).catch((error) => failure(error, "提示音加载失败"));
  }

  async function activate() {
    try {
      const audioNavigator = /** @type {Navigator & { audioSession?: { type?: string } }} */ (navigator);
      if (audioNavigator.audioSession && "type" in audioNavigator.audioSession) audioNavigator.audioSession.type = "playback";
    } catch {}
    const audioContext = ensureContext();
    if (!audioContext) return { ok: false, error: "当前浏览器不支持 Web Audio" };
    const prepared = prepare();
    try {
      if (audioContext.state !== "running") await audioContext.resume();
      const preparedResult = await prepared;
      if (!preparedResult.ok) return preparedResult;
      if (audioContext.state !== "running") return { ok: false, error: "音频播放被浏览器拒绝" };
      return { ok: true };
    } catch (error) {
      return failure(error, "音频播放被浏览器拒绝");
    }
  }

  function cancel() {
    scheduleGeneration += 1;
    for (const source of activeSources) {
      try { source.stop(); } catch {}
    }
    activeSources.clear();
  }

  /** @param {AudioContext} audioContext @param {number} atMs */
  function contextTimeFor(audioContext, atMs) {
    const timestamp = audioContext.getOutputTimestamp?.();
    const contextTime = Number(timestamp?.contextTime);
    const performanceTime = Number(timestamp?.performanceTime);
    if (Number.isFinite(contextTime) && Number.isFinite(performanceTime) && performanceTime > 0) {
      return contextTime + (atMs - performanceTime) / 1000;
    }
    return audioContext.currentTime + (atMs - now()) / 1000;
  }

  /** @param {CueEvent[]} events @returns {AudioResult|Promise<AudioResult>} */
  function replace(events) {
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
      }).catch((error) => {
        cancel();
        return failure(error, "提示音调度失败");
      });
    } catch (error) {
      cancel();
      return failure(error, "提示音调度失败");
    }
  }

  return { prepare, activate, replace, cancel };
}

/** @param {AudioResultLike} result @param {string} fallback @returns {AudioResult} */
function normalizeResult(result, fallback) {
  if (result === false) return { ok: false, error: fallback };
  if (result && typeof result === "object" && result.ok === false) return result;
  return { ok: true };
}

/**
 * @param {{ audioOutput?: AudioOutput|null, now?: () => number, leadTimeMs?: number, sources?: Record<string, string> }} [options]
 */
export function createWorkoutTimeline({ audioOutput = null, now = () => performance.now(), leadTimeMs = 50, sources = defaultAudioSources } = {}) {
  const output = audioOutput || createBrowserAudioOutput({ sources, now });

  function prepareAudio() {
    try {
      return Promise.resolve(output.prepare?.()).then((result) => normalizeResult(result, "提示音加载失败")).catch((error) => failure(error, "提示音加载失败"));
    } catch (error) {
      return Promise.resolve(failure(error, "提示音加载失败"));
    }
  }

  function activateAudio() {
    try {
      return Promise.resolve(output.activate?.()).then((result) => normalizeResult(result, "音频播放被浏览器拒绝")).catch((error) => failure(error, "音频播放被浏览器拒绝"));
    } catch (error) {
      return Promise.resolve(failure(error, "音频播放被浏览器拒绝"));
    }
  }

  /** @param {CueEvent[]} events @returns {AudioResultValue} */
  function replace(events) {
    try {
      return output.replace?.(events) ?? { ok: false, error: "当前音频输出不支持精确调度" };
    } catch (error) {
      return failure(error, "提示音调度失败");
    }
  }

  /** @param {{ phase: "preparing"|"active", remainingMs: number, targetSec: number, audible?: boolean, alignPhaseEndAtMs?: number|null }} options */
  function scheduleAction({ phase, remainingMs, targetSec, audible = true, alignPhaseEndAtMs = null }) {
    const scheduledAtMs = now();
    const startAtMs = scheduledAtMs + leadTimeMs;
    const phaseEndsAtMs = alignPhaseEndAtMs ?? scheduledAtMs + Math.max(0, remainingMs);
    const effectiveRemainingMs = Math.max(0, phaseEndsAtMs - startAtMs);
    /** @type {CueEvent[]} */
    const events = [];
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

  /** @param {{ remainingMs: number, audible?: boolean, alignEndAtMs?: number|null }} options */
  function scheduleRest({ remainingMs, audible = true, alignEndAtMs = null }) {
    const scheduledAtMs = now();
    const startAtMs = scheduledAtMs + leadTimeMs;
    const endsAtMs = alignEndAtMs ?? scheduledAtMs + Math.max(0, remainingMs);
    const effectiveRemainingMs = Math.max(0, endsAtMs - startAtMs);
    const currentSecond = Math.max(0, Math.ceil(effectiveRemainingMs / 1000));
    /** @type {CueEvent[]} */
    const events = [];
    for (let value = Math.min(5, currentSecond); value >= 1; value -= 1) {
      const atMs = endsAtMs - value * 1000;
      events.push({ kind: "rest-final", value, atMs });
    }
    events.push({ kind: "rest-complete", value: 0, atMs: endsAtMs });
    const result = audible ? replace(events) : (output.cancel?.(), { ok: true });
    return { startAtMs, endsAtMs, events, result };
  }

  function cancel() {
    try { output.cancel?.(); } catch {}
  }

  return { prepareAudio, activateAudio, scheduleAction, scheduleRest, cancel };
}
