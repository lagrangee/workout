---
name: workout
description: Workout and multi-source training data: use when the user asks to sync or analyze local training archive data, read Workout or COROS training evidence, inspect a plan or completed sessions, review exercise history, or propose, validate, or apply a future plan change.
---

# Workout Agent

Use the typed Workout MCP tools as the Workout data boundary and the COROS MCP
tools as the aerobic telemetry boundary. A local Training Archive is a derived,
read-optimized context layer: load it first for historical analysis, but never
let it outrank a live authoritative source. Keep every read bounded and
evidence-led; let the Agent choose the analysis structure, tone, and
recommendation style for the question.

## Process

1. **Scope the request.** Choose the smallest resource that answers the
   question. Use `workout_get_overview` for a bounded orientation,
   `workout_get_plan` for prescribed templates, `workout_get_schedule` for an
   explicit date window, `workout_list_sessions` for history indexes,
   `workout_get_session` for one complete record, `workout_get_progress` for
   metric evidence, and `workout_get_exercise_history` for movement-level
   trends. Use the bounded defaults for overview, progress, and exercise
   history; use `all` only when the user asks for full history. Completion:
   the request has one selected typed read tool, every required date argument
   is known, and the connected MCP identity supplies the data owner.

2. **Read a bounded slice.** Give `workout_get_schedule` an explicit
   inclusive date range in the Athlete's local timezone. Give
   `workout_list_sessions` a bounded `limit`; carry an opaque cursor forward
   only with the same filters. Request another page when the evidence needs
   it, and restart from page one when the response reports a
   `training_version` change. Completion: the returned records cover the
   requested slice, or the API has returned a structured boundary error.

3. **Keep evidence attached.** Preserve `data_as_of`, Athlete-local period or
   date context, `training_version` when present, `source_ref`, metric
   numerator/denominator/exclusions, and contributing Session references.
   Treat the returned values as the source for domain metrics and state the
   freshness or coverage limit when it affects the answer. Completion: every
   material claim can be traced to returned data and its safe provenance.

4. **Choose the analysis.** Present the evidence in the form that best fits
   the user's question. The integration supplies structured data and
   provenance; the Agent owns the analysis structure, tone, and
   recommendation style. Completion: the response format serves the question
   without turning a hypothesis into a recorded fact or hiding a coverage
   limit.

## Local archive routing

A1. **Load local historical context first.** For historical analysis and manual
   weekly review, read the bounded date/week slice under the locally configured
   `WORKOUT_ARCHIVE_DIR` before querying live sources. Use a local record only
   when its archive `schema_version`, Athlete-local date, source status, and
   `data_as_of` are present. A local value is context, not authority.

A2. **Refresh selectively.** Query live Workout when the request concerns the
   Current Plan, today's or an unarchived Session, a plan write, a missing or
   partial local Workout record, or an explicit refresh. Query live COROS when
   the request concerns latest activity, current recovery/load, today, a
   missing or partial aerobic record, or an explicit refresh. A live value wins
   when it conflicts with the local archive. Ordinary analysis reads do not
   write local files. The explicit `sync data` operation also publishes the
   safe D1 projection through the authenticated Workout application boundary;
   ordinary analysis reads never do either write.

## Manual `sync data`

`sync data` is an explicit read-then-write operation. It is the only operation
in this Skill that writes the local Training Archive.

S1. **Resolve the target date.** With no date, use the previous Athlete-local
date. Accept one explicit local date for a re-run or backfill. A user may supply
`route_key` as an explicit label, but `route_direction` is derived from the
activity's GPS start and early trajectory. After a usable COROS FIT is archived,
sync automatically runs route matching and completes any user-confirmed
new-route registration.

S2. **Read the Workout slice.** Call `workout_get_schedule` for the exact
   inclusive target date. If the returned entry has a Session reference, call
   `workout_get_session` for that Session. Preserve the schedule/session
   `source_ref`, `data_as_of`, `training_version`, Session references, status,
   actual results, RPE, notes, and correction freshness.

