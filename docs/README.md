# Documentation

Start with the documents that describe the product and its stable boundaries:

- [Product direction](product.md)
- [Architecture and authority boundaries](architecture.md)
- [Domain model](domain-model.md)
- [Design system](design-system.md)

For operating or extending Workout Tracker:

- [Self-hosting on Cloudflare](deployment/self-hosting.md)
- [Workout Agent MCP setup](guides/agent-mcp.md)
- [Source validation](validation.md)
- [Recovery runbooks](recovery/)

The files under [`contracts/`](contracts/) are versioned behavior and wire
contracts. The short records under [`adr/`](adr/) explain durable architecture
decisions. Implementation plans, review handoffs, private receipts, and local
agent configuration are intentionally kept outside the public source tree.
