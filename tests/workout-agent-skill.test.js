import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const skillPath = resolve("skills/workout-agent/SKILL.md");

test("Workout Agent Skill is model-invoked with a sharp data and plan trigger", async () => {
  const skill = await readFile(skillPath, "utf8");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

  assert.ok(frontmatter, "skill frontmatter is present");
  assert.match(frontmatter[1], /^name: workout-agent$/m);
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
  assert.match(skill, /plan-update-package-v1\.md/);
});
