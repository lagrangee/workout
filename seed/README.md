# Initial weekly seed

`workout-tracker-weekly-seed.json` is a Plan Update Package v1 for the first
weekly template. It takes the original brief's initial strength, mobility,
core, and foot/ankle work and adapts it to the accepted MVP contract:

- the package repeats one explicit seven-slot week from `2026-08-02` in the
  Athlete's `Asia/Shanghai` timezone;
- running, outdoor-hill, treadmill-hill, route, heart-rate, distance, and
  elevation telemetry are omitted because the App does not record them;
- Thursday is `null` (no App-managed plan) and Sunday is an explicit Rest Day;
- progression conditions, prose instructions, symptom fields, and coaching
  analysis are omitted; targets, tempo, rest, resistance, and RIR remain data.

Import this file through the normal Plan JSON validate → preview → apply flow.
It is not a database dump and must not be inserted directly into D1.
