# Training Archive Wire Catalog v1

## Authority

This catalog defines the local Markdown and COROS detail shapes used by
Training Archive v1. It is not a COROS API schema and it is not accepted by
Workout plan or Session write APIs.

Known absence uses `null` in the stable envelope. Provider-native metrics are
kept in a sanitized map with their source field names; a normalized metric is
emitted only when its unit and semantic meaning are recorded in the field
catalog.

## Shared types

```text
LocalDate = "YYYY-MM-DD"
Instant = RFC3339 instant
SourceStatus = complete | none | partial | error
SportType = 100 | 101 | 102 | 104 | 200
```

## Daily Markdown frontmatter

Every `daily/YYYY-MM-DD.md` begins with YAML frontmatter equivalent to:

```yaml
kind: training-day
schema_version: 1
date: 2026-08-16
timezone: Asia/Shanghai
captured_at: 2026-08-17T09:00:00+08:00
updated_at: 2026-08-17T09:00:00+08:00
source_status:
  workout: complete
  coros: complete
workout:
  data_as_of: 2026-08-16T23:59:00Z
  training_version: "..."
  session_keys: []
  source_refs: []
coros:
  data_as_of: 2026-08-16T23:59:00Z
  activity_refs: []
  fit_files: []
```

The body has stable headings:

```text
## 无氧训练
## 有氧训练
## 当日汇总
## 限制与待补
```

Daily analysis is not a required section. Weekly analysis is stored in a
separate `weekly/YYYY-Www.md` file.

## COROS activity archive

Each `data/coros/YYYY-MM-DD-<activity_ref>.json` has this stable envelope:

```text
CorosActivityArchiveV1 = {
  schema_version: 1,
  field_catalog_version: 1,
  provider: "coros",
  activity_ref: string,
  sport_type: SportType,
  sport_name: outdoor_run|indoor_run|trail_run|hike|cycling,
  local_date: LocalDate,
  started_at: Instant|null,
  ended_at: Instant|null,
  route_key: string|null,
  route_direction: forward|reverse|null,
  fit_file: FitArtifact|null,
  summary: ActivitySummary,
  provider_shape: ProviderLapShape,
  lap_groups: LapGroup[]
}
```

`activity_ref` comes from COROS `labelId`. It is an activity key, never a
route key. `route_direction` is only meaningful when `route_key` is present;
it records whether the activity matched the configured forward or reverse
start of that route.

```text
FitArtifact = {
  relative_path: string,
  status: complete|partial|error,
  mime_type: "application/octet-stream",
  bytes: number|null
}
```

`relative_path` points to the byte-preserved sidecar under
`data/coros/`. A missing or failed FIT download is represented by its status;
it is not silently treated as an empty file.

### Activity summary

```text
ActivitySummary = {
  duration_sec: number|null,
  total_duration_sec: number|null,
  distance_km: number|null,
  average_heart_rate_bpm: number|null,
  max_heart_rate_bpm: number|null,
  calories_kcal: number|null,
  training_load: number|null,
  aerobic_te: number|null,
  anaerobic_te: number|null,
  training_focus: string|null,
  perceived_effort: string|null,
  sport_metrics: object
}
```

`sport_metrics` is namespaced by the sport family. Examples are:

```text
running: {
  average_pace_sec_per_km,
  moving_average_pace_sec_per_km,
  adjusted_pace_sec_per_km,
  best_kilometer_pace_sec_per_km,
  average_cadence_spm,
  average_stride_length_m,
  average_power_w
}

hiking: {
  average_speed_kmh,
  moving_average_speed_kmh,
  best_kilometer_speed_kmh,
  elevation_gain_m,
  elevation_loss_m
}

cycling: {
  average_speed_kmh,
  moving_average_speed_kmh,
  max_speed_kmh,
  average_cadence_rpm,
  average_power_w,
  normalized_power_w,
  intensity_factor
}
```

Only fields observed with a confirmed unit are populated in this normalized
summary. An inapplicable value remains `null`.

## Provider lap shape

The observed COROS response has `mode`, `subMode`, `columns`, `lapGroups`, and
an optional `sportDataDetails` object. The archive retains the safe structural
parts needed to explain the source data:

```text
ProviderLapShape = {
  mode: number|null,
  sub_mode: number|null,
  columns: { name: string, label: string|null }[],
  sport_data_details_present: boolean
}
```

### Lap groups

COROS may return separate 1 km, 500 m, 1 mile, interval, and total groups for
one activity. They remain separate to prevent duplicate or incomparable rows.

