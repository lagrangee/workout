# Review the implementation-ready Calendar handoff

Type: grilling
Status: resolved
Label: wayfinder:grilling
Blocked by: 02, 03, 04, 05

## Question

Do the Calendar product decision, domain semantics, read contract, mobile interaction, and acceptance criteria form one internally consistent implementation handoff? Confirm that the rename to 日历, weekly browsing, daily content visibility, arbitrary past-date completion inspection, and existing Session/Plan boundaries are all explicit and testable.

## Answer

Yes. The Calendar handoff is implementation-ready within this map's scope.

The accepted contract is:

- Navigation is `今日 | 日历 | 进展 | 设置`; 今日 is the only execution surface, while 日历 is browse/inspection/correction discovery and plan updates remain in Settings.
- Calendar uses accepted Prototype B: a seven-day selector with the current Athlete-local week and today selected by default, week navigation, and a selected-day detail panel.
- The UI starts at the first effective plan date, allows arbitrary future browsing, and keeps future dates read-only.
- Single-day detail shows the complete prescription and, when present, Session status, completion fraction, actual values, unfinished items, and a secondary correction entry for historical completed, partial, or skipped Sessions. Calendar provides no start, continue, skip, or other execution actions.
- The read contract reuses schedule summary, Session summary, prescription expansion, and Session detail reads. Schedule owns dated plan facts; Session owns execution facts. The existing unconditional prescription/ignored `expand` behavior is an implementation contract-drift correction, not a new product decision.

Acceptance evidence for implementation must cover the seven-day B interaction, current-week default selection, date/revision boundaries, all Calendar status states, read-only execution boundaries, historical correction discovery, no-plan versus Rest Day, and cross-Athlete isolation. This map does not authorize implementation or deployment; those are a separate handoff.
