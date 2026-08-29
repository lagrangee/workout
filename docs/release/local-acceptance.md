# Local source acceptance

Run from a clean checkout with Node.js 22:

```bash
npm ci
npm run release-check
```

The binary success condition is an exit code of zero from type checking;
behavioral, integration, contract, and browser-facing smoke tests; focused
persistence and validation coverage; seed and forbidden-feature checks;
license and generated-asset checks; the public-tree privacy scan; documentation
lint; and the public-source acceptance script. No step may require network
access after dependency installation, Cloudflare credentials, a production
hostname, a live D1 ID, or a private receipt.

Coverage reports have explicit branch expectations for `src/store.js` and
`src/validation.js`; they are not replaced by a high aggregate line number.
Documentation lint is labeled documentation evidence only. It proves local
links and whitespace hygiene, not HTTP, persistence, security, contract, or UI
behavior.

Registry-backed advisory review is intentionally separate from this offline
gate. CI runs `npm run audit:runtime` and `npm run audit:development` after the
same clean install, using the thresholds and no-silent-exception policy in the
[GitHub Actions boundary](../deployment/github-actions.md).

UI changes additionally require a focused browser scenario at the relevant
mobile and desktop sizes. Record the tested revision and scenario in the pull
request; screenshots must contain only synthetic data.

Local acceptance proves the checked source is internally consistent. It does
not prove a deploy, migration, custom-domain state, recovery rehearsal, or
human release approval.
