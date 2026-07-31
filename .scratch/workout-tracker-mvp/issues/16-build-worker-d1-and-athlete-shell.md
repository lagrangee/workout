# 16 — Build Worker, D1, and Athlete application shell

**What to build:** A locally runnable Workout Tracker shell where either configured Athlete can enter the app, read or update their own basic settings, and never cross the other Athlete's data boundary.

**Blocked by:** None — handoff is complete and this ticket can start immediately.

**Status:** ready-for-agent

**Label:** ready-for-agent

- [ ] The local Worker serves the app shell and private JSON boundary, with a local D1 fixture and repeatable schema migrations.
- [ ] Each configured Athlete identity resolves to exactly one Athlete; missing, invalid, or unmapped identity claims fail with the specified error behavior.
- [ ] Athlete A cannot read or mutate Athlete B's settings or resources, including when request keys are tampered with.
- [ ] Display name and IANA timezone validation, defaults, and update behavior match the domain contract.
- [ ] The local HTTP integration seam can run the same private boundary tests that will later run against the deployed Worker.
