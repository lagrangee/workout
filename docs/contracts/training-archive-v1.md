# Training Archive v1

## Purpose

Training Archive v1 is a local, read-optimized evidence archive for one
Athlete. It combines a point-in-time Workout read with an explicitly scoped
COROS aerobic read so later historical and weekly analysis does not need to
reconstruct every source query.

The archive is a derived artifact. Workout and COROS remain the authoritative
sources, and archive files are never imported into either source. This archive
is separate from Athlete Export v1 because Athlete Export deliberately excludes
Endurance Telemetry.

## Scope

The v1 COROS scope is limited to the aerobic sport types observed in the
current Athlete history:

```text
100 = Outdoor Run
101 = Indoor Run
102 = Trail Run
104 = Hike
200 = Cycling
```

COROS Strength (`402`) is outside this archive. Other unrecognized sport types
are reported as ignored by a sync and are not written as aerobic records.

Workout data covers the Athlete-local Scheduled Workout, its Workout Session
when one exists, Actual Training Data, Session RPE, notes, and source
provenance. A Rest Day or a scheduled date without a Session remains an
explicit Workout source result; it is not converted into an aerobic activity.

## Local layout

The root is supplied by a local-only `WORKOUT_ARCHIVE_DIR` configuration value.
The path is never committed to the repository or inferred from a guessed
Obsidian location.

```text
$WORKOUT_ARCHIVE_DIR/
  daily/YYYY-MM-DD.md
  weekly/YYYY-Www.md
  data/coros/YYYY-MM-DD-<activity_ref>.json
  data/coros/YYYY-MM-DD-<activity_ref>.fit
  config/routes.json
```

`activity_ref` is the COROS activity `labelId`. It identifies one activity;
it is not a route identifier. `route_direction` is an activity-level derived
field: it is `forward`, `reverse`, or `null` and is meaningful only when the
activity has a `route_key`. The FIT path is a byte-preserved private sidecar
for the same activity; it is not imported into Workout.

## Source routing

### Local-first analysis

Historical analysis and weekly review load the bounded local date/week slice
first. A local record is usable when it has the expected `schema_version`,
source status, Athlete-local date, and `data_as_of` values.

The Agent reads a live source when the requested period includes today, the
local record is missing or partial, a source timestamp is absent, or the
Athlete explicitly asks for a refresh. A live value wins over a conflicting
local value. A normal analysis read never writes the archive.

### Live-authoritative operations

- Current Plan, Scheduled Workout, Workout Session, and all plan changes use
  the typed Workout MCP reads and write flow.
- Latest COROS activity, recovery, and current training-load questions use
  COROS MCP.
- `sync data` is the only archive-writing operation. It reads both sources and
  then writes the local files.

## `sync data`

`sync data` is a manual, read-then-write operation in the `workout` skill.

- With no date, it targets the previous Athlete-local date.
- It accepts one explicit local date for a re-run or backfill.
- It may accept a user-provided `route_key`; when absent, the activity keeps a
  null route key.
- It queries the Workout schedule for the exact inclusive date and reads the
  complete Session only when the schedule supplies a Session reference.
- It queries COROS with the five v1 aerobic sport codes, then retrieves the
  activity detail, lap data, and FIT file for each returned activity.
- It writes one daily Markdown note, one sanitized COROS detail file, and one
  byte-preserved FIT sidecar per activity. Re-running the same date updates the
  same files idempotently.
- After a usable FIT is written, it automatically runs the route matcher. A
  unique existing-route match writes `route_key` and `route_direction` into the
  activity archive.
- An unmatched activity with enough GPS data produces a registration proposal
  and asks the Athlete for a route name. After the name is supplied, sync adds
  the route to the local registry and writes the new assignment. A short or
  GPS-incomplete activity remains unmatched without a registration prompt.
- It does not generate daily coaching analysis. Weekly analysis is a separate
  manual operation over daily facts and detail files.

The operation returns a receipt containing the target date, source statuses,
`data_as_of` values, ignored sport types, written paths, record counts, and
structured errors. It never turns missing data into zero.

Source status is one of:

```text
complete = the requested source slice was read and represented
none     = the source read succeeded but no in-scope record exists
partial  = some expected detail or record was unavailable
error    = the source read failed
```

An error in one source does not erase a successful result from the other
source. A partial note remains visibly partial and is eligible for a later
idempotent sync.

A COROS activity whose summary and lap data succeed but whose FIT download
fails is `partial`. Its JSON sidecar remains available and the FIT error is
retained in the sync receipt so a later run can retry only the missing
artifact.

