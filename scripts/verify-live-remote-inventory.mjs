#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 16 * 1024 * 1024;

function usage() {
  return `Usage:
  node scripts/verify-live-remote-inventory.mjs \\
    --repository <private-cutover-repository> \\
    --remote <remote-name> \\
    --expected-remote-url-sha256 <digest> \\
    --publication-target-ref <full-head-ref> \\
    --expected-target-object <exact-live-object> \\
    --candidate-object <exact-candidate-commit> \\
    --dispositions-file <repo-external-json>

The single private cutover repository must both contain the exact candidate
commit and configure one identical fetch/push identity. The command is read-only:
it inventories that configured remote with git ls-remote --heads --tags --refs,
verifies an exact target lease and one disposition for every live head/tag,
and never fetches, changes Git config, pushes, deletes, changes visibility,
tags, releases, or deploys.`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--help") return { help: true };
    const value = argv[index + 1];
    if (!name.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid or missing value for argument: ${name}`);
    }
    index += 1;
    if (name === "--repository") options.repository = value;
    else if (name === "--remote") options.remote = value;
    else if (name === "--expected-remote-url-sha256") options.expectedRemoteUrlSha256 = value;
    else if (name === "--publication-target-ref") options.publicationTargetRef = value;
    else if (name === "--expected-target-object") options.expectedTargetObject = value;
    else if (name === "--candidate-object") options.candidateObject = value;
    else if (name === "--dispositions-file") options.dispositionsFile = value;
    else throw new Error(`unknown argument: ${name}`);
  }
  return options;
}

function isWithin(candidate, parent) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isObjectId(value) {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
}

function isLivePublicationRef(value) {
  return /^(?:refs\/heads|refs\/tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
    && !value.includes("..")
    && !value.includes("//")
    && !value.includes("@{")
    && !value.endsWith("/")
    && !value.endsWith(".");
}

async function run(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return result.stdout;
}

async function git(repository, args) {
  return run("git", ["-C", repository, ...args]);
}

function parseLiveRefs(output) {
  const refs = output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("\t");
      if (separator === -1) throw new Error("git ls-remote returned an invalid row");
      const object = line.slice(0, separator);
      const name = line.slice(separator + 1);
      if (!isObjectId(object) || !isLivePublicationRef(name)) {
        throw new Error("git ls-remote returned an invalid head or tag");
      }
      return { name, object };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(refs.map(({ name }) => name)).size !== refs.length) {
    throw new Error("git ls-remote returned duplicate refs");
  }
  return refs;
}

function parseDispositions(contents) {
  let document;
  try {
    document = JSON.parse(contents);
  } catch {
    throw new Error("dispositions file must contain valid JSON");
  }
  if (
    document?.schema_version !== 1
    || !Array.isArray(document.live_ref_dispositions)
  ) {
    throw new Error("dispositions file must use schema_version 1 and live_ref_dispositions");
  }
  const dispositions = document.live_ref_dispositions.map((entry) => {
    if (
      !isLivePublicationRef(entry?.ref)
      || !isObjectId(entry?.expected_object)
      || !["force_update_to_candidate", "delete_before_visibility"].includes(entry?.operation)
    ) {
      throw new Error("dispositions file contains an invalid live-ref disposition");
    }
    return {
      ref: entry.ref,
      expected_object: entry.expected_object,
      operation: entry.operation,
    };
  });
  if (new Set(dispositions.map(({ ref }) => ref)).size !== dispositions.length) {
    throw new Error("dispositions file contains duplicate refs");
  }
  return dispositions.sort((left, right) => left.ref.localeCompare(right.ref));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const required = [
    "repository",
    "remote",
    "expectedRemoteUrlSha256",
    "publicationTargetRef",
    "expectedTargetObject",
    "candidateObject",
    "dispositionsFile",
  ];
  for (const name of required) {
    if (options[name] === undefined) {
      throw new Error(`missing required --${name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(options.remote)) {
    throw new Error("remote must be one configured remote name");
  }
  if (!/^[a-f0-9]{64}$/u.test(options.expectedRemoteUrlSha256)) {
    throw new Error("expected remote URL SHA-256 must be a lowercase 64-character hex digest");
  }
  if (!isLivePublicationRef(options.publicationTargetRef) || !options.publicationTargetRef.startsWith("refs/heads/")) {
    throw new Error("publication target ref must be one full refs/heads ref");
  }
  if (!isObjectId(options.expectedTargetObject) || !isObjectId(options.candidateObject)) {
    throw new Error("expected target and candidate objects must be exact Git object IDs");
  }

  const repository = await realpath(resolve(options.repository));
  const dispositionsFile = await realpath(resolve(options.dispositionsFile));
  if (!(await stat(dispositionsFile)).isFile()) {
    throw new Error("dispositions input must be a regular file");
  }
  if (isWithin(dispositionsFile, repository)) {
    throw new Error("live remote dispositions must remain outside the cutover repository");
  }
  await git(repository, ["rev-parse", "--absolute-git-dir"]);

  const configuredUrlsBefore = (await git(repository, ["remote", "get-url", "--all", options.remote]))
    .trim()
    .split("\n")
    .filter(Boolean);
  if (configuredUrlsBefore.length !== 1) {
    throw new Error("configured remote must resolve to exactly one fetch URL");
  }
  const configuredRemoteUrl = configuredUrlsBefore[0];
  const configuredRemoteUrlSha256 = sha256(configuredRemoteUrl);
  if (configuredRemoteUrlSha256 !== options.expectedRemoteUrlSha256) {
    throw new Error("configured remote identity does not match the expected URL digest");
  }
  const configuredPushUrlsBefore = (
    await git(repository, ["remote", "get-url", "--push", "--all", options.remote])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (
    configuredPushUrlsBefore.length !== 1
    || configuredPushUrlsBefore[0] !== configuredRemoteUrl
  ) {
    throw new Error("configured remote push identity must be the one bound fetch identity");
  }

  let candidateCommit;
  try {
    candidateCommit = (
      await git(repository, ["rev-parse", "--verify", `${options.candidateObject}^{commit}`])
    ).trim();
  } catch {
    throw new Error("candidate object is not present as a commit in the cutover repository");
  }
  if (candidateCommit !== options.candidateObject) {
    throw new Error("candidate object does not resolve to the exact expected commit");
  }

  const liveRefs = parseLiveRefs(
    await git(repository, ["ls-remote", "--heads", "--tags", "--refs", options.remote]),
  );
  const configuredUrlsAfter = (await git(repository, ["remote", "get-url", "--all", options.remote]))
    .trim()
    .split("\n")
    .filter(Boolean);
  if (
    configuredUrlsAfter.length !== 1
    || configuredUrlsAfter[0] !== configuredRemoteUrl
    || sha256(configuredUrlsAfter[0]) !== options.expectedRemoteUrlSha256
  ) {
    throw new Error("configured remote identity changed during live inventory");
  }
  const configuredPushUrlsAfter = (
    await git(repository, ["remote", "get-url", "--push", "--all", options.remote])
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (
    configuredPushUrlsAfter.length !== 1
    || configuredPushUrlsAfter[0] !== configuredRemoteUrl
    || configuredPushUrlsAfter[0] !== configuredPushUrlsBefore[0]
  ) {
    throw new Error("configured remote push identity changed during live inventory");
  }

  const target = liveRefs.find(({ name }) => name === options.publicationTargetRef);
  if (!target) throw new Error("publication target is absent from the live remote inventory");
  if (target.object !== options.expectedTargetObject) {
    throw new Error("live publication target does not match the exact expected object");
  }

  const dispositions = parseDispositions(await readFile(dispositionsFile, "utf8"));
  const liveRefMap = new Map(liveRefs.map(({ name, object }) => [name, object]));
  const dispositionMap = new Map(dispositions.map((entry) => [entry.ref, entry]));
  const missing = liveRefs.filter(({ name }) => !dispositionMap.has(name));
  const stale = dispositions.filter(
    ({ ref, expected_object: expectedObject }) => liveRefMap.get(ref) !== expectedObject,
  );
  const unexpected = dispositions.filter(({ ref }) => !liveRefMap.has(ref));
  if (missing.length > 0 || stale.length > 0 || unexpected.length > 0) {
    throw new Error(
      `live remote ref disposition mismatch: missing=${missing.length}, stale=${stale.length}, unexpected=${unexpected.length}`,
    );
  }
  for (const disposition of dispositions) {
    const expectedOperation = disposition.ref === options.publicationTargetRef
      ? "force_update_to_candidate"
      : "delete_before_visibility";
    if (disposition.operation !== expectedOperation) {
      throw new Error("live remote ref disposition violates the single-publication-ref policy");
    }
  }
  if (dispositions.filter(({ operation }) => operation === "force_update_to_candidate").length !== 1) {
    throw new Error("exactly one live ref must be assigned to the candidate force update");
  }

  const deletionRefs = dispositions
    .filter(({ operation }) => operation === "delete_before_visibility")
    .map(({ ref, expected_object: expectedObject }) => ({
      ref,
      expected_object: expectedObject,
      argv: [
        "git",
        "-C",
        repository,
        "push",
        `--force-with-lease=${ref}:${expectedObject}`,
        options.remote,
        `:${ref}`,
      ],
      executed: false,
    }));
  console.log(JSON.stringify({
    schema_version: 1,
    status: "passed",
    claim: "live_remote_inventory_verified_read_only",
    repository_basename: basename(repository),
    cutover_repository: repository,
    remote: {
      name: options.remote,
      configured_url_sha256: configuredRemoteUrlSha256,
      exact_identity_matched: true,
      push_identity_matches_fetch: true,
      identity_stable_during_inventory: true,
    },
    publication: {
      target_ref: options.publicationTargetRef,
      expected_target_object: options.expectedTargetObject,
      live_target_object_verified: true,
      candidate_object: options.candidateObject,
      candidate_commit_verified: true,
      final_remote_ref_policy: "retain_only_publication_target_ref",
    },
    live_remote_inventory: {
      method: "git ls-remote --heads --tags --refs",
      refs: liveRefs,
      ref_count: liveRefs.length,
      every_live_ref_has_exact_disposition: true,
    },
    operation_boundaries: {
      force_update: {
        status: "not_authorized",
        remote: options.remote,
        target_ref: options.publicationTargetRef,
        expected_old_object: options.expectedTargetObject,
        candidate_object: options.candidateObject,
        argv: [
          "git",
          "-C",
          repository,
          "push",
          `--force-with-lease=${options.publicationTargetRef}:${options.expectedTargetObject}`,
          options.remote,
          `${options.candidateObject}:${options.publicationTargetRef}`,
        ],
        executed: false,
        required_confirmation: "confirm_exact_force_with_lease_operation_separately",
      },
      delete_refs: {
        status: "not_authorized",
        remote: options.remote,
        operations: deletionRefs,
        executed: false,
        required_confirmation: "confirm_exact_remote_ref_deletions_separately",
      },
      visibility: {
        status: "blocked_pending_confirmed_force_update_and_ref_deletions",
        authorization_status: "not_authorized",
        required_confirmation: "confirm_visibility_change_separately_after_live_ref_operations",
      },
    },
    external_actions: {
      force_push: false,
      remote_ref_deletion: false,
      visibility_change: false,
      tag_or_release: false,
      deployment: false,
    },
  }));
}

main().catch((error) => {
  console.error(`live remote inventory failed closed: ${error.message}`);
  process.exitCode = 1;
});
