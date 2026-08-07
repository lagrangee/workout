# 07 — Connect local MCP and complete live acceptance

**What to build:** The Athlete can configure the local MCP adapter with the deployed Agent API origin and Agent Token, use the Workout Agent Skill in a real Codex conversation, read training data, preview a future plan, confirm its application, and observe verified readback.

**Blocked by:** 02 — Read plan context through Agent API and MCP; 03 — Read Sessions and progress history through Agent API and MCP; 05 — Confirm and apply future Plan Updates; 06 — Write the thin Workout Agent Skill.

**Type:** task

**Status:** claimed

- [ ] The local onboarding path configures API origin and Agent Token outside the repository and outside chat, with clear handling for missing, rotated, and revoked credentials.
- [ ] A real Codex session can retrieve overview, Current Plan, Schedule, Workout Sessions, Session detail, Progress, and Exercise history through the installed MCP tools.
- [ ] The real session presents a future Plan Update preview, pauses for separate explicit Athlete confirmation, applies it once, and reports successful Current Plan and Schedule readback.
- [ ] Live smoke covers invalid authentication, bounded date queries, pagination, stale-plan recovery, idempotent retry behavior, and credential non-disclosure.
- [ ] Release evidence separates automated tests, local MCP smoke, deployed smoke, and human acceptance; none is reported as a Gate Passage without the corresponding evidence.
- [ ] The Agent API contract, schema catalog, state/migration notes, Skill onboarding, and release acceptance documentation agree with the shipped behavior.
- [ ] The final handoff records exact remaining blockers or confirms that all required branches, outputs, and acceptance evidence are complete.

## Comments

2026-08-08 — Repository-side onboarding is implemented in commit `14c9d53`:
`mcp/launch.mjs` reads an owner-only user config outside the repository, the
Codex registration path is documented, and the acceptance receipt separates
automated, local MCP, deployed, and human evidence. `npm test` passes 62 tests;
typecheck, MCP syntax, and the release artifact check pass.

Live acceptance is blocked at external prerequisites. The production health
endpoint is `200`, but `/api/agent/v1` is `404`; Wrangler lists the latest
deployment on 2026-08-03, remote D1 reports
`0005_agent_token_lookup.sql` unapplied, and the Worker Secret list has no
`AGENT_TOKEN_SECRET`. The shell has no local Agent API configuration, and the
Codex MCP list has no `workout` registration. No Token was requested, read, or
written by this task. No production plan mutation was attempted.

The Ticket 07 Standards/Spec review was started against fixed point `ab03aa1`,
but both review threads failed to return terminal reports after bounded waits
and were closed. No review PASS is claimed; the local audit is recorded only as
supporting evidence. Remaining handoff requires an authorized production
deploy/migration/Secret write, user-owned App login to create or rotate the
Token, local MCP registration in a fresh Codex process, and a separately
confirmed future plan change for the live apply/readback branch.

2026-08-08 — The authorized production prerequisites are complete.
`AGENT_TOKEN_SECRET` was written without exposing its value, remote D1
migration `0005_agent_token_lookup.sql` applied successfully, and Worker
version `4fa27860-eb98-4e07-84f8-838f39c959f3` was deployed from `main`.
Production `/healthz` returns `200`; unauthenticated `/api/agent/v1` returns
the expected `401 agent_unauthorized`. No production plan was read or changed.
The remaining acceptance boundary is user-owned: create or rotate a Token in
the authenticated App, configure the local owner-only MCP file, start a fresh
Codex task, and complete the read-only smoke before any separately confirmed
plan update.
