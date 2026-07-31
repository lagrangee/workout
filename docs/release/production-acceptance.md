# Production candidate acceptance receipt

Date: 2026-07-31

## Verified

- Repository: private `lagrangee/workout`, default branch `main`.
- Source push: `main` contains commit `e206b23`.
- D1: `0002_state_revision.sql` applied remotely to `workout-tracker`.
- Worker: direct Wrangler deploy succeeded; version `5ea4ebdc-7cd9-45c1-9f76-fddb888a63e1`.
- Route: `workout.lagrangee.xyz` custom domain active; Preview URLs disabled.
- Public `GET /healthz`: `200`, body `{"ok":true,"service":"workout-tracker"}`.
- Public schema route: `200`, no-store/security headers present.
- Private API without Access assertion: `401`, stable unauthorized error and no-store/security headers.

## Not passed

- Cloudflare Zero Trust is not onboarded in the current account evidence; the two exact Athlete emails, OTP allowlist, Access issuer/audience, default-deny policy, and protected exact/wildcard paths remain unverified.
- `wrangler.toml` still carries placeholder `ACCESS_ISSUER`, `ACCESS_AUDIENCE`, and `.invalid` Athlete emails. No production Athlete or seed data was written.
- GitHub Actions run [30615333331](https://github.com/lagrangee/workout/actions/runs/30615333331) failed before a runner started because GitHub reported failed recent payments or a spending-limit condition. This is an account billing blocker, not a release-check failure.
- D1 Time Travel rehearsal, manual production-candidate Athlete Export verification, and ticket 27 production seed execution remain pending the identity and billing gates.
