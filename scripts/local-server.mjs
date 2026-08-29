import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createHandler } from "../src/http.js";
import { createStore, emptyAthlete } from "../src/store.js";
import { addDays, localDate, opaqueKey, weekdayKey, WEEKDAYS } from "../src/util.js";

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) argumentsByName.set(process.argv[index], process.argv[index + 1]);
const port = Number(argumentsByName.get("--port") ?? 8787);
const assetDirectory = resolve(process.cwd(), argumentsByName.get("--assets") ?? "public");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a valid TCP port");

const store = await createStore({ DEFAULT_TIMEZONE: "Asia/Shanghai" });
const localAthlete = await store.getByEmail("athlete-a@example.invalid");
const localToday = localDate(new Date(), "Asia/Shanghai");
/** @type {Record<string, any>} */
const localWeek = Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
localWeek[weekdayKey(localToday)] = { kind: "workout", title: "本地演示训练", start_time: "08:00", estimated_duration_min: 35, blocks: [{ title: "轻量测试", exercises: [{ exercise_key: "demo_squat", name: "演示深蹲", category: "strength", side_mode: "none", sets: [{ target: { metric: "reps", min: 8, max: 8 }, resistance: { mode: "bodyweight", load_kg: null, quantity: null }, target_rir: 2, target_rpe: null, tempo: null, rest_after_sec: 60, target_incline_percent: null }] }] }] };
localWeek[WEEKDAYS[(WEEKDAYS.indexOf(weekdayKey(localToday)) + 1) % 7]] = { kind: "rest" };
localAthlete.plan_revisions.push({ revision_key: opaqueKey("rev"), revision_sequence: 1, created_at: new Date().toISOString(), effective_from: addDays(localToday, -7), week: localWeek });
await store.save(localAthlete);
const localEnv = {
  STORE: store,
  LOCAL_AUTH: "true",
  PUBLIC_ORIGIN: `http://127.0.0.1:${port === 8788 ? 8787 : port}`,
  AUTH_A_PASSWORD: "local-workout",
  AUTH_B_PASSWORD: "local-workout",
  AUTH_SESSION_SECRET: "local-workout-session-secret-32-bytes",
  ASSETS: { fetch: assetFetch },
};
const handler = createHandler(localEnv);
/** @type {Record<string, string>} */
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wav": "audio/wav" };
/** @param {Request} request @returns {Promise<Response>} */
async function assetFetch(request) {
  const path = new URL(request.url).pathname;
  const file = path === "/" || path === "/app" ? "index.html" : path.slice(1);
  try { return new Response(await readFile(join(assetDirectory, file)), { headers: { "Content-Type": mime[extname(file)] || "application/octet-stream" } }); } catch { return new Response("Not found", { status: 404 }); }
}
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  /** @type {HeadersInit} */
  const headers = Object.entries(req.headers).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : value ? [[key, value.join(", ")]] : []);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks) });
  const response = await handler.fetch(request, localEnv);
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(port, "127.0.0.1", () => console.log(`Workout local API listening on http://127.0.0.1:${port}`));
