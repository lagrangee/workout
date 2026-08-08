// @ts-nocheck

import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { hasId, makeError, McpBridge, WorkoutApiClient } from "./bridge.mjs";

export function createDefaultBridge({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return new McpBridge({ client: new WorkoutApiClient({ origin: env.WORKOUT_AGENT_API_ORIGIN, token: env.WORKOUT_AGENT_TOKEN, fetchImpl }) });
}

export async function runStdio({ input = process.stdin, output = process.stdout, bridge = createDefaultBridge() } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { output.write(`${JSON.stringify(makeError(null, -32700, "Parse error"))}\n`); continue; }
    let response;
    try { response = await bridge.handleMessage(message); } catch (error) { response = hasId(message) ? makeError(message.id, -32000, error instanceof Error ? error.message : String(error)) : null; }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) runStdio().catch((error) => { console.error(`workout-agent-mcp: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
