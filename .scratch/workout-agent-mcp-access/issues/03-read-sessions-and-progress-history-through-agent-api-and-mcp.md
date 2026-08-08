# 03 — Read Sessions and progress history through Agent API and MCP

**What to build:** A connected Codex Agent can inspect Workout Session history and progress evidence through typed MCP tools, including bounded filtering, complete Session detail, progress metrics, and Exercise history, without duplicating domain calculations in the adapter.

**Blocked by:** 02 — Read plan context through Agent API and MCP.

**Type:** task

**Status:** resolved

- [x] `workout_list_sessions` supports Athlete-local date filters, status filters, Exercise filters, bounded limits, and opaque cursors with the existing immutable ordering.
- [x] `workout_get_session` returns the immutable Training Plan Snapshot, Actual Training Data, Training Intervals, Session status, duration, RPE, notes, and Exercise Feedback according to the existing read contract.
- [x] `workout_get_progress` returns completion, streak, duration, Strength Training Days, RPE, weekly buckets, and evidence for numerator, denominator, exclusions, and contributing Sessions.
- [x] `workout_get_exercise_history` returns display-name history, performed Session counts, per-set values, Resistance semantics, side-separated series, and contributing Session references.
- [x] Every page carries the relevant training version and provenance; a version change during traversal causes a restart from page one rather than an exactly-once claim.
- [x] The MCP adapter exposes these tools as typed calls, preserves cursors and structured JSON, and maps invalid, expired, filtered, and missing-resource errors without retrying stale data blindly.
- [x] Tests cover pagination, cursor expiry and filter binding, empty metric denominators, current-date incompleteness, Session status boundaries, side-specific history, cross-Athlete isolation, and version changes between pages.

## Completion

Implemented through the existing Coach projection seams plus the authenticated
Agent API and local JSONL MCP bridge. Agent Session cursors are version-bound
and strict about malformed input while preserving legacy Coach cursor shape;
Session detail, progress evidence, and side-separated Exercise history retain
safe provenance and cross-Athlete isolation. Verified with 11 Ticket 03 tests,
the Agent/Coach/core and boundary regression suites, `npm run typecheck`, and
`npm run mcp:check`.

## Answer

Ticket resolved. The Agent surface now exposes typed reads for Session indexes
and immutable detail, progress metrics/evidence, and Exercise history. The
adapter preserves opaque cursors, structured domain errors, training-version
restart signals, and no-retry behavior; the Agent—not this integration—owns
how analysis is presented.

Context pointer: the implementation contract is recorded in
`docs/contracts/agent-api-v1.md` and `docs/contracts/agent-api-wire-catalog-v1.md`;
the shared decision is indexed in [`map.md`](../map.md#decisions-so-far).

## Review

- Spec review: PASS — all Ticket 03 read, pagination, provenance, isolation,
  version-change, MCP error, and no-retry requirements are implemented and
  covered by tests; prior review findings are closed.
- Standards review: PASS — no documented-standard, privacy, or Coach
  compatibility violation found. The simple revocable Agent Token and
  Agent-owned analysis boundary remain unchanged.
