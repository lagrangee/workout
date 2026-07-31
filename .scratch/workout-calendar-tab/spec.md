# Calendar tab

Label: ready-for-agent

## Problem Statement

The current Plan tab shows the repeating Weekly Template, but it does not let an Athlete browse the plan as dated days or inspect what happened on a past date. The Athlete cannot see each day's planned training content alongside the completion state of the corresponding Workout Session. The existing Today surface is intentionally focused on executing today's training, so it should not become the historical browsing surface.

## Solution

Replace the Plan tab with a read-only Calendar tab named `日历`. The Calendar opens on the current Athlete-local week with today selected, lets the Athlete move across weeks, and shows a compact summary for each of the seven dates. Selecting a date opens the complete dated prescription and, when a Workout Session exists, its completion evidence.

The accepted mobile interaction is Prototype B: a compact seven-day selector followed by a selected-day detail panel. The Calendar never starts, continues, skips, records, or ends a Workout Session. Today remains the only training-execution surface. Historical Session details remain read-only in Calendar but expose a secondary entry to the existing correction flow. Plan Update Package submission remains in Settings.

## User Stories

1. As an Athlete, I want the navigation label to say `日历`, so that the surface matches my need to browse dated training rather than edit a plan.
2. As an Athlete, I want the Calendar to open on my current Athlete-local week, so that I immediately see the dates relevant to me.
3. As an Athlete, I want today selected when the Calendar opens, so that the current date has a clear starting point without duplicating the Today execution surface.
4. As an Athlete, I want to see all seven weekdays in the selected week, so that I can understand the full weekly rhythm at a glance.
5. As an Athlete, I want to move to the previous or next week, so that I can inspect both history and future planning.
6. As an Athlete, I want the Calendar to begin at the first effective plan date, so that dates before the Athlete had a plan are not presented as meaningful training history.
7. As an Athlete, I want to browse arbitrary future dates after the first effective plan date, so that the repeating Weekly Template and future Plan Revisions remain visible beyond the current week.
8. As an Athlete, I want each day to show its weekday and local date, so that a repeating weekday slot is not confused with a historical dated occurrence.
9. As an Athlete, I want each workout day to show its title, module count, and estimated duration in the weekly summary, so that I can scan the week without opening every date.
10. As an Athlete, I want each day's summary to show whether it is scheduled, in progress, completed, partial, skipped, overdue, a Rest Day, or no-plan, so that the calendar does not hide meaningful state differences.
11. As an Athlete, I want a future workout to be visibly read-only and awaiting training, so that I do not mistake planning information for an executable Session.
12. As an Athlete, I want an unstarted workout on today to remain visibly not due until it is started or skipped in Today, so that Calendar does not redefine the existing due boundary.
13. As an Athlete, I want an in-progress Session to be visible as in progress, so that I can recognize that today's execution already exists without starting another one from Calendar.
14. As an Athlete, I want a completed Session to show its completion state and fraction, so that I can confirm the work recorded for that date.
15. As an Athlete, I want a partial Session to show its completion fraction and unfinished items, so that I can understand exactly what was not recorded.
16. As an Athlete, I want a skipped Session to show that it was intentionally skipped and display its skip reason when one exists, so that a skip is not confused with an overdue unstarted workout.
17. As an Athlete, I want a past workout with no Session to show overdue-unstarted state, so that the Calendar does not fabricate an execution record.
18. As an Athlete, I want Rest Day to be distinct from no-plan, so that intentional recovery is not confused with a missing plan.
19. As an Athlete, I want Rest Day and no-plan dates to remain neutral rather than appear as failed training, so that Calendar presentation agrees with completion metrics.
20. As an Athlete, I want a selected day to show the complete prescription, including blocks, exercises, Prescribed Sets, targets, Resistance, tempo, and rest where present, so that I can see the actual planned content for that date.
21. As an Athlete, I want the selected day's prescription to come from the Plan Revision effective on that Athlete-local date, so that midweek and future plan changes are projected deterministically.
22. As an Athlete, I want a date with a Workout Session to show the immutable Training Plan Snapshot used for that execution, so that later plan changes do not rewrite history.
23. As an Athlete, I want actual values displayed beside prescribed values when a Session exists, so that I can distinguish what was planned from what I recorded.
24. As an Athlete, I want the selected day to show completed and unfinished Completion Items, so that completion evidence is understandable without opening the execution flow.
25. As an Athlete, I want historical completed, partial, and skipped Session details to offer a secondary `校正记录` entry, so that I can correct Actual Training Data without editing the Calendar itself.
26. As an Athlete, I want an overdue date with no Session to have no correction entry, so that there is no record to edit or accidentally create.
27. As an Athlete, I want Calendar to provide no start, continue, skip, record, restart, or end controls, so that Today remains the only execution surface.
28. As an Athlete, I want Today to remain independent of Calendar, so that the execution flow does not gain a reverse Calendar navigation requirement.
29. As an Athlete, I want plan updates to remain in Settings, so that Calendar remains a read-only inspection surface.
30. As an Athlete, I want date and status calculations to use my configured IANA timezone, so that the Calendar agrees with Today and existing Session date boundaries.
31. As an Athlete, I want a future Plan Revision to affect only its effective dates onward, so that past Calendar entries and Session Snapshots remain stable.
32. As an Athlete, I want the Calendar to show only my own schedule and Sessions, so that another Athlete's training data cannot appear in my history.
33. As an Athlete, I want empty, no-plan, and error states to be explicit, so that the Calendar never presents missing data as an empty workout or failed completion.
34. As an implementation agent, I want the Calendar to reuse the existing schedule and Session read contracts, so that there is one source of truth for dated plan facts and execution facts.
35. As an implementation agent, I want the Calendar acceptance scenarios to cover every defined date and Session state, so that a visually plausible weekly view cannot pass while historical semantics are wrong.

