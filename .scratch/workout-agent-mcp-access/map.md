# Workout Agent Access and Plan Update

## Notes

This effort adds a personal bearer-authenticated Agent API, a local typed MCP
adapter, and a thin Skill alongside the existing read-only Coach Share. Agent
analysis presentation remains owned by the Agent; the integration supplies
structured data, provenance, and confirmed plan-write boundaries.

## Decisions-so-far

- [Ticket 01](issues/01-add-agent-token-lifecycle-and-authentication.md): use
  one simple revocable Agent Token per Athlete, with the plaintext returned only
  at create/rotate time and no OAuth or password storage. The contract is in
  `docs/contracts/agent-api-v1.md` and
  `docs/contracts/agent-api-wire-catalog-v1.md`.
- [Ticket 02](issues/02-read-plan-context-through-agent-api-and-mcp.md): expose
  the first three typed read tools through the Agent API and local JSONL MCP;
  projections reject ambiguous input, preserve safe metadata, and keep Coach
  Share behavior unchanged. The contract is in the same Agent API documents.

## Fog

Tickets 03–07 remain the implementation frontier: execution/progress reads,
plan-update preview/application, the Skill, and live MCP acceptance.
