# Repository Guidelines

## Agent skills

### Issue tracker

Local Markdown issues live under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repo uses the default five triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain layout. See `docs/agents/domain.md`.

## Project Structure & Module Organization

This repository contains the Local Markdown product handoff and the current Worker/D1 runtime scaffold for Workout Tracker.

- `CONTEXT.md` — canonical domain vocabulary and boundaries.
- `.scratch/workout-tracker-mvp/` — Wayfinder map, resolved decision tickets, consolidated specification, and throwaway prototypes.
- `docs/contracts/` — versioned Plan, Session, Coach API, and Athlete Export contracts plus wire catalogs.
- `docs/adr/` — architectural decisions; `docs/research/` — Cloudflare findings; `docs/agents/` — local workflow instructions.
- `src/` — Worker/domain modules; `migrations/` — D1 migrations; `wrangler.toml` — Cloudflare bindings and production host.
- `tests/` — automated tests (add before relying on CI); `public/` — Worker static assets when the UI is added.

Keep domain concepts in `CONTEXT.md` and update the relevant contract when behavior changes. Do not treat prototype markup or the original brief as implementation authority.

## Build, Test, and Development Commands

Install dependencies with `npm install`, then use the scripts in `package.json`: `npm run typecheck` for TypeScript checks, `npm test` for Node tests, `npm run check` for both, and `npm run release-check` for checks plus the forbidden-feature scan. Do not claim a release until the GitHub Actions pull-request check is green and the default-branch Wrangler deployment has succeeded.

## Coding Style & Naming Conventions

Use two spaces in JSON, YAML, and Markdown examples. Prefer `kebab-case` filenames, `camelCase` variables/functions, and `PascalCase` exported types/components. Keep public schemas versioned and reject ambiguous or silently repaired input.

## Testing Guidelines

Add tests with every behavior change, covering valid input, invalid input, state transitions, cross-Athlete isolation, and boundary dates. Name unit tests after their module (for example, `src/workout-plan.test.ts`) and place broader flows under `tests/`.

## Commit & Pull Request Guidelines

Use concise Conventional Commit subjects such as `feat: add session record` or `fix: reject duplicate plan keys`. Pull requests should explain the problem, summarize the contract impact, list verification, link the relevant `.scratch/` ticket, and include screenshots for UI changes.

## Security & Agent Instructions

Never commit credentials, bearer URLs, raw tokens, or personal data. Keep secrets in ignored environment files and GitHub Actions secrets. Production deploys run only from the default branch; pull requests run validation only. Treat Local Markdown as authoritative; preserve resolved decisions and update linked contracts together. See `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and `docs/agents/domain.md` before changing project records.

Cloudflare/GitHub setup details live in `docs/deployment/github-actions.md`; never replace its secret names with literal values.


<!-- bearing:managed-start -->
For a new request, load `bearing` only for explicit Bearing concepts, a reliable direct continuation of Bearing work in this repository, or reasonable material planning/governance relevance. Do not load for working directory, generic roadmap words, repository-independent conversation, or ordinary non-governance code/documentation work. Reuse visibly reliable Bearing orientation only for a direct continuation of the same request and repository. This pointer is contextual guidance, not an executable hook or lifecycle preflight. Each requested functional operation validates its required lifecycle. Explicit `/bearing` loads the skill directly when contextual nomination did not occur.
<!-- bearing:managed-end -->
