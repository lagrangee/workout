# Calendar Read Contract v1

## Purpose

The Calendar is a private, authenticated inspection projection. It does not add a Calendar entity or `/api/private/calendar` truth. Planned Day storage owns dated plan facts; Schedule projects it; Session reads own execution facts; the UI composes them by `session_key`.

## Week summary

`GET /api/private/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD`

The range is inclusive, interpreted in the authenticated Athlete's IANA timezone, and is limited to 366 days. Calendar navigation requests seven dates. The default response is summary-first: workout entries include `date`, `weekday`, `kind`, `title`, `module_count`, `estimated_duration_min`, `prescription_ref`, `scheduled_workout_key`, nullable `session_key`, `is_due`, `is_overdue_unstarted`, `source_ref`, and `revision_key`; moved entries additionally expose `moved_from_date` or `moved_to_date`. They do not include an inline prescription. Rest Day and no-plan entries have neutral nullable workout fields and remain distinct.

The first effective plan date is exposed by the private plan read as `first_effective_from`. The Calendar UI does not navigate before that date. Explicit schedule reads may still return `no_plan` for a pre-plan date.

The optional `include=aerobic_summary` parameter adds one compact, date-scoped
COROS read model to every entry. When a workout slot has a `recording_intent`,
the same response also adds one compact `recording_evidence` projection.
Unknown `include` values fail with `400 invalid_request`.

```text
aerobic_summary = {
  schema_version: 1,
  generated_at: Instant,
  local_date: LocalDate,
  source: "coros",
  source_status: complete|none|partial|error,
  data_as_of: Instant|null,
  activity_count: number,
  distance_km: number|null,
  duration_sec: number|null,
  records_href: string
}
```

The summary has no activity rows, raw FIT/GPS data, or Workout Session
reference. Calendar renders it only when `activity_count > 0` and offers a
Records link for full aerobic history. This is date context, not a cross-source
event join.

```text
recording_evidence = {
  schema_version: 1,
  generated_at: Instant,
  source: "coros",
  sport_type: 100|102|104|200,
  route_key: string,
  status: awaiting_sync|recorded|needs_link,
  activity_count: number,
  match_count: number,
  source_status: complete|none|partial|error,
  data_as_of: Instant|null,
  records_href: string
}
```

`recorded` requires exactly one same-date COROS Activity whose `sport_type`
and `route_key` equal the explicit Recording Intent. Zero matching Activities
with some same-date aerobic data, or multiple matching Activities, is
`needs_link`; no same-date aerobic data is `awaiting_sync`. The compact value
does not expose `activity_ref`. It may satisfy Calendar's display state as
“已记录”, but it never changes `session_key`, creates a Session, or rewrites
`is_overdue_unstarted`, whose meaning remains Session-specific.

## Selected-day detail

`GET /api/private/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&expand=prescription`

The only accepted expansion is `prescription`. It adds the complete resolved workout prescription for the selected date, including Blocks, Exercises, Prescribed Sets, targets, structured Resistance, tempo, rest, and applicable effort/incline fields. Unknown expansion values fail with `400 invalid_request`.

When the expanded entry has a `session_key`, the UI makes the separate authenticated `GET /api/private/sessions/:session_key` read. That detail contains the immutable Training Plan Snapshot, Session Status, completion fraction, completed and unfinished Completion Items, Actual Training Data, and skip context. No full Session details are preloaded for unselected dates. An overdue-unstarted entry has no Session and no correction target.

`revision_key` and `source_ref` remain read-model provenance fields for deterministic projection and diagnostics. Calendar renders dated move provenance in plain language but does not render internal keys.

## Calendar and Today boundary

The Calendar navigation is `今日 | 日历 | 记录 | 设置`. Calendar provides no start, continue, restart, skip, record, or end action. Today remains the only Workout Session execution surface. When today's workout has a Recording Intent, Today replaces Session start/skip actions with COROS recording and `sync data YYYY-MM-DD` guidance; the Athlete does not duplicate the activity in Workout. Historical completed, partial, and skipped Session details may link to the existing `校正记录` flow; correction preserves the Scheduled Workout date and immutable Training Plan Snapshot.

Calendar may expose one explicit maintenance action for stale execution state:

`POST /api/private/sessions/normalize-expired`

The request body is `{}` and requires an `Idempotency-Key`. The server recomputes the authenticated Athlete's current local date, finds every `in_progress` Session with an earlier `scheduled_date`, closes its open Training Interval at the last persisted Session activity time, and changes its status to `partial`. It never derives `completed`, even if all Completion Items happen to have values, because the Athlete did not explicitly end the Session. The response is `{ normalized_count, session_keys }`; replaying the same idempotent request returns the original response. This is an explicit Calendar maintenance write, not an execution or recording action, and there is no scheduled daemon in v1.

All reads and correction writes stay inside the authenticated Athlete boundary. Rest Day and no-plan are neutral and distinct; no Calendar read creates a Session or changes a plan.
