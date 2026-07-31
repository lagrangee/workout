# Define export scope and schema guarantees

Type: grilling
Status: resolved
Blocked by: 02, 03, 04, 07

## Question

What data must Athlete JSON and CSV exports contain, how are nested plan and session records represented, and what schema-version or compatibility guarantees are required?

## Comments

- Human decision: MVP provides one full-history Athlete JSON download and no CSV or range selector. It includes Athlete Settings, every Plan Revision and Weekly Template, Scheduled Workout history, Workout Sessions, immutable Training Plan Snapshots, latest Actual Training Data, and Exercise Feedback.
- Reconciliation: full history has no retention cutoff, while the one-shot MVP
  delivery path is explicitly bounded to 10,000 Sessions and 20 MiB serialized
  JSON. Exceeding either returns `export_capacity_exceeded` before download;
  later scale requires a resumable export design.
- Human decision: export excludes login and Cloudflare identity, Coach Share secrets and access metadata, internal database IDs, and recomputable progress aggregates. Cross-record relationships use stable export-safe keys. The file is for readable, portable data ownership; MVP provides no restore or database-import workflow.
- Human decision: export uses its own `athlete_export_schema_version: 1`, independently versioned from Plan Update Package and Coach API wire schemas. V1 may add fields and readers must ignore unknown fields; removing or retyping fields, or changing enum, relationship, or existing-field semantics requires a new version.
- Human decision: top-level collections are `athlete`, `plan_revisions`, `scheduled_workouts`, and `sessions`. Each Session nests its Training Plan Snapshot, latest Actual Training Data, and Exercise Feedback. Export-safe relationship keys remain stable across successive exports for that Athlete without exposing database IDs.
- Human decision: the file is UTF-8 JSON named `workout-data-YYYY-MM-DD.json` using the Athlete-local generation date. It is downloaded with `Content-Disposition: attachment` and `Cache-Control: no-store`; generation failure returns an error and never a partial file.
- Human decision: the entire file is one consistency snapshot with `generated_at`, `data_as_of`, Athlete timezone, and collection counts; a concurrent change is wholly included or absent.
- Human decision: dated Scheduled Workouts and Rest Days are exported only through the Athlete's today, including overdue unstarted workouts. No-plan days produce no records and the infinite future remains represented by full Plan Revision history.
- Human decision: every snapshot block, exercise occurrence, and Completion Item has an immutable export-safe key, and Actual Training Data references `completion_item_key` rather than array order, labels, Exercise identity, or set numbers.
- Human decision: local dates use `YYYY-MM-DD`, instants use UTC RFC 3339, Sessions include `timezone_at_session`, optional known values use explicit `null`, and collections are arrays even when empty.

## Answer

MVP exports exactly one authenticated Athlete's entire history as one UTF-8 JSON download; CSV, date filtering, restore, and import are removed. The point-in-time file contains Athlete Settings, all Plan Revisions and Weekly Templates, dated Scheduled Workouts and Rest Days through today, and every Workout Session with nested immutable snapshot, latest actuals, and Exercise Feedback.

The export is privacy-filtered and portable rather than storage-shaped: stable opaque export keys replace internal IDs, nested Actual Training Data explicitly references snapshot Completion Items, and login/Cloudflare identity, Coach Share data, derived metrics, telemetry, symptoms, goals, route context, and coaching output are excluded.

`athlete_export_schema_version: 1` evolves independently. Additive fields are compatible; structural or semantic changes require a new version. The entire file represents one `data_as_of` consistency point, uses explicit date/time/null rules, and is never partially downloaded.

Implementation schema and acceptance contract: [Athlete Export v1](../../../docs/contracts/athlete-export-v1.md).