S3. **Read the aerobic COROS slice.** Call `querySportRecords` for the exact
target date with the v1 aerobic sport codes `[100, 101, 102, 104, 200]`.
For every returned activity, call `getActivityDetail` and
`queryActivityLapData`, then call `downloadActivityFitFiles` with the same
`labelId` and `sportType`. Keep the `labelId` as `activity_ref` and preserve
`sportType`, timestamps, summary provenance, lap-group identity, and the
sanitized provider fields described by
[`training-archive-wire-catalog-v1.md`](../../docs/contracts/training-archive-wire-catalog-v1.md).
Validate the returned FIT resource signature and write its decoded bytes
byte-for-byte; do not treat the MCP response envelope as the FIT file.
COROS Strength and unrecognized sport types are outside this sync scope and
are reported as ignored rather than converted into aerobic data.

S4. **Write an idempotent archive receipt.** Write one
`daily/YYYY-MM-DD.md` and one
`data/coros/YYYY-MM-DD-<activity_ref>.json` plus one
`data/coros/YYYY-MM-DD-<activity_ref>.fit` per in-scope activity below the
configured archive root. Re-running a date replaces the same date/activity
artifacts and updates `captured_at`, `updated_at`, and `data_as_of`; it does
not create duplicate records. Return target date, source statuses, written
paths, record counts, FIT byte counts, ignored sport types, and structured
errors. If summary/lap reads succeed but FIT download fails, mark COROS
`partial`, retain the JSON artifact, and leave an explicit FIT error for retry.

After the FIT sidecar is available, invoke the route matcher for each COROS
activity. A unique `matched` result writes its `route_key` and
`route_direction` into the same activity JSON and daily note. An
`unmatched` result with a registration proposal pauses for the user's route
name; after the name is supplied, append the proposal to
`config/routes.json`, mark the current activity as `route_direction: forward`,
and write its new `route_key`. The proposal contains a start point and an
approximately 200 m anchor for each entry direction; it does not make
direction an intrinsic property of the route. If the supplied name already
exists, treat it as an explicit request to extend that route rather than
silently creating a duplicate. A short or GPS-incomplete activity remains
unmatched without a name prompt. Include route outcomes and any pending name in
the sync receipt.

S4b. **Publish the safe cloud projection inside the same operation.** After a
successful local write, send the projection through the authenticated Workout
application request boundary used by `createAerobicProjectionPublisher`. Do
not ask the Athlete to run a second publish command. Keep local success when
the cloud stage fails, record both statuses in the one receipt, and let the
next `sync data` run retry the pending safe projection. The logical
`publication_key` identifies the date; the request idempotency key also
includes the exact projection body so a same-date refresh can update D1
without an idempotency collision. The cloud payload contains no FIT bytes,
GPS points, high-frequency telemetry, or local paths.

The publisher must receive the normal authenticated application fetch
boundary. `credentials: "include"` preserves a browser session; it does not
create a session for a bare Node fetch. A local runner without that boundary
must record a cloud error and retain the local archive, never return a fake
cloud success. When the application boundary is available, it is still one
`sync data` operation and uses the same receipt.

S5. **Keep daily output factual.** Daily notes contain source facts and
transparent derived summaries. Do not generate daily coaching analysis as
part of sync. A separate manual weekly analysis may read the daily notes and
COROS detail files and write `weekly/YYYY-Www.md` with `analysis_as_of`.

### FIT-backed route matching

During sync, decode the FIT record messages into normalized GPS points and
invoke the standalone
[`route-matcher.mjs`](scripts/route-matcher.mjs) program. The route registry is
the local `config/routes.json`; each configured route may define separate
`forward` and `reverse` spatial reference signatures and a total-distance
range. A signature contains a start point and an anchor around 200 m along the
route. The route itself remains direction-agnostic.

The same program may be invoked independently for a manual re-match, but sync
is the normal route-assignment entry point.

The command interface is
`node skills/workout/scripts/route-matcher.mjs --routes <routes.json> --points <activity-points.json>`;
the program prints one JSON result to stdout and does not write the archive.
The normalized input shape is defined in
[`training-archive-wire-catalog-v1.md`](../../docs/contracts/training-archive-wire-catalog-v1.md).

The matcher first uses a coarse 1 km bucket on `distance_range_km`, then applies
the exact total-distance range, first-point GPS radius, and early-anchor GPS
checks. This keeps spatial comparisons limited to distance-compatible routes;
routes without a distance range remain the explicit fallback set. The default
anchor is 200 m from the activity start, which is sufficient for the simple
route fingerprint used by v1.
It returns `matched`, `ambiguous`, or `unmatched`. A unique match supplies both
`route_key` and `route_direction`; sync writes them. An `unmatched` result for
an activity with at least 1 km and two valid endpoints supplies a registration
proposal; sync asks for a name, seeds each direction with its endpoint plus an
approximately 200 m anchor, applies a 10% initial distance tolerance, then
writes the registry and activity assignment. An `ambiguous` result never
creates a new route; sync asks the user to choose an existing route. The
matcher itself has no network or archive write side effect, so only the sync
continuation persists a confirmed name. The full FIT sidecar remains the
fallback for later analysis.

