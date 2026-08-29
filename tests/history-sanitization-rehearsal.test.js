import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  SENSITIVE_SCRATCH_HISTORY_PATHS,
  assertRewrittenMetadata,
  historyMaterialCategories,
  matchesAnyPrivatePattern,
} from "../scripts/history-sanitization-policy.mjs";

const rehearsalScript = new URL(
  "../scripts/rehearse-public-history.mjs",
  import.meta.url,
).pathname;

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function git(repository, ...args) {
  return run("git", ["-C", repository, ...args]);
}

function withTemporaryRoot(prefix, action) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(repository, path, contents) {
  const target = join(repository, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
}

function commit(repository, message, email) {
  git(repository, "add", "-A");
  run("git", ["-C", repository, "commit", "--allow-empty", "-m", message], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Synthetic Maintainer",
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: "Synthetic Maintainer",
      GIT_COMMITTER_EMAIL: email,
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
  return git(repository, "rev-parse", "HEAD");
}

function createSyntheticSource(root) {
  const repository = join(root, "source");
  mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Synthetic Maintainer");
  git(repository, "config", "user.email", "synthetic.maintainer@example.invalid");

  const privateValue = "synthetic-private-host.example";
  const vendorCertificateEmail = ["signing", "vendor.example.org"].join("@");
  const privateScratchPath = SENSITIVE_SCRATCH_HISTORY_PATHS[0];
  write(repository, "tests/fixtures/fit/coros-2026-08-23.fit", "synthetic-real-device-bytes");
  write(repository, "docs/deployment/cloudflare-production-checklist.md", privateValue);
  for (const path of SENSITIVE_SCRATCH_HISTORY_PATHS) {
    write(
      repository,
      path,
      path === privateScratchPath ? `receipt=${privateValue}\n` : "synthetic private operator record\n",
    );
  }
  write(repository, ".scratch/harmless/spec.md", "harmless product reasoning\n");
  write(
    repository,
    ".scratch/harmless/vendor-certificate.bin",
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from(vendorCertificateEmail),
      Buffer.from([0]),
    ]),
  );
  write(
    repository,
    "docs/private-email.bin",
    Buffer.concat([
      Buffer.from([0]),
      Buffer.from("synthetic.maintainer@example.invalid"),
      Buffer.from([0]),
    ]),
  );
  write(repository, "kept-ignored.txt", "tracked before it was ignored\n");
  write(repository, "wrangler.toml", `route = \"${privateValue}\"\n`);
  const firstPrivateCommit = commit(
    repository,
    "feat: private synthetic baseline",
    "synthetic.maintainer@example.invalid",
  );
  git(repository, "tag", "private-v0");
  git(repository, "update-ref", "refs/codex/private-snapshot", firstPrivateCommit);
  git(repository, "update-ref", "refs/remotes/archive/main", firstPrivateCommit);

  write(repository, privateScratchPath, `receipt=${privateValue}\nsecond private revision\n`);
  const prunedCommit = commit(
    repository,
    "chore: update private-only receipt",
    "synthetic.maintainer@example.invalid",
  );

  rmSync(join(repository, "tests/fixtures/fit/coros-2026-08-23.fit"));
  rmSync(join(repository, "docs/private-email.bin"));
  for (const path of SENSITIVE_SCRATCH_HISTORY_PATHS) rmSync(join(repository, path));
  write(repository, "docs/deployment/cloudflare-production-checklist.md", "generic operator checklist\n");
  write(repository, "wrangler.toml", "name = \"example-worker\"\n");
  write(repository, ".gitignore", "kept-ignored.txt\n");
  write(
    repository,
    "gate.mjs",
    [
      'import assert from "node:assert/strict";',
      'import { existsSync, readFileSync } from "node:fs";',
      'assert.equal(existsSync(".prepare-complete"), true);',
      `assert.equal(existsSync(${JSON.stringify(privateScratchPath)}), false);`,
      'assert.match(readFileSync(".scratch/harmless/spec.md", "utf8"), /harmless/);',
      'assert.match(readFileSync("kept-ignored.txt", "utf8"), /tracked before/);',
      'assert.doesNotMatch(readFileSync("wrangler.toml", "utf8"), /private-host/);',
      'for (const name of ["ATHLETE_SECRET", "AUTH_PRIVATE", "AGENT_TOKEN", "COACH_TOKEN", "CLOUDFLARE_API_TOKEN", "WORKOUT_REAL_FIT_PATH"]) assert.equal(process.env[name], undefined);',
      'assert.match(process.env.HOME ?? "", /fresh-command-home$/);',
    ].join("\n"),
  );
  write(
    repository,
    "prepare.mjs",
    'import { writeFileSync } from "node:fs"; writeFileSync(".prepare-complete", "prepared\\n");\n',
  );
  const publicationTargetCommit = commit(
    repository,
    "chore: prepare synthetic public target",
    "synthetic.maintainer@example.invalid",
  );
  git(repository, "switch", "-c", "candidate-work");
  write(repository, "candidate-source.txt", "selected candidate ancestry\n");
  commit(repository, "chore: select synthetic candidate ancestry", "synthetic.maintainer@example.invalid");
  const sourceRemoteUrl = ["https:/", "example.invalid", "private.git"].join("/");
  git(repository, "remote", "add", "origin", sourceRemoteUrl);
  return {
    firstPrivateCommit,
    prunedCommit,
    privateScratchPath,
    privateValue,
    publicationTargetCommit,
    repository,
    sourceRemoteUrl,
  };
}

