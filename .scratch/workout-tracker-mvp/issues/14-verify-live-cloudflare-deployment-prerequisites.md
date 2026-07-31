# Verify the live Cloudflare deployment prerequisites

Type: task
Status: resolved
Blocked by: 08

## Question

Using read-only, non-secret checks, verify the active Wrangler identity, Cloudflare account and zone, Workers and Zero Trust plan state, available Access seats and quotas, account-wide default-deny setting, Access team configuration, intended production host, and whether `workers.dev` and Preview URLs can be disabled as required.

## Comments

- Coach Share review adds live checks for explicit edge-cache bypass and the available path-redaction controls for request logs, analytics, tracing, and error reporting. No secret or full bearer URL may be printed during verification.
- Human-provided production host: `workout.lagrangee.xyz`; the parent zone `lagrangee.xyz` is already configured in the user's Cloudflare account. This remains to be verified through read-only account checks.

## Answer

Verified read-only on 2026-07-31. The intended host is `workout.lagrangee.xyz`, but the account is **not deployment-ready yet**:

- Wrangler `4.115.0` has an active OAuth identity with one unambiguous account. The account exposes the required Workers APIs.
- `lagrangee.xyz` is an active, full Cloudflare zone on the Free website plan. Workers is also on the current Free plan.
- The account currently contains three unrelated Workers. There is no `workout` Worker, Worker Custom Domain, Worker route, or DNS record for `workout.lagrangee.xyz`.
- Zero Trust has not been onboarded: the dashboard still presents **Get started**. Therefore there is no Access team configuration, identity provider, default-deny policy, protected application, or allocated Athlete users to verify. Available seats and quotas become verifiable only after the Free Zero Trust organization is created.
- The implementation can require `workers_dev: false` and `preview_urls: false` in Wrangler. These controls are supported by the installed Wrangler version. The production Custom Domain can then be bound directly to the Worker.
- Private and Coach Share responses must explicitly return `Cache-Control: no-store`; Worker caching should remain disabled for the gateway entrypoint. Omitting the header is unsafe because current Workers caching may apply heuristic freshness.
- Native Workers invocation logs include the request URL and new Workers enable observability by default. Because the Coach Share bearer may appear in the path, configure `observability.logs.invocation_logs: false`, never log raw request URLs/tokens, and keep traces/error metadata free of the raw path. Tail Worker request URLs are heuristically redacted by default, but that heuristic is defense-in-depth rather than the primary guarantee.

Before deployment, complete Zero Trust onboarding, add email one-time PIN, confirm at least two Athlete seats, create an exact-host Access application with default-deny plus the two Athlete identities, and deploy the Worker with the routing, cache, logging, `workers.dev`, and Preview URL controls above. No account setting was changed during this verification.
