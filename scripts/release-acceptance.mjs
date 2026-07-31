import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const files = ["wrangler.toml", "migrations/0001_initial.sql", "migrations/0002_state_revision.sql", "migrations/0003_query_indexes.sql", "migrations/0004_restore_session_date_guard.sql", "seed/workout-tracker-weekly-seed.json", "docs/deployment/cloudflare-production-checklist.md", "docs/deployment/github-actions.md", "docs/deployment/wrangler-manual-deploy.md", "docs/recovery/d1-time-travel-and-export-rehearsal.md", "docs/release/seed-verification.md", "docs/release/production-acceptance.md", ".github/workflows/ci.yml"];
for (const file of files) await readFile(file, "utf8");
const wrangler = await readFile("wrangler.toml", "utf8");
assert.match(wrangler, /workers_dev\s*=\s*false/);
assert.match(wrangler, /preview_urls\s*=\s*false/);
assert.match(wrangler, /binding\s*=\s*"DB"/);
const ci = await readFile(".github/workflows/ci.yml", "utf8");
assert.match(ci, /pull_request:/);
assert.match(ci, /npm run release-check/);
assert.doesNotMatch(ci, /wrangler-action|npm run deploy|wrangler deploy/);
const manualDeploy = await readFile("docs/deployment/wrangler-manual-deploy.md", "utf8");
assert.match(manualDeploy, /npx wrangler deploy/);
assert.match(manualDeploy, /workout\.lagrangee\.xyz\/healthz/);
console.log("Local release acceptance evidence: configuration and recovery artifacts present.");
console.log("Production acceptance status: blocked until the owner verifies application secrets/session login, hostname bypass, quotas, seed read-back, and a synthetic Time Travel rehearsal.");
