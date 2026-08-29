# Cloudflare production checklist

This checklist separates portable source guarantees from account-specific
operator evidence. Complete it for each deployment; do not commit the answers.

## Source guarantees

- The Worker binds Static Assets as `ASSETS` and D1 as `DB`.
- Production authentication fails closed when required secrets are absent.
- Athlete selection is derived from a signed session or scoped capability, not
  a caller-provided Athlete ID.
- Private and capability responses are `no-store` and exclude secret values.
- Cookie-authenticated mutations require the exact configured origin and JSON;
  login attempts are bounded and security events exclude raw identity and IP.
- Migrations are ordered and reviewed; canonical Workout state is not repaired
  implicitly during request handling.
- Athlete Export enforces its documented capacity and privacy boundary.

## Operator-only verification

1. Confirm the ignored production config contains the intended Worker, D1 ID,
   exact custom hostname, matching HTTPS `PUBLIC_ORIGIN`, and production mode.
2. Confirm all eight secret names from the self-hosting guide are present
   without reading or logging their values.
   If distributed login limiting is configured, verify both
   `AUTH_LOGIN_RATE_LIMITER` and `AUTH_LOGIN_CLIENT_RATE_LIMITER` against their
   identity and client failed-attempt policies, plus the fallback independently.
3. Confirm `workers.dev`, preview URLs, and unintended hostnames cannot reach
   private data.
4. Apply every pending migration in order. For an existing database, verify
   foreign keys, canonical cutover state, quota headroom, and log redaction.
5. Run the public operator smoke and authenticated tests for both Athlete
   identities, including cross-Athlete denial and token revoke/rotate behavior.
6. Rehearse recovery with synthetic data. Keep D1 bookmarks, exports, rollback
   material, command output, and the final receipt outside the repository.

Source CI does not execute or assert these steps.
