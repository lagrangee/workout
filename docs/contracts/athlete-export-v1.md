# Athlete Export v1

## Purpose

Athlete Export is one authenticated Athlete's complete, point-in-time JSON data-ownership artifact. MVP offers one full-history download with no date selector, CSV variant, or restore/import workflow.

## Delivery

```text
GET /api/private/export
Content-Type: application/json; charset=utf-8
Content-Disposition: attachment; filename="workout-data-YYYY-MM-DD.json"
Cache-Control: no-store
```

The filename date is the Athlete-local generation date. The server reads all
collections in one D1 transactional batch, serializes them completely, and
checks the output before sending headers. A failure returns a normal error
response and never a partial JSON download.

MVP supports at most 10,000 Sessions and a serialized export of at most 20 MiB.
This is a delivery bound, not a retention cutoff. A preflight count or final
size above either limit returns `503` with `error.code =
"export_capacity_exceeded"` and no download. Production acceptance load-tests
the bound; expanding it later requires a resumable export design rather than a
silently partial file.

The bound accounts for current
[D1 and Worker execution limits](https://developers.cloudflare.com/d1/platform/limits/).

## Envelope

```json
{
  "athlete_export_schema_version": 1,
  "generated_at": "2026-07-31T08:00:00Z",
  "data_as_of": "2026-07-31T07:59:59Z",
  "timezone": "Asia/Shanghai",
  "counts": {
    "plan_revisions": 3,
    "scheduled_workouts": 42,
    "sessions": 31
  },
  "athlete": {},
  "plan_revisions": [],
  "scheduled_workouts": [],
  "sessions": []
}
```

Every collection reflects the same `data_as_of`: a concurrent change is wholly included or wholly absent. Collections are always arrays, including when empty.

The exact required, nullable, empty-state, ordering, and collection-item shapes
are defined by
[Athlete Export Wire Catalog v1](athlete-export-wire-catalog-v1.md).

## Contents

`athlete` contains the current display name, IANA timezone, and fixed unit conventions.

`plan_revisions` contains every immutable seven-day write revision, its stable export-safe key, monotonic `revision_sequence`, timestamps, `effective_from`, and complete Weekly Template. It is prescription and write provenance, not an infinite future schedule.

`scheduled_workouts` contains every dated workout and Rest Day through the Athlete's current local date. It includes overdue unstarted workouts, nullable prescription revision, Plan Change reference, move provenance, resolved kind and prescription, and nullable Session reference. A no-plan Planned Day produces no record.

`sessions` contains every Workout Session. Each Session includes:

- stable Session and Scheduled Workout references;
- immutable `scheduled_date` and `timezone_at_session`;
- every Training Interval as UTC start/end instants and `training_duration_sec` as their sum;
- sole `status`, completion percentage, Session RPE, notes, and skip reason where applicable;
- nested immutable Training Plan Snapshot;
- nested latest canonical Actual Training Data;
- nested optional Exercise Feedback.

Its editable nested values follow the same field meanings and invariants as
[Session Record v1](session-record-v1.md); the export shape is independently
versioned and additionally contains immutable snapshot and derived fields.

Every snapshot block, exercise occurrence, Prescribed Set, and Completion Item has an immutable export-safe key. Each actual Completion Item value references exactly one `completion_item_key`; array position, label, `exercise_key`, side, and set number are never relational identity.

The export includes only latest corrected Actual Training Data because the App has no correction audit history. Recomputable progress summaries are excluded.

## Exclusions

The file never contains:

- login email or Cloudflare identity;
- Coach Share URL, token, digest, ciphertext, status, visitor, or access metadata;
- internal database IDs;
- Endurance Telemetry;
- removed Body Feedback or symptom data;
- training goals, route background, coaching analysis, or AI output.

## Representation

- Keys and enums use `snake_case`.
- Local dates use `YYYY-MM-DD`.
- Instants use RFC 3339 UTC.
- Sessions include their immutable `timezone_at_session`.
- Numeric Resistance is kg per implement with quantity; treadmill target incline is percent.
- Optional known fields use explicit `null` when unknown or inapplicable.
- Export-safe keys are opaque, remain stable across successive exports for the same Athlete, and are not database IDs.
- `status` is exactly `in_progress`, `completed`, `partial`, or `skipped`; there is no separate outcome field.
- `training_duration_sec` excludes gaps between Training Intervals.

## Compatibility

`athlete_export_schema_version` is independently versioned from Coach API and Plan Update Package wire schemas.

Version 1 may gain additive fields; readers must ignore unknown fields. Removing or changing a field, type, enum meaning, relationship, or existing-field semantics requires a new schema version. An export is not accepted by the Plan Update Package importer.

## Acceptance

- Two successive unchanged exports retain the same record keys.
- Counts match their top-level collections.
- Every non-null relationship resolves within the file.
- Every Actual Training Data item resolves to one snapshot `completion_item_key`.
- No future dated schedule is infinitely expanded.
- A forbidden-field scan finds no identity, share-secret, internal-ID, telemetry, symptom, goal, route, or coaching data.
- A concurrent correction cannot produce a mixed old/new Session representation.
- A 10,000-Session fixture under 20 MiB exports successfully; either exceeded
  bound returns `export_capacity_exceeded` before response headers.
