# Personal Agent API v1

## Purpose

The Personal Agent API is the authenticated, single-Athlete capability for a
local Codex MCP adapter. It is separate from the unauthenticated Coach Share
API and uses one revocable Agent Token per Athlete.

The API returns structured data only. It does not accept an Athlete selector,
does not expose a generic HTTP proxy, and does not return coaching analysis.

## Authentication

Agent API requests send the Token only in the HTTP header:

```text
Authorization: Bearer <agent-token>
```

The Worker derives exactly one Athlete from the Token. Missing, malformed,
unknown, rotated, and revoked values return the same `401` error:
`agent_unauthorized`. The API never accepts `athlete`, `athlete_key`, or
`email` query selectors.

The Token is created, rotated, inspected, and revoked through the
authenticated App boundary:

```text
POST   /api/private/agent-access
GET    /api/private/agent-access
DELETE /api/private/agent-access
```

`POST` returns the complete Token only in that response. State and status
responses retain only a secret-backed lookup digest and lifecycle metadata.
Rotation invalidates the previous value immediately; revocation invalidates
the active value without creating a replacement.

## Agent discovery

```text
GET /api/agent/v1
```

The token-authenticated manifest identifies the Athlete display name and
timezone, unit conventions, freshness timestamps, `training_version`, safe
relative resource paths, and the explicit date rules. It contains no email,
database identity, digest, Token, Coach Share URL, or token-bearing URL.

The current read resources are:

```text
GET /api/agent/v1/overview
GET /api/agent/v1/plan
GET /api/agent/v1/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD[&expand=prescription]
```

The versioned wire shapes are defined in
[Agent API Wire Catalog v1](agent-api-wire-catalog-v1.md). Future Session,
progress, and Plan Update resources must extend this contract rather than
reuse private App routes.

## Read query rules

`overview` accepts the same inclusive period selectors as the existing domain
projection: `from` and `to` together, or one of `preset`/`range` with
`7d`, `30d`, `12w`, or `all`. The default is `30d`; `range` is an alias for
`preset`; a date window is mutually exclusive with either selector and is
bounded to 3660 days. Invalid selectors are rejected rather than ignored.

`schedule` requires `from` and `to` as inclusive Athlete-local dates and is
bounded to 366 days. `expand=prescription` adds deduplicated typed
prescriptions keyed by the stable `prescription_ref` already present on each
workout entry. The same plan revision and weekday therefore share one
prescription object across multiple dates.

All three resources preserve `data_as_of`, `training_version`, the relevant
Athlete-local period, and token-free `source_ref` values. Schedule expansion
uses the public prescription shape from the wire catalog; it never returns a
raw internal plan slot or revision identity.

## Response and privacy rules

Successful responses use structured JSON and include `schema_version`,
`generated_at`, and `data_as_of` where the resource contract requires them.
Athlete-local dates use `YYYY-MM-DD`; instants use RFC 3339 UTC. All responses
use private no-store caching and the existing security headers.

The API excludes login identity, Cloudflare identity, internal database IDs,
Token fields, digests, ciphertext, Coach Share management, Session mutation,
Athlete Settings mutation, goals, routes, symptoms, telemetry, and analysis.

## Configuration

Production requires the Worker Secret `AGENT_TOKEN_SECRET`. It must be set
through Wrangler Secret management and must never be committed, passed in a
command argument, or printed in logs. Local tests provide an explicit
test-only value through the fixture environment; production has no fallback.
