# Obsidian Training Archive Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Workout Training Archive emit Obsidian-native Properties and valid wikilinks, preserve detailed Workout/COROS evidence in local notes and sidecars, migrate the existing vault, and verify a clean real sync for 2026-08-17.

**Architecture:** Keep `daily/` as the date Hub, keep user-readable Workout Session notes under `workout/sessions/`, and add `data/workout/` for sanitized full Session JSON. Use date-plus-stable-key filenames for Session notes and sidecars. Serialize all scalar Properties explicitly and quote wikilinks inside YAML lists/scalars; keep daily Hub content compact while rendering details only in per-record notes.

**Tech Stack:** Node.js ESM, Node test runner, Markdown/YAML frontmatter, Workout/COROS MCP reads, local Obsidian vault, existing Training Archive sync runner.

---

### Task 1: Lock the Obsidian frontmatter and path contract with failing tests

**Files:**
- Modify: `tests/training-records.test.js`
- Modify: `tests/training-archive-records.test.js`
- Modify: `tests/training-archive-contract.test.js`

- [ ] **Step 1: Add assertions for scalar daily Properties and quoted link lists.**

Assert generated daily notes contain `local_date` as a quoted scalar, the four flattened source/freshness fields, and quoted `workout_sessions`, `coros_activities`, and `routes` list items. Assert that nested `source_status:` and `data_as_of:` maps are absent.

- [ ] **Step 2: Add assertions for the date-plus-session-key filename and quoted `daily_hub`.**

Assert the generated note path is `workout/sessions/2026-08-15--sess-2026-08-15.md` and its frontmatter contains `daily_hub: "[[daily/2026-08-15]]"`.

- [ ] **Step 3: Add assertions that Workout and COROS details appear in their notes.**

Use the existing fixture snapshot/results/feedback and COROS sport metrics/lap groups; assert note output contains an exercise, actual result, feedback, training load, sport metric, and lap detail.

- [ ] **Step 4: Run focused tests and confirm they fail against the current writer.**

Run:

```bash
node --test tests/training-records.test.js tests/training-archive-records.test.js tests/training-archive-contract.test.js
```

Expected: failures for the old Session path, nested daily Properties, unquoted links, and missing details.

### Task 2: Implement the native Properties/link serializer and stable Session paths

**Files:**
- Modify: `src/training-records.js`
- Modify: `src/training-archive-sync.js`
- Modify: `tests/training-records.test.js`
- Modify: `tests/training-archive-records.test.js`

- [ ] **Step 1: Add one shared `workoutSessionRelativePath()` helper.**

Generate `workout/sessions/<local_date>--<file-safe-session-key>` and use it in daily Hub links, Workout table links, Session file writes, and migration output.

- [ ] **Step 2: Emit only Obsidian-compatible atomic daily Properties.**

Write `local_date`, `source_status_workout`, `source_status_coros`, `data_as_of_workout`, `data_as_of_coros`, machine reference lists, and quoted wikilink lists. Remove the duplicate `date` property from new daily-hub notes.

- [ ] **Step 3: Quote every YAML wikilink scalar and list item.**

Use one serializer that always emits `"[[...]]"` for link values and `null` for absent links. Keep Markdown-body links separate from frontmatter serialization.

- [ ] **Step 4: Render detailed Workout Session and COROS Activity notes.**

Workout notes render plan blocks/sets, actual completion values, resistance, intervals, and exercise feedback. COROS notes render the complete normalized summary, sport metrics, and bounded lap-group rows while keeping FIT/GPS private.

- [ ] **Step 5: Run the focused tests and confirm green.**

Run the Task 1 command and verify all new writer/detail assertions pass.

### Task 3: Preserve detailed Workout data and write the new sidecar

**Files:**
- Modify: `src/training-archive-sync.js`
- Modify: `src/training-records.js`
- Modify: `tests/training-archive-records.test.js`

- [ ] **Step 1: Preserve typed Session detail fields in the injected Workout source boundary.**

Carry `snapshot`, `completion_items`, `completion_results`, `training_intervals`, `exercise_feedback`, `note`, `skip_reason`, and `training_version` through `safeSessions()` without carrying credentials or arbitrary provider payloads.

- [ ] **Step 2: Write `data/workout/<date>--<session-key>.json`.**

Write the sanitized full Session record locally, include the path in the local receipt, and never include this sidecar in the cloud aerobic projection.

- [ ] **Step 3: Add a regression assertion for sidecar content and cloud omission.**

Assert the local JSON includes actual Session detail and the published projection contains no Workout sidecar/path or full Session details.

### Task 4: Update contracts, Skill guidance, and migration tooling

**Files:**
- Modify: `docs/contracts/training-archive-v1.md`
- Modify: `docs/contracts/training-archive-wire-catalog-v1.md`
- Modify: `skills/workout/SKILL.md`
- Create: `scripts/migrate-training-archive-vault.mjs`
- Modify: `tests/training-archive-contract.test.js`
- Modify: `tests/workout-agent-skill.test.js`

- [ ] **Step 1: Update the layout and Obsidian wire examples.**

Document the date-plus-key Session note path, `data/workout` sidecar, scalar daily Properties, and quoted wikilinks.

- [ ] **Step 2: Update the Workout Skill’s sync contract.**

Require the new Session note/sidecar paths, detail preservation, native Properties, and a post-write frontmatter/link audit.

- [ ] **Step 3: Add a deterministic vault migration command.**

Read existing COROS JSON/receipts and legacy daily/session notes, regenerate all daily/activity/session projections with the new writer, migrate legacy `training-day` notes to `daily-hub`, and remove only obsolete generated Session filenames.

- [ ] **Step 4: Run contract and Skill tests.**

Run:

```bash
node --test tests/training-archive-contract.test.js tests/workout-agent-skill.test.js
```

### Task 5: Update the vault and perform the real 2026-08-17 sync verification

**Files:**
- External target: `${WORKOUT_ARCHIVE_DIR}` (private local configuration; do not commit the resolved path)

- [ ] **Step 1: Read the exact 2026-08-17 Workout schedule/session and COROS aerobic slice through typed MCP tools.**

Preserve returned `data_as_of`, `source_ref`, Session details, and source statuses in a snapshot payload for the existing sync runner.

- [ ] **Step 2: Remove only 2026-08-17 generated artifacts after listing them.**

Delete the date Hub, old Session note, date receipt, and any date-scoped Workout sidecar; do not delete source data, COROS historical activities, route registry, or other dates.

- [ ] **Step 3: Run the real sync runner with the live snapshot.**

Write the new 2026-08-17 note, Session note, Workout sidecar, receipt, and safe cloud publication through the existing owner-only configuration.

- [ ] **Step 4: Parse every daily frontmatter and the regenerated 2026-08-17/session frontmatter.**

Assert no nested Properties or unquoted wikilinks remain, all link targets exist, the Workout sidecar contains detail, and the receipt reports local write status separately from cloud status.

### Task 6: Full verification and handoff

**Files:**
- No additional source files.

- [ ] **Step 1: Run the full verification suite.**

Run `npm run typecheck`, `npm test`, `npm run forbidden-scan`, and `git diff --check`.

- [ ] **Step 2: Run the archive-wide link/type/privacy audit.**

Check all daily/session/activity/route frontmatter, all wikilink targets, absence of credentials/GPS/FIT bytes in notes/cloud payloads, and no accidental writes outside the requested vault.

- [ ] **Step 3: Report exact changed files, vault artifacts, test counts, and any cloud/readback limitation.**
