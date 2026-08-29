// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { inspectDistInventory, REQUIRED_DIST_FILES } from "../scripts/check-dist-inventory.mjs";

const canonicalCsp = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

test("production inventory accepts only canonical static files and hashed Vite assets", async () => {
  const directory = await fixture();
  try {
    await put(directory, "assets/index-Ab3_deF9.js", "export {};\n");
    assert.deepEqual(await inspectDistInventory(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production inventory rejects prototypes, extra HTML, and legacy JavaScript", async () => {
  const directory = await fixture();
  try {
    await put(directory, "assets/index-Ab3_deF9.js", "export {};\n");
    await put(directory, "prototype/aerobic-tab.html", "<!doctype html><style>body{}</style>");
    await put(directory, "legacy.html", "<!doctype html>");
    await put(directory, "app.js", "// legacy entry\n");

    const problems = await inspectDistInventory(directory);
    assert.ok(problems.some((problem) => problem.includes("prototype/aerobic-tab.html: prototype artifacts")));
    assert.ok(problems.some((problem) => problem.includes("legacy.html: index.html is the only production HTML")));
    assert.ok(problems.some((problem) => problem.includes("app.js: JavaScript must be a hashed Vite asset")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production inventory locks CSP-compatible HTML and headers", async () => {
  const directory = await fixture();
  try {
    await put(directory, "assets/index-Ab3_deF9.js", "export {};\n");
    await put(directory, "index.html", "<!doctype html><div id=\"app\" style=\"display:block\"></div><script>boot()</script>");
    await put(directory, "_headers", "/*\n  Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'\n");

    const problems = await inspectDistInventory(directory);
    assert.ok(problems.some((problem) => problem.includes("index.html: inline style")));
    assert.ok(problems.some((problem) => problem.includes("index.html: inline script")));
    assert.ok(problems.some((problem) => problem.includes("_headers: production Content-Security-Policy")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "workout-dist-inventory-"));
  for (const path of REQUIRED_DIST_FILES) {
    const contents = path === "index.html"
      ? "<!doctype html><div id=\"app\"></div><script type=\"module\" src=\"/assets/index-Ab3_deF9.js\"></script>"
      : path === "_headers"
        ? `/*\n  Content-Security-Policy: ${canonicalCsp}\n`
        : "";
    await put(directory, path, contents);
  }
  return directory;
}

/** @param {string} root @param {string} path @param {string} contents */
async function put(root, path, contents) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents);
}
