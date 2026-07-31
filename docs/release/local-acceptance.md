# Local release acceptance receipt

Date: 2026-07-31

## Passed locally

- `npm run typecheck`
- `npm test` — 16 HTTP/static integration tests passed for identity isolation, settings, plan/schedule, strict JSON update, Session lifecycle/correction, metrics, Coach Share, Export, boundary coverage, app shell, and the D1 session-date migration guard.
- `node --check src/worker.js`
- `node --check public/app.js`
- `npm run forbidden-scan`
- `npm run seed:verify` — seed validation/preview/apply/read-back fixture passed with 9/10/9/0/6/6/0 Completion Item counts.
- `npm run release-check`
- 375×812 in-app browser observation: Today state rendered, mobile navigation opened the read-only Plan view, and the Plan view exposed no manual editor.
- Additional 375×812 smoke: Today → `继续查看` opened the one-item focus view; `结束并保存` exposed unfinished items, RPE, note, and Exercise Feedback; saving an incomplete Session rendered the partial state with `继续训练` and `校正记录` actions.
- Fresh 375×812 smoke observed the Plan JSON `{}` error state inside the bottom sheet with path-addressed, copyable repair details; the same run covered terminal correction and showed the corrected Session as `completed 100%` in Today.

## Evidence boundary

The test suite uses a local MemoryStore fixture with the same HTTP handler as the D1 adapter. `migrations/0001_initial.sql` through `migrations/0004_restore_session_date_guard.sql`, `wrangler.toml`, the Cloudflare checklist, and the D1/Export rehearsal are present locally.

## Production-candidate evidence

- Direct Wrangler deploy succeeded on 2026-07-31 with Worker version `a5674e17-9518-4ff1-962c-a79e08e7f627`; the custom domain is `workout.lagrangee.xyz` with Preview URLs disabled.
- `GET /healthz` returned `200` and `{"ok":true,"service":"workout-tracker"}`. Public Coach schema returned `200` with `Cache-Control: no-store`, `CDN-Cache-Control: no-store`, CSP, no-referrer, and noindex headers.
- `GET /api/private/me` without an Access assertion returned `401` with the stable unauthorized envelope and the same private security headers.
- Production D1 migrations through `0004_restore_session_date_guard.sql` applied successfully. A remote schema read confirmed `session_date_guard` exists; all application projection tables remain at zero rows, so no production Athlete, plan, Session, or seed data was written.
- The repository is private at `lagrangee/workout`; `main` was pushed and `CLOUDFLARE_ACCOUNT_ID` plus `CLOUDFLARE_API_TOKEN` are present by name in GitHub Secrets.

## Still blocked

- Ticket 24 still requires Zero Trust onboarding, two exact real Athlete email identities, OTP, Access audience/default-deny, custom-hostname bypass, quota, log/trace, and synthetic D1 Time Travel evidence. `ACCESS_ISSUER` and `ACCESS_AUDIENCE` remain placeholders until those inputs exist.
- Ticket 26's private repository and secrets are verified, but the implementation push's default-branch Actions run [30618359585](https://github.com/lagrangee/workout/actions/runs/30618359585) completed with a failed `Deploy Worker` job before any steps ran and without logs; this remains an account billing/spending blocker. Direct deploy succeeded separately.
- Branch-protection verification returned `403`: GitHub reports that this private repository's current plan requires GitHub Pro or a public repository for branch protection. PR CI is configured, but merge-blocking is not verified.
- Ticket 27's selected Athlete is fixture-only; no production Athlete or seed artifact was mutated. Production seed execution still requires the blocked 24/26 environment evidence.
- Full browser execution/continuation smoke needs the production-candidate runtime or a browser-connected local API fixture; the local HTTP seam covers those behaviors, while the browser observation is limited to the available local page/navigation surface.
