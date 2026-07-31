# Prototype the JSON plan update flow

Type: prototype
Status: resolved
Blocked by: 04, 05

## Question

What low-complexity interaction model lets an Athlete update a normal read-only Plan with Agent-generated JSON, recover from validation failure, and confidently confirm the resulting future week without seeing technical details?

## Answer

Use the plan-first bottom-sheet model represented by prototype variant C.

- The normal read-only weekly Plan remains the primary screen. “更新计划” is a secondary, low-frequency action.
- Tapping it opens a bottom sheet over the visible Plan. The Athlete pastes the complete JSON returned by the ChatGPT Agent and asks the App to check it.
- Invalid input shows only “计划无法更新” and a button that copies structured error details for the Agent. The Athlete does not see line numbers, field-level diagnostics, or an editor-like interface.
- Valid input advances within the sheet to a confirmation state containing `effective_from`, the complete resulting Monday–Sunday plan, and a one-line changed-weekday-slot count. It does not show a technical diff.
- Confirming closes the sheet and returns to the Plan page, where one compact
  banner shows the next pending Weekly Template's effective date and, when
  additional future revisions remain on the effective timeline, their count.
  The read-only Plan can list those future templates; the current week remains
  unchanged.
- “复制当前计划 JSON” remains available as a secondary action for Agent collaboration.

Variants A (inline expansion) and B (dedicated route) are rejected. They remain only as comparison states in the throwaway prototype.

## Comments

- Human selected variant C. Browser verification covered the 390 × 844 mobile layout, the valid paste → preview → confirm → pending-banner path, the invalid paste → simple error path, and a desktop-width layout check. No browser warnings or errors were observed.

- Human correction: prototype the update inside a normal read-only Plan experience, including entry and return states. JSON is Agent-generated, so the Athlete never sees an editor, line numbers, or field-level diff. Invalid input offers copyable error details for the Agent; valid input shows effective date, the complete resulting week, and only a one-line changed-day count before confirmation.

- [Define future-plan editing and revision application](04-define-future-plan-editing-and-revision-application.md) removed all manual plan editing and file-level JSON transfer. The prototype covers only read-only plan inspection, copying current JSON from a text area, pasting proposed JSON into a text area, validation, a human-readable resulting-week preview, confirmation, and failure recovery.