test("history rehearsal backs up, rewrites only a disposable clone, and proves the fresh candidate", () => withTemporaryRoot("workout-history-test-", (root) => {
  const {
    firstPrivateCommit,
    prunedCommit,
    repository,
    privateScratchPath,
    privateValue,
    publicationTargetCommit,
    sourceRemoteUrl,
  } = createSyntheticSource(root);
  const outputParent = join(root, "private-output");
  mkdirSync(outputParent);
  const patterns = join(root, "private-patterns.txt");
  writeFileSync(patterns, `${privateValue}\n`);
  const sourceCommit = git(repository, "rev-parse", "refs/heads/candidate-work");
  const sourceStatus = git(repository, "status", "--porcelain=v1");
  const privateEmail = "synthetic.maintainer@example.invalid";
  const emailHash = createHash("sha256").update(privateEmail).digest("hex");
  const isolatedHome = join(root, "isolated-home");
  mkdirSync(isolatedHome);

  const result = JSON.parse(
    run(process.execPath, [
      rehearsalScript,
      "--source",
      repository,
      "--source-ref",
      "refs/heads/candidate-work",
      "--publication-target-ref",
      "refs/heads/main",
      "--output-parent",
      outputParent,
      "--private-pattern-file",
      patterns,
      "--private-email-sha256",
      emailHash,
      "--expected-sensitive-scratch-count",
      "9",
      "--prepare-command-json",
      JSON.stringify([process.execPath, "prepare.mjs"]),
      "--gate-command-json",
      JSON.stringify([process.execPath, "gate.mjs"]),
    ], {
      cwd: outputParent,
      env: {
        ...process.env,
        HOME: isolatedHome,
        XDG_CONFIG_HOME: join(isolatedHome, ".config"),
        ATHLETE_SECRET: "synthetic-private-value",
        AUTH_PRIVATE: "synthetic-private-value",
        AGENT_TOKEN: "synthetic-private-value",
        COACH_TOKEN: "synthetic-private-value",
        CLOUDFLARE_API_TOKEN: "synthetic-private-value",
        WORKOUT_REAL_FIT_PATH: "/synthetic/private/activity.fit",
      },
    }),
  );

  const report = JSON.parse(readFileSync(result.report, "utf8"));
  const rehearsalRoot = join(result.report, "..");
  const freshClone = join(rehearsalRoot, report.fresh_clone.directory);
  const recoveryClone = join(rehearsalRoot, report.backup.recovery_clone);

  assert.equal(report.status, "passed");
  assert.equal(report.schema_version, 2);
  assert.equal(report.source.exact_commit, sourceCommit);
  assert.equal(report.source.ref_inventory_scope, "local_for_each_ref_snapshot_only");
  assert.equal(report.source.live_remote_inventory_verified, false);
  assert.equal(report.backup.exact_source_commit_recoverable, true);
  assert.equal(report.backup.complete_local_source_ref_snapshot_verified, true);
  for (const sourceRef of report.source.refs) {
    assert.ok(report.backup.heads.some(
      ({ name, object }) => name === sourceRef.name && object === sourceRef.object,
    ));
  }
  assert.equal(report.policy.sensitive_scratch_count, 9);
  assert.ok(report.policy.preserved_scratch_paths.includes(".scratch/harmless/spec.md"));
  assert.ok(report.policy.discovered_sensitive_paths.includes(privateScratchPath));
  assert.equal(report.candidate.refs.length, 1);
  assert.equal(report.candidate.refs[0].name, "refs/heads/public-history-candidate");
  assert.ok(report.source.refs.some(({ name }) => name === "refs/tags/private-v0"));
  assert.ok(report.source.refs.some(({ name }) => name === "refs/codex/private-snapshot"));
  assert.ok(report.source.refs.some(({ name }) => name === "refs/remotes/archive/main"));
  assert.ok(report.source.refs.some(
    ({ name, object }) => name === "refs/codex/private-snapshot" && object === firstPrivateCommit,
  ));
  assert.equal(
    report.candidate.local_source_ref_dispositions.length,
    report.source.refs.length,
  );
  assert.deepEqual(
    report.candidate.local_source_ref_dispositions.map(({ source_ref: ref }) => ref).sort(),
    report.source.refs.map(({ name }) => name).sort(),
  );
  assert.equal(report.candidate.local_ref_disposition_scope, "local_source_snapshot_only_not_live_remote");
  assert.equal(report.candidate.live_remote_inventory_verified, false);
  assert.ok(report.candidate.local_source_ref_dispositions.every(({ status }) => [
    "rewritten",
    "overwritten_by_candidate",
    "delete_before_visibility",
  ].includes(status)));
  const rewrittenDisposition = report.candidate.local_source_ref_dispositions.find(
    ({ status }) => status === "rewritten",
  );
  assert.equal(rewrittenDisposition.source_ref, "refs/heads/candidate-work");
  assert.equal(rewrittenDisposition.new_ref, "refs/heads/main");
  assert.equal(rewrittenDisposition.new_object, report.candidate.audited_tip);
  assert.equal(rewrittenDisposition.proof.rewritten_tip_ancestor_of_audited_tip, true);
  assert.equal(rewrittenDisposition.proof.exact_source_tree_restored, true);
  const overwrittenDisposition = report.candidate.local_source_ref_dispositions.find(
    ({ status }) => status === "overwritten_by_candidate",
  );
  assert.equal(overwrittenDisposition.source_ref, "refs/heads/main");
  assert.equal(overwrittenDisposition.old_object, publicationTargetCommit);
  assert.equal(overwrittenDisposition.new_object, report.candidate.audited_tip);
  assert.equal(overwrittenDisposition.proof.candidate_absence_verified, true);
  assert.equal(overwrittenDisposition.proof.local_target_snapshot_object, publicationTargetCommit);
  assert.equal(overwrittenDisposition.proof.live_remote_lease_verified, false);
  const deleteDispositions = report.candidate.local_source_ref_dispositions.filter(
    ({ status }) => status === "delete_before_visibility",
  );
  assert.ok(deleteDispositions.length > 0);
  assert.ok(deleteDispositions.every(
    ({ new_ref: ref, new_object: object, proof }) => ref === null
      && object === null
      && proof.candidate_absence_verified,
  ));
  assert.equal(report.candidate.selected_ref_mapping.source_object, sourceCommit);
  assert.equal(report.candidate.selected_ref_mapping.source_ref, "refs/heads/candidate-work");
  assert.equal(report.candidate.selected_ref_mapping.candidate_ref, "refs/heads/public-history-candidate");
  assert.ok(report.candidate.rewritten_commit_metadata.some(
    ({ old, status }) => old === prunedCommit && status === "pruned",
  ));
  assert.ok(report.candidate.rewritten_commit_metadata.some(
    ({ old, status }) => old === sourceCommit && status === "survived",
  ));
  assert.equal(report.candidate.fsck_full_passed, true);
  assert.ok(report.candidate.ancestry_commit_count > 0);
  assert.ok(report.candidate.reachable_object_count > 0);
  assert.equal(report.candidate.source_tree, report.candidate.audited_tree);
  assert.equal(report.candidate.exact_source_tree_restored, true);
  assert.equal(report.fresh_clone.gate_passed, true);
  assert.equal(report.fresh_clone.prepare_passed, true);
  assert.equal(report.fresh_clone.fsck_full_passed, true);
  assert.equal(
    report.fresh_clone.reachable_object_count,
    report.candidate.reachable_object_count,
  );
  assert.equal(report.fresh_clone.environment_policy.mode, "minimal_allowlist");
  for (const prefix of ["ATHLETE_", "AUTH_", "AGENT_", "COACH_", "CLOUDFLARE_", "WORKOUT_"]) {
    assert.equal(
      report.fresh_clone.environment_policy.forwarded_names.some((name) => name.startsWith(prefix)),
      false,
    );
  }
  assert.deepEqual(report.fresh_clone.prepare_command, [process.execPath, "prepare.mjs"]);
  assert.deepEqual(report.fresh_clone.gate_command, [process.execPath, "gate.mjs"]);
  assert.deepEqual(report.external_actions, {
    force_push: false,
    remote_ref_deletion: false,
    visibility_change: false,
    tag_or_release: false,
    deployment: false,
    stopped_before_external_actions: true,
  });

  for (const path of SENSITIVE_SCRATCH_HISTORY_PATHS) {
    assert.equal(existsSync(join(freshClone, path)), false);
    assert.equal(git(freshClone, "log", "--format=%H", "--", path), "");
  }
  assert.equal(existsSync(join(freshClone, ".scratch/harmless/spec.md")), true);
  assert.equal(
    existsSync(join(freshClone, ".scratch/harmless/vendor-certificate.bin")),
    true,
  );
  assert.equal(git(freshClone, "log", "--format=%H", "--", "docs/private-email.bin"), "");
  assert.equal(existsSync(join(freshClone, "kept-ignored.txt")), true);
  assert.equal(
    git(freshClone, "log", "--format=%ae%n%ce").includes(privateEmail),
    false,
  );
  assert.match(
    git(freshClone, "log", "--format=%ae%n%ce"),
    /1306600\+lagrangee@users\.noreply\.github\.com/u,
  );
  assert.match(git(freshClone, "log", "--format=%an%n%cn"), /Synthetic Maintainer/u);
  assert.match(
    git(recoveryClone, "show", `${prunedCommit}:${privateScratchPath}`),
    /synthetic-private-host\.example/u,
  );
  assert.equal(
    report.operation_preview.repository.configured_origin_url_sha256,
    createHash("sha256").update(sourceRemoteUrl).digest("hex"),
  );
  assert.equal(
    report.operation_preview.repository.configured_origin_identity_scope,
    "local_git_config_snapshot_only",
  );
  assert.equal(report.operation_preview.live_remote_inventory.status, "not_run");
  assert.equal(
    report.operation_preview.force_with_lease.status,
    "blocked_pending_live_remote_inventory_and_separate_authorization",
  );
  assert.equal(report.operation_preview.force_with_lease.source_ref, "refs/heads/candidate-work");
  assert.equal(report.operation_preview.force_with_lease.target_ref, "refs/heads/main");
  assert.equal(report.operation_preview.force_with_lease.expected_old_object, null);
  assert.equal(report.operation_preview.force_with_lease.local_target_snapshot_object, publicationTargetCommit);
  assert.equal(report.operation_preview.force_with_lease.live_remote_lease_verified, false);
  assert.equal(report.operation_preview.force_with_lease.argv, null);
  assert.notEqual(report.operation_preview.force_with_lease.source_object, publicationTargetCommit);
  assert.equal(
    report.operation_preview.delete_refs.status,
    "blocked_pending_live_remote_inventory_and_separate_authorization",
  );
  assert.equal(
    report.operation_preview.visibility.status,
    "blocked_pending_live_remote_inventory_confirmed_ref_operations_and_separate_authorization",
  );
  assert.equal(report.operation_preview.visibility.authorization_status, "not_authorized");
  assert.equal(report.operation_preview.visibility.pending_live_ref_disposition_count, null);
  assert.equal(report.operation_preview.visibility.local_snapshot_ref_count, report.source.refs.length);
  assert.equal(report.operation_preview.tag_release.expected_tag, "v0.1.0");
  assert.equal(report.operation_preview.deploy.status, "blocked_missing_operator_input");
  assert.equal(git(repository, "remote", "get-url", "origin"), sourceRemoteUrl);
  assert.equal(git(repository, "rev-parse", "refs/heads/candidate-work"), sourceCommit);
  assert.equal(git(repository, "status", "--porcelain=v1"), sourceStatus);
}));

