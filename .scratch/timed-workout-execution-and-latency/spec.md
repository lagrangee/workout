# Timed Workout Execution and Responsive Session Feedback

Status: ready-for-agent

## Problem Statement

As an Athlete, starting today's Scheduled Workout can appear to do nothing. The Today surface remains visible while the application waits for the Session mutation and a follow-up Session read. In some cases the Workout Session has already been created, but the Athlete only sees the training surface after refreshing the page.

Recording a Completion Item also feels slow. The current interaction waits for a server write and then performs another Session read before updating the focus surface. There is no visible pending state or protection against repeated clicks. The production path additionally persists the Athlete state through D1, so the user cannot tell whether the delay is network, Worker/D1 work, or client rendering.

Duration-based Prescribed Sets are displayed as a number of seconds, but the execution surface does not provide an action-level countdown, a tempo cue, an end cue, or a reliable way to keep an iPhone screen awake during the set. This makes fixed-duration work such as a 40-second side plank harder to execute accurately.

## Solution

Make the Today execution surface a responsive, timer-aware Workout Session experience without changing the core Session contract.

When an Athlete opens a fixed-duration Completion Item, the surface offers one explicit `开始动作` control. The first tap activates audio and starts a five-second preparation countdown. The fixed-duration action then counts down visibly to zero and emits one short tempo cue per second. The final three seconds use an elevated cue and zero uses a distinct completion sound. Reaching zero stops the timer and prepares the actual duration value, but never marks the Completion Item complete or writes Actual Training Data automatically. The Athlete may edit the value and must tap `完成` to save it.

The execution surface pauses the action countdown, tempo cues, and displayed session timer together when the Athlete pauses. After a manual completion it enters the configured rest countdown, which remains skippable. A visible mute control silences cues without changing the recorded Actual Training Data.

The browser requests a screen Wake Lock while the execution surface is visible and re-requests it after returning to the foreground. If the page loses visibility, the execution timer pauses and the Athlete must resume it, because browser and operating-system power management can release a Wake Lock. Home Screen Web App behavior on supported iOS versions is treated as the preferred iPhone path; older or unsupported browsers receive a clear fallback rather than a false guarantee.

Start and Completion Item interactions show an immediate pending state, disable duplicate commands, consume the complete mutation response already returned by the server, and avoid a redundant follow-up Session read. A failed mutation restores the actionable state and preserves the Athlete's unsaved input. This spec does not redesign the D1 state model; production latency remains observable and can inform a later storage-focused effort.

The Calendar also detects historical `in_progress` Sessions whose Scheduled Workout date is before the Athlete's current local date. It renders those records as `未完成` and exposes a title-row maintenance action when any are present. The action calls an idempotent server normalization command; the server closes the open Training Interval using the last persisted Session activity time and changes the Session to `partial`, never to `completed`. There is no confirmation dialog and no background daemon in this version.

## User Stories

