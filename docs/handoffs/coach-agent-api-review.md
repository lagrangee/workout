# Coach Agent API Review Handoff

## Review Goal

Review the attached `coach-agent-api-v1.md` as a senior API and agent-product designer. Determine whether a ChatGPT Agent can reliably discover, query, interpret, and cite one Athlete's workout plan and training history with minimal calls and no undocumented assumptions.

This is a design review only. Do not implement the API.

## Product Context

The App serves two isolated Athletes. Each Athlete manages one repeating Monday–Sunday Weekly Template, Workout Sessions, Actual Training Data, Exercise Feedback, and progress metrics. Strength Resistance is bodyweight, external weight, or assisted weight; numeric load is always kg per implement. Treadmill target incline is always percent.

The “coach” is exclusively a ChatGPT Agent. A Coach Share is a permanent read-only bearer capability:

- `/coach/:token` returns a README-style Markdown discovery document.
- Linked versioned JSON endpoints expose plan, schedule, Sessions, progress, and exercise detail.
- The token remains valid until revoked or regenerated.
- All historical Sessions are available through pagination; there is no 90-day cutoff.
- The API returns both canonical raw records and the exact metrics computed by the App.

## Confirmed Boundaries

Treat these as product decisions, not open suggestions:

- No human-facing coach dashboard or coach account.
- No expiration date, access analytics, visitor log, or realtime updates.
- No mutation through Coach Share.
- No training goals, route background, coaching analysis, AI recommendations, or automatic plan changes.
- No Endurance Telemetry: distance, pace, heart rate, elevation, moving/stopped time, or watch imports.
- No Body Feedback or symptom system.
- Session notes and optional per-exercise Exercise Feedback are shared.
- Login email, Cloudflare identity, internal database IDs, token fields, and visitor information remain private.
- The App is online-only and deployed as one Cloudflare Worker with Static Assets, D1, and Cloudflare Access protecting Athlete routes.

## Review Target

Canonical contract:

`docs/contracts/coach-agent-api-v1.md`

Supporting decision:

`docs/adr/0002-use-a-self-describing-coach-agent-api.md`

Domain vocabulary:

`CONTEXT.md`

## Questions to Stress-Test

1. Can an unfamiliar ChatGPT Agent determine the correct request sequence from the README without human explanation?
2. Are the resources deep and coherent, or are important capabilities fragmented or duplicated?
3. Are plan revisions, midweek effective dates, dated schedule projection, Session snapshots, corrections, and overdue workouts unambiguous?
4. Can pagination and filters retrieve all history exactly once under normal concurrent corrections?
5. Are date, timezone, units, nullable values, stable keys, and terminal Session Outcome semantics precise?
6. Are the permanent bearer-link protections proportionate and complete for Cloudflare deployment?
7. Does schema evolution allow safe Agent clients without weakening the strict Plan Update Package import contract?
8. Are any endpoints, fields, error cases, or acceptance tests missing?
9. Could the same useful result be achieved with fewer Agent requests or a smaller public interface?

## Known Follow-Up Dependencies

Do not mistake these for defects unless the API contract blocks their later resolution:

- Exact Athlete timezone and date-boundary behavior will be finalized separately.
- The nested plan/session data schema will receive a final cross-contract reconciliation.
- Cloudflare account identity, domain, Access application paths, D1 availability, quotas, and Wrangler login still require live verification.

## Requested Response Format

Lead with findings, ordered by severity:

- `Critical`: unsafe or impossible to implement/use correctly.
- `Important`: material ambiguity, agent failure mode, or unnecessary interface complexity.
- `Minor`: useful polish that does not change the model.

For each finding, quote the affected heading, explain a concrete failure scenario, and propose exact replacement wording or interface shape. Then provide:

1. a short overall verdict;
2. a minimal revised endpoint catalog if changes are recommended;
3. unresolved questions that genuinely require the product owner's decision.

Avoid reopening confirmed boundaries solely as preference.
