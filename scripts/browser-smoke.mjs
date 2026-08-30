#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import runBrowserSmoke from "../tests/e2e/browser-smoke.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const previewOrigin = "http://127.0.0.1:4173";
const previewScript = resolve(repositoryRoot, "scripts/preview.mjs");

class SmokeFailure extends Error {
  constructor(phase, message) {
    super(message);
    this.name = "SmokeFailure";
    this.phase = phase;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function previewDiagnostic(output) {
  return output.match(/Workout preview failed:[^\r\n]*/)?.[0] ?? null;
}

async function waitForPreview(preview, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null || preview.signalCode !== null) {
      throw new SmokeFailure(
        "preview",
        previewDiagnostic(output()) ?? "the preview server exited before becoming healthy",
      );
    }
    try {
      const response = await fetch(`${previewOrigin}/healthz`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(1_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 200 && body?.ok === true && body?.service === "workout-tracker") return;
    } catch {
      // The preview may still be binding the fixed loopback port.
    }
    await delay(100);
  }
  throw new SmokeFailure("preview", "the preview health endpoint did not become ready");
}

function waitForClose(child) {
  return new Promise((resolveClose) => child.once("close", () => resolveClose()));
}

async function stopPreview(preview) {
  if (!preview) return;
  if (preview.exitCode === null && preview.signalCode === null) {
    const closed = waitForClose(preview);
    preview.kill("SIGTERM");
    const graceful = await Promise.race([
      closed.then(() => true),
      delay(5_000).then(() => false),
    ]);
    if (!graceful) {
      preview.kill("SIGKILL");
      await closed;
    }
  }
  preview.stdout?.destroy();
  preview.stderr?.destroy();
}

async function run() {
  const preview = spawn(process.execPath, [previewScript, "--host", "127.0.0.1", "--port", "4173", "--assets", "dist"], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let previewOutput = "";
  const collectPreviewOutput = (chunk) => {
    previewOutput = `${previewOutput}${String(chunk)}`.slice(-16_384);
  };
  preview.stdout.on("data", collectPreviewOutput);
  preview.stderr.on("data", collectPreviewOutput);

  let browser;
  try {
    await waitForPreview(preview, () => previewOutput);
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      throw new SmokeFailure(
        "browser-open",
        "the pinned Chromium runtime is unavailable; run npm run test:browser:install",
      );
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await Promise.race([
      runBrowserSmoke(page),
      delay(120_000).then(() => {
        throw new SmokeFailure("browser-flow", "the browser flow timed out");
      }),
    ]).catch((error) => {
      if (error instanceof SmokeFailure) throw error;
      if (error instanceof Error && /^\[browser-smoke:[a-z0-9-]+\]/i.test(error.message)) {
        throw new SmokeFailure("browser-flow", error.message);
      }
      throw new SmokeFailure("browser-flow", "the browser flow did not complete");
    });
    console.log("Workout browser smoke passed");
  } finally {
    await browser?.close().catch(() => {});
    await stopPreview(preview);
  }
}

try {
  await run();
} catch (error) {
  const phase = error instanceof SmokeFailure ? error.phase : "runner";
  const message = error instanceof SmokeFailure ? error.message : "an unexpected runner failure occurred";
  console.error(`Workout browser smoke failed during ${phase}: ${message}`);
  process.exitCode = 1;
}

// This file is a process-owning CLI. Node 26 can retain an already-closed
// ChildProcess handle after Playwright and the preview have both shut down.
// All cleanup above is awaited, so exit explicitly with the established result.
process.exit(process.exitCode ?? 0);
