# 02 — Read plan context through Agent API and MCP

**What to build:** A connected Codex Agent can use the first typed MCP tools to retrieve one Athlete's overview, Current Plan, and Athlete-local Schedule through the authenticated Agent API, with the same plan projections, date rules, freshness metadata, and safe source references as the existing domain.

**Blocked by:** 01 — Add Agent Token lifecycle and Agent API authentication.

**Status:** ready-for-agent

- [ ] `workout_get_overview` returns bounded plan context, coverage, freshness, recent evidence, and current-date completeness metadata for the authenticated Athlete.
- [ ] `workout_get_plan` returns the applicable Current Plan and effective future Weekly Templates without exposing internal revision identities.
- [ ] `workout_get_schedule` requires an explicit inclusive Athlete-local date range, supports prescription expansion, and rejects invalid or oversized ranges with stable errors.
- [ ] Agent API responses preserve structured JSON, `data_as_of`, safe `source_ref` values, metric semantics, and no-store/security behavior.
- [ ] The local MCP adapter maps these three typed tools to the Agent API and preserves domain fields and error meaning without adding a generic HTTP tool.
- [ ] Reads have no mutation side effects and do not expose Coach Share URLs, Agent Tokens, database identities, or Athlete selectors.
- [ ] Tests cover empty and populated plans, future revisions, Rest Day and no-plan projections, boundary dates, invalid ranges, response metadata, and Athlete isolation through the Worker HTTP seam.

