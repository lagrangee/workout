#!/usr/bin/env node

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { OUTPUT_CONFIG_PATH, normalizeReleaseRevision } from "./prepare-production-config.mjs";

const execFileAsync = promisify(execFile);
const WRANGLER_ENTRY_PATH = "node_modules/wrangler/bin/wrangler.js";

export function normalizeDeploymentMessage(rawMessage) {
  if (typeof rawMessage !== "string" || !rawMessage.startsWith("GitHub ")) {
    throw new Error("Deployment message must bind the GitHub commit SHA");
  }
  const revision = rawMessage.slice("GitHub ".length);
  normalizeReleaseRevision(revision);
  return `GitHub ${revision}`;
}

async function defaultRunCommand(arguments_, options) {
  return execFileAsync(process.execPath, [WRANGLER_ENTRY_PATH, ...arguments_], options);
}

export async function deployProduction({
  message,
  runCommandImpl = defaultRunCommand,
  log = console.log,
} = {}) {
  const deploymentMessage = normalizeDeploymentMessage(message);
  const arguments_ = [
    "deploy",
    "--strict",
    "--config",
    OUTPUT_CONFIG_PATH,
    "--message",
    deploymentMessage,
  ];
  try {
    await runCommandImpl(arguments_, {
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_NO_SKILLS_UPDATE_PROMPTS: "true",
        WRANGLER_SEND_METRICS: "false",
      },
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      timeout: 10 * 60_000,
    });
  } catch {
    throw new Error("Wrangler production deployment failed");
  }
  log("Production deployment command completed; public revision readback is still required.");
  return { deployed: true };
}

function parseArguments(argv) {
  if (argv.length === 2 && argv[0] === "--message") return { message: argv[1] };
  throw new Error("Usage: node scripts/deploy-production.mjs --message \"GitHub <commit-sha>\"");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    await deployProduction(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(`Production deploy failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
