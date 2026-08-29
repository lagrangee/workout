#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  OUTPUT_CONFIG_PATH,
  PLACEHOLDER_DATABASE_ID,
  REQUIRED_PRODUCTION_SECRET_NAMES,
  WORKER_FIRST_ROUTES,
  normalizeCoachRateLimitNamespaceId,
  normalizeDatabaseId,
  normalizePublicOrigin,
  normalizeReleaseRevision,
} from "./prepare-production-config.mjs";

const execFileAsync = promisify(execFile);
const WRANGLER_ENTRY_PATH = "node_modules/wrangler/bin/wrangler.js";
const PRODUCTION_DATABASE_NAME = "workout-tracker";
const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const ZERO_GIT_REVISION = "0000000000000000000000000000000000000000";
const MIGRATION_PATHSPEC = ":(glob)migrations/*.sql";

export const REQUIRED_WORKER_SECRET_NAMES = REQUIRED_PRODUCTION_SECRET_NAMES;

export const D1_READ_ONLY_PROBE = `SELECT
  (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'athlete_state') AS athlete_state_table,
  (SELECT COUNT(*) FROM pragma_table_info('athlete_state') WHERE name = 'mutation_owner') AS athlete_state_mutation_owner,
  (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'plans') AS plans_table,
  (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'sessions') AS sessions_table,
  (SELECT COUNT(*) FROM pragma_table_info('plan_exercises') WHERE name = 'category') AS plan_exercises_category,
  (SELECT COUNT(*) FROM pragma_table_info('session_exercises') WHERE name = 'category') AS session_exercises_category,
  (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN (
    'plan_exercises_category_required_insert',
    'plan_exercises_category_required_update',
    'session_exercises_category_required_insert',
    'session_exercises_category_required_update'
  )) AS category_guard_triggers,
  (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'd1_migrations') AS migration_ledger_table;
SELECT name FROM d1_migrations ORDER BY id;
PRAGMA foreign_key_check;`;

function fixedError(message) {
  return new Error(message);
}

function parseJsonOutput(output, label) {
  if (typeof output !== "string") throw fixedError(`${label} returned no JSON output`);
  try {
    return JSON.parse(output);
  } catch {
    throw fixedError(`${label} returned invalid JSON output`);
  }
}

function exactStringEqual(first, second) {
  const firstBytes = Buffer.from(first, "utf8");
  const secondBytes = Buffer.from(second, "utf8");
  return firstBytes.length === secondBytes.length && timingSafeEqual(firstBytes, secondBytes);
}

