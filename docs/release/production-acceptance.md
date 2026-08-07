# Production candidate acceptance receipt

Date: 2026-07-31

## Verified

- Repository: private `lagrangee/workout`, default branch `main`.
- Source push: `main` contains the deployed runtime/schema source at commit `8dc7f56`; this is the source commit bound to the Worker version below.
- D1: migrations through `0004_restore_session_date_guard.sql` applied remotely to `workout-tracker`; the previously missing `session_date_guard` table now exists. The next production candidate must apply `0005_agent_token_lookup.sql` before enabling Agent access.
- Worker: direct Wrangler deploy succeeded; version `b4ed0fea-f55f-4f4e-8d95-1f48a6bc1fc2`.
- Route: `workout.lagrangee.xyz` custom domain active; Preview URLs disabled.
- Public `GET /healthz`: `200`, body `{"ok":true,"service":"workout-tracker"}`.
- Public schema route: `200`, no-store/security headers present.
- Private API without application session: `401`, stable unauthorized error and no-store/security headers. `/app` redirects unauthenticated production requests to `/`. `wrangler secret list` confirmed the five required Secret names exist without reading their values, and the authenticated Plan flow succeeded.
- Seed: ticket 27 production import and read-back passed; see [`seed-verification.md`](./seed-verification.md).
- Recovery: a temporary synthetic D1 ran all four migrations, held two synthetic states, restored to the pre-state bookmark, read back zero Athlete rows with six expected schema tables, and was deleted. No live Athlete data was used.

## Agent Token follow-up

- The local contract and release checks require the production Worker Secret
  `AGENT_TOKEN_SECRET` and migration `0005_agent_token_lookup.sql`.
- No production Agent Token acceptance is claimed by this receipt yet. The
  owner must apply the migration, set the Secret without exposing its value,
  create/rotate/revoke a Token through the authenticated App, and verify
  cross-Athlete isolation plus the Agent API `401`/`503` error boundaries.

## Follow-up notes

- The former GitHub Actions auto-deploy run [30621663411](https://github.com/lagrangee/workout/actions/runs/30621663411) failed before any steps because of the account billing/spending gate; production deployment is now manual Wrangler and this run is not a release gate.
- GitHub branch-protection verification returned `403`: this private repository's current plan requires GitHub Pro or a public repository for the branch-protection feature. PR CI is configured in `.github/workflows/ci.yml`, but merge blocking cannot be claimed from the current plan.
