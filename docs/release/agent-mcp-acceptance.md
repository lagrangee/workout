# Agent MCP acceptance receipt

Date: 2026-08-08

Status: blocked — deployed Agent API and human plan-change acceptance are pending.

## Automated evidence

- `npm test` — 59 tests passed.
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
- `https://workout.lagrangee.xyz/api/agent/v1` returned `404`, so the deployed
  Worker does not yet expose the Agent API. Wrangler's latest listed deployment
  was created on 2026-08-03.
- Remote D1 migration inspection reports
  `0005_agent_token_lookup.sql` as unapplied.
- Remote Worker Secret names do not include `AGENT_TOKEN_SECRET`; the value was
  neither read nor created by this task.

## Human acceptance

No production Agent Token was created or requested in chat. No production plan
was previewed or changed. A live plan application requires the Athlete to
choose the future change and give the separate confirmation after seeing its
preview. Therefore no live reads, pagination/stale recovery, idempotent retry,
verified readback, or Gate Passage is claimed.

## Remaining write set

An authorized operator must separately deploy the current `main` Worker, apply
the pending D1 migration, set `AGENT_TOKEN_SECRET` through the interactive
Cloudflare Secret flow, and create/rotate a Token through the authenticated App.
Then the local onboarding and a fresh Codex task can run the read-only smoke and
the explicitly confirmed plan-update/readback scenario. The production write
set and the human confirmation remain outside this receipt.
