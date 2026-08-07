# Workout Agent Access and Plan Update Specification

Label: ready-for-agent

## Problem Statement

An Athlete wants a ChatGPT Agent running through Codex to read the Athlete's
current training plan, dated schedule, Workout Session history, progress
metrics, and exercise history so that the Agent can provide useful analysis
without requiring repeated manual exports or pasted Coach Share URLs.

The current Coach Share is intentionally a permanent, bearer-protected,
read-only capability. It cannot update a plan. The current plan-update flow is
protected by the application's signed session and is designed for the App's
authenticated surface. There is no narrow Agent-facing capability that combines
safe read access with a deliberately confirmed future plan update.

The missing boundary is therefore not an analysis prompt. It is a small
Agent-facing API, a local MCP adapter that can call it, and a thin Skill that
describes safe tool selection without prescribing how the Agent must write its
analysis.

## Solution

Add a separate versioned Agent API under `/api/agent/v1/*`. It authenticates one
Athlete through one revocable Agent Token sent in the `Authorization` header.
The API exposes only the agreed read resources and a two-stage future Plan
Update Package flow. It never exposes a generic HTTP proxy, Athlete selector,
Coach Share management, Session mutation, or server-generated coaching advice.

Provide a local MCP adapter for Codex. The adapter calls the deployed Agent
API over HTTPS, maps typed MCP tools to the Agent API, preserves structured
JSON and provenance metadata, and does not contain domain logic or credentials
in the repository.

Provide a thin Workout Agent Skill in the project integration package. The
Skill teaches the Agent which read tool to use, how to respect date ranges and
pagination, how to avoid reproducing credentials, and how to require a
separate explicit user confirmation before calling the plan-apply tool. It does
not mandate a fact/inference/recommendation response format; the Agent owns
that presentation decision.

The existing Coach Share API remains read-only and unchanged as a separate
public capability. The Agent API reuses the existing domain projections,
validation, transaction, and metric semantics rather than creating a second
training data model.

## User Stories

