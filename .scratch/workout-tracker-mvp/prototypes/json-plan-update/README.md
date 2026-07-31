# JSON Plan Update Prototype

Throwaway UI prototype for deciding how a normal read-only Plan page should enter, validate, preview, and return from an Agent-generated JSON update.

## Run

From the repository root:

```bash
python3 -m http.server 4173 --directory .scratch/workout-tracker-mvp/prototypes/json-plan-update
```

Open:

```text
http://127.0.0.1:4173/
```

The accepted direction is `C`, which is also the default.

Variants:

- `A` — rejected comparison: update expands inline below the normal week.
- `B` — rejected comparison: focused two-step route for paste and confirmation.
- `C` — accepted: normal week remains visible behind a bottom sheet.

Use the floating prototype controls to inject valid or invalid sample JSON. State is memory-only; no request mutates repository or database data.

Visual source: `assets/concept-abc.png`.
