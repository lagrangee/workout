# Production candidate acceptance receipt

Date: 2026-07-31

## Verified

- Repository: private `lagrangee/workout`, default branch `main`.
- Source push: `main` contains the deployed runtime/schema source at commit `b74705e`; this is the source commit bound to the Worker version below.
- D1: migrations through `0004_restore_session_date_guard.sql` applied remotely to `workout-tracker`; the previously missing `session_date_guard` table now exists.
- Worker: direct Wrangler deploy succeeded; version `c7dac9d2-94cc-4477-a2b5-19fcde247402`.
- Route: `workout.lagrangee.xyz` custom domain active; Preview URLs disabled.
- Public `GET /healthz`: `200`, body `{"ok":true,"service":"workout-tracker"}`.
- Public schema route: `200`, no-store/security headers present.
- Private API without application session: `401`, stable unauthorized error and no-store/security headers. `/app` redirects unauthenticated production requests to `/`; login remains unavailable until the five production Worker Secrets are configured.

## Not passed

- The production Worker still needs the two Athlete email Secrets, two password Secrets, and `AUTH_SESSION_SECRET`; no production Athlete or seed data was written.
- The former GitHub Actions auto-deploy run [30621663411](https://github.com/lagrangee/workout/actions/runs/30621663411) failed before any steps because of the account billing/spending gate; production deployment is now manual Wrangler and this run is not a release gate.
- GitHub branch-protection verification returned `403`: this private repository's current plan requires GitHub Pro or a public repository for the branch-protection feature. PR CI is configured in `.github/workflows/ci.yml`, but merge blocking cannot be claimed from the current plan.
- D1 Time Travel rehearsal, manual production-candidate Athlete Export verification, and ticket 27 production seed execution remain pending the identity Secret setup and seed read-back.
