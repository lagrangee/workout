# Canonical Session Record v2

Canonical Session Record v2 is the editable replacement shape for
`PUT /api/private/sessions/:session_key/record`. The same record is embedded
in `POST /api/private/sessions/:session_key/end`.

It is used when the Session contains a v2 Training Plan Snapshot. A legacy
Session Record v1 remains a separate compatibility shape until the clean-cut
rebuild; new canonical plans and Sessions must use v2.

```json
{
  "record_schema_version": 2,
  "set_results": [
    {
      "completion_item_key": "ci_opaque",
      "status": "completed",
      "actual": { "metric": "reps", "value": 5 },
      "resistance": { "mode": "external_load", "value": 22, "unit": "lb" },
      "rir": 2,
      "note": "左侧稳定",
      "completed_at": "2026-08-19T12:00:00Z"
    }
  ],
  "training_intervals": [
    { "interval_key": "ti_opaque", "started_at": "2026-08-19T11:55:00Z", "ended_at": null }
  ],
  "session_rpe": null,
  "note": null,
  "exercise_feedback": [],
  "skip_reason": null
}
```

Every shown field is required and objects reject unknown fields. `set_results`
is a full replacement of the current result set; one Completion Item may have
at most one current result. A result can be `completed`, `partial`, or
`skipped`. `completed` requires a positive integer actual value and a timing;
`partial` may retain a positive actual value or explicit `null`; `skipped`
requires `actual: null` and `completed_at: null`. Missing values are not
silently converted to zero.

The actual metric must match the frozen target. Resistance is `null`,
`{ "mode": "bodyweight" }`, or an external load with a numeric `value` and
`unit` `kg` or `lb`. The write boundary normalizes external load to canonical
`resistance_mode: "external_load"` and `resistance_kg`; bodyweight remains a
distinct mode with a null numeric load. The frozen target, tempo, rest, and
snapshot resistance are never changed by a result.

`rir` is null or an integer from 0 through 10. Result `note` is scoped to the
Completion Item. `exercise_feedback` is scoped to a snapshot occurrence and
Session `note` is scoped to the Session. Neither is written to the global
Exercise Registry.

Alternating occurrences expand to independent left and right Completion Items.
The page may present one alternating counter, but the record keeps one result
per side. The server derives terminal Session status from completed results;
clients do not submit status.

Each canonical snapshot Exercise also retains the Registry `category` selected
by its Plan Revision: `strength`, `endurance`, `mobility`, or `recovery`.
Category is not writable through Session Record v2. A later Registry category
change therefore cannot rewrite the historical meaning of this Session.
