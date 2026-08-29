// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  OUTPUT_CONFIG_PATH,
  PLACEHOLDER_DATABASE_ID,
  normalizeDatabaseId,
  normalizeCoachRateLimitNamespaceId,
  normalizePublicOrigin,
  normalizeReleaseRevision,
  cleanupProductionConfig,
  prepareProductionConfig,
  renderProductionConfig,
} from "../scripts/prepare-production-config.mjs";
import {
  D1_READ_ONLY_PROBE,
  REQUIRED_WORKER_SECRET_NAMES,
  preflightProductionDeploy,
  readGeneratedDatabaseIdentity,
  validateLocalMigrationNames,
  verifyD1Inventory,
  verifyD1SchemaAndMigrations,
  verifyCustomDomainInventory,
  verifyForwardOnlyMigrations,
  verifyRemoteMain,
  verifyWorkerSecretInventory,
} from "../scripts/preflight-production-deploy.mjs";
import {
  deployProduction,
  normalizeDeploymentMessage,
} from "../scripts/deploy-production.mjs";

const SYNTHETIC_DATABASE_ID = "11111111-2222-4333-8444-555555555555";
const SYNTHETIC_RELEASE_REVISION = "0123456789abcdef0123456789abcdef01234567";
const SYNTHETIC_PRODUCTION_HOST = "workout.example.invalid";
const SYNTHETIC_PRODUCTION_ORIGIN = `https://${SYNTHETIC_PRODUCTION_HOST}`;
const SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID = "1001";

function stripComment(line, marker) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inDoubleQuote && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === '"' && !inSingleQuote && !escaped) inDoubleQuote = !inDoubleQuote;
    if (character === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    if (character === marker && !inSingleQuote && !inDoubleQuote && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
    escaped = false;
  }
  return line.trimEnd();
}

function parseYamlScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner ? inner.split(",").map((entry) => parseYamlScalar(entry)) : [];
  }
  if (value.length === 0) throw new Error("YAML scalar must not be empty");
  return value;
}

function yamlMappingEntry(text, lineNumber) {
  const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(text);
  if (!match) throw new Error(`Unsupported YAML mapping at line ${lineNumber}`);
  return { key: match[1], rawValue: match[2].trim() };
}

/** Parse the strict YAML subset used by the deploy workflow into maps and sequences. */
function parseWorkflowYaml(source) {
  const lines = source.split(/\r?\n/).flatMap((rawLine, index) => {
    if (rawLine.includes("\t")) throw new Error(`Tabs are forbidden in workflow YAML at line ${index + 1}`);
    const line = stripComment(rawLine, "#");
    if (line.trim().length === 0) return [];
    const indent = line.length - line.trimStart().length;
    return [{ indent, text: line.trimStart(), lineNumber: index + 1 }];
  });

  function parseBlock(startIndex, indent) {
    if (!lines[startIndex] || lines[startIndex].indent !== indent) {
      throw new Error(`Unexpected YAML indentation near line ${lines[startIndex]?.lineNumber ?? "EOF"}`);
    }
    return lines[startIndex].text.startsWith("- ")
      ? parseSequence(startIndex, indent)
      : parseMapping(startIndex, indent);
  }

  function parseMapping(startIndex, indent) {
    const result = {};
    let index = startIndex;
    while (index < lines.length && lines[index].indent === indent && !lines[index].text.startsWith("- ")) {
      const { key, rawValue } = yamlMappingEntry(lines[index].text, lines[index].lineNumber);
      if (Object.hasOwn(result, key)) throw new Error(`Duplicate YAML key ${key}`);
      if (rawValue.length > 0) {
        result[key] = parseYamlScalar(rawValue);
        index += 1;
        continue;
      }
      const nextLine = lines[index + 1];
      if (nextLine && nextLine.indent > indent) {
        if (nextLine.indent !== indent + 2) throw new Error(`Unexpected YAML indentation at line ${nextLine.lineNumber}`);
        const nested = parseBlock(index + 1, indent + 2);
        result[key] = nested.value;
        index = nested.nextIndex;
      } else {
        result[key] = null;
        index += 1;
      }
    }
    return { value: result, nextIndex: index };
  }

  function parseSequence(startIndex, indent) {
    const result = [];
    let index = startIndex;
    while (index < lines.length && lines[index].indent === indent && lines[index].text.startsWith("- ")) {
      const firstEntry = yamlMappingEntry(lines[index].text.slice(2), lines[index].lineNumber);
      if (firstEntry.rawValue.length === 0) throw new Error(`Sequence keys need inline values at line ${lines[index].lineNumber}`);
      const item = { [firstEntry.key]: parseYamlScalar(firstEntry.rawValue) };
      index += 1;
      if (lines[index] && lines[index].indent > indent) {
        if (lines[index].indent !== indent + 2) throw new Error(`Unexpected YAML indentation at line ${lines[index].lineNumber}`);
        const continuation = parseMapping(index, indent + 2);
        for (const [key, value] of Object.entries(continuation.value)) {
          if (Object.hasOwn(item, key)) throw new Error(`Duplicate YAML sequence key ${key}`);
          item[key] = value;
        }
        index = continuation.nextIndex;
      }
      result.push(item);
    }
    return { value: result, nextIndex: index };
  }

  if (lines.length === 0) throw new Error("Workflow YAML is empty");
  const parsed = parseBlock(0, 0);
  if (parsed.nextIndex !== lines.length) throw new Error(`Unparsed workflow YAML at line ${lines[parsed.nextIndex].lineNumber}`);
  return parsed.value;
}

