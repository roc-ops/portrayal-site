# How a merge happens

Every merge to `main` deploys to portrayal.dev, so a merge is checked the same
way each time. This page says how, who does it, and why.

## The short version

1. A pull request is **ready** when its own checks are green, a fresh reviewer
   has posted `REVIEW: approve` after the last commit, and, for a
   [one-way door](../CONTRIBUTING.md#merge-danger), the owner has posted
   `OWNER DECISION: approve`.
2. Before the owner merges a set of ready pull requests, the coordinator tests
   them **together, once**, on a temporary branch: `train/<date>-<n>`, made
   from `origin/main` with each pull request's head merged in, in the order
   they will be merged, with the full check run on it.
3. The owner merges them in that order, with **nothing else merged in
   between**. The train prints the commands.

The coordinator never merges. The owner is the only one who does.

## Why a train

A green run on a branch says the branch works. It does not say the branch works
with what has landed since, and with several pull requests ready at once each
one is green and none has ever been run beside the others.

The obvious fix, requiring every branch to be up to date with `main` before it
merges, makes the checks the bottleneck: each merge puts every other ready pull
request behind, and each has to be updated and run again. A pull request can
pass four times and still be behind. This repository does not require it. The
train is what stands in for it: the set is run once, in the order it will land, so the thing that
was tested is the thing that is merged.

## Running it

From a checkout with `origin` set, with `gh` signed in:

```
python3 tools/merge-train.py 208 204 210
```

The numbers are the pull requests in merge order. It does this, and stops at the
first step that fails:

1. **Checks each pull request is ready**, and lists every problem with every
   one of them before it stops: open, not a draft, aimed at `main`; the latest
   `REVIEW:` comment is `approve` and newer than the head commit; the
   `**Door:**` line of the template is two-way, or an `OWNER DECISION: approve`
   comment is the latest owner-decision comment (a missing `Door` line counts as
   one-way); the `checks` workflow has succeeded on the head, and every check run
   on it has finished and passed.
2. **Builds the train** from `origin/main`, merging each head in order. This is
   done in git's object database (`git merge-tree`), so your checkout, index and
   branch are not touched. A conflict stops it and names the pull request, the
   files, and what it conflicts with (`main` plus the pull requests ahead of it).
3. **Pushes `train/<date>-<n>`** and starts the full run on it: `checks.yml`'s
   `workflow_dispatch`, which runs the whole thing, the contract check, the
   modules and every browser shard, on any branch it is pointed at. (A pushed
   branch starts neither of the other two triggers, a pull request or a push to
   `main`, which is why the run is asked for.)
4. **Waits** for it (about a quarter of an hour; `TRAIN_TIMEOUT_SECS` is an
   hour).
5. **Prints the merge lines**, in order, each with `--match-head-commit` so a
   pull request that gained a commit since the train was tested is not merged:

   ```
   gh pr merge 208 --repo roc-ops/portrayal-site --merge --match-head-commit <sha>
   ```

   If `main` or any head moved while the run was going, it says so and prints no
   lines: the answer is about a tree that no longer exists, so run it again.

`--dry-run` does the reading and the merge in memory and stops: nothing is
created, pushed or started. It is how the script's own tests run, and a quick
way to ask whether a set conflicts.

It never merges a pull request and never pushes to `main`; the only branch it
pushes is `train/*`, and it refuses any other name. Train branches are left in
place for the run's logs; the owner can delete them.

Exit status: 0 the train passed; 1 something is not ready; 2 a conflict; 3 the
run failed or timed out; 4 the result is stale.

## When the train fails

Nothing is merged. Fix the pull request the failure points at, push, and run
the train again; a pull request that changes after approval needs a new
review. A set that fails together but passes apart is a finding: the pull
requests disagree, and the second one to land should change.

## The merge queue, later

GitHub's merge queue does this job on the server: it builds the same
temporary branches, runs the checks, and merges in order. It is not available
here because the repository belongs to a personal account. Moving the repository
to an organisation would make it available. At that point the train is retired:
`checks.yml` gains a `merge_group` trigger, the queue is turned on for `main`,
and this page is rewritten. The train's order and its one run on the combined
tree are the queue's model, so nothing about how a pull request is reviewed
changes.
