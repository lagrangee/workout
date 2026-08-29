# Self-hosting Workout Tracker

Workout Tracker deploys one Cloudflare Worker, Vite-built static assets, and one
D1 database. Keep the live origin, Cloudflare identifiers, credentials, and
deployment receipts outside the repository. Examples below use reserved
synthetic values only.

## Prepare private production configuration

Start from `wrangler.production.toml.example`, copy it to the ignored
`wrangler.production.toml`, and replace every operator-specific value:

- choose the Worker name and a custom HTTPS hostname you control;
- replace the all-zero D1 `database_id` with the UUID of the named production
  database;
- set `RELEASE_REVISION` to the exact lowercase 40-character SHA of the
  checkout being deployed; the example sentinel is intentionally invalid and
  makes production `/healthz` fail closed until replaced;
- set `PRODUCTION_HOST` and `PUBLIC_ORIGIN` from the same canonical HTTPS
  origin, with no credentials, port, path, query, fragment, or trailing slash;
- choose the production `DEFAULT_TIMEZONE` (the upstream deployment uses
  `Asia/Shanghai`); and
- replace the synthetic `COACH_RATE_LIMITER` namespace `1001` with your own
  positive integer namespace identifier that is unique within the Cloudflare
  account. Do not reuse another limiter's namespace unless shared counters are
  intentional. Keep its contract at 120 requests per 60 seconds.

The exact Worker-first route list is `/`, `/api/*`, `/coach/*`, `/healthz`, and
`/app`. This keeps the authenticated shell, dynamic APIs, Coach capability, and
health response behind the Worker while Vite hashed modules remain
asset-first. `public/_headers` supplies the security headers for other static
SPA fallbacks without changing Cloudflare's asset cache policy.

The production example declares these required Worker secret names, but never
contains their values:

- `ATHLETE_A_EMAIL`
- `ATHLETE_B_EMAIL`
- `AUTH_A_PASSWORD`
- `AUTH_B_PASSWORD`
- `AUTH_SESSION_SECRET`
- `AGENT_TOKEN_SECRET`
- `COACH_LOOKUP_SECRET`
- `COACH_ENCRYPTION_SECRET`

Create or rotate them with `wrangler secret put` against your private config.
Do not put secret values in shell history, issue text, logs, or committed files.

## Bootstrap Cloudflare state

Create the D1 database and custom domain as explicit operator transactions
before using the repository's automatic workflow. That workflow deliberately
requires the named `workout-tracker` database and the Worker custom-domain
inventory to match its private configuration before upload; it does not create
or migrate those resources as a side effect of a push.

D1 migrations are a separate transaction from Worker deployment. Review the
SQL, apply it explicitly with Wrangler against the intended remote database,
and verify the ledger and schema before deploying code that requires it. The
automatic main workflow never runs `d1 migrations apply`.

Wrangler's D1 migration ledger records filenames, not a historical digest of
each applied SQL file. An exact filename match proves the reviewed sequence was
recorded, but not that the bytes currently in a same-named local file are the
bytes historically executed.

## Validate and deploy

From the exact checkout to be deployed:

```bash
npm ci
npm run test:browser:install
npm run release-check
npm run audit:runtime
npm run audit:development
npx wrangler deploy --strict --config wrangler.production.toml --message "GitHub <exact-40-character-checkout-sha>"
```

`release-check` creates `dist/`. Do not rebuild or replace it between the final
gate and deploy. `--strict` rejects the remote configuration conflicts Wrangler
supports for Dashboard or Script API changes; it is not a complete inventory
comparison. Treat the private Wrangler file as deployment truth: metadata and
bindings absent from it may be replaced or removed.

After deployment, use the same origin and SHA that were written to the private
configuration:

```bash
WORKOUT_PUBLIC_ORIGIN="https://workout.example.invalid" \
EXPECTED_GITHUB_SHA="0123456789abcdef0123456789abcdef01234567" \
node scripts/operator-acceptance.mjs
```

Replace both synthetic values. Acceptance reads public, credential-free
boundaries: exact revision health, the Vite shell and unique hashed JavaScript
module, the schema catalog, and the unauthenticated private-API error envelope.
It does not test authenticated Athlete data or expose the origin in its receipt.

## Rate limiting and evidence boundaries

`COACH_RATE_LIMITER` is a required production binding because the public Coach
API contract is 120 requests per 60 seconds. The upstream configuration does
not create distributed authentication rate-limit bindings: authentication uses
its documented per-isolate fallback. Its 600-second fallback window must not be
described as equivalent to Cloudflare's simple rate-limit periods.

Keep the generated config and raw Wrangler output private, and remove temporary
production configs after the deploy/preflight transaction. A green local gate
does not establish a Cloudflare upload, migration, custom-domain state, secret
values, recovery readiness, or human acceptance. A green operator check adds
public runtime evidence only for the exact revision and boundaries it reads.

Official references:

- [Cloudflare: Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare: D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare: Custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare: Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare: Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)
