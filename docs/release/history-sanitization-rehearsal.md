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

1. resolves the source ref to one exact commit and records the checkout's local
   `git for-each-ref` snapshot, ancestry, and reachable-object counts; this
   snapshot may include stale remote-tracking refs and may omit live remote refs;
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

`--source-ref` selects the exact ancestry to sanitize.
`--publication-target-ref` independently identifies the proposed later remote
branch, but the matching local head is only a local snapshot object. It is not
a current lease and cannot authorize or populate a force-with-lease command.
The rehearsal must never infer either the publication target or a live lease
from the feature/candidate source ref.

The publication candidate intentionally contains one temporary local ref. The
report has one exhaustive `local_source_ref_dispositions` row for every ref in
that local snapshot. A row is exactly `rewritten` (the selected local ancestry
mapped to the proposed publication target and audited object),
`overwritten_by_candidate` (the local publication-target snapshot), or
`delete_before_visibility` (with proof that the local candidate does not contain
that ref). The field is explicitly scoped as
`local_source_snapshot_only_not_live_remote`; it is not an inventory or a
disposition table for the live remote. The proposed final policy retains only
the publication target ref, but that policy must be checked independently
against every live head and tag immediately before cutover.

The private report records only a hash of the checkout's configured origin URL
and labels it as local Git configuration. It deliberately leaves the live
target object and force-with-lease argv unset. Force update, ref deletion, and
visibility all remain blocked pending a fresh live inventory and their own
separate exact authorizations. Tag/release remains `not_authorized` and
deployment remains `blocked_missing_operator_input`; the rehearsal never
invents an external identity or claims external state.

## Cutover-time live remote inventory

Immediately before any force update, remote-ref deletion, or visibility change,
create a repository-external JSON document with one disposition for every live
head and tag. The target branch must use `force_update_to_candidate`; every
other live head or tag must use `delete_before_visibility`. Each row includes
the exact object observed and reviewed by the operator:

```json
{
  "schema_version": 1,
  "live_ref_dispositions": [
    {
      "ref": "refs/heads/main",
      "expected_object": "<exact-live-object>",
      "operation": "force_update_to_candidate"
    },
    {
      "ref": "refs/tags/old-private-tag",
      "expected_object": "<exact-live-object>",
      "operation": "delete_before_visibility"
    }
  ]
}
```

Before verification, prepare one private cutover repository. That single
repository must contain the audited candidate object as a local commit and have
the exact intended remote configured with one identical fetch/push URL. Importing
the audited object and configuring the remote are explicit operator preparation
steps outside the verifier; review them separately. Do not split remote identity
and candidate ownership across two repositories.

Then run the independent read-only verifier against that cutover repository.
Supply the SHA-256 of its exact configured remote URL rather than placing a
credential-bearing URL in a transcript:

```sh
node scripts/verify-live-remote-inventory.mjs \
  --repository /absolute/private/cutover-repository \
  --remote origin \
  --expected-remote-url-sha256 "$EXPECTED_REMOTE_URL_SHA256" \
  --publication-target-ref refs/heads/main \
  --expected-target-object "$EXPECTED_LIVE_MAIN_OBJECT" \
  --candidate-object "$AUDITED_CANDIDATE_OBJECT" \
  --dispositions-file /absolute/private/live-ref-dispositions.json
```

The verifier does not fetch, import objects, or change Git configuration. It
first proves that the exact candidate commit resolves in the same cutover
repository that owns the remote identity. It then uses
`git ls-remote --heads --tags --refs`, checks the configured
fetch identity before and after the query, requires the effective push URL to
be the same single identity and remain stable, binds the target to its exact
live object, verifies the candidate commit, and fails if any live ref is missing,
stale, unexpected, duplicated, or assigned the wrong operation. A passing
result proves only `live_remote_inventory_verified_read_only`: it does not push,
delete refs, change visibility, tag, release, or deploy. If any time passes or
the remote could have changed, run it again and discard the older inventory.
The result contains an exact, unexecuted force-with-lease argv for the target
and one exact, unexecuted lease-bound deletion argv for every other live ref.
Every argv begins with `git -C <absolute-cutover-repository> push`, so later
execution cannot silently resolve `origin` or the candidate object from another
working directory. Each preview remains `not_authorized` and `executed: false`.
Every subsequent mutation and the visibility change still requires its own
explicit confirmation; the verifier never invokes a previewed argv.

The approved sanitization policy currently identifies nine independently
sensitive scratch paths. The count is an explicit fail-closed input: a future
discovery of eight or ten paths aborts for review instead of silently changing
the publication policy. Harmless scratch history is retained. Common secret
shapes and the confirmed private values are scanned byte-for-byte even inside
binary blobs; generic email discovery is limited to strict text so a vendor
certificate address embedded in signed binary provenance is not mislabeled as
the maintainer's personal identity.

Keep the generated bundle, report, pattern file, and rehearsal directory in
private storage. A passing report establishes only `local_history_rehearsal`.
It is not evidence of a live remote inventory, force push, ref deletion, public
visibility, tag, GitHub release, or deployment.
