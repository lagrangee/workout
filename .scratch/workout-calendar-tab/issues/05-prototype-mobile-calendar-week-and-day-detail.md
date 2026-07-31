# Prototype the mobile Calendar week and day detail

Type: prototype
Status: resolved
Label: wayfinder:prototype
Blocked by: 01, 02, 03

## Question

What mobile interaction model makes a seven-day summary, week navigation, selected-day detail, history inspection, and today-only execution actions clear at the existing mobile width? Produce a throwaway prototype for human reaction; it must expose status distinctions and the path to historical Session correction without becoming a manual plan editor.

## Answer

The human accepted Variant B on 2026-07-31. Use a compact seven-day selector as the first layer, with weekday/date, status indicator, and a selected date. The selected date then owns the main single-day read-only detail: complete prescription, completion summary, actual values where a Session exists, and a secondary correction entry for eligible historical Sessions. Today and future dates remain read-only in Calendar; training execution remains in 今日.

Variant B was captured as the primary prototype source in [mobile Calendar prototype](../prototypes/mobile-calendar/README.md), on throwaway branch `codex/calendar-prototype-b` at commit `b1d7378`. Variants A and C remain in that prototype for comparison but are not production UI.
