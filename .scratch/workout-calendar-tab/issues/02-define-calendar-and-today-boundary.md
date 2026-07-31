# Define the Calendar and Today boundary

Type: grilling
Status: resolved
Label: wayfinder:grilling
Blocked by: 01

## Question

What does the new Calendar own versus the existing Today surface? Decide whether Today remains the execution-focused entry point, which Calendar actions may deep-link to Today or a Session, how the bottom navigation and labels change, and whether the current date should be selected automatically without duplicating conflicting controls.

## Answer

`今日` remains the only training-execution surface. It owns the current date's start, continue, record, and end flows. `日历` is a browse and inspection surface for weekly plan content, daily details, and historical completion; it does not provide start or continue actions, and it does not link back to Today. Today likewise does not add a “view Calendar” entry.

The bottom navigation is `今日 | 日历 | 进展 | 设置`. The existing Plan tab is replaced and renamed to `日历`; Plan Update Package submission and future plan updates remain in Settings, while Progress retains metric and exercise-trend responsibilities.

When newly opened, Calendar shows the current Athlete-local week with today selected. Week and day selection may move during the current visit, but reopening Calendar returns to the current week and today. Future dates are read-only. Past dates are read-only in the Calendar itself, with the previously agreed secondary Session-correction entry where a Session exists. Rest Day and no-plan dates have no training actions.
