# GitHub Actions validation and production deployment

The repository has two workflows with deliberately different authority.

## Public source validation

`.github/workflows/ci.yml` validates pull requests and pushes to `main`. Both
events use Node.js 22, install the locked dependency graph with `npm ci`, and
install the locked Chromium Headless Shell plus its Linux system dependencies
before running `npm run public:gate`.

The gate covers Worker and Vue type checks, the production Vite build,
behavioral and integration tests, contract and Node interface tests, Vue
component tests, a real Chromium smoke against the credential-free synthetic
Worker preview, focused coverage, generated-asset and license checks, the
public-tree privacy scan, and documentation lint. Documentation lint is
documentation evidence only; it does not substitute for runtime behavior or
manual visual acceptance.

Dependency advisory review is online-only because `npm audit` requires the npm
registry. Runtime dependencies fail CI at high severity or above; the complete
graph, including development dependencies, fails at critical severity. Run
`npm run public:gate:online` to reproduce the source gate and both policies.

## Main-to-production deployment

`.github/workflows/deploy.yml` runs on pushes to `main`. It also exposes
`workflow_dispatch`, but the job requires `refs/heads/main`; pull requests and
manual runs from other refs cannot deploy. Its concurrency key includes the
Git ref and never cancels an active run. GitHub concurrency keeps at most one
running and one pending run per key, so a newer pending `main` run can replace
an older pending run. This is a serialized latest-wins policy, not a promise to
deploy every intermediate commit. An off-main manual run has a different key
and cannot evict a pending `main` run.

The runner performs these operations in order:

1. Check out `${{ github.sha }}` explicitly with GitHub-owned actions pinned to
   full commit SHAs, fetch the Git history needed for migration comparison,
   disable persisted Git credentials, install with `npm ci`, and install the
   locked Chromium Headless Shell plus its Linux system dependencies.
2. Run `npm run release-check`. That gate creates the Vite `dist/`; no later
   step checks out source again, rebuilds, or replaces the gated artifact.
3. Run the high-severity runtime and critical-severity complete-graph advisory
   policies.
4. Read public `refs/heads/main` and reject a stale rerun before any secret is
   exposed.
5. Compare the push's `before` revision with `${{ github.sha }}` and reject any
   modification, deletion, type change, or rename of an existing
   `migrations/*.sql` file. New files remain allowed only when the complete
   inventory is consecutively numbered and well formed. For manual dispatch,
   the current commit's first parent is the comparison base.
6. Generate `.wrangler/workout.production.toml`. Only this step receives
   `WORKOUT_D1_DATABASE_ID` and the private Coach namespace; the exact Git SHA
   is non-secret, while `WORKOUT_PUBLIC_ORIGIN` is private operator state. All
   four inputs are step-scoped. The generator rejects the all-zero D1 placeholder,
   malformed IDs, non-canonical HTTPS origins, non-lowercase 40-character
   revisions, and non-positive or zero-padded namespace identifiers. It derives
   the custom-domain hostname, retains the fixed
   `DEFAULT_TIMEZONE=Asia/Shanghai`, adds the eight required Worker secret
   names, and creates `COACH_RATE_LIMITER` with the contract 120 requests per
   60 seconds. The exact Worker-first list is `/`, `/api/*`, `/coach/*`,
   `/healthz`, and `/app`; hashed assets remain asset-first. It writes the
   ignored file with mode `0600` and never logs the origin, hostname, revision,
   D1 ID, or namespace.
7. With Cloudflare credentials scoped only to the preflight step, capture and
   parse `wrangler secret list`, `wrangler d1 list`, and a read-only
   `wrangler d1 execute DB --remote --json` probe. It also captures the
   Cloudflare custom-domain inventory through the official Workers API. The
   probe verifies the eight
   documented secret names without reading their values, matches the named D1
   database to the generated binding, checks the current schema signature,
   requires the remote `d1_migrations` filename ledger to equal the committed
   consecutive migration inventory, and requires `PRAGMA foreign_key_check` to
   return no rows. The custom-domain inventory must contain exactly one entry
   for `workout-tracker`, whose hostname equals the private origin. Captured
   Wrangler/API output is never forwarded to logs. These commands are
   read-only; the shared deployment credential itself still has write authority.
