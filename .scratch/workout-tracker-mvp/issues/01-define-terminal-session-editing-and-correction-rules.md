# Define terminal-session editing and correction rules

Type: grilling
Status: resolved

## Question

After a Workout Session becomes completed, partial, or skipped, which actual values, Completion Items, timestamps, notes, and Session Outcome may an Athlete correct, and how must those corrections affect history and progress calculations without changing the prescription snapshot?

## Answer

Actual Training Data remains editable indefinitely after a Workout Session is saved. The Athlete may correct Completion Item checks, actual repetitions or duration, structured Resistance, RIR, Session RPE, notes, Exercise Feedback, and Training Interval start and end timestamps. The Scheduled Workout date, owning Athlete, Scheduled Workout relationship, and Training Plan Snapshot remain immutable. Pain values, Endurance Telemetry, and Body Feedback were removed by later accepted decisions.

Completion percentage and Session Status are derived rather than manually selected. Correcting Completion Items automatically switches `completed` to `partial` below 100 percent and `partial` to `completed` at 100 percent. Each Training Interval end must be later than its start, intervals may not overlap, and `training_duration_sec` is the sum of their durations rather than the wall-clock span from the Session's first start to its final end.

A skipped Session exposes “Restart workout,” not “Undo skip.” Restarting reuses the same Session, changes it to `in_progress`, opens a Training Interval at the current instant, retains the Training Plan Snapshot captured when it was skipped, and clears the skip reason. A Session containing Actual Training Data cannot be changed to `skipped`.

A partial Session scheduled for the Athlete's current local date exposes
“Continue workout.” Continuing reuses the same Session and snapshot, changes it
back to `in_progress`, preserves all recorded results, and opens a new Training
Interval. It may be explicitly ended and continued multiple times that day;
each end closes the current interval and re-derives `partial` or `completed`.
Ordinary record auto-save does not close an interval. A completed Session and a
partial Session from a past Scheduled Workout date cannot continue, though
their Actual Training Data remains correctable.

Corrections do not create an audit history. The latest corrected values are canonical, `updated_at` changes, and Completion Rate, other progress metrics, Coach Shares, and exports recompute from those values immediately.
