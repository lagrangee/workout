# Source validation

Use Node.js 22 and the locked dependency graph:

```bash
npm ci
npm run release-check
```

`release-check` runs type checks, behavior and integration tests, contract and
browser-facing tests, focused coverage checks, generated-asset and license
checks, the public-tree privacy scan, and documentation lint. Documentation
checks prove only clean links and formatting; they do not substitute for
runtime, persistence, security, contract, or UI evidence.

Registry-backed dependency review requires network access and is available as:

```bash
npm run public:gate:online
```

The synthetic weekly Plan fixture can be validated independently with
`npm run seed:verify`. It exercises the normal validate, preview, apply, and
readback boundary without connecting to D1 or production.

Visible UI changes also need a focused browser check at the affected mobile and
desktop sizes. Use synthetic data in screenshots and recordings.

A successful source gate proves that checkout is internally consistent. It
does not prove a deployment, migration, custom-domain state, recovery rehearsal,
GitHub release, or human approval.
