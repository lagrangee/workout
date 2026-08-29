# Manual Wrangler deployment

Production is intentionally separate from the public source gate. First run:

```bash
npm run release-check
npx wrangler d1 migrations apply workout-tracker --remote --config wrangler.production.toml
npx wrangler deploy --config wrangler.production.toml
```

The ignored `wrangler.production.toml` must contain the operator's exact D1 ID,
custom hostname, `PRODUCTION_HOST`, and `PUBLIC_ORIGIN`. Secrets are configured
interactively by name as documented in the self-hosting guide.

After deploy, set the hostname only in the local shell and run the separate
operator smoke:

```bash
WORKOUT_PUBLIC_ORIGIN="https://workout.example.com" \
  node scripts/operator-acceptance.mjs
```

Then verify authenticated Athlete isolation, Plan/Schedule readback, migration
state, and recovery evidence. Keep the receipt outside the repository. A
source check or CI run is not a production receipt.
