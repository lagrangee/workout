# 09 — Add historical Session correction entry

**What to build:** From a historical Calendar detail, let an Athlete inspect an existing completed, partial, or skipped Workout Session and deliberately enter the existing Session correction flow, then see the corrected completion state when returning to Calendar.

**Blocked by:** 08 — Build selected-day Calendar detail.

**Status:** implemented

- [x] Historical completed, partial, and skipped Session details expose a secondary `校正记录` entry.
- [x] The correction entry reuses the existing Session correction behavior and preserves the immutable Scheduled Workout date and Training Plan Snapshot.
- [x] Saving a correction updates Actual Training Data and causes Calendar's Session summary/detail to reflect the latest canonical values.
- [x] Completion fraction and derived Session Status change correctly after correction, including completed-to-partial and partial-to-completed transitions.
- [x] An overdue-unstarted date without a Session exposes no correction entry and cannot create a historical Session.
- [x] Calendar remains read-only outside the explicit correction flow; it does not add inline editing or plan mutation.
- [x] Automated coverage verifies historical correction discovery, corrected state refresh, immutable Snapshot/date boundaries, and cross-Athlete correction isolation.