8. In a separate deploy step, read remote `main` again immediately before the
   mutation, then invoke a Node `execFile` wrapper around Wrangler 4.127.1 with
   `--strict`. Supported conflicts from Dashboard or Script API configuration
   block the upload instead of being silently overwritten. This is not a
   complete remote metadata comparison: the generated TOML is the deployment
   source of truth, and Wrangler-origin or undeclared bindings may be replaced
   or removed. The wrapper captures Wrangler output and emits only a fixed
   receipt; the Worker version message is `GitHub <GITHUB_SHA>`.
9. Remove only the fixed generated config path, even after a failed preflight or
   deploy. A successful path must finish this cleanup before acceptance.
10. Run operator acceptance without a Cloudflare credential. This step receives
   only the expected SHA and private origin. It requires production `/healthz` to report that exact
   revision, fetches the one Vite module asset and validates its JavaScript
   response, parses the Coach schema catalog, and parses the unauthenticated
   private-API error envelope.

The deploy workflow never runs a D1 migration command. A schema-changing
release must apply and verify its reviewed migration as a separate operator
transaction before code that needs it is merged.

## Required GitHub and Cloudflare configuration

Configure these three names as secrets on the GitHub `production` environment,
not as public repository variables:

- `WORKOUT_D1_DATABASE_ID`
- `WORKOUT_PUBLIC_ORIGIN`
- `WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID`

The existing Cloudflare credential names may remain repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The workflow references those credentials only in the production preflight and
deploy steps. Moving them to the environment later requires an operator to
provide the values again; GitHub does not expose existing secret values for
copying.

`WORKOUT_PUBLIC_ORIGIN` is private operator state: keep the real hostname out of
the repository, issue text, GitHub variables, and logs. It must be a canonical
HTTPS origin with no credentials, port, path, query, fragment, or trailing
slash. `WORKOUT_COACH_RATE_LIMIT_NAMESPACE_ID` must be a positive integer
string with no leading zero, unique within the Cloudflare account, and not
shared with another limiter unless shared counters are explicitly intended.
Although it is not an authentication credential, storing it as an environment
secret keeps the public repository metadata private. The public repository
deliberately does not attach the origin as the GitHub deployment environment
URL. The current `production` environment has no
approval rule, so a green push to `main` deploys automatically. Adding a
protection rule later would deliberately change this to an approval-gated
transaction.

The custom domain and named D1 database must already exist. The Cloudflare API
token therefore needs the permissions required to deploy the Worker plus D1
Read and Workers Scripts Read for the preflight. The workflow reuses that
write-capable deployment token for read-only preflight commands; it does not
claim that the credential is least-privilege read-only.

The Cloudflare Worker must already have these eight secret names:

- `ATHLETE_A_EMAIL`
- `ATHLETE_B_EMAIL`
- `AUTH_A_PASSWORD`
- `AUTH_B_PASSWORD`
- `AUTH_SESSION_SECRET`
- `AGENT_TOKEN_SECRET`
- `COACH_LOOKUP_SECRET`
- `COACH_ENCRYPTION_SECRET`

The generated `[secrets].required` declaration and the explicit inventory
preflight are defense in depth. Neither mechanism reads or proves secret
values.

The generated production configuration intentionally creates one distributed
rate-limit binding: `COACH_RATE_LIMITER`, at 120 requests per 60 seconds, using
the configured namespace. No authentication rate-limit binding is part of the
upstream production configuration. Authentication therefore uses its
documented per-isolate fallback budgets. The workflow does not infer undeclared
bindings, and the 600-second fallback window must not be represented as
equivalent to a Cloudflare binding whose supported period is different.

## Evidence boundary

The source gate and deployment source tests require no GitHub or Cloudflare
credential. A successful production workflow additionally proves that the
required Worker secret names were listed, the generated binding matched the
named D1 database, the expected schema signature and migration filenames were
present, the foreign-key check was empty, the existing custom domain matched
the private origin, Wrangler accepted the strict deploy, the generated config
was removed, and public acceptance read back the exact deployed Git SHA.

The migration ledger stores filenames, not historical SQL digests. Its exact
match does not prove that already-applied SQL bytes equal the current files.
The workflow also does not prove secret values, authenticated Athlete
isolation, D1 recovery, release/tag state, or human acceptance.

Official references:

- [Cloudflare: Deploy with GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare: Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare: Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [Cloudflare: D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare: D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare: Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare: Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Cloudflare: Custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare: Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare: Versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [GitHub: Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub: Control workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub: Use secrets in workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [GitHub: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
