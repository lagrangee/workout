# 06 — Write the thin Workout Agent Skill

**What to build:** Publish the project’s thin model-invoked Workout Agent Skill so that the Agent consistently selects the typed MCP tools, reads bounded evidence, protects credentials, and follows the validate → confirm → apply → readback plan-update path while retaining freedom over analysis style.

**Blocked by:** 03 — Read Sessions and progress history through Agent API and MCP; 05 — Confirm and apply future Plan Updates.

**Type:** task

**Status:** resolved

- [x] The Skill uses model-invoked frontmatter because the Agent must reach it when the user asks about Workout data or future plan changes; its description is a sharp context pointer naming the real trigger branches.
- [x] The Skill’s in-file steps specify a repeatable read-first process, bounded date and pagination handling, evidence/provenance use, and the separate confirmation gate for plan application.
- [x] The Skill leaves analysis structure, tone, and recommendation style to the Agent; it provides data and safety process rather than a mandatory fact/inference/recommendation template.
- [x] The Skill contains no Agent Token, API secret, password, Coach Share URL, Athlete selector, domain calculation, or duplicated wire schema; detailed contracts are reached through precise context pointers.
- [x] Each step ends with a clear, checkable completion criterion, and the Skill’s positive instructions avoid no-op prose, sediment, sprawl, and negation-based steering.
- [x] The Skill is reviewed against `writing-for-agents` and `writing-great-skills`, including invocation choice, information hierarchy, progressive disclosure, co-location, leading words, single source of truth, and pruning.
- [x] A focused agent-facing review verifies that read, pagination, validation, confirmation, apply, stale-plan, error, and readback branches are all represented and that no branch silently authorizes an excluded mutation.

## Completion

Published the model-invoked Skill at `skills/workout-agent/SKILL.md`. It routes
the nine typed MCP tools through bounded read-first evidence, preserves
provenance and pagination/version boundaries, leaves analysis presentation to
the Agent, and keeps connection credentials in local MCP configuration. Future
plan changes follow read → validate → preview → separate confirmation → apply
with `confirmed: true`, matching digests, idempotency, and verified readback.
Invalid cursors, stale state, confirmation and idempotency conflicts, rate or
server errors, and excluded lifecycle/settings/share mutations have explicit
paths.

Verification: the four focused Skill tests and all 59 repository tests passed;
`npm run typecheck`, `npm run mcp:check`, and `git diff --check` passed.

## Answer

Ticket resolved. The Skill provides the data-access and plan-write safety
process only; it does not impose a fact/inference/recommendation template or a
coaching voice. Canonical wire and domain details remain in the contract docs
behind precise context pointers.

Context pointer: the implementation is
[`skills/workout-agent/SKILL.md`](../../skills/workout-agent/SKILL.md), its
public contract tests are in
[`tests/workout-agent-skill.test.js`](../../tests/workout-agent-skill.test.js),
and the shared decision is indexed in [`map.md`](../map.md#decisions-so-far).

## Review

- Spec review: PASS after closing findings for connected-identity wording,
  explicit `confirmed: true` plus matching package/base digests, and complete
  error/excluded-mutation routing. The fixed-point review returned PASS.
- Standards review: PASS. The fixed-point review found no violation against
  repository standards or the `writing-for-agents` / `writing-great-skills`
  guidance.
