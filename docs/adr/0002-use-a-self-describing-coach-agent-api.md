# Use a Self-Describing Coach Agent API

The coach is a ChatGPT Agent rather than a person browsing a dashboard. A Coach Share therefore exposes a permanent bearer-protected Markdown README plus a small, versioned read-only JSON interface instead of a human-facing coach dashboard.

The interface exposes both canonical records and App-computed metrics, with paginated full history and targeted detail resources. This adds a stable agent contract but removes dashboard design and prevents each Agent from having to infer endpoint usage or reimplement metric semantics.

The token remains valid until revoke or regeneration. Authentication identities, internal IDs, visitor data, excluded telemetry, and removed symptom data never cross this interface.
