#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_DIST_FILES = Object.freeze([
  "_headers",
  "apple-touch-icon.png",
  "audio/workout-complete.wav",
  "audio/workout-prepare.wav",
  "audio/workout-tempo-final.wav",
  "audio/workout-tempo.wav",
  "audio/workout-warmup.wav",
  "favicon.png",
  "icon-1024.png",
  "icon-192.png",
  "icon-512.png",
  "index.html",
  "manifest.webmanifest",
  "navigation.css",
  "styles.css",
]);

const requiredDistFiles = new Set(REQUIRED_DIST_FILES);
const viteAsset = /^assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:avif|css|gif|jpe?g|js|png|svg|wasm|wav|webp|woff2?)$/;
const canonicalCsp = "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function inspectDistInventory(directory) {
  const root = resolve(directory);
  const entries = await walk(root);
  const paths = new Set(entries.map((entry) => entry.path));
  const problems = [];

  for (const expected of REQUIRED_DIST_FILES) {
    if (!paths.has(expected)) problems.push(`${expected}: required production asset is missing`);
  }

  for (const entry of entries) {
    const normalized = entry.path.toLowerCase();
    if (entry.symbolicLink) {
      problems.push(`${entry.path}: symbolic links are not allowed in the production asset inventory`);
      continue;
    }
    if (normalized.split("/").some((segment) => segment.includes("prototype"))) {
      problems.push(`${entry.path}: prototype artifacts must not enter production`);
      continue;
    }
    if (requiredDistFiles.has(entry.path) || viteAsset.test(entry.path)) continue;
    if (normalized.endsWith(".html")) {
      problems.push(`${entry.path}: index.html is the only production HTML entry`);
      continue;
    }
    if (/\.(?:cjs|js|mjs)$/.test(normalized)) {
      problems.push(`${entry.path}: JavaScript must be a hashed Vite asset under assets/`);
      continue;
    }
    problems.push(`${entry.path}: unexpected production asset`);
  }

  if (paths.has("index.html")) {
    const html = await readFile(join(root, "index.html"), "utf8");
    if (/<style\b|\sstyle\s*=/i.test(html)) problems.push("index.html: inline style is forbidden by the production CSP");
    if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) problems.push("index.html: inline script is forbidden by the production CSP");
  }

  if (paths.has("_headers")) {
    const headers = await readFile(join(root, "_headers"), "utf8");
    if (!headers.split(/\r?\n/).some((line) => line.trim() === `Content-Security-Policy: ${canonicalCsp}`)) {
      problems.push("_headers: production Content-Security-Policy does not match the canonical strict policy");
    }
  }

  return problems.sort();
}

/** @param {string} root */
async function walk(root) {
  /** @type {Array<{ path: string, symbolicLink: boolean }>} */
  const files = [];
  /** @param {string} directory */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const path = relative(root, absolutePath).split(sep).join("/");
      if (entry.isDirectory()) await visit(absolutePath);
      else files.push({ path, symbolicLink: entry.isSymbolicLink() });
    }
  }
  await visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? join(repositoryRoot, "dist"));
  const problems = await inspectDistInventory(directory);
  if (problems.length) {
    console.error(`production asset inventory rejected:\n${problems.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`production asset inventory accepted (${REQUIRED_DIST_FILES.length} static files plus hashed Vite assets)`);
  }
}
