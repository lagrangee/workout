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
- [Ticket 03](issues/03-read-sessions-and-progress-history-through-agent-api-and-mcp.md): expose typed Session, progress, and Exercise history reads with
  version-bound Agent cursors, safe provenance, and structured MCP errors while
  retaining the legacy Coach cursor shape. The contract is in the same Agent
  API documents.
- [Ticket 04](issues/04-preview-future-plan-update-packages.md): add the
  non-mutating typed Plan Update preview. The Agent/MCP boundary now validates
  a complete package, selects the effective plan base for its future date,
  returns complete preview and digest evidence, and preserves stable JSON
  Pointer errors without exposing revision identities. Confirmation and apply
  remain Ticket 05.
- [Ticket 05](issues/05-confirm-and-apply-future-plan-updates.md): add the
  confirmed, atomic Agent Plan Update application. The boundary revalidates
  package/base evidence, increments `training_version`, appends one immutable
  revision, retains a 24-hour idempotency result, and the MCP flow verifies the
  applied plan plus its seven-day Schedule readback. Ticket 06 owns the thin
  Skill; Ticket 07 owns live MCP acceptance.

## Fog

Tickets 06–07 remain the implementation frontier: the thin Skill and live MCP
acceptance.
