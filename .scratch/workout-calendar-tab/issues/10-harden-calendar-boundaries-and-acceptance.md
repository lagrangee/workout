# 10 — Harden Calendar boundaries and acceptance

**What to build:** Complete the cross-cutting Calendar verification so the delivered surface is consistent across date/revision boundaries, every defined status, the existing Today-only execution rules, and the accepted mobile B interaction.

**Blocked by:** 07 — Build Calendar week browsing with real dated state; 08 — Build selected-day Calendar detail; 09 — Add historical Session correction entry.

**Status:** implemented

- [x] Calendar UI starts at the first effective Plan Revision date, supports arbitrary future dates, and keeps pre-plan dates out of navigation.
- [x] Schedule requests enforce the inclusive 366-day maximum while normal Calendar navigation requests one week.
- [x] Tests cover midweek and overlapping Plan Revision precedence, Athlete timezone boundaries, and stable historical Session dates.
- [x] Tests cover future, today's not-due, in-progress, completed, partial, skipped, overdue-unstarted, Rest Day, and no-plan states.
- [x] Tests verify Calendar never creates or mutates a Session through browsing and Today remains the only execution surface.
- [x] Tests verify no-plan and Rest Day remain distinct and neutral in Calendar and metrics.
- [x] Tests verify two-Athlete schedule, Session, prescription, and correction isolation.
- [x] Manual mobile acceptance confirms Prototype B: seven-day selector, current-week/today default, week navigation, selected-day detail, read-only controls, and historical correction discovery.
- [x] The existing production check suite remains green, and the implementation handoff records any remaining contract or release gate explicitly.

## Implementation evidence

- `npm run release-check` passed: 24 automated tests, seed verification, forbidden-feature scan, and local release acceptance.
- Mobile browser acceptance at 375×812 covered current-week/today selection, seven dated summaries, previous/next week navigation, first-plan boundary, future/today/in-progress/rest/no-plan presentation, selected-day prescription and Snapshot detail, read-only Calendar controls, and historical correction refresh.
- Remaining release action is the requested `origin` push and manual default-branch Wrangler deployment; live Cloudflare acceptance remains a deployment gate, not a local test result.
