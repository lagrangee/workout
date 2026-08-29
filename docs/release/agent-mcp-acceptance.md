# Agent MCP acceptance

## Automated source evidence

The source gate checks the typed bridge, launcher, onboarding configuration,
Agent API behavior, and non-mutating Plan Update preview against synthetic
fixtures. It requires no deployed origin or Agent Token.

## Operator smoke

After self-hosting, create or rotate an Agent Token through the authenticated
App and store it only in the owner-readable local configuration described by
the onboarding guide. In a fresh client process, verify overview, plan,
schedule, Session, progress, and exercise-history reads without printing the
payload or token.

Any real Plan application requires a full preview and a separate Athlete
confirmation. Record sanitized endpoint/status results outside the repository.
MCP registration, a live read, or a green source test does not by itself claim
a release or authorize a Plan write.
