# 01 — Add Agent Token lifecycle and Agent API authentication

**What to build:** An authenticated Athlete can create, inspect the status of, rotate, and revoke one personal Agent Token. The new Agent API recognizes that Token through the Authorization header, derives exactly one Athlete from it, and keeps the existing Coach Share read-only boundary intact.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] An authenticated Athlete can create or rotate one Agent Token and receive its complete value only in the creation or rotation response.
- [x] Agent access status can be read without returning the plaintext Token; rotation immediately invalidates the previous Token and revocation prevents further access.
- [x] Agent API requests authenticate through `Authorization: Bearer`, derive the Athlete from the Token, and accept no Athlete selector.
- [x] The persisted state and migration retain only a secret-backed lookup digest plus the lifecycle metadata needed for rotation, status, and revocation; plaintext Tokens are never stored.
- [x] The Agent Token capability reaches only the Agent API boundary and cannot use Coach Share or excluded private operations.
- [x] Invalid, missing, rotated, and revoked Tokens produce stable authentication errors without crossing Athlete state.
- [x] Tests cover both configured Athletes, token lifecycle transitions, missing/tampered credentials, cross-Athlete isolation, and the unchanged read-only Coach Share boundary.

## Completion

Implemented through the existing Worker HTTP boundary with a MemoryStore/D1 lookup seam. The post-implementation review findings were fixed by requiring `AGENT_TOKEN_SECRET` in production, adding the versioned Agent API/wire contract and release checklist entries, stabilizing unauthenticated error ordering, and removing duplicated lookup logic. Verified with `node --test tests/agent-auth.test.js`, the authentication/core regression tests, and `npm run typecheck`.
