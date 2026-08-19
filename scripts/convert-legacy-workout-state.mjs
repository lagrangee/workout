// @ts-nocheck

import { readFile, writeFile } from "node:fs/promises";
import { convertLegacyExport } from "../src/legacy-workout-converter.js";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
const inputPath = requiredArg(args, "input");
const outputPath = requiredArg(args, "output");
if (args["range-policy"] !== "max") throw new Error("--range-policy max is required");

const input = JSON.parse(await readFile(inputPath, "utf8"));
const converted = convertLegacyExport(input, { rangePolicy: "max" });
await writeFile(outputPath, `${JSON.stringify(converted, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  operation: "legacy-workout-v1-to-canonical-v2",
  range_policy: "max",
  athletes: converted.length,
  plan_revisions: converted.reduce((total, row) => total + row.state.plan_revisions.length, 0),
  sessions: converted.reduce((total, row) => total + row.state.sessions.length, 0),
  output_path: outputPath,
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

function usage() {
  return `Usage:\n  node scripts/convert-legacy-workout-state.mjs --input <wrangler-export.json> --output <canonical-export.json> --range-policy max`;
}
