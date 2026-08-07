# 03 — Read Sessions and progress history through Agent API and MCP

**What to build:** A connected Codex Agent can inspect Workout Session history and progress evidence through typed MCP tools, including bounded filtering, complete Session detail, progress metrics, and Exercise history, without duplicating domain calculations in the adapter.

**Blocked by:** 02 — Read plan context through Agent API and MCP.

**Status:** ready-for-agent

- [ ] `workout_list_sessions` supports Athlete-local date filters, status filters, Exercise filters, bounded limits, and opaque cursors with the existing immutable ordering.
- [ ] `workout_get_session` returns the immutable Training Plan Snapshot, Actual Training Data, Training Intervals, Session status, duration, RPE, notes, and Exercise Feedback according to the existing read contract.
- [ ] `workout_get_progress` returns completion, streak, duration, Strength Training Days, RPE, weekly buckets, and evidence for numerator, denominator, exclusions, and contributing Sessions.
- [ ] `workout_get_exercise_history` returns display-name history, performed Session counts, per-set values, Resistance semantics, side-separated series, and contributing Session references.
- [ ] Every page carries the relevant training version and provenance; a version change during traversal causes a restart from page one rather than an exactly-once claim.
- [ ] The MCP adapter exposes these tools as typed calls, preserves cursors and structured JSON, and maps invalid, expired, filtered, and missing-resource errors without retrying stale data blindly.
- [ ] Tests cover pagination, cursor expiry and filter binding, empty metric denominators, current-date incompleteness, Session status boundaries, side-specific history, cross-Athlete isolation, and version changes between pages.

