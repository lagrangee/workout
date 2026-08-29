// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("redistributed PNG and WAV assets match the deterministic public generator", () => {
  const result = spawnSync(process.execPath, ["scripts/generate-public-assets.mjs", "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /public assets are reproducible/);
});

test("all installed dependencies expose an explicitly reviewed SPDX license", () => {
  const result = spawnSync(process.execPath, ["scripts/check-public-licenses.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dependency licenses reviewed/);
});

test("third-party notices explain the FIT codec, synthetic fixture, icons, and audio provenance", async () => {
  const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.match(notices, /fit-file-parser.*5\.0\.2.*MIT/is);
  assert.match(notices, /synthetic FIT.*deterministic/is);
  assert.match(notices, /PNG icons.*generated/is);
  assert.match(notices, /WAV cues.*generated/is);
  assert.doesNotMatch(notices, /@garmin\/fitsdk/);
});
