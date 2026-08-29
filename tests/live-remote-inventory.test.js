import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const verifierScript = new URL(
  "../scripts/verify-live-remote-inventory.mjs",
  import.meta.url,
).pathname;

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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

function writeDispositions(path, entries) {
  writeFileSync(path, `${JSON.stringify({
    schema_version: 1,
    live_ref_dispositions: entries,
  }, null, 2)}\n`);
}

function verifierArgs({
  repository,
  remoteUrlHash,
  targetObject,
  candidateObject,
  dispositionsFile,
}) {
  return [
    verifierScript,
    "--repository",
    repository,
    "--candidate-repository",
    repository,
    "--remote",
    "origin",
    "--expected-remote-url-sha256",
    remoteUrlHash,
    "--publication-target-ref",
    "refs/heads/main",
    "--expected-target-object",
    targetObject,
    "--candidate-object",
    candidateObject,
    "--dispositions-file",
    dispositionsFile,
  ];
}

test("live remote inventory discovers unseen heads and tags, fails closed, and performs no mutation", () => withTemporaryRoot("workout-live-remote-test-", (root) => {
  const repository = join(root, "checkout");
  const remote = join(root, "remote.git");
  mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Synthetic Maintainer");
  git(repository, "config", "user.email", "maintainer@example.invalid");
  writeFileSync(join(repository, "source.txt"), "public source\n");
  git(repository, "add", "source.txt");
  git(repository, "commit", "-m", "chore: create source");
  const targetObject = git(repository, "rev-parse", "HEAD");

  run("git", ["init", "--bare", remote]);
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "-u", "origin", "main");
  run("git", ["--git-dir", remote, "update-ref", "refs/heads/unseen-branch", targetObject]);
  run("git", ["--git-dir", remote, "update-ref", "refs/tags/unseen-v0", targetObject]);

  assert.equal(git(repository, "for-each-ref", "--format=%(refname)", "refs/remotes/origin/unseen-branch"), "");
  assert.equal(git(repository, "for-each-ref", "--format=%(refname)", "refs/tags/unseen-v0"), "");

  writeFileSync(join(repository, "candidate.txt"), "sanitized candidate\n");
  git(repository, "add", "candidate.txt");
  git(repository, "commit", "-m", "chore: create candidate");
  const candidateObject = git(repository, "rev-parse", "HEAD");
  const remoteUrlHash = createHash("sha256").update(remote).digest("hex");
  const dispositionsFile = join(root, "live-ref-dispositions.json");
  const remoteRefsBefore = run("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname)%09%(objectname)"]);
  const localRefsBefore = git(repository, "for-each-ref", "--format=%(refname)%09%(objectname)");
  const localStatusBefore = git(repository, "status", "--porcelain=v1");

  writeDispositions(dispositionsFile, [
    {
      ref: "refs/heads/main",
      expected_object: targetObject,
      operation: "force_update_to_candidate",
    },
  ]);
  const blocked = spawnSync(process.execPath, verifierArgs({
    repository,
    remoteUrlHash,
    targetObject,
    candidateObject,
    dispositionsFile,
  }), { encoding: "utf8" });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /live remote ref disposition mismatch: missing=2, stale=0, unexpected=0/u);

  writeDispositions(dispositionsFile, [
    {
      ref: "refs/heads/main",
      expected_object: targetObject,
      operation: "force_update_to_candidate",
    },
    {
      ref: "refs/heads/unseen-branch",
      expected_object: targetObject,
      operation: "delete_before_visibility",
    },
    {
      ref: "refs/tags/unseen-v0",
      expected_object: targetObject,
      operation: "delete_before_visibility",
    },
  ]);
  const report = JSON.parse(run(process.execPath, verifierArgs({
    repository,
    remoteUrlHash,
    targetObject,
    candidateObject,
    dispositionsFile,
  })));

  assert.equal(report.status, "passed");
  assert.equal(report.claim, "live_remote_inventory_verified_read_only");
  assert.equal(report.remote.configured_url_sha256, remoteUrlHash);
  assert.equal(report.remote.push_identity_matches_fetch, true);
  assert.equal(report.publication.target_ref, "refs/heads/main");
  assert.equal(report.publication.expected_target_object, targetObject);
  assert.equal(report.publication.candidate_object, candidateObject);
  assert.deepEqual(
    report.live_remote_inventory.refs.map(({ name }) => name),
    ["refs/heads/main", "refs/heads/unseen-branch", "refs/tags/unseen-v0"],
  );
  assert.equal(report.live_remote_inventory.every_live_ref_has_exact_disposition, true);
  assert.equal(report.operation_boundaries.force_update.status, "not_authorized");
  assert.equal(report.operation_boundaries.force_update.executed, false);
  assert.equal(report.operation_boundaries.force_update.remote, "origin");
  assert.equal(report.operation_boundaries.force_update.target_ref, "refs/heads/main");
  assert.equal(report.operation_boundaries.force_update.expected_old_object, targetObject);
  assert.equal(report.operation_boundaries.force_update.candidate_object, candidateObject);
  assert.deepEqual(report.operation_boundaries.force_update.argv, [
    "git",
    "push",
    `--force-with-lease=refs/heads/main:${targetObject}`,
    "origin",
    `${candidateObject}:refs/heads/main`,
  ]);
  assert.equal(report.operation_boundaries.delete_refs.status, "not_authorized");
  assert.equal(report.operation_boundaries.delete_refs.executed, false);
  assert.equal(report.operation_boundaries.delete_refs.remote, "origin");
  assert.deepEqual(report.operation_boundaries.delete_refs.operations, [
    {
      ref: "refs/heads/unseen-branch",
      expected_object: targetObject,
      argv: [
        "git",
        "push",
        `--force-with-lease=refs/heads/unseen-branch:${targetObject}`,
        "origin",
        ":refs/heads/unseen-branch",
      ],
      executed: false,
    },
    {
      ref: "refs/tags/unseen-v0",
      expected_object: targetObject,
      argv: [
        "git",
        "push",
        `--force-with-lease=refs/tags/unseen-v0:${targetObject}`,
        "origin",
        ":refs/tags/unseen-v0",
      ],
      executed: false,
    },
  ]);
  assert.equal(
    report.operation_boundaries.visibility.status,
    "blocked_pending_confirmed_force_update_and_ref_deletions",
  );
  assert.deepEqual(report.external_actions, {
    force_push: false,
    remote_ref_deletion: false,
    visibility_change: false,
    tag_or_release: false,
    deployment: false,
  });
  assert.equal(
    run("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname)%09%(objectname)"]),
    remoteRefsBefore,
  );
  assert.equal(git(repository, "for-each-ref", "--format=%(refname)%09%(objectname)"), localRefsBefore);
  assert.equal(git(repository, "status", "--porcelain=v1"), localStatusBefore);
}));

