// @ts-nocheck

import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runStdio } from "./cli.mjs";

const DEFAULT_CONFIG_FILE = join(homedir(), ".config", "workout-agent", "agent.env");
const CONFIG_KEYS = ["WORKOUT_AGENT_API_ORIGIN", "WORKOUT_AGENT_TOKEN"];

/**
 * Read the user-owned MCP configuration without echoing its values.
 * @param {string} [configPath]
 * @returns {Promise<Record<string, string>>}
 */
export async function loadAgentConfig(configPath = process.env.WORKOUT_AGENT_CONFIG_FILE ?? DEFAULT_CONFIG_FILE) {
  let metadata;
  try {
    metadata = await stat(configPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Workout MCP configuration file is missing: ${configPath}`);
    throw new Error("Workout MCP configuration file cannot be inspected");
  }
  if (!metadata.isFile()) throw new Error("Workout MCP configuration path must be a file");
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) throw new Error("Workout MCP configuration file must be owner-only; run chmod 600 on it");

  let contents;
  try {
    contents = await readFile(configPath, "utf8");
  } catch {
    throw new Error("Workout MCP configuration file cannot be read");
  }
  const values = {};
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Workout MCP configuration line ${index + 1} must use KEY=value`);
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!CONFIG_KEYS.includes(key)) throw new Error(`Workout MCP configuration key is unsupported: ${key}`);
    if (!value || value.trim() !== value) throw new Error(`Workout MCP configuration key is empty or padded: ${key}`);
    if (Object.hasOwn(values, key)) throw new Error(`Workout MCP configuration key is duplicated: ${key}`);
    values[key] = value;
  }
  for (const key of CONFIG_KEYS) if (!Object.hasOwn(values, key)) throw new Error(`Workout MCP configuration key is missing: ${key}`);
  return values;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  loadAgentConfig()
    .then((config) => {
      Object.assign(process.env, config);
      return runStdio();
    })
    .catch((error) => {
      console.error(`workout-agent-mcp: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