export function readGeneratedDatabaseIdentity(configContents) {
  if (typeof configContents !== "string" || configContents.length === 0) {
    throw fixedError("Generated production config is unavailable");
  }
  const databaseNames = [...configContents.matchAll(/^\s*database_name\s*=\s*"([^"]+)"\s*$/gm)];
  const databaseIds = [...configContents.matchAll(/^\s*database_id\s*=\s*"([^"]+)"\s*$/gm)];
  const routeHosts = [...configContents.matchAll(/^\s*routes\s*=\s*\[\{\s*pattern\s*=\s*"([^"]+)"/gm)];
  const productionHosts = [...configContents.matchAll(/^\s*PRODUCTION_HOST\s*=\s*"([^"]+)"\s*$/gm)];
  const publicOrigins = [...configContents.matchAll(/^\s*PUBLIC_ORIGIN\s*=\s*"([^"]+)"\s*$/gm)];
  const releaseRevisions = [...configContents.matchAll(/^\s*RELEASE_REVISION\s*=\s*"([^"]+)"\s*$/gm)];
  const workerFirstRoutes = [...configContents.matchAll(/^\s*run_worker_first\s*=\s*(\[[^\r\n]+\])\s*$/gm)];
  const requiredSecrets = [...configContents.matchAll(/^\s*required\s*=\s*(\[[^\r\n]+\])\s*$/gm)];
  const rateLimitBlocks = [...configContents.matchAll(/^\s*\[\[ratelimits\]\]\s*\n\s*name\s*=\s*"COACH_RATE_LIMITER"\s*\n\s*namespace_id\s*=\s*"([^"]+)"\s*\n\s*simple\s*=\s*\{\s*limit\s*=\s*120\s*,\s*period\s*=\s*60\s*\}\s*$/gm)];
  if (!configContents.startsWith(`name = "${PRODUCTION_DATABASE_NAME}"\n`)
    || databaseNames.length !== 1 || databaseNames[0][1] !== PRODUCTION_DATABASE_NAME || databaseIds.length !== 1
    || routeHosts.length !== 1 || productionHosts.length !== 1 || publicOrigins.length !== 1
    || releaseRevisions.length !== 1 || workerFirstRoutes.length !== 1 || requiredSecrets.length !== 1
    || rateLimitBlocks.length !== 1
    || [...configContents.matchAll(/^\s*\[\[ratelimits\]\]\s*$/gm)].length !== 1
    || !/^\s*ENVIRONMENT\s*=\s*"production"\s*$/m.test(configContents)
    || !/^\s*DEFAULT_TIMEZONE\s*=\s*"Asia\/Shanghai"\s*$/m.test(configContents)) {
    throw fixedError("Generated production config has an unexpected production binding structure");
  }
  const databaseId = normalizeDatabaseId(databaseIds[0][1]);
  if (databaseId === PLACEHOLDER_DATABASE_ID) {
    throw fixedError("Generated production config retained the D1 placeholder");
  }
  let publicOrigin;
  try {
    publicOrigin = normalizePublicOrigin(publicOrigins[0][1]);
  } catch {
    throw fixedError("Generated production config has an unexpected custom-domain structure");
  }
  if (!exactStringEqual(publicOrigin.host, routeHosts[0][1])
    || !exactStringEqual(publicOrigin.host, productionHosts[0][1])) {
    throw fixedError("Generated production config has an unexpected custom-domain structure");
  }
  try {
    normalizeReleaseRevision(releaseRevisions[0][1]);
    normalizeCoachRateLimitNamespaceId(rateLimitBlocks[0][1]);
    if (!exactStringEqual(JSON.stringify(JSON.parse(workerFirstRoutes[0][1])), JSON.stringify(WORKER_FIRST_ROUTES))
      || !exactStringEqual(JSON.stringify(JSON.parse(requiredSecrets[0][1])), JSON.stringify(REQUIRED_PRODUCTION_SECRET_NAMES))) {
      throw fixedError("Generated production config has an unexpected deployment binding structure");
    }
  } catch {
    throw fixedError("Generated production config has an unexpected deployment binding structure");
  }
  return { databaseName: PRODUCTION_DATABASE_NAME, databaseId, publicHost: publicOrigin.host };
}

export function verifyWorkerSecretInventory(output) {
  const inventory = parseJsonOutput(output, "Worker secret inventory");
  if (!Array.isArray(inventory)) throw fixedError("Worker secret inventory has an unexpected structure");
  const names = new Set();
  for (const entry of inventory) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw fixedError("Worker secret inventory has an unexpected structure");
    }
    if (!exactStringEqual(JSON.stringify(Object.keys(entry).sort()), JSON.stringify(["name", "type"]))) {
      throw fixedError("Worker secret inventory exposed an unexpected field");
    }
    if (typeof entry.name !== "string" || entry.type !== "secret_text" || names.has(entry.name)) {
      throw fixedError("Worker secret inventory has an unexpected structure");
    }
    names.add(entry.name);
  }
  const missing = REQUIRED_WORKER_SECRET_NAMES.filter((name) => !names.has(name));
  if (missing.length > 0) throw fixedError(`Production Worker is missing required secret names: ${missing.join(", ")}`);
  return { requiredSecretCount: REQUIRED_WORKER_SECRET_NAMES.length };
}

