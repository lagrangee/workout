// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * @param {Record<string, string | Uint8Array>} files
 * @param {(root: string) => Promise<void>} run
 */
async function withTree(files, run) {
  const root = await mkdtemp(join(tmpdir(), "workout-public-source-gate-"));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const target = join(root, path);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, contents);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** @param {string} root */
function scan(root) {
  return spawnSync(process.execPath, ["scripts/scan-public-source.mjs", "--root", root], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
}

test("public source scan accepts a synthetic text-only source tree", async () => {
  await withTree({
    "README.md": "Contact security@example.invalid.\n",
    "wrangler.toml": "database_id = \"00000000-0000-0000-0000-000000000000\"\nPUBLIC_ORIGIN = \"http://127.0.0.1:8787\"\n",
  }, async (root) => {
    const result = scan(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /public source scan passed/);
  });
});

test("public source scan rejects every committed FIT including the former synthetic path", async () => {
  await withTree({
    "tests/fixtures/fit/synthetic-workout.fit": Buffer.from([0x0e, 0x20, 0x00, 0x00]),
  }, async (root) => {
    const result = scan(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /raw-fit/);
  });
});

test("public source scan rejects binary assets outside the generator-owned path set", async () => {
  await withTree({
    "public/unreviewed.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
  }, async (root) => {
    const result = scan(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unreviewed-binary/);
  });
});

test("public source scan rejects common secrets without echoing secret material", async () => {
  const fakeToken = String.fromCharCode(103, 104, 112, 95) + "A".repeat(40);
  await withTree({ "src/config.js": `export const credential = "${fakeToken}";\n` }, async (root) => {
    const result = scan(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /common-secret/);
    assert.doesNotMatch(result.stderr, new RegExp(fakeToken));
  });
});

test("public source scan never trusts credential-shaped values marked as synthetic, placeholder, or not-for-output", async (t) => {
  const punctuation = String.fromCharCode(45);
  const prefixes = {
    classicGitHub: String.fromCharCode(103, 104, 112, 95),
    fineGrainedGitHub: ["git", "hub", "_pat", "_"].join(""),
    openAi: String.fromCharCode(115, 107, 45),
    aws: String.fromCharCode(65, 75, 73, 65),
    bearer: ["Bear", "er", " "].join(""),
    basic: ["Ba", "sic", " "].join(""),
    privateKey: `${punctuation.repeat(5)}${["BEGIN", "PRIVATE", "KEY"].join(" ")}${punctuation.repeat(5)}`,
  };
  const markerCases = ["synthetic", "placeholder", "not-for-output"];
  const credentialClasses = [
    ["classic GitHub token", (marker) => `${prefixes.classicGitHub}${marker.replaceAll(punctuation, "")}${"A".repeat(40)}`],
    ["fine-grained GitHub token", (marker) => `${prefixes.fineGrainedGitHub}${marker.replaceAll(punctuation, "")}${"B".repeat(40)}`],
    ["OpenAI-style token", (marker) => `${prefixes.openAi}${marker}${"C".repeat(40)}`],
    ["AWS access key", (marker) => `${prefixes.aws}${`${marker.replaceAll(punctuation, "").toUpperCase()}${"D".repeat(16)}`.slice(0, 16)}`],
    ["Bearer credential", (marker) => `${prefixes.bearer}${marker}${"E".repeat(32)}`],
    ["Basic credential", (marker) => `${prefixes.basic}${marker}${"F".repeat(32)}`],
    ["private key", (marker) => `${prefixes.privateKey}\n${marker}\n`],
  ];

  for (const marker of markerCases) {
    for (const [credentialClass, buildCredential] of credentialClasses) {
      await t.test(`${credentialClass} containing ${marker}`, async () => {
        const credential = buildCredential(marker);
        await withTree({ "src/config.js": `export const credential = ${JSON.stringify(credential)};\n` }, async (root) => {
          const result = scan(root);
          assert.notEqual(result.status, 0, result.stderr || result.stdout);
          assert.match(result.stderr, /common-secret/);
          assert.ok(!result.stderr.includes(credential), "scanner output must not echo credential material");
        });
      });
    }
  }
});

test("public source scan inspects opaque binary bytes instead of skipping NUL files", async () => {
  const fakeToken = String.fromCharCode(103, 104, 112, 95) + "B".repeat(40);
  const payload = Buffer.concat([Buffer.from([0x00, 0xff, 0x00]), Buffer.from(fakeToken, "ascii")]);
  await withTree({ "payload.bin": payload }, async (root) => {
    const result = scan(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /common-secret/);
    assert.doesNotMatch(result.stderr, new RegExp(fakeToken));
  });
});

test("public source scan rejects personal email, production identity, and unapproved raw FIT", async () => {
  const privateEmail = `${["athlete", "personal"].join(String.fromCharCode(64))}.${"local"}`;
  await withTree({
    "notes.md": `${privateEmail}\n`,
    "wrangler.toml": "database_id = \"11111111-2222-4333-8444-555555555555\"\nroutes = [{ pattern = \"tracker.private.invalid\", custom_domain = true }]\n",
    "tests/fixtures/fit/device-activity.fit": Buffer.from([0x0e, 0x20, 0x00, 0x00]),
    "private-review.zip": Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  }, async (root) => {
    const result = scan(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /personal-email/);
    assert.match(result.stderr, /production-identity/);
    assert.match(result.stderr, /raw-fit/);
    assert.match(result.stderr, /opaque-archive/);
    assert.doesNotMatch(result.stderr, new RegExp(privateEmail.replaceAll(".", "\\.")));
  });
});

test("public CI runs the same clean source baseline for pull requests and default-branch pushes", async () => {
  const [workflow, manifest] = await Promise.all([
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
  assert.match(workflow, /npm run public:gate/);
  assert.match(workflow, /npm run audit:runtime/);
  assert.match(workflow, /npm run audit:development/);
  assert.match(manifest.scripts["public:gate"], /test:behavior/);
  assert.match(manifest.scripts["public:gate"], /test:integration/);
  assert.match(manifest.scripts["public:gate"], /test:contracts/);
  assert.match(manifest.scripts["public:gate"], /test:browser/);
  assert.match(manifest.scripts["public:gate"], /test:coverage/);
  assert.match(manifest.scripts["public:gate"], /docs:lint/);

  const failedPipeline = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", "false | tee /dev/null"], { encoding: "utf8" });
  assert.notEqual(failedPipeline.status, 0, "explicit Bash must propagate a gate or audit failure through tee");
});
