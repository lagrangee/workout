# Plan Update Package v1

## Purpose

Plan Update Package v1 is the legacy strict authenticated input used to create an Athlete's first Plan Revision or write one complete seven-day Weekly Template from a future date. It is prepared outside the App, pasted as text, validated without repair, previewed in human-readable form, and applied atomically. Schedule storage follows ADR 0004 and does not repeat this package indefinitely.

It is independently versioned from Coach API and Athlete Export schemas.

## Top-Level Shape

```json
{
  "schema_version": 1,
  "effective_from": "2026-08-01",
  "week": {
    "monday": {
      "kind": "rest"
    },
    "tuesday": null,
    "wednesday": null,
    "thursday": null,
    "friday": null,
    "saturday": null,
    "sunday": {
      "kind": "rest"
    }
  }
}
```

These are the only top-level fields. All seven weekday fields are required. `effective_from` is interpreted in the authenticated Athlete's timezone and must be strictly later than the current local date.

## Slot Shapes

### No-plan day

The value is literal `null`.

### Rest Day

```json
{
  "kind": "rest"
}
```

No other Rest Day field is allowed.

### Workout

```json
{
  "kind": "workout",
  "title": "下肢力量",
  "start_time": "21:00",
  "estimated_duration_min": 70,
  "blocks": [
    {
      "title": "主训练",
      "exercises": [
        {
          "exercise_key": "bulgarian_split_squat",
          "name": "保加利亚分腿蹲",
          "category": "strength",
          "side_mode": "left_right",
          "sets": [
            {
              "target": {
                "metric": "reps",
                "min": 6,
                "max": 8
              },
              "resistance": {
                "mode": "bodyweight",
                "load_kg": null,
                "quantity": null
              },
              "target_rir": 2,
              "target_rpe": null,
              "tempo": null,
              "rest_after_sec": 120,
              "target_incline_percent": null
            }
          ]
        }
      ]
    }
  ]
}
```

- `title`: required, trimmed, 1–100 characters.
- `start_time`: required `HH:mm` local display time or explicit `null`.
- `estimated_duration_min`: required positive integer.
- `blocks`: 1–20 ordered Block objects.

### Block

The only Block fields are required `title` and `exercises`. `title` is 1–100 characters. `exercises` is a non-empty ordered array; the sum across all Blocks is at most 50 exercise occurrences per workout.

### Exercise occurrence

- All five listed fields are required and no others are allowed.
- `exercise_key`: required human-readable Athlete-scoped key matching `^[a-z][a-z0-9_]{0,63}$`.
- `name`: required, trimmed, 1–100 characters.
- `category`: `strength`, `endurance`, `mobility`, or `recovery`.
- `side_mode`: `none` or `left_right`.
- `sets`: 1–200 ordered Set objects, subject to the workout's expanded Completion Item cap.

An `exercise_key` is unique within one workout slot. Reusing it across revisions preserves exercise history; changing it creates a distinct Exercise.

## Set Shape

Every Set contains exactly the fields shown below. Fields that do not apply use explicit `null`:

```json
{
  "target": {
    "metric": "reps",
    "min": 6,
    "max": 8
  },
  "resistance": {
    "mode": "bodyweight",
    "load_kg": null,
    "quantity": null
  },
  "target_rir": 2,
  "target_rpe": null,
  "tempo": {
    "eccentric_sec": 4,
    "bottom_hold_sec": 1,
    "concentric_sec": null,
    "top_hold_sec": null
  },
  "rest_after_sec": 120,
  "target_incline_percent": null
}
```

### Target

Repetitions:

```json
{ "metric": "reps", "min": 6, "max": 8 }
```

Duration:

```json
{ "metric": "duration_sec", "min": 30, "max": 40 }
```

`min` and `max` are positive integers and `min <= max`. Exact targets use equal values.

### Resistance

`resistance` is `null` when the Set has no structured strength Resistance. Otherwise it is one of:

```json
{ "mode": "bodyweight", "load_kg": null, "quantity": null }
```

```json
{ "mode": "external_weight", "load_kg": 12.5, "quantity": 2 }
```

```json
{ "mode": "assisted_weight", "load_kg": 20, "quantity": 1 }
```

`mode` is `bodyweight`, `external_weight`, or `assisted_weight`.

- Bodyweight requires both numeric fields to be `null`.
- External and assisted weight require positive integer `quantity`.
- `load_kg` is kg per implement and may be `null` when the plan intentionally leaves the exact load to execution.
- Numeric load is finite and greater than or equal to zero.

### Effort, tempo, rest, and incline

- `target_rir`: integer `0–10` or `null`.
- `target_rpe`: number `0–10` or `null`.
- `tempo`: `null` or an object containing all four phase fields. Phase values are non-negative integer seconds or `null`, and at least one phase must be non-null.
- `rest_after_sec`: non-negative integer or `null`.
- `target_incline_percent`: number `0–100` or `null`.

Resistance and `target_rir` must be `null` outside `strength`.
`target_incline_percent` must be `null` outside `endurance`.

The schema never infers units.

## Completion Item Expansion

Every Set with `side_mode: none` expands to one Completion Item. Every Set with `side_mode: left_right` expands in stable order to left then right Completion Items.

The validator rejects a workout that expands to more than 200 Completion Items.

## Strict Validation

- Maximum UTF-8 package size: 256 KiB.
- Every object rejects unknown fields.
- Duplicate JSON member names at any object depth are rejected before ordinary
  parsing can discard them.
- Missing required fields are invalid; nullable fields must be present with explicit `null`.
- Values are never coerced, clamped, swapped, defaulted, or repaired.
- Numeric strings, non-finite numbers, invalid dates/times, reversed ranges, and unsupported enums are invalid.
- Workout, Block, Exercise, and Set arrays cannot be empty.
- A slot cannot combine workout and Rest Day shapes.
- The package contains no Athlete identity, timezone, mode, end date, generation time, database ID, notes, instructions, load instruction, condition, or progression rule.
- `schema_version` must equal integer `1`.
- A semantically identical `week` is a no-op and cannot be confirmed.

Validation reports all discoverable errors with JSON Pointer paths. Parse failure reports its location and cause. Any error prevents preview and application.

## Application

Successful application writes one immutable Plan Revision, its next revision sequence, and its complete Weekly Template in one D1 transaction. Failure writes nothing. A first revision is allowed only when the Athlete has no revision; later packages always append a new revision.

Application materializes exactly seven Planned Days beginning at `effective_from`. When two writes overlap, the higher revision sequence wins only on their shared dates; non-overlapping dates from either write remain unchanged. Plan resources retain every finite write for provenance, while Schedule resolves the final per-date result.

The preview shows `effective_from`, the count of weekday slots whose semantics changed, and the complete resulting week in normal plan language. It never shows technical line diffs.

## Compatibility

Plan Update Package v1 never gains unknown optional fields silently because its validator is strict. Any shape, enum, or semantic change requires a new `schema_version`; the App does not migrate or guess unsupported packages.

Coach API and Athlete Export values cannot be imported directly even when they project the same domain concepts.
