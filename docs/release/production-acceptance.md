# Production candidate acceptance receipt

Date: 2026-07-31

## Verified

- Repository: private `lagrangee/workout`, default branch `main`.
- Source push: `main` contains the deployed runtime/schema source at commit `13d83f0`; this is the source commit bound to the Worker version below.
- D1: migrations through `0004_restore_session_date_guard.sql` applied remotely to `workout-tracker`; the previously missing `session_date_guard` table now exists.
- Worker: direct Wrangler deploy succeeded; version `a5674e17-9518-4ff1-962c-a79e08e7f627`.
- Route: `workout.lagrangee.xyz` custom domain active; Preview URLs disabled.
- Public `GET /healthz`: `200`, body `{"ok":true,"service":"workout-tracker"}`.
- Public schema route: `200`, no-store/security headers present.
- Private API without Access assertion: `401`, stable unauthorized error and no-store/security headers.

## Not passed

- Cloudflare Zero Trust is not onboarded in the current account evidence; the two exact Athlete emails, OTP allowlist, Access issuer/audience, default-deny policy, and protected exact/wildcard paths remain unverified.
- `wrangler.toml` still carries placeholder `ACCESS_ISSUER`, `ACCESS_AUDIENCE`, and `.invalid` Athlete emails. No production Athlete or seed data was written.
- GitHub Actions run [30618359585](https://github.com/lagrangee/workout/actions/runs/30618359585) completed with a failed `Deploy Worker` job before any steps ran and without logs. This is an account billing/spending blocker, not a release-check failure.
- GitHub branch-protection verification returned `403`: this private repository's current plan requires GitHub Pro or a public repository for the branch-protection feature. PR CI is configured in `.github/workflows/ci.yml`, but merge blocking cannot be claimed from the current plan.
- D1 Time Travel rehearsal, manual production-candidate Athlete Export verification, and ticket 27 production seed execution remain pending the identity and billing gates.
