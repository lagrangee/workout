# 06 — Write the thin Workout Agent Skill

**What to build:** Publish the project’s thin model-invoked Workout Agent Skill so that the Agent consistently selects the typed MCP tools, reads bounded evidence, protects credentials, and follows the validate → confirm → apply → readback plan-update path while retaining freedom over analysis style.

**Blocked by:** 03 — Read Sessions and progress history through Agent API and MCP; 05 — Confirm and apply future Plan Updates.

**Status:** ready-for-agent

- [ ] The Skill uses model-invoked frontmatter because the Agent must reach it when the user asks about Workout data or future plan changes; its description is a sharp context pointer naming the real trigger branches.
- [ ] The Skill’s in-file steps specify a repeatable read-first process, bounded date and pagination handling, evidence/provenance use, and the separate confirmation gate for plan application.
- [ ] The Skill leaves analysis structure, tone, and recommendation style to the Agent; it provides data and safety process rather than a mandatory fact/inference/recommendation template.
- [ ] The Skill contains no Agent Token, API secret, password, Coach Share URL, Athlete selector, domain calculation, or duplicated wire schema; detailed contracts are reached through precise context pointers.
- [ ] Each step ends with a clear, checkable completion criterion, and the Skill’s positive instructions avoid no-op prose, sediment, sprawl, and negation-based steering.
- [ ] The Skill is reviewed against `writing-for-agents` and `writing-great-skills`, including invocation choice, information hierarchy, progressive disclosure, co-location, leading words, single source of truth, and pruning.
- [ ] A focused agent-facing review verifies that read, pagination, validation, confirmation, apply, stale-plan, error, and readback branches are all represented and that no branch silently authorizes an excluded mutation.

