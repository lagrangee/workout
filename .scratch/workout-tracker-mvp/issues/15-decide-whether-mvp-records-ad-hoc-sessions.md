# Decide whether the MVP records ad-hoc Sessions

Type: grilling
Status: resolved

## Question

Should MVP remain a strict plan-adherence tracker where every Workout Session executes or skips a Scheduled Workout, or should it also record unscheduled micro-workouts, substitutions, travel sessions, and other ad-hoc training—and how would either choice affect completion, streak, progress, and mobile execution semantics?

## Answer

MVP remains a strict plan-adherence tracker. Every Workout Session executes or explicitly skips exactly one Scheduled Workout; an Athlete cannot create an ad-hoc Session. Spontaneous training on a Rest Day or no-plan day is not recorded in the App and never appears in history, Coach Share, Athlete Export, or progress.

Structured Actual Training Data is limited to the Completion Items and exercises in the Session's immutable Training Plan Snapshot. The Athlete may adjust actual values for prescribed work, but cannot add an unprescribed exercise or mislabel a substituted exercise as the prescribed one. If a prescribed exercise is replaced, its Completion Items remain incomplete and the substitution may be described in the session-level note. Extra work performed during an open Training Interval may also be mentioned only in that note; the Session's interval-derived training duration naturally includes that time.

Completion percentage, Completion Rate, Training Streak, Strength Training Days, exercise progress, and all other derived metrics use only the prescribed work represented by Scheduled Workouts and their Sessions. Unrecorded plan-free training cannot compensate for a skipped, partial, or overdue Scheduled Workout.

The mobile execution flow therefore has no “free workout,” “add exercise,” “copy as temporary workout,” or equivalent entry point. It presents only today's Scheduled Workout and its snapshotted prescription.

## Comments

- Human decision: MVP records only execution or explicit skipping of a Scheduled Workout. A spontaneous workout on a Rest Day or no-plan day creates no Workout Session and does not enter App history or progress.

- Human decision: substitutions and extra exercises cannot be added as structured Actual Training Data. They may be described in the session-level note, while prescribed Completion Items and all derived metrics retain their strict meanings.

- Surfaced by external review of the Coach Agent API. The reviewer recommends ad-hoc Sessions, but this would expand the confirmed domain in which every Workout Session belongs to a Scheduled Workout, so it requires an explicit product decision rather than automatic adoption.