test("history rehearsal fails closed when sensitive scratch discovery differs from the approved count", () => withTemporaryRoot("workout-history-count-test-", (root) => {
  const { repository, privateValue } = createSyntheticSource(root);
  const outputParent = join(root, "private-output");
  mkdirSync(outputParent);
  const patterns = join(root, "private-patterns.txt");
  writeFileSync(patterns, `${privateValue}\n`);
  const emailHash = createHash("sha256")
    .update("synthetic.maintainer@example.invalid")
    .digest("hex");
  const sourceCommit = git(repository, "rev-parse", "refs/heads/candidate-work");

  const result = spawnSync(process.execPath, [
    rehearsalScript,
    "--source",
    repository,
    "--source-ref",
    "refs/heads/candidate-work",
    "--publication-target-ref",
    "refs/heads/main",
    "--output-parent",
    outputParent,
    "--private-pattern-file",
    patterns,
    "--private-email-sha256",
    emailHash,
    "--expected-sensitive-scratch-count",
    "8",
    "--prepare-command-json",
    JSON.stringify([process.execPath, "prepare.mjs"]),
    "--gate-command-json",
    JSON.stringify([process.execPath, "gate.mjs"]),
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /failed closed: sensitive scratch discovery count mismatch/u);
  assert.equal(git(repository, "rev-parse", "refs/heads/candidate-work"), sourceCommit);
  assert.equal(git(repository, "remote", "get-url", "origin"), createSyntheticRemoteUrl());
}));

test("history rehearsal refuses to guess a redaction for high-confidence material in a commit message", () => withTemporaryRoot("workout-history-message-test-", (root) => {
  const { repository, privateValue } = createSyntheticSource(root);
  const syntheticSecret = `${String.fromCharCode(103, 104, 112, 95)}${"A".repeat(40)}`;
  commit(repository, `test: historical credential ${syntheticSecret}`, "synthetic.maintainer@example.invalid");
  const outputParent = join(root, "private-output");
  mkdirSync(outputParent);
  const patterns = join(root, "private-patterns.txt");
  writeFileSync(patterns, `${privateValue}\n`);
  const emailHash = createHash("sha256")
    .update("synthetic.maintainer@example.invalid")
    .digest("hex");

  const result = spawnSync(process.execPath, [
    rehearsalScript,
    "--source",
    repository,
    "--source-ref",
    "refs/heads/candidate-work",
    "--publication-target-ref",
    "refs/heads/main",
    "--output-parent",
    outputParent,
    "--private-pattern-file",
    patterns,
    "--private-email-sha256",
    emailHash,
    "--expected-sensitive-scratch-count",
    "9",
    "--prepare-command-json",
    JSON.stringify([process.execPath, "prepare.mjs"]),
    "--gate-command-json",
    JSON.stringify([process.execPath, "gate.mjs"]),
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /failed closed: high-confidence material occurs in commit messages \(common-secret\)/u);
  assert.doesNotMatch(result.stderr, new RegExp(syntheticSecret));
  assert.equal(git(repository, "remote", "get-url", "origin"), createSyntheticRemoteUrl());
}));

function createSyntheticRemoteUrl() {
  return ["https:/", "example.invalid", "private.git"].join("/");
}

test("rewritten metadata verification rejects author-name and date drift", () => {
  const original = {
    authorName: "Synthetic Maintainer",
    committerName: "Synthetic Maintainer",
    authorEmail: "synthetic.maintainer@example.invalid",
    committerEmail: "synthetic.maintainer@example.invalid",
    authorDate: "2026-01-01T08:00:00+08:00",
    committerDate: "2026-01-01T08:00:00+08:00",
  };
  const rewritten = {
    ...original,
    authorEmail: "1306600+lagrangee@users.noreply.github.com",
    committerEmail: "1306600+lagrangee@users.noreply.github.com",
  };
  assert.doesNotThrow(() => assertRewrittenMetadata(
    original,
    rewritten,
    "synthetic.maintainer@example.invalid",
  ));
  assert.throws(
    () => assertRewrittenMetadata(
      original,
      { ...rewritten, authorName: "Drifted Name" },
      "synthetic.maintainer@example.invalid",
    ),
    /authorName/u,
  );
  assert.throws(
    () => assertRewrittenMetadata(
      original,
      { ...rewritten, committerDate: "2026-01-02T08:00:00+08:00" },
      "synthetic.maintainer@example.invalid",
    ),
    /committerDate/u,
  );
});

test("history scan keeps binary secrets visible without treating certificate email bytes as personal", () => {
  const syntheticSecret = Buffer.from(
    `${String.fromCharCode(103, 104, 112, 95)}${"A".repeat(40)}`,
  );
  const nulPrefixedSecret = Buffer.concat([Buffer.from([0]), syntheticSecret]);
  assert.ok(
    historyMaterialCategories("opaque.bin", nulPrefixedSecret).includes("common-secret"),
  );
  assert.ok(
    historyMaterialCategories(
      "tests/fixtures/fit/synthetic-workout.fit",
      Buffer.from("unverified bytes"),
    ).includes("unapproved-fit"),
  );
  const vendorCertificateEmail = ["signing", "vendor.example.org"].join("@");
  const binaryCertificate = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(vendorCertificateEmail),
    Buffer.from([0]),
  ]);
  assert.equal(
    historyMaterialCategories("concept.png", binaryCertificate).includes("personal-email"),
    false,
  );
  assert.equal(
    matchesAnyPrivatePattern(binaryCertificate, [vendorCertificateEmail]),
    true,
  );
  assert.ok(
    historyMaterialCategories(
      "notes.md",
      Buffer.from(`contact=${["maintainer", "project.example.org"].join("@")}\n`),
    ).includes("personal-email"),
  );
});