Sync status is `complete`, `none`, `partial`, or `error`. A successful source
with no in-scope record is `none`; missing metrics remain `null` or absent and
are never represented as zero. One source error does not erase a successful
result from the other source, and a partial artifact remains visibly partial
for a later retry.

5. **Build a future change from the Current Plan.** When the user asks to
   change a future plan, read `workout_get_plan` first. Preserve existing
   values deliberately for unspecified slots and ask a clarifying question
   for any value required by a new or changed prescription. Construct a
   complete seven-day Plan Update Package using the canonical contract.
   Completion: a complete package exists, or the missing user decision is
   explicit and the flow remains at clarification.

6. **Validate before showing a proposal.** Call
   `workout_validate_plan_update` with the complete package. For a valid
   result, show the effective date, changed-slot summary, complete resulting
   week, and the returned package/base evidence. Treat validation as
   non-mutating. Completion: a valid preview and its digests are ready for
   user review, or the structured validation errors identify what must be
   repaired.

7. **Separate confirmation from application.** Show the validated preview
   before asking for confirmation. A separate, explicit confirmation that
   refers to that preview is the gate; then call `workout_apply_plan_update`
   with the exact validated package, the same `package_digest` and
   `base_plan_digest` returned by validation, `confirmed: true`, and a fresh
   idempotency key.
   Completion: the user has either confirmed the exact preview or declined or
   changed it, in which case the package returns to validation.

8. **Verify the write.** After an application response, inspect its readback.
   Treat the change as verified only when the readback status is verified and
   the returned Current Plan and inclusive seven-day Schedule correspond to
   the applied effective date and package. A stale-plan response starts a new
   read-first cycle; a readback failure is reported as a readback failure and
   is never converted into an unverified success. Completion: the final
   report distinguishes applied, verified, and failed-readback states.

## Credential and error boundary

Use the local MCP configuration as the sole source of connection credentials.
Keep credentials out of chat, prompts, examples, logs, source references, and
analysis. When authentication or transport setup fails, report the local
configuration action required and continue without requesting the credential
value in conversation.

Route structured API errors by their meaning: ask for missing information on
 invalid input, restart the same bounded traversal on `invalid_cursor`, and
 restart the read-first flow on stale state or a training version change.
 Return to the preview/confirmation step for `confirmation_required`, surface
 `idempotency_conflict` without retrying under the same key, and report
 `unsupported_operation` as outside this integration. Surface rate-limit or
 server failures with their stable code. Workout and COROS reads remain
 side-effect-free; local archive writes occur only inside an explicit `sync
 data` operation. Its local archive and safe D1 publication are one user
 visible receipt; there is no separate cloud publish command. Workout plan
 application remains the only source-data write branch.

Route Session lifecycle or correction requests, account-settings changes, and
share-management requests to the unsupported-operation path. The integration
 exposes no typed tool for those mutations, so the request remains outside the
 write flow.

## Canonical references

Load the canonical domain vocabulary when a term is unclear:
[`CONTEXT.md`](../../CONTEXT.md).

Load [`agent-api-v1.md`](../../docs/contracts/agent-api-v1.md) when a resource,
error, freshness, pagination, confirmation, or readback rule is unclear. Load
[`agent-api-wire-catalog-v1.md`](../../docs/contracts/agent-api-wire-catalog-v1.md)
when a response shape or provenance field is unclear. Load
[`plan-update-package-v1.md`](../../docs/contracts/plan-update-package-v1.md)
before constructing a package or interpreting a validation error. These
references are the single source of truth for wire and domain details; this
Skill routes the Agent to them without copying their schemas. Load
[`training-archive-v1.md`](../../docs/contracts/training-archive-v1.md) when
sync routing, local freshness, archive paths, or weekly output is relevant.
Load
[`training-archive-wire-catalog-v1.md`](../../docs/contracts/training-archive-wire-catalog-v1.md)
when a daily note, COROS activity archive, lap group, sport-specific metric, or
archive field version is relevant.
