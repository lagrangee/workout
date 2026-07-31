# Make the Workout Tracker MVP implementation-ready

Label: wayfinder:map
Status: resolved

## Destination

Produce a human-confirmed MVP product and technical contract that can be handed directly to implementation: product boundaries, domain language, interaction and state rules, data invariants, API and security behavior, Cloudflare architecture, and acceptance criteria are internally consistent and precise.

## Notes

- This effort plans and validates the complete release; implementation and deployment are tracked as ready-for-agent tickets, while external publication still requires the confirmed repository target and credentials.
- Read `CONTEXT.md` and relevant ADRs before working a ticket. The attached replacement brief is the source input, not unquestioned scope authority.
- Use `/grilling` and `/domain-modeling` for product decisions, `/prototype` for interaction decisions, and `/research` with primary sources for external facts.
- The App serves two isolated Athletes, ships as an online-only installable Web App, and does not require phased delivery.
- Confirmed boundaries already captured in `CONTEXT.md` and `docs/adr/` remain canonical unless a ticket explicitly reopens them.

## Decisions so far

<!-- One linked gist per resolved child ticket. -->

- [Define terminal-session editing and correction rules](issues/01-define-terminal-session-editing-and-correction-rules.md) — Actual Training Data remains correctable without altering the Training Plan Snapshot; skipped and same-day partial Sessions resume in place, while summed Training Intervals exclude gaps between separate training periods.
- [Define rest days, streaks, and progress metrics](issues/02-define-rest-days-streaks-and-progress-metrics.md) — Rest Days are neutral, due-workout and streak semantics are Athlete-local, progress uses a small range-aware metric set, and watch-owned Endurance Telemetry is excluded.
- [Define body-feedback capture and association](issues/03-define-body-feedback-capture-and-association.md) — The scored Body Feedback system is removed in favor of one usually-absent, optional free-text Exercise Feedback per exercise and Session.
- [Define future-plan editing and revision application](issues/04-define-future-plan-editing-and-revision-application.md) — The Plan page is read-only; pasted JSON is the only update path, applies strictly to future dates as one atomic full-template revision, and confirms through the resulting human-readable week rather than technical diffs.
- [Resolve conditional Plan Seed rules and JSON import semantics](issues/05-resolve-conditional-plan-seed-rules-and-json-import-semantics.md) — A strict v1 package replaces one seven-slot Weekly Template that repeats until superseded; it carries only structured plan content and rejects all ambiguous, invalid, oversized, or no-op imports.
- [Define Coach Share contents and privacy surface](issues/06-define-coach-share-contents-and-privacy-surface.md) — Coach Share is a permanent self-describing ChatGPT Agent API with full paginated history, canonical plan and metrics, explicit privacy exclusions, and no human coach dashboard.
- [Define Athlete settings, units, and date boundaries](issues/07-define-athlete-settings-units-and-date-boundaries.md) — Athlete Settings contain only display name and timezone; resistance uses fixed kg semantics, telemetry units stay excluded, and Athlete-local due/history boundaries are immutable and precise.
- [Validate the Cloudflare free deployment and identity topology](issues/08-validate-cloudflare-free-deployment-and-identity-topology.md) — The single-Worker topology is conditionally viable on current Free plans, with exact-path Access, origin JWT validation, bypass prevention, and live account checks required.
- [Define export scope and schema guarantees](issues/09-define-export-scope-and-schema-guarantees.md) — Athlete Export is one privacy-filtered, point-in-time, full-history JSON with stable portable keys, independent schema versioning, and no CSV or restore workflow.
- [Prototype the mobile training-execution flow](issues/10-prototype-the-mobile-training-execution-flow.md) — Use the refined one-item focus flow with prefilled completion, visible prescribed-versus-actual values, global progress navigation, same-day partial continuation, progress-aware rest, explicit correction targets, and a fixed-action end screen with RPE guidance and unfinished-item listing.
- [Prototype the JSON plan update flow](issues/11-prototype-the-json-plan-update-flow.md) — Keep the normal weekly Plan primary and perform the Agent-generated JSON update in a bottom sheet with simple Agent-copyable errors, a complete human-readable week preview, and a pending-effective-date return state.
- [Reconcile the data model, API, and acceptance contract](issues/12-reconcile-the-data-model-api-and-acceptance-contract.md) — One consolidated implementation contract now owns the canonical entities, strict Plan and Session inputs, exact independent Coach and Export read shapes, state transitions, metrics, security, Cloudflare constraints, recovery, and the release acceptance contract.
- [Review the implementation-ready MVP handoff](issues/13-review-the-implementation-ready-mvp-handoff.md) — The handoff is ready for local implementation; the accepted prototypes remain the UI reference, accessibility is explicitly outside MVP scope, and Cloudflare setup remains a deployment gate rather than a planning blocker.
- [Verify the live Cloudflare deployment prerequisites](issues/14-verify-live-cloudflare-deployment-prerequisites.md) — The active Free zone and Workers account are usable, but deployment is gated on Zero Trust onboarding and explicit Access, routing, cache, logging, workers.dev, and Preview URL controls for `workout.lagrangee.xyz`.
- [Decide whether the MVP records ad-hoc Sessions](issues/15-decide-whether-mvp-records-ad-hoc-sessions.md) — Every Session remains bound to one Scheduled Workout; plan-free training is unrecorded, substitutions and extra work are note-only, and metrics reflect prescribed work without compensation.

