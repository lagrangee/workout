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
`ended_at > started_at`, and intervals cannot overlap. An actively executing
`in_progress` Session has exactly one open interval and it is last; a paused
`in_progress` Session has no open interval. Terminal Sessions also have no
open interval. The server derives
`training_duration_sec`; clients never submit it.

Start, continue, and restart commands create the interval and return its
server-issued `interval_key`. `POST .../pause` closes the active interval and
leaves the Session `in_progress`; it is idempotent when the Session is already
paused. `POST .../resume` opens a new server-issued interval for an existing
paused Session; a repeated resume while an interval is already open returns the
current Session without opening a second interval. Resuming an already-started
in-progress Session is allowed after local midnight; its immutable Scheduled
Workout date and `timezone_at_session` are retained. This does not permit
creating a past-date Session or reopening a terminal past-date Session.
Record replacement may adjust or remove an existing interval
only while an active open interval exists; a paused in-progress Session must
resume before recording a Completion Item. A terminal correction may add a
closed interval with a client-generated UUID v4 key; an in-progress replacement
cannot invent a new open interval and must preserve the server-issued open key
with `ended_at: null`. Completed and partial Sessions retain at least one
closed interval.

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
and derives `completed` at 100 percent or `partial` below 100 percent. A
paused in-progress Session has no open interval to close and may end directly
with its already-closed intervals.

`POST .../pause` accepts `{ "close_at": "..." }` or `{}` and closes the
server-owned open interval without changing Session status. `POST .../resume`
accepts `{}` and creates a fresh open interval for an existing paused
in-progress Session. Both commands require an `Idempotency-Key` and return the
complete Session detail.

For both record versions, switching Apps, hiding the document, or losing Screen
Wake Lock does not pause the Session, rest countdown, or timed action. The
mounted execution page keeps absolute wall-clock deadlines. It releases Screen
Wake Lock while hidden and reacquires it when visible. An unsupported, denied,
or released Wake Lock is a degraded display capability, not an execution
interruption; supported browsers expose an explicit retry without a page reload.

The mounted execution page detects inactivity in the foreground and background.
Its allowance is the current rest countdown, the next prescribed duration (if
present), and a two-minute grace period. A started timed action includes its
remaining preparation and action duration before that grace period. Training
interactions renew the allowance; a visibility event or frame tick does not.
Expiry freezes local timers and closes the active Training Interval at the
absolute cutoff, even when a frozen document detects it later. The Session
stays `in_progress` and requires explicit resume. Timed actions never record
Completion Items automatically.

Navigation away from execution, document departure (`pagehide`), opening the End
form, and manual pause still close the active Training Interval. Returning to
an existing mounted page automatically resumes only its own pagehide pause;
manual, inactivity, End-form, navigation and recovered Sessions remain paused.
Direct command clients reconcile an uncertain pause with its original
idempotency key before resuming. The browser execution queue can show a local
resume while a pause is pending. The server receives both actions in order and
creates the next interval after closing the prior one. BFCache restoration
reconciles the existing queue or authoritative interval before resuming.

Already scheduled browser audio is retained on visibility loss so supported
platforms can deliver action and rest cues while another App is open. Background
audio remains best effort: an OS may suspend the document or its audio output;
this is not a system-notification guarantee. Foreground return recreates output,
aligns remaining cues to their existing deadlines, and skips elapsed cues.
Manual pause, inactivity, navigation and pagehide cancel scheduled cues. Audio
failure never blocks visual timing or Session execution.

A successful End response contains the full terminal
Session detail; refreshing other read projections does not delay confirmation
of that committed End. A transport error, HTTP timeout, or server failure leaves
the End outcome unconfirmed; the client retries the same frozen body and
idempotency key. Repeated uncertain failures keep the End form locked until that
submission is confirmed. A concurrency conflict on a replay of an already
unconfirmed End retains that same frozen submission; it does not prove that
the original End was rejected. A first definitive rejection keeps the draft
editable and surfaces the failing fields.

### Browser execution sync v1

Authenticated Today responses advertise `execution_sync_version: 1` and the
verified `athlete_key` used to scope browser recovery. The same read embeds
`session_detail` for the returned Session, or null when there is no Session.
The browser journals
each training action before projecting it onto the screen. Its local queue
belongs to that Athlete and browser tab and survives reload and reauthentication
in the same tab. The server remains authoritative for Workout Sessions.

`POST /api/private/sessions/:session_key/sync` requires an `Idempotency-Key`.
The JSON body has `base_updated_at` from the last accepted Session detail and
an ordered `actions` array of 1–32 entries.

- `{ "type": "pause", "at": "..." }` closes the open Training Interval.
- `{ "type": "resume", "at": "..." }` starts a new server-owned interval at the
  recorded click instant. Timer instants must be RFC 3339 UTC and preserve
  interval ordering and existing completion timestamps.
- `{ "type": "record", "results": [...], "exercise_feedback": [...] }` upserts
  one or two distinct Completion Items with their respective v1 or v2 result
  shape. The submitted feedback replaces the current Exercise Feedback.

The server applies the batch atomically to an in-progress Workout Session.
A stale Session version returns 409 and leaves the local journal available.
The response is the full Session detail plus `synced_updated_at`, which
identifies the version accepted for the batch. An idempotent replay can return
a newer authoritative detail alongside the original acknowledgement. The browser
preserves the original serialized body and key for ambiguous retries.

The browser drains queued actions before End and supplies the optional
`base_updated_at` precondition with its frozen End body. It retains that body
and key locally until confirmed or definitively rejected, including through a
login interruption. The Session reaches terminal status on server confirmation.

The private Calendar maintenance command `POST /api/private/sessions/normalize-expired`
is the one explicit exception to the normal end derivation: for an `in_progress`
Session whose Scheduled Workout date is earlier than the Athlete's current local
date, it closes the open interval at the last persisted Session activity time and
sets status to `partial` without deriving `completed`. It requires an
`Idempotency-Key`, is Athlete-scoped, and is safe to replay. No background job
performs this normalization.

Terminal correction uses `PUT .../record`, requires all intervals closed, and
rederives completion and status. A skipped Session permits only note and skip
reason correction until restart. There is no field merge, audit history,
offline draft, or client-selected status.

State conflicts return `409`; shape, relationship, duplicate-key, time, and
invariant violations return `400`. Any failure writes nothing.
