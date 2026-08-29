# Self-hosting on Cloudflare

Workout Tracker runs as a Cloudflare Worker with Static Assets and one D1
database. A new checkout contains no production identity and does not require
the original maintainer's account.

## 1. Validate the source

Install Node.js 22, then run:

```bash
npm ci
npm run release-check
```

This source gate is local and credential-free. It does not inspect a deployed
Worker or claim production acceptance.

## 2. Create private configuration

Create a D1 database and copy the example to the ignored operator file:

```bash
npx wrangler d1 create workout-tracker
cp wrangler.production.toml.example wrangler.production.toml
```

In `wrangler.production.toml`, replace all example values with your D1
`database_id`, custom hostname, HTTPS `PUBLIC_ORIGIN`, IANA
`DEFAULT_TIMEZONE`, and a unique Worker name if needed. Keep
`ENVIRONMENT="production"`, `workers_dev=false`, and `preview_urls=false` for
the private-data deployment boundary. `AUTH_LOGIN_LIMIT` defaults to `5`,
`AUTH_LOGIN_CLIENT_LIMIT` defaults to `20`, and
`AUTH_LOGIN_WINDOW_SECONDS` defaults to `600`. Accepted values are 1–100
failed attempts per candidate identity, 1–1000 failed attempts per client, and
60–86400 seconds. Successful credentials neither consume nor reset either
failed-login budget.

The example enables Workers observability with full head sampling so the
privacy-safe structured authentication, conflict, and archive-rejection events
are queryable by the operator. Review retention and sampling against your own
account policy before deployment; do not add raw request bodies or credentials
to application logs.

The production file is ignored. Do not commit it.

## 3. Configure secrets

Set each secret interactively; never put a value in a command argument, shell
history, issue, or log:

```bash
npx wrangler secret put ATHLETE_A_EMAIL --config wrangler.production.toml
npx wrangler secret put ATHLETE_B_EMAIL --config wrangler.production.toml
npx wrangler secret put AUTH_A_PASSWORD --config wrangler.production.toml
npx wrangler secret put AUTH_B_PASSWORD --config wrangler.production.toml
npx wrangler secret put AUTH_SESSION_SECRET --config wrangler.production.toml
npx wrangler secret put AGENT_TOKEN_SECRET --config wrangler.production.toml
npx wrangler secret put COACH_LOOKUP_SECRET --config wrangler.production.toml
npx wrangler secret put COACH_ENCRYPTION_SECRET --config wrangler.production.toml
```

Use two distinct normalized emails, two distinct passwords, and independently
generated random values for every signing, lookup, or encryption secret.

Authentication has two per-Worker fixed-window fallback budgets. The identity
budget uses an HMAC of the normalized candidate email and therefore follows one
identity across changing source IPs. The client budget uses an HMAC of
`CF-Connecting-IP` and therefore follows one client across changing candidate
emails. Operators who need shared limits across Worker isolates should bind
Cloudflare rate limiters as `AUTH_LOGIN_RATE_LIMITER` and
`AUTH_LOGIN_CLIENT_RATE_LIMITER`, configured respectively with
`AUTH_LOGIN_LIMIT` and `AUTH_LOGIN_CLIENT_LIMIT` over the same
`AUTH_LOGIN_WINDOW_SECONDS`. Verify both bindings in private operator tests.
Rate-limit keys and structured security events contain hashes/reasons, never
raw email, IP, password, or token values.

## 4. Apply migrations and deploy

Apply migrations before a Worker version that reads new schema:

```bash
npx wrangler d1 migrations apply workout-tracker --remote --config wrangler.production.toml
npx wrangler deploy --config wrangler.production.toml
```

For an existing legacy database, also follow the explicit canonical cutover
runbook. Never use startup-time repair as a substitute for reviewed migration
and recovery evidence.

## 5. Verify production privately

Run the credential-free public-boundary smoke against the deployed origin:

```bash
WORKOUT_PUBLIC_ORIGIN="https://workout.example.com" \
  node scripts/operator-acceptance.mjs
```

Then verify the account-specific boundary without printing values:

1. The production file names the intended Worker, D1 database, custom hostname,
   and matching HTTPS `PUBLIC_ORIGIN`; `workers.dev` and preview URLs remain
   disabled.
2. All eight secret names are present. If distributed login limiting is used,
   verify both identity and client rate-limiter bindings independently.
3. Every migration is applied in order and canonical foreign keys are valid.
4. Both configured Athletes can authenticate and remain isolated; Agent and
   Coach capabilities rotate, revoke, and fail closed as documented.
5. Plan and Schedule readback match the intended deployment, and a recovery
   rehearsal succeeds using synthetic data.

Keep deployment receipts, exports, D1 bookmarks, account identifiers, and
command output outside the repository. A successful source gate does not prove
deployment, custom-domain activation, secret presence, authenticated reads, or
recovery.