1. As an Athlete, I want tapping `开始训练` to enter the execution surface without refreshing, so that I can begin today's Scheduled Workout immediately.
2. As an Athlete, I want to see that starting a Workout Session is pending, so that I know the tap was received.
3. As an Athlete, I want the start control disabled while the start command is pending, so that I cannot accidentally create duplicate commands.
4. As an Athlete, I want a clear recoverable error when starting fails, so that I can retry without losing my place or assuming that the Workout Session was created.
5. As an Athlete, I want the complete Session response to update the execution surface directly, so that a successful action does not wait for an unnecessary second read.
6. As an Athlete, I want a Completion Item with a fixed `duration_sec` target to show a large, readable countdown, so that I can follow the prescribed duration without mental arithmetic.
7. As an Athlete, I want one `开始动作` control to activate sound and begin the preparation phase, so that I do not need to operate a separate audio player.
8. As an Athlete, I want a five-second preparation countdown before the timed set starts, so that I can get into position before the prescribed duration begins.
9. As an Athlete, I want one tempo cue every second during the full timed set, so that I can keep a steady pace without watching the screen continuously.
10. As an Athlete, I want the final three seconds to have a distinct higher-intensity cue, so that I know the end is approaching.
11. As an Athlete, I want zero to play a special end sound, so that I can recognize the end of the set without looking at the phone.
12. As an Athlete, I want the countdown to stop at zero without automatically completing the Completion Item, so that I can inspect or change the result before saving it.
13. As an Athlete, I want the actual duration field to be prefilled when the countdown ends, so that I can quickly accept the measured value while retaining control over the record.
14. As an Athlete, I want to edit the actual duration before tapping `完成`, so that the saved Actual Training Data reflects what I really performed.
15. As an Athlete, I want the Completion Item to remain incomplete until I explicitly tap `完成`, so that accidental timer expiry cannot alter my Workout Session record.
16. As an Athlete, I want the timer to use the fixed value represented by the current Training Plan Snapshot, so that execution does not introduce a range-selection decision that the plan does not support.
17. As an Athlete, I want any legacy range-shaped duration to use the existing canonical maximum value, so that the timer does not expose or invent unsupported range behavior.
18. As an Athlete, I want pausing the execution surface to pause the action countdown, tempo cues, and displayed session timer together, so that the visible clocks remain understandable.
19. As an Athlete, I want resuming to continue from the remaining action time, so that a short interruption does not force me to restart the set.
20. As an Athlete, I want a completed Completion Item to enter the configured rest countdown automatically, so that the prescribed rest is easy to follow.
21. As an Athlete, I want to skip rest manually, so that I can continue when I am ready rather than being trapped by the timer.
22. As an Athlete, I want rest countdown cues to remain restrained and use an end cue, so that rest guidance does not compete with the active-set tempo.
23. As an Athlete, I want a visible mute control, so that I can silence all application cues when the environment requires it.
24. As an Athlete, I want the application to use the device's normal volume controls, so that audio behavior remains predictable on iPhone and other browsers.
25. As an Athlete, I want the app to request screen Wake Lock while I am visibly executing a Workout Session, so that the phone does not dim during a set when the platform allows it.
26. As an Athlete, I want Wake Lock to be re-requested when the app returns to the foreground, so that a temporary visibility change does not leave the execution surface unprotected.
27. As an Athlete, I want the timer to pause when the page becomes hidden or the device is locked, so that missed background audio cannot make the recorded execution misleading.
28. As an Athlete, I want a clear fallback when Wake Lock is unavailable or denied, so that I know I may need to adjust the phone's automatic-lock setting.
29. As an Athlete, I want a slow save to show progress and prevent repeated commands, so that I do not mistake normal network latency for a broken button.
30. As an Athlete, I want a failed save to preserve my edited actual value and feedback, so that a transient network error does not make me re-enter the result.
31. As an Athlete, I want the execution surface to preserve the immutable Training Plan Snapshot, so that timer behavior never changes the prescribed plan.
32. As an Athlete, I want timer completion and manual result recording to remain separate, so that Actual Training Data stays correctable under the existing Session rules.
33. As an Athlete, I want a real-iPhone acceptance pass to cover sound, screen behavior, pause/resume, and foreground recovery, so that the shipped experience is validated on the device where it matters.

## Implementation Decisions

