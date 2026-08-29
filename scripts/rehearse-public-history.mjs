#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_HISTORY_REMOVE_PATHS,
  PUBLIC_NO_REPLY_EMAIL,
  SENSITIVE_SCRATCH_HISTORY_PATHS,
  assertRewrittenMetadata,
  expectedRewrittenMetadata,
  historyMaterialCategories,
  matchesAnyPrivatePattern,
  parsePrivatePatterns,
  selectPrivateEmail,
  sha256,
  validateRepoPath,
} from "./history-sanitization-policy.mjs";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 128 * 1024 * 1024;

function usage() {
  return `Usage:
  node scripts/rehearse-public-history.mjs \\
    --source <read-only-repository> \\
    --source-ref <full-ref-or-commit> \\
    --publication-target-ref <full-head-ref> \\
    --output-parent <existing-repo-external-directory> \\
    --private-pattern-file <repo-external-file> \\
    --private-email-sha256 <digest> \\
    --expected-sensitive-scratch-count <count> \\
    --prepare-command-json '["npm","ci","--ignore-scripts"]' \\
    --gate-command-json '["npm","run","public:gate"]'

The command creates its own private disposable directory below --output-parent.
It never pushes, changes a remote, tags a release, deploys, or changes visibility.`;
}

function parseArgs(argv) {
  const options = { removePaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === "--help") return { help: true };
    if (!name.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`invalid or missing value for argument: ${name}`);
    }
    index += 1;
    if (name === "--remove-path") options.removePaths.push(value);
    else if (name === "--source") options.source = value;
    else if (name === "--source-ref") options.sourceRef = value;
    else if (name === "--publication-target-ref") options.publicationTargetRef = value;
    else if (name === "--output-parent") options.outputParent = value;
    else if (name === "--private-pattern-file") options.privatePatternFile = value;
    else if (name === "--private-email-sha256") options.privateEmailSha256 = value;
    else if (name === "--expected-sensitive-scratch-count") {
      options.expectedSensitiveScratchCount = Number(value);
    } else if (name === "--gate-command-json") options.gateCommandJson = value;
    else if (name === "--prepare-command-json") options.prepareCommandJson = value;
    else if (name === "--candidate-branch") options.candidateBranch = value;
    else throw new Error(`unknown argument: ${name}`);
  }
  return options;
}

function isWithin(candidate, parent) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function freshCommandEnvironment(outputRoot) {
  const home = join(outputRoot, "fresh-command-home");
  const cache = join(home, ".cache");
  const config = join(home, ".config");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  await mkdir(config, { recursive: true, mode: 0o700 });
  const forwardedNames = [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "NODE_EXTRA_CA_CERTS",
    "NPM_CONFIG_CAFILE",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ];
  const environment = {};
  for (const name of forwardedNames) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  Object.assign(environment, {
    HOME: home,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    CI: "true",
  });
  return {
    environment,
    report: {
      mode: "minimal_allowlist",
      temporary_home: basename(home),
      forwarded_names: Object.keys(environment).sort(),
      stripped_prefixes: [
        "AGENT_",
        "ATHLETE_",
        "AUTH_",
        "CLOUDFLARE_",
        "COACH_",
        "WORKOUT_",
      ],
    },
  };
}

async function run(file, args, options = {}) {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding ?? "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return result.stdout;
}

async function git(repository, args, options = {}) {
  return run("git", ["-C", repository, ...args], options);
}

async function gitObjectExists(repository, object) {
  try {
    await git(repository, ["cat-file", "-e", object]);
    return true;
  } catch {
    return false;
  }
}

async function refs(repository) {
  const output = await git(repository, [
    "for-each-ref",
    "--format=%(refname)%09%(objectname)",
  ]);
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, object] = line.split("\t");
      return { name, object };
    });
}

async function bundleHeads(bundle, repository) {
  const output = await run("git", ["bundle", "list-heads", bundle], {
    cwd: repository,
  });
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      return {
        object: line.slice(0, separator),
        name: line.slice(separator + 1),
      };
    });
}

async function historyPaths(repository, revision) {
  const output = await git(repository, [
    "log",
    "--format=",
    "--name-only",
    revision,
  ]);
  return new Set(output.split("\n").filter(Boolean));
}

async function reachableBlobEntries(repository, revision) {
  const output = await git(repository, ["rev-list", "--objects", revision]);
  const entries = [];
  for (const line of output.trim().split("\n").filter(Boolean)) {
    const separator = line.indexOf(" ");
    const object = separator === -1 ? line : line.slice(0, separator);
    const path = separator === -1 ? null : line.slice(separator + 1);
    if ((await git(repository, ["cat-file", "-t", object])).trim() === "blob") {
      entries.push({ object, path });
    }
  }
  return entries;
}

