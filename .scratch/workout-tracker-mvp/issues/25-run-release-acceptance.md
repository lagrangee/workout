# 25 — Run final release acceptance

**What to build:** The local and production-candidate app demonstrates the complete accepted Workout Tracker behavior through the highest-level HTTP and browser seams, with every release criterion evidenced or explicitly blocked.

**Blocked by:** none

**Status:** resolved

**Label:** ready-for-agent

**Scope boundary:** This is the final evidence gate. It consumes the Cloudflare readiness from ticket 24 and the repository/Actions evidence from ticket 26; it should not introduce new infrastructure or workflow design.

- [x] The Worker HTTP integration suite passes private identity isolation, Plan, Session, metrics, Coach, Export, errors, idempotency, and schema contract scenarios for both Athletes.
- [x] Browser smoke at the accepted 375px viewport passes the recorded Today/Plan execution seams and Plan JSON update preview/confirm/error paths.
- [x] Boundary fixtures pass for timezone midnight, future revision precedence, no plan, Rest Day, no-plan, empty metric denominator, skipped, partial, completed, split intervals, and terminal correction.
- [x] Coach discovery and pagination expose all history without a 90-day cap; token revocation/regeneration, cache headers, and safe-log checks pass.
- [x] Athlete Export relationship/privacy/consistency tests pass; ticket 24's synthetic D1 Time Travel and Export recovery receipt is attached and the Free-plan capacity bound remains enforced.
- [x] The complete acceptance contract passes, including private-repository visibility, manual Wrangler deployment evidence, production seed read-back, and the forbidden-feature scan.

## Evidence

- Local `npm run release-check` passed after the manual-deploy change.
- Production Worker version `b4ed0fea-f55f-4f4e-8d95-1f48a6bc1fc2` responded `200` on `/healthz`; `/app` unauthenticated redirected to `/`, and `/api/private/me` returned `401` with security headers.
- Production seed read-back and synthetic recovery evidence are recorded in [`docs/release/seed-verification.md`](../../../docs/release/seed-verification.md) and [`docs/release/production-acceptance.md`](../../../docs/release/production-acceptance.md).
