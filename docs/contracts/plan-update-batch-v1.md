# Plan Update Batch v1

A Plan Update Batch is a transient atomic transport for two to four complete
[Plan Update Package v2](plan-update-package-v2.md) values. It does not create
a new plan model: each successful member remains one immutable Plan Revision
containing one complete Weekly Template.

```json
{
  "schema_version": 1,
  "updates": [
    {
      "schema_version": 2,
      "effective_from": "2026-08-24",
      "week": {}
    },
    {
      "schema_version": 2,
      "effective_from": "2026-08-31",
      "week": {}
    }
  ]
}
```

`updates` contains two to four items. Every item is a complete, independently
valid Plan Update Package v2 and therefore uses the same portable structural
definition at MCP and Worker interfaces. Effective dates are unique, strictly
ordered, fall on Monday, and are exactly seven days apart. Unknown fields, duplicate
JSON members, legacy package versions, gaps, overlaps, no-op members, or an
invalid member reject the entire batch.

Validation clones the Athlete state and simulates each Plan Revision in order.
It returns every complete resulting week, the inclusive resulting Schedule
window, `batch_digest`, `base_plan_digest`, current `training_version`, and the
base-plan evidence used for every member. Validation never persists state.

Application requires the exact canonical batch, both validation digests,
`confirmed: true`, and one fresh idempotency key. It re-parses the batch,
recomputes the batch and sequential base evidence, and validates every member
inside one mutation boundary. A mismatch, stale base, invalid member, or
concurrent state change writes no revision. Success appends every Plan Revision
atomically and increments `training_version` exactly once.

Readback covers the Current Plan timeline and the full inclusive Schedule from
the first effective Monday through the Sunday of the last included week.
