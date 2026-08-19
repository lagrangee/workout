# Exercise Registry v1

The Exercise Registry is the one global, repository-owned catalog of planned
movements. It is bundled into the Worker from `config/exercises.json`, parsed
and validated once per runtime isolate, and never stored as an Athlete-owned
D1 catalog. A Plan references `exercise_id`; it does not copy an independent
ID-to-name mapping.

## Document

```json
{
  "schema_version": 1,
  "exercises": [
    {
      "exercise_id": "dead_bug",
      "slug": "dead-bug",
      "name": "死虫",
      "definition_version": 1,
      "status": "active",
      "execution": { "side_modes": ["per_side", "alternating"] },
      "target": { "metrics": ["reps", "duration_sec"] },
      "resistance": { "modes": ["bodyweight"], "units": [] },
      "equipment": { "required": [], "optional": [] },
      "capabilities": {}
    }
  ]
}
```

`exercise_id` is immutable and is the identity used by Plans, Sessions, joins,
and history. `slug` is only a readable reference. A formal name may change;
that change increments only the Exercise's `definition_version`. An ID is
never reused. `status` is `active` or `deprecated`: both remain resolvable for
historical reads, but only active definitions may be selected by a new Plan.

The four standard capability groups are strict:

- `execution.side_modes`: `none`, `bilateral`, `per_side`, `alternating`.
- `target.metrics`: `reps`, `duration_sec`.
- `resistance.modes`: `bodyweight`, `external_load`; supported units are
  `kg` and `lb`.
- `equipment.required` and `equipment.optional`: unique stable keys.

`capabilities` is reserved for explicitly versioned extension objects. Each
extension must be an object with a positive integer `schema_version`; an
unversioned free-form map is invalid. New cross-surface capabilities should
be promoted to one of the standard groups instead of being duplicated in
this namespace.

The authenticated private boundary exposes the registry at
`GET /api/private/exercise-registry`. Without a query it returns the document;
with `?exercise_id=` it resolves one definition. This is a read boundary only;
registry authoring is a repository change, not a Workout page operation.
