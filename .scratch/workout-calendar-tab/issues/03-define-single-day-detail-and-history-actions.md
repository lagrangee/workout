# Define single-day detail and history actions

Type: grilling
Status: resolved
Label: wayfinder:grilling
Blocked by: 01

## Question

What must the single-day detail show for the scheduled prescription and actual completion record, and which actions are available for each date state? In particular, define the read-only historical view, the secondary entry to correct an existing Session, the today-only start/skip/continue actions, and the treatment of Rest Day, no-plan, future, overdue-unstarted, partial, completed, and skipped dates.

## Answer

The single-day detail shows the complete prescribed content for the selected date, not just the week-summary excerpt: date and weekday, workout title and estimated duration, then modules with exercises, sets, targets, resistance, and rest. The underlying read retains plan revision/source provenance, but the Calendar UI does not render that technical metadata. Rest Day and no-plan use distinct empty states.

When a Session exists, the detail shows its status, completion fraction, completed and unfinished item counts, and an expandable item-level view. Actual values are shown beside prescribed values, with differences made clear. A partial Session lists unfinished items. A skipped Session shows its skip reason when present. A past workout without a Session remains `overdue_unstarted` and does not receive a synthetic record.

Historical Session details are read-only in the Calendar itself. For completed, partial, and skipped Sessions, the read-only record exposes a secondary `校正记录` entry into the existing correction flow. No correction entry appears for an overdue date without a Session.

Calendar day details are read-only for today and future dates: they provide no start, continue, skip, or other execution action. Training execution remains exclusively in the 今日 tab. Rest Day and no-plan dates have no training actions and are excluded from completion failure.
