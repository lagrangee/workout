#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);
const OPAQUE_ARCHIVE_EXTENSIONS = [".zip", ".tgz", ".tar", ".tar.gz", ".7z"];
const BINARY_ASSET_EXTENSIONS = new Set([".png", ".wav", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".mp4", ".m4a", ".ogg", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".bin"]);
// These paths are the exact output surface of generate-public-assets.mjs.
// Content reproducibility is checked by assets:check; this set prevents an
// extra redistributed binary from escaping that generator/provenance review.
const GENERATED_PUBLIC_BINARY_PATHS = new Set([
  "public/favicon.png",
  "public/apple-touch-icon.png",
  "public/icon-192.png",
  "public/icon-512.png",
  "public/icon-1024.png",
  "public/audio/workout-warmup.wav",
  "public/audio/workout-prepare.wav",
  "public/audio/workout-tempo.wav",
  "public/audio/workout-tempo-final.wav",
  "public/audio/workout-complete.wav",
]);
const execFileAsync = promisify(execFile);

// Values are deliberately irreversible. They cover the maintainer's former
// commit email, production D1 identity/domain, and local home prefix without
// reproducing any of those values in public source.
const KNOWN_PERSONAL_VALUE_HASHES = new Set([
  "8801230947dcd5cbe15158a9c6dfac8f2d5996e40405719bd18f157828907da0",
  "b5802b1e126f4cd9fb898cf4a31b782ff9e0b3965973ab0307ae92880a4f2054",
  "f7da3d3cf29b1f5d71e7e466083c17a459174e94fd02bce4dbea2f77269b0211",
  "b8474b17f6cd97b4bc9ee66d33d2ad1f3fd7fe2cf0e41de92b5f39727dc60af9",
]);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bsk-[A-Za-z0-9_-]{32,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{24,}=*\b/g,
];

function isExcludedPublicPath(path) {
  return path.split("/").some((part) => EXCLUDED_DIRECTORIES.has(part));
}

function isObviouslySyntheticSecret(value) {
  return /(?:not-for-output|placeholder|synthetic)/i.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(root, path) {
  return relative(root, path).split(sep).join("/");
}

function isReservedEmail(email) {
  const domain = email.toLowerCase().split("@").at(-1) ?? "";
  return domain === "example.com"
    || domain.endsWith(".example")
    || domain.endsWith(".invalid")
    || domain.endsWith(".test")
    || domain === "users.noreply.github.com"
    || domain === "noreply.github.com";
}

async function collectFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function publicTreeFiles(root) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.toString("utf8").split("\0").filter(Boolean).filter((path) => !isExcludedPublicPath(path)).map((path) => resolve(root, path));
  } catch {
    return collectFiles(root);
  }
}

function textCandidates(text) {
  return [
    ...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
    ...text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi),
    ...text.matchAll(/https?:\/\/[^\s"'<>`]+/gi),
    ...text.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi),
    ...text.matchAll(/\/(?:Users|home)\/[^/\s"'<>`]+/g),
  ].map((match) => match[0]);
}

function report(findings, category, path, line = null) {
  findings.push(`${category}: ${path}${line === null ? "" : `:${line}`}`);
}

function lineFor(text, index) {
  return text.slice(0, index).split("\n").length;
}

function scanText(findings, publicPath, text) {
  for (const pattern of secretPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (!isObviouslySyntheticSecret(match[0])) report(findings, "common-secret", publicPath, lineFor(text, match.index ?? 0));
    }
  }

  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    if (!isReservedEmail(match[0])) report(findings, "personal-email", publicPath, lineFor(text, match.index ?? 0));
  }

  for (const value of textCandidates(text)) {
    if (KNOWN_PERSONAL_VALUE_HASHES.has(sha256(value))) report(findings, "known-personal-value", publicPath);
  }

  if (publicPath === "wrangler.toml") {
    const databaseIds = [...text.matchAll(/database_id\s*=\s*"([^"]+)"/g)];
    for (const match of databaseIds) {
      if (match[1] !== "00000000-0000-0000-0000-000000000000") report(findings, "production-identity", publicPath, lineFor(text, match.index ?? 0));
    }
    if (/^\s*routes\s*=/m.test(text) || /custom_domain\s*=\s*true/.test(text)) report(findings, "production-identity", publicPath);
    for (const match of text.matchAll(/PUBLIC_ORIGIN\s*=\s*"([^"]+)"/g)) {
      if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(match[1])) report(findings, "production-identity", publicPath, lineFor(text, match.index ?? 0));
    }
  }
}

async function scan(root) {
  const findings = [];
  for (const path of await publicTreeFiles(root)) {
    try {
      await access(path);
    } catch {
      continue;
    }
    const publicPath = normalizePath(root, path);
    const lowerPath = publicPath.toLowerCase();
    if (OPAQUE_ARCHIVE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension))) {
      report(findings, "opaque-archive", publicPath);
      continue;
    }
    if (lowerPath.endsWith(".fit")) {
      report(findings, "raw-fit", publicPath);
      continue;
    }
    const contents = await readFile(path);
    const extension = lowerPath.slice(lowerPath.lastIndexOf("."));
    if (!GENERATED_PUBLIC_BINARY_PATHS.has(publicPath) && (BINARY_ASSET_EXTENSIONS.has(extension) || contents.includes(0))) {
      report(findings, "unreviewed-binary", publicPath);
    }
    // NUL bytes are not a reason to trust an artifact. ASCII credentials and
    // personal identifiers remain visible through a byte-preserving decode.
    scanText(findings, publicPath, contents.toString(contents.includes(0) ? "latin1" : "utf8"));
  }
  return findings;
}

function parseRoot(argv) {
  if (argv.length === 0) return DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === "--root") return resolve(argv[1]);
  throw new Error("Usage: node scripts/scan-public-source.mjs [--root PATH]");
}

const root = parseRoot(process.argv.slice(2));
const findings = await scan(root);
if (findings.length > 0) {
  console.error(`public source scan failed (${findings.length} finding${findings.length === 1 ? "" : "s"}):`);
  for (const finding of [...new Set(findings)].sort()) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("public source scan passed: no secrets, personal identity, production identity, committed FIT, or unreviewed binary artifacts found");
}
