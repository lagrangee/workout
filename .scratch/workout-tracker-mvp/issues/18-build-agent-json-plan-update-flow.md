# 18 — Build Agent JSON Plan Update flow

**What to build:** An Athlete can paste a complete Agent-generated weekly JSON package, receive a simple repairable error or a human-readable future-week preview, and confirm an atomic Plan Revision.

**Blocked by:** 17 — Build Current Plan, schedule, and Today read model.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] The update surface is a bottom sheet over the normal read-only Plan and accepts pasted text rather than file import or manual editing.
- [ ] Strict validation rejects malformed JSON, duplicate keys, unknown/missing fields, invalid types/ranges, invalid effective dates, structural violations, oversized input, and semantic no-ops without writing a revision.
- [ ] Invalid input shows a simple update failure and exposes copyable Agent-facing error details without forcing the Athlete to inspect technical diff output.
- [ ] Valid input previews the complete resulting Monday–Sunday week, effective date, and changed weekday-slot count without showing a line diff.
- [ ] Confirmation applies one future-only revision atomically; revision precedence prevents an older future revision from reappearing.
- [ ] A pending-effective-date state returns the Athlete to the Plan and leaves today's current projection unchanged.
