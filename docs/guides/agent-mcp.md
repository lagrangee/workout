# Workout Agent MCP setup

The local MCP bridge reads a local configuration file from the user's home
directory. Credentials never belong in the repository, a Codex conversation,
or command-line arguments.

## Create the local configuration

The Worker must already be deployed with migration
`0005_agent_token_lookup.sql`, `AGENT_TOKEN_SECRET`, and an Agent Token created
through the authenticated Workout application.

```bash
mkdir -p "$HOME/.config/workout-agent"
umask 077
touch "$HOME/.config/workout-agent/agent.env"
chmod 600 "$HOME/.config/workout-agent/agent.env"
"${EDITOR:-vi}" "$HOME/.config/workout-agent/agent.env"
```

The first two keys are required. `WORKOUT_ARCHIVE_DIR` is optional and points
to an existing private Training Archive when local archive tools are needed:

```text
WORKOUT_AGENT_API_ORIGIN=https://workout.example.com
WORKOUT_AGENT_TOKEN=<token-created-in-the-authenticated-app>
WORKOUT_ARCHIVE_DIR=/absolute/path/to/private/archive
```

Omit `WORKOUT_ARCHIVE_DIR` when the bridge should expose only the remote Agent
API tools.

`mcp/launch.mjs` rejects files that are not owner-only, unknown or duplicate
keys, and missing required values without printing the credential.

## Register the bridge

From the repository root:

```bash
codex mcp add workout \
  --env WORKOUT_AGENT_CONFIG_FILE="$HOME/.config/workout-agent/agent.env" \
  -- node "$PWD/mcp/launch.mjs"
```

Use `codex mcp get workout` and `codex mcp list` to inspect registration. Start
a new client process after changing the configuration; an existing process does
not hot-reload MCP configuration.

## Verify and maintain access

Start with read-only overview, plan, schedule, Session, progress, and exercise
history calls, followed by a non-mutating Plan Update preview. Applying a real
Plan requires a complete preview and a separate Athlete confirmation.

Rotate the token in the authenticated application, update only the owner-readable
local file, and start a new client process. A revoked token returns
`agent_unauthorized`; transport and authorization errors must never echo the
token. Keep real smoke-test results outside the repository.
