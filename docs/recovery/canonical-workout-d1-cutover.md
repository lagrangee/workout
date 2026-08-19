# Canonical Workout D1 cutover runbook

This is an explicit, one-Athlete clean-cut operation. It is not part of Worker
startup, request handling, or normal seed verification. The application only
uses the relational Plan and Session rows as the Workout source after the
`workout_storage_cutover` marker exists for that Athlete.

## Preconditions

- Apply migrations `0001_initial.sql` through
  `0009_canonical_workout_cutover.sql` to the target D1 database.
- Export exactly one Athlete's current canonical state, or pass
  `--athlete-key` when the input contains multiple Athletes.
- Stop normal writes for the bounded cutover window and inspect the generated
  SQL before applying it.
- Keep the private local archive available. The archive is derived evidence,
  not the D1 source of truth.

## Generate and review

```sh
node scripts/rebuild-canonical-d1.mjs \
  --input ./private/athlete-state.json \
  --output ./private/canonical-cutover.sql \
  --athlete-key ath_example
```

The command rejects legacy ranges, unknown Exercise IDs, and incomplete
canonical snapshots. It emits one transaction that rebuilds only the selected
Athlete, clears the legacy Workout arrays from `state_json`, and writes the
cutover marker after the canonical rows are ready.

## Apply with rollback evidence

```sh
node scripts/rebuild-canonical-d1.mjs \
  --input ./private/athlete-state.json \
  --output ./private/canonical-cutover.sql \
  --athlete-key ath_example \
  --apply \
  --database workout-tracker \
  --remote true \
  --confirm canonical-cutover \
  --archive-dir "$WORKOUT_ARCHIVE_DIR" \
  --rollback-dir ./private/workout-rollbacks
```

`--apply` first copies the bounded private archive to a timestamped
`workout-rollback-*` directory and refuses a rollback directory inside the
archive. It never deletes the archive automatically. The receipt prints the
SQL path, cutover timestamp, and rollback reference; retain that receipt with
the operator change record.

## Read-back and rollback boundary

Verify the marker, canonical Plan/Session row counts, `PRAGMA foreign_key_check`,
and an authenticated application/Agent read before reopening writes. Then run
the local archive sync for the affected dates; archive files remain derived
and can be regenerated from the authoritative sources.

If the cutover fails before commit, the transaction leaves the target Athlete
unchanged. If an already committed cutover needs recovery, use the retained
private archive copy and the D1 Time Travel/export operator procedure; do not
add a startup repair path or silently reintroduce the old JSON shapes.
