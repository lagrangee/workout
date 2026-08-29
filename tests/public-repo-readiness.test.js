// @ts-nocheck

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authenticatedCoachUrl, schemaResource } from "../src/coach.js";

test("public configuration contains only reproducible placeholder identities", async () => {
  const wrangler = await readFile("wrangler.toml", "utf8");
  const production = await readFile("wrangler.production.toml.example", "utf8");
  assert.match(wrangler, /00000000-0000-0000-0000-000000000000/);
  assert.match(production, /workout\.example\.com/);
  assert.doesNotMatch(wrangler, /^routes\s*=/m);
});

test("Coach schema identifiers use the configured request origin", () => {
  const schema = schemaResource("manifest", "https://self-host.example:8443");
  assert.equal(schema.$id, "https://self-host.example:8443/api/coach/v1/schemas/manifest");
  assert.equal(schemaResource("manifest").$id, "/api/coach/v1/schemas/manifest");
});

test("Coach Share URL creation fails closed without a configured public origin", async () => {
  await assert.rejects(() => authenticatedCoachUrl({
    athlete_key: "ath_example",
    coach_share: { share_key: "share_example", revoked_at: null },
  }, {}), /Missing required configuration PUBLIC_ORIGIN/);
});
