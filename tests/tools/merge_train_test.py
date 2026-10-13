#!/usr/bin/env python3
"""tools/merge-train.py, run for real against throwaway git repositories and a
fake `gh`.

The git side is not faked: each test builds a bare "origin" and a clone in a
temp directory, with the pull requests' heads under refs/pull/<n>/head as
GitHub keeps them, so a conflict is a real conflict and a push is a real push.
The `gh` side is a small script on PATH that answers from a JSON file the test
writes and logs every call, so a test can say what the script did and did not
ask GitHub to do - above all that it never merged anything.

    python3 tests/tools/merge_train_test.py
"""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / "tools" / "merge-train.py"

# What the real `gh` would be, to the extent the script asks it anything. It
# ignores --json field lists and returns every field the fixture holds.
FAKE_GH = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, subprocess, sys
    state_path = os.environ["FAKE_GH_STATE"]
    state = json.load(open(state_path))
    a = sys.argv[1:]
    with open(os.environ["FAKE_GH_CALLS"], "a") as f:
        f.write(json.dumps(a) + "\\n")
    def out(v):
        print(json.dumps(v))
        sys.exit(0)
    def save():
        json.dump(state, open(state_path, "w"))
    def origin_sha(branch):
        r = subprocess.run(["git", "--git-dir", os.environ["FAKE_GH_ORIGIN"],
                            "rev-parse", "refs/heads/" + branch],
                           capture_output=True, text=True)
        return r.stdout.strip()
    if a[:2] == ["repo", "view"]:
        out({"nameWithOwner": "acme/widgets"})
    if a[:2] == ["pr", "view"]:
        out(state["prs"][a[2]])
    if a[0] == "api":
        path = a[1]
        if "/check-runs" in path:
            out({"check_runs": state["checks"].get(path.split("/commits/")[1].split("/")[0], [])})
        if "/actions/runs" in path:
            out({"workflow_runs": state["runs"].get(path.split("head_sha=")[1], [])})
    if a[:2] == ["workflow", "run"]:
        state["dispatched"] = {"workflow": a[2], "ref": a[a.index("--ref") + 1]}
        save()
        sys.exit(0)
    if a[:2] == ["run", "list"]:
        branch = a[a.index("--branch") + 1]
        if "dispatched" not in state:
            out([])
        out([{"databaseId": 777, "headSha": origin_sha(branch), "event": "workflow_dispatch"}])
    if a[:2] == ["run", "view"]:
        seq = state["train"]
        n = state.get("views", 0)
        state["views"] = n + 1
        step = seq[min(n, len(seq) - 1)]
        if step["status"] == "completed" and state.get("move_main_to"):
            subprocess.run(["git", "--git-dir", os.environ["FAKE_GH_ORIGIN"], "update-ref",
                            "refs/heads/main", state["move_main_to"]], check=True)
        save()
        out({"status": step["status"], "conclusion": step.get("conclusion"),
             "url": "https://example.test/runs/777", "jobs": step.get("jobs", [])})
    sys.stderr.write("fake gh: unhandled " + repr(a) + "\\n")
    sys.exit(97)
