# Define Calendar date and status semantics

Type: grilling
Status: resolved
Label: wayfinder:grilling

## Question

Which Athlete-local dates can the Calendar browse, which Plan Revision supplies each date's Scheduled Workout, and how must future, current, and past states combine with workout, Rest Day, no-plan, and Workout Session statuses? The answer must make “任何过去一天” precise, preserve immutable historical Session dates, and distinguish not-due, overdue-unstarted, in-progress, completed, partial, and skipped without inventing a second status model.

## Answer

The Calendar browses every Athlete-local date from the first effective `Plan Revision.effective_from` onward. Dates before that point are outside the Calendar range. The product supports arbitrary future dates after that start; individual reads may still apply a bounded query span for transport and rendering safety.

Calendar presentation reuses the existing domain state rather than inventing a Calendar-specific status model:

- A future workout is scheduled and awaiting training.
- An unstarted workout on today remains not due until started or skipped.
- A current Session is in progress.
- A past unstarted workout is `overdue_unstarted` and contributes zero completion.
- A Session may be `completed`, `partial`, or `skipped`.
- A Rest Day is neutral and creates no Session.
- A no-plan date is distinct from Rest Day and creates no Scheduled Workout.

For each date, the prescribed content comes from the Plan Revision effective on that Athlete-local date. If a Session exists, its immutable `Training Plan Snapshot` remains the source for the recorded execution; later plan revisions never rewrite historical dates or snapshots. Rest Day and no-plan are both excluded from completion failure, while remaining visibly distinct in the Calendar.