function splitTomlItems(source) {
  const parts = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === '"' && !escaped) inString = !inString;
    if (!inString) {
      if (character === "{") braceDepth += 1;
      if (character === "}") braceDepth -= 1;
      if (character === "[") bracketDepth += 1;
      if (character === "]") bracketDepth -= 1;
      if (character === "," && braceDepth === 0 && bracketDepth === 0) {
        parts.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }
    escaped = false;
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function splitTomlAssignment(source) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString && character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === '"' && !escaped) inString = !inString;
    if (character === "=" && !inString) {
      return [source.slice(0, index).trim(), source.slice(index + 1).trim()];
    }
    escaped = false;
  }
  throw new Error(`Unsupported TOML assignment: ${source}`);
}

function parseTomlScalar(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner ? splitTomlItems(inner).map(parseTomlScalar) : [];
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const result = {};
    for (const item of splitTomlItems(value.slice(1, -1).trim())) {
      const [key, itemValue] = splitTomlAssignment(item);
      if (!/^[A-Za-z0-9_-]+$/.test(key) || Object.hasOwn(result, key)) throw new Error(`Invalid TOML inline key ${key}`);
      result[key] = parseTomlScalar(itemValue);
    }
    return result;
  }
  throw new Error(`Unsupported TOML value: ${value}`);
}

/** Parse the strict TOML subset committed and generated for Wrangler. */
function parseWranglerToml(source) {
  const root = {};
  let current = root;
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = stripComment(rawLine, "#").trim();
    if (line.length === 0) continue;
    const arrayTable = /^\[\[([A-Za-z0-9_-]+)\]\]$/.exec(line);
    if (arrayTable) {
      const tableName = arrayTable[1];
      if (!Object.hasOwn(root, tableName)) root[tableName] = [];
      if (!Array.isArray(root[tableName])) throw new Error(`Conflicting TOML table ${tableName}`);
      current = {};
      root[tableName].push(current);
      continue;
    }
    const table = /^\[([A-Za-z0-9_-]+)\]$/.exec(line);
    if (table) {
      const tableName = table[1];
      if (Object.hasOwn(root, tableName)) throw new Error(`Duplicate TOML table ${tableName}`);
      current = {};
      root[tableName] = current;
      continue;
    }
    const [key, rawValue] = splitTomlAssignment(line);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`Invalid TOML key at line ${index + 1}`);
    if (Object.hasOwn(current, key)) throw new Error(`Duplicate TOML key ${key}`);
    current[key] = parseTomlScalar(rawValue);
  }
  return root;
}

