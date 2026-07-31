# Initial weekly seed verification

`seed/workout-tracker-weekly-seed.json` was verified on 2026-07-31 against a fixture-only Athlete through the normal private HTTP flow:

1. `POST /api/private/plan-updates/validate` returned a complete preview for `2026-08-01`.
2. `POST /api/private/plan-updates/apply` created exactly one revision; no D1/direct state write was used.
3. Read-back matched the seed semantically. Expanded Completion Items were Monday 9, Tuesday 10, Wednesday 9, Thursday 0, Friday 6, Saturday 6, Sunday 0, with unilateral items ordered left then right.
4. Schedule read-back from the effective date repeated the seven slots as `workout, rest, workout, workout, workout, no_plan, workout`; prohibited training metadata was absent.
5. A malformed attempt and a second identical apply were rejected without changing revision count; the other fixture Athlete remained without a plan.

This is local fixture evidence only. The seed is not applied to a production Athlete until ticket 24/26 owner-controlled deployment evidence is available and the selected Athlete/effective date are re-confirmed.