1. As an Athlete, I want to create an Agent Token from an authenticated App surface, so that Codex can access my training data without storing my password.
2. As an Athlete, I want to see whether Agent access is enabled without seeing the existing Token again, so that I can understand connection state without exposing a credential.
3. As an Athlete, I want to rotate the Agent Token, so that a lost local configuration can be invalidated and replaced.
4. As an Athlete, I want to revoke Agent access, so that the local MCP adapter can no longer read or change my data.
5. As an Athlete, I want the full Agent Token returned only at creation or rotation, so that the server never needs to recover or display a plaintext credential.
6. As an Athlete, I want the Agent Token to be scoped to my one Athlete identity, so that an Agent request cannot choose another Athlete through a parameter.
7. As an Athlete, I want Agent access to use a simple bearer header rather than OAuth, so that a personal Codex integration remains easy to configure.
8. As an Athlete, I want the existing Coach Share to remain separate, so that a read-only URL cannot accidentally become a plan-writing credential.
9. As an Athlete, I want to configure the local MCP adapter with the deployed API origin and Agent Token, so that Codex can call the service without credentials in the repository or chat.
10. As a Coach Agent, I want to retrieve one overview containing current plan context, coverage, freshness, and recent evidence, so that ordinary analysis starts from a bounded and trustworthy context.
11. As a Coach Agent, I want to retrieve the current and future effective Weekly Templates, so that I can explain what is prescribed now and what will change later.
12. As a Coach Agent, I want to retrieve an Athlete-local schedule for an explicit inclusive date range, so that date boundaries are not inferred from UTC or an unbounded request.
13. As a Coach Agent, I want to request a schedule with resolved prescriptions when needed, so that I can compare prescribed work with execution without requiring a second undocumented query.
14. As a Coach Agent, I want to list Workout Sessions by date, status, and Exercise, so that I can focus analysis on a meaningful subset of history.
15. As a Coach Agent, I want Session listing to use bounded pages and opaque cursors, so that a long history does not become one oversized or ambiguous response.
16. As a Coach Agent, I want to retrieve one complete Workout Session with its immutable Training Plan Snapshot and Actual Training Data, so that I can distinguish prescribed intent from what the Athlete actually recorded.
17. As a Coach Agent, I want progress metrics with numerator, denominator, exclusions, and contributing references, so that a percentage or average is explainable rather than a bare number.
18. As a Coach Agent, I want exercise history with display-name history, resistance semantics, sides, repetitions or duration, and contributing Sessions, so that movement-level trends remain faithful to the domain model.
19. As a Coach Agent, I want every projected response to identify `data_as_of`, the Athlete-local period, and safe source references, so that I can state how current and grounded the analysis is.
20. As a Coach Agent, I want the API to identify a training-version change during pagination, so that I do not silently combine pages from incompatible reads.
21. As a Coach Agent, I want common overview and progress requests to use bounded defaults while allowing explicit full-history requests, so that routine analysis is efficient without hiding older evidence.
22. As an Athlete, I want to describe a future plan change in natural language to the Agent, so that I do not have to hand-author the complete wire package.
23. As a Coach Agent, I want to read the current plan before constructing an update, so that unspecified existing slots can be preserved deliberately rather than guessed.
24. As an Athlete, I want a missing field for a new or changed prescription to trigger a clarification request, so that the Agent does not invent a load, target, set count, or timing.
25. As a Coach Agent, I want to submit a structured complete Plan Update Package for validation, so that the server can retain the strict schema, unknown-field rejection, and no-op rules of Plan Update Package v1.
26. As an Athlete, I want validation errors to identify the invalid package without mutating the Current Plan, so that I can repair a draft safely.
27. As an Athlete, I want validation to return a full human-readable preview and a concise change summary, so that I can understand the effective date and resulting week before application.
28. As an Athlete, I want the Agent to wait for a separate explicit confirmation after showing the preview, so that a conversational suggestion cannot silently mutate my plan.
29. As a Coach Agent, I want plan application to require the preview's package and base-plan digests, so that an old proposal cannot be applied after the Current Plan changes.
30. As an Athlete, I want a stale-plan conflict to stop the application and trigger a fresh read, so that the Agent cannot overwrite a newer plan decision.
31. As a Coach Agent, I want plan application to use an idempotency key, so that a transport retry cannot create duplicate Plan Revisions.
32. As an Athlete, I want a successful plan application to be read back through the Agent API, so that the Agent can verify the resulting Current Plan and future schedule.
33. As a Coach Agent, I want to receive structured data rather than Markdown-only responses, so that I can choose an analysis format appropriate to the question.
34. As a Coach Agent, I want safe source references and data metadata without token-bearing URLs, so that evidence can be discussed without reproducing a credential.
35. As an Athlete, I want ordinary reads to have no side effects, so that asking for analysis cannot create Sessions, alter metrics, or change the Plan.
36. As an Athlete, I want the Agent-facing surface to exclude Session correction, start/end/skip commands, Athlete Settings, and Coach Share management, so that the first integration remains narrowly focused.
37. As an Operator, I want Agent API errors to preserve stable status and error semantics, so that the MCP adapter can report authentication, invalid input, stale state, rate limit, and server failures without guessing.
38. As an Operator, I want cross-Athlete isolation tested through the same Worker HTTP boundary as the existing application, so that the new authentication mode cannot bypass the established identity boundary.
39. As an Operator, I want the MCP adapter to remain a thin transport mapping, so that domain invariants and validation are tested once at the highest existing seam.
40. As an Operator, I want automated tests plus a real Codex smoke flow, so that an apparently green local adapter is not treated as proof that the deployed integration works.

## Implementation Decisions

- **Capability boundary:** Introduce a distinct Agent API namespace and
  authentication path. The Agent API derives the Athlete only from the Agent
  Token and never accepts an Athlete identifier. It does not reuse the public
  Coach Share route for writes or expose the broader private application route.

- **Agent Token lifecycle:** Maintain at most one active Agent Token per
  Athlete. Authenticated App operations create or rotate it, return the
  plaintext value only in that response, expose status without the value, and
  revoke it on request. A new rotation immediately invalidates the old value.
  The persisted state contains only a secret-backed lookup digest and the
  minimum lifecycle metadata needed for status and revocation; it never stores
  the plaintext Token.

