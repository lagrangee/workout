# Define body-feedback capture and association

Type: grilling
Status: resolved

## Question

How are Athlete-configured Body Feedback Items created, scored before or after training and the next morning, associated with a Workout Session or calendar date, corrected, and summarized without hard-coded body parts?

## Answer

The proposed Body Feedback system is removed and replaced by Exercise Feedback. Each exercise within one Workout Session may have at most one optional free-text feedback value covering the exercise as a whole across all sets and sides—for example, “left side felt noticeably weak today.” Most exercises will have no feedback.

Actual repetitions, duration, load, and RIR carry quantitative performance data. Exercise Feedback adds only qualitative context; it has no score, configured body part, timing category, trend, or required input. The UI keeps it collapsed behind an optional “Add feedback” action and never presents an empty feedback field for every exercise.

Exercise Feedback belongs to the Workout Session's snapshotted exercise identity, remains editable under the same indefinite Actual Training Data correction rules, and has no separate audit history.

The original Body Feedback Items, fixed symptom fields, before/after/next-morning records, Rest Day feedback, pain-score workflow, SymptomLog model, symptom endpoints, and body-feedback progress trends are all removed. Whether Exercise Feedback appears in Coach Shares or exports is owned by their respective open tickets.
