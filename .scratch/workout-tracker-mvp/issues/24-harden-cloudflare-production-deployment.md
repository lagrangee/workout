# 24 — Harden Cloudflare production deployment

**What to build:** The complete app can be prepared for production at `workout.lagrangee.xyz` with identity, routing, storage, observability, and bypass controls matching the deployment contract.

**Blocked by:** 16 — Build Worker, D1, and Athlete application shell; 21 — Build Progress and Exercise metrics; 22 — Build Coach Share and Agent-first API; 23 — Build Athlete Export and recovery artifact.

**Status:** ready-for-agent

**Label:** ready-for-agent

**Scope boundary:** This ticket owns Cloudflare runtime readiness and recovery evidence. It does not create the GitHub repository, define GitHub Actions jobs, or own the source-control delivery gate; those belong to ticket 26.

- [ ] The Worker has two exact Athlete email Secrets, two independent password Secrets, and a random session-signing Secret; the login/logout flow and both identities are verified without Zero Trust or a payment method.
- [ ] The Worker protects `/app` and `/api/private` with an HttpOnly signed session Cookie while Coach routes remain public; it independently validates the session signature, version, time claims, and configured identity.
- [ ] The custom domain is the sole production host, `workers.dev` and Preview URLs are disabled, and no bypass hostname reaches private app data.
- [ ] Private and Coach responses send the required no-store/security headers; cache configuration, invocation logs, traces, and errors cannot expose bearer URLs or identity claims.
- [ ] D1 indexes, Worker/D1 quotas, migration state, and the documented export capacity bound are verified with a non-secret deployment checklist.
- [ ] A D1 Free Time Travel recovery rehearsal and manual Athlete Export verification complete without using live Athlete data.
