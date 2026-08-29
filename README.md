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
- Repository source and tests define reproducible behavior. Deployment
  identity, credentials, live receipts, and recovery artifacts are private
  operator state and are not part of the source gate.

See the [documentation index](docs/README.md), [architecture](docs/architecture.md),
[domain model](docs/domain-model.md), and versioned [contracts](docs/contracts/)
for the complete boundaries.

## Requirements

- Node.js 22
- npm 10 or newer
- A Cloudflare account with Workers and D1 only when self-hosting

## Local quickstart

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:8787/app>. The local server uses synthetic identities
and an in-memory store; it does not require Cloudflare or production secrets.
For Wrangler-based local development, copy `.dev.vars.example` to the ignored
`.dev.vars` and run `npm run wrangler:dev`.

## Validation

```bash
npm run check
npm run release-check
```

`release-check` is deliberately source-only: it must pass in a clean checkout
without network access, deployment credentials, or a production receipt. See
[Source validation](docs/validation.md) for its evidence boundary; deployment
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