export function verifyD1Inventory(output, expectedDatabaseId) {
  const inventory = parseJsonOutput(output, "D1 identity check");
  if (!Array.isArray(inventory)) {
    throw fixedError("D1 identity check has an unexpected structure");
  }
  const matches = inventory.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    && entry.name === PRODUCTION_DATABASE_NAME);
  if (matches.length !== 1 || typeof matches[0].uuid !== "string") {
    throw fixedError("D1 identity check has an unexpected structure");
  }
  let actualDatabaseId;
  try {
    actualDatabaseId = normalizeDatabaseId(matches[0].uuid);
  } catch {
    throw fixedError("D1 identity check has an unexpected structure");
  }
  if (!exactStringEqual(actualDatabaseId, expectedDatabaseId)) {
    throw fixedError("Generated D1 binding does not match the named production database");
  }
  return { databaseName: PRODUCTION_DATABASE_NAME };
}

export function verifyCustomDomainInventory(output, expectedHost) {
  const envelope = parseJsonOutput(output, "Custom domain inventory");
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || envelope.success !== true || !Array.isArray(envelope.result)) {
    throw fixedError("Custom domain inventory has an unexpected structure");
  }
  const matches = envelope.result.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    && entry.service === PRODUCTION_DATABASE_NAME);
  if (matches.length !== 1 || typeof matches[0].hostname !== "string"
    || !exactStringEqual(matches[0].hostname, expectedHost)) {
    throw fixedError("Production custom domain does not exactly match the generated origin");
  }
  return { customDomainCount: 1 };
}

export function validateLocalMigrationNames(localMigrationNames) {
  if (!Array.isArray(localMigrationNames) || localMigrationNames.length === 0) {
    throw fixedError("Local migration inventory is empty");
  }
  const expectedMigrations = [...localMigrationNames].sort();
  if (new Set(expectedMigrations).size !== expectedMigrations.length
    || expectedMigrations.some((name) => typeof name !== "string" || !MIGRATION_FILE_PATTERN.test(name))) {
    throw fixedError("Local migration inventory has an unexpected structure");
  }
  for (const [index, name] of expectedMigrations.entries()) {
    const expectedPrefix = String(index + 1).padStart(4, "0");
    if (!name.startsWith(`${expectedPrefix}_`)) {
      throw fixedError("Local migration inventory must use consecutive four-digit numbers");
    }
  }
  return expectedMigrations;
}

export function verifyD1SchemaAndMigrations(output, localMigrationNames) {
  const results = parseJsonOutput(output, "D1 schema check");
  if (!Array.isArray(results) || results.length !== 3) {
    throw fixedError("D1 schema check has an unexpected structure");
  }
  for (const result of results) {
    if (!result || typeof result !== "object" || result.success !== true || !Array.isArray(result.results)) {
      throw fixedError("D1 schema check failed");
    }
    if (result.meta && typeof result.meta === "object"
      && (result.meta.changed_db === true || Number(result.meta.rows_written ?? 0) > 0 || Number(result.meta.changes ?? 0) > 0)) {
      throw fixedError("D1 read-only probe reported a database mutation");
    }
  }
  if (results[0].results.length !== 1) throw fixedError("D1 schema signature is incomplete");
  const expectedSchemaSignature = {
    athlete_state_table: 1,
    athlete_state_mutation_owner: 1,
    plans_table: 1,
    sessions_table: 1,
    plan_exercises_category: 1,
    session_exercises_category: 1,
    category_guard_triggers: 4,
    migration_ledger_table: 1,
  };
  const schemaSignature = results[0].results[0];
  if (!schemaSignature || typeof schemaSignature !== "object" || Array.isArray(schemaSignature)
    || !exactStringEqual(JSON.stringify(Object.keys(schemaSignature).sort()), JSON.stringify(Object.keys(expectedSchemaSignature).sort()))
    || Object.entries(expectedSchemaSignature).some(([key, value]) => schemaSignature[key] !== value)) {
    throw fixedError("D1 schema signature does not match this release");
  }
  const expectedMigrations = validateLocalMigrationNames(localMigrationNames);
  const appliedMigrations = results[1].results.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || !exactStringEqual(JSON.stringify(Object.keys(row)), JSON.stringify(["name"]))
      || typeof row.name !== "string" || !MIGRATION_FILE_PATTERN.test(row.name)) {
      throw fixedError("D1 migration ledger has an unexpected structure");
    }
    return row.name;
  });
  if (!exactStringEqual(JSON.stringify(appliedMigrations), JSON.stringify(expectedMigrations))) {
    throw fixedError("D1 migration ledger does not exactly match the committed migrations");
  }
  if (results[2].results.length !== 0) throw fixedError("D1 foreign key integrity check failed");
  return { migrationCount: expectedMigrations.length };
}

