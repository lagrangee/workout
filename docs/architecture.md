# Architecture and authority boundaries

Workout Tracker is one domain context with three deliberately different data
boundaries. Repository location does not change semantic ownership.

## Authoritative Workout state

Cloudflare D1 owns Athlete identity mappings, current Plan revisions, immutable
Workout Session snapshots, confirmed results, and access-capability records.
Mutations go through authenticated application or Agent interfaces and update
their canonical records atomically. Public schemas and contracts describe the
portable boundary; D1 row shapes remain an implementation detail.

## Derived read models

Calendar, progress, Coach, Agent, and Athlete Export views are projections of
canonical Workout records. They may cache or paginate but do not become a
second write authority. A failed or stale mutation must not advance a derived
projection independently of its owning canonical state.

## Local Training Archive evidence

The Training Archive joins explicit Workout reads with configured provider
activity evidence into local Markdown and sanitized JSON. Private FIT sidecars
may be used only through ignored, opt-in local paths. The archive is
read-optimized and recoverable from its sources; it is neither a D1 backup nor
an import path. Cloud projections use an explicit allowlist and exclude route
coordinates and raw telemetry.

## Public source versus operator state

Source code, migrations, contracts, synthetic fixtures, and source checks are
portable repository material. Hostnames, D1 IDs, secret values, real Athlete
data, deployment receipts, rollback exports, and account observations belong
to the self-hosting operator. The public source gate never reads them.

An operator copies the production configuration example to an ignored file,
performs the live checks separately, and stores the resulting receipt outside
the repository. A green source gate does not claim a deploy, recovery rehearsal,
or production acceptance.