## Implementation Decisions

- **Navigation and ownership:** Replace the Plan navigation item with `日历`, producing `今日 | 日历 | 进展 | 设置`. Today remains the only execution surface. Calendar is browse/inspection/correction discovery only. Plan Update Package validation and application remain in Settings.

- **Accepted interaction model:** Use the human-accepted Prototype B structure: a compact seven-day selector with weekday/date and status indicators, followed by the selected day's detail panel. The selected date defaults to today in the current Athlete-local week whenever Calendar is newly opened. Previous/next week controls are available. The prototype is interaction evidence, not production code.

- **Calendar date range:** The Calendar UI begins at the first effective Plan Revision date. Dates before that point are not navigable in the UI. Any future date after that point may be browsed because the Weekly Template repeats indefinitely and future Plan Revisions are date-effective. The schedule read remains bounded to an inclusive maximum of 366 days per request; the Calendar normally requests one week.

- **Athlete-local projection:** For each date, resolve the highest-sequence Plan Revision effective on that date and project the matching weekday slot. The resulting Scheduled Workout may be a workout, Rest Day, or no-plan. The Athlete timezone is the source of local date interpretation.

- **Status ownership:** Scheduled Workout/read-model facts own date, weekday, kind, plan revision/source, prescription, and due/overdue flags. Workout Session facts own Session Status, completion fraction, duration, RPE, skip reason, update time, Actual Training Data, and correction state. The Calendar must not create a second status model or write Session status onto the Scheduled Workout.

- **Status presentation:** Preserve the existing domain states: future scheduled, today's not-due unstarted, in-progress, completed, partial, skipped, overdue-unstarted, Rest Day, and no-plan. Rest Day and no-plan are distinct and neutral. An overdue-unstarted date has no Session and no synthetic completion record.

- **Single-day detail:** Show the complete dated prescription, including plan source, title, estimated duration, Blocks, Exercises, Prescribed Sets, structured Resistance, targets, tempo, and rest. When a Session exists, show its immutable Training Plan Snapshot as the execution prescription and show completion fraction, completed/unfinished item counts, actual values, and applicable note/skip context.

- **Historical correction:** Calendar detail remains read-only. For a historical completed, partial, or skipped Workout Session, expose a secondary `校正记录` entry to the existing Session correction flow. Do not add inline Calendar editing or correction for an overdue date without a Session.

- **Read seam:** Use one Calendar read-model/view composition over the existing authenticated reads rather than adding a new `/api/private/calendar` truth. A week reads the dated schedule summary and the matching Session summary range. A selected day expands its prescription and reads Session detail only when a `session_key` exists. The view model joins plan and execution facts by `session_key`.

- **Schedule interface:** Keep inclusive `from`/`to` local-date semantics and the existing maximum 366-day range. The schedule response is summary-first. `expand=prescription` returns the complete prescription inline for the matching entry, used by single-day detail. The current implementation's unconditional inline `prescription` and ignored `expand` parameter are implementation contract drift to reconcile; they are not a new product decision.

