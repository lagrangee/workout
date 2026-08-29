import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// Canonical docs intentionally name excluded features, and Coach responses
// explain excluded data fields. Scan only user-facing implementation surfaces
// so the guard detects accidental feature code instead of those explanations.
const forbidden = ["offline queue", "ad-hoc session", "manual plan editor", "telemetry", "symptom", "coach dashboard", "csv export", "restore/import"];
const files = ["src/http.js", "web/index.html", "public/styles.css", ...await sourceFiles("web/src")];
const violations = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const word of forbidden) if (text.toLowerCase().includes(word)) violations.push(`${file}: ${word}`);
}
if (violations.length) {
  console.error("Forbidden-feature scan found terms in canonical exclusion text or implementation:\n" + violations.join("\n"));
  process.exit(1);
}
console.log("Forbidden-feature scan passed");

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && /\.(?:ts|vue)$/.test(entry.name)) files.push(path);
  }
  return files;
}
