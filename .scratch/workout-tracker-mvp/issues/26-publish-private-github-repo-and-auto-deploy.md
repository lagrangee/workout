# 26 — Publish private GitHub repository and use manual Wrangler deploy

**What to build:** Publish the complete Workout Tracker project to the confirmed private GitHub repository, keep pull-request validation documented, and use an explicit local Wrangler command for production deployment.

**Blocked by:** none

**Status:** resolved

**Label:** ready-for-agent

**Scope boundary:** This ticket owns private GitHub publication and CI/CD wiring. It consumes the Worker, D1, route, and Access configuration made ready by ticket 24; it must not redefine those Cloudflare controls.

- [x] The exact GitHub owner and repository name are confirmed; repository visibility is private and no unrelated source is included.
- [x] The intended source, migrations, deployment configuration, and contributor documentation are pushed without credentials, plaintext tokens, local identity data, or generated private exports.
- [x] Pull-request validation remains documented separately and never owns production deployment.
- [x] Production deployment uses `npm run release-check` followed by `npx wrangler deploy`, then a custom-domain `/healthz` check.
- [x] The former GitHub Actions auto-deploy workflow is removed; GitHub Actions billing or branch-protection availability is not a production release gate.
- [x] GitHub secret names remain documented without secret values.
- [x] Private repository visibility, manual deployment, route reachability, and the secret/forbidden-feature scan are recorded for release acceptance.

## Execution boundary

This ticket is resolved by the implementation thread. Production deployment is an explicit operator action from the checkout, not a push-triggered GitHub job.

The confirmed target is `lagrangee/workout`. The production Wrangler command uses the local Wrangler authentication and never prints a token; GitHub Actions has no production deployment Secret dependency.
