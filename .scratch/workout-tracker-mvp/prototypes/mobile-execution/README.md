# Mobile Training Execution Prototype

Throwaway UI prototype for selecting the one-handed interaction model used to start, record, rest, end, restart, and correct one Scheduled Workout.

## Run

From the repository root:

```bash
python3 -m http.server 4174 --directory .scratch/workout-tracker-mvp/prototypes/mobile-execution
```

Open:

```text
http://127.0.0.1:4174/
```

Variants:

- `A` — full checklist: every Completion Item remains visible.
- `B` — preferred focus mode: one current Completion Item owns the screen, with adjacent navigation and a global jump list.
- `C` — exercise sections: the current exercise expands inside a compact session outline.

The floating prototype controls can jump to representative active, summary, and skipped states. State is memory-only; no action mutates repository or database data.

The Today view treats both an active `in_progress` Session and a same-day
explicitly ended `partial` Session as continuable. “End and save” closes the
current Training Interval; ordinary result auto-save does not. Continuing
preserves the same Session and plan snapshot while opening a new interval.

Visual source: `assets/concept-mobile-execution.png`.
