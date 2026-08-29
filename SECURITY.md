# Security policy

## Supported version

Workout Tracker is pre-1.0. Security fixes target the latest commit on the
default branch; older commits and private forks are not supported.

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request containing an exploit,
credential, bearer URL, Athlete data, or production identifier.

Use GitHub's **Security → Report a vulnerability** form for this repository.
If private vulnerability reporting is unavailable, contact a maintainer through
their GitHub profile with only a request for a private channel—do not include
the vulnerability details in that first message.

Include the affected revision, impact, minimal reproduction, and whether any
real data or credential may have been exposed. Use synthetic data wherever
possible. Maintainers will acknowledge a usable report within seven days and
will coordinate disclosure after a fix is available. This is a best-effort
volunteer project; no bug bounty or guaranteed response time is offered.

## Operator responsibilities

Self-hosters own Cloudflare account security, secrets, hostname isolation,
backups, incident response, and timely upgrades. Never commit `.dev.vars`,
`wrangler.production.toml`, exports, FIT files, bearer URLs, or live receipts.
Production login should retain the documented bounded-attempt policy, and
security-event sinks must not add raw email, IP, password, token, or payload
fields to the repository's privacy-safe event shape.
