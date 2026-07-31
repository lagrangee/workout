# 24 — Harden Cloudflare production deployment

**What to build:** The complete app can be prepared for production at `workout.lagrangee.xyz` with identity, routing, storage, observability, and bypass controls matching the deployment contract.

**Blocked by:** 16 — Build Worker, D1, and Athlete application shell; 21 — Build Progress and Exercise metrics; 22 — Build Coach Share and Agent-first API; 23 — Build Athlete Export and recovery artifact.

**Status:** resolved

**Label:** ready-for-agent

**Scope boundary:** This ticket owns Cloudflare runtime readiness and recovery evidence. It does not create the GitHub repository, define GitHub Actions jobs, or own the source-control delivery gate; those belong to ticket 26.

- [x] The Worker has two exact Athlete email Secrets, two independent password Secrets, and a random session-signing Secret; the login/logout flow is verified without Zero Trust or a payment method, and the authenticated production session was used for the seed flow.
- [x] The Worker protects `/app` and `/api/private` with an HttpOnly signed session Cookie while Coach routes remain public; it independently validates the session signature, version, time claims, and configured identity. Unauthenticated production checks returned `/app` → `302 /` and `/api/private/me` → `401`.
- [x] The custom domain is the sole production host, `workers.dev` and Preview URLs are disabled, and no bypass hostname reaches private app data.
- [x] Private and Coach responses send the required no-store/security headers; local tests and the production unauthorized probe cover the cache/security boundary.
- [x] D1 indexes, migration state, documented export capacity bound, and the production D1 resource state were verified without reading Secret values; the database is 156 kB with seven tables.
- [x] A D1 Free Time Travel recovery rehearsal and synthetic Athlete Export relationship check completed without using live Athlete data; the temporary database was deleted afterward.

## Evidence

- Worker version `b4ed0fea-f55f-4f4e-8d95-1f48a6bc1fc2` was deployed directly with Wrangler on 2026-07-31; `GET /healthz` returned `200`.
- The temporary recovery database used all four migrations, held two synthetic states, restored to bookmark `00000000-0000001e-000050b9-dca5c80e201011058fc29ef942e5062e`, read back zero Athlete rows with all six expected schema tables, and was deleted.
