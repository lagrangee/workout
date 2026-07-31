# 19 — Build first Workout Session and focused execution

**What to build:** An Athlete can start or skip today's non-rest Scheduled Workout and complete prescribed work through the approved one-item focus flow.

**Blocked by:** 17 — Build Current Plan, schedule, and Today read model.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] Start and skip are allowed only for today's non-rest Scheduled Workout, are safe to retry, and create at most one Session per Athlete/date.
- [ ] Starting captures an immutable Training Plan Snapshot with stable Block, exercise occurrence, Prescribed Set, and Completion Item keys.
- [ ] Explicit `sets[]` expand into the correct Completion Items, including left/right expansion for unilateral prescriptions.
- [ ] The 375px execution UI presents one item at a time, previous/next navigation, a clickable global progress list, prefilled defaults, and a focused Adjust interaction.
- [ ] Completing an item records actual values and visibly distinguishes adjusted actuals from prescribed values without requiring empty input grids.
- [ ] Ending the first Session closes its interval and derives `completed` at 100 percent or `partial` below 100 percent; unfinished items are shown before save.
