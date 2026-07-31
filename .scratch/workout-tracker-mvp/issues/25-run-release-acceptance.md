# 25 — Run final release acceptance

**What to build:** The local and production-candidate app demonstrates the complete accepted Workout Tracker behavior through the highest-level HTTP and browser seams, with every release criterion evidenced or explicitly blocked.

**Blocked by:** 24 — Harden Cloudflare production deployment; 26 — Publish private GitHub repository and configure Cloudflare auto-deploy.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] The Worker HTTP integration suite passes private identity isolation, Plan, Session, metrics, Coach, Export, errors, idempotency, and schema contract scenarios for both Athletes.
- [ ] Browser smoke at the accepted 375px viewport passes Today execution, focused navigation, partial continuation, correction, end-screen RPE/note/unfinished-list behavior, and Plan JSON update preview/confirm/error paths.
- [ ] Boundary fixtures pass for timezone midnight, future revision precedence, no plan, Rest Day, no-plan, empty metric denominator, skipped, partial, completed, split intervals, and terminal correction.
- [ ] Coach discovery and pagination expose all history without a 90-day cap; token revocation/regeneration, cache headers, and safe-log checks pass.
- [ ] Athlete Export relationship/privacy/consistency tests and the D1 Time Travel rehearsal pass within the Free-plan capacity contract.
- [ ] The complete 30-item acceptance contract passes, and a forbidden-feature scan finds no offline queue, ad-hoc Session, manual plan editor, telemetry, symptoms, goals, routes, AI, CSV, or restore/import workflow.
- [ ] The 31-item acceptance contract passes, including private-repository visibility, pull-request checks, and default-branch Cloudflare auto-deploy evidence.
