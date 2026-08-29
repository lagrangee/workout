import { readFile, readdir } from "node:fs/promises";
import { strict as assert } from "node:assert";

// This is a source-only gate. It must remain reproducible in a clean checkout
// without a Cloudflare account, production credentials, or private receipts.
const requiredFiles = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "SUPPORT.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  "wrangler.toml",
  "wrangler.production.toml.example",
  ".dev.vars.example",
  "docs/architecture.md",
  "docs/deployment/self-hosting.md",
  "docs/deployment/github-actions.md",
  "docs/deployment/cloudflare-production-checklist.md",
  "docs/release/local-acceptance.md",
  "docs/release/production-acceptance.md",
  "scripts/operator-acceptance.mjs",
  "seed/workout-tracker-weekly-seed.json",
  ".github/workflows/ci.yml",
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  ".github/ISSUE_TEMPLATE/feature-request.yml",
  ".github/pull_request_template.md",
];

const contents = new Map();
for (const file of requiredFiles) contents.set(file, await readFile(file, "utf8"));

const migrations = (await readdir("migrations")).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
assert.ok(migrations.length > 0, "at least one versioned D1 migration is required");

const wrangler = contents.get("wrangler.toml");
assert.match(wrangler, /binding\s*=\s*"DB"/);
assert.match(wrangler, /database_id\s*=\s*"00000000-0000-0000-0000-000000000000"/);
assert.match(wrangler, /PUBLIC_ORIGIN\s*=\s*"http:\/\/127\.0\.0\.1:8787"/);
assert.doesNotMatch(wrangler, /^routes\s*=/m);

const productionExample = contents.get("wrangler.production.toml.example");
assert.match(productionExample, /workout\.example\.com/);
assert.match(productionExample, /PRODUCTION_HOST/);
assert.match(productionExample, /PUBLIC_ORIGIN/);
assert.match(productionExample, /AUTH_LOGIN_LIMIT\s*=\s*"5"/);
assert.match(productionExample, /AUTH_LOGIN_WINDOW_SECONDS\s*=\s*"600"/);

const gitignore = await readFile(".gitignore", "utf8");
assert.match(gitignore, /^\.scratch\/$/m);
assert.match(gitignore, /^wrangler\.production\.toml$/m);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(packageJson.scripts["release-check"], "npm run public:gate");
assert.match(packageJson.scripts["public:gate:online"], /public:gate.*audit:runtime.*audit:development/);
for (const command of ["typecheck", "test:behavior", "test:integration", "test:contracts", "test:browser", "test:coverage", "source:acceptance"]) {
  assert.match(packageJson.scripts["public:gate"], new RegExp(command.replace(":", "\\:")));
}
for (const command of ["assets:check", "licenses:check", "source:scan", "release-acceptance.mjs"]) {
  assert.match(packageJson.scripts["source:acceptance"], new RegExp(command.replace(".", "\\.")));
}
assert.doesNotMatch(packageJson.scripts["release-check"], /operator-acceptance/);

assert.match(contents.get("LICENSE"), /^MIT License$/m);
assert.match(contents.get("THIRD_PARTY_NOTICES.md"), /repository's MIT License/);
assert.match(contents.get("README.md"), /licensed under the \[MIT License\]/);

const ci = contents.get(".github/workflows/ci.yml");
assert.match(ci, /pull_request:/);
assert.match(ci, /push:\s*\n\s*branches:\s*\[main\]/);
assert.match(ci, /node-version:\s*22/);
assert.match(ci, /npm ci/);
assert.match(ci, /npm run public:gate/);
assert.match(ci, /npm run audit:runtime/);
assert.match(ci, /npm run audit:development/);
assert.doesNotMatch(ci, /wrangler-action|wrangler deploy|operator-acceptance/);

assert.match(contents.get("docs/release/production-acceptance.md"), /outside the repository/i);
assert.match(contents.get("docs/release/local-acceptance.md"), /documentation evidence/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /high severity/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /critical severity/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /does not establish/i);

console.log(`Public source acceptance passed: ${requiredFiles.length} artifacts and ${migrations.length} migrations checked without production access; no release or deployment is claimed.`);
