# Contributing

Thank you for improving Workout Tracker. This repository favors small,
contract-aware changes with executable evidence.

## Before changing code

1. Read `CONTEXT.md` and the relevant document under `docs/contracts/`.
2. Search existing issues and describe the observable problem before proposing
   a broad refactor.
3. Use synthetic fixtures. Never submit personal training data, credentials,
   live hostnames, database IDs, or operator receipts.

## Development

```bash
npm ci
npm run release-check
```

Add behavior tests for valid input, invalid input, state transitions,
cross-Athlete isolation, and boundary dates as applicable. Contract changes
must update both code and the owning contract. Keep D1 migrations forward-only
and compatible with the Worker deployment order documented for self-hosters.

## Pull requests

Use a concise Conventional Commit-style title. In the description explain:

- the problem and externally observable result;
- affected domain terms and versioned contracts;
- verification commands and binary outcomes;
- privacy, security, migration, and compatibility impact;
- screenshots or recordings for visible UI changes.

Maintainers may ask for a smaller change or decline work outside the product
boundary. Passing tests are required but do not guarantee merge or release.
By contributing, you agree that your contribution is licensed under MIT.
