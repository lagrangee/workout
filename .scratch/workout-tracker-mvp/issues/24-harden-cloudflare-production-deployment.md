# 24 — Harden Cloudflare production deployment

**What to build:** The complete app can be prepared for production at `workout.lagrangee.xyz` with identity, routing, storage, observability, and bypass controls matching the deployment contract.

**Blocked by:** 16 — Build Worker, D1, and Athlete application shell; 21 — Build Progress and Exercise metrics; 22 — Build Coach Share and Agent-first API; 23 — Build Athlete Export and recovery artifact.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] Cloudflare Zero Trust Free is onboarded with two exact Athlete email identities, OTP, available seats, Access audience, and account-wide default-deny behavior verified.
- [ ] Access protects exact and wildcard `/app` and `/api/private` paths while Coach routes remain public; the Worker independently validates Access JWT signature, issuer, time claims, and audience.
- [ ] The custom domain is the sole production host, `workers.dev` and Preview URLs are disabled, and no bypass hostname reaches private app data.
- [ ] Private and Coach responses send the required no-store/security headers; cache configuration, invocation logs, traces, and errors cannot expose bearer URLs or identity claims.
- [ ] D1 indexes, Worker/D1 quotas, migration state, and the documented export capacity bound are verified with a non-secret deployment checklist.
- [ ] A D1 Free Time Travel recovery rehearsal and manual Athlete Export verification complete without using live Athlete data.
