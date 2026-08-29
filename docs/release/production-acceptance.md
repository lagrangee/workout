# Private production acceptance

Production acceptance is an operator-only transaction after the public source
gate passes. It is never called by `npm run release-check` or CI.

## Public-boundary smoke

Set the deployed origin in the local process and run:

```bash
WORKOUT_PUBLIC_ORIGIN="https://workout.example.com" \
  node scripts/operator-acceptance.mjs
```

The script verifies the health endpoint, token-free Coach schema catalog, and
unauthenticated private boundary. It prints a sanitized JSON summary and never
reads credentials.

## Authenticated and infrastructure checks

An authorized operator must also verify:

- all required secret names exist without reading their values;
- all migrations are applied and canonical foreign keys are valid;
- both configured Athletes can authenticate and remain isolated;
- Agent and Coach capabilities rotate, revoke, and fail closed as documented;
- Plan/Schedule and seed readback match the intended deployment;
- a synthetic recovery rehearsal succeeds.

Store the revision, Worker version, hostname, migration status, sanitized
results, and rollback reference **outside the repository** in private operator
storage. Never include personal data, tokens, password values, ciphertext, or
raw exports. A successful smoke is evidence for that deployment only and does
not modify the release tag or repository visibility.
