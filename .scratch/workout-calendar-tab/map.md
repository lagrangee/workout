# Design the Calendar tab

Label: wayfinder:map
Status: resolved

## Destination

Produce a human-confirmed, implementation-ready product and technical contract for replacing the read-only weekly Plan tab with a date-browsable Calendar tab. The Calendar must let an Athlete browse a week, see each day's scheduled training content, inspect any past date's completion state, and reach an existing Session correction flow without changing the underlying plan or Session rules.

## Notes

- This is a planning effort only. Do not implement or deploy the Calendar within this map.
- Read `CONTEXT.md` and the relevant existing MVP decisions before working a ticket, especially `01`, `02`, `04`, `07`, `10`, and `17`.
- Use `/grilling` and `/domain-modeling` for product and domain decisions, and `/prototype` for the mobile interaction decision. No external research is currently expected.
- Confirmed human direction: the tab is named `日历`; the primary browsing unit is a week with previous/next navigation and a return-to-today action; each day shows a summary and opens a single-day detail; Calendar history is read-only in-place with a secondary path to Session correction.
- The Plan Update Package and future plan updates remain in Settings. Starting or skipping a Scheduled Workout remains today-only. Rest Days create no Session and no-plan dates remain distinct.
- Preserve unrelated user changes already present in the checkout.

## Decisions so far

<!-- One linked gist per resolved child ticket. -->

- [Define Calendar date and status semantics](issues/01-define-calendar-date-and-status-semantics.md) — Browse from the first effective plan date through arbitrary future dates; preserve existing Athlete-local schedule and Session states, with historical prescriptions and immutable Session snapshots kept distinct.
- [Define the Calendar and Today boundary](issues/02-define-calendar-and-today-boundary.md) — Today remains the sole execution surface; 日历 replaces 计划 as a read/inspection tab with current-week default selection, no execution links, and no reverse navigation entry from Today.
- [Define single-day detail and history actions](issues/03-define-single-day-detail-and-history-actions.md) — Single-day detail exposes the complete prescription and Session completion evidence; Calendar remains read-only, with correction available only as a secondary entry for existing historical Sessions.
- [Reconcile the Calendar read contract](issues/04-reconcile-calendar-read-contract.md) — Reuse schedule, Session summary, and Session detail reads; join plan and execution facts by `session_key`, expand prescriptions only for day detail, and keep UI/API date bounds explicit.
- [Prototype the mobile Calendar week and day detail](issues/05-prototype-mobile-calendar-week-and-day-detail.md) — Human accepted Variant B: a compact seven-day selector leading to a selected-day detail panel, with status distinctions and historical correction discovery; the full A/B/C source is captured on the throwaway prototype branch.
- [Review the implementation-ready Calendar handoff](issues/06-review-calendar-implementation-handoff.md) — Human confirmed the Calendar contract and acceptance evidence are implementation-ready; implementation and deployment remain outside this map.

## Not yet specified

None. The map is complete; implementation is the next separate handoff.

## Out of scope

- Manual plan editing, plan builders, or moving the Plan Update Package flow out of Settings.
- Creating Sessions for past or future dates, ad-hoc training, new Session statuses, or changing Session correction rules.
- Progress metric redesign, Coach Share/API redesign, Athlete Export redesign, offline behavior, or deployment work.
