# Seed verification

`seed/workout-tracker-weekly-seed.json` is a synthetic Plan Update fixture.
`npm run seed:verify` validates, previews, applies, and reads it back through
the same application boundary used for a Plan update.

The verifier must prove the expected seven weekday slots, Completion Item
counts, rejection of malformed and duplicate updates, and isolation of the
second synthetic Athlete. It must not connect to D1 or production.

Applying a seed to a real self-hosted Athlete is an explicit operator action.
Record only sanitized counts and semantic readback outside the repository; do
not add a live production receipt to this document.