- **Agent Token capability:** The first version uses one personal Token with
  the agreed `read` and `plan:write` capabilities. It does not introduce
  multi-token management, OAuth, multi-Athlete routing, or a general RBAC
  system.

- **Transport:** The local MCP adapter reads the API origin and Token from
  local MCP configuration/environment and sends HTTPS requests with
  `Authorization: Bearer`. Neither value is committed, embedded in the Skill,
  or requested from the user in chat.

- **MCP surface:** Expose exactly these typed tools: `workout_get_overview`,
  `workout_get_plan`, `workout_get_schedule`, `workout_list_sessions`,
  `workout_get_session`, `workout_get_progress`,
  `workout_get_exercise_history`, `workout_validate_plan_update`, and
  `workout_apply_plan_update`. Do not expose a generic method/path/body tool or
  a server-side `analyze` tool.

- **Tool response shape:** Preserve structured JSON and the domain's existing
  snake_case wire semantics. Projected responses retain `data_as_of`, date or
  period context, safe `source_ref` values, training-version metadata where
  relevant, metric evidence, and opaque pagination cursors. The MCP adapter
  may normalize transport errors but must not reinterpret domain values.

- **Read defaults:** Use the existing bounded overview/progress defaults and
  the existing exercise-history default. Schedule reads require an explicit
  inclusive range. Full Session history is requested explicitly through
  bounded pagination rather than fetched without a limit.

- **Pagination consistency:** Preserve the existing cursor filters, immutable
  ordering, expiry, and version-change semantics. If the underlying training
  version changes during a traversal, the adapter or Skill restarts from page
  one instead of claiming exactly-once membership.

- **Analysis ownership:** The Agent API and Skill provide data, provenance, and
  safety rules only. The Agent independently chooses whether to present facts,
  trends, hypotheses, or recommendations. No fixed three-layer output format
  is a contract requirement.

- **Plan update input:** MCP accepts a structured Plan Update Package value.
  The adapter serializes it for the existing strict Plan Update Package v1
  validator. Natural-language interpretation occurs in the Agent before the
  tool call; the API does not parse natural-language coaching requests.

- **Plan update semantics:** An update is always a complete seven-day Weekly
  Template with a future `effective_from`. The Agent reads the current plan,
  preserves unspecified existing values deliberately, and asks for missing
  information required to construct a valid new prescription. It never silently
  repairs, defaults, clamps, or invents package fields.

- **Validation/application flow:** Validation is non-mutating and returns the
  complete result preview, changed-slot summary, `package_digest`, and the
  digest/version of the Current Plan used as its base. Application requires the
  same digests, an explicit `confirmed: true`, and an idempotency key. The
  server revalidates the package and base before atomically appending one Plan
  Revision. A stale base or changed package is rejected without a write.

- **Confirmation boundary:** The Skill instructs the Agent to show the
  effective date, change summary, and complete resulting week, then wait for a
  separate explicit user confirmation before invoking application. The MCP
  tool cannot be called as a combined proposal-and-apply action.

- **Readback:** After a successful application, the Agent reads the Current
  Plan and the affected Schedule again. The user-visible result reports the
  applied effective date and the readback status, not a claim based only on the
  mutation response.

- **Reuse of domain logic:** Agent projections, progress metrics, Exercise
  history, Plan Update Package validation, Plan Revision precedence, D1
  transactions, and idempotency reuse the existing domain modules and
  invariants. The integration adds an access and transport boundary instead of
  a second plan or Session model.

- **Security behavior:** Agent responses use no-store and the same relevant
  security headers as the application's private surfaces. Token-bearing URLs,
  plaintext Tokens, passwords, internal database identities, and Athlete
  selectors never appear in Agent-visible output or application logs. Coach
  Share safety rules remain unchanged.

- **Error behavior:** Authentication failure, revoked Token, invalid package,
  stale plan, idempotency conflict, unsupported operation, rate limit, and
  server failure use stable typed errors. The MCP adapter reports these errors
  without retrying a stale write or silently converting a failure into success.

- **Thin Skill:** The Skill documents the read-first flow, bounded date and
  pagination rules, evidence/freshness handling, Token non-disclosure, and
  validate/confirm/apply/re-read behavior. It does not contain secrets, domain
  calculations, a fixed coaching voice, or a mandatory analysis template.

