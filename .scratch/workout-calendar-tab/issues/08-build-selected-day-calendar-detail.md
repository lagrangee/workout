# 08 — Build selected-day Calendar detail

**What to build:** Let an Athlete select any navigable date in Calendar and inspect the complete dated prescription and, when present, the corresponding Workout Session completion evidence in a read-only detail panel.

**Blocked by:** 07 — Build Calendar week browsing with real dated state.

**Status:** implemented

- [x] Selecting a date opens the accepted B detail panel without leaving Calendar.
- [x] The detail shows the Plan Revision/source, workout title, estimated duration, Blocks, Exercises, Prescribed Sets, targets, structured Resistance, tempo, and rest where present.
- [x] The selected date's prescription is resolved from the Plan Revision effective on that Athlete-local date.
- [x] A date with a Workout Session shows its immutable Training Plan Snapshot, Session Status, completion fraction, completed/unfinished item counts, and actual values beside prescribed values.
- [x] Partial Sessions expose unfinished items; skipped Sessions expose their skip reason when present.
- [x] Rest Day and no-plan dates have distinct neutral empty states; an overdue-unstarted date has no synthetic Session detail.
- [x] The schedule read is summary-first and `expand=prescription` returns the complete prescription for single-day detail, resolving the current contract drift.
- [x] Calendar detail provides no training-execution action and does not preload full Session details for unselected dates.
- [x] Automated coverage verifies revision boundaries, all detail states, prescription expansion, Snapshot immutability, and non-mutating reads.
