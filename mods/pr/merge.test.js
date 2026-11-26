import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { MERGE_ARMED_MS, MERGE_GAP_MS, armedHolds, armedLine, confirmMerge, mergeArgv, mergeMethod, mergePress } from "./merge.js";

test("Merge uses the person's default method when the repo allows it, else the first it allows", () => {
  assert.equal(mergeMethod({ viewerDefaultMergeMethod: "SQUASH", mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false }), "squash");
  assert.equal(mergeMethod({ viewerDefaultMergeMethod: "MERGE", mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: true }), "rebase");
  assert.equal(mergeMethod({ viewerDefaultMergeMethod: "MERGE", mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false }), null);
});

test("the second press runs gh pr merge for that PR, that method and only that head commit", () => {
  const head = "93630513e7c1be0442caed5ff23aa6a33ba7b172";
  assert.deepEqual(mergeArgv({ host: "github.com", owner: "ramtinJ95", name: "first-game", number: 146 }, "squash", head),
    ["pr", "merge", "146", "-R", "github.com/ramtinJ95/first-game", "--squash", "--match-head-commit", head]);
  assert.equal(armedLine("squash", head, "main"), "Press again to squash-merge 9363051 into main");
});

const HEAD = "a".repeat(40);
const facts = (extra = {}) => ({ offered: true, fresh: true, head: HEAD, now: 100_000, held: false, ...extra });
const armedAt = (at, head = HEAD) => ({ step: "armed", head, at });

test("the first press of Merge arms it, and a second one after the gap confirms", () => {
  assert.equal(mergePress({ step: "idle" }, facts()), "arm");
  assert.equal(mergePress({ step: "done", ok: false, text: "x" }, facts()), "arm");
  assert.equal(mergePress(armedAt(100_000 - MERGE_GAP_MS), facts()), "confirm");
});

test("a held key or a double-click does not merge: a second press inside the gap does nothing", () => {
  assert.equal(mergePress({ step: "idle" }, facts({ held: true })), "nothing");
  assert.equal(mergePress(armedAt(100_000 - 5_000), facts({ held: true })), "nothing");
  assert.equal(mergePress(armedAt(100_000 - MERGE_GAP_MS + 1), facts()), "nothing");
  assert.equal(mergePress(armedAt(100_000), facts()), "nothing");
});

test("Merge does nothing on a view that is not GitHub's latest answer, or while a merge runs", () => {
  assert.equal(mergePress({ step: "idle" }, facts({ fresh: false })), "nothing");
  assert.equal(mergePress(armedAt(95_000), facts({ fresh: false })), "nothing");
  assert.equal(mergePress(armedAt(95_000), facts({ offered: false })), "nothing");
  assert.equal(mergePress({ step: "running", head: HEAD }, facts()), "nothing");
});

test("a first press lapses after a while, when the head commit moves, and when the view goes stale; the next press arms again", () => {
  assert.equal(armedHolds(armedAt(95_000), facts()), true);
  assert.equal(armedHolds(armedAt(100_000 - MERGE_ARMED_MS), facts()), false);
  assert.equal(armedHolds(armedAt(95_000, "b".repeat(40)), facts()), false);
  assert.equal(armedHolds(armedAt(95_000), facts({ fresh: false })), false);
  assert.equal(armedHolds(armedAt(95_000), facts({ offered: false })), false);
  assert.equal(mergePress(armedAt(100_000 - MERGE_ARMED_MS), facts()), "arm");
  assert.equal(mergePress(armedAt(95_000, "b".repeat(40)), facts()), "arm");
});

/** GitHub's recorded answer for an open pull request it reports clean, as `gh api graphql` printed it. */
function cleanAnswer(edit = () => {}) {
  const dir = new URL("./fixtures/", import.meta.url);
  const file = readdirSync(dir).find((f) => f.startsWith("survive-n-conquest-62-"));
  const frame = JSON.parse(gunzipSync(readFileSync(new URL(file, dir))).toString("utf8").split("\n")[1]);
  edit(frame.pr);
  return JSON.stringify({ data: { rateLimit: frame.rateLimit, repository: { pullRequest: frame.pr } }, errors: null });
}
const TARGET = { host: "github.com", owner: "ramtinJ95", name: "survive-n-conquest", number: 62 };
const headOf = (answer) => JSON.parse(answer).data.repository.pullRequest.headRefOid;
/** A stand-in for gh: answers the look with `look`, and `pr merge` with `merge`, keeping every argv it was given. */
function fakeGh(look, merge = { stdout: "", failure: null }) {
  const calls = [];
  const gh = async (argv) => {
    calls.push(argv);
    return argv[0] === "pr" && argv[1] === "merge" ? merge : look;
  };
  return { gh, calls };
}

test("the second press looks again, then merges that PR by that method at the head commit it saw", async () => {
  const answer = cleanAnswer();
  const head = headOf(answer);
  const { gh, calls } = fakeGh({ stdout: answer, failure: null });
  const done = await confirmMerge(gh, TARGET, "squash", head);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 2), ["api", "graphql"]);
  assert.deepEqual(calls[1], ["pr", "merge", "62", "-R", "github.com/ramtinJ95/survive-n-conquest", "--squash", "--match-head-commit", head]);
  assert.deepEqual(done, { step: "done", ok: true, text: `Merged ${head.slice(0, 7)} into main (squash).` });
});

const neverMerges = async (look, head, text) => {
  const { gh, calls } = fakeGh(look);
  const done = await confirmMerge(gh, TARGET, "squash", head);
  assert.equal(calls.some((argv) => argv[0] === "pr"), false, "gh pr merge was not run");
  assert.equal(done.ok, false);
  assert.match(done.text, text);
};

test("the second press merges nothing when the head commit moved, checks no longer pass, the PR is merged, or GitHub does not answer", async () => {
  const answer = cleanAnswer();
  const head = headOf(answer);
  await neverMerges({ stdout: answer, failure: null }, "b".repeat(40), /changed after the first press/);
  await neverMerges({ stdout: cleanAnswer((pr) => { pr.mergeStateStatus = "UNSTABLE"; }), failure: null }, head, /changed after the first press/);
  await neverMerges({ stdout: cleanAnswer((pr) => { pr.mergeStateStatus = "BLOCKED"; }), failure: null }, head, /changed after the first press/);
  await neverMerges({ stdout: cleanAnswer((pr) => { pr.state = "MERGED"; }), failure: null }, head, /changed after the first press/);
  await neverMerges({ stdout: "", failure: { kind: "offline", text: "error connecting to api.github.com\nmore" } }, head, /^Not merged: GitHub could not be asked first\. error connecting to api\.github\.com$/);
  await neverMerges({ stdout: "not json", failure: null }, head, /could not be asked first/);
});

test("a merge gh refuses is reported with gh's first line", async () => {
  const answer = cleanAnswer();
  const { gh } = fakeGh({ stdout: answer, failure: null }, { stdout: "", failure: { kind: "unknown", text: "GraphQL: Head branch was modified. Review and try the merge again.\nmore" } });
  assert.deepEqual(await confirmMerge(gh, TARGET, "squash", headOf(answer)),
    { step: "done", ok: false, text: "Merge failed: GraphQL: Head branch was modified. Review and try the merge again." });
});
