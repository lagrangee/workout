// @ts-nocheck

import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { buildCanonicalRebuildSql } from "../src/canonical-rebuild.js";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const inputPath = requiredArg(args, "input");
const outputPath = requiredArg(args, "output");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const source = selectState(input, args["athlete-key"]);
const now = args.now ?? new Date().toISOString();
let rollbackRef = null;
let rollbackPath = null;

if (args.apply) {
  if (args.confirm !== "canonical-cutover") throw new Error("--apply requires --confirm canonical-cutover");
  if (!args.database) throw new Error("--apply requires --database");
  if (args.remote !== "true") throw new Error("--apply requires --remote true");
  if (!args["archive-dir"] || !args["rollback-dir"]) throw new Error("--apply requires --archive-dir and --rollback-dir");
  rollbackPath = await copyRollbackArchive(args["archive-dir"], args["rollback-dir"], now);
  rollbackRef = relative(resolve(args["rollback-dir"]), rollbackPath).replaceAll(sep, "/");
}

const sql = buildCanonicalRebuildSql(source.state, {
  now,
  rollbackRef,
  sourceStateRevision: source.stateRevision,
});
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(outputPath, sql, "utf8");

if (args.apply) {
  await runWrangler(args.database, outputPath);
}

console.log(JSON.stringify({
  operation: "canonical-workout-d1-rebuild",
  applied: Boolean(args.apply),
  athlete_key: source.state.athlete_key,
  plan_revisions: source.state.plan_revisions.length,
  sessions: source.state.sessions.length,
  sql_path: resolve(outputPath),
  rollback_copy: rollbackPath,
  rollback_ref: rollbackRef,
  cutover_at: now,
}, null, 2));

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") { result.help = true; continue; }
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function requiredArg(value, key) {
  if (!value[key] || typeof value[key] !== "string") throw new Error(`--${key} is required`);
  return value[key];
}

function selectState(input, athleteKey) {
  let candidate = input;
  if (Array.isArray(input)) candidate = choose(input, athleteKey);
  else if (Array.isArray(input.athletes)) candidate = choose(input.athletes, athleteKey);
  const stateRevision = candidate?.state_revision ?? candidate?.stateRevision ?? candidate?.state?.__d1StateRevision ?? null;
  if (typeof candidate?.state_json === "string") candidate = { ...candidate, state: JSON.parse(candidate.state_json) };
  const state = candidate?.state && typeof candidate.state === "object" ? candidate.state : candidate;
  if (athleteKey && state.athlete_key !== athleteKey) throw new Error(`Input Athlete does not match --athlete-key ${athleteKey}`);
  return { state, stateRevision };
}

function choose(values, athleteKey) {
  if (athleteKey) {
    const match = values.find((value) => {
      if (value.athlete_key === athleteKey || value.state?.athlete_key === athleteKey) return true;
      if (typeof value.state_json === "string") {
        try { return JSON.parse(value.state_json).athlete_key === athleteKey; } catch { return false; }
      }
      return false;
    });
    if (!match) throw new Error(`No input Athlete matches --athlete-key ${athleteKey}`);
    return match;
  }
  if (values.length !== 1) throw new Error("Input contains multiple Athletes; pass --athlete-key");
  return values[0];
}

async function copyRollbackArchive(archiveDir, rollbackDir, now) {
  const source = resolve(archiveDir);
  const targetRoot = resolve(rollbackDir);
  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) throw new Error("--archive-dir must be a directory");
  const relativeTarget = relative(source, targetRoot);
  if (relativeTarget === "" || (!relativeTarget.startsWith(".." + sep) && relativeTarget !== "..")) throw new Error("--rollback-dir cannot be inside --archive-dir");
  const slug = now.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
  const target = resolve(targetRoot, `workout-rollback-${slug}`);
  await mkdir(targetRoot, { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}

function runWrangler(database, sqlPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["wrangler", "d1", "execute", database, "--remote", `--file=${resolve(sqlPath)}`], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`wrangler d1 execute exited with code ${code}`)));
  });
}

function usage() {
  return `Usage:
  node scripts/rebuild-canonical-d1.mjs --input <state.json> --output <cutover.sql> [--athlete-key <key>]
  node scripts/rebuild-canonical-d1.mjs --input <state.json> --output <cutover.sql> --apply --database <d1-name> --remote true --confirm canonical-cutover --archive-dir <vault> --rollback-dir <backup-root>

The command accepts one canonical Athlete state or an explicit one-Athlete
export. It never deletes on startup. --apply first makes a recoverable copy
of the bounded private archive, then runs the generated transaction through
Wrangler. Review the SQL file before applying it.`;
}
