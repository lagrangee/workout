# 07 — Build Calendar week browsing with real dated state

**What to build:** Replace the Plan navigation surface with the accepted Calendar B interaction so an authenticated Athlete can browse the current Athlete-local week and adjacent weeks, see all seven dated summaries, and understand each day's plan and execution state without any training-execution controls.

**Blocked by:** None — can start immediately.

**Status:** implemented

- [x] The navigation label is `日历`, and the bottom navigation remains `今日 | 日历 | 进展 | 设置`.
- [x] A newly opened Calendar shows the current Athlete-local week with today selected.
- [x] Previous and next week controls change the seven displayed Athlete-local dates without changing the Today execution surface.
- [x] Each date shows weekday, local date, workout summary, Rest Day, or no-plan state as applicable.
- [x] Workout summaries overlay Session summary state by `session_key` and distinguish future, today's not-due unstarted, in-progress, completed, partial, skipped, and overdue-unstarted.
- [x] Calendar provides no start, continue, restart, skip, record, or end action.
- [x] The implementation reuses the existing schedule and Session summary reads and preserves current Athlete isolation.
- [x] Automated coverage verifies the seven-day projection, current-week default, revision/timezone boundaries, status overlay, and two-Athlete isolation.
