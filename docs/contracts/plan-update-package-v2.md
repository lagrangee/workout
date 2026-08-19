# Canonical Plan Update Package v2

The canonical Workout Plan Update Package is a strict future-effective
replacement for one Athlete's complete Weekly Template. It resolves every
Exercise through the global repository registry and contains no copied
Athlete-local ID-to-name map.

```json
{
  "schema_version": 2,
  "effective_from": "2026-08-20",
  "week": {
    "monday": {
      "kind": "workout",
      "title": "核心训练",
      "start_time": "21:00",
      "estimated_duration_min": 25,
      "blocks": [
        {
          "title": "主训练",
          "exercises": [
            {
              "occurrence_key": "dead_bug_main",
              "exercise_id": "dead_bug",
              "execution_mode": "alternating",
              "sets": [
                {
                  "set_id": "dead_bug_set_1",
                  "ordinal": 1,
                  "target": { "metric": "reps", "value": 5 },
                  "resistance": { "mode": "bodyweight" },
                  "tempo": "3-1-1-0",
                  "rest_after_sec": 45
                }
              ]
            }
          ]
        }
      ]
    },
    "tuesday": null,
    "wednesday": null,
    "thursday": null,
    "friday": null,
    "saturday": null,
    "sunday": null
  }
}
```

A route workout may additionally declare one explicit external Recording
Intent at the workout-slot level:

```json
{
  "recording_intent": {
    "schema_version": 1,
    "source": "coros",
    "sport_type": 102,
    "route_key": "香山鸡腿线"
  }
}
```

The field is optional. When present, the slot must contain an Exercise whose
registry capability supports the selected COROS route sport type. `route_key`
is the stable Workout route identity; it is never a COROS activity reference.
The intent is stored with the immutable Plan Revision and supplies matching
criteria only. It does not create a Session or import COROS telemetry into the
Plan.

`occurrence_key` is unique within one workout slot. The same global
`exercise_id` may occur more than once when occurrence keys differ. One
occurrence selects exactly one `execution_mode` and cannot switch mode between
Sets. The mode must be advertised by that Exercise's registry
`execution.side_modes`.

Targets are exact positive integers: `reps` or `duration_sec` with one
`value`; range-shaped `min`/`max` targets are invalid. A Set's `ordinal` is its
ordered position and `set_id` is its stable local identity. Tempo is either
`null` or a strict four-component string such as `3-1-1-0`.

Resistance input is explicit and is normalized at validation time:

```json
{ "mode": "bodyweight" }
```

```json
{ "mode": "external_load", "value": 10, "unit": "lb" }
```

The normalized Plan Set stores `resistance_mode` and `resistance_kg`;
bodyweight stores a non-numeric `bodyweight` mode and `null` load. The only
accepted input units are `kg` and `lb`. No numeric string, zero-as-bodyweight,
unsupported mode, or unknown Exercise is repaired.

Successful validation resolves the current registry name and
`definition_version` into the read model. A Session created later freezes
those values again in its Training Plan Snapshot. A later registry rename
therefore changes the Current Plan read name but cannot mutate an existing
Session.

The Worker validates and applies this package atomically. D1 stores the
Athlete-owned Plan, immutable revision, weekday slot, occurrence, and Set
records in independent canonical tables; the repository registry is not a D1
table.
