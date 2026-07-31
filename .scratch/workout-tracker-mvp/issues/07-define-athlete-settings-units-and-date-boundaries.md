# Define Athlete settings, units, and date boundaries

Type: grilling
Status: resolved

## Question

Which settings belong to each Athlete, how are load, distance, elevation, incline, pace, and time-zone units stored and displayed, and when does a Scheduled Workout become today or overdue?

## Comments

- Human decision: distance, elevation, and pace remain watch-owned Endurance Telemetry and have no Athlete settings or actual-data fields in the App. Run prescriptions retain duration, target RPE, and Completion Items; Sessions retain completion, overall duration, Session RPE, and notes.
- Human decision: treadmill prescriptions may contain an optional structured `target_incline_percent`; percent is the sole unit, no Athlete incline-unit setting exists, and actual incline is not recorded.
- Human decision: all numeric strength load is fixed to kilograms. There is no load-unit setting or per-value unit field; an unloaded or bodyweight exercise has no load value, and equipment load is recorded only when it can be expressed in kg.
- Human decision: the only Athlete-editable settings are `display_name` and an IANA `timezone`. Login email is read-only identity; language follows the browser; weeks start Monday; units are fixed; and scheduled training time belongs to the Weekly Template.
- Human decision: strength Resistance uses only `bodyweight`, `external_weight`, or `assisted_weight`. Numeric `load_kg` is always kg per implement; `quantity` represents multiple equal implements such as two dumbbells. No lb, machine-level, band-grade, or custom resistance values are supported.
- Human decision: a Workout Session snapshots `timezone_at_session`, keeps immutable `scheduled_date`, and stores actual instants in UTC. Changing Athlete timezone immediately affects current/future date boundaries and later Sessions, but never relabels or rebuckets historical Sessions or metrics.
- Human decision: today is the current Athlete-timezone local date. An unstarted workout is not due during its date; start or skip makes it due immediately, while local midnight after that date makes an unstarted occurrence `overdue_unstarted` with zero completion. Scheduled start time is display-only and never causes intraday overdue state.
- Human decision: `display_name` is trimmed, required, 1–50 characters, and not unique; it initially uses the login email local part. Timezone is required, must be a valid IANA name, and initially defaults to `Asia/Shanghai`.
- Human decision: timezone may change while a Session is in progress because that Session retains its snapshot. A change is rejected if the effective Plan Revision for the current instant would differ between the current and proposed timezones.
- Human decision: Resistance trends remain separate by mode. Bodyweight has no load value; external weight exposes per-implement kg, quantity, and total external kg; assisted weight exposes assistance kg, where lower means less assistance. The App produces no combined or cross-mode highest-load metric.

## Answer

Athlete Settings contain only a trimmed, non-unique 1–50 character `display_name` and a required valid IANA `timezone`; initial values are the allowlisted email local part and `Asia/Shanghai`. Login email is read-only identity, language follows the browser, weeks begin Monday, and training time belongs to the Weekly Template.

Distance, elevation, pace, and their units remain outside the App with watch-owned Endurance Telemetry. Treadmill prescription may carry `target_incline_percent`, but actual incline is not recorded. Strength Resistance is limited to bodyweight, external weight, and assisted weight. Numeric resistance is kg per implement with quantity; no unit setting or alternate/custom unit exists, and progress never compares different resistance modes.

Today and due-state calculations use the Athlete's current timezone, not the device timezone. An unstarted workout remains not due throughout its scheduled date; start or skip makes it due immediately, and the next local midnight makes an unstarted occurrence overdue with zero completion. Start time is display-only.

Every Session preserves immutable `scheduled_date` and `timezone_at_session`, while actual instants are UTC. Timezone changes affect current and future boundaries but never relabel historical records or metrics. A change remains allowed during an active Session but is rejected when it would select a different effective revision for the current instant, preventing either a premature roll-forward or a rollback.
