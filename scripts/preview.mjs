import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHandler } from "../src/http.js";
import { emptyAthlete, MemoryStore } from "../src/store.js";
import { addDays, localDate, weekdayKey, WEEKDAYS } from "../src/util.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultHost = "127.0.0.1";
const defaultPort = 4173;
export const PREVIEW_TIMEZONE = "Asia/Shanghai";
const previewPassword = "local-workout";
const previewSessionSecret = "preview-only-session-secret-32-bytes";
const previewAgentSecret = "preview-only-agent-token-signing-key";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wav", "audio/wav"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

/** @param {string[]} argv */
export function parsePreviewArguments(argv) {
  const options = {
    host: defaultHost,
    port: defaultPort,
    assets: resolve(repositoryRoot, "dist"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--help") return { ...options, help: true };
    if (!["--assets", "--host", "--port"].includes(name)) {
      throw new Error(`Unknown preview option: ${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    index += 1;
    if (name === "--host") options.host = value;
    if (name === "--port") options.port = Number(value);
    if (name === "--assets") options.assets = isAbsolute(value) ? value : resolve(process.cwd(), value);
  }

  validateNetworkOptions(options.host, options.port);
  return options;
}

/** @param {unknown} host @param {unknown} port */
function validateNetworkOptions(host, port) {
  if (typeof host !== "string" || !host.trim() || host.includes("://") || /[\s/?#]/.test(host)) {
    throw new Error("--host must be a hostname or IP address without a protocol or path");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(host.toLowerCase())) {
    throw new Error("--host must be a loopback address: 127.0.0.1, localhost, or ::1");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
}

/** @param {string} host @param {number} port */
function previewOrigin(host, port) {
  const hostname = host.includes(":") ? `[${host}]` : host;
  return `http://${hostname}:${port}`;
}

/** @param {string} displayName @param {string} email @param {string} suffix @param {Date} startedAt @param {string} previewDate */
function previewAthlete(displayName, email, suffix, startedAt, previewDate) {
  const athlete = emptyAthlete({
    displayName,
    email,
    timezone: PREVIEW_TIMEZONE,
  });
  athlete.athlete_key = `preview-athlete-${suffix}`;
  athlete.updated_at = startedAt.toISOString();

  const week = Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
  week[weekdayKey(previewDate)] = {
    kind: "workout",
    title: suffix === "a" ? "本地演示训练" : "本地演示训练 B",
    start_time: "08:00",
    estimated_duration_min: 35,
    blocks: [{
      title: "轻量测试",
      exercises: [{
        exercise_key: `preview_squat_${suffix}`,
        name: "演示深蹲",
        category: "strength",
        side_mode: "none",
        sets: [{
          target: { metric: "reps", min: 8, max: 8 },
          resistance: { mode: "bodyweight", load_kg: null, quantity: null },
          target_rir: 2,
          target_rpe: null,
          tempo: null,
          rest_after_sec: 60,
          target_incline_percent: null,
        }],
      }],
    }],
  };
  week[weekdayKey(addDays(previewDate, 1))] = { kind: "rest" };
  athlete.plan_revisions.push({
    revision_key: `preview-revision-${suffix}`,
    revision_sequence: 1,
    created_at: startedAt.toISOString(),
    effective_from: addDays(previewDate, -7),
    week,
  });
  return athlete;
}

/** @param {Date} startedAt */
function createPreviewStore(startedAt) {
  const previewDate = localDate(startedAt, PREVIEW_TIMEZONE);
  return new MemoryStore([
    previewAthlete("Preview Athlete A", "athlete-a@example.invalid", "a", startedAt, previewDate),
    previewAthlete("Preview Athlete B", "athlete-b@example.invalid", "b", startedAt, previewDate),
  ]);
}

/** @param {string} assetDirectory */
function createAssetFetch(assetDirectory) {
  const root = resolve(assetDirectory);
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const pathname = new URL(request.url).pathname;
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathname === "/" || pathname === "/app" ? "/index.html" : pathname);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const candidate = resolve(root, `.${decodedPath}`);
    if (!isContainedPath(root, candidate)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const canonicalCandidate = await realpath(candidate);
      if (!isContainedPath(root, canonicalCandidate)) return new Response("Not found", { status: 404 });
      const body = await readFile(canonicalCandidate);
      const headers = new Headers({
        "Cache-Control": extname(candidate) === ".html" ? "no-store" : "public, max-age=0, must-revalidate",
        "Content-Type": contentTypes.get(extname(candidate).toLowerCase()) ?? "application/octet-stream",
      });
      return new Response(request.method === "HEAD" ? null : body, { headers });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["EACCES", "EISDIR", "ENOENT", "ENOTDIR"].includes(String(error.code))) {
        return new Response("Not found", { status: 404 });
      }
      throw error;
    }
  };
}

/** @param {string} root @param {string} candidate */
function isContainedPath(root, candidate) {
  const candidateRelative = relative(root, candidate);
  return candidateRelative !== ".."
    && !candidateRelative.startsWith(`..${sep}`)
    && !isAbsolute(candidateRelative);
}

/** @param {import("node:http").IncomingMessage} incoming @param {string} origin */
async function toFetchRequest(incoming, origin) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(new URL(incoming.url ?? "/", origin), {
    method: incoming.method,
    headers,
    body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
}

/** @param {Response} response @param {import("node:http").ServerResponse} outgoing @param {string | undefined} method */
async function sendFetchResponse(response, outgoing, method) {
  const headers = {};
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() !== "set-cookie") headers[name] = value;
  }
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : [];
  if (cookies.length) headers["set-cookie"] = cookies;
  outgoing.writeHead(response.status, headers);
  if (method === "HEAD" || response.body === null) outgoing.end();
  else outgoing.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * @param {{ host?: string, port?: number, assets?: string }} [options]
 */
export async function startPreviewServer(options = {}) {
  const host = options.host ?? defaultHost;
  const port = options.port ?? defaultPort;
  validateNetworkOptions(host, port);
  const requestedAssetDirectory = resolve(options.assets ?? resolve(repositoryRoot, "dist"));
  const origin = previewOrigin(host, port);

  const assetDirectory = await realpath(requestedAssetDirectory).catch(() => null);
  const assetStats = assetDirectory ? await stat(assetDirectory).catch(() => null) : null;
  const indexPath = assetDirectory ? await realpath(resolve(assetDirectory, "index.html")).catch(() => null) : null;
  const indexStats = indexPath && isContainedPath(assetDirectory, indexPath)
    ? await stat(indexPath).catch(() => null)
    : null;
  if (!assetDirectory || !assetStats?.isDirectory() || !indexStats?.isFile()) {
    throw new Error(`Built preview assets are missing from ${requestedAssetDirectory}; run npm run build first`);
  }

  const startedAt = new Date();
  const store = createPreviewStore(startedAt);
  const env = {
    STORE: store,
    LOCAL_AUTH: "true",
    DEFAULT_TIMEZONE: PREVIEW_TIMEZONE,
    PUBLIC_ORIGIN: origin,
    AUTH_A_PASSWORD: previewPassword,
    AUTH_B_PASSWORD: previewPassword,
    AUTH_SESSION_SECRET: previewSessionSecret,
    AGENT_TOKEN_SECRET: previewAgentSecret,
    ASSETS: { fetch: createAssetFetch(assetDirectory) },
  };
  const handler = createHandler(env, { clock: () => new Date() });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = await toFetchRequest(incoming, origin);
      const response = await handler.fetch(request, env);
      await sendFetchResponse(response, outgoing, incoming.method);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      outgoing.end("Internal Server Error");
      console.error("Workout preview request failed");
    }
  });

  await new Promise((resolveListening, rejectListening) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectListening(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListening();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
    closePromise = new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
      server.closeIdleConnections?.();
    });
    return closePromise;
  };

  return { assetDirectory, close, host, origin, port, server };
}

function printHelp() {
  console.log("Usage: node scripts/preview.mjs [--host 127.0.0.1] [--port 4173] [--assets dist]");
}

async function run() {
  let options;
  try {
    options = parsePreviewArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Workout preview failed: ${error instanceof Error ? error.message : "invalid arguments"}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  let preview;
  try {
    preview = await startPreviewServer(options);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    const message = code === "EADDRINUSE"
      ? `${options.host}:${options.port} is already in use`
      : error instanceof Error ? error.message : "unable to start";
    console.error(`Workout preview failed: ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Workout preview ready at ${preview.origin}`);
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    try {
      await preview.close();
      console.log(`Workout preview stopped (${signal})`);
    } catch {
      console.error("Workout preview failed to stop cleanly");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await run();
