# 26 — Publish private GitHub repository and configure Cloudflare auto-deploy

**What to build:** Publish the complete Workout Tracker project to the confirmed private GitHub repository and add GitHub Actions workflows for validation and production deployment to `workout.lagrangee.xyz`.

**Blocked by:** 24 — Harden Cloudflare production deployment.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [x] The exact GitHub owner and repository name are confirmed before creation; repository visibility is private and no unrelated source is included.
- [x] The intended source, migrations, deployment configuration, and contributor documentation are pushed without credentials, plaintext tokens, local identity data, or generated private exports.
- [ ] Pull requests run `npm run release-check` and never run a production deploy; failures are visible and block merging according to repository settings.
- [ ] A push to the default branch runs Wrangler deployment with least-privilege workflow permissions, concurrency protection, and secret-backed `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` values.
- [ ] The deployment workflow uses the production Worker/D1 configuration, does not print secrets, verifies `workout.lagrangee.xyz`, and records the deployed version or URL in the workflow evidence.
- [x] GitHub Actions secrets/environment values are documented by name only; no secret values are committed or exposed in logs, artifacts, or pull-request output.
- [ ] Private repository visibility, workflow success, route reachability, and a secret/forbidden-feature scan are recorded for final release acceptance.
