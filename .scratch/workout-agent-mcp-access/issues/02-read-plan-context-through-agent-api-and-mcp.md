# 02 — Read plan context through Agent API and MCP

**What to build:** A connected Codex Agent can use the first typed MCP tools to retrieve one Athlete's overview, Current Plan, and Athlete-local Schedule through the authenticated Agent API, with the same plan projections, date rules, freshness metadata, and safe source references as the existing domain.

**Blocked by:** 01 — Add Agent Token lifecycle and Agent API authentication.

**Type:** task

**Status:** resolved

- [x] `workout_get_overview` returns bounded plan context, coverage, freshness, recent evidence, and current-date completeness metadata for the authenticated Athlete.
- [x] `workout_get_plan` returns the applicable Current Plan and effective future Weekly Templates without exposing internal revision identities.
- [x] `workout_get_schedule` requires an explicit inclusive Athlete-local date range, supports prescription expansion, and rejects invalid or oversized ranges with stable errors.
- [x] Agent API responses preserve structured JSON, `data_as_of`, safe `source_ref` values, metric semantics, and no-store/security behavior.
- [x] The local MCP adapter maps these three typed tools to the Agent API and preserves domain fields and error meaning without adding a generic HTTP tool.
- [x] Reads have no mutation side effects and do not expose Coach Share URLs, Agent Tokens, database identities, or Athlete selectors.
- [x] Tests cover empty and populated plans, future revisions, Rest Day and no-plan projections, boundary dates, invalid ranges, response metadata, and Athlete isolation through the Worker HTTP seam.

## Completion

Implemented with the existing Worker projection seams plus a local JSONL stdio MCP bridge. Verified with the Agent API/MCP tests, authentication/core regression tests, `npm run typecheck`, and `npm run mcp:check`.

## Answer

Ticket resolved. The first three typed read tools now retrieve overview,
Current Plan, and Athlete-local Schedule through the bearer-authenticated Agent
API. Plan and prescription projections are typed and revision-identity-free;
period selectors, no-store metadata, stable safe references, MCP argument
validation, and cross-Athlete isolation are covered at the Worker seam.

Context pointer: the implementation contract is recorded in
`docs/contracts/agent-api-v1.md` and `docs/contracts/agent-api-wire-catalog-v1.md`;
the shared decision is indexed in [`map.md`](../map.md#decisions-so-far).

## Review

- Spec review: PASS — no missing requirement, scope creep, or behavior error found.
- Standards review: PASS — no documented-standard violation found. The repeated
  Agent/Coach projection logic is an accepted judgment call because the two
  surfaces have different privacy and identity boundaries.
