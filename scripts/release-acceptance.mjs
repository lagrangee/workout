import { readFile, readdir } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateLocalMigrationNames } from "./preflight-production-deploy.mjs";

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
  "vite.config.ts",
  "tsconfig.web.json",
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
  "web/index.html",
  "web/src/main.ts",
  "public/_headers",
  "scripts/deploy-production.mjs",
  "scripts/operator-acceptance.mjs",
  "scripts/prepare-production-config.mjs",
  "scripts/preflight-production-deploy.mjs",
  "tests/operator-acceptance.test.js",
  "tests/production-deploy.test.js",
  "seed/workout-tracker-weekly-seed.json",
  ".github/workflows/ci.yml",
  ".github/workflows/deploy.yml",
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

const migrations = validateLocalMigrationNames((await readdir("migrations")).filter((name) => name.endsWith(".sql")));

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
assert.match(productionExample, /^\[secrets\]$/m);
assert.match(productionExample, /^required\s*=\s*\[/m);
assert.match(productionExample, /^RELEASE_REVISION\s*=\s*"replace-with-deployed-git-sha"$/m);
assert.match(productionExample, /^name\s*=\s*"COACH_RATE_LIMITER"$/m);
assert.match(productionExample, /^namespace_id\s*=\s*"1001"$/m);
assert.match(productionExample, /^\s*limit\s*=\s*120$/m);
assert.match(productionExample, /^\s*period\s*=\s*60$/m);

const gitignore = await readFile(".gitignore", "utf8");
assert.match(gitignore, /^\.scratch\/$/m);
assert.match(gitignore, /^\.bearing\/$/m);
assert.match(gitignore, /^\.impeccable\/$/m);
assert.match(gitignore, /^AGENTS\.md$/m);
assert.match(gitignore, /^docs\/agents\/$/m);
assert.match(gitignore, /^\.wrangler\/$/m);
assert.match(gitignore, /^wrangler\.production\.toml$/m);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
assert.equal(packageJson.scripts["release-check"], "npm run public:gate");
assert.equal(packageJson.scripts.test, "node --test tests/*.test.js");
assert.equal(packageJson.scripts["prepare:production-config"], "node scripts/prepare-production-config.mjs");
assert.equal(packageJson.scripts["cleanup:production-config"], "node scripts/prepare-production-config.mjs --cleanup");
assert.equal(packageJson.scripts["preflight:production"], "node scripts/preflight-production-deploy.mjs");
assert.equal(packageJson.scripts["deploy:production"], "node scripts/deploy-production.mjs");
assert.doesNotMatch(packageJson.scripts["deploy:production"], /build|migrations/);
assert.equal(packageLock.packages["node_modules/wrangler"].version, "4.127.1");
assert.match(packageJson.scripts["public:gate:online"], /public:gate.*audit:runtime.*audit:development/);
for (const command of ["typecheck", "build", "test:behavior", "test:integration", "test:contracts", "test:browser", "test:ui", "test:coverage", "source:acceptance"]) {
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

const productionConfigGenerator = contents.get("scripts/prepare-production-config.mjs");
assert.match(productionConfigGenerator, /WORKOUT_D1_DATABASE_ID/);
assert.match(productionConfigGenerator, /WORKOUT_PUBLIC_ORIGIN/);
assert.match(productionConfigGenerator, /WORKOUT_RELEASE_REVISION/);
assert.match(productionConfigGenerator, /WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID/);
assert.match(productionConfigGenerator, /\.wrangler\/workout\.production\.toml/);
assert.match(productionConfigGenerator, /renderProductionConfig/);
assert.match(productionConfigGenerator, /--dry-run/);
assert.match(productionConfigGenerator, /mode: 0o600/);
assert.match(productionConfigGenerator, /--cleanup/);
assert.doesNotMatch(productionConfigGenerator, /console\.(?:log|error)\([^\n]*(?:databaseId|rawDatabaseId|productionConfig|sourceConfig)/);
assert.deepEqual(
  [...new Set(productionConfigGenerator.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? [])],
  ["00000000-0000-0000-0000-000000000000"],
  "the generator source may contain only the committed placeholder UUID",
);

const productionPreflight = contents.get("scripts/preflight-production-deploy.mjs");
assert.match(productionPreflight, /AbortSignal\.timeout\(60_000\)/);
assert.match(productionPreflight, /--verify-migrations/);

const operatorAcceptance = contents.get("scripts/operator-acceptance.mjs");
assert.match(operatorAcceptance, /WORKOUT_PUBLIC_ORIGIN/);
assert.match(operatorAcceptance, /EXPECTED_GITHUB_SHA/);
assert.match(operatorAcceptance, /\/healthz/);
assert.ok(operatorAcceptance.includes('src="\\/assets\\/index-'));
assert.match(operatorAcceptance, /unauthenticated_private_api/);

const staticHeaders = contents.get("public/_headers");
for (const header of [
  "Content-Security-Policy:",
  "Permissions-Policy:",
  "Referrer-Policy:",
  "X-Content-Type-Options:",
  "X-Robots-Tag:",
]) assert.match(staticHeaders, new RegExp(`^\\s*${header}`, "m"));
assert.doesNotMatch(staticHeaders, /^\s*Cache-Control:/mi);
const viteConfig = contents.get("vite.config.ts");
assert.match(viteConfig, /publicDir:\s*resolve\(repositoryRoot,\s*"public"\)/);
assert.match(viteConfig, /outDir:\s*resolve\(repositoryRoot,\s*"dist"\)/);
try {
  const builtHeaders = await readFile("dist/_headers", "utf8");
  assert.equal(builtHeaders, staticHeaders, "the gated Vite build must copy the static header policy exactly");
} catch (error) {
  if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  // Direct source-only invocation may precede `npm run build`; public:gate
  // always builds first, so the release path exercises the exact copy check.
}

const sourceTestEnvironment = { ...process.env };
for (const name of [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "EXPECTED_GITHUB_SHA",
  "WORKOUT_D1_DATABASE_ID",
  "WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID",
  "WORKOUT_PUBLIC_ORIGIN",
  "WORKOUT_RELEASE_REVISION",
]) delete sourceTestEnvironment[name];
await execFileAsync(process.execPath, [
  "--test",
  "tests/operator-acceptance.test.js",
  "tests/production-deploy.test.js",
], {
  env: sourceTestEnvironment,
  maxBuffer: 16 * 1024 * 1024,
});

assert.match(contents.get("docs/deployment/self-hosting.md"), /outside the repository/i);
assert.match(contents.get("docs/validation.md"), /Documentation\s+checks\s+prove\s+only/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /high severity/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /critical severity/i);
assert.match(contents.get("docs/deployment/github-actions.md"), /does not (?:establish|prove)/i);

console.log(`Public source acceptance passed: ${requiredFiles.length} artifacts and ${migrations.length} migrations checked without production access; no release or deployment is claimed.`);
