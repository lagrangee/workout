# History sanitization rehearsal

This procedure proves a candidate public history locally. It does not push,
change repository visibility, create a release or tag, or deploy anything.
Those are separate operator actions and each needs its own exact preview and
confirmation.

Run the rehearsal only after the intended public-source commit is complete and
the public source gate passes. Supply an exact source ref, a private output
parent outside the repository, and a private pattern file outside the
repository. The pattern file contains one exact private value per line. It is
read only in memory; the report records SHA-256 digests rather than the values.

The private maintainer email is also selected by SHA-256 digest. The tool
discovers commit metadata at runtime, requires exactly one matching address,
maps it to `1306600+lagrangee@users.noreply.github.com`, and preserves the
author and committer names. Do not put the private address in a committed
script, fixture, command transcript, or report.

Example shape (placeholders are intentional):

```sh
node scripts/rehearse-public-history.mjs \
  --source /absolute/path/to/workout \
  --source-ref refs/heads/codex/public-repo-architecture-hardening \
  --publication-target-ref refs/heads/main \
  --output-parent /absolute/private/rehearsals \
  --private-pattern-file /absolute/private/history-patterns.txt \
  --private-email-sha256 "$PRIVATE_EMAIL_SHA256" \
  --expected-sensitive-scratch-count 9 \
  --prepare-command-json '["npm","ci","--ignore-scripts"]' \
  --gate-command-json '["npm","run","public:gate"]'
```

The tool creates a mode-`0700` disposable directory. It then:

1. resolves the source ref to one exact commit and records every `refs/**`
   namespace entry, ancestry, and reachable-object counts;
2. exports the exact safe source tip to a repository-external audited tree;
3. creates and verifies a private `git bundle`, uses `git bundle list-heads` to
   prove that every source ref and object is present, then proves recovery in a
   clone;
4. makes a `--no-local --no-hardlinks` disposable clone, removes its remote,
   and retains one explicitly named candidate branch;
5. records the filter state, verifies every surviving commit's parent topology,
   author/committer names, emails, and dates, marks prune-empty commits
   explicitly, and removes the real FIT path, historical
   operator/configuration paths, and paths discovered from the private pattern
   input while preserving other scratch history;
6. creates a new safe tip from the repository-external audited tree, without
   checking out the old source ref;
7. deletes every candidate ref namespace except the single selected candidate
   branch, expires reflogs, prunes unreachable objects, and verifies old blobs
   are unavailable, the reachable count is stable, and `git fsck --full` passes;
8. fresh-clones the candidate, runs the supplied clean-install preparation and
   then the full gate without a shell under a minimal environment and a private
   temporary HOME, repeats history and metadata scans, and writes both argv
   arrays into an exact machine-readable report.

`--source-ref` selects the exact ancestry to sanitize;
`--publication-target-ref` independently identifies the later remote branch and
its current lease object. The force-with-lease preview must never infer the
publication target from the feature/candidate source ref.

The publication candidate intentionally contains one temporary local ref. The
report has one exhaustive `source_ref_dispositions` row for every source head,
tag, remote-tracking ref, or custom ref. A row is exactly `rewritten` (the
selected ancestry mapped to the publication target and audited object),
`overwritten_by_candidate` (the current publication target plus its lease
object), or `delete_before_visibility` (with proof that the candidate does not
contain that ref). The final public remote policy retains only the publication
target ref. Every other remote ref must be deleted or explicitly rewritten
before visibility changes. This rehearsal neither performs nor authorizes those
operations.

The private report also contains later-operation previews bound to the exact
origin identity, target ref and old object, candidate ref and audited tip, and
the expected `v0.1.0` tag. Force-with-lease and tag/release remain
`not_authorized`. Visibility is both unauthorized and
`blocked_pending_excluded_ref_disposition`; the report lists one required
rewrite or deletion confirmation for every source-ref disposition. Deployment remains
`blocked_missing_operator_input` until an operator supplies the exact
deployment identity; the rehearsal never invents one.

The approved sanitization policy currently identifies nine independently
sensitive scratch paths. The count is an explicit fail-closed input: a future
discovery of eight or ten paths aborts for review instead of silently changing
the publication policy. Harmless scratch history is retained.

Keep the generated bundle, report, pattern file, and rehearsal directory in
private storage. A passing report establishes only `local_history_rehearsal`.
It is not evidence of a force push, public visibility, a tag, a GitHub release,
or a deployment.
