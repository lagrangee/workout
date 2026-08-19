# COROS Field Catalog v2

## Authority and scope

This catalog records the COROS provider fields that the local Training Archive
may promote into stable lap metrics. The COROS MCP response remains the source
of truth; this is an explicit adapter contract, not a promise that COROS will
keep its upstream schema unchanged.

The runtime implementation is the existing COROS normalizer in
`src/training-archive.js`, supported by `src/coros-field-catalog.js`. There is
no second COROS parser in the Workout Skill. The Skill describes the boundary;
code performs deterministic normalization and Markdown projection.

## Confirmed trail-run lap fields

The names and display units follow the COROS app lap view supplied for this
archive. COROS `distance` values use 100 m units in the observed response;
`lap_distance_raw` uses the same scale for group labels.

| Provider key | Archive key | Obsidian label | Unit | Markdown table |
|---|---|---|---|---|
| `distance` | `distance_m` | 距离 | m | yes |
| `time` | `duration_sec` | 时间 | sec | yes |
| `totalLength` | `cumulative_duration_sec` | 累计时间 | sec | yes |
| `elevGain` | `elevation_gain_m` | 上升 | m | yes |
| `totalDescent` | `elevation_loss_m` | 下降 | m | yes |
| `avgHr` | `average_heart_rate_bpm` | 平均心率 | bpm | yes |
| `maxHr` | `max_heart_rate_bpm` | 最大心率 | bpm | yes |
| `avgCadence` | `average_cadence_spm` | 步频 | spm | yes |
| `avgStrideLength` | `average_stride_length_cm` | 步幅 | cm | yes |
| `avgPace` | `average_pace_sec_per_km` | 平均配速 | sec/km | yes |
| `adjustedPace` | `adjusted_pace_sec_per_km` | 等效配速 | sec/km | yes |
| `vertSpeed` | `vertical_speed_m_per_h` | 垂直速度 | m/h | yes |
| `avgPower` | `average_power_w` | 跑步功率 | W | yes |

The Markdown renderer formats durations as `m:ss` or `h:mm:ss`, pace as
`m'ss"/km`, distance as metres/kilometres, and quantities with their explicit
unit. Missing values render as `—`; they are not converted to zero.

## Provider-only fields

The following fields are recognized and retained in `provider_metrics`, but
are not promoted into the stable table until their exact unit/semantic catalog
entry is confirmed:

`avgSpeedV2`, `groundTime`, `groundBalance`, `maxCadence`, `strideRatio`,
`strideHeight`, `formPower`, `legStiffness`, and `bodyTemperature`.

An additive provider field not present in either list is retained in the local
JSON and reported in the activity note under `解析提示`. It is not guessed,
silently normalized, or placed in the Markdown table. A structural failure or
missing required source data remains a normal `partial`/`error` source status.

## Projection shape

`field_catalog_version` is `2` for the normalized JSON envelope. The
human-readable Obsidian activity note carries `projection_version: 2` and
renders each COROS lap group as its own Markdown table. The canonical JSON
sidecar remains the complete sanitized provider/normalized record; Markdown is
only its local readable projection.
