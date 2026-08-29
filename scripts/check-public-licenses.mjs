#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const reviewedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "BSD-3-Clause",
  "BSD-2-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT OR Apache-2.0",
  "MPL-2.0",
]);

const problems = [];
const packages = Object.entries(lock.packages ?? {}).filter(([path]) => path.startsWith("node_modules/"));
for (const [path, metadata] of packages) {
  if (typeof metadata.license !== "string" || !reviewedLicenses.has(metadata.license)) {
    problems.push(`${path}: ${String(metadata.license ?? "missing")}`);
  }
}

for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
  if (!lock.packages?.[`node_modules/${name}`]) problems.push(`${name}: direct dependency missing from lockfile`);
}
if (manifest.dependencies?.["@garmin/fitsdk"] || lock.packages?.["node_modules/@garmin/fitsdk"]) {
  problems.push("@garmin/fitsdk: restricted dependency remains installed");
}
const fit = lock.packages?.["node_modules/fit-file-parser"];
if (manifest.dependencies?.["fit-file-parser"] !== "5.0.2" || fit?.version !== "5.0.2" || fit?.license !== "MIT") {
  problems.push("fit-file-parser: expected exact MIT-reviewed version 5.0.2");
}

if (problems.length) {
  console.error(`dependency license review failed:\n${problems.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`dependency licenses reviewed (${packages.length} installed packages; ${reviewedLicenses.size} accepted SPDX expressions)`);
}
