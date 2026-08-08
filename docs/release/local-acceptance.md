# Local release acceptance receipt

Date: 2026-07-31

## Passed locally

- `npm run typecheck`
- `npm test` — HTTP/static integration tests passed for signed application login/logout, identity isolation, settings, plan/schedule, strict JSON update, Session lifecycle/correction, metrics, Coach Share, Export, Agent Token/API/MCP access, boundary coverage, app shell, and the D1 migration guards.
- `node --check src/worker.js`
- `node --check public/app.js`
- `npm run forbidden-scan`
- `npm run seed:verify` — seed validation/preview/apply/read-back fixture passed with 9/10/9/0/6/6/0 Completion Item counts.
- `npm run release-check`
- 375×812 in-app browser observation: Today state rendered, mobile navigation opened the read-only Plan view, and the Plan view exposed no manual editor.
- Additional 375×812 smoke: Today → `继续查看` opened the one-item focus view; `结束并保存` exposed unfinished items, RPE, note, and Exercise Feedback; saving an incomplete Session rendered the partial state with `继续训练` and `校正记录` actions.
- Fresh 375×812 smoke observed the Plan JSON `{}` error state inside the bottom sheet with path-addressed, copyable repair details; the same run covered terminal correction and showed the corrected Session as `completed 100%` in Today.

## Evidence boundary

The test suite uses a local MemoryStore fixture with the same HTTP handler as the D1 adapter. `migrations/0001_initial.sql` through `migrations/0005_agent_token_lookup.sql`, the Agent API contract, `wrangler.toml`, the Cloudflare checklist, and the D1/Export rehearsal are present locally.

## Production-candidate evidence

- Direct Wrangler deploy succeeded on 2026-07-31 with Worker version `b4ed0fea-f55f-4f4e-8d95-1f48a6bc1fc2`; the custom domain is `workout.lagrangee.xyz` with Preview URLs disabled.
- `GET /healthz` returned `200` and `{"ok":true,"service":"workout-tracker"}`. Public Coach schema returned `200` with `Cache-Control: no-store`, `CDN-Cache-Control: no-store`, CSP, no-referrer, and noindex headers.
- `GET /api/private/me` without an application session returned `401` with the stable unauthorized envelope and the same private security headers; `POST /api/auth/login` returns `503 service_not_configured` until the five production Worker Secrets are written, and `/app` redirects unauthenticated production requests to `/`.
- Production D1 migrations through `0004_restore_session_date_guard.sql` applied successfully. The next production candidate must apply `0005_agent_token_lookup.sql`; a remote schema read confirmed `session_date_guard` exists; production seed import and read-back are recorded in [`seed-verification.md`](./seed-verification.md).
- The repository is private at `lagrangee/workout`; `main` contains the intended source and production deployment is recorded through direct Wrangler evidence, not GitHub Actions auto deploy.

## Follow-up notes

- Ticket 24 is resolved with five Cloudflare Worker Secret names present, signed-session protection, custom-domain checks, D1 state checks, and a synthetic D1 Time Travel/Export recovery receipt. No Zero Trust onboarding or payment method is required.
- Ticket 26 is resolved with manual Wrangler deployment. The old GitHub Actions auto-deploy run [30621663411](https://github.com/lagrangee/workout/actions/runs/30621663411) failed before any steps because of the account billing/spending gate; it is no longer a release blocker.
- Branch-protection verification returned `403`: GitHub reports that this private repository's current plan requires GitHub Pro or a public repository for branch protection. PR CI is configured, but merge-blocking is not verified.
- Ticket 27 is resolved; the production seed was applied through the authenticated Plan flow and read back with the second Athlete isolated.
- Full browser execution/continuation smoke needs the production-candidate runtime or a browser-connected local API fixture; the local HTTP seam covers those behaviors, while the browser observation is limited to the available local page/navigation surface.
