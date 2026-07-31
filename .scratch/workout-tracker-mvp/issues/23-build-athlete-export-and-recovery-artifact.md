# 23 — Build Athlete Export and recovery artifact

**What to build:** An Athlete can download a complete, privacy-filtered JSON representation of their plan and training history and use it as the manual recovery artifact.

**Blocked by:** 18 — Build Agent JSON Plan Update flow; 20 — Build Session continuation, intervals, and correction.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] The export contains Athlete settings, every Plan Revision, dated Scheduled Workout history through today, immutable snapshots, latest corrected Actual Training Data, and Exercise Feedback.
- [ ] The envelope and all collection items conform to Athlete Export Wire Catalog v1, use stable export-safe relationships, and exclude identity, Coach secrets, internal IDs, telemetry, symptoms, goals, routes, and coaching analysis.
- [ ] Collections represent one consistent `data_as_of`; a concurrent correction cannot yield a mixed Session representation.
- [ ] Empty plan/history and Rest Day/no-plan cases are represented exactly, with counts matching collections and no infinite future schedule expansion.
- [ ] The full-history response enforces the documented MVP capacity bound before download and returns a structured error without a partial file when exceeded.
- [ ] A fixture-based recovery check proves the export can be inspected alongside the D1 Time Travel recovery procedure.
