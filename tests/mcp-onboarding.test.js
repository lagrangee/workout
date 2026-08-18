import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentConfig } from "../mcp/launch.mjs";

/**
 * @param {string} contents
 * @param {number} mode
 * @param {(path: string) => Promise<unknown>} callback
 */
async function withConfig(contents, mode, callback) {
  const directory = await mkdtemp(join(tmpdir(), "workout-agent-"));
  const path = join(directory, "agent.env");
  try {
    await writeFile(path, contents, "utf8");
    await chmod(path, mode);
    return await callback(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("local MCP onboarding reads origin and credential from an owner-only file", async () => {
  await withConfig(
    "# Values stay outside the repository\nWORKOUT_AGENT_API_ORIGIN=https://workout.example\nWORKOUT_AGENT_TOKEN=local-test-token\n",
    0o600,
    async (path) => {
      assert.deepEqual(await loadAgentConfig(path), {
        WORKOUT_AGENT_API_ORIGIN: "https://workout.example",
        WORKOUT_AGENT_TOKEN: "local-test-token",
      });
    },
  );
});

test("local MCP onboarding accepts an optional training archive path", async () => {
  await withConfig(
    "WORKOUT_AGENT_API_ORIGIN=https://workout.example\nWORKOUT_AGENT_TOKEN=local-test-token\nWORKOUT_ARCHIVE_DIR=/private/tmp/training\n",
    0o600,
    async (path) => {
      assert.deepEqual(await loadAgentConfig(path), {
        WORKOUT_AGENT_API_ORIGIN: "https://workout.example",
        WORKOUT_AGENT_TOKEN: "local-test-token",
        WORKOUT_ARCHIVE_DIR: "/private/tmp/training",
      });
    },
  );
});

test("local MCP onboarding reports missing configuration without exposing a credential", async () => {
  await assert.rejects(
    loadAgentConfig("/private/tmp/workout-agent-config-does-not-exist"),
    (error) => error instanceof Error && /configuration file is missing/i.test(error.message),
  );

  await withConfig(
    "WORKOUT_AGENT_API_ORIGIN=https://workout.example\n",
    0o600,
    async (path) => {
      await assert.rejects(
        loadAgentConfig(path),
        (error) => error instanceof Error && /WORKOUT_AGENT_TOKEN/.test(error.message) && !/secret-value/.test(error.message),
      );
    },
  );
});

test("local MCP onboarding rejects group-readable credential files", async () => {
  await withConfig(
    "WORKOUT_AGENT_API_ORIGIN=https://workout.example\nWORKOUT_AGENT_TOKEN=secret-value\n",
    0o640,
    async (path) => {
      await assert.rejects(
        loadAgentConfig(path),
        (error) => error instanceof Error && /owner-only/i.test(error.message) && !/secret-value/.test(error.message),
      );
    },
  );
});
