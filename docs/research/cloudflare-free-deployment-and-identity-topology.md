# Cloudflare Free Deployment and Identity Topology

Reviewed against current first-party Cloudflare documentation on 2026-07-30.

> **Historical design research.** The implemented application uses its own
> signed-session authentication and does not require Cloudflare Access or OTP.
> Use `docs/deployment/self-hosting.md` as deployment authority. The Access
> topology below is retained only as an evaluated alternative.

This document records portable Cloudflare constraints, not the state of any
maintainer account. Zone names, Worker IDs, D1 IDs, login state, plan limits,
and deployment receipts are operator evidence and must be verified privately
for each self-hosted installation.

## Conclusion

The proposed production topology is viable:

- one Cloudflare Worker deployment serves the React/Vite static build, handles API routes, and accesses one D1 database through a binding;
- one custom host exposes public coach routes while Cloudflare Access protects only athlete routes;
- two athlete identities authenticate by emailed one-time PIN (OTP).

It can run at $0 **while all Free-plan quotas remain unexceeded**. This is a conditional feasibility finding, not a promise of permanently free service. Two low-traffic users are very likely to fit, but usage must be measured after deployment.

## Confirmed Cloudflare Facts

### One deployment for UI and API

Workers Static Assets deploys Worker code and static assets together as one integrated unit. Static assets are free and unlimited to request, have no additional storage charge, and can coexist with API handling in the Worker. A Vite SPA can use `not_found_handling: "single-page-application"` and route only `/api/*` through `assets.run_worker_first`. ([Static Assets overview](https://developers.cloudflare.com/workers/static-assets/), [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), [billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/))

Current Workers Free limits relevant here are:

- 100,000 Worker invocations/day, resetting at 00:00 UTC;
- 10 ms CPU/invocation, 128 MB memory, and 50 external subrequests/invocation;
- 20,000 static files/version and 25 MiB/file.

Static-only requests do not consume the dynamic-request quota unless configuration makes the Worker run first. If that quota is exhausted, matching `run_worker_first` requests receive an error rather than falling back to an asset. ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/))

### D1 Free limits

Workers Free currently includes:

- 5 million rows read/day;
- 100,000 rows written/day;
- 5 GB total account storage;
- at most 10 databases, 500 MB per database;
- 50 queries per Worker invocation;
- seven days of Time Travel.

Reads count rows scanned, not rows returned, and indexes themselves consume storage and add writes. On Free, exceeding daily read/write limits makes D1 queries fail until the 00:00 UTC reset; reaching storage limits blocks further schema/data growth until space is freed or the plan is upgraded. ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/))

### Access Free, seats, and OTP

Cloudflare's current Access pricing page lists the Free plan as `$0 forever`, intended for teams under 50 users. An identity consumes one seat after an Access authentication event and uses only one seat regardless of the number of applications or logins. The two athletes therefore fit the stated Free-plan audience. ([Access pricing](https://www.cloudflare.com/sase/products/access/), [seat management](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/))

OTP can be configured as an identity provider. Cloudflare sends a single-use PIN only when the submitted email is allowed by the application's Access policy; the PIN expires ten minutes after request. The policy must use an `Emails` selector containing the two exact addresses. An `Include: Login Methods = One-time PIN` rule would allow **every valid email** and must not be used as the allowlist. ([OTP login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/))

## Same-host Route Topology

Cloudflare Access can protect selected paths rather than an entire hostname. It supports multiple application domains in one self-hosted application, and more-specific path rules take precedence. Importantly, `host/app/*` does **not** match `host/app` itself. ([application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), [authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/))

Recommended single host, for example `workout.example.com`:

| Path | Edge policy | Worker responsibility |
| --- | --- | --- |
| `/app` and `/app/*` | Access Allow: either exact athlete email | Serve SPA; no private data embedded in assets |
| `/api/private` and `/api/private/*` | Same Access application/policy | Validate Access JWT, derive athlete, then query D1 |
| `/coach/*` | Public | Serve SPA route; bearer token is not interpreted here |
| `/api/coach/*` | Public | Validate coach-share token and return read-only projection |
| `/manifest.webmanifest`, icons, shared JS/CSS | Public static assets | Contain no credentials or private data |

Put the four protected exact/wildcard entries into one self-hosted Access application so they share one Application Audience (`aud`) tag. Do not protect the whole hostname and then try to "undo" it for coach routes.

Normally, paths with no matching Access application remain public. However, an account can enable **Block traffic to all domains**. If enabled, unmatched public paths are blocked too; public paths then need deliberately scoped Bypass application entries, or that account-wide setting must remain off for this host. This setting must be inspected before implementation. ([Require Access protection](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/require-access-protection/))

### Required origin-side identity validation

For an authenticated request, Access adds an application token in `Cf-Access-Jwt-Assertion`. Cloudflare explicitly says a Worker behind Access still has to validate it. Presence of the header, or merely passing through Cloudflare, is insufficient.

For every `/api/private/*` request, the Worker must:

1. reject a missing assertion;
2. fetch/cache the account JWKS from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`;
3. verify the RS256 signature, issuer, expiry/not-before constraints, and this application's `aud`;
4. use the email only from the verified payload and map it to the Athlete.

Cloudflare rotates signing keys by default every six weeks, so keys must be fetched programmatically rather than pinned. ([Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/))

The production Worker should also set `workers_dev: false` and disable Preview URLs. Otherwise the same Worker may remain reachable at an address that is outside the custom-host Access paths. ([workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/))

## Online-only Installable PWA

**Confirmed:** Workers Static Assets supplies HTTPS-hosted, globally cached assets, while Access browser sessions use the `CF_Authorization` cookie and reauthenticate after session expiry. ([Static Assets overview](https://developers.cloudflare.com/workers/static-assets/), [authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/))

**Inference:** This topology does not prevent an installable PWA, but Cloudflare does not define or guarantee browser installation criteria. Keep the manifest, icons, and any no-cache service-worker script public; set the installed `start_url` to `/app/`. Opening the installed app without a valid Access session will require network access and an OTP login. Do not cache private API responses or claim offline behavior.

**Acceptance requirement:** verify installation and expired-session launch on each target mobile browser. An install prompt or Add-to-Home-Screen behavior cannot be accepted from Cloudflare deployment evidence alone.

## Historical Access-topology inputs

- Create the production D1 database and select its data-location preference.
- Onboard Zero Trust Free, then confirm at least two available Access seats and remaining D1/Worker quota.
- Inspect whether account-wide **Block traffic to all domains** is enabled.
- Configure the two exact athlete emails, OTP identity provider, Access team domain, application `aud`, and session duration.
- Bind the operator's exact custom hostname as the sole production domain;
  disable `workers.dev` and Preview URLs.
- Add quota monitoring for Worker invocations, CPU, D1 rows read/written, and storage. Index athlete/time/token lookup columns to prevent full-table scans.
