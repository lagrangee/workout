# 22 — Build Coach Share and Agent-first API

**What to build:** An Athlete can create, copy, revoke, and regenerate a permanent Coach Share, while a ChatGPT Agent can discover and read the complete privacy-filtered training surface through exact versioned resources.

**Blocked by:** 18 — Build Agent JSON Plan Update flow; 20 — Build Session continuation, intervals, and correction; 21 — Build Progress and Exercise metrics.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] Coach Share create, authenticated copy, revoke, and regenerate work across devices; create/regenerate responses never persist or expose a plaintext token.
- [ ] Token lookup uses the keyed digest plus recoverable AES-GCM ciphertext, key versions, nonce/AAD rules, revocation checks, and the specified best-effort per-location threshold.
- [ ] README, manifest, overview, plan, schedule, sessions, progress, exercise, schema index, and individual schema resources conform to the Coach Agent Wire Catalog v1.
- [ ] The Agent can discover complete history without a 90-day cap, use safe `source_ref` values, resolve Completion Items, and understand metric evidence and date semantics.
- [ ] Session pagination uses stable keyset cursors, monotonic `training_version`, expiry and restart behavior; concurrent edits never claim snapshot consistency.
- [ ] Public routes are read-only, cache-bypassed, noindex/no-referrer protected, free of token-bearing logs, and return indistinguishable invalid-token `404`s.
