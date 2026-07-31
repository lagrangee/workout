# Resolve conditional Plan Seed rules and JSON import semantics

Type: grilling
Status: resolved
Blocked by: 04

## Question

How should the initial eight-week Plan Seed and future JSON imports represent weekly progressions and conditional prescriptions without introducing automatic training advice, and which validation failures must block an import?

## Comments

- Human decision: neither conditional progression rules nor plain-text coaching instructions belong in the App or JSON. The Athlete and ChatGPT/coach resolve those matters outside the App; a Plan Seed or Plan Update Package contains only the resulting, fully determined schedule.
- Human decision: a confirmed Plan Update Package replaces the prior Weekly Template from `effective_from` onward; the new seven-slot template repeats indefinitely until another revision supersedes it.
- Human decision: each weekday slot is explicitly a workout, Rest Day, or `null` no-plan day. Only Rest Day is displayed as planned rest; the App does not infer rest from `null`.
- Human correction: the package contains exactly one Monday-through-Sunday Weekly Template, not an array of dated or contiguous weeks. `effective_from` may fall midweek; earlier dates continue using the prior revision, and the new template applies by weekday from `effective_from`.
- Human decision: every exercise entry carries a required, human-readable, Athlete-scoped `exercise_key`; no database IDs appear in JSON. Reusing the key preserves exercise history across revisions even if its display name changes, while changing the key creates a distinct Exercise.
- Human decision: MVP imports require exactly `schema_version: 1`. A missing or unsupported version blocks the whole import; the App neither guesses nor migrates it and does not produce a confirmable plan preview.
- Human decision: v1 uses strict object schemas. Any unknown field at any level blocks the whole import rather than being silently ignored.
- Human decision: all seven weekday slots are required in the single Weekly Template, using explicit `null` for a no-plan day.
- Human decision: JSON contains no timezone and cannot change Athlete settings. `effective_from` is interpreted in the Athlete's configured timezone and must be strictly later than that Athlete's current local date.
- Human decision: Plan Seed has no date-validation exception. It uses the same v1 package and must take effect tomorrow or later; it creates the first revision only when that Athlete has none and is never reapplied over existing plan data. Only the designated Athlete receives the seed, while the other begins without a plan.
- Human decision: each weekday slot is structurally exclusive. A workout has at least one block and produces at least one Completion Item; a Rest Day contains no workout content; a no-plan slot is literal `null`. Any violation blocks the package.
- Human decision: plan numbers and times use strict JSON types and ranges; the App never coerces, clamps, swaps, or otherwise repairs them. Invalid positive counts or durations, reversed ranges, RPE outside 0–10, negative RIR or rest, malformed `HH:mm` time, or numeric strings block the package.
- Human decision: `exercise_key` is unique within one workout slot. Multiple sets, sides, and Completion Items for that exercise belong to one prescription entry; the same key may recur on other weekdays.
- Human decision: the package contains no Athlete ID, name, or email. It applies only to the Athlete in the authenticated request context; identity is not part of plan JSON.
- Human decision: plan JSON allows only necessary display labels, fixed enums, and structured prescriptions. Arbitrary plan text such as `notes`, `instructions`, `load_instruction`, and `progression_rule` is absent and rejected as unknown.
- Human decision: the only top-level v1 fields are `schema_version`, `effective_from`, and `week`. Complete replacement is intrinsic; the package has no `mode`, timezone, generation timestamp, Athlete identity, or end date.
- Human decision: when the proposed `week` is semantically identical to the template applicable on `effective_from`, validation reports no plan changes, disables confirmation, and creates no Plan Revision. JSON formatting and object-key order are ignored in this comparison.
- Human decision: imports are capped at 256 KiB, 20 blocks per workout, 50 exercises per workout, 200 expanded Completion Items per workout, and 100 characters per display label. Exceeding any cap blocks the package.
- Human decision: validation returns all discoverable errors together with precise JSON paths for copying back to the Agent. Any error blocks preview and confirmation; JSON parse errors report their location and cause.

## Answer

The original multi-week and conditional-plan premise is removed. Both Plan Seed and later updates use the same strict v1 Plan Update Package containing only `schema_version`, an Athlete-local `effective_from` strictly after today, and one complete Monday-through-Sunday `week`. Its seven required slots are each a workout, explicit Rest Day, or literal `null`; the template repeats indefinitely from its effective date until superseded. A midweek revision leaves earlier dates under the prior revision.

The App and JSON contain no progression rules, coaching instructions, free-text plan notes, Athlete identity, timezone, mode, end date, or internal IDs. Structured prescriptions and necessary labels are allowed. Every exercise has a stable, human-readable `exercise_key`; it is unique within a workout, preserves history across display-name changes, and denotes a new Exercise when changed.

Plan Seed follows the same tomorrow-or-later rule, creates only the designated Athlete's first revision, and never reapplies over existing data. The other Athlete starts without a plan.

An import is all-or-nothing. It is blocked by invalid JSON; any missing, unknown, mistyped, unsupported-version, out-of-range, structurally inconsistent, or over-limit value; invalid `effective_from`; invalid slot exclusivity; an empty workout; duplicate same-workout `exercise_key`; or exceeding 256 KiB, 20 blocks, 50 exercises, 200 Completion Items per workout, or 100 characters per label. Values are never coerced or repaired. Errors are available as copyable Agent-facing details. A semantically unchanged week produces no confirmable preview and no revision.
