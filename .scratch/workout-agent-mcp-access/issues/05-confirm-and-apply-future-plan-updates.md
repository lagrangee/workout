# 05 — Confirm and apply future Plan Updates

**What to build:** After a separate explicit Athlete confirmation, a Coach Agent can apply the validated future Plan Update Package exactly once, reject stale proposals, and verify the resulting Current Plan and Schedule through readback.

**Blocked by:** 04 — Preview future Plan Update Packages.

**Type:** task

**Status:** resolved

- [x] `workout_apply_plan_update` accepts only the validated package identity, matching base-plan evidence, an idempotency key, and explicit confirmation.
- [x] The server revalidates the package and Current Plan base in one atomic mutation boundary before appending exactly one immutable Plan Revision.
- [x] A changed Current Plan, changed package, missing confirmation, invalid package, or conflicting idempotency key produces a stable error and writes nothing.
- [x] Repeating the same idempotent request within the 24-hour idempotency retention window returns the original successful result without creating another Plan Revision; reusing the key with a different body is rejected.
- [x] The apply response identifies the applied effective date and enough evidence for the Agent to perform readback; the MCP flow reads the Current Plan and affected Schedule after success.
- [x] The existing Coach Share remains read-only and Session, Athlete Settings, and Coach Share mutations remain outside the Agent API.
- [x] Tests cover confirmation gating, stale-plan conflicts, concurrent state changes, atomic failure, idempotent replay and conflict, revision precedence, and post-apply readback.

## Completion

Implemented the confirmed Agent plan-application boundary and typed MCP flow.
The Worker revalidates package text, package/base digests, and confirmation in
the transaction, increments `training_version` once, appends one immutable Plan
Revision, and records a 24-hour idempotency response. Failed validation,
staleness, conflicting keys, and D1 concurrency conflicts leave the plan
unchanged. The MCP adapter sends the explicit confirmation and header key, then
checks the applied Weekly Template (whether it is `current` or `future`) and
the exact inclusive seven-day Schedule readback.

Verification: 21 targeted Agent/MCP/plan-update tests and 55 full tests passed;
`npm run typecheck`, `npm run mcp:check`, and `git diff --check` passed. The
repository `release-check` remains blocked by the pre-existing seed verifier's
fixed past `effective_from`, unrelated to this ticket.

## Answer

Ticket resolved. A Coach Agent can now apply one validated future Plan Update
Package only after explicit confirmation and matching preview evidence. The
operation is atomic, isolated to the bearer Athlete, idempotent for 24 hours,
and safe to replay. The MCP tool returns the application evidence plus verified
Current Plan and Schedule readback; analysis presentation remains owned by the
Agent rather than this integration.

Context pointer: the implementation contract is recorded in
`docs/contracts/agent-api-v1.md` and
`docs/contracts/agent-api-wire-catalog-v1.md`; the shared decision is indexed
in [`map.md`](../map.md#decisions-so-far).

## Review

- Spec review: PASS after follow-up findings were closed. The first review's
  `training_version`, Current-versus-future readback, content verification,
  24-hour idempotency boundary, and application wire-type findings were fixed
  in `f9cfa36` and `9057616`; the final local audit and regression suite cover
  each case.
- Standards review: PASS after follow-up findings were closed. The first
  review's silent Idempotency-Key trimming and duplicated idempotency flow were
  fixed in `9057616`; the claim/resolution lifecycle, checklist, Answer, and
  map pointer are now committed.