- Use the existing Today execution surface and Workout Session lifecycle. The change does not create a second execution route, a new Session type, or a new Plan surface.
- Use the existing `duration_sec` target representation and the fixed value exposed by the current Training Plan Snapshot. Do not add range selection to the execution UI. If a legacy snapshot contains a range-shaped value, use the current canonical maximum and do not mutate the plan from the timer.
- Add an action-level timer state distinct from the overall Training Interval display. The timer is based on an absolute deadline or equivalent monotonic elapsed-time calculation so delayed browser callbacks do not accumulate visible drift.
- The first `开始动作` tap is the single user-activation boundary for audio and the five-second preparation phase. There is no separate audio-player interaction required for normal use.
- During preparation, play a restrained preparation cue. During the full fixed-duration action, play one tempo cue per second. Elevate the cue for the final three seconds and use a distinct end sound at zero. Use tones rather than speech synthesis for this spec.
- Store the short tones as same-origin local WAV assets and play them through `HTMLAudioElement`; the first `开始动作` click sets `navigator.audioSession.type = "playback"` when supported and attempts the preparation cue. Await the returned play result, show `声音未开启` on failure, and keep the visual/manual timer usable. The browser may use the device's normal volume controls; there is no Web Audio oscillator fallback in this implementation.
- At zero, stop the action timer and prefill the editable actual value with the fixed target duration. Do not append a Completion Item result, change Session Status, or persist Actual Training Data until the Athlete manually taps `完成`.
- Manual completion uses the existing Session Record shape and existing validation rules. The submitted actual metric remains `duration_sec`; `completed_at` is created when the Athlete confirms the result, not when the countdown merely reaches zero.
- Pausing stops the action timer, cues, and displayed session timer as one visible operation. Pause/resume is execution-surface state and does not introduce a new Training Interval or change Session Status.
- After a confirmed Completion Item save, start the existing configured rest countdown automatically. Rest remains skippable. Rest cues are limited to a restrained countdown/end pattern and do not become the active-set tempo stream.
- Provide an explicit mute control for cues. The default is audible when the browser permits audio; the application uses the device volume and does not introduce an independent volume mixer.
- Request a screen Wake Lock only while the execution surface is visible and the Athlete is actively executing. Re-request it after foreground recovery. If the page becomes hidden, pause execution and show a resumable state rather than claiming that the browser will continue running reliably in the background.
- Treat an installed Home Screen Web App on iOS/iPadOS 18.4 or newer as the preferred complete iPhone path. Older or unsupported environments retain visual/manual timing but receive a fallback notice when Wake Lock cannot be used. The standard and platform constraints are documented by the [W3C Screen Wake Lock specification](https://www.w3.org/TR/screen-wake-lock/), [Apple Safari 18.4 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes), and [WebKit's Safari 18.4 notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/).
- For start, continue, restart, and Completion Item mutation interactions, render a pending state immediately and disable duplicate commands. On success, consume the complete mutation response as the new client Session state and do not perform a redundant Session detail read. On failure, restore the actionable state, keep local edits, and surface a retryable error.
- Keep the server authoritative for Session Records and Actual Training Data. The pending UI may be immediate, but it must not claim that a save succeeded before the mutation response succeeds.
- Preserve the existing Athlete isolation, immutable Training Plan Snapshot, Training Interval, Session Status, and correction boundaries. No new authentication, storage identity, or personal-data surface is introduced.
- Do not redesign the D1 state document or rebuild strategy in this feature. If production request timings show a storage bottleneck after the client round-trip reduction, record that as a separate storage/performance effort with its own evidence and migration review.
- Keep expired-session cleanup explicit and Athlete-scoped: `POST /api/private/sessions/normalize-expired` rechecks all stale `in_progress` Sessions in the authenticated state, closes them as `partial`, is safe to replay with an idempotency key, and never auto-completes a Session. Calendar's local pre-normalization display is a projection convenience; the server remains authoritative.
- Use one highest browser-level test seam: the real execution UI backed by the local Worker HTTP handler and deterministic Store. Existing HTTP lifecycle tests remain supporting contract coverage, not a replacement for the browser flow.

## Testing Decisions

- Tests must assert external behavior visible to an Athlete: rendered state, countdown values, cue events at the user-visible boundaries, enabled/disabled controls, submitted Session Records, and network request behavior. They must not assert helper function names, private state layout, or a particular DOM implementation when the behavior can be observed at the browser boundary.
- Extend the existing browser/static application seam to run the real execution UI against the local HTTP handler and a deterministic Store. Provide deterministic clock, audio, visibility, and Wake Lock capabilities at the browser/platform boundary so the test is fast and repeatable without requiring a real iPhone.
- Reuse the existing Session lifecycle HTTP coverage for start, record replacement, continue/restart, end, immutable snapshot preservation, validation, and Athlete isolation. Add only the contract assertions needed to prove that the browser can consume the existing complete mutation response.
- The browser flow must prove that Today → `开始训练` reaches the execution surface without a reload and that the start mutation is not followed by a redundant Session detail read.
- The browser flow must prove that a timed Completion Item shows the five-second preparation phase, then the fixed countdown, then one cue per active second, elevated final-three-second cues, and a distinct zero/end cue.
- The browser flow must prove that reaching zero leaves the Completion Item unsaved and actionable, allows actual-value editing, and only writes a Completion Item result after the Athlete taps `完成`.
- The browser flow must prove that pause stops countdown and cues, resume continues from the remaining time, confirmed completion enters rest, and skip-rest returns to the next focus item.
- The browser flow must prove that mute suppresses cues without changing the Session Record, and that a slow mutation presents pending state and prevents duplicate submissions.
- The browser flow must prove that a failed mutation restores an actionable control and retains the Athlete's unsaved actual value or feedback.
- The browser flow must prove that a historical `in_progress` Calendar entry renders as `未完成`, exposes the title-row cleanup action, and hides it after the server normalization succeeds.
- The browser flow must prove that Wake Lock is requested while visible, re-requested after foreground recovery, and that visibility loss enters a paused/resumable state when the capability is unavailable or released.
- Preserve regression coverage for Rest Day and no-plan behavior, because neither creates a Workout Session and neither should expose the timed execution surface.
- Run the repository's existing type, HTTP, static, and release-oriented checks in addition to the focused browser flow. Passing automated checks is implementation evidence, not the human iPhone acceptance result.
- Human acceptance is owned by the Athlete. The manual pass should use the installed Home Screen Web App on a real iPhone and cover a fixed-duration set, full-period tempo cues, preparation audio activation, manual edit-before-complete, pause/resume, rest skip, mute, screen-lock behavior, low-power or denied-Wake-Lock fallback, and foreground recovery. The agent must report this lane as pending until the Athlete supplies the result.

## Out of Scope

- Adding range selection or changing the Plan Update Package, Weekly Template, Plan Revision, or validation model to support duration ranges.
- Automatically completing or automatically saving a Completion Item when the timer reaches zero.
- Changing the Workout Session Status lifecycle, Training Interval persistence semantics, correction rules, or immutable Training Plan Snapshot behavior.
- Redesigning the D1 schema, replacing the Athlete state document, changing index projections, or performing a storage migration solely to address the observed latency.
- Offline writes, background synchronization, retry queues, or claiming that Actual Training Data was saved without a successful server response.
- Guaranteed background audio, continued execution while the page is hidden, continued execution after manual device lock, or a promise that any iPhone power mode will honor Wake Lock.
- A scheduled daemon or automatic background cleanup of expired Sessions; cleanup is an explicit Calendar maintenance action in this version.
- A native iOS application, Apple Watch integration, haptic hardware integration, media lock-screen controls, or external metronome integrations.
- Voice coaching or speech-synthesis guidance. This spec uses short tones only.
- Replacing the existing Today execution surface with a separate route or duplicating the Calendar execution surface.
- Automated claims of real-iPhone acceptance. Device-level human acceptance remains a separate evidence lane owned by the Athlete.

## Further Notes

- The feature keeps the domain boundary explicit: Scheduled Workout describes prescribed intent; Workout Session owns execution; Training Plan Snapshot freezes the prescription at Session creation; Actual Training Data remains manually correctable.
- The user-visible timer is a guide for executing a fixed-duration Prescribed Set. It is not a new source of truth for the plan and it does not change how completion rate, streaks, or Rest Days are derived.
- The current app already has a standalone Web App manifest and an existing overall Session timer/rest surface. The implementation should deepen those seams rather than introduce parallel concepts.
- The browser-level test seam is the agreed implementation proof. Real iPhone audio, Wake Lock, power management, and screen behavior require the Athlete's manual acceptance and must be reported separately.
- Production latency attribution should remain evidence-based: distinguish client waiting/render time, mutation request time, follow-up reads, Worker work, and D1 work before proposing a storage redesign.
