#!/usr/bin/env node

import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_CONFIG_PATH = "wrangler.toml";
export const OUTPUT_CONFIG_PATH = ".wrangler/workout.production.toml";
export const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const REQUIRED_PRODUCTION_SECRET_NAMES = Object.freeze([
  "AGENT_TOKEN_SECRET",
  "ATHLETE_A_EMAIL",
  "ATHLETE_B_EMAIL",
  "AUTH_A_PASSWORD",
  "AUTH_B_PASSWORD",
  "AUTH_SESSION_SECRET",
  "COACH_ENCRYPTION_SECRET",
  "COACH_LOOKUP_SECRET",
]);
export const WORKER_FIRST_ROUTES = Object.freeze(["/", "/api/*", "/coach/*", "/healthz", "/app"]);
const WORKER_FIRST_ROUTES_TOML = `[${WORKER_FIRST_ROUTES.map((route) => JSON.stringify(route)).join(", ")}]`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELEASE_REVISION_PATTERN = /^[0-9a-f]{40}$/;

function replaceExactlyOnce(contents, before, after, label) {
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Committed Wrangler config must contain exactly one expected ${label}`);
  }
  return `${contents.slice(0, first)}${after}${contents.slice(first + before.length)}`;
}

export function normalizeDatabaseId(rawDatabaseId) {
  if (typeof rawDatabaseId !== "string" || rawDatabaseId.length === 0) {
    throw new Error("WORKOUT_D1_DATABASE_ID is required");
  }
  if (rawDatabaseId !== rawDatabaseId.trim() || !UUID_PATTERN.test(rawDatabaseId)) {
    throw new Error("WORKOUT_D1_DATABASE_ID must be a UUID without surrounding whitespace");
  }

  const databaseId = rawDatabaseId.toLowerCase();
  if (databaseId === PLACEHOLDER_DATABASE_ID) {
    throw new Error("WORKOUT_D1_DATABASE_ID must not use the committed placeholder");
  }
  return databaseId;
}

export function normalizeReleaseRevision(rawReleaseRevision) {
  if (typeof rawReleaseRevision !== "string" || rawReleaseRevision.length === 0) {
    throw new Error("WORKOUT_RELEASE_REVISION is required");
  }
  if (!RELEASE_REVISION_PATTERN.test(rawReleaseRevision)) {
    throw new Error("WORKOUT_RELEASE_REVISION must be a lowercase 40-character Git commit SHA");
  }
  return rawReleaseRevision;
}

export function normalizePublicOrigin(rawPublicOrigin) {
  if (typeof rawPublicOrigin !== "string" || rawPublicOrigin.length === 0) {
    throw new Error("WORKOUT_PUBLIC_ORIGIN is required");
  }
  let publicOrigin;
  try {
    publicOrigin = new URL(rawPublicOrigin);
  } catch {
    throw new Error("WORKOUT_PUBLIC_ORIGIN must be an HTTPS origin");
  }
  if (rawPublicOrigin !== publicOrigin.origin
    || publicOrigin.protocol !== "https:"
    || publicOrigin.username !== ""
    || publicOrigin.password !== ""
    || publicOrigin.port !== ""
    || publicOrigin.pathname !== "/"
    || publicOrigin.search !== ""
    || publicOrigin.hash !== ""
    || !publicOrigin.hostname.includes(".")
    || isIP(publicOrigin.hostname) !== 0
    || !/^[a-z0-9.-]+$/.test(publicOrigin.hostname)
    || publicOrigin.hostname.startsWith(".")
    || publicOrigin.hostname.endsWith(".")
    || publicOrigin.hostname.split(".").some((label) => label.length === 0 || label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("WORKOUT_PUBLIC_ORIGIN must be a canonical HTTPS origin without credentials, port, path, query, or fragment");
  }
  return { origin: publicOrigin.origin, host: publicOrigin.hostname };
}

export function normalizeCoachRateLimitNamespaceId(rawNamespaceId) {
  if (typeof rawNamespaceId !== "string" || !/^[1-9][0-9]*$/.test(rawNamespaceId)) {
    throw new Error("WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID must be a positive integer string without leading zeroes");
  }
  return rawNamespaceId;
}

export function renderProductionConfig(sourceConfig, rawDatabaseId, rawReleaseRevision, rawPublicOrigin, rawCoachRateLimitNamespaceId) {
  if (typeof sourceConfig !== "string" || sourceConfig.length === 0) {
    throw new Error("Committed Wrangler config is empty");
  }
  if (/^\s*(?:route|routes)\s*=/m.test(sourceConfig)) {
    throw new Error("Committed Wrangler config must not contain a production route");
  }
  if ([...sourceConfig.matchAll(/^\s*database_id\s*=/gm)].length !== 1) {
    throw new Error("Committed Wrangler config must contain exactly one D1 database_id");
  }
  if (/^\s*RELEASE_REVISION\s*=/m.test(sourceConfig)) {
    throw new Error("Committed Wrangler config must not contain a release revision");
  }
  if (/^\s*\[secrets\]\s*$/m.test(sourceConfig)) {
    throw new Error("Committed Wrangler config must not require production secrets");
  }

  if (/^\s*PRODUCTION_HOST\s*=/m.test(sourceConfig)) {
    throw new Error("Committed Wrangler config must not contain a production host");
  }
  if (/^\s*\[\[ratelimits\]\]\s*$/m.test(sourceConfig)) {
    throw new Error("Committed Wrangler config must not contain a production rate limiter");
  }

  const databaseId = normalizeDatabaseId(rawDatabaseId);
  const releaseRevision = normalizeReleaseRevision(rawReleaseRevision);
  const publicOrigin = normalizePublicOrigin(rawPublicOrigin);
  const coachRateLimitNamespaceId = normalizeCoachRateLimitNamespaceId(rawCoachRateLimitNamespaceId);
  let productionConfig = sourceConfig;
  productionConfig = replaceExactlyOnce(
    productionConfig,
    'main = "src/worker.js"',
    'main = "../src/worker.js"',
    "Worker entry path",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    "preview_urls = false",
    `preview_urls = false\nroutes = [{ pattern = "${publicOrigin.host}", custom_domain = true, previews_enabled = false }]`,
    "preview URL boundary",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    'directory = "./dist"',
    'directory = "../dist"',
    "static asset directory",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    `run_worker_first = ${WORKER_FIRST_ROUTES_TOML}`,
    `run_worker_first = ${WORKER_FIRST_ROUTES_TOML}\n\n[[ratelimits]]\nname = "COACH_RATE_LIMITER"\nnamespace_id = "${coachRateLimitNamespaceId}"\nsimple = { limit = 120, period = 60 }`,
    "Worker-first route boundary",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    `database_id = "${PLACEHOLDER_DATABASE_ID}"`,
    `database_id = "${databaseId}"`,
    "placeholder D1 database_id",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    'migrations_dir = "migrations"',
    'migrations_dir = "../migrations"',
    "D1 migrations directory",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    '[vars]\nENVIRONMENT = "development"',
    `[secrets]\nrequired = ${JSON.stringify(REQUIRED_PRODUCTION_SECRET_NAMES)}\n\n[vars]\nENVIRONMENT = "production"\nRELEASE_REVISION = "${releaseRevision}"`,
    "environment marker",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    'DEFAULT_TIMEZONE = "UTC"',
    `DEFAULT_TIMEZONE = "Asia/Shanghai"\nPRODUCTION_HOST = "${publicOrigin.host}"`,
    "default timezone",
  );
  productionConfig = replaceExactlyOnce(
    productionConfig,
    'PUBLIC_ORIGIN = "http://127.0.0.1:8787"',
    `PUBLIC_ORIGIN = "${publicOrigin.origin}"`,
    "public origin",
  );

  if (productionConfig.includes(PLACEHOLDER_DATABASE_ID)) {
    throw new Error("Generated Wrangler config retained the committed D1 placeholder");
  }
  return productionConfig.endsWith("\n") ? productionConfig : `${productionConfig}\n`;
}

export async function prepareProductionConfig({
  databaseId,
  releaseRevision,
  publicOrigin,
  coachRateLimitNamespaceId,
  dryRun = false,
  sourcePath = SOURCE_CONFIG_PATH,
  outputPath = OUTPUT_CONFIG_PATH,
  readFileImpl = readFile,
  mkdirImpl = mkdir,
  writeFileImpl = writeFile,
  chmodImpl = chmod,
  log = console.log,
} = {}) {
  const sourceConfig = await readFileImpl(sourcePath, "utf8");
  const productionConfig = renderProductionConfig(
    sourceConfig,
    databaseId,
    releaseRevision,
    publicOrigin,
    coachRateLimitNamespaceId,
  );

  if (!dryRun) {
    await mkdirImpl(dirname(outputPath), { recursive: true, mode: 0o700 });
    await writeFileImpl(outputPath, productionConfig, { encoding: "utf8", mode: 0o600 });
    await chmodImpl(outputPath, 0o600);
  }

  log(dryRun
    ? "Production config validated; dry run wrote no file."
    : `Prepared ignored production config at ${outputPath}.`);
  return { dryRun, outputPath };
}

export async function cleanupProductionConfig({
  unlinkImpl = unlink,
  log = console.log,
} = {}) {
  try {
    await unlinkImpl(OUTPUT_CONFIG_PATH);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw new Error("Unable to remove the generated production config");
    }
  }
  log("Generated production config cleanup completed.");
  return { cleaned: true };
}

function parseArguments(argv) {
  if (argv.length === 0) return { mode: "prepare", dryRun: false };
  if (argv.length === 1 && argv[0] === "--dry-run") return { mode: "prepare", dryRun: true };
  if (argv.length === 1 && argv[0] === "--cleanup") return { mode: "cleanup", dryRun: false };
  throw new Error("Usage: node scripts/prepare-production-config.mjs [--dry-run|--cleanup]");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const { mode, dryRun } = parseArguments(process.argv.slice(2));
    if (mode === "cleanup") {
      await cleanupProductionConfig();
    } else {
      await prepareProductionConfig({
        databaseId: process.env.WORKOUT_D1_DATABASE_ID,
        releaseRevision: process.env.WORKOUT_RELEASE_REVISION,
        publicOrigin: process.env.WORKOUT_PUBLIC_ORIGIN,
        coachRateLimitNamespaceId: process.env.WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID,
        dryRun,
      });
    }
  } catch (error) {
    console.error(`Production config preparation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
