# Define Coach Share contents and privacy surface

Type: grilling
Status: resolved

## Question

Which future-plan, session, progress, endurance, Body Feedback, route, identity, and metadata fields appear in the permanent Coach Share page and JSON, and which must remain private?

## Comments

- Human decision: the coach is a ChatGPT Agent, not a human dashboard viewer. `/coach/:token` is a concise README-style discovery surface that documents linked read-only JSON endpoints, their semantics, parameters, and examples. All history is accessible without a 90-day cutoff, but list endpoints paginate. The authenticated Athlete UI only creates, copies, revokes, and regenerates the permanent bearer capability.
- Human decision: the API exposes both canonical source data—Weekly Templates, Workout Sessions, Training Plan Snapshots, Actual Training Data, and Exercise Feedback—and the same derived progress metrics used by the App. The Agent may inspect raw history without reimplementing completion, streak, and trend semantics.
- Human decision: responses may identify the Athlete by display name and expose Athlete timezone, fixed unit conventions, generation time, and latest plan/training update times. Login email, Cloudflare identity, internal database IDs, the bearer token, and visitor information remain private; API-scoped stable opaque keys provide cross-response references.
- Human decision: Session history uses stable cursor pagination, newest Athlete-local training date first, with default 50 and maximum 200 items. Optional `from`, `to`, `status`, and `exercise_key` filters are bound into the cursor; invalid, expired, or mismatched cursors return an explicit `400`. A null `next_cursor` marks the end.
- Human decision: `/plan` exposes the applicable and confirmed future Weekly Templates, while `/schedule` expands any requested inclusive date range up to 366 days. Historical execution uses Training Plan Snapshots rather than today's template.
- Human direction: complete the remaining ChatGPT-oriented API design within these confirmed boundaries without further field-by-field questions.

## Answer

Coach Share is an agent-facing capability, not a human dashboard. The copied permanent bearer URL opens a Markdown README that teaches a ChatGPT Agent how to discover and call a versioned, GET-only JSON interface. The authenticated Athlete surface only shows status, creation time, the copyable URL, revoke, and regenerate; there are no expiry controls, access analytics, downloads, or coach UI.

The interface exposes both canonical raw data and App-computed semantics: current and confirmed-future Weekly Templates, bounded dated schedule projections, all historical Workout Sessions through cursor pagination, full Session detail with Training Plan Snapshot and latest Actual Training Data, Exercise Feedback, canonical progress metrics, and exercise-specific trends. History has no 90-day cutoff. Session notes and Exercise Feedback are intentionally shared.

The API may expose Athlete display name, timezone, fixed unit conventions, data timestamps, human-readable `exercise_key`, and API-scoped opaque reference keys. It never exposes login email, Cloudflare identity, internal database IDs, bearer-token fields, visitor information, goals, route background, coaching analysis, Endurance Telemetry, Body Feedback, or Symptom Logs.

Responses use a versioned additive schema, explicit date/unit conventions, stable filtered cursor pagination, uniform errors, and `no-store`, `noindex`, `nofollow`, and `no-referrer` protections. Invalid, revoked, and regenerated tokens are indistinguishable `404`s, and regeneration atomically invalidates the old capability.

Implementation contract and acceptance cases: [Coach Agent API v1](../../../docs/contracts/coach-agent-api-v1.md). Architectural rationale: [Use a Self-Describing Coach Agent API](../../../docs/adr/0002-use-a-self-describing-coach-agent-api.md).