test("production config is derived from the public placeholder without mutating it", async () => {
  const sourceConfig = await readFile("wrangler.toml", "utf8");
  const productionConfig = renderProductionConfig(
    sourceConfig,
    SYNTHETIC_DATABASE_ID,
    SYNTHETIC_RELEASE_REVISION,
    SYNTHETIC_PRODUCTION_ORIGIN,
    SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID,
  );
  const committed = parseWranglerToml(sourceConfig);
  const generated = parseWranglerToml(productionConfig);

  assert.deepEqual(committed.d1_databases, [{
    binding: "DB",
    database_name: "workout-tracker",
    database_id: PLACEHOLDER_DATABASE_ID,
    migrations_dir: "migrations",
  }]);
  assert.equal(committed.routes, undefined);
  assert.equal(committed.vars.RELEASE_REVISION, undefined);
  assert.equal(committed.vars.PRODUCTION_HOST, undefined);
  assert.deepEqual(generated, {
    name: "workout-tracker",
    main: "../src/worker.js",
    compatibility_date: "2026-07-31",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    routes: [{
      pattern: SYNTHETIC_PRODUCTION_HOST,
      custom_domain: true,
      previews_enabled: false,
    }],
    observability: { enabled: true, head_sampling_rate: 1 },
    assets: {
      directory: "../dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: ["/", "/api/*", "/coach/*", "/healthz", "/app"],
    },
    ratelimits: [{
      name: "COACH_RATE_LIMITER",
      namespace_id: SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID,
      simple: { limit: 120, period: 60 },
    }],
    secrets: { required: REQUIRED_WORKER_SECRET_NAMES },
    d1_databases: [{
      binding: "DB",
      database_name: "workout-tracker",
      database_id: SYNTHETIC_DATABASE_ID,
      migrations_dir: "../migrations",
    }],
    vars: {
      ENVIRONMENT: "production",
      RELEASE_REVISION: SYNTHETIC_RELEASE_REVISION,
      DEFAULT_TIMEZONE: "Asia/Shanghai",
      PRODUCTION_HOST: SYNTHETIC_PRODUCTION_HOST,
      PUBLIC_ORIGIN: SYNTHETIC_PRODUCTION_ORIGIN,
      AUTH_LOGIN_LIMIT: "5",
      AUTH_LOGIN_CLIENT_LIMIT: "20",
      AUTH_LOGIN_WINDOW_SECONDS: "600",
    },
  });
  assert.throws(
    () => readGeneratedDatabaseIdentity(productionConfig.replace("limit = 120", "limit = 121")),
    /production binding structure/,
  );
});

test("static SPA fallback headers preserve security policy without overriding asset caching", async () => {
  const headers = await readFile("public/_headers", "utf8");
  assert.equal(headers.split(/\r?\n/)[0], "/*");
  assert.match(headers, /^\s*Content-Security-Policy: .*frame-ancestors 'none'/m);
  assert.match(headers, /^\s*Permissions-Policy:/m);
  assert.match(headers, /^\s*Referrer-Policy: no-referrer$/m);
  assert.match(headers, /^\s*X-Content-Type-Options: nosniff$/m);
  assert.match(headers, /^\s*X-Robots-Tag: noindex, nofollow$/m);
  assert.doesNotMatch(headers, /^\s*Cache-Control:/mi);
});

test("production database identity validation fails closed without echoing input", () => {
  for (const [candidate, expected] of [
    [undefined, /is required/],
    ["", /is required/],
    [" not-a-uuid ", /must be a UUID/],
    ["not-a-uuid", /must be a UUID/],
    [PLACEHOLDER_DATABASE_ID, /must not use the committed placeholder/],
  ]) {
    assert.throws(
      () => normalizeDatabaseId(candidate),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, expected);
        if (candidate) assert.ok(!error.message.includes(candidate), "validation error must not echo the candidate ID");
        return true;
      },
    );
  }
  assert.equal(normalizeDatabaseId(SYNTHETIC_DATABASE_ID.toUpperCase()), SYNTHETIC_DATABASE_ID);
});

test("release revision validation requires the exact lowercase Git commit SHA shape without echoing input", () => {
  for (const candidate of [
    undefined,
    "",
    SYNTHETIC_RELEASE_REVISION.toUpperCase(),
    `${SYNTHETIC_RELEASE_REVISION}0`,
    ` ${SYNTHETIC_RELEASE_REVISION}`,
  ]) {
    assert.throws(
      () => normalizeReleaseRevision(candidate),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /WORKOUT_RELEASE_REVISION/);
        if (candidate) assert.ok(!error.message.includes(candidate), "validation error must not echo the revision");
        return true;
      },
    );
  }
  assert.equal(normalizeReleaseRevision(SYNTHETIC_RELEASE_REVISION), SYNTHETIC_RELEASE_REVISION);
});

test("production origin validation accepts only one canonical HTTPS hostname without echoing input", () => {
  assert.deepEqual(normalizePublicOrigin(SYNTHETIC_PRODUCTION_ORIGIN), {
    origin: SYNTHETIC_PRODUCTION_ORIGIN,
    host: SYNTHETIC_PRODUCTION_HOST,
  });
  for (const candidate of [
    undefined,
    "",
    "http://workout.example.invalid",
    "https://user:password@workout.example.invalid",
    "https://workout.example.invalid:8443",
    "https://workout.example.invalid/",
    "https://workout.example.invalid/path",
    "https://workout.example.invalid?query=1",
    "https://workout.example.invalid#fragment",
    "https://localhost",
    "https://127.0.0.1",
  ]) {
    assert.throws(
      () => normalizePublicOrigin(candidate),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /WORKOUT_PUBLIC_ORIGIN/);
        if (candidate) assert.doesNotMatch(error.message, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );
  }
});

test("Coach rate-limit namespace validation accepts only a positive integer string without echoing input", () => {
  assert.equal(normalizeCoachRateLimitNamespaceId(SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID), SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID);
  for (const candidate of [undefined, "", "0", "01", "-1", "1.5", "namespace-private-value"]) {
    assert.throws(
      () => normalizeCoachRateLimitNamespaceId(candidate),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID/);
        if (candidate) assert.doesNotMatch(error.message, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      },
    );
  }
});

test("production config rejects an ambiguous or pre-bound public source", async () => {
  const sourceConfig = await readFile("wrangler.toml", "utf8");
  assert.throws(
    () => renderProductionConfig(sourceConfig.replace(PLACEHOLDER_DATABASE_ID, SYNTHETIC_DATABASE_ID), SYNTHETIC_DATABASE_ID, SYNTHETIC_RELEASE_REVISION, SYNTHETIC_PRODUCTION_ORIGIN, SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID),
    /placeholder D1 database_id/,
  );
  assert.throws(
    () => renderProductionConfig(`${sourceConfig}\nroutes = [{ pattern = "example.invalid", custom_domain = true }]\n`, SYNTHETIC_DATABASE_ID, SYNTHETIC_RELEASE_REVISION, SYNTHETIC_PRODUCTION_ORIGIN, SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID),
    /must not contain a production route/,
  );
  assert.throws(
    () => renderProductionConfig(`${sourceConfig}\ndatabase_id = "${PLACEHOLDER_DATABASE_ID}"\n`, SYNTHETIC_DATABASE_ID, SYNTHETIC_RELEASE_REVISION, SYNTHETIC_PRODUCTION_ORIGIN, SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID),
    /exactly one D1 database_id/,
  );
  assert.throws(
    () => renderProductionConfig(`${sourceConfig}\nRELEASE_REVISION = "${SYNTHETIC_RELEASE_REVISION}"\n`, SYNTHETIC_DATABASE_ID, SYNTHETIC_RELEASE_REVISION, SYNTHETIC_PRODUCTION_ORIGIN, SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID),
    /must not contain a release revision/,
  );
});

test("dry run and injected writers validate without touching the filesystem or logging the ID", async () => {
  const sourceConfig = await readFile("wrangler.toml", "utf8");
  const dryRunLog = [];
  let dryRunMutationCount = 0;
  await prepareProductionConfig({
    databaseId: SYNTHETIC_DATABASE_ID,
    coachRateLimitNamespaceId: SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID,
    publicOrigin: SYNTHETIC_PRODUCTION_ORIGIN,
    releaseRevision: SYNTHETIC_RELEASE_REVISION,
    dryRun: true,
    readFileImpl: async () => sourceConfig,
    mkdirImpl: async () => { dryRunMutationCount += 1; },
    writeFileImpl: async () => { dryRunMutationCount += 1; },
    chmodImpl: async () => { dryRunMutationCount += 1; },
    log: (message) => dryRunLog.push(message),
  });
  assert.equal(dryRunMutationCount, 0);
  assert.equal(dryRunLog.length, 1);
  assert.ok(!dryRunLog[0].includes(SYNTHETIC_DATABASE_ID));
  assert.ok(!dryRunLog[0].includes(SYNTHETIC_RELEASE_REVISION));

  const injectedLog = [];
  let mkdirArguments;
  let writeArguments;
  let chmodArguments;
  await prepareProductionConfig({
    databaseId: SYNTHETIC_DATABASE_ID,
    coachRateLimitNamespaceId: SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID,
    publicOrigin: SYNTHETIC_PRODUCTION_ORIGIN,
    releaseRevision: SYNTHETIC_RELEASE_REVISION,
    readFileImpl: async () => sourceConfig,
    mkdirImpl: async (...args) => { mkdirArguments = args; },
    writeFileImpl: async (...args) => { writeArguments = args; },
    chmodImpl: async (...args) => { chmodArguments = args; },
    log: (message) => injectedLog.push(message),
  });
  assert.deepEqual(mkdirArguments, [".wrangler", { recursive: true, mode: 0o700 }]);
  assert.equal(writeArguments[0], OUTPUT_CONFIG_PATH);
  assert.match(writeArguments[1], new RegExp(SYNTHETIC_DATABASE_ID));
  assert.deepEqual(writeArguments[2], { encoding: "utf8", mode: 0o600 });
  assert.deepEqual(chmodArguments, [OUTPUT_CONFIG_PATH, 0o600]);
  assert.equal(injectedLog.length, 1);
  assert.ok(!injectedLog[0].includes(SYNTHETIC_DATABASE_ID));
  assert.ok(!injectedLog[0].includes(SYNTHETIC_RELEASE_REVISION));
});

test("CLI dry run never echoes a valid or invalid database ID", () => {
  const scriptPath = fileURLToPath(new URL("../scripts/prepare-production-config.mjs", import.meta.url));
  for (const [databaseId, expectedStatus] of [
    [SYNTHETIC_DATABASE_ID, 0],
    ["private-value-that-is-not-a-uuid", 1],
  ]) {
    const result = spawnSync(process.execPath, [scriptPath, "--dry-run"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        WORKOUT_D1_DATABASE_ID: databaseId,
        WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID: SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID,
        WORKOUT_PUBLIC_ORIGIN: SYNTHETIC_PRODUCTION_ORIGIN,
        WORKOUT_RELEASE_REVISION: SYNTHETIC_RELEASE_REVISION,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(databaseId), "CLI output must not echo the database ID");
  }
});

test("production config cleanup removes only the fixed generated file and tolerates absence", async () => {
  const calls = [];
  const logs = [];
  await cleanupProductionConfig({
    unlinkImpl: async (...arguments_) => { calls.push(arguments_); },
    log: (message) => logs.push(message),
  });
  assert.deepEqual(calls, [[OUTPUT_CONFIG_PATH]]);
  assert.equal(logs.length, 1);

  await cleanupProductionConfig({
    unlinkImpl: async () => { const error = new Error("absent"); error.code = "ENOENT"; throw error; },
    log: () => {},
  });
  const injectedPrivateValue = "private-cleanup-error-value";
  await assert.rejects(
    cleanupProductionConfig({
      unlinkImpl: async () => { throw new Error(injectedPrivateValue); },
      log: () => {},
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(injectedPrivateValue));
      return true;
    },
  );
});

function d1ProbeOutput(migrationNames, overrides = {}) {
  return JSON.stringify([
    {
      success: true,
      results: [{
        athlete_state_table: 1,
        athlete_state_mutation_owner: 1,
        plans_table: 1,
        sessions_table: 1,
        plan_exercises_category: 1,
        session_exercises_category: 1,
        category_guard_triggers: 4,
        migration_ledger_table: 1,
        ...overrides,
      }],
    },
    { success: true, results: migrationNames.map((name) => ({ name })) },
    { success: true, results: [] },
  ]);
}

test("production preflight is injected, read-only, and never exposes the database identity", async () => {
  const sourceConfig = await readFile("wrangler.toml", "utf8");
  const productionConfig = renderProductionConfig(
    sourceConfig,
    SYNTHETIC_DATABASE_ID,
    SYNTHETIC_RELEASE_REVISION,
    SYNTHETIC_PRODUCTION_ORIGIN,
    SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID,
  );
  const migrationNames = (await readdir("migrations")).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const calls = [];
  const domainCalls = [];
  const logs = [];
  const result = await preflightProductionDeploy({
    accountId: "synthetic-account-id",
    apiToken: "synthetic-api-token",
    readFileImpl: async () => productionConfig,
    listMigrationsImpl: async () => migrationNames,
    runCommandImpl: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === "secret") {
        return JSON.stringify(REQUIRED_WORKER_SECRET_NAMES.map((name) => ({ name, type: "secret_text" })));
      }
      if (arguments_[1] === "list") {
        return JSON.stringify([{ name: "workout-tracker", uuid: SYNTHETIC_DATABASE_ID, created_at: "synthetic" }]);
      }
      return d1ProbeOutput(migrationNames);
    },
    fetchDomainsImpl: async (input) => {
      domainCalls.push(input);
      return JSON.stringify({
        success: true,
        result: [{ service: "workout-tracker", hostname: SYNTHETIC_PRODUCTION_HOST }],
      });
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(result, { requiredSecretCount: 8, migrationCount: migrationNames.length });
  assert.deepEqual(calls, [
    ["secret", "list", "--name", "workout-tracker", "--config", OUTPUT_CONFIG_PATH, "--format", "json"],
    ["d1", "list", "--config", OUTPUT_CONFIG_PATH, "--json"],
    ["d1", "execute", "DB", "--remote", "--config", OUTPUT_CONFIG_PATH, "--command", D1_READ_ONLY_PROBE, "--json"],
  ]);
  assert.deepEqual(domainCalls, [{ accountId: "synthetic-account-id", apiToken: "synthetic-api-token" }]);
  assert.doesNotMatch(D1_READ_ONLY_PROBE, /\b(?:ALTER|ATTACH|CREATE|DELETE|DETACH|DROP|INSERT|REPLACE|UPDATE|VACUUM)\b/i);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(SYNTHETIC_DATABASE_ID));
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], new RegExp(`${SYNTHETIC_DATABASE_ID}|${SYNTHETIC_RELEASE_REVISION}|synthetic-account-id|synthetic-api-token`));
});

test("production preflight rejects secret, D1 identity, schema, integrity, and migration drift", async () => {
  const migrations = ["0001_initial.sql", "0002_state_revision.sql"];
  const inventory = REQUIRED_WORKER_SECRET_NAMES.map((name) => ({ name, type: "secret_text" }));
  assert.throws(
    () => verifyWorkerSecretInventory(JSON.stringify(inventory.slice(1))),
    /missing required secret names/,
  );
  assert.throws(
    () => verifyWorkerSecretInventory(JSON.stringify([{ ...inventory[0], value: "must-not-be-accepted" }])),
    /unexpected field/,
  );
  assert.throws(
    () => verifyD1Inventory(JSON.stringify([{ name: "workout-tracker", uuid: "66666666-2222-4333-8444-555555555555" }]), SYNTHETIC_DATABASE_ID),
    /does not match/,
  );
  assert.throws(
    () => verifyCustomDomainInventory(JSON.stringify({
      success: true,
      result: [{ service: "workout-tracker", hostname: "wrong.example.invalid" }],
    }), SYNTHETIC_PRODUCTION_HOST),
    /does not exactly match/,
  );
  assert.throws(
    () => verifyD1SchemaAndMigrations(d1ProbeOutput(migrations, { sessions_table: 0 }), migrations),
    /schema signature/,
  );
  const integrityFailure = JSON.parse(d1ProbeOutput(migrations));
  integrityFailure[2].results.push({ table: "sessions", rowid: 1, parent: "plans", fkid: 0 });
  assert.throws(
    () => verifyD1SchemaAndMigrations(JSON.stringify(integrityFailure), migrations),
    /foreign key integrity/,
  );
  assert.throws(
    () => verifyD1SchemaAndMigrations(d1ProbeOutput(migrations.slice(0, 1)), migrations),
    /does not exactly match/,
  );
  assert.throws(() => validateLocalMigrationNames(["0001_initial.sql", "0003_gap.sql"]), /consecutive/);
  assert.throws(() => validateLocalMigrationNames(["1_initial.sql"]), /unexpected structure/);
});

test("preflight validates local migrations before remote access and redacts injected command failures", async () => {
  let remoteCallCount = 0;
  const sourceConfig = await readFile("wrangler.toml", "utf8");
  const productionConfig = renderProductionConfig(
    sourceConfig,
    SYNTHETIC_DATABASE_ID,
    SYNTHETIC_RELEASE_REVISION,
    SYNTHETIC_PRODUCTION_ORIGIN,
    SYNTHETIC_COACH_RATE_LIMIT_NAMESPACE_ID,
  );
  await assert.rejects(
    preflightProductionDeploy({
      accountId: "synthetic-account-id",
      apiToken: "synthetic-api-token",
      readFileImpl: async () => productionConfig,
      listMigrationsImpl: async () => ["0002_gap.sql"],
      runCommandImpl: async () => { remoteCallCount += 1; return "[]"; },
      fetchDomainsImpl: async () => { remoteCallCount += 1; return "{}"; },
      log: () => {},
    }),
    /Local migration inventory/,
  );
  assert.equal(remoteCallCount, 0);

  const injectedPrivateValue = "injected-private-command-output";
  await assert.rejects(
    preflightProductionDeploy({
      accountId: "synthetic-account-id",
      apiToken: "synthetic-api-token",
      readFileImpl: async () => productionConfig,
      listMigrationsImpl: async () => ["0001_initial.sql"],
      runCommandImpl: async () => { throw new Error(injectedPrivateValue); },
      fetchDomainsImpl: async () => { throw new Error(injectedPrivateValue); },
      log: () => {},
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(injectedPrivateValue));
      return true;
    },
  );
});

test("production deploy wrapper captures Wrangler output and invokes strict deploy without a shell", async () => {
  const calls = [];
  const logs = [];
  const message = `GitHub ${SYNTHETIC_RELEASE_REVISION}`;
  assert.equal(normalizeDeploymentMessage(message), message);
  await deployProduction({
    message,
    runCommandImpl: async (arguments_, options) => {
      calls.push({ arguments_, options });
      return { stdout: "private-wrangler-output", stderr: "private-wrangler-error" };
    },
    log: (entry) => logs.push(entry),
  });
  assert.deepEqual(calls[0].arguments_, [
    "deploy",
    "--strict",
    "--config",
    OUTPUT_CONFIG_PATH,
    "--message",
    message,
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /private-wrangler|0123456789abcdef/);

  const injectedPrivateValue = "private-wrangler-failure-value";
  await assert.rejects(
    deployProduction({
      message,
      runCommandImpl: async () => { throw new Error(injectedPrivateValue); },
      log: () => {},
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Wrangler production deployment failed");
      assert.doesNotMatch(error.message, new RegExp(injectedPrivateValue));
      return true;
    },
  );
});

test("remote-main guard accepts only the exact public main tip and does not log revisions", async () => {
  const logs = [];
  const gitCalls = [];
  await verifyRemoteMain({
    expectedRevision: SYNTHETIC_RELEASE_REVISION,
    runGitImpl: async (arguments_) => {
      gitCalls.push(arguments_);
      return `${SYNTHETIC_RELEASE_REVISION}\trefs/heads/main\n`;
    },
    log: (message) => logs.push(message),
  });
  assert.deepEqual(gitCalls, [["ls-remote", "--exit-code", "origin", "refs/heads/main"]]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], new RegExp(SYNTHETIC_RELEASE_REVISION));

  const newerRevision = `1${SYNTHETIC_RELEASE_REVISION.slice(1)}`;
  assert.rejects(
    verifyRemoteMain({
      expectedRevision: SYNTHETIC_RELEASE_REVISION,
      runGitImpl: async () => `${newerRevision}\trefs/heads/main\n`,
      log: () => {},
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /no longer the remote main tip/);
      assert.doesNotMatch(error.message, new RegExp(`${SYNTHETIC_RELEASE_REVISION}|${newerRevision}`));
      return true;
    },
  );
});

test("migration history guard permits additions and rejects changes to existing migrations", async () => {
  const calls = [];
  const baseRevision = `1${SYNTHETIC_RELEASE_REVISION.slice(1)}`;
  const migrations = ["0001_initial.sql", "0002_state_revision.sql"];
  const result = await verifyForwardOnlyMigrations({
    baseRevision,
    currentRevision: SYNTHETIC_RELEASE_REVISION,
    runGitImpl: async (arguments_) => {
      calls.push(arguments_);
      return "";
    },
    listMigrationsImpl: async () => migrations,
    log: () => {},
  });
  assert.deepEqual(result, { forwardOnly: true });
  assert.deepEqual(calls, [
    ["merge-base", "--is-ancestor", baseRevision, SYNTHETIC_RELEASE_REVISION],
    ["diff", "--no-ext-diff", "--find-renames=50%", "--name-only", "-z", "--diff-filter=DMRTUXB", baseRevision, SYNTHETIC_RELEASE_REVISION, "--", ":(glob)migrations/*.sql"],
  ]);

  const privatePathSentinel = "migrations/0001_private_sentinel.sql\0";
  await assert.rejects(
    verifyForwardOnlyMigrations({
      baseRevision,
      currentRevision: SYNTHETIC_RELEASE_REVISION,
      runGitImpl: async (arguments_) => arguments_[0] === "diff" ? privatePathSentinel : "",
      listMigrationsImpl: async () => migrations,
      log: () => {},
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Forward-only D1 migration history check failed");
      assert.doesNotMatch(error.message, /private_sentinel/);
      return true;
    },
  );

  const derivedCalls = [];
  await verifyForwardOnlyMigrations({
    baseRevision: "",
    currentRevision: SYNTHETIC_RELEASE_REVISION,
    runGitImpl: async (arguments_) => {
      derivedCalls.push(arguments_);
      if (arguments_[0] === "rev-parse") return `${baseRevision}\n`;
      return "";
    },
    listMigrationsImpl: async () => migrations,
    log: () => {},
  });
  assert.deepEqual(derivedCalls[0], ["rev-parse", "--verify", `${SYNTHETIC_RELEASE_REVISION}^`]);
});

test("production workflow deploys only main after the full gate and keeps secret scopes narrow", async () => {
  const [workflow, packageJson, packageLock, gitignore] = await Promise.all([
    readFile(".github/workflows/deploy.yml", "utf8"),
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("package-lock.json", "utf8").then(JSON.parse),
    readFile(".gitignore", "utf8"),
  ]);

  const parsed = parseWorkflowYaml(workflow);
  assert.deepEqual(Object.keys(parsed).sort(), ["concurrency", "jobs", "name", "on", "permissions"]);
  assert.deepEqual(parsed.on, { push: { branches: ["main"] }, workflow_dispatch: null });
  assert.deepEqual(parsed.permissions, { contents: "read" });
  assert.deepEqual(parsed.concurrency, {
    group: "workout-production-deploy-${{ github.ref }}",
    "cancel-in-progress": false,
  });
  assert.deepEqual(Object.keys(parsed.jobs), ["deploy"]);
  const job = parsed.jobs.deploy;
  assert.deepEqual(Object.keys(job).sort(), [
    "defaults",
    "environment",
    "if",
    "name",
    "runs-on",
    "steps",
    "timeout-minutes",
  ]);
  assert.equal(job.name, "Deploy Worker and assets");
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job["timeout-minutes"], 30);
  assert.equal(job.environment, "production");
  assert.deepEqual(job.defaults, { run: { shell: "bash" } });
  assert.equal(job.env, undefined, "secrets must never be injected at job scope");

  assert.deepEqual(job.steps.map((step) => step.name), [
    "Check out source",
    "Set up Node.js",
    "Install locked dependencies",
    "Install Chromium for browser smoke",
    "Run credential-free release gate",
    "Review runtime dependency advisories",
    "Review development dependency advisories",
    "Verify current main revision",
    "Verify forward-only D1 migration history",
    "Prepare ignored production configuration",
    "Preflight production bindings",
    "Deploy current main Worker and built assets",
    "Clean up generated production configuration",
    "Verify credential-free production boundary",
  ]);
  const [checkout, setupNode, install, browserInstall, releaseGate, runtimeAudit, developmentAudit, freshness, migrationHistory, prepare, preflight, deploy, cleanup, acceptance] = job.steps;
  assert.deepEqual(checkout, {
    name: "Check out source",
    uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    with: { "fetch-depth": 0, "persist-credentials": false, ref: "${{ github.sha }}" },
  });
  assert.deepEqual(setupNode, {
    name: "Set up Node.js",
    uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    with: { "node-version": 22, cache: "npm" },
  });
  assert.deepEqual(install, { name: "Install locked dependencies", run: "npm ci" });
  assert.deepEqual(browserInstall, {
    name: "Install Chromium for browser smoke",
    run: "npm run test:browser:install -- --with-deps",
  });
  assert.deepEqual(releaseGate, { name: "Run credential-free release gate", run: "npm run release-check" });
  assert.deepEqual(runtimeAudit, { name: "Review runtime dependency advisories", run: "npm run audit:runtime" });
  assert.deepEqual(developmentAudit, { name: "Review development dependency advisories", run: "npm run audit:development" });
  assert.deepEqual(freshness, {
    name: "Verify current main revision",
    env: { EXPECTED_GITHUB_SHA: "${{ github.sha }}" },
    run: "node scripts/preflight-production-deploy.mjs --verify-main",
  });
  assert.deepEqual(migrationHistory, {
    name: "Verify forward-only D1 migration history",
    env: {
      EXPECTED_GITHUB_SHA: "${{ github.sha }}",
      MIGRATION_BASE_SHA: "${{ github.event.before }}",
    },
    run: "node scripts/preflight-production-deploy.mjs --verify-migrations",
  });
  assert.deepEqual(prepare, {
    name: "Prepare ignored production configuration",
    env: {
      WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID: "${{ secrets.WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID }}",
      WORKOUT_D1_DATABASE_ID: "${{ secrets.WORKOUT_D1_DATABASE_ID }}",
      WORKOUT_PUBLIC_ORIGIN: "${{ secrets.WORKOUT_PUBLIC_ORIGIN }}",
      WORKOUT_RELEASE_REVISION: "${{ github.sha }}",
    },
    run: "npm run prepare:production-config",
  });
  assert.deepEqual(preflight, {
    name: "Preflight production bindings",
    env: {
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
    },
    run: "npm run preflight:production",
  });
  assert.deepEqual(deploy, {
    name: "Deploy current main Worker and built assets",
    env: {
      CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
      EXPECTED_GITHUB_SHA: "${{ github.sha }}",
    },
    run: 'node scripts/preflight-production-deploy.mjs --verify-main && npm run deploy:production -- --message "GitHub ${GITHUB_SHA}"',
  });
  assert.deepEqual(cleanup, {
    name: "Clean up generated production configuration",
    if: "always()",
    run: "npm run cleanup:production-config",
  });
  assert.deepEqual(acceptance, {
    name: "Verify credential-free production boundary",
    env: {
      EXPECTED_GITHUB_SHA: "${{ github.sha }}",
      WORKOUT_PUBLIC_ORIGIN: "${{ secrets.WORKOUT_PUBLIC_ORIGIN }}",
    },
    run: "node scripts/operator-acceptance.mjs",
  });
  for (const postGateStep of job.steps.slice(job.steps.indexOf(releaseGate) + 1)) {
    assert.equal(postGateStep.uses, undefined, "the gated checkout must not be replaced after release-check");
    assert.doesNotMatch(postGateStep.run ?? "", /(?:^|\s)(?:npm run )?build(?:\s|$)|\bdist\b/);
  }
  const serializedWorkflow = JSON.stringify(parsed);
  assert.equal(serializedWorkflow.split("secrets.WORKOUT_D1_DATABASE_ID").length - 1, 1);
  assert.equal(serializedWorkflow.split("secrets.WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID").length - 1, 1);
  assert.equal(serializedWorkflow.split("secrets.WORKOUT_PUBLIC_ORIGIN").length - 1, 2);
  assert.doesNotMatch(serializedWorkflow, /\$\{\{\s*vars\./);
  for (const secretName of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
    assert.equal(serializedWorkflow.split(`secrets.${secretName}`).length - 1, 2, `${secretName} must be limited to preflight and deploy`);
  }
  assert.doesNotMatch(serializedWorkflow, /d1 migrations (?:apply|create)|pull_request_target|schedule/);

  assert.equal(packageJson.scripts.test, "node --test tests/*.test.js");
  assert.equal(packageJson.scripts["prepare:production-config"], "node scripts/prepare-production-config.mjs");
  assert.equal(packageJson.scripts["cleanup:production-config"], "node scripts/prepare-production-config.mjs --cleanup");
  assert.equal(packageJson.scripts["preflight:production"], "node scripts/preflight-production-deploy.mjs");
  assert.equal(packageJson.scripts["deploy:production"], "node scripts/deploy-production.mjs");
  assert.doesNotMatch(packageJson.scripts["deploy:production"], /build|migrations/);
  assert.equal(packageLock.packages["node_modules/wrangler"].version, "4.127.1");
  assert.match(gitignore, /^\.wrangler\/$/m);
});
