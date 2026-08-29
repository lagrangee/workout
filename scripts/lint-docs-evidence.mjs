#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootDocuments = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  "CONTEXT.md",
]);

async function markdownFiles(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(child));
    else if (entry.isFile() && extname(entry.name) === ".md") files.push(child);
  }
  return files;
}

function localTargets(markdown) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((target) => target && !target.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .map((target) => target.split("#", 1)[0].split("?", 1)[0]);
}

const files = [
  ...(await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && rootDocuments.has(entry.name))
    .map((entry) => resolve(root, entry.name)),
  ...await markdownFiles(resolve(root, "docs")),
];
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
