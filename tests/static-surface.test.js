// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const sourceRoot = "web";
const sourceExtensions = new Set([".html", ".js", ".jsx", ".ts", ".tsx", ".vue"]);
const runtimeStyleSurfaces = [
  { pattern: /\b(?:v-bind:style|:style|style)\s*=/, description: "template style attribute" },
  { pattern: /\bv-show(?:\s*=|\.)/, description: "v-show runtime display style" },
  { pattern: /\.style(?:\s*=|\.|\[)/, description: "DOM style mutation" },
  { pattern: /\bcssText\s*=/, description: "cssText mutation" },
  { pattern: /\bsetAttribute\s*\(\s*["']style["']/, description: "style attribute mutation" },
];

test("web source cannot create runtime style attributes", async () => {
  const problems = [];
  for (const path of await sourceFiles(sourceRoot)) {
    const source = await readFile(path, "utf8");
    for (const surface of runtimeStyleSurfaces) {
      if (surface.pattern.test(source)) problems.push(`${relative(".", path)}: ${surface.description}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("semantic progress styling is external and supports Chromium and Firefox", async () => {
  const css = await readFile("public/styles.css", "utf8");
  assert.match(css, /\.progress-line\s*\{[^}]*appearance:\s*none/is);
  assert.match(css, /\.progress-line::\-webkit-progress-value\s*\{/);
  assert.match(css, /\.progress-line::\-moz-progress-bar\s*\{/);
  assert.doesNotMatch(css, /\.progress-line\s+(?:>|\s)*span\s*\{/);
});

/** @param {string} directory */
async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files.sort();
}