async function scanPrivatePatterns(repository, revision, patterns) {
  const matches = [];
  const seen = new Set();
  for (const entry of await reachableBlobEntries(repository, revision)) {
    if (seen.has(entry.object)) continue;
    seen.add(entry.object);
    const contents = await git(repository, ["cat-file", "blob", entry.object], {
      encoding: "buffer",
    });
    if (matchesAnyPrivatePattern(contents, patterns)) matches.push(entry);
  }
  const messages = Buffer.from(
    await git(repository, ["log", "--format=%B", revision]),
  );
  if (matchesAnyPrivatePattern(messages, patterns)) {
    throw new Error("a private pattern occurs in a commit message; aborting rather than guessing a redaction");
  }
  return matches;
}

async function scanHighConfidenceHistoryMaterial(repository, revision) {
  const findings = [];
  const seen = new Set();
  for (const entry of await reachableBlobEntries(repository, revision)) {
    const key = `${entry.object}\0${entry.path ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contents = await git(repository, ["cat-file", "blob", entry.object], {
      encoding: "buffer",
    });
    const categories = historyMaterialCategories(entry.path, contents);
    if (categories.length > 0) findings.push({ ...entry, categories });
  }
  const messages = Buffer.from(
    await git(repository, ["log", "--format=%B", revision]),
  );
  const messageCategories = historyMaterialCategories(null, messages);
  if (messageCategories.length > 0) {
    throw new Error(
      `high-confidence material occurs in commit messages (${messageCategories.join(", ")}); aborting rather than guessing a rewrite`,
    );
  }
  return findings;
}

async function commitEmails(repository, revision) {
  const output = await git(repository, ["log", "--format=%ae%n%ce", revision]);
  return output.split("\n").map((email) => email.trim()).filter(Boolean);
}

async function commitMetadata(repository, commit) {
  const values = (
    await git(repository, [
      "show",
      "-s",
      "--format=%an%x00%cn%x00%ae%x00%ce%x00%aI%x00%cI",
      commit,
    ])
  ).trim().split("\0");
  return {
    authorName: values[0],
    committerName: values[1],
    authorEmail: values[2],
    committerEmail: values[3],
    authorDate: values[4],
    committerDate: values[5],
  };
}

async function commitMessage(repository, commit) {
  return git(repository, ["show", "-s", "--format=%B", commit]);
}

async function commitParents(repository, commit) {
  const output = (await git(repository, ["show", "-s", "--format=%P", commit])).trim();
  return output === "" ? [] : output.split(" ");
}

function parseFilterBranchState(contents) {
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      const old = line.slice(0, separator);
      const mappedTo = line.slice(separator + 1);
      if (!/^[a-f0-9]{40}$/u.test(old) || !/^[a-f0-9]{40}$/u.test(mappedTo)) {
        throw new Error("filter-branch state contains an unsupported commit mapping");
      }
      return { old, mappedTo };
    });
}

async function verifyRewrittenCommitMetadata({
  source,
  rewrite,
  sourceCommit,
  rewrittenTip,
  stateMappings,
  privateEmail,
}) {
  const originalCommits = (
    await git(source, ["rev-list", sourceCommit])
  ).trim().split("\n").filter(Boolean);
  const rewrittenCommits = new Set(
    (await git(rewrite, ["rev-list", rewrittenTip])).trim().split("\n").filter(Boolean),
  );
  const stateByOld = new Map(stateMappings.map((entry) => [entry.old, entry.mappedTo]));
  if (
    stateByOld.size !== originalCommits.length
    || originalCommits.some((commit) => !stateByOld.has(commit))
  ) {
    throw new Error("filter-branch state does not cover every selected source commit");
  }

  const originalDetails = new Map();
  const rewrittenDetails = new Map();
  for (const commit of originalCommits) {
    originalDetails.set(commit, {
      metadata: await commitMetadata(source, commit),
      message: await commitMessage(source, commit),
      parents: await commitParents(source, commit),
    });
  }
  for (const commit of rewrittenCommits) {
    rewrittenDetails.set(commit, {
      metadata: await commitMetadata(rewrite, commit),
      message: await commitMessage(rewrite, commit),
      parents: await commitParents(rewrite, commit),
    });
  }

  const survivorsByRewrittenCommit = new Map();
  for (const commit of originalCommits) {
    const mappedTo = stateByOld.get(commit);
    if (!rewrittenCommits.has(mappedTo)) continue;
    const original = originalDetails.get(commit);
    const rewritten = rewrittenDetails.get(mappedTo);
    const expected = expectedRewrittenMetadata(original.metadata, privateEmail);
    const metadataMatches = Object.keys(expected).every(
      (field) => expected[field] === rewritten.metadata[field],
    );
    if (metadataMatches && original.message === rewritten.message) {
      const candidates = survivorsByRewrittenCommit.get(mappedTo) ?? [];
      candidates.push(commit);
      survivorsByRewrittenCommit.set(mappedTo, candidates);
    }
  }

  for (const commit of rewrittenCommits) {
    const candidates = survivorsByRewrittenCommit.get(commit) ?? [];
    if (candidates.length !== 1) {
      throw new Error(
        `rewritten commit does not have one unambiguous source metadata owner (${candidates.length} candidates)`,
      );
    }
  }

  const survivingOldCommits = new Set(
    [...survivorsByRewrittenCommit.values()].map(([commit]) => commit),
  );
  const verifiedMappings = [];
  for (const commit of originalCommits) {
    const mappedTo = stateByOld.get(commit);
    if (survivingOldCommits.has(commit)) {
      const expectedParents = [];
      for (const parent of originalDetails.get(commit).parents) {
        const mappedParent = stateByOld.get(parent);
        if (!mappedParent) {
          throw new Error("surviving commit parent is absent from filter-branch state");
        }
        if (!expectedParents.includes(mappedParent)) expectedParents.push(mappedParent);
      }
      const actualParents = rewrittenDetails.get(mappedTo).parents;
      if (
        expectedParents.length !== actualParents.length
        || expectedParents.some((parent, index) => parent !== actualParents[index])
      ) {
        throw new Error("rewritten commit parent topology drifted");
      }
      assertRewrittenMetadata(
        originalDetails.get(commit).metadata,
        rewrittenDetails.get(mappedTo).metadata,
        privateEmail,
      );
      verifiedMappings.push({ old: commit, status: "survived", new: mappedTo });
    } else {
      verifiedMappings.push({ old: commit, status: "pruned", mapped_to: mappedTo });
    }
  }
  return verifiedMappings;
}

async function blobVersionsForPath(repository, revision, path) {
  const commits = (
    await git(repository, ["rev-list", revision, "--", path])
  ).trim().split("\n").filter(Boolean);
  const objects = new Set();
  for (const commit of commits) {
    const row = (await git(repository, ["ls-tree", commit, "--", path])).trim();
    if (!row) continue;
    const match = row.match(/^\d+\s+blob\s+([a-f0-9]{40})\t/u);
    if (match) objects.add(match[1]);
  }
  return objects;
}

async function currentBlobForPath(repository, revision, path) {
  const row = (await git(repository, ["ls-tree", revision, "--", path])).trim();
  const match = row.match(/^\d+\s+blob\s+([a-f0-9]{40})\t/u);
  return match?.[1] ?? null;
}

async function createAuditedTip({
  repository,
  auditedTree,
  parent,
  metadata,
  privateEmail,
}) {
  const gitDirectory = join(repository, ".git");
  await run("git", [
    `--git-dir=${gitDirectory}`,
    `--work-tree=${auditedTree}`,
    "read-tree",
    "--empty",
  ]);
  await run("git", [
    `--git-dir=${gitDirectory}`,
    `--work-tree=${auditedTree}`,
    "add",
    "-A",
    "-f",
  ]);
  const tree = (await run("git", [`--git-dir=${gitDirectory}`, "write-tree"])).trim();
  const mapEmail = (email) =>
    email === privateEmail ? PUBLIC_NO_REPLY_EMAIL : email;
  return (
    await run(
      "git",
      [
        `--git-dir=${gitDirectory}`,
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        "chore: restore audited public source tip",
      ],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: metadata.authorName,
          GIT_AUTHOR_EMAIL: mapEmail(metadata.authorEmail),
          GIT_AUTHOR_DATE: metadata.authorDate,
          GIT_COMMITTER_NAME: metadata.committerName,
          GIT_COMMITTER_EMAIL: mapEmail(metadata.committerEmail),
          GIT_COMMITTER_DATE: metadata.committerDate,
        },
      },
    )
  ).trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const required = [
    "source",
    "sourceRef",
    "publicationTargetRef",
    "outputParent",
    "privatePatternFile",
    "privateEmailSha256",
    "prepareCommandJson",
    "gateCommandJson",
  ];
  for (const name of required) {
    if (options[name] === undefined) throw new Error(`missing required --${name.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  if (!Number.isSafeInteger(options.expectedSensitiveScratchCount) || options.expectedSensitiveScratchCount < 0) {
    throw new Error("--expected-sensitive-scratch-count must be a non-negative integer");
  }

  const source = await realpath(resolve(options.source));
  const outputParent = await realpath(resolve(options.outputParent));
  const privatePatternFile = await realpath(resolve(options.privatePatternFile));
  if (!(await stat(outputParent)).isDirectory()) throw new Error("output parent must be an existing directory");
  if (!(await stat(privatePatternFile)).isFile()) throw new Error("private pattern input must be a regular file");
  if (isWithin(outputParent, source) || isWithin(privatePatternFile, source)) {
    throw new Error("output and private pattern input must remain outside the source repository");
  }
  if (isWithin(source, outputParent)) throw new Error("source repository cannot be inside the output parent");

  const sourceGitDirectory = (await git(source, ["rev-parse", "--absolute-git-dir"])).trim();
  if (!sourceGitDirectory) throw new Error("source is not a Git repository");
  if (
    !/^refs\/heads\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(options.sourceRef)
    || options.sourceRef.includes("..")
  ) {
    throw new Error("source ref must be one full refs/heads selected ancestry ref");
  }
  if (
    !/^refs\/heads\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(options.publicationTargetRef)
    || options.publicationTargetRef.includes("..")
  ) {
    throw new Error("publication target ref must be one full refs/heads ref");
  }
  const sourceCommit = (
    await git(source, ["rev-parse", "--verify", `${options.sourceRef}^{commit}`])
  ).trim();
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error("source ref did not resolve to one exact commit");
  const sourceRemoteUrl = (await git(source, ["remote", "get-url", "origin"])).trim();
  if (!sourceRemoteUrl) throw new Error("source repository requires an exact origin remote identity");

  const candidateBranch = options.candidateBranch ?? "public-history-candidate";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(candidateBranch) || candidateBranch.includes("..")) {
    throw new Error("candidate branch name is invalid");
  }
  if (`refs/heads/${candidateBranch}` === options.sourceRef || `refs/heads/${candidateBranch}` === options.publicationTargetRef) {
    throw new Error("disposable candidate ref must differ from source and publication target refs");
  }
  const parseCommand = (name, input) => {
    let command;
    try {
      command = JSON.parse(input);
    } catch {
      throw new Error(`${name} command must be a JSON array`);
    }
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || part.length === 0)) {
      throw new Error(`${name} command must be a non-empty JSON string array`);
    }
    return command;
  };
  const prepareCommand = parseCommand("prepare", options.prepareCommandJson);
  const gateCommand = parseCommand("gate", options.gateCommandJson);

  const patterns = parsePrivatePatterns(await readFile(privatePatternFile, "utf8"));
  const outputRoot = await mkdtemp(join(outputParent, "workout-history-rehearsal-"));
  await chmod(outputRoot, 0o700);
  await writeFile(
    join(outputRoot, ".history-rehearsal-disposable.json"),
    `${JSON.stringify({ schema_version: 1, source_commit: sourceCommit }, null, 2)}\n`,
    { mode: 0o600 },
  );

  // This is intentionally only a local refs snapshot. A checkout may have
  // stale or incomplete remote-tracking refs, so none of these values is
  // evidence about the current live remote inventory or a usable lease.
  const sourceRefs = await refs(source);
  const localPublicationTarget = sourceRefs.find(
    ({ name }) => name === options.publicationTargetRef,
  );
  if (!localPublicationTarget) {
    throw new Error("publication target ref is absent from the local source ref snapshot");
  }
  const selectedSourceRef = sourceRefs.find(
    ({ name, object }) => name === options.sourceRef && object === sourceCommit,
  );
  if (!selectedSourceRef) {
    throw new Error("selected source ref is absent or mismatched in the local source ref snapshot");
  }
  if (options.sourceRef === options.publicationTargetRef) {
    throw new Error("selected source ancestry ref and publication target ref must be distinct");
  }
  const sourceObjectLines = (
    await git(source, ["rev-list", "--objects", "--all"])
  ).trim().split("\n").filter(Boolean);
  const sourceAncestryCount = Number(
    (await git(source, ["rev-list", "--count", sourceCommit])).trim(),
  );
  const privateEmail = selectPrivateEmail(
    await commitEmails(source, sourceCommit),
    options.privateEmailSha256,
  );

  const sourcePatternMatches = await scanPrivatePatterns(source, sourceCommit, patterns);
  const sourcePolicyMatches = await scanHighConfidenceHistoryMaterial(source, sourceCommit);
  const sourceHistoryPathSet = await historyPaths(source, sourceCommit);
  const discoveredSensitivePaths = [...new Set(
    [...sourcePatternMatches, ...sourcePolicyMatches]
      .map(({ path }) => path)
      .filter(Boolean),
  )].map(validateRepoPath).sort();
  const sensitiveScratchPaths = [...new Set([
    ...SENSITIVE_SCRATCH_HISTORY_PATHS.filter((path) => sourceHistoryPathSet.has(path)),
    ...discoveredSensitivePaths.filter((path) => path.startsWith(".scratch/")),
  ])].sort();
  if (sensitiveScratchPaths.length !== options.expectedSensitiveScratchCount) {
    throw new Error(
      `sensitive scratch discovery count mismatch: expected ${options.expectedSensitiveScratchCount}, found ${sensitiveScratchPaths.length}`,
    );
  }
  const removePaths = [...new Set([
    ...DEFAULT_HISTORY_REMOVE_PATHS,
    ...sensitiveScratchPaths,
    ...options.removePaths,
    ...discoveredSensitivePaths,
  ].map(validateRepoPath))].sort();

  const auditedArchive = join(outputRoot, "audited-source-tip.tar");
  const auditedTree = join(outputRoot, "audited-source-tip");
  await mkdir(auditedTree, { mode: 0o700 });
  await git(source, ["archive", "--format=tar", `--output=${auditedArchive}`, sourceCommit]);
  await run("tar", ["-xf", auditedArchive, "-C", auditedTree]);
  // The exact source tip must already be safe. History cleanup is not allowed to
  // conceal unsafe maintained source by restoring it after the rewrite.
  for (const pattern of patterns) {
    if (matchesAnyPrivatePattern(await readFile(auditedArchive), [pattern])) {
      throw new Error("the audited source-tip archive still contains a private pattern");
    }
  }

  const backupBundle = join(outputRoot, "private-source-backup.bundle");
  await git(source, ["bundle", "create", backupBundle, "--all"]);
  await git(source, ["bundle", "verify", backupBundle]);
  const backupHeads = await bundleHeads(backupBundle, source);
  const backupHeadMap = new Map(backupHeads.map(({ name, object }) => [name, object]));
  const missingOrMismatchedBackupRefs = sourceRefs.filter(
    ({ name, object }) => backupHeadMap.get(name) !== object,
  );
  if (missingOrMismatchedBackupRefs.length > 0) {
    throw new Error(
      `private backup does not contain the complete local source ref snapshot (${missingOrMismatchedBackupRefs.length} missing or mismatched)`,
    );
  }
  const sourceRefMap = new Map(sourceRefs.map(({ name, object }) => [name, object]));
  const unexpectedBundleRefs = backupHeads.filter(
    ({ name, object }) => name.startsWith("refs/") && sourceRefMap.get(name) !== object,
  );
  if (unexpectedBundleRefs.length > 0) {
    throw new Error(
      `private backup contains an unexpected or mismatched refs namespace entry (${unexpectedBundleRefs.length})`,
    );
  }
  const recovery = join(outputRoot, "bundle-recovery-clone");
  await run("git", ["clone", "--no-hardlinks", backupBundle, recovery]);
  if (!(await gitObjectExists(recovery, sourceCommit))) {
    throw new Error("private backup recovery clone cannot resolve the exact source commit");
  }
  await git(recovery, ["fsck", "--full"]);

  const rewrite = join(outputRoot, "disposable-rewrite");
  await run("git", ["clone", "--no-local", "--no-hardlinks", source, rewrite]);
  await git(rewrite, ["remote", "remove", "origin"]);
  await git(rewrite, ["checkout", "--force", "-B", candidateBranch, sourceCommit]);
  for (const { name } of await refs(rewrite)) {
    if (name !== `refs/heads/${candidateBranch}`) await git(rewrite, ["update-ref", "-d", name]);
  }
  if ((await git(rewrite, ["remote"])).trim() !== "") {
    throw new Error("disposable rewrite unexpectedly retained a remote");
  }

  const sourceScratchPaths = [...await historyPaths(rewrite, sourceCommit)]
    .filter((path) => path.startsWith(".scratch/") && !removePaths.includes(path))
    .sort();
  const oldBlobObjects = new Set();
  for (const path of removePaths) {
    const current = await currentBlobForPath(rewrite, sourceCommit, path);
    for (const object of await blobVersionsForPath(rewrite, sourceCommit, path)) {
      if (object !== current) oldBlobObjects.add(object);
    }
  }

  const removePathFile = join(outputRoot, "remove-paths.nul");
  await writeFile(removePathFile, Buffer.from(`${removePaths.join("\0")}\0`), { mode: 0o600 });
  const indexFilter = join(outputRoot, "index-filter.sh");
  await writeFile(
    indexFilter,
    "#!/bin/sh\nexec xargs -0 git rm -r --cached --ignore-unmatch -- < \"$HISTORY_REMOVE_PATH_FILE\"\n",
    { mode: 0o700 },
  );
  const environmentFilter = [
    'if test "$GIT_AUTHOR_EMAIL" = "$HISTORY_PRIVATE_EMAIL"; then',
    '  GIT_AUTHOR_EMAIL="$HISTORY_PUBLIC_EMAIL"; export GIT_AUTHOR_EMAIL;',
    "fi;",
    'if test "$GIT_COMMITTER_EMAIL" = "$HISTORY_PRIVATE_EMAIL"; then',
    '  GIT_COMMITTER_EMAIL="$HISTORY_PUBLIC_EMAIL"; export GIT_COMMITTER_EMAIL;',
    "fi",
  ].join(" ");
  const rewriteStateRef = "refs/codex/history-rewrite-state";
  await git(
    rewrite,
    [
      "filter-branch",
      "--force",
      "--env-filter",
      environmentFilter,
      "--index-filter",
      indexFilter,
      "--prune-empty",
      "--state-branch",
      rewriteStateRef,
      "--",
      `refs/heads/${candidateBranch}`,
    ],
    {
      env: {
        ...process.env,
        FILTER_BRANCH_SQUELCH_WARNING: "1",
        HISTORY_PRIVATE_EMAIL: privateEmail,
        HISTORY_PUBLIC_EMAIL: PUBLIC_NO_REPLY_EMAIL,
        HISTORY_REMOVE_PATH_FILE: removePathFile,
      },
    },
  );
  const rewrittenTip = (
    await git(rewrite, ["rev-parse", `refs/heads/${candidateBranch}`])
  ).trim();
  const stateMappings = parseFilterBranchState(
    await git(rewrite, ["show", `${rewriteStateRef}:filter.map`]),
  );
  const verifiedCommitMappings = await verifyRewrittenCommitMetadata({
    source,
    rewrite,
    sourceCommit,
    rewrittenTip,
    stateMappings,
    privateEmail,
  });

  const metadataValues = (
    await git(source, [
      "show",
      "-s",
      "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI",
      sourceCommit,
    ])
  ).trim().split("\0");
  const metadata = {
    authorName: metadataValues[0],
    authorEmail: metadataValues[1],
    authorDate: metadataValues[2],
    committerName: metadataValues[3],
    committerEmail: metadataValues[4],
    committerDate: metadataValues[5],
  };
  const auditedTip = await createAuditedTip({
    repository: rewrite,
    auditedTree,
    parent: rewrittenTip,
    metadata,
    privateEmail,
  });
  await git(rewrite, ["update-ref", `refs/heads/${candidateBranch}`, auditedTip]);
  await git(rewrite, ["reset", "--hard", auditedTip]);
  const sourceTree = (await git(source, ["rev-parse", `${sourceCommit}^{tree}`])).trim();
  const auditedCandidateTree = (await git(rewrite, ["rev-parse", `${auditedTip}^{tree}`])).trim();
  if (sourceTree !== auditedCandidateTree) {
    throw new Error("audited candidate tip tree differs from the exact source commit tree");
  }

  for (const { name } of await refs(rewrite)) {
    if (name !== `refs/heads/${candidateBranch}`) {
      await git(rewrite, ["update-ref", "-d", name]);
    }
  }
  await git(rewrite, ["reflog", "expire", "--expire=now", "--all"]);
  await git(rewrite, ["gc", "--prune=now"]);

  const candidateRefList = await refs(rewrite);
  if (
    candidateRefList.length !== 1 ||
    candidateRefList[0].name !== `refs/heads/${candidateBranch}` ||
    candidateRefList[0].object !== auditedTip
  ) {
    throw new Error("candidate ref set is not the single explicitly selected publication branch");
  }
  await git(rewrite, ["merge-base", "--is-ancestor", rewrittenTip, auditedTip]);
  const rewrittenAncestryCount = Number(
    (await git(rewrite, ["rev-list", "--count", rewrittenTip])).trim(),
  );
  const candidateAncestryCount = Number(
    (await git(rewrite, ["rev-list", "--count", auditedTip])).trim(),
  );
  if (candidateAncestryCount !== rewrittenAncestryCount + 1) {
    throw new Error("candidate ancestry does not contain exactly one audited-tip commit after rewrite");
  }
  const candidateReachableObjectCount = (
    await git(rewrite, ["rev-list", "--objects", auditedTip])
  ).trim().split("\n").filter(Boolean).length;
  await git(rewrite, ["fsck", "--full"]);
  const rewrittenScratchPaths = await historyPaths(rewrite, auditedTip);
  const lostScratchPaths = sourceScratchPaths.filter((path) => !rewrittenScratchPaths.has(path));
  if (lostScratchPaths.length > 0) {
    throw new Error(`non-sensitive scratch history was lost (${lostScratchPaths.length} paths)`);
  }
  const remainingPrivate = await scanPrivatePatterns(rewrite, auditedTip, patterns);
  if (remainingPrivate.length > 0) throw new Error("private material remains in candidate history");
  const remainingPolicyMaterial = await scanHighConfidenceHistoryMaterial(rewrite, auditedTip);
  if (remainingPolicyMaterial.length > 0) {
    throw new Error("high-confidence private or production material remains in candidate history");
  }
  const remainingEmails = await commitEmails(rewrite, auditedTip);
  if (remainingEmails.includes(privateEmail)) throw new Error("private commit metadata remains reachable");
  if (!remainingEmails.includes(PUBLIC_NO_REPLY_EMAIL)) throw new Error("no mapped no-reply metadata was found");
  for (const object of oldBlobObjects) {
    if (await gitObjectExists(rewrite, object)) throw new Error("an old removed blob remains after ref cleanup and GC");
  }

  const freshClone = join(outputRoot, "fresh-candidate-clone");
  await run("git", [
    "clone",
    "--no-local",
    "--no-hardlinks",
    "--branch",
    candidateBranch,
    rewrite,
    freshClone,
  ]);
  const freshEnvironment = await freshCommandEnvironment(outputRoot);
  await run(prepareCommand[0], prepareCommand.slice(1), {
    cwd: freshClone,
    env: freshEnvironment.environment,
  });
  await run(gateCommand[0], gateCommand.slice(1), {
    cwd: freshClone,
    env: freshEnvironment.environment,
  });
  const freshTip = (await git(freshClone, ["rev-parse", "HEAD"])).trim();
  if (freshTip !== auditedTip) throw new Error("fresh clone did not resolve the audited candidate tip");
  if ((await scanPrivatePatterns(freshClone, "HEAD", patterns)).length > 0) {
    throw new Error("fresh clone history scan found private material");
  }
  if ((await scanHighConfidenceHistoryMaterial(freshClone, "HEAD")).length > 0) {
    throw new Error("fresh clone history scan found high-confidence private material");
  }
  const freshReachableObjectCount = (
    await git(freshClone, ["rev-list", "--objects", "HEAD"])
  ).trim().split("\n").filter(Boolean).length;
  if (freshReachableObjectCount !== candidateReachableObjectCount) {
    throw new Error("fresh clone reachable-object count differs from the candidate repository");
  }
  await git(freshClone, ["fsck", "--full"]);
  const freshRemote = (await git(freshClone, ["remote", "get-url", "origin"])).trim();
  if (!isWithin(await realpath(freshRemote), outputRoot)) {
    throw new Error("fresh clone origin does not point inside the disposable output root");
  }
  const selectedCommitMapping = verifiedCommitMappings.find(
    ({ old }) => old === sourceCommit,
  );
  if (!selectedCommitMapping) {
    throw new Error("selected source tip is absent from verified filter-branch state");
  }
  const candidateRefNames = new Set(candidateRefList.map(({ name }) => name));
  const localSourceRefDispositions = sourceRefs.map(({ name, object }) => {
    if (name === options.sourceRef && object === sourceCommit) {
      return {
        source_ref: name,
        old_object: object,
        status: "rewritten",
        new_ref: options.publicationTargetRef,
        new_object: auditedTip,
        proof: {
          selected_ancestry_ref: true,
          filter_state_status: selectedCommitMapping.status,
          filter_state_object:
            selectedCommitMapping.status === "survived"
              ? selectedCommitMapping.new
              : selectedCommitMapping.mapped_to,
          rewritten_tip_ancestor_of_audited_tip: true,
          exact_source_tree_restored: true,
        },
      };
    }
    if (name === options.publicationTargetRef && object === localPublicationTarget.object) {
      return {
        source_ref: name,
        old_object: object,
        status: "overwritten_by_candidate",
        new_ref: options.publicationTargetRef,
        new_object: auditedTip,
        proof: {
          candidate_source_ref: options.sourceRef,
          candidate_source_object: sourceCommit,
          local_target_snapshot_object: localPublicationTarget.object,
          live_remote_lease_verified: false,
          candidate_absence_verified: !candidateRefNames.has(name),
          candidate_ancestry_verified: true,
        },
      };
    }
    return {
      source_ref: name,
      old_object: object,
      status: "delete_before_visibility",
      new_ref: null,
      new_object: null,
      proof: {
        candidate_absence_verified: !candidateRefNames.has(name),
      },
    };
  });
  const dispositionStatuses = new Set([
    "rewritten",
    "overwritten_by_candidate",
    "delete_before_visibility",
  ]);
  if (
    localSourceRefDispositions.length !== sourceRefs.length
    || new Set(localSourceRefDispositions.map(({ source_ref: name }) => name)).size !== sourceRefs.length
    || localSourceRefDispositions.some(({ status }) => !dispositionStatuses.has(status))
    || localSourceRefDispositions.filter(({ status }) => status === "rewritten").length !== 1
    || localSourceRefDispositions.filter(({ status }) => status === "overwritten_by_candidate").length !== 1
    || localSourceRefDispositions.some(
      ({ status, proof }) => status === "delete_before_visibility" && !proof.candidate_absence_verified,
    )
  ) {
    throw new Error("local source ref disposition table is incomplete or lacks mechanical proof");
  }

  const report = {
    schema_version: 2,
    status: "passed",
    claim: "local_history_rehearsal_only",
    source: {
      repository_basename: basename(source),
      requested_ref: options.sourceRef,
      exact_commit: sourceCommit,
      ref_inventory_scope: "local_for_each_ref_snapshot_only",
      live_remote_inventory_verified: false,
      refs: sourceRefs,
      ancestry_commit_count: sourceAncestryCount,
      reachable_object_count: sourceObjectLines.length,
    },
    backup: {
      bundle: basename(backupBundle),
      verified: true,
      heads: backupHeads,
      complete_local_source_ref_snapshot_verified: true,
      recovery_clone: basename(recovery),
      exact_source_commit_recoverable: true,
    },
    policy: {
      public_email: PUBLIC_NO_REPLY_EMAIL,
      private_email_sha256: sha256(privateEmail.toLowerCase()),
      private_pattern_sha256: patterns.map(sha256).sort(),
      remove_paths: removePaths,
      discovered_sensitive_paths: discoveredSensitivePaths,
      discovered_policy_categories: [...new Set(
        sourcePolicyMatches.flatMap(({ categories }) => categories),
      )].sort(),
      sensitive_scratch_count: sensitiveScratchPaths.length,
      preserved_scratch_paths: sourceScratchPaths,
    },
    candidate: {
      branch: candidateBranch,
      publication_ref_policy: "single_selected_candidate_ref_only",
      proposed_final_public_remote_ref_policy: "retain_only_publication_target_ref",
      local_ref_disposition_scope: "local_source_snapshot_only_not_live_remote",
      local_source_ref_dispositions: localSourceRefDispositions,
      live_remote_inventory_verified: false,
      rewritten_tip: rewrittenTip,
      audited_tip: auditedTip,
      refs: candidateRefList,
      ancestry_verified: true,
      rewritten_ancestry_commit_count: rewrittenAncestryCount,
      ancestry_commit_count: candidateAncestryCount,
      reachable_object_count: candidateReachableObjectCount,
      fsck_full_passed: true,
      source_tree: sourceTree,
      audited_tree: auditedCandidateTree,
      exact_source_tree_restored: true,
      old_removed_blob_count: oldBlobObjects.size,
      old_removed_blobs_unreachable: true,
      private_material_absent: true,
      private_email_absent: true,
      mapped_email_present: true,
      selected_ref_mapping: {
        source_ref: options.sourceRef,
        source_object: sourceCommit,
        candidate_ref: `refs/heads/${candidateBranch}`,
        rewritten_tip: rewrittenTip,
        audited_tip: auditedTip,
      },
      rewritten_commit_metadata: verifiedCommitMappings,
    },
    fresh_clone: {
      directory: basename(freshClone),
      exact_tip: freshTip,
      prepare_command: prepareCommand,
      prepare_passed: true,
      gate_command: gateCommand,
      gate_passed: true,
      environment_policy: freshEnvironment.report,
      history_scan_passed: true,
      reachable_object_count: freshReachableObjectCount,
      fsck_full_passed: true,
    },
    operation_preview: {
      repository: {
        basename: basename(source),
        origin_remote: "origin",
        configured_origin_url_sha256: sha256(sourceRemoteUrl),
        configured_origin_identity_scope: "local_git_config_snapshot_only",
      },
      live_remote_inventory: {
        status: "not_run",
        required_before_any_remote_mutation_or_visibility_change: true,
        verifier: "scripts/verify-live-remote-inventory.mjs",
        required_method: "git ls-remote --heads --tags --refs",
        required_bindings: [
          "exact_remote_url_sha256",
          "single_equal_fetch_and_push_identity",
          "publication_target_ref",
          "expected_live_target_object",
          "candidate_object",
          "every_live_head_and_tag_disposition",
        ],
      },
      force_with_lease: {
        status: "blocked_pending_live_remote_inventory_and_separate_authorization",
        source_ref: options.sourceRef,
        source_object: sourceCommit,
        target_ref: options.publicationTargetRef,
        expected_old_object: null,
        local_target_snapshot_object: localPublicationTarget.object,
        live_remote_lease_verified: false,
        candidate_ref: `refs/heads/${candidateBranch}`,
        candidate_object: auditedTip,
        argv: null,
        required_precondition: "fresh_live_remote_inventory_with_exact_target_lease",
        required_confirmation: "confirm_exact_force_with_lease_operation_separately",
      },
      delete_refs: {
        status: "blocked_pending_live_remote_inventory_and_separate_authorization",
        refs: null,
        required_precondition: "every_live_non_target_head_and_tag_has_exact_disposition",
        required_confirmation: "confirm_exact_remote_ref_deletions_separately",
      },
      visibility: {
        status: "blocked_pending_live_remote_inventory_confirmed_ref_operations_and_separate_authorization",
        authorization_status: "not_authorized",
        target_visibility: "public",
        repository_origin_url_sha256: sha256(sourceRemoteUrl),
        pending_live_ref_disposition_count: null,
        local_snapshot_ref_count: localSourceRefDispositions.length,
        required_precondition: "live_inventory_verified_then_target_rewritten_and_every_other_live_remote_ref_deleted",
        required_confirmation: "confirm_visibility_change_separately_after_live_ref_operations",
      },
      tag_release: {
        status: "not_authorized",
        expected_tag: "v0.1.0",
        target_object: auditedTip,
        required_confirmation: "confirm_exact_tag_and_github_release_operations",
      },
      deploy: {
        status: "blocked_missing_operator_input",
        candidate_object: auditedTip,
        deployment_identity: null,
        required_confirmation: "supply_deployment_identity_then_confirm_exact_deploy_operation",
      },
    },
    external_actions: {
      force_push: false,
      remote_ref_deletion: false,
      visibility_change: false,
      tag_or_release: false,
      deployment: false,
      stopped_before_external_actions: true,
    },
  };
  const reportPath = join(outputRoot, "history-rehearsal-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: "passed", report: reportPath }));
}

main().catch((error) => {
  console.error(`history rehearsal failed closed: ${error.message}`);
  process.exitCode = 1;
});
