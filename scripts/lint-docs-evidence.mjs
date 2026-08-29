#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const execFileAsync = promisify(execFile);
const rootDocuments = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
]);

function localTargets(markdown) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((target) => target && !target.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .map((target) => target.split("#", 1)[0].split("?", 1)[0]);
}

const { stdout } = await execFileAsync(
  "git",
  ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
);
const files = stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((path) => extname(path) === ".md")
  .filter((path) => rootDocuments.has(path) || path.startsWith("docs/"))
  .map((path) => resolve(root, path));
const findings = [];
for (const file of files) {
  const markdown = await readFile(file, "utf8");
  const lines = markdown.split("\n");
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) findings.push(`${file.slice(root.length + 1)}:${index + 1}: trailing whitespace`);
  });
  for (const target of localTargets(markdown)) {
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    try {
      await access(resolved);
    } catch {
      findings.push(`${file.slice(root.length + 1)}: broken local link ${target}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`documentation evidence lint failed (${findings.length} finding${findings.length === 1 ? "" : "s"}):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation evidence only: ${files.length} Markdown files have clean whitespace and resolvable local links.`);
}
