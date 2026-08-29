import { readFile, readdir } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  "docs/README.md",
  "docs/product.md",
  "docs/domain-model.md",
  "docs/design-system.md",
  "docs/architecture.md",
  "docs/validation.md",
  "docs/deployment/self-hosting.md",
  "docs/deployment/github-actions.md",
  "docs/guides/agent-mcp.md",
  "scripts/operator-acceptance.mjs",
  "seed/workout-tracker-weekly-seed.json",
  ".github/workflows/ci.yml",
  ".github/ISSUE_TEMPLATE/bug-report.yml",
  ".github/ISSUE_TEMPLATE/feature-request.yml",
  ".github/pull_request_template.md",
];

const contents = new Map();
for (const file of requiredFiles) contents.set(file, await readFile(file, "utf8"));

const { stdout: trackedOutput } = await execFileAsync(
  "git",
  ["ls-files", "-z"],
  { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
);
const trackedPaths = trackedOutput.toString("utf8").split("\0").filter(Boolean);
const localOnlyPrefixes = [".bearing/", ".impeccable/", ".scratch/", ".omo/", "docs/agents/"];
const trackedLocalOnlyPaths = trackedPaths.filter(
  (path) => path === "AGENTS.md" || localOnlyPrefixes.some((prefix) => path.startsWith(prefix)),
);
assert.deepEqual(trackedLocalOnlyPaths, [], "local agent and tool state must stay outside the public tree");

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
assert.match(gitignore, /^\.bearing\/$/m);
assert.match(gitignore, /^\.impeccable\/$/m);
assert.match(gitignore, /^AGENTS\.md$/m);
assert.match(gitignore, /^docs\/agents\/$/m);
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

assert.match(contents.get("docs/deployment/self-hosting.md"), /outside the repository/i);
assert.match(contents.get("docs/validation.md"), /Documentation\s+checks prove only/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /high severity/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /critical severity/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /does not establish/i);

console.log(`Public source acceptance passed: ${requiredFiles.length} artifacts and ${migrations.length} migrations checked without production access; no release or deployment is claimed.`);
