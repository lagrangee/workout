# Session Record v1

## Purpose

Session Record v1 is the authenticated App's full replacement shape for
`PUT /api/private/sessions/:session_key/record`. The same `record` object is
embedded in `POST /api/private/sessions/:session_key/end`.

It contains only editable latest training data. Session identity, Athlete,
Scheduled Workout relationship, Training Plan Snapshot, immutable dates, and
command-derived status are never writable. Coach API and Athlete Export have
independently versioned read shapes.

## Shape

```json
{
  "record_schema_version": 1,
  "completion_results": [
    {
      "completion_item_key": "ci_opaque",
      "completed": true,
      "actual": {
        "metric": "reps",
        "value": 6
      },
      "resistance": {
        "mode": "external_weight",
        "load_kg": 12.5,
        "quantity": 2
      },
      "rir": 0,
      "completed_at": "2026-07-31T08:12:00Z"
    }
  ],
  "training_intervals": [
    {
      "interval_key": "ti_opaque",
      "started_at": "2026-07-31T08:00:00Z",
      "ended_at": null
    }
  ],
  "session_rpe": null,
  "note": null,
  "exercise_feedback": [],
  "skip_reason": null
}
```

Every shown field is required. Known absence is explicit `null`; every object
rejects unknown fields. Duplicate JSON member names and duplicate stable keys
are invalid.

## Results

- There is at most one result per snapshot `completion_item_key`; omission
  means no result. `completed` is the required literal `true`, not a writable
  boolean state.
- `actual` is required and matches the snapshot target metric: `reps` or
  `duration_sec`. Its value is a positive integer.
- `resistance` is `null` exactly when the snapshot has no Resistance; otherwise
  its mode must match the snapshot. External and assisted resistance
  require positive integer `quantity`; `load_kg` is `null` or non-negative.
  Bodyweight requires both numeric fields to be `null`.
- `rir` is `null` or integer `0–10`. `completed_at` is required and must fall
  inside one of the Session's intervals; for an open interval it must also be
  no later than the server's current instant.

## Intervals and Session Fields

Interval keys are stable and unique. Instants are RFC 3339 UTC,
`ended_at > started_at`, and intervals cannot overlap. An `in_progress`
Session has exactly one open interval and it is last. Terminal Sessions have
no open interval. The server derives
`training_duration_sec`; clients never submit it.

Start, continue, and restart commands create the interval and return its
server-issued `interval_key`. Record replacement may adjust or remove an
existing interval. A terminal correction may add a closed interval with a
client-generated UUID v4 key; an in-progress replacement cannot invent a new
open interval and must preserve the server-issued open key with
`ended_at: null`. Completed and partial Sessions retain at least one closed
interval.

For `PUT .../record`, Session RPE is `null` while in progress or skipped and
integer `0–10` only when completed or partial. For `POST .../end`, validation
uses the derived target status, so the submitted final record may contain
integer `0–10`. `note` is `null` or 1–5000 trimmed characters.
`skip_reason` is `null` outside skipped status and otherwise `null` or 1–500
trimmed characters. A skipped Session has no intervals, results, RPE, or
Exercise Feedback.

Exercise Feedback contains at most one item per snapshot exercise occurrence:

```json
{
  "exercise_occurrence_key": "eo_opaque",
  "text": "Left side felt less stable."
}
```

`text` is 1–1000 trimmed characters.

## Replacement and Commands

`PUT .../record` atomically replaces the entire editable record; omission from
an array deletes the prior value. It does not close an open interval or change
an `in_progress` Session to a terminal status.

`POST .../end` accepts this abbreviated envelope, where `record` must be the
complete shape above:

```json
{
  "record": {},
  "ended_at": "2026-07-31T08:45:00Z"
}
```

`ended_at` is a required RFC 3339 UTC instant and closes its one open interval; it cannot precede the
interval start or be more than five minutes in the future. The write is atomic
and derives `completed` at 100 percent or `partial` below 100 percent.

Terminal correction uses `PUT .../record`, requires all intervals closed, and
rederives completion and status. A skipped Session permits only note and skip
reason correction until restart. There is no field merge, audit history,
offline draft, or client-selected status.

State conflicts return `409`; shape, relationship, duplicate-key, time, and
invariant violations return `400`. Any failure writes nothing.
