import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createHandler } from "../src/http.js";
import { createStore, emptyAthlete } from "../src/store.js";
import { addDays, localDate, opaqueKey, weekdayKey, WEEKDAYS } from "../src/util.js";

const store = await createStore({ DEFAULT_TIMEZONE: "Asia/Shanghai" });
const localAthlete = await store.getByEmail("athlete-a@example.invalid");
const localToday = localDate(new Date(), "Asia/Shanghai");
/** @type {Record<string, any>} */
const localWeek = Object.fromEntries(WEEKDAYS.map((day) => [day, null]));
localWeek[weekdayKey(localToday)] = { kind: "workout", title: "本地演示训练", start_time: "08:00", estimated_duration_min: 35, blocks: [{ title: "轻量测试", exercises: [{ exercise_key: "demo_squat", name: "演示深蹲", category: "strength", side_mode: "none", sets: [{ target: { metric: "reps", min: 8, max: 8 }, resistance: { mode: "bodyweight", load_kg: null, quantity: null }, target_rir: 2, target_rpe: null, tempo: null, rest_after_sec: 60, target_incline_percent: null }] }] }] };
localWeek[WEEKDAYS[(WEEKDAYS.indexOf(weekdayKey(localToday)) + 1) % 7]] = { kind: "rest" };
localAthlete.plan_revisions.push({ revision_key: opaqueKey("rev"), revision_sequence: 1, created_at: new Date().toISOString(), effective_from: addDays(localToday, -7), week: localWeek });
await store.save(localAthlete);
const handler = createHandler({ STORE: store, LOCAL_AUTH: "true", PUBLIC_ORIGIN: "http://127.0.0.1:8787", ASSETS: { fetch: assetFetch } });
/** @type {Record<string, string>} */
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
/** @param {Request} request @returns {Promise<Response>} */
async function assetFetch(request) {
  const path = new URL(request.url).pathname;
  const file = path === "/" || path === "/app" ? "index.html" : path.slice(1);
  try { return new Response(await readFile(join(process.cwd(), "public", file)), { headers: { "Content-Type": mime[extname(file)] || "application/octet-stream" } }); } catch { return new Response("Not found", { status: 404 }); }
}
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  /** @type {HeadersInit} */
  const headers = Object.entries(req.headers).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : value ? [[key, value.join(", ")]] : []);
  const request = new Request(`http://127.0.0.1:8787${req.url}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks) });
  const response = await handler.fetch(request, { LOCAL_AUTH: "true", PUBLIC_ORIGIN: "http://127.0.0.1:8787", ASSETS: { fetch: assetFetch } });
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(8787, "127.0.0.1", () => console.log("Workout local server listening on http://127.0.0.1:8787/app"));
