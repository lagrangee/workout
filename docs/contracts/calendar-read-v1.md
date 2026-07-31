# Calendar Read Contract v1

## Purpose

The Calendar is a private, authenticated inspection projection. It does not add a Calendar entity, persistence table, or `/api/private/calendar` truth. Schedule owns dated plan facts; Session reads own execution facts; the UI composes them by `session_key`.

## Week summary

`GET /api/private/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD`

The range is inclusive, interpreted in the authenticated Athlete's IANA timezone, and is limited to 366 days. Calendar navigation requests seven dates. The default response is summary-first: workout entries include `date`, `weekday`, `kind`, `title`, `module_count`, `estimated_duration_min`, `prescription_ref`, `scheduled_workout_key`, nullable `session_key`, `is_due`, `is_overdue_unstarted`, `source_ref`, and `revision_key`; they do not include an inline prescription. Rest Day and no-plan entries have neutral nullable workout fields and remain distinct.

The first effective plan date is exposed by the private plan read as `first_effective_from`. The Calendar UI does not navigate before that date. Explicit schedule reads may still return `no_plan` for a pre-plan date.

## Selected-day detail

`GET /api/private/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&expand=prescription`

The only accepted expansion is `prescription`. It adds the complete resolved workout prescription for the selected date, including Blocks, Exercises, Prescribed Sets, targets, structured Resistance, tempo, rest, and applicable effort/incline fields. Unknown expansion values fail with `400 invalid_request`.

When the expanded entry has a `session_key`, the UI makes the separate authenticated `GET /api/private/sessions/:session_key` read. That detail contains the immutable Training Plan Snapshot, Session Status, completion fraction, completed and unfinished Completion Items, Actual Training Data, and skip context. No full Session details are preloaded for unselected dates. An overdue-unstarted entry has no Session and no correction target.

`revision_key` and `source_ref` remain read-model provenance fields for deterministic projection and diagnostics; the Calendar UI does not render them in the selected-day detail.

## Calendar and Today boundary

The Calendar navigation is `今日 | 日历 | 进展 | 设置`. Calendar provides no start, continue, restart, skip, record, or end action. Today remains the only execution surface. Historical completed, partial, and skipped Session details may link to the existing `校正记录` flow; correction preserves the Scheduled Workout date and immutable Training Plan Snapshot.

All reads and correction writes stay inside the authenticated Athlete boundary. Rest Day and no-plan are neutral and distinct; no Calendar read creates a Session or changes a plan.