## Implementation tickets

The logical release order is `24 → 26 → 27 → 25`: Cloudflare readiness first, private-source/manual-Wrangler delivery second, seed import/read-back third, and final acceptance last. Ticket numbers remain unchanged so existing references stay stable.

- [Build Worker, D1, and Athlete application shell](issues/16-build-worker-d1-and-athlete-shell.md)
- [Build plan, schedule, and Today read model](issues/17-build-plan-schedule-and-today-read-model.md)
- [Build Agent JSON plan update flow](issues/18-build-agent-json-plan-update-flow.md)
- [Build first Session and focused execution](issues/19-build-first-session-and-focused-execution.md)
- [Build Session continuation and correction](issues/20-build-session-continuation-and-correction.md)
- [Build Progress and Exercise metrics](issues/21-build-progress-and-exercise-metrics.md)
- [Build Coach Share and Agent-first API](issues/22-build-coach-share-and-agent-api.md)
- [Build Athlete Export and recovery artifact](issues/23-build-athlete-export-and-recovery-artifact.md)
- [Harden Cloudflare production deployment](issues/24-harden-cloudflare-production-deployment.md)
- [Publish private GitHub repository and configure Cloudflare auto-deploy](issues/26-publish-private-github-repo-and-auto-deploy.md)
- [Import and verify initial weekly seed](issues/27-import-and-verify-initial-weekly-seed.md)
- [Run final release acceptance](issues/25-run-release-acceptance.md)

## Out of scope

- Implementing or deploying the App within this Wayfinder effort.
- Offline data entry, offline queues, or offline conflict resolution.
- Watch-owned Endurance Telemetry, including distance, pace, heart rate, elevation, moving/stopped time, and watch imports.
- Body-part configuration, symptom scores, before/after/next-morning or Rest Day feedback, and body-feedback trends.
- Manual plan editing, plan builders, day/week copy controls, plan JSON file import/export, and in-App plan generation.
- Training goals, route background, coaching analysis, AI advice, automatic plan generation, social features, or public profiles.
- Conditional prescriptions, progression rules, and free-text coaching instructions in either the App or Plan Update Package.
- Multiple plans per Athlete, household dashboards, cross-Athlete visibility, registration, invitations, or an administrator UI.
- Expiring Coach Shares or coach accounts.
- A human-facing coach dashboard; Coach Share is an agent-facing README and read-only JSON API.
- Dedicated accessibility auditing or WCAG acceptance criteria; the two
  accepted interaction prototypes remain the visual and interaction reference.