- **Implementation seams:** The highest behavior seam is the existing Worker
  HTTP handler with the local Athlete/D1 fixture. Agent API authentication,
  route behavior, projections, mutation guards, and isolation are verified at
  that boundary. The MCP adapter has one narrow HTTP transport-mapping seam and
  does not duplicate domain tests.

## Testing Decisions

- Tests assert externally observable HTTP and MCP behavior rather than private
  helper structure, storage layout, or a particular implementation class.

- The primary integration seam is the existing Worker handler and local store
  fixture used by the current core, boundary, and authentication tests. This
  keeps Agent API behavior under the same identity and transaction boundary as
  the existing App and Coach API.

- Agent authentication tests cover creation/rotation/revocation, one active
  Token, invalid and revoked Tokens, missing headers, Athlete isolation, and
  the fact that Agent authentication cannot reach excluded private operations.

- Read contract tests cover overview, plan, schedule ranges and prescription
  expansion, Session filters and pagination, Session detail, progress evidence,
  exercise history, freshness metadata, safe source references, and bounded
  errors. They cover empty data, current-date incompleteness, invalid ranges,
  missing resources, and cross-Athlete isolation.

- Plan update tests cover typed package serialization, all required fields,
  strict validation, missing information, unknown fields, no-op packages,
  future effective dates, preview contents, package/base digests, stale-plan
  rejection, explicit confirmation, atomicity, and idempotent replay/conflict.

- Pagination tests cover filter-bound cursors, expiry, invalid cursors, version
  changes between pages, and restart behavior. Tests must not treat a cursor
  as a historical snapshot.

- MCP adapter tests use one fake HTTP transport boundary to verify tool-to-route
  mapping, header handling, structured response preservation, cursor handling,
  and error mapping. Domain metric and Plan validation behavior is tested only
  through the Worker HTTP seam.

- Security tests verify that logs and responses never expose the Agent Token,
  Coach Share URL, password, internal database identity, or an Athlete selector.

- A live smoke acceptance covers local MCP configuration, overview, plan,
  Session/progress reads, a validated plan preview, an explicitly confirmed
  application, and post-application readback against the deployed API.

- Release reporting separates automated tests, local smoke, deployed smoke,
  and human acceptance. A green test run, zero diagnostics, a receipt, or a
  visible screen state alone is not a Gate Passage.

## Out of Scope

- OAuth, remote MCP hosting, multi-client distribution, multi-Athlete routing,
  multiple active Agent Tokens, or a general permission/RBAC system.
- A generic HTTP proxy, arbitrary API method tool, direct D1 access, or direct
  Worker-state access from the MCP adapter.
- Server-generated coaching analysis, recommendation ranking, medical advice,
  fixed analysis formatting, or a Skill-controlled coaching voice.
- Starting, ending, skipping, continuing, restarting, or correcting Workout
  Sessions through the Agent API.
- Updating Athlete Settings through the Agent API.
- Creating, rotating, revoking, or retrieving Coach Shares through the Agent
  API.
- A manual plan editor, partial Patch API, natural-language plan parser on the
  server, automatic progression rules, or silently completed Plan Update
  Package fields.
- Exposing all historical internal Plan Revisions as an Agent resource.
- Offline MCP queues, deferred writes, background sync, scheduled Agent jobs,
  watch integration, Endurance Telemetry, goals, routes, symptoms, social
  features, or household views.

## Further Notes

This specification is a new integration scope alongside the existing Coach
Agent API; it does not redefine the Coach Share contract. The existing
read-only Coach API remains the safe public capability for an unauthenticated
ChatGPT Agent, while the new Agent API is the authenticated personal capability
for Codex and the local MCP adapter.

The implementation should update the relevant Agent API contract, schema
catalog, domain state contract, migration, and release acceptance documentation
together. It must preserve the glossary terms in `CONTEXT.md`, especially
Athlete, Current Plan, Weekly Template, Plan Revision, Scheduled Workout,
Workout Session, Training Plan Snapshot, Actual Training Data, and Agent Token.

The user's confirmation of the design establishes shared understanding, but it
does not by itself prove implementation, deployment, or human acceptance.
