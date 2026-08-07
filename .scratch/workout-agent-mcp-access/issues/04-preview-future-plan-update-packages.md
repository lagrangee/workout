# 04 — Preview future Plan Update Packages

**What to build:** A Coach Agent can turn a structured proposed change into a strict future Plan Update Package, validate it through the Agent API, and show a complete resulting Weekly Template and change summary without creating a Plan Revision.

**Blocked by:** 02 — Read plan context through Agent API and MCP.

**Type:** task

**Status:** claimed

- [ ] `workout_validate_plan_update` accepts a structured complete Plan Update Package and preserves the existing schema-version, seven-slot, future-date, strict-field, and no-op rules.
- [ ] The validation path uses the current plan as its explicit base and returns a complete preview, changed-slot count, effective date, `package_digest`, and `base_plan_digest` or equivalent version evidence.
- [ ] Invalid packages report stable field-level errors and leave the Current Plan and Plan Revision history unchanged.
- [ ] The Agent-facing contract requires explicit values for fields that the package needs; the server performs no guessing, coercion, repair, or natural-language parsing.
- [ ] The MCP tool accepts typed package input, serializes it for the canonical Plan Update Package validator, and returns structured preview data without exposing internal revision identities.
- [ ] Tests cover valid packages, missing and unknown fields, duplicate or malformed values, no-op packages, past/current effective dates, changed and unchanged weekday slots, and zero-write validation failures.
