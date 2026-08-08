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

- The typed bridge and launcher tests pass, and the owner-only local config was
  prepared outside the repository.
- The Codex MCP registry contains an enabled `workout` stdio server pointing at
  `mcp/launch.mjs`; the registry stores only the config-file path, not the
  Token value.
- Direct stdio smoke initialized successfully, listed 9 tools, and completed a
  read-only `workout_get_overview` request with the `7d` preset. The returned
  training payload was not printed.
- A fresh Codex task is still required because the current task does not hot
  load newly registered MCP servers.

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

The Athlete entered a production Agent Token into the owner-only local config;
the value was not read, printed, or requested in chat. No production plan was
previewed or changed. A live plan application requires the Athlete to choose
the future change and give the separate confirmation after seeing its preview.
Therefore no plan-update/readback or Gate Passage is claimed yet.

## Remaining write set

The authorized production deployment, D1 migration, and `AGENT_TOKEN_SECRET`
write are complete, and the local Token-backed read-only smoke has passed. The
Athlete must now start a fresh Codex task to load the registered MCP. Only after
a separate preview confirmation may that task run the plan-update/readback
scenario.
