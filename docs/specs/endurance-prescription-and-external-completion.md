# Endurance Prescription and External Completion

## Problem Statement

The Athlete cannot use Workout as a clear source of endurance intent without also being forced through an in-app countdown and a synthetic duration result. Running prescriptions currently expose seconds and omit structured distance, heart-rate-zone, and treadmill-incline requirements. Route-oriented COROS recording intent avoids the timer, but it hides the full prescription and cannot represent an Athlete who records with Apple Watch or with no device.

## Solution

Workout will treat endurance work as an externally performed prescription. The Today surface will show the complete endurance requirements in human units, will not start the standard Session timer, and will let the Athlete explicitly mark an endurance exercise occurrence complete with a declared recording source of COROS, Apple Watch, or none. That declaration will create or update a real Workout Session with a frozen Training Plan Snapshot and mark only the selected endurance occurrence complete. It will not invent watch telemetry, Training Intervals, strength results, or completion for core and foot-strength work that may share the Scheduled Workout.

Canonical endurance prescriptions will retain exact duration internally while adding optional structured distance, heart-rate-zone, and incline requirements. Every user-facing endurance duration will be rendered in integer minutes. Provider Recording Evidence remains separate from the Athlete's manual completion declaration.

## User Stories

1. As an Athlete, I want a running prescription to show minutes rather than seconds, so that I can understand it at a glance.
2. As an Athlete, I want an endurance prescription to state its heart-rate-zone target, so that I can follow it on either COROS or Apple Watch.
3. As an Athlete, I want a treadmill prescription to state incline as a percentage, so that the intended load is unambiguous.
4. As an Athlete, I want distance to appear only when it is an actual requirement, so that duration and distance do not create conflicting goals.
5. As an Athlete, I want endurance requirements to remain structured plan facts, so that they are not hidden in a title or free-form note.
6. As an Athlete, I want the Today surface to display the complete endurance prescription, so that route-recording status does not replace training intent.
7. As an Athlete, I want endurance work to avoid the Workout countdown, so that my watch remains the execution and telemetry owner.
8. As an Athlete, I want to mark an endurance Scheduled Workout complete manually, so that Workout still records adherence.
9. As an Athlete, I want to select COROS, Apple Watch, or none when completing endurance work, so that the completion record reflects how I recorded it.
10. As an Athlete, I want a source value of none to mean deliberately completed without a device, so that it is distinct from a missing selection.
11. As an Athlete, I want the recording-source declaration to remain separate from provider evidence, so that choosing COROS does not claim an activity was imported.
12. As an Athlete, I want Apple Watch completion to state that telemetry was not imported, so that Workout never invents unavailable data.
13. As an Athlete, I want manual completion to create or update a real Workout Session and freeze the plan snapshot, so that history remains date-canonical and auditable.
14. As an Athlete, I want externally completed endurance occurrences to contain no synthetic Training Interval, actual duration, distance, pace, or heart rate, so that unknown actuals stay unknown.
15. As an Athlete, I want to correct the declared recording source, so that an accidental selection is recoverable.
16. As an Athlete, I want to undo an accidental external completion, so that the Scheduled Workout can return to its unstarted state.
17. As an Athlete, I want later COROS synchronization to display provider evidence alongside my declaration, so that verified evidence enriches rather than rewrites history.
18. As an Athlete, I want Calendar, progress, history, Coach, and Agent reads to recognize an external completion consistently, so that completion status does not depend on the surface.
19. As an operator, I want new canonical plan and session fields to survive D1 reconstruction, so that state hydration cannot silently discard them.
20. As an operator, I want forward-only migrations for the new plan and Session records, so that production deployment remains compatible with the existing release process.
21. As an operator, I want existing strength Session execution to remain unchanged, so that the endurance-specific flow cannot regress timed strength work.
22. As an Agent or Coach reader, I want the distinction between external completion and imported aerobic evidence to be explicit, so that neither is mistaken for the other.
23. As an Athlete, I want a same-day Plan Update to remain possible before any Session exists, so that an unstarted prescription can be corrected without rewriting history.

## Implementation Decisions

