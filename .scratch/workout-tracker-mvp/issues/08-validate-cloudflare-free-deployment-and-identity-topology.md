# Validate the Cloudflare free deployment and identity topology

Type: research
Status: resolved

## Question

Using current official Cloudflare documentation, can Workers Static Assets, D1, Access email one-time PIN, two allowlisted Athlete identities, public Coach Share routes, private App/API routes, and an installable online-only Web App coexist in one free deployment, and what exact limits or topology constraints must the specification respect?

## Comments

- User context, not yet verified: a locally authenticated Wrangler CLI may already be available, and the user already has a Cloudflare account with a hosted domain. Account creation and domain migration are therefore outside this research question; later live setup should verify the active Wrangler identity before mutation.

## Answer

Current official Cloudflare documentation supports the proposed topology conditionally within Free-plan quotas: one Worker deployment can combine Static Assets, Worker API routes, and D1; one custom host can leave Coach Share paths public while Access protects exact Athlete paths; and two exact-email OTP identities fit the Access Free audience. The specification must require full Worker-side JWT validation, exact and wildcard Access path entries, disabled `workers.dev` and Preview URLs, public non-sensitive PWA assets, and live verification of account settings and quotas.

Detailed findings and primary-source citations: [Cloudflare Free Deployment and Identity Topology](../../../docs/research/cloudflare-free-deployment-and-identity-topology.md).
