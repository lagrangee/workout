# Prototype the mobile training-execution flow

Type: prototype
Status: resolved
Blocked by: 01, 02, 03, 07, 15

## Question

What mobile interaction model makes starting, recording, timing, resting, correcting, and ending a mixed Workout Session fast and clear with one hand at 375-pixel width?

## Comments

- Human direction: prefer B (one-item focus). Add previous/next navigation, make the global progress bar disclose a jump list, shorten the primary action to “完成,” display adjusted actual values beside their prescribed defaults, and select a session-level or Completion Item target before correction.
- Human correction: training may be split across multiple time periods on the Scheduled Workout date. Today must summarize completed work and offer “Continue workout” for both in-progress and saved partial Sessions; continuing a partial Session reuses it and opens a new Training Interval.
- Human refinement: keep the Session note textarea open on the end screen; selecting each Session RPE value reveals a plain-language meaning; replace the generic partial warning with an explicit list of unfinished Completion Items; keep “End and save” fixed near the bottom; retain the global progress disclosure during rest. Preserve the current visual simplicity while improving hierarchy and finish.
- Throwaway prototype: [mobile training execution variants](../prototypes/mobile-execution/README.md). It compares A (full checklist), B (one-item focus), and C (exercise sections) on the same 375-pixel route, with jump controls for active, summary, and skipped states. The human accepted refined B on 2026-07-31.
- Prototype correction: a `2 × 8 / side` unilateral prescription produces four Completion Items, not two. The mixed sample therefore contains 11 items: one continuous warm-up, three goblet-squat sets, four split-squat set-side combinations, and three plank sets; its partial example is correctly derived as `10 / 11 = 91%`.
- [Define rest days, streaks, and progress metrics](02-define-rest-days-streaks-and-progress-metrics.md) established the recording constraint: show prescribed, prefilled values with one primary Complete action; reveal only relevant fields through Adjust; never present a grid of empty inputs.
- [Define body-feedback capture and association](03-define-body-feedback-capture-and-association.md) replaced Body Feedback with one usually-absent, optional Exercise Feedback text per exercise and Session; keep it collapsed behind “Add feedback.”

## Answer

Use refined variant B: a 375-pixel one-item focus flow with one primary “完成” action, prefilled prescribed values, an Adjust sheet for actual values, adjacent previous/next navigation, and a clickable global progress bar that discloses and jumps to all Completion Items. When an actual differs, show prescribed and actual values together with the actual visually emphasized.

Today groups completed work by exercise and offers “继续训练” for both an active Session and a same-day saved partial Session. Continuing preserves the same Session, Training Plan Snapshot, and actuals while opening a new Training Interval. Rest retains the same expandable progress bar, shows the next item, and exits rest when the Athlete deliberately jumps to an item.

The end screen keeps the optional Session-note textarea open, presents RPE 0–10 as large two-row targets, and explains the selected value in plain language; RPE 9 means near-limit work still completed to standard, while RPE 10 means maximum effort and prompts a note if work was not completed. Any missing Completion Items appear as a concrete list. “结束并保存” stays fixed near the bottom while the result content scrolls.

Correction starts with an explicit choice between the Session as a whole and one Completion Item. The accepted visual direction uses restrained warm-neutral surfaces, compact cards, red primary actions, green completion progress, clear typography and spacing, and accessible control names without adding decorative complexity. The prototype is interaction evidence only, not production implementation.
