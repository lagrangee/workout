# 04 — Preview future Plan Update Packages

**What to build:** A Coach Agent can turn a structured proposed change into a strict future Plan Update Package, validate it through the Agent API, and show a complete resulting Weekly Template and change summary without creating a Plan Revision.

**Blocked by:** 02 — Read plan context through Agent API and MCP.

**Type:** task

**Status:** resolved

- [x] `workout_validate_plan_update` accepts a structured complete Plan Update Package and preserves the existing schema-version, seven-slot, future-date, strict-field, and no-op rules.
- [x] The validation path uses the effective plan base for the package date and returns a complete preview, changed-slot count, effective date, `package_digest`, and `base_plan_digest` evidence.
- [x] Invalid packages report stable JSON Pointer field-level errors and leave the Current Plan and Plan Revision history unchanged.
- [x] The Agent-facing contract requires explicit values for the fields the package needs; the server performs no guessing, coercion, repair, or natural-language parsing.
- [x] The MCP tool accepts typed package input, serializes it for the canonical Plan Update Package validator, and returns structured preview data without exposing internal revision identities.
- [x] Tests cover valid packages, missing and unknown fields, duplicate or malformed values, no-op packages, past/current effective dates, changed and unchanged weekday slots, trimmed labels, size boundaries, and zero-write validation failures.

## Completion

Implemented the non-mutating Agent POST validation route and typed MCP tool. The
Worker reuses the strict Plan Update Package validator, rejects ambiguous JSON,
preserves JSON Pointer paths, selects the effective plan base for the proposed
date, returns complete preview/digest evidence, and keeps all plan state
unchanged. The MCP boundary validates the complete nested package shape before
serializing the canonical `package_text` request.

Verification: 21 targeted Agent/MCP/core tests passed, `npm run typecheck`,
`npm run mcp:check`, and `git diff --check` passed.

## Answer

Ticket resolved. A Coach Agent can now submit a complete typed future package
for strict validation and receive a complete resulting week, changed-slot
summary, effective base, package/base digests, and stable errors without
creating a Plan Revision. Confirmation and application remain Ticket 05.

Context pointer: the implementation contract is recorded in
`docs/contracts/agent-api-v1.md`,
`docs/contracts/agent-api-wire-catalog-v1.md`, and
`docs/contracts/plan-update-package-v1.md`; the shared decision is indexed in
[`map.md`](../map.md#decisions-so-far).
