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
                  "resistance": null,
                  "tempo": "3.5-1-1.25-0",
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

Exercise Category is Registry-owned and is not a Plan Update input member.
Callers that submit `category` are rejected as unknown input. Successful
validation copies the Registry's current `category` (`strength`, `endurance`,
`mobility`, or `recovery`) into the immutable Plan occurrence together with the
formal name and `definition_version`.

Targets are exact positive integers: `reps` or `duration_sec` with one
`value`; range-shaped `min`/`max` targets are invalid. A Set's `ordinal` is its
ordered position and `set_id` is its stable local identity. Tempo is either
`null` or a strict four-component string such as `3-1-1-0` or
`3.5-1-1.25-0`. Each phase is a non-negative integer or decimal number.

Resistance input is explicit and is normalized at validation time:

```json
null
```

```json
{ "mode": "bodyweight" }
```

```json
{ "mode": "external_load", "value": 10, "unit": "lb" }
```

The normalized Plan Set stores `resistance_mode` and `resistance_kg`;
`null` stores both normalized fields as `null`, while bodyweight stores a
non-numeric `bodyweight` mode and `null` load. The only accepted input units
are `kg` and `lb`. No numeric string, zero-as-bodyweight, unsupported mode, or
unknown Exercise is repaired.

The structured MCP tools and the Worker reuse one portable v2 structural
definition. That definition owns exact object members, required fields, scalar
types, array bounds, key formats, target shape, resistance variants, and tempo
shape. It intentionally does not decide whether an Athlete-local effective
date is valid or future, whether an Exercise exists, whether that Exercise
supports the requested execution, target, resistance, or Recording Intent, or
whether human-readable strings need trimming. Those contextual decisions stay
with the Worker and return field-addressed semantic errors without mutation.

Successful validation resolves the current registry name, `definition_version`,
and category into the read model. A Session created later freezes those values
again in its Training Plan Snapshot. A later registry rename may change the
Current Plan read name, but neither a rename nor a category change can mutate
an existing Plan Revision or Session.

The Worker validates and applies this package atomically. D1 stores the
Athlete-owned Plan, immutable revision, weekday slot, occurrence, and Set
records in independent canonical tables; the repository registry is not a D1
table.
