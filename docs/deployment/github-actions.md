# GitHub Actions public-source boundary

GitHub Actions validates repository source on pull requests and pushes to
`main`. Both events use Node.js 22, install the locked dependency graph with
`npm ci`, and run the same deterministic `npm run public:gate` command.

The gate names its evidence instead of collapsing everything into one test
label: type checks; behavioral, integration, contract, and browser-facing
smoke tests; focused branch coverage for `src/store.js` and
`src/validation.js`; dependency and redistributed-asset license checks; the
public-tree privacy scan; and documentation lint. Documentation lint is
documentation evidence only and never substitutes for runtime behavior.

The committed public-tree scanner uses generic credential, personal-email,
production-binding, archive, FIT, and binary rules. It does not embed raw or
hashed operator-specific identifiers. Exact private-value coverage belongs to
the repository-external pattern input required by the
[history sanitization rehearsal](../release/history-sanitization-rehearsal.md),
so a public fingerprint cannot become an offline identity oracle.

Dependency advisory review is online-only because `npm audit` requires the npm
registry. Runtime dependencies fail CI at high severity or above; the complete
graph, including development dependencies, fails at critical severity. Lower
severity findings remain visible in the preserved logs. The repository has no
silent advisory allowlist: a temporary exception requires a reviewed issue,
an expiry date, and a lockfile-level remediation or override that still leaves
both audit commands green. CI preserves the source gate and audit logs as one
revision-bound artifact for 14 days.

Run `npm run public:gate:online` to execute the offline source baseline and
both registry-backed advisory policies locally.

The workflow does not deploy, read Cloudflare credentials, inspect a live D1
database, or consume a production receipt. No Cloudflare secret is required by
CI. This keeps forks and fresh public checkouts reproducible.

Production deployment is a separate operator transaction using an ignored
`wrangler.production.toml` and the steps in the
[self-hosting guide](self-hosting.md). Branch protection, release approval, and
deployment permissions are configured by each repository owner and cannot be
inferred from a green workflow run. A green check does not establish GitHub
visibility, a tag, a release, production deployment, or human acceptance.
