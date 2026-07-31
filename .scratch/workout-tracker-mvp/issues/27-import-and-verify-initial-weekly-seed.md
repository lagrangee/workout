# 27 — Import and verify initial weekly seed

**What to build:** Import the accepted initial weekly seed through the normal Plan JSON flow and prove that the resulting Athlete plan and schedule match the seed exactly.

**Blocked by:** none

**Status:** resolved

**Label:** ready-for-agent

**Seed:** [`seed/workout-tracker-weekly-seed.json`](../../../seed/workout-tracker-weekly-seed.json)

**Scope boundary:** This ticket owns seed application and read-back evidence only. It does not change the seed, add a second plan, create a direct D1 import path, or redesign Plan Update Package validation. The seed must be applied through validate → preview → apply for one explicitly selected authenticated Athlete.

- [x] The seed JSON parses as Plan Update Package v1 with exactly seven weekday slots and no unknown fields; `effective_from` is `2026-08-01`, strictly future on the 2026-07-31 production run.
- [x] Validation succeeded, the preview showed all seven slots, and the authenticated UI apply created exactly one new Plan Revision through the normal validate → preview → apply flow; no direct production D1 write was used.
- [x] The production read-back Weekly Template is semantically identical to the seed: five workouts, one no-plan slot, and one Rest Day.
- [x] Production D1 read-back calculated Completion Items as Monday 9, Tuesday 10, Wednesday 9, Thursday 0, Friday 6, Saturday 6, and Sunday 0; the seed fixture verifier also confirmed left-then-right ordering.
- [x] The revision effective date and weekly slot projection were read back from production D1; the local contract and seed verification cover the prohibited metadata boundary.
- [x] A second identical production validation was rejected with `/week: This package does not change the effective template` while the production revision count remained one; malformed-attempt preservation is covered by the fixture verifier and HTTP tests.
- [x] Production D1 read-back showed one Athlete with one revision and the other with zero revisions; neither had Sessions written by the seed flow.

## Execution boundary

The production execution completed on 2026-07-31 against the authenticated application session at `workout.lagrangee.xyz`. Evidence is recorded in [`docs/release/seed-verification.md`](../../../docs/release/seed-verification.md) without exposing identity or secrets.
