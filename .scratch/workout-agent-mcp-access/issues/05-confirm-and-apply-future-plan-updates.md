# 05 — Confirm and apply future Plan Updates

**What to build:** After a separate explicit Athlete confirmation, a Coach Agent can apply the validated future Plan Update Package exactly once, reject stale proposals, and verify the resulting Current Plan and Schedule through readback.

**Blocked by:** 04 — Preview future Plan Update Packages.

**Status:** ready-for-agent

- [ ] `workout_apply_plan_update` accepts only the validated package identity, matching base-plan evidence, an idempotency key, and explicit confirmation.
- [ ] The server revalidates the package and Current Plan base in one atomic mutation boundary before appending exactly one immutable Plan Revision.
- [ ] A changed Current Plan, changed package, missing confirmation, invalid package, or conflicting idempotency key produces a stable error and writes nothing.
- [ ] Repeating the same idempotent request returns the original successful result without creating another Plan Revision; reusing the key with a different body is rejected.
- [ ] The apply response identifies the applied effective date and enough evidence for the Agent to perform readback; the MCP flow reads the Current Plan and affected Schedule after success.
- [ ] The existing Coach Share remains read-only and Session, Athlete Settings, and Coach Share mutations remain outside the Agent API.
- [ ] Tests cover confirmation gating, stale-plan conflicts, concurrent state changes, atomic failure, idempotent replay and conflict, revision precedence, and post-apply readback.