## Route assignment

The route registry is human-maintained, and `sync data` may extend it only after
the Athlete supplies a route name. The matcher recognizes existing routes and
does not invent a name. A route is direction-agnostic: the registry stores a
route identity, optional sport and distance filters, and one spatial reference
signature for each usable entry direction. `route_direction` is written only
to the matched activity.

```text
RouteRegistryV1 = {
  schema_version: 1,
  routes: [{
    route_key: string,
    sport_types: integer[],
    distance_range_km: [number, number],
    direction_signatures: {
      forward: {
        start: { lat: number, lon: number },
        anchor: { lat: number, lon: number },
        anchor_distance_m: number,
        start_radius_m: number,
        anchor_radius_m: number
      },
      reverse: {
        start: { lat: number, lon: number },
        anchor: { lat: number, lon: number },
        anchor_distance_m: number,
        start_radius_m: number,
        anchor_radius_m: number
      }
    }
  }]
}
```

An unused direction may be omitted, but a route must have at least one of
`forward` or `reverse` signatures. These signatures are matching
references, not route properties that constrain how the route may be used. The
registry is stored as JSON so the standalone matcher can use Node's built-in
parser without adding a YAML dependency.

For a new route, the observed activity's first valid GPS point and the point
around 200 m after the start seed the `forward` signature. The last valid
point and the point around 200 m before the finish seed `reverse`. The initial
distance range is the observed distance plus or minus 10%. The Athlete may edit
these values later. The activity that creates the route is recorded as
`forward` because its observed start defines that reference entry.

### FIT-backed route matching

FIT provides GPS points plus cumulative distance. The standalone
`route-matcher.mjs` program first puts route distance ranges into coarse 1 km
buckets, then only examines routes in the activity's bucket. It applies three
exact checks for each remaining configured direction:

1. the first GPS point falls within that direction's `start_radius_m`;
2. the activity point around the configured `anchor_distance_m` falls within
   that direction's `anchor_radius_m`;
3. the activity distance falls within the route's `distance_range_km`.

The default anchor is 200 m after the activity start. This is a deliberately
small GPS fingerprint: it handles routes whose two endpoints are close, while
avoiding H3, trajectory resampling, DTW, or a full route-shape comparison.

The bucket is only a prefilter: the exact distance range check runs after the
lookup, so routes that cross a bucket boundary are not lost. Routes without a
distance range stay in a small unbounded fallback set.

If exactly one configured direction matches, the result is `matched` and
contains both `route_key` and `route_direction`. Zero matches is `unmatched`;
more than one is `ambiguous` and leaves both activity route fields `null`. For an
`unmatched` result with at least 1 km and two valid endpoints, the matcher also
returns a registration proposal. The sync flow asks for a name and applies the
proposal; the matcher itself remains side-effect-free. An `ambiguous` result
never creates a new route automatically and instead asks the Athlete to choose
an existing route. The matcher does not use `labelId`, H3, trajectory
resampling, or elevation similarity. The full FIT sidecar remains available for
later analysis when the simple fingerprint is insufficient.

## Analysis ownership

Daily files preserve source facts and transparent derived summaries. Weekly
files preserve manually triggered Agent analysis with an `analysis_as_of`
timestamp. Analysis is a hypothesis or recommendation layer and never becomes
Workout or COROS source data.

## Privacy and compatibility

The archive excludes credentials, Agent tokens, Coach Share data, login
identity, symptom records, public route exports, and unrelated COROS sport
types. Daily Markdown and sanitized JSON exclude GPS tracks and raw
high-frequency sensor streams. FIT sidecars are an explicit local-only
exception: they may contain GPS and high-frequency telemetry needed for later
trajectory analysis, and must never be copied into exports, logs, or shared
responses.

Provider-native lap fields are retained only after the sensitive envelope has
been filtered. FIT readers must parse the provider file definitions rather than
assuming a fixed field set.

The archive schema is independently versioned. A reader must preserve unknown
provider fields inside the declared sanitized field map and must not silently
reinterpret a field when its unit or semantic meaning is not in the field
catalog.

## Canonical references

- [Training Archive Wire Catalog v1](training-archive-wire-catalog-v1.md)
- [Athlete Export v1](athlete-export-v1.md)
- [Athlete Export Wire Catalog v1](athlete-export-wire-catalog-v1.md)
- [Workout domain context](../../CONTEXT.md)
