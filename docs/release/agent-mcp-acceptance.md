# Agent MCP acceptance receipt

Date: 2026-08-08

Status: awaiting human acceptance — production prerequisites are complete; local
MCP setup and live Athlete acceptance are pending.

## Automated evidence

- `npm test` — 62 tests passed.
- `npm run typecheck` — passed.
- `npm run mcp:check` — passed.
- `node --test tests/mcp-onboarding.test.js` — 3 onboarding tests passed.
- `npm run release-check` — blocked in the pre-existing seed verifier because
  `seed/workout-tracker-weekly-seed.json` uses the past `effective_from`
  `2026-08-02` relative to the current local date. The failure occurs before
  `forbidden-scan` and release-acceptance checks.

## Local MCP smoke

- The typed bridge and launcher tests pass.
- The current shell has no `WORKOUT_AGENT_API_ORIGIN` or
  `WORKOUT_AGENT_TOKEN` values.
- The current Codex MCP list has no `workout` server registration. The onboarding
  command is documented in [`agent-mcp-onboarding.md`](./agent-mcp-onboarding.md)
  and has not been executed, so no user configuration was mutated.

## Deployed smoke

- `https://workout.lagrangee.xyz/healthz` returned `200` with the expected
  service response and security headers.
- `https://workout.lagrangee.xyz/api/agent/v1` returned the expected `401`
  `agent_unauthorized` response without a Token. The Worker was deployed as
  version `4fa27860-eb98-4e07-84f8-838f39c959f3`.
- Remote D1 migration inspection reports no migrations to apply; migration
  `0005_agent_token_lookup.sql` is applied.
- Remote Worker Secret names include `AGENT_TOKEN_SECRET`. Its value was never
  read or printed.

## Human acceptance

No production Agent Token was created or requested in chat. No production plan
was previewed or changed. A live plan application requires the Athlete to
choose the future change and give the separate confirmation after seeing its
preview. Therefore no local MCP reads, pagination/stale recovery, idempotent
retry, verified readback, or Gate Passage is claimed yet.

## Remaining write set

The authorized production deployment, D1 migration, and `AGENT_TOKEN_SECRET`
write are complete. The Athlete must now create or rotate a Token through the
authenticated App, configure the local MCP launcher in the owner-only config
file, and start a fresh Codex task. That task can run the read-only smoke and,
only after a separate preview confirmation, the plan-update/readback scenario.
