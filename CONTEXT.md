# Workout Tracking

This context manages current training plans, workout execution records, and training data for independently authenticated athletes. Training goals, route background, and coaching analysis are outside the context.

## Language

**Athlete**:
An authenticated person who owns an isolated current plan, workout history, training data, and coach shares.
_Avoid_: User, household account, family member

**Athlete Settings**:
The Athlete's editable display name and IANA timezone. Units, language, week start, login identity, and scheduled training times are not Athlete Settings.
_Avoid_: Preferences, profile configuration

**Athlete Export**:
A complete, point-in-time JSON representation of one Athlete's portable plan and training records. It is a readable data-ownership artifact, not a database backup, restore package, or Plan Update Package.
_Avoid_: CSV export, database dump, plan import

**Coach Agent**:
An unauthenticated ChatGPT Agent that uses a Coach Share to discover and read one Athlete's plan and training data.
_Avoid_: Coach Viewer, coach account, administrator

**Coach Share**:
One permanent, read-only bearer capability owned by an Athlete, consisting of a self-describing README endpoint and its linked JSON API. It remains valid until that Athlete revokes or regenerates it, and only one Coach Share may be active per Athlete.
_Avoid_: Coach dashboard, coach login, expiring invitation

**Current Plan**:
The sole plan belonging to one Athlete, consisting of the applicable Weekly Template and internal revision history.
_Avoid_: Plan library, shared plan

**Plan Seed**:
An optional initial Weekly Template assigned to one specific Athlete. It contains no conditional progression rules or coaching instructions and is never copied to another Athlete by default.
_Avoid_: Global default plan, shared template

**Weekly Template**:
The seven weekday slots that repeat indefinitely for one Athlete from a Plan Revision's effective date until superseded. Each slot is explicitly a workout, Rest Day, or no-plan day.
_Avoid_: Dated schedule, multi-week plan, progression program

**Plan Revision**:
An immutable, confirmed replacement of one Athlete's Weekly Template from a specified future date onward. When revision timelines overlap, the later-confirmed revision wins from its own effective date while older revisions remain internal history.
_Avoid_: Edit event, autosave, selectable plan version

**Plan Update Package**:
A schema-versioned JSON value prepared outside the App that proposes one complete Weekly Template and a future effective date. It contains no conditional progression rules or coaching instructions.
_Avoid_: Web plan edit, AI-generated in App, patch request

**Scheduled Workout**:
The deterministic Athlete-local date projection of the Weekly Template applicable on that date. It describes prescribed intent, may be a workout or Rest Day, and never owns execution state.
_Avoid_: Workout record, completed workout

**Calendar**:
The authenticated, read-only date-browsing surface over an Athlete's Scheduled Workouts and Workout Sessions. It starts at the first effective Plan Revision date, reads one Athlete-local week at a time, and joins Session summaries by `session_key`; it never creates or executes a Session. Historical completed, partial, and skipped Sessions may expose the existing correction flow as a secondary action.
_Avoid_: Plan editor, execution surface, synthetic history

**Exercise**:
A planned movement identified across Plan Revisions by an Athlete-scoped stable key. Its display name may change without starting a new exercise history; changing the key creates a distinct Exercise.
_Avoid_: Database ID, display name

**Resistance**:
The structured resistance for a strength prescription or result: bodyweight, external weight, or assisted weight. Numeric resistance is always kg per implement, with quantity expressing multiple equal implements.
_Avoid_: Load unit, machine level, custom resistance

**Prescribed Set**:
One ordered repetitions-or-duration target within an exercise occurrence. It produces one Completion Item when unsided and separate left and right Completion Items when prescribed per side.
_Avoid_: Target set count, result row

**Workout Session**:
One Athlete's actual execution or explicit skip of exactly one Scheduled Workout. It owns the execution lifecycle and all recorded results, preserves the Athlete timezone used to assign its immutable Scheduled Workout date, and is never created for plan-free or ad-hoc training.
_Avoid_: Scheduled Workout status, plan item, free workout

**Training Interval**:
One contiguous span of active training time within a Workout Session. Starting or continuing training opens a new interval, only ending training closes it, and the Session's actual duration is the sum of its closed intervals.
_Avoid_: Workout Session, wall-clock gap, rest countdown

**Training Plan Snapshot**:
An immutable copy of a Scheduled Workout captured when its Workout Session is created by starting or skipping, preserving the exact planned Blocks, exercise occurrences, Prescribed Sets, Completion Items, structured targets, tempo, and rest. Actual results are recorded separately.
_Avoid_: Prescription snapshot, current plan, workout result

**Actual Training Data**:
The Athlete-entered results for prescribed work in a Workout Session, including completion checks, performance values, timestamps, and notes. It cannot add unprescribed exercises; substitutions and extra work may appear only in the session-level note, and the latest corrected values never alter the Training Plan Snapshot.
_Avoid_: Planned target, correction history, free-form exercise log

**Endurance Telemetry**:
Distance, pace, heart rate, elevation, moving time, stopped time, and similar measurements owned by an Athlete's watch. The App neither records nor summarizes this data.
_Avoid_: Endurance Log, watch-data import

**Session Status**:
The sole current execution state of a Workout Session: in-progress, completed only at 100 percent, partial when saved below 100 percent, or skipped only before training starts. Same-day partial and skipped Sessions may return to in-progress without losing their identity or Training Plan Snapshot.
_Avoid_: Separate outcome, manually selected status, Scheduled Workout status

**Rest Day**:
A Scheduled Workout date intentionally containing no training. It creates no Workout Session and is neutral in completion, duration, count, and streak metrics.
_Avoid_: Completed rest session, recovery workout

**Completion Item**:
One independently checkable unit of prescribed work generated from a Prescribed Set: one unsided set or one set-side combination. Block headings and rest periods are not Completion Items.
_Avoid_: Exercise, workout block, logged result

**Completion Rate**:
The average completion percentage of an Athlete's due, non-rest Scheduled Workouts within a stated period. Future and rest workouts are excluded; skipped and overdue unstarted workouts contribute zero.
_Avoid_: Attendance rate, completed-session count

**Training Streak**:
The count of consecutive scheduled training dates completed at 100 percent. Rest Days and no-plan dates are neutral; partial, skipped, and any past-date workout below 100 percent break the streak, while today's in-progress workout remains pending.
_Avoid_: Consecutive calendar days, attendance streak

**Strength Training Day**:
One Athlete-local date on which a completed or partial Workout Session contains at least one completed strength Completion Item. A date counts at most once regardless of the number of strength exercises.
_Avoid_: Strength exercise count, set count

**Session RPE**:
An optional 0-to-10 rating of the Athlete's overall perceived effort for one completed or partial Workout Session. Missing ratings and other Session Statuses are excluded from averages.
_Avoid_: Heart rate, RIR, technique score

**Exercise Feedback**:
One optional free-text observation about one snapshotted exercise occurrence within a Workout Session. It applies across all its sets and sides, is usually absent, and is not a scored body or symptom record.
_Avoid_: Per-set note, Body Feedback, Symptom Log
