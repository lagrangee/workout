# Initial weekly seed verification

`seed/workout-tracker-weekly-seed.json` was verified on 2026-07-31 both against a fixture-only Athlete and, after production login, against one selected production Athlete through the normal Plan UI/API flow.

1. `POST /api/private/plan-updates/validate` returned a complete preview for `2026-08-01`.
2. `POST /api/private/plan-updates/apply` created exactly one revision; no D1/direct state write was used.
3. Read-back matched the seed semantically. Expanded Completion Items were Monday 9, Tuesday 10, Wednesday 9, Thursday 0, Friday 6, Saturday 6, Sunday 0, with unilateral items ordered left then right.
4. Schedule read-back from the effective date repeated the seven slots as `workout, rest, workout, workout, workout, no_plan, workout`; prohibited training metadata was absent.
5. A malformed attempt and a second identical apply were rejected without changing revision count; the other fixture Athlete remained without a plan.

## Production receipt

1. Production Worker version `b4ed0fea-f55f-4f4e-8d95-1f48a6bc1fc2` was reached through manual Wrangler deployment. The authenticated Plan screen showed `已有 1 个未来更新` with `2026-08-01` as the effective date after confirmation.
2. A read-only D1 check showed one Athlete row with `plan_revisions = 1`, one other Athlete row with `plan_revisions = 0`, and both with `sessions = 0`; the D1 query reported zero rows written.
3. Production D1 read-back returned `effective_from = 2026-08-01`, five `workout` slots, one `rest` slot, and one `no_plan` slot. A second read-back calculated Completion Items as Monday 9, Tuesday 10, Wednesday 9, Friday 6, and Saturday 6; Thursday and Sunday are 0 by slot kind.
4. Re-validating the identical package in the authenticated Plan flow was rejected with `/week: This package does not change the effective template`; the production revision count remained one.

The production write used the authenticated application flow only; no direct production D1 write or identity value was included in this receipt.
