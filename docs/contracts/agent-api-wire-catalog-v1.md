# Agent API Wire Catalog v1

## Agent access metadata

The authenticated App status response is:

```text
AgentAccessStatus = {
  active: boolean,
  created_at: Instant|null,
  rotated_at: Instant|null,
  revoked_at: Instant|null
}
```

The create/rotate response is:

```text
AgentAccessCreated = AgentAccessStatus & {
  token: string,
  copy_available: true
}
```

`token` is response-only. It is absent from status, revocation, serialized
Athlete state, D1 indexes, logs, exports, and MCP configuration committed to
the repository.

## Agent manifest

```text
AgentManifest = {
  schema_version: 1,
  generated_at: Instant,
  data_as_of: Instant,
  athlete: { display_name: string, timezone: IanaTimezone },
  timezone: IanaTimezone,
  unit_conventions: { resistance: "kg_per_implement", incline: "percent" },
  updated_at: { plan: Instant|null, training: Instant|null },
  training_version: integer,
  query_rules: object,
  links: { overview: string, plan: string, schedule: string },
  endpoints: object,
  capabilities: ["read", "plan:write"]
}
```

All link values are token-free relative Agent API paths. `capabilities` names
the personal Token scope; resource availability is still controlled by the
versioned API contract.

## Errors

```text
Error = { error: { code: string, message: string, details: object[] } }
```

Authentication failures use HTTP `401` and `agent_unauthorized`. Unsupported
methods use `405`; invalid selectors or request values use `400`; an absent
resource uses `404`; missing production configuration uses `503`.

`Instant` is an RFC 3339 UTC string. `IanaTimezone` is an IANA timezone name.
Unknown or inapplicable values are explicit `null`.
