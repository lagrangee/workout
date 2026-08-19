import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const skillPath = resolve("skills/workout/SKILL.md");

test("Workout Agent Skill is model-invoked with a sharp data and plan trigger", async () => {
  const skill = await readFile(skillPath, "utf8");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

  assert.ok(frontmatter, "skill frontmatter is present");
  assert.match(frontmatter[1], /^name: workout$/m);
  assert.match(
    frontmatter[1],
    /^description: .*Workout.*(data|plan).*$/im,
  );
  assert.doesNotMatch(frontmatter[1], /^disable-model-invocation:/m);
});

test("Workout Agent Skill maps bounded questions to typed MCP tools", async () => {
  const skill = await readFile(skillPath, "utf8");

  for (const tool of [
    "workout_get_overview",
    "workout_get_plan",
    "workout_get_schedule",
    "workout_list_sessions",
    "workout_get_session",
    "workout_get_progress",
    "workout_get_exercise_history",
    "workout_validate_plan_update",
    "workout_apply_plan_update",
    "workout_validate_plan_update_batch",
    "workout_apply_plan_update_batch",
  ]) {
    assert.match(skill, new RegExp(`\\b${tool}\\b`));
  }

  assert.match(skill, /explicit\s+inclusive date range/i);
  assert.match(skill, /opaque cursor/i);
  assert.match(skill, /training.version|training_version/i);
  assert.match(skill, /data_as_of/i);
  assert.match(skill, /source_ref/i);
});

test("Workout Agent Skill makes plan writes a validate-confirm-apply-readback flow", async () => {
  const skill = await readFile(skillPath, "utf8");
  const planRead = skill.indexOf("workout_get_plan");
  const validation = skill.indexOf("workout_validate_plan_update");
  const confirmation = skill.indexOf("separate, explicit confirmation");
  const application = skill.indexOf("workout_apply_plan_update");
  const readback = skill.indexOf("inspect its readback");

  assert.ok(planRead >= 0 && planRead < validation, "plan is read before validation");
  assert.ok(validation < confirmation && confirmation < application, "confirmation gates application");
  assert.ok(application < readback, "readback follows application");
  assert.match(skill, /stale-plan/i);
  assert.match(skill, /readback failure/i);
  assert.match(skill, /rate-limit/i);
  assert.match(skill, /invalid_cursor/);
  assert.match(skill, /idempotency_conflict/);
  assert.match(skill, /confirmation_required/);
  assert.match(skill, /unsupported_operation/);
  assert.match(skill, /Session lifecycle/i);
  assert.match(skill, /account-settings/i);
  assert.match(skill, /share-management/i);
  assert.match(skill, /authentication/i);
  assert.equal((skill.match(/Completion:/g) ?? []).length, 8);
});

test("Workout Agent Skill keeps credentials and analysis ownership outside the integration", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /local MCP configuration/i);
  assert.match(skill, /Agent owns the analysis structure/i);
  assert.match(skill, /single source of truth/i);
  for (const forbidden of [
    /Agent Token/i,
    /Coach Share/i,
    /Authorization:/i,
    /athlete[_ ]selector/i,
    /domain calculation/i,
    /AGENT_TOKEN_SECRET/i,
  ]) {
    assert.doesNotMatch(skill, forbidden);
  }
  assert.match(skill, /agent-api-v1\.md/);
  assert.match(skill, /agent-api-wire-catalog-v1\.md/);
  assert.match(skill, /plan-update-package-v2\.md/);
  assert.match(skill, /plan-update-batch-v1\.md/);
});

test("Workout Agent Skill routes local archive context without changing source authority", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /local Training Archive/i);
  assert.match(skill, /WORKOUT_ARCHIVE_DIR/);
  assert.match(skill, /local value is context, not authority/i);
  assert.match(skill, /live value wins/i);
  assert.match(skill, /sync data/);
  assert.match(skill, /querySportRecords/);
  assert.match(skill, /downloadActivityFitFiles/);
  assert.match(skill, /YYYY-MM-DD-<activity_ref>\.fit/);
  assert.match(skill, /workout\/sessions\/YYYY-MM-DD--<session_key>\.md/);
  assert.match(skill, /data\/workout\/YYYY-MM-DD--<session_key>\.json/);
  assert.match(skill, /Obsidian-native/i);
  assert.match(skill, /source_status_workout/);
  assert.match(skill, /quoted `\[\[\.\.\.\]\]` list items/i);
  assert.match(skill, /completion.*results.*training intervals.*exercise feedback/is);
  assert.match(skill, /FIT resource signature/i);
  assert.match(skill, /\[100, 101, 102, 104, 200\]/);
  assert.match(skill, /COROS Strength.*outside this sync scope/i);
  assert.match(skill, /user may supply\s+`route_key`.*`route_direction` is derived/is);
  assert.match(skill, /sync automatically runs route matching/i);
  assert.match(skill, /FIT-backed route matching/i);
  assert.match(skill, /route-matcher\.mjs/);
  assert.match(skill, /--routes <routes\.json> --points <activity-points\.json>/);
  assert.match(skill, /first-point GPS radius.*early-anchor GPS/i);
  assert.match(skill, /approximately 200 m anchor/i);
  assert.match(skill, /pauses for the user's route\s+name/is);
  assert.match(skill, /append the proposal to/);
  assert.match(skill, /ambiguous.*never\s+creates a\s+new route/s);
  assert.match(skill, /matched.*ambiguous.*unmatched/s);
  assert.match(skill, /weekly\/YYYY-Www\.md/);
  assert.match(skill, /training-archive-v1\.md/);
  assert.match(skill, /training-archive-wire-catalog-v1\.md/);
  assert.match(skill, /coros-field-catalog-v2\.md/);
  assert.match(skill, /projection_version: 2/);
  assert.match(skill, /each provider lap group separate.*Markdown table/is);
  assert.match(skill, /unknown additive fields.*sanitized JSON/is);
  assert.match(skill, /not Skill prose or a second `parser\.mjs`/i);
});
