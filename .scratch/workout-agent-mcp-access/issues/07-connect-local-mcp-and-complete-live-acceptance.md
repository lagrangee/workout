# 07 — Connect local MCP and complete live acceptance

**What to build:** The Athlete can configure the local MCP adapter with the deployed Agent API origin and Agent Token, use the Workout Agent Skill in a real Codex conversation, read training data, preview a future plan, confirm its application, and observe verified readback.

**Blocked by:** 02 — Read plan context through Agent API and MCP; 03 — Read Sessions and progress history through Agent API and MCP; 05 — Confirm and apply future Plan Updates; 06 — Write the thin Workout Agent Skill.

**Status:** ready-for-agent

- [ ] The local onboarding path configures API origin and Agent Token outside the repository and outside chat, with clear handling for missing, rotated, and revoked credentials.
- [ ] A real Codex session can retrieve overview, Current Plan, Schedule, Workout Sessions, Session detail, Progress, and Exercise history through the installed MCP tools.
- [ ] The real session presents a future Plan Update preview, pauses for separate explicit Athlete confirmation, applies it once, and reports successful Current Plan and Schedule readback.
- [ ] Live smoke covers invalid authentication, bounded date queries, pagination, stale-plan recovery, idempotent retry behavior, and credential non-disclosure.
- [ ] Release evidence separates automated tests, local MCP smoke, deployed smoke, and human acceptance; none is reported as a Gate Passage without the corresponding evidence.
- [ ] The Agent API contract, schema catalog, state/migration notes, Skill onboarding, and release acceptance documentation agree with the shipped behavior.
- [ ] The final handoff records exact remaining blockers or confirms that all required branches, outputs, and acceptance evidence are complete.

