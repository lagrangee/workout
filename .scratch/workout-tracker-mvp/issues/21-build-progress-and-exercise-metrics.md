# 21 — Build Progress and Exercise metrics

**What to build:** An Athlete can inspect trustworthy progress summaries and exercise evidence using the defined Athlete-local ranges, boundaries, and correction semantics.

**Blocked by:** 20 — Build Session continuation, intervals, and correction.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] Progress exposes Completion Rate, Training Streak, training duration, Strength Training Days, average Session RPE, and Exercise Progress with the specified terminal/live inclusion rules.
- [ ] Presets and explicit date ranges use the Athlete timezone, exact inclusive boundaries, Monday-based weekly buckets, zero-denominator nulls, and specified rounding.
- [ ] Evidence exposes the counts and references needed to reconcile due, completed, partial, in-progress, skipped, overdue, not-due, Rest Day, and no-plan states.
- [ ] Exercise detail separates bodyweight, external, and assisted resistance and provides per-set, per-Session, highest-load, assistance, and left/right evidence.
- [ ] Corrections and Session continuation immediately recompute all affected metrics without changing historical Session dates or snapshots.
- [ ] Progress and Exercise views work at mobile width and remain useful with empty history, no plan, and empty metric denominators.