''')

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.test",
    "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.test",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
}


def git(cwd, *args, check=True):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                       env={**os.environ, **GIT_ENV})
    if check and r.returncode:
        raise AssertionError(f"git {args}: {r.stderr}")
    return r.stdout.strip()


class Train(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.origin = self.root / "origin.git"
        self.work = self.root / "work"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.bin / "gh").write_text(FAKE_GH)
        (self.bin / "gh").chmod(0o755)
        self.state_path = self.root / "state.json"
        self.calls_path = self.root / "calls.log"
        self.calls_path.write_text("")

        git(self.root, "init", "-q", "--bare", "-b", "main", str(self.origin))
        git(self.root, "clone", "-q", str(self.origin), str(self.work))
        git(self.work, "checkout", "-q", "-b", "main")
        (self.work / "a.txt").write_text("a1\na2\na3\n")
        (self.work / "b.txt").write_text("b1\nb2\nb3\n")
        git(self.work, "add", ".")
        git(self.work, "commit", "-q", "-m", "base")
        git(self.work, "push", "-q", "origin", "main")
        self.main_at_start = git(self.work, "rev-parse", "HEAD")

        self.state = {"prs": {}, "checks": {}, "runs": {},
                      "train": [{"status": "in_progress"},
                                {"status": "completed", "conclusion": "success"}]}
        # 1 edits a.txt, 2 edits b.txt, 3 edits a.txt the way 1 does not.
        self.pr(1, "a.txt", "a1\nONE\na3\n")
        self.pr(2, "b.txt", "b1\nTWO\nb3\n")
        self.pr(3, "a.txt", "a1\nTHREE\na3\n")
        git(self.work, "checkout", "-q", "main")

    # -- fixtures -----------------------------------------------------------
    def pr(self, n, path, text, *, door="**Door:** two-way", comments=None,
           state="OPEN", draft=False, base="main", green=True):
        git(self.work, "checkout", "-q", "-b", f"pr{n}", self.main_at_start)
        (self.work / path).write_text(text)
        git(self.work, "add", ".")
        git(self.work, "commit", "-q", "-m", f"change {n}")
        sha = git(self.work, "rev-parse", "HEAD")
        git(self.work, "push", "-q", "origin", f"pr{n}:refs/pull/{n}/head")
        committed = git(self.work, "log", "-1", "--format=%cI")
        if comments is None:
            comments = [self.review("approve")]
        self.state["prs"][str(n)] = {
            "state": state, "isDraft": draft, "baseRefName": base,
            "headRefOid": sha, "headRefName": f"pr{n}",
            "body": f"## Merge danger\n\n{door}\n", "comments": comments,
            "commits": [{"oid": "0" * 40, "committedDate": "2000-01-01T00:00:00Z"},
                        {"oid": sha, "committedDate": "2026-10-13T08:00:00Z"}],
        }
        ok = [{"name": "contract and modules", "status": "completed", "conclusion": "success"},
              {"name": "browser (1 of 5)", "status": "completed", "conclusion": "success"}]
        self.state["checks"][sha] = ok if green else [
            ok[0], {"name": "browser (1 of 5)", "status": "completed", "conclusion": "failure"}]
        self.state["runs"][sha] = [{"name": "checks", "status": "completed",
                                    "conclusion": "success" if green else "failure"}]
        return sha

    @staticmethod
    def review(verdict, when="2026-10-13T09:00:00Z", body=None):
        return {"body": body or f"REVIEW: {verdict} [T-1] looks fine", "createdAt": when,
                "author": {"login": "someone"}, "authorAssociation": "OWNER"}

    def run_train(self, *args, env=None):
        self.state_path.write_text(json.dumps(self.state))
        e = {**os.environ, **GIT_ENV,
             "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
             "FAKE_GH_STATE": str(self.state_path), "FAKE_GH_CALLS": str(self.calls_path),
             "FAKE_GH_ORIGIN": str(self.origin),
             "TRAIN_POLL_SECS": "0", "TRAIN_DATE": "2026-10-13",
             "TRAIN_WORKFLOW": "checks.yml", **(env or {})}
        r = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.work,
                           capture_output=True, text=True, env=e)
        return r

    def calls(self):
        return [json.loads(x) for x in self.calls_path.read_text().splitlines()]

    def origin_branches(self):
        return git(self.origin, "for-each-ref", "--format=%(refname:short)",
                   "refs/heads/").split()

    def origin_main(self):
        return git(self.origin, "rev-parse", "refs/heads/main")

    def assert_no_merge_or_main_push(self):
        for c in self.calls():
            self.assertNotEqual(c[:2], ["pr", "merge"], c)
        self.assertEqual(self.origin_main(), self.main_at_start)

    # -- the good path --------------------------------------------------------
    def test_dry_run_checks_and_merges_locally_but_pushes_and_dispatches_nothing(self):
        r = self.run_train("--dry-run", "1", "2")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("DRY RUN", r.stdout)
        self.assertEqual(self.origin_branches(), ["main"])
        self.assertEqual(git(self.work, "branch", "--list", "train/*"), "")
        self.assertFalse([c for c in self.calls() if c[:2] == ["workflow", "run"]])
        self.assert_no_merge_or_main_push()

    def test_dry_run_still_finds_a_conflict(self):
        r = self.run_train("--dry-run", "1", "3")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)

    def test_a_train_is_pushed_dispatched_waited_for_and_the_merge_lines_printed_in_order(self):
        s1, s2 = (self.state["prs"][n]["headRefOid"] for n in ("1", "2"))
        r = self.run_train("2", "1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("train/2026-10-13-1", self.origin_branches())
        # both changes are on the train, on top of main
        tree_a = git(self.origin, "show", "train/2026-10-13-1:a.txt")
        tree_b = git(self.origin, "show", "train/2026-10-13-1:b.txt")
        self.assertIn("ONE", tree_a)
        self.assertIn("TWO", tree_b)
        git(self.origin, "merge-base", "--is-ancestor", self.main_at_start, "train/2026-10-13-1")
        git(self.origin, "merge-base", "--is-ancestor", s1, "train/2026-10-13-1")
        git(self.origin, "merge-base", "--is-ancestor", s2, "train/2026-10-13-1")
        # the full run was asked for, on the train's branch
        disp = [c for c in self.calls() if c[:2] == ["workflow", "run"]]
        self.assertEqual(len(disp), 1)
        self.assertEqual(disp[0][2], "checks.yml")
        self.assertEqual(disp[0][disp[0].index("--ref") + 1], "train/2026-10-13-1")
        # the lines come out in the order asked, with the head each was tested at
        lines = [l.strip() for l in r.stdout.splitlines() if "gh pr merge" in l]
        self.assertEqual(len(lines), 2, r.stdout)
        self.assertIn("gh pr merge 2 ", lines[0])
        self.assertIn(s2, lines[0])
        self.assertIn("gh pr merge 1 ", lines[1])
        self.assertIn(s1, lines[1])
        self.assertIn("--match-head-commit", lines[0])
        self.assert_no_merge_or_main_push()

    def test_a_second_train_on_the_same_day_is_numbered_two(self):
        self.assertEqual(self.run_train("1").returncode, 0)
        self.state = json.loads(self.state_path.read_text())
        self.state.pop("dispatched")
        self.state["views"] = 0
        r = self.run_train("2")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("train/2026-10-13-2", self.origin_branches())
        self.assertIn("train/2026-10-13-1", self.origin_branches())

    # -- readiness ----------------------------------------------------------
    def refused(self, *prs, why, code=1):
        r = self.run_train(*prs)
        self.assertEqual(r.returncode, code, r.stdout + r.stderr)
        self.assertIn(why, r.stdout + r.stderr)
        self.assertEqual(self.origin_branches(), ["main"])
        self.assertFalse([c for c in self.calls() if c[:2] == ["workflow", "run"]])
        self.assert_no_merge_or_main_push()
        return r

    def test_no_review_comment_refuses_and_names_the_pr(self):
        self.state["prs"]["2"]["comments"] = []
        r = self.refused("1", "2", why="#2")
        self.assertIn("REVIEW: approve", r.stdout + r.stderr)

    def test_a_later_changes_verdict_beats_an_earlier_approve(self):
        self.state["prs"]["1"]["comments"] = [
            self.review("approve", "2026-10-13T09:00:00Z"),
            self.review("changes", "2026-10-13T10:00:00Z")]
        self.refused("1", why="#1")

    def test_an_approve_after_a_changes_counts(self):
        self.state["prs"]["1"]["comments"] = [
            self.review("changes", "2026-10-13T09:00:00Z"),
            self.review("approve", "2026-10-13T10:00:00Z")]
        self.assertEqual(self.run_train("--dry-run", "1").returncode, 0)

    def test_a_stranger_cannot_approve_or_decide(self):
        self.state["prs"]["1"]["body"] = "**Door:** one-way\n"
        self.state["prs"]["1"]["comments"] = [
            {**self.review("approve"), "authorAssociation": "NONE"},
            {"body": "OWNER DECISION: approve", "createdAt": "2026-10-13T09:30:00Z",
             "author": {"login": "x"}, "authorAssociation": "CONTRIBUTOR"}]
        r = self.refused("1", why="REVIEW: approve")
        self.assertIn("OWNER DECISION", r.stdout + r.stderr)

    def test_the_head_commit_is_found_by_id_not_by_position(self):
        # the head is older than another commit in the list (a force-push back)
        p = self.state["prs"]["1"]
        p["commits"] = [{"oid": p["headRefOid"], "committedDate": "2026-10-13T08:00:00Z"},
                        {"oid": "1" * 40, "committedDate": "2026-10-13T12:00:00Z"}]
        self.assertEqual(self.run_train("--dry-run", "1").returncode, 0)

    def test_an_approve_older_than_the_head_commit_does_not_count(self):
        self.state["prs"]["1"]["comments"] = [self.review("approve", "2026-10-13T07:00:00Z")]
        self.refused("1", why="before the head commit")

    def test_the_word_in_the_middle_of_a_comment_is_not_a_verdict(self):
        self.state["prs"]["1"]["comments"] = [
            self.review("approve", body="I would say REVIEW: approve if it were mine")]
        self.refused("1", why="#1")

    def test_a_one_way_door_needs_an_owner_decision(self):
        self.state["prs"]["1"]["body"] = "**Door:** one-way, it changes the workflow\n"
        r = self.refused("1", why="OWNER DECISION")
        self.assertIn("#1", r.stdout + r.stderr)

    def test_a_one_way_door_with_the_owner_decision_goes(self):
        self.state["prs"]["1"]["body"] = "**Door:** one-way, it changes the workflow\n"
        self.state["prs"]["1"]["comments"].append(
            {"body": "OWNER DECISION: approve, merge it", "createdAt": "2026-10-13T09:30:00Z",
             "author": {"login": "owner"}, "authorAssociation": "OWNER"})
        self.assertEqual(self.run_train("--dry-run", "1").returncode, 0)

    def test_an_owner_decision_that_says_no_is_not_one(self):
        self.state["prs"]["1"]["body"] = "**Door:** one-way\n"
        self.state["prs"]["1"]["comments"].append(
            {"body": "OWNER DECISION: hold until Friday", "createdAt": "2026-10-13T09:30:00Z",
             "author": {"login": "owner"}, "authorAssociation": "OWNER"})
        self.refused("1", why="OWNER DECISION")

    def test_no_door_line_is_treated_as_one_way(self):
        self.state["prs"]["1"]["body"] = "no template here"
        self.refused("1", why="OWNER DECISION")

    def test_a_failed_check_refuses(self):
        sha = self.state["prs"]["2"]["headRefOid"]
        self.state["checks"][sha][1]["conclusion"] = "failure"
        r = self.refused("1", "2", why="#2")
        self.assertIn("browser (1 of 5)", r.stdout + r.stderr)

    def test_a_check_still_running_refuses(self):
        sha = self.state["prs"]["2"]["headRefOid"]
        self.state["checks"][sha][1].update(status="in_progress", conclusion=None)
        self.refused("2", why="not finished")

    def test_no_checks_at_all_refuses(self):
        sha = self.state["prs"]["2"]["headRefOid"]
        self.state["checks"][sha] = []
        self.refused("2", why="no checks")

    def test_a_required_check_that_never_reported_refuses(self):
        sha = self.state["prs"]["2"]["headRefOid"]
        self.state["checks"][sha] = self.state["checks"][sha][:1]
        r = self.refused("2", why="'browser ('")
        self.assertIn("#2", r.stdout + r.stderr)

    def test_a_required_check_that_was_skipped_is_not_a_pass(self):
        sha = self.state["prs"]["2"]["headRefOid"]
        self.state["checks"][sha][1]["conclusion"] = "skipped"
        self.refused("2", why="'browser ('")

    def test_the_workflow_not_having_succeeded_refuses_even_if_the_check_runs_are_green(self):
        sha = self.state["prs"]["2"]["headRefOid"]
        self.state["runs"][sha] = []
        self.refused("2", why="'checks' workflow")

    def test_a_draft_a_closed_pr_and_another_base_are_refused(self):
        self.state["prs"]["1"]["isDraft"] = True
        self.state["prs"]["2"]["state"] = "MERGED"
        self.state["prs"]["3"]["baseRefName"] = "release"
        r = self.refused("1", "2", "3", why="#1")
        out = r.stdout + r.stderr
        self.assertIn("draft", out)
        self.assertIn("#2", out)
        self.assertIn("MERGED", out)
        self.assertIn("#3", out)
        self.assertIn("release", out)

    def test_every_problem_is_listed_not_just_the_first(self):
        self.state["prs"]["1"]["comments"] = []
        self.state["prs"]["2"]["comments"] = []
        r = self.refused("1", "2", why="#1")
        self.assertIn("#2", r.stdout + r.stderr)

    def test_the_same_pr_twice_is_a_usage_error(self):
        r = self.run_train("1", "1")
        self.assertEqual(r.returncode, 64, r.stdout + r.stderr)

    def test_no_prs_is_a_usage_error(self):
        self.assertEqual(self.run_train().returncode, 64)

    # -- the train ----------------------------------------------------------
    def test_a_conflict_stops_names_the_pr_and_the_file_and_pushes_nothing(self):
        r = self.refused("2", "1", "3", why="#3", code=2)
        out = r.stdout + r.stderr
        self.assertIn("a.txt", out)
        self.assertIn("#1", out)  # what it conflicts with: main plus the PRs ahead of it

    def test_the_order_decides_which_pr_is_the_one_in_conflict(self):
        r = self.refused("3", "1", why="#1", code=2)
        self.assertNotIn("#3 conflicts", r.stdout + r.stderr)

    def test_a_failed_run_prints_what_failed_and_no_merge_lines(self):
        self.state["train"] = [
            {"status": "completed", "conclusion": "failure",
             "jobs": [{"name": "tests 3 of 4", "conclusion": "failure"},
                      {"name": "lint", "conclusion": "success"}]}]
        r = self.run_train("1", "2")
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("tests 3 of 4", r.stdout + r.stderr)
        self.assertNotIn("gh pr merge", r.stdout)
        self.assertIn("https://example.test/runs/777", r.stdout + r.stderr)
        self.assert_no_merge_or_main_push()

    def test_a_run_that_never_finishes_times_out_without_merge_lines(self):
        self.state["train"] = [{"status": "in_progress"}]
        r = self.run_train("1", env={"TRAIN_TIMEOUT_SECS": "0"})
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("timed out", r.stdout + r.stderr)
        self.assertNotIn("gh pr merge", r.stdout)

    def test_if_main_moved_while_it_ran_the_result_is_stale_and_no_merge_lines_print(self):
        git(self.work, "checkout", "-q", "-b", "other", "main")
        (self.work / "c.txt").write_text("c\n")
        git(self.work, "add", ".")
        git(self.work, "commit", "-q", "-m", "someone else's merge")
        self.state["move_main_to"] = git(self.work, "rev-parse", "HEAD")
        git(self.work, "push", "-q", "origin", "other")
        r = self.run_train("1")
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("main moved", r.stdout + r.stderr)
        self.assertNotIn("gh pr merge", r.stdout)

    def test_the_callers_checkout_is_left_alone(self):
        git(self.work, "checkout", "-q", "pr1")
        (self.work / "scratch.txt").write_text("uncommitted\n")
        before = git(self.work, "status", "--porcelain")
        self.assertEqual(self.run_train("2").returncode, 0)
        self.assertEqual(git(self.work, "rev-parse", "--abbrev-ref", "HEAD"), "pr1")
        self.assertEqual(git(self.work, "status", "--porcelain"), before)


if __name__ == "__main__":
    unittest.main(verbosity=1)