- **Session interfaces:** Reuse the date-filtered Session summary read for the seven-day state overlay and the existing Session detail read for selected-day Snapshot and Actual Training Data. Do not preload seven full Session details for a week.

- **No schema or new persistence:** The feature does not create a Calendar entity, dated plan entity, new Session Status, database table, or persistence record. It projects existing Plan Revisions, Scheduled Workouts, and Workout Sessions.

- **Authentication and isolation:** Every Calendar read remains inside the authenticated Athlete boundary. Schedule, Session summaries, Session details, prescriptions, and correction entry points must be filtered to the current Athlete exactly as existing private reads are.

- **Implementation seam:** The highest useful seam is the authenticated Calendar read model plus the existing private read endpoints. The UI should consume the composed result and keep plan facts separate from Session facts. No lower-level storage seam should become the feature contract.

## Testing Decisions

- Tests verify externally observable behavior and contracts, not helper names, DOM implementation details, or the choice of client-side composition.

- **Dated projection:** Test a seven-day range across a Plan Revision effective-date boundary, including the correct revision per Athlete-local date, weekday projection, source references, first-plan boundary, arbitrary future dates, and the 366-day request limit.

- **State coverage:** Test future workout, today's unstarted workout, in-progress, completed, partial, skipped, overdue-unstarted, Rest Day, and no-plan responses. Assert that Rest Day and no-plan are distinct and neutral, while overdue-unstarted has no Session.

- **Session overlay:** Test joining a schedule entry to its Session summary by `session_key`, preserving Schedule as the plan fact source and Session as the execution fact source. Test completion fraction, unfinished items, actual values, skip reason, and immutable Snapshot behavior after a plan revision.

- **Prescription expansion:** Test summary-first schedule responses and `expand=prescription` single-day responses. The test must catch the current drift where prescription is always returned or `expand` is ignored.

- **Historical correction boundary:** Test that completed, partial, and skipped historical Sessions expose the existing correction path while overdue-unstarted dates do not create or expose a correction record. Test that Calendar reads remain non-mutating.

- **Execution boundary:** Test that Calendar has no start, continue, skip, restart, record, or end behavior and that existing Today-only Session creation rules remain unchanged.

- **Athlete isolation:** Use the existing authenticated handler seams to verify that two Athletes receive only their own dated schedule, Session summaries, Session details, and correction targets.

- **UI acceptance:** Manually verify the accepted Prototype B behavior at the existing mobile width: seven-day selector, current-week/today default, previous/next week navigation, selected-day full detail, every status state, read-only controls, historical correction discovery, and distinct Rest Day/no-plan presentation.

- **Prior art:** Extend the repository's existing boundary, core Session, authentication/isolation, static-asset, and migration/read-model test patterns. Prefer handler-level API tests for contract behavior and a focused manual browser pass for the visual/interaction acceptance that cannot be established by JSON tests alone.

## Out of Scope

- Implementing or deploying the Calendar within this spec-writing step.
- Manual plan editing, plan builders, day/week copy controls, or moving Plan Update Package submission out of Settings.
- Starting, continuing, restarting, skipping, recording, or ending a Workout Session from Calendar.
- Creating Sessions for past or future dates, ad-hoc training, new Session Status values, or changing existing Session correction rules.
- Reworking Completion Rate, Training Streak, training-duration, Strength Training Day, Session RPE, or Exercise Progress semantics.
- Changes to Coach Share/API, Athlete Export, progress views, Athlete Settings, authentication topology, deployment, backups, offline behavior, or persistence architecture.
- A month-grid interaction as a second production Calendar mode. Prototype A and C remain comparison evidence only; B is the accepted direction.
- New coaching, goals, routes, watch-owned Endurance Telemetry, social features, household dashboards, or analytics.

## Further Notes

- This spec is synthesized from the resolved Calendar Wayfinder map and the human-accepted Prototype B. It is a ready-for-agent handoff, not a release or gate-passage claim.
- The throwaway A/B/C prototype was captured on the separate `codex/calendar-prototype-b` branch at commit `b1d7378`; it remains comparison evidence and must not be promoted directly into production.
- The map explicitly preserves the existing Plan, Session, timezone, Rest Day, no-plan, correction, and cross-Athlete boundaries. Implementation should re-read the current checkout before changing any of them.
- The current checkout contains unrelated user changes. An implementation agent must preserve them and must not use this spec as authority to reset, discard, or overwrite those changes.
