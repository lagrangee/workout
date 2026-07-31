# 17 — Build Current Plan, schedule, and Today read model

**What to build:** An Athlete can see a read-only weekly Plan, today's workout state, and a date-bounded schedule generated from the repeating Weekly Template.

**Blocked by:** 16 — Build Worker, D1, and Athlete application shell.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] A Plan Seed or validated first revision produces a complete seven-slot Weekly Template with workout, Rest Day, and no-plan slots.
- [ ] Plan, Today, and Schedule reads resolve the correct revision in the Athlete timezone, including midweek changes and future effective dates.
- [ ] Rest Days create no Session; no-plan dates produce no Scheduled Workout; unstarted today remains not due until the defined boundary.
- [ ] The read-only Plan UI shows the current week and future pending templates without offering manual editing.
- [ ] Dated projections remain deterministic across refreshes and the local read-model tests cover timezone and revision boundaries.
