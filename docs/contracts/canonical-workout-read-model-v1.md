# Canonical Workout Read Model v1

The canonical read model is assembled from independent D1 Plan and Session
rows. Consumers never interpret `plan_exercises`, `completion_items`, or
`set_results` columns directly. The assembler emits domain objects with the
same semantics used by the Worker page, Agent/Coach API, Workout Skill, and
Obsidian adapters.

## Plan

Plan rows assemble into an Athlete-owned `plan_id`, immutable Plan Revisions,
weekday slots, Exercise Prescriptions, and ordered Prescribed Sets. The stored
`name_snapshot` remains part of a revision, while a Current Plan projection
resolves the registry's current formal `name` from stable `exercise_id`.
Historical Session snapshots never use that current-name lookup.

## Session

A Session assembles into its frozen Training Plan Snapshot, Completion Items,
current Set Results, interval list, Session note/RPE/skip reason, and
occurrence-scoped Exercise Feedback. Every Completion Item carries its
`exercise_id` through its snapshotted occurrence, exact target, resistance
mode/load, tempo, rest, and `side` (`none`, `both`, `left`, or `right`). Set
Results carry `status`, actual metric/value or explicit null, canonical kg
load, RIR, note, and completion timing.

The Session snapshot uses the historical `name` and `definition_version`
stored at creation. An alternating occurrence is displayed as one counter by
the page but remains two side-specific Completion Items in the assembled
object.

## Exercise history

History is keyed only by global `exercise_id`. Snapshot names and definition
versions are retained as display history; a registry rename therefore does not
split the series. Observations retain set identity/order, target, side, result
status, actual value, canonical resistance, RIR, note, and safe Session
provenance. Athlete filtering occurs before assembly and no row from another
Athlete is addressable through the read boundary.

The model contains no Markdown links, date-to-date relationships, raw D1
columns, COROS payloads, GPS/FIT data, or credentials.
