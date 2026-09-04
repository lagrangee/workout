# Local Training Plan Projection v1

## Purpose

`/workout plan2local` reads the configured Athlete's effective Workout Plan and
stores a local, Obsidian-native mirror. Workout remains the plan source of
truth. The mirror is for human reading and Agent context; edits in the vault
are never imported back into Workout.

The route takes no arguments. One run captures the schema-version-2
`workout_get_plan` response: one final Planned Day per covered date, a
deduplicated prescription dictionary, Athlete timezone, freshness, and
`training_version`. Plan Revision history is intentionally absent.

## Vault layout

The root is the existing local-only `WORKOUT_ARCHIVE_DIR` value.

```text
$WORKOUT_ARCHIVE_DIR/
  README.md
  AGENTS.md
  plan/
    index.md
    weeks/
      YYYY-MM-DD.md
  .sync/
    plan2local/
      effective.json
      manifest.json
```

`plan/index.md` is the compact user-facing entry point. It links to one file
per current/future natural week without repeating Exercise or Set detail.

Each `plan/weeks/YYYY-MM-DD.md` uses the natural week's Monday as its stable
name. A later Plan write overwrites the same week file rather than adding a
revision shard. Every file renders the seven final dated Planned Days,
including Rest/no-plan states, moved-day provenance, blocks, Exercises,
ordered Sets, targets, resistance, tempo, and rest. These are prescriptions,
not evidence that a Session was completed.

`.sync/plan2local/effective.json` is a minified, exact copy of the safe effective
Plan response. `.sync/plan2local/manifest.json` is the local receipt and
ownership manifest. It records freshness, semantic `plan_digest`, whether
content changed, managed paths, removed paths, and readback status. Neither
file contains credentials.

## Replacement and cleanup

The route writes and verifies the complete new generation before cleanup. It
then removes only:

- prior manifest-owned week files that match either the current stable pattern
  `plan/weeks/YYYY-MM-DD.md` or the superseded generated pattern
  `plan/weeks/YYYY-MM-DD--<digest-12>.md`; and
- legacy generated files `plan/current.md`, `data/plan/current.json`,
  `.sync/plan2local.json`, and `.sync/plan2local/source.json`.

Unknown files and user-created notes are preserved. Repeating a run creates no
duplicate notes. `training_version` is the Workout training-state sequence;
`plan_digest` is only the local effective-content identity. The manifest moves
from `write_status: partial`/`cleanup_status: pending` to verified completion,
so interruption cannot be reported as success.

Session records remain immutable and self-contained. A Session repeats its
prescribed snapshot because it records the exact basis of one execution; the
mutable effective Plan projection cannot safely serve as historical Session
storage.

## Route

```text
/workout plan2local
```

The route calls `workout_save_plan_local` with no arguments. That local tool
reads `/api/agent/v1/plan`, validates its effective response, atomically writes
and verifies the managed projection under `WORKOUT_ARCHIVE_DIR`, and returns
the manifest. Source, configuration, filesystem, or readback errors remain
failures.

`plan2local` does not read COROS, publish cloud data, create a Plan Revision,
or alter any Planned Day or Session. Plan changes continue through the separate
read-validate-confirm-apply-readback flow.
