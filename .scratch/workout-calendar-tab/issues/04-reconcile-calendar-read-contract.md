# Reconcile the Calendar read contract

Type: grilling
Status: resolved
Label: wayfinder:grilling
Blocked by: 01, 03

## Question

What stable private read shape should power the week summary and single-day detail? Reconcile the existing dated schedule, Today, Session index, and Session detail reads; decide the date bounds, revision/source references, Session summary fields, and whether the Calendar needs a new composed read or can reuse existing contracts without leaking implementation-only state.

## Answer

The Calendar reuses the existing private read contracts rather than introducing a second `/api/private/calendar` truth. A week loads a seven-day `/api/private/schedule` summary and a matching `/api/private/sessions` summary range. Selecting a day loads the complete prescription for that date and, when `session_key` exists, `/api/private/sessions/:session_key` for the immutable Session Snapshot and actual results.

Schedule remains authoritative for the dated Scheduled Workout projection: date, weekday, kind, plan revision/source, prescription reference, and due/overdue flags. Session summary remains authoritative for execution state, completion fraction, RPE, duration, and update time. The Calendar view model joins the two by `session_key` without copying Session status into Scheduled Workout.

The schedule contract is summary-first. The default response does not need a full prescription; `expand=prescription` returns the complete prescription inline on the matching entry for single-day detail. The current implementation's unconditional inline prescription and ignored `expand` parameter are contract drift to reconcile during implementation.

Calendar navigation starts at the first effective plan date and the UI prevents browsing earlier dates. The API may still return `no_plan` for an explicitly requested pre-plan range. Schedule requests remain bounded to at most 366 inclusive days; Calendar requests are normally seven days, with a one-day expanded read for detail.