- Endurance Telemetry remains watch-owned. Workout stores prescription intent and an Athlete-declared completion source, not imported Apple Watch data or synthetic actual metrics.
- The existing exact duration target remains stored as seconds for compatibility. All Athlete-facing endurance formatters convert exact whole-minute values to integer minutes.
- Prescribed Sets gain optional endurance-only requirements for distance in kilometres, an inclusive heart-rate-zone range, and treadmill incline percentage. Exact-member validation rejects these fields for non-endurance Exercises and rejects invalid ranges or values.
- The Exercise Registry may add independently supported Exercises without embedding any Athlete-specific prescription in source control.
- Training Plan Snapshots freeze every structured endurance requirement so historical Sessions never read mutable Current Plan values.
- The Today surface selects an endurance-specific pre-session presentation from the Exercise Category, not from the presence of COROS Recording Intent. It shows the full prescription and bypasses the standard timer flow.
- Manual external completion is Session-owned, keyed by endurance exercise occurrence, and schema-versioned. It contains an RFC 3339 completion instant and one recording source: `coros`, `apple_watch`, or `none`.
- A private authenticated command completes one endurance occurrence in today's Scheduled Workout atomically. It freezes the current prescription when no Session exists, creates no Training Interval or Set Result, and requires an idempotency key.
- An external completion contributes completion credit only for Completion Items owned by that occurrence without treating prescribed duration as actual duration. Mixed running-plus-core days remain incomplete until the other prescribed work is actually completed.
- A second private authenticated command may update the recording source. Undo removes only the selected external completion; it removes the Session itself only when that Session contains no other external completion, execution interval, result, feedback, or note.
- Manual completion and COROS Recording Evidence are rendered together but remain semantically independent. A declared COROS source does not become `recorded` until provider evidence exists.
- Canonical D1 tables own the new plan requirements and occurrence-keyed external completions. JSON state remains a compatibility projection and cannot be the sole persistence location.
- Canonical rebuild, store dual-write, hydration, exports, Agent reads, Coach reads, Calendar, progress, and archive projections preserve or intentionally omit the new fields according to their existing authority boundaries.
- Strength Session start, pause, resume, timed action, result recording, correction, and ending behavior remain unchanged.
- Athlete-specific dates, routes, loads, volumes, effort feedback, and progression choices are private Plan Update data. They are validated and written through the authenticated application boundary, never committed to source control.
- A same-local-date Plan Update is permitted only while that date has no Session; once a Session snapshot exists, the existing future-only boundary remains in force so history cannot be rewritten.

## Testing Decisions

- Tests assert observable behavior and durable readback rather than private helper implementation.
- The highest behavioral seam is the authenticated private HTTP boundary: completing an endurance occurrence returns a Session with a frozen prescription and occurrence-keyed external completion, persists it canonically, is idempotent, and returns structured failures for unsupported days, sources, occurrences, or conflicting Session state.
- The same boundary verifies mixed-workout completion fractions, update and undo behavior, and the prohibition on erasing normally executed work.
- Existing Plan Update validation and canonical D1 round-trip tests cover structured endurance requirements, category restrictions, Session snapshot freezing, rebuild, and readback.
- Today-page component tests cover complete prescription display, integer-minute formatting, source selection, manual completion, correction, undo, provider-evidence coexistence, Apple Watch's unavailable-telemetry message, and the absence of timer controls.
- Existing timed-strength component and Session lifecycle tests remain the regression seam proving that non-endurance execution is unchanged.
- Calendar, progress, Session history, Agent, Coach, export, and training-archive tests assert the intended external-completion projection at their public read boundaries.
- Migration tests prove forward-only schema application and canonical rebuild compatibility.
- Production acceptance verifies the deployed revision through the public health boundary and performs authenticated read-only checks of the Today projection. It must not create a synthetic completion merely to test production.

## Out of Scope

- Importing Apple Health or Apple Watch telemetry.
- Creating an Endurance Log owned by Workout.
- Inferring actual duration, distance, pace, heart rate, elevation, or route from a manual declaration.
- Choosing or publishing an Athlete's private dated training prescription.
- Automatically generating progression or recovery rules.
- Changing historical Sessions or retroactively rewriting old plan snapshots.
- General Session mutation through the Agent API.

## Further Notes

- The public repository contains only generic product behavior. Athlete-specific Plan Update packages remain private application data and are never copied into a public issue, specification, fixture, or commit.
- Online plan application still requires validation against the live Current Plan, exact confirmation evidence, atomic application, and independent readback.
- The production migration is forward-only. Rollback means deploying compatible code that tolerates the added nullable columns and table, not deleting migration history.