test("live remote inventory rejects a push URL that differs from the inventoried fetch identity", () => withTemporaryRoot("workout-live-pushurl-test-", (root) => {
  const repository = join(root, "checkout");
  const fetchRemote = join(root, "fetch.git");
  const pushRemote = join(root, "push.git");
  mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Synthetic Maintainer");
  git(repository, "config", "user.email", "maintainer@example.invalid");
  writeFileSync(join(repository, "source.txt"), "source\n");
  git(repository, "add", "source.txt");
  git(repository, "commit", "-m", "chore: source");
  const targetObject = git(repository, "rev-parse", "HEAD");
  run("git", ["init", "--bare", fetchRemote]);
  run("git", ["init", "--bare", pushRemote]);
  git(repository, "remote", "add", "origin", fetchRemote);
  git(repository, "push", "origin", "main");
  git(repository, "remote", "set-url", "--push", "origin", pushRemote);
  const dispositionsFile = join(root, "live-ref-dispositions.json");
  writeDispositions(dispositionsFile, [{
    ref: "refs/heads/main",
    expected_object: targetObject,
    operation: "force_update_to_candidate",
  }]);

  const result = spawnSync(process.execPath, verifierArgs({
    repository,
    remoteUrlHash: createHash("sha256").update(fetchRemote).digest("hex"),
    targetObject,
    candidateObject: targetObject,
    dispositionsFile,
  }), { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /configured remote push identity must be the one bound fetch identity/u);
  assert.equal(run("git", ["--git-dir", fetchRemote, "rev-parse", "refs/heads/main"]), targetObject);
  assert.notEqual(spawnSync("git", ["--git-dir", pushRemote, "rev-parse", "--verify", "refs/heads/main"]).status, 0);
}));

test("live remote inventory rejects a stale target lease before any operation can be previewed", () => withTemporaryRoot("workout-live-lease-test-", (root) => {
  const repository = join(root, "checkout");
  const remote = join(root, "remote.git");
  mkdirSync(repository);
  git(repository, "init", "-b", "main");
  git(repository, "config", "user.name", "Synthetic Maintainer");
  git(repository, "config", "user.email", "maintainer@example.invalid");
  writeFileSync(join(repository, "source.txt"), "source\n");
  git(repository, "add", "source.txt");
  git(repository, "commit", "-m", "chore: source");
  const targetObject = git(repository, "rev-parse", "HEAD");
  run("git", ["init", "--bare", remote]);
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "origin", "main");
  const dispositionsFile = join(root, "live-ref-dispositions.json");
  writeDispositions(dispositionsFile, [{
    ref: "refs/heads/main",
    expected_object: targetObject,
    operation: "force_update_to_candidate",
  }]);

  const result = spawnSync(process.execPath, verifierArgs({
    repository,
    remoteUrlHash: createHash("sha256").update(remote).digest("hex"),
    targetObject: "0".repeat(40),
    candidateObject: targetObject,
    dispositionsFile,
  }), { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /live publication target does not match the exact expected object/u);
  assert.equal(git(repository, "remote", "get-url", "origin"), remote);
  assert.equal(run("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"]), targetObject);
}));
