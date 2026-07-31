# Define rest days, streaks, and progress metrics

Type: grilling
Status: resolved

## Question

How do rest days, overdue unstarted workouts, skipped sessions, partial sessions, date ranges, and time zones affect streaks and every progress metric beyond the already-defined Completion Rate?

## Answer

A Rest Day is a Scheduled Workout calendar type with no Completion Items and no Workout Session. It requires no “rest completed” action and contributes nothing to Completion Rate, Training Streak, training duration, or training counts. No Rest Day feedback is recorded; a formally tracked walk must instead be a `recovery` Scheduled Workout.

Training Streak is labeled “consecutive completed training days” in the UI. Each 100-percent completed non-rest Scheduled Workout extends it; partial, skipped, and any past-date workout below 100 percent break it; Rest Days and no-plan dates neither extend nor break it. A current-date in-progress Session keeps the prior streak pending until it ends or its date passes.

All reporting uses the Athlete's configured time zone. Today's unstarted Scheduled Workout is not yet due and stays out of Completion Rate. It becomes due immediately when started or skipped, using its current completion percentage, or at the next local midnight as an overdue zero. A past `in_progress` Session contributes its current percentage. Weekly buckets run Monday 00:00 through Sunday 23:59 in the Athlete's time zone regardless of the viewing device's zone.

The Progress page has one range selector—last 7 days, last 30 days, last 12 weeks, or all time—defaulting to last 30 days and using Athlete-local calendar dates. Fixed cards show 7-day Completion Rate, 30-day Completion Rate, and Training Streak. Range-sensitive summaries show total training duration, Strength Training Days, and average Session RPE; weekly trends show Completion Rate and training duration.

A Strength Training Day is one local date with at least one completed strength Completion Item in a completed or partial Session. The date counts once regardless of exercise count. Session RPE is an optional 0-to-10 overall effort rating on completed or partial Sessions; missing values and all other outcomes are excluded from the arithmetic mean. RPE does not represent technique. A failed strength attempt is represented by valid `actual_reps`, `RIR = 0`, Session RPE where useful, unchecked work that was not attempted, and an optional note—never a separate failure status.

Endurance Telemetry belongs to the Athlete's watch and is removed from the App: no distance, pace, heart rate, elevation, moving/stopped time, stop count, EnduranceLog, watch import, or related summary/trend. Run, outdoor, and treadmill prescriptions still appear and produce Completion Items, Session duration, Session RPE, and notes.

Exercise Progress includes the count of Sessions in which the exercise was actually performed; recent per-set repetitions or duration, load, RIR, and side; per-Session total valid repetitions or duration; per-Session highest load; and separate left/right series without a composite balance score. The ambiguous “maximum completed reps” and generic “recent trend” are removed.

Except for Completion Rate's live due-workout behavior, progress metrics use only terminal completed or partial Sessions. In-progress Sessions wait until ending; skipped Sessions contribute no duration, count, RPE, or exercise data. Corrections trigger immediate recomputation.

Recording must not present a grid of empty inputs. Each Completion Item shows its prescription and one primary Complete action. Exact repetitions/duration and target RIR default from the prescription; ranges prefer the previous in-range actual value and otherwise use the lower bound; Resistance prefers the previous same-exercise/same-side/same-mode value and otherwise uses the structured prescribed value or remains unset; notes stay collapsed. Completing accepts defaults, while Adjust reveals only relevant fields.
