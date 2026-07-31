# Define future-plan editing and revision application

Type: grilling
Status: resolved

## Question

What exactly may the future-plan editor change, how are drafts and diffs represented, what happens at an effective-date boundary containing started or terminal sessions, and how is an accepted full-snapshot Plan Revision applied atomically?

## Answer

The App has no future-plan editor. The Plan page is read-only and exposes exactly one update workflow: optionally copy the Athlete's current plan JSON, prepare a Plan Update Package outside the App, then paste it for validation, a complete human-readable preview of the resulting Weekly Template, and explicit application. There is no JSON file download, file picker, or file upload. The App contains no AI, manual field editor, day/week copying, or direct add/delete controls.

Every Plan Update Package declares an `effective_from` strictly after the Athlete's current local date; the earliest valid value is tomorrow. A Workout Session can be started, skipped, or restarted only on its Scheduled Workout's local date, and past Sessions cannot be created retroactively. Consequently, a normal revision range contains only pure future schedule data—never started or terminal “locked islands.” Unexpected future Session data is an integrity error, not a supported merge case.

Each Athlete has at most one Scheduled Workout per local date. Multiple training modes on that date are Blocks within that one workout. A date collision inside an update is invalid rather than merged.

Before application, the App shows the future `effective_from` date, one concise count of semantically changed weekday slots, and the complete resulting Monday-through-Sunday Weekly Template in normal plan language. The Athlete never sees JSON lines, a field-level diff, or before/after technical values. Validation failures show a simple failure state with copyable detailed errors intended for the external Agent.

Applying is all-or-nothing: the Plan Revision, its complete Weekly Template snapshot, and the newly current repeated schedule are committed together. Validation or persistence failure creates no revision and changes no schedule. Plan Revision history has no list, restore, switch, or old-version comparison UI; the Plan page shows only the current future schedule and its last-updated time.

The precise replacement horizon, JSON schema, conditional prescription representation, and validation errors are owned by [Resolve conditional Plan Seed rules and JSON import semantics](05-resolve-conditional-plan-seed-rules-and-json-import-semantics.md).
