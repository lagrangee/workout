# 20 — Build Session continuation, intervals, and correction

**What to build:** An Athlete can split training across the Scheduled Workout date, finish a Session with contextual feedback, and correct the resulting record without changing its immutable snapshot.

**Blocked by:** 19 — Build first Workout Session and focused execution.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] A same-day partial Session continues in place and a skipped Session restarts in place; both preserve Session identity, snapshot, and existing actuals.
- [ ] Explicit end/continue commands create non-overlapping Training Intervals, exclude gaps from `training_duration_sec`, and preserve the open-interval invariant.
- [ ] The end screen keeps the Session note available, explains each RPE value, lists unfinished Completion Items, and offers optional Exercise Feedback at exercise level.
- [ ] Today summarizes completed work and offers “Continue workout” for both in-progress and same-day partial Sessions.
- [ ] Full replacement correction updates Completion Item actuals, intervals, RPE, notes, feedback, and derived status atomically while rejecting immutable-field edits.
- [ ] Terminal corrections immediately update the visible Session, Today state, and all dependent projections.
