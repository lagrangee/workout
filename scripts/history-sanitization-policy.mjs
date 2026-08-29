import { createHash } from "node:crypto";

export const PUBLIC_NO_REPLY_EMAIL =
  "1306600+lagrangee@users.noreply.github.com";

// These paths contained operator-specific, private, or unreviewed redistributed
// material in older commits. A safe version may exist at the audited source tip;
// the rehearsal restores that version in a new commit after removing every older
// version from reachable history.
export const DEFAULT_HISTORY_REMOVE_PATHS = Object.freeze([
  "tests/fixtures/fit/coros-2026-08-23.fit",
  "wrangler.toml",
  ".github/workflows/deploy.yml",
  "docs/deployment/cloudflare-production-checklist.md",
  "docs/deployment/github-actions.md",
  "docs/deployment/wrangler-manual-deploy.md",
  "docs/research/cloudflare-free-deployment-and-identity-topology.md",
  "docs/release/agent-mcp-acceptance.md",
  "docs/release/agent-mcp-onboarding.md",
  "docs/release/local-acceptance.md",
  "docs/release/production-acceptance.md",
  "docs/release/seed-verification.md",
  "src/agent-archive-api.js",
  "src/coach.js",
  "src/http.js",
  "public/app.js",
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
  "tests/fit-decoder.test.js",
  "tests/training-archive-fit-integration.test.js",
  "tests/training-archive-snapshot.test.js",
  "tests/training-source-snapshot.test.js",
  "tests/training-archive-contract.test.js",
  "tests/training-archive-records.test.js",
  "tests/training-archive-routes.test.js",
  "tests/training-archive-sync-api.test.js",
  "tests/training-archive-sync-reliable.test.js",
]);

// These scratch records independently contain private operator or live
// acceptance material. No other scratch path is removed by category or glob.
export const SENSITIVE_SCRATCH_HISTORY_PATHS = Object.freeze([
  ".scratch/workout-agent-mcp-access/issues/07-connect-local-mcp-and-complete-live-acceptance.md",
  ".scratch/workout-tracker-mvp/issues/13-review-the-implementation-ready-mvp-handoff.md",
  ".scratch/workout-tracker-mvp/issues/14-verify-live-cloudflare-deployment-prerequisites.md",
  ".scratch/workout-tracker-mvp/issues/24-harden-cloudflare-production-deployment.md",
  ".scratch/workout-tracker-mvp/issues/25-run-release-acceptance.md",
  ".scratch/workout-tracker-mvp/issues/26-publish-private-github-repo-and-auto-deploy.md",
  ".scratch/workout-tracker-mvp/issues/27-import-and-verify-initial-weekly-seed.md",
  ".scratch/workout-tracker-mvp/map.md",
  ".scratch/workout-tracker-mvp/spec.md",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateRepoPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.split("/").includes("..")
  ) {
    throw new Error("history remove paths must be safe repository-relative paths");
  }
  return value;
}

export function parsePrivatePatterns(contents) {
  const values = contents
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !value.startsWith("#"));

  if (values.length === 0) {
    throw new Error("private pattern input must contain at least one value");
  }
  if (values.some((value) => value.length < 8)) {
    throw new Error("private patterns shorter than 8 characters are not accepted");
  }
  return [...new Set(values)];
}

export function matchesAnyPrivatePattern(buffer, patterns) {
  return patterns.some((pattern) => buffer.includes(Buffer.from(pattern, "utf8")));
}

function strictText(buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
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

export function historyMaterialCategories(path, buffer) {
  const categories = new Set();
  const lowerPath = path?.toLowerCase() ?? "";
  if (lowerPath.endsWith(".fit")) {
    categories.add("unapproved-fit");
  }

  // Credential-shaped ASCII must remain visible even inside opaque binary
  // material. Generic email matching is intentionally narrower: binary C2PA
  // and certificate payloads can contain non-personal issuer addresses, while
  // exact private values are scanned byte-for-byte by the rehearsal.
  const byteText = buffer.toString("latin1");
  const text = strictText(buffer);
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/gu,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/gu,
    /\bsk-[A-Za-z0-9_-]{32,}\b/gu,
    /\bAKIA[0-9A-Z]{16}\b/gu,
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{24,}=*\b/gu,
  ];
  if (secretPatterns.some((pattern) => pattern.test(byteText))) categories.add("common-secret");
  if (text !== null) {
    for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)) {
      if (!isReservedEmail(match[0])) categories.add("personal-email");
    }
  }
  if (path === "wrangler.toml") {
    const configurationText = text ?? byteText;
    if (/database_id\s*=\s*"(?!00000000-0000-0000-0000-000000000000")[^"]+"/u.test(configurationText)) {
      categories.add("production-identity");
    }
    if (/^\s*routes\s*=/mu.test(configurationText) || /custom_domain\s*=\s*true/u.test(configurationText)) {
      categories.add("production-identity");
    }
    for (const match of configurationText.matchAll(/PUBLIC_ORIGIN\s*=\s*"([^"]+)"/gu)) {
      if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(match[1])) {
        categories.add("production-identity");
      }
    }
  }
  return [...categories].sort();
}

export function selectPrivateEmail(emails, expectedHash) {
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) {
    throw new Error("private email SHA-256 must be a lowercase 64-character hex digest");
  }
  const candidates = [...new Set(emails)].filter(
    (email) => sha256(email.toLowerCase()) === expectedHash,
  );
  if (candidates.length !== 1) {
    throw new Error(
      `expected exactly one private email matching the supplied digest; found ${candidates.length}`,
    );
  }
  return candidates[0];
}

export function expectedRewrittenMetadata(original, privateEmail) {
  const mapEmail = (email) =>
    email === privateEmail ? PUBLIC_NO_REPLY_EMAIL : email;
  return {
    authorName: original.authorName,
    committerName: original.committerName,
    authorEmail: mapEmail(original.authorEmail),
    committerEmail: mapEmail(original.committerEmail),
    authorDate: original.authorDate,
    committerDate: original.committerDate,
  };
}

export function assertRewrittenMetadata(original, rewritten, privateEmail) {
  const expected = expectedRewrittenMetadata(original, privateEmail);
  const mismatches = Object.keys(expected).filter(
    (field) => expected[field] !== rewritten[field],
  );
  if (mismatches.length > 0) {
    throw new Error(`rewritten commit metadata drifted: ${mismatches.join(", ")}`);
  }
}
