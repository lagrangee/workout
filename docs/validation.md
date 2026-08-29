# Validation

Use a supported Node.js release (22.22.2+, 24.15+, or 26+) and the locked
dependency graph:

```bash
npm ci
npm run test:browser:install
npm run release-check
```

`release-check` runs Worker and Vue type checks, a production Vite build,
behavior and integration tests, contract and interface tests, Vue component
tests, a real Chromium smoke, focused coverage, generated-asset and license
checks, the public-tree privacy scan, and documentation lint. Browser
installation is an explicit online platform prerequisite. Once the locked
Chromium shell is present, the gate uses only the checkout and loopback network;
it needs no Cloudflare, D1, production credential, or production receipt.
Documentation checks prove only clean links and formatting; they do not
substitute for runtime, persistence, security, contract, or UI evidence.

Linux CI runners also install Chromium's system packages:

```bash
npm run test:browser:install -- --with-deps
```

Registry-backed dependency review requires network access:

```bash
npm run public:gate:online
```

The deployment workflow runs both advisory policies after `release-check` and
before any production input or credential is exposed. Runtime dependencies fail
at high severity or above; the complete dependency graph fails at critical
severity.

## Frontend test layers

The three frontend commands intentionally prove different surfaces:

- `npm run test:interfaces` runs Node tests against framework-independent
  formatter, timeline, Records, and Session seams. It does not launch a browser.
- `npm run test:ui` mounts Vue components in happy-dom for deterministic state,
  request-race, lifecycle, and rendering coverage. It is not Chromium evidence.
- `npm run test:browser` launches the built application and the synthetic Worker
  preview, then drives the locked Chromium Headless Shell through the official
  Playwright CLI. Run `npm run build` first when invoking this command alone.

The Chromium smoke uses only public UI and HTTP boundaries. It checks the shell
mount, the login cookie and unauthenticated `401` boundary, a Calendar-to-Records
transition backed by synthetic aerobic data, Today navigation's pause protocol,
and the `pagehide`/`pageshow` client lifecycle boundary. It does not inspect Vue
internals, local storage, a production account, or a remote database. The named
browser session and preview subprocess are closed on both success and failure.

## Credential-free deployment source checks

`npm test` expands `tests/*.test.js`, so it necessarily executes
`tests/production-deploy.test.js`. The test uses controlled YAML and TOML subset
parsers instead of comment-sensitive text matching. It proves the trigger,
main-ref guard, concurrency policy, exact checkout, gate ordering, step-scoped
inputs, forward-only migration history check, final freshness check, fixed
cleanup ordering, strict deploy wrapper, and credential-free acceptance
environment.

The same test derives production TOML in memory from the committed placeholder
and verifies its complete structure. Synthetic UUID, origin, Git revision, and
Coach namespace inputs exercise fail-closed validation and log redaction. It
requires the exact Worker-first routes, the eight required secret names,
`DEFAULT_TIMEZONE=Asia/Shanghai`, the D1 binding, release revision, private
origin-derived route, and `COACH_RATE_LIMITER` at 120 requests per 60 seconds.
It also locks `public/_headers` as the source copied by Vite for static SPA
fallback security headers, without overriding hashed-asset cache control.

The preflight and deploy wrappers are tested with injected functions only. Fake
Wrangler output, D1 inventory, migration ledger, Cloudflare custom-domain
response, command failures, and sensitive sentinel values never contact
GitHub, Cloudflare, or a production database. Tests require captured output,
fixed argv, `execFile` without a shell, generic receipts, and errors that do not
echo IDs, origins, namespaces, tokens, response bodies, or revisions.

Run the focused source checks with:

```bash
node --test tests/operator-acceptance.test.js tests/production-deploy.test.js
node scripts/release-acceptance.mjs
```

These checks require no production credential and do not create the ignored
production config. Do not use a real D1 identifier, origin, namespace, token,
or deployment receipt to test repository source.

The synthetic weekly Plan fixture can be validated independently with
`npm run seed:verify`. It exercises the normal validate, preview, apply, and
readback boundary without connecting to D1 or production. Visible UI changes
also need focused manual browser checks at affected mobile and desktop sizes;
the automated smoke is a deterministic protocol gate, not visual acceptance.
Use synthetic data in screenshots and recordings.

## Production workflow evidence

On `main`, the production workflow performs the credential-free gate and both
online advisory policies before it generates the ignored `0600` Wrangler
config. Before any private input, it compares the push base (or a manual
dispatch's first parent) with the exact checkout and rejects changes, deletes,
type changes, or renames of an existing D1 migration; only new,
consecutively numbered files are allowed. Cloudflare credentials exist only in
the separate preflight and deploy steps; the preflight commands are read-only.
The preflight captures rather than forwards provider output and verifies:

- the eight required Worker secret names, never their values;
- the generated D1 UUID equals the one named `workout-tracker` in the account;
- the release-specific schema signature;
- exact, ordered, consecutive local and remote migration ledger filenames;
- an empty `PRAGMA foreign_key_check`; and
- exactly one `workout-tracker` custom domain whose hostname equals the private
  origin.

The preflight does not call `d1 migrations list` because Wrangler 4.127.1 may
create the ledger table as part of that command. It performs no migration or
other D1 mutation. Migration apply remains a separate reviewed operator
transaction.

Immediately before the upload, the deploy step rechecks that the workflow SHA
is still the public remote `main` tip. The Node deploy wrapper invokes Wrangler
with `--strict` and the exact `GitHub <SHA>` version message while suppressing
raw provider output. An `if: always()` cleanup step removes only
`.wrangler/workout.production.toml`; successful acceptance cannot start until
that cleanup succeeds.

Credential-free operator acceptance then reads back the exact public health
revision, root security boundary, one unique Vite hashed JavaScript module, the
schema catalog, and the unauthenticated private-API error envelope. Its fixed
receipt omits the private origin.

## Evidence boundary

A successful source gate proves that the checkout is internally consistent. It
does not prove a deployment, Cloudflare custom-domain inventory, remote D1
state, secret-name presence, secret values, recovery rehearsal, GitHub release,
or human approval.

A successful production workflow adds evidence for the required secret-name
inventory, named D1 identity, schema signature, migration filename ledger,
foreign-key integrity, custom-domain identity, strict upload, generated-config
cleanup, and exact public revision readback. The migration ledger stores
filenames rather than historical SQL digests, so this does not prove that the
currently committed bytes of an already-applied file equal the bytes that ran.
It also does not prove secret values, authenticated cross-Athlete isolation,
D1 recovery, tag/release state, or human acceptance.