async function defaultRunCommand(arguments_) {
  const { stdout } = await execFileAsync(process.execPath, [WRANGLER_ENTRY_PATH, ...arguments_], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
    shell: false,
    env: {
      ...process.env,
      WRANGLER_NO_SKILLS_UPDATE_PROMPTS: "true",
      WRANGLER_SEND_METRICS: "false",
    },
  });
  return stdout;
}

async function defaultFetchDomains({ accountId, apiToken }) {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/domains`);
  url.searchParams.set("service", PRODUCTION_DATABASE_NAME);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) throw fixedError("Custom domain inventory request failed");
  return body;
}

async function defaultListMigrations() {
  const entries = await readdir("migrations", { withFileTypes: true });
  const sqlEntries = entries.filter((entry) => entry.name.endsWith(".sql"));
  if (sqlEntries.some((entry) => !entry.isFile())) throw fixedError("Local migration inventory contains a non-file SQL entry");
  return validateLocalMigrationNames(sqlEntries.map((entry) => entry.name));
}

export async function verifyRemoteMain({
  expectedRevision,
  runGitImpl = async (arguments_) => {
    const { stdout } = await execFileAsync("git", arguments_, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    return stdout;
  },
  log = console.log,
} = {}) {
  const revision = normalizeReleaseRevision(expectedRevision);
  let output;
  try {
    output = await runGitImpl(["ls-remote", "--exit-code", "origin", "refs/heads/main"]);
  } catch {
    throw fixedError("Unable to read the public remote main revision");
  }
  const match = /^([0-9a-f]{40})\trefs\/heads\/main\n?$/.exec(output);
  if (!match) throw fixedError("Remote main revision lookup returned an unexpected structure");
  if (!exactStringEqual(revision, match[1])) throw fixedError("Workflow revision is no longer the remote main tip");
  log("Confirmed workflow revision is the current public main tip.");
  return { revisionVerified: true };
}

export async function verifyForwardOnlyMigrations({
  baseRevision,
  currentRevision,
  runGitImpl = async (arguments_) => {
    const { stdout } = await execFileAsync("git", arguments_, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    return stdout;
  },
  listMigrationsImpl = defaultListMigrations,
  log = console.log,
} = {}) {
  let current;
  try {
    current = normalizeReleaseRevision(currentRevision);
  } catch {
    throw fixedError("Migration history check has an invalid current revision");
  }

  let base = baseRevision;
  if (base === undefined || base === "" || base === ZERO_GIT_REVISION) {
    try {
      const output = await runGitImpl(["rev-parse", "--verify", `${current}^`]);
      const match = /^([0-9a-f]{40})\n?$/.exec(output);
      if (!match) throw fixedError("Migration history base lookup returned an unexpected structure");
      base = match[1];
    } catch {
      throw fixedError("Unable to resolve the migration history base revision");
    }
  } else {
    try {
      base = normalizeReleaseRevision(base);
    } catch {
      throw fixedError("Migration history check has an invalid base revision");
    }
  }

  try {
    await runGitImpl(["merge-base", "--is-ancestor", base, current]);
    const immutableChanges = await runGitImpl([
      "diff", "--no-ext-diff", "--find-renames=50%", "--name-only", "-z", "--diff-filter=DMRTUXB",
      base, current, "--", MIGRATION_PATHSPEC,
    ]);
    if (immutableChanges !== "") {
      throw fixedError("Previously committed D1 migrations are immutable");
    }
    validateLocalMigrationNames(await listMigrationsImpl());
  } catch {
    throw fixedError("Forward-only D1 migration history check failed");
  }

  log("Confirmed D1 migration history is forward-only for this revision.");
  return { forwardOnly: true };
}

export async function preflightProductionDeploy({
  configPath = OUTPUT_CONFIG_PATH,
  readFileImpl = readFile,
  listMigrationsImpl = defaultListMigrations,
  runCommandImpl = defaultRunCommand,
  fetchDomainsImpl = defaultFetchDomains,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  log = console.log,
} = {}) {
  let configContents;
  try {
    configContents = await readFileImpl(configPath, "utf8");
  } catch {
    throw fixedError("Generated production config is unavailable");
  }
  const identity = readGeneratedDatabaseIdentity(configContents);
  if (typeof accountId !== "string" || accountId.length === 0 || typeof apiToken !== "string" || apiToken.length === 0) {
    throw fixedError("Cloudflare production preflight credentials are unavailable");
  }
  let localMigrationNames;
  try {
    localMigrationNames = validateLocalMigrationNames(await listMigrationsImpl());
  } catch {
    throw fixedError("Local migration inventory check failed");
  }
  let secrets;
  let migrations;
  try {
    const secretOutput = await runCommandImpl(["secret", "list", "--name", PRODUCTION_DATABASE_NAME, "--config", configPath, "--format", "json"]);
    secrets = verifyWorkerSecretInventory(secretOutput);
    const inventoryOutput = await runCommandImpl(["d1", "list", "--config", configPath, "--json"]);
    verifyD1Inventory(inventoryOutput, identity.databaseId);
    const schemaOutput = await runCommandImpl([
      "d1", "execute", "DB", "--remote", "--config", configPath,
      "--command", D1_READ_ONLY_PROBE, "--json",
    ]);
    migrations = verifyD1SchemaAndMigrations(schemaOutput, localMigrationNames);
    const domainOutput = await fetchDomainsImpl({ accountId, apiToken });
    verifyCustomDomainInventory(domainOutput, identity.publicHost);
  } catch {
    throw fixedError("Cloudflare production preflight command failed");
  }
  log(`Production preflight confirmed ${secrets.requiredSecretCount} required Worker secret names and ${migrations.migrationCount} applied D1 migrations.`);
  return { requiredSecretCount: secrets.requiredSecretCount, migrationCount: migrations.migrationCount };
}

function parseArguments(argv) {
  if (argv.length === 0) return "cloudflare";
  if (argv.length === 1 && argv[0] === "--verify-main") return "verify-main";
  if (argv.length === 1 && argv[0] === "--verify-migrations") return "verify-migrations";
  throw fixedError("Usage: node scripts/preflight-production-deploy.mjs [--verify-main|--verify-migrations]");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const mode = parseArguments(process.argv.slice(2));
    if (mode === "verify-main") {
      await verifyRemoteMain({ expectedRevision: process.env.EXPECTED_GITHUB_SHA });
    } else if (mode === "verify-migrations") {
      await verifyForwardOnlyMigrations({
        baseRevision: process.env.MIGRATION_BASE_SHA,
        currentRevision: process.env.EXPECTED_GITHUB_SHA,
      });
    } else {
      await preflightProductionDeploy();
    }
  } catch (error) {
    console.error(`Production preflight failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