```text
LapGroup = {
  group_type: number|string|null,
  lap_distance_raw: number|null,
  laps: Lap[]
}

Lap = {
  lap_index: integer,
  provider_metrics: object,
  normalized_metrics: object
}
```

`provider_metrics` contains filtered fields such as `distance`, `time`,
`totalLength`, `avgPace`, `avgSpeedV2`, `avgHr`, `maxHr`, `elevGain`, and
sport-specific fields returned by the selected sport type. It excludes
coordinates, route URLs, raw sensor streams, and export payloads.

`normalized_metrics` is deliberately sparse. It may contain verified values
such as `distance_m`, `duration_sec`, `average_heart_rate_bpm`,
`elevation_gain_m`, and the sport-specific pace/speed fields. An unverified
provider field remains in `provider_metrics` and is not silently converted.

## Observed field catalog v1

| Field family | Observed source fields | Archive treatment |
|---|---|---|
| Identity | `labelId`, `sportType`, `startTimestamp`, `endTimestamp` | Stable envelope and provenance |
| Time | `time`, `totalLength` | Preserve provider value; normalize to seconds only when the field catalog confirms the row shape |
| Distance | `distance`, `lapDistance` | Preserve raw value and group identity; normalized meters require the catalog conversion |
| Heart rate | `avgHr`, `maxHr` | Normalize to BPM when present |
| Running | `avgPace`, `adjustedPace`, cadence, stride, running dynamics | Keep under running metrics; do not apply to cycling or hiking |
| Hiking | `avgSpeedV2`, `vertSpeed`, `elevGain`, `totalDescent` | Keep under hiking metrics; do not treat hiking pace as running pace |
| Cycling | `avgSpeedV2`, `maxSpeed`, `avgPower`, `np`, `iff`, cadence | Keep under cycling metrics with cycling-specific units |
| Optional dynamics | `groundTime`, `groundBalance`, `strideRatio`, `strideHeight`, `formPower`, `legStiffness`, `bodyTemperature` | Provider metrics only until units and semantics are verified |

The bridge forwards upstream responses without guaranteeing a stable provider
schema. Therefore, adding a new normalized field requires a catalog update and
new `field_catalog_version`; it is not inferred from a similarly named field.

## FIT trajectory evidence

The FIT sidecar is provider evidence, not a stable COROS API schema. For route
matching, the observed record messages expose timestamped
`position_lat`/`position_long` points and may also expose `distance`,
`altitude`/`enhanced_altitude`, `speed`/`enhanced_speed`, heart rate, cadence,
and power. Session and lap messages provide activity boundaries. FIT protocol
definitions and developer fields must be parsed from each file; readers must
not assume that every activity has the same fields or sampling rate.

Route matching is a derived analysis result. The v1 matcher reads GPS points
and cumulative distance from FIT, then compares the first point and an early
trajectory anchor with the configured forward/reverse reference signatures and
the activity with the total-distance range. The default early anchor is the
point around 200 m after the activity start. It returns `matched`, `ambiguous`,
or `unmatched`, plus `route_key` and the activity-level
`route_direction` only for a unique match. `labelId` remains an activity key.

The standalone matcher indexes route distance ranges in coarse 1 km buckets
before checking the configured spatial signatures. It accepts a normalized points JSON document
so FIT decoding remains a separate provider-file concern:

```text
ActivityPoints = {
  sport_type: integer|null,
  distance_m: number|null,
  points: [{ lat: number, lon: number, distance_m: number|null }]
}
```

For an eligible `unmatched` activity, the result may include:

```text
RouteRegistrationProposal = {
  sport_types: integer[]|absent,
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
}
```

The sync flow asks the Athlete for the route name before persisting this
proposal. The first observed endpoint plus the point around 200 m later form
`forward`; the last endpoint plus the point around 200 m before the finish
form `reverse`. The initial distance range uses a 10% tolerance.
`ambiguous` results have no registration proposal.

Its route registry is `config/routes.json` and its implementation is
[`route-matcher.mjs`](../../skills/workout/scripts/route-matcher.mjs). The
program has no network or archive write side effect.

## Weekly Markdown

Every `weekly/YYYY-Www.md` includes:

```yaml
kind: training-week
schema_version: 1
week: 2026-W33
timezone: Asia/Shanghai
analysis_as_of: 2026-08-23T09:00:00+08:00
daily_inputs: []
```

The body separates source facts, derived comparisons, hypotheses, and
recommendations. A weekly note is generated only by an explicit manual
analysis request.

## Compatibility

Readers must preserve unrecognized provider metric names inside
`provider_metrics` and ignore unknown additive envelope fields. A change to a
stable field's meaning, type, unit, or relationship requires a new archive
schema version.
