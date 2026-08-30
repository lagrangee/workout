# Store Date-Canonical Planned Days

Status: accepted.

Workout schedule truth is one Athlete-local `Planned Day` per calendar date. A Planned Day is explicitly `workout`, `rest`, or `no_plan`; a workout points to an immutable Plan Revision weekday prescription. Reads resolve that dated row and never infer a date by indefinitely repeating a Weekly Template.

A Plan Update Package remains a convenient complete-week write command. Applying it appends one immutable Plan Revision for prescription/provenance and materializes exactly seven Planned Days beginning at `effective_from`. Later writes win only on overlapping dates. This is a write adapter, not the storage model.

Every dated mutation appends an immutable Plan Change. A `day_move` atomically swaps an unstarted workout with a Rest/no-plan target, preserves the complete prescription reference, increments both affected Planned Day versions, and increments `training_version` once. A date that already owns a Workout Session cannot be moved or replaced.

Session snapshots remain immutable execution truth. Moving a Planned Day never rewrites a Session or a Plan Revision. Calendar, Today, Coach, Agent, progress, and Athlete Export are projections of Planned Days plus Sessions.

Migration 0013 backfills each historical Plan Revision into exactly seven dates; later revision sequence wins overlaps. It deliberately does not invent an infinite future.
