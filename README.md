# Workout Tracker

Workout Tracker is a mobile-first, self-hosted web application for following a
weekly training plan, running a prescribed Workout Session, and keeping the
confirmed results connected to calendar and progress views. It also exposes
read-only Coach and Agent APIs and can build a local Training Archive from
explicitly configured sources.

The project is pre-1.0. Contracts and migrations are versioned, but operators
should review every upgrade and keep a recovery export. It is a personal
training record, not a medical service, coaching marketplace, or hosted SaaS.

## Authority boundaries

- D1 owns current Plans, Workout Sessions, application identities, and
  capability records for each isolated Athlete.
- A Training Plan Snapshot is frozen when a Session starts; corrected results
  never rewrite the Plan that prescribed them.
- The local Training Archive is derived evidence. Workout and the configured
  activity provider remain authoritative for their own facts.
- Repository source and tests define reproducible behavior. The deployed source
  revision is public provenance; production hostnames, provider and database
  identities, credentials, raw live receipts, and recovery artifacts remain
  private operator state and are not part of the source gate.

See the [documentation index](docs/README.md), [architecture](docs/architecture.md),
[domain model](docs/domain-model.md), and versioned [contracts](docs/contracts/)
for the complete boundaries.

## Requirements

- Node.js 22.22.2+, 24.15+, or 26+
- npm 10 or newer
- Chromium Headless Shell for the real-browser gate; install the locked version
  with `npm run test:browser:install`
- A Cloudflare account with Workers and D1 only when self-hosting

## Local quickstart

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:8787/app>. Vite serves the Vue application and proxies
API requests to a local synthetic identity backed by an in-memory store; it
does not require Cloudflare or production secrets.
For Wrangler-based local development, copy `.dev.vars.example` to the ignored
`.dev.vars` and run `npm run wrangler:dev`.

To inspect the production build with the same synthetic Worker boundary used by
the browser smoke test:

```bash
npm run build
npm run preview
```

Open <http://127.0.0.1:4173/app>. The preview is a single same-origin process:
it serves `dist/` and the real Worker handler with an in-memory store. Sign in
with `athlete-a@example.invalid` and the synthetic password `local-workout`.
It does not use Cloudflare, D1, or production credentials.

## Validation

```bash
npm run check
npm run test:browser:install
npm run release-check
```

`release-check` includes the production Vue/Vite build and a real Chromium
smoke against the synthetic Worker. Installing the locked browser is an
explicit, network-backed prerequisite; after that, the gate needs no deployment
credentials, production receipt, or external service. On Linux CI, install the
browser and system packages with
`npm run test:browser:install -- --with-deps`. See [Source
validation](docs/validation.md) for the exact evidence boundary; deployment
checks are part of the [self-hosting guide](docs/deployment/self-hosting.md).

## Self-hosting

Start with the [self-hosting guide](docs/deployment/self-hosting.md). The
committed `wrangler.toml` contains only local/generic values. Production
hostname, D1 identity, secrets, and receipts stay in ignored or external
operator storage.

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. General
usage support follows [SUPPORT.md](SUPPORT.md); security reports must use the
private path in [SECURITY.md](SECURITY.md). Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

Workout Tracker is licensed under the [MIT License](LICENSE). Third-party
components and assets are listed in `THIRD_PARTY_NOTICES.md`.
