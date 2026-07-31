# 27 — Import and verify initial weekly seed

**What to build:** Import the accepted initial weekly seed through the normal Plan JSON flow and prove that the resulting Athlete plan and schedule match the seed exactly.

**Blocked by:** 24 — Harden Cloudflare production deployment; 26 — Publish private GitHub repository and configure Cloudflare auto-deploy.

**Status:** ready-for-agent

**Label:** ready-for-agent

**Seed:** [`seed/workout-tracker-weekly-seed.json`](../../../seed/workout-tracker-weekly-seed.json)

**Scope boundary:** This ticket owns seed application and read-back evidence only. It does not change the seed, add a second plan, create a direct D1 import path, or redesign Plan Update Package validation. The seed must be applied through validate → preview → apply for one explicitly selected authenticated Athlete.

- [ ] The seed JSON parses as Plan Update Package v1 with exactly seven weekday slots and no unknown fields; its `effective_from` is still strictly future for the selected Athlete, otherwise execution stops and requests a regenerated seed rather than silently editing this artifact.
- [ ] Validation succeeds, preview shows the complete seven-slot week, and apply creates exactly one new Plan Revision atomically with no direct D1 write.
- [ ] The read-back Weekly Template is semantically identical to the seed: Monday, Tuesday, Wednesday, Friday, and Saturday are workouts; Thursday is no-plan; Sunday is Rest Day.
- [ ] The expanded Completion Item counts are 9 Monday, 10 Tuesday, 9 Wednesday, 0 Thursday, 6 Friday, 6 Saturday, and 0 Sunday; left/right items preserve left-then-right order.
- [ ] The dated schedule selects the new revision from `effective_from`, preserves the weekly repeat, and exposes no running, route, telemetry, symptom, condition, or prose-instruction fields.
- [ ] A second apply of the same package is rejected as a no-op, and a failed/invalid attempt leaves the Athlete's revision count and plan unchanged.
- [ ] The selected Athlete's plan read-back is isolated from the other Athlete, and the evidence is attached for ticket 25 final acceptance.

## Execution boundary

This ticket is deliberately not executed during seed generation or ticket refinement. The implementation thread must wait until the blocked tickets are complete and must record the selected environment, Athlete scope, validation response, preview response, apply response, and read-back evidence without exposing identity or secrets.
