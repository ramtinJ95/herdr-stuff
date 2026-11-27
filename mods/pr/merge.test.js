import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmMerge, mergeOffer, mergePress } from "./merge.js";
import { SETTLED, answerOf } from "./recorded.js";

const HEAD = "a".repeat(40);
const NOW = 100_000;
const facts = (extra = {}) => ({ offered: true, replay: false, live: true, method: "squash", head: HEAD, base: "main", now: NOW, ...extra });
const armedAt = (at, head = HEAD) => ({ step: "armed", head, at });
const IDLE = { step: "idle" };
const press = (ui, extra = {}, held = false) => mergePress(mergeOffer(ui, facts(extra)), { now: NOW, held });

test("the first press of Merge arms it, and a second one 0.7 seconds later or more confirms", () => {
  assert.deepEqual(mergeOffer(IDLE, facts()), { look: "rest", label: "Merge (squash)" });
  assert.equal(press(IDLE), "arm");
  assert.deepEqual(mergeOffer(armedAt(NOW - 700), facts()),
    { look: "armed", label: "Merge (squash)", note: "Press again to squash-merge aaaaaaa into main", at: NOW - 700 });
  assert.equal(press(armedAt(NOW - 700)), "confirm");
  assert.equal(mergeOffer(armedAt(NOW - 700), facts({ method: "rebase", base: "release" })).note, "Press again to rebase-merge aaaaaaa into release");
});

test("a held key or a double-click does not merge: a second press within 0.7 seconds of the first does nothing", () => {
  assert.equal(press(IDLE, {}, true), "nothing");
  assert.equal(press(armedAt(NOW - 5_000), {}, true), "nothing");
  assert.equal(press(armedAt(NOW - 699)), "nothing");
  assert.equal(press(armedAt(NOW)), "nothing");
});

test("the button is off, and a press does nothing, on a view that is not GitHub's latest answer, in a replay, and while a merge runs", () => {
  for (const [ui, extra, offer] of [
    [IDLE, { live: false }, { look: "off", label: "Merge (squash)", note: "Off until GitHub answers again" }],
    [armedAt(NOW - 5_000), { live: false }, { look: "off", label: "Merge (squash)", note: "Off until GitHub answers again" }],
    [IDLE, { replay: true, live: false, method: null }, { look: "off", label: "Merge", note: "Off in a replay" }],
    [{ step: "running", head: HEAD }, {}, { look: "off", label: "Merging…", note: null }],
    [{ step: "running", head: HEAD }, { live: false }, { look: "off", label: "Merging…", note: null }],
  ]) {
    assert.deepEqual(mergeOffer(ui, facts(extra)), offer);
    assert.equal(press(ui, extra), "nothing");
  }
});

test("there is no button when Merge is not offered, and a note when the repository allows no method", () => {
  assert.deepEqual(mergeOffer(armedAt(NOW - 5_000), facts({ offered: false })), { look: "none" });
  assert.deepEqual(mergeOffer(IDLE, facts({ offered: false, replay: true })), { look: "none" }, "in a replay too");
  assert.deepEqual(mergeOffer(IDLE, facts({ method: null })), { look: "note", note: "This repository allows no merge method." });
  assert.equal(press(armedAt(NOW - 5_000), { offered: false }), "nothing");
  assert.equal(press(IDLE, { method: null }), "nothing");
});

test("a first press lapses after 10 seconds and when the head commit moves; the next press arms again", () => {
  assert.equal(mergeOffer(armedAt(NOW - 9_999), facts()).look, "armed");
  assert.equal(mergeOffer(armedAt(NOW - 10_000), facts()).look, "rest");
  assert.equal(mergeOffer(armedAt(NOW - 5_000, "b".repeat(40)), facts()).look, "rest");
  assert.equal(press(armedAt(NOW - 10_000)), "arm");
  assert.equal(press(armedAt(NOW - 5_000, "b".repeat(40))), "arm");
});

test("the outcome of a merge stands in the row until the next press", () => {
  assert.deepEqual(mergeOffer({ step: "done", ok: false, text: "Merge failed: x" }, facts({ offered: false })), { look: "done", ok: false, text: "Merge failed: x" });
});

/** GitHub's recorded answer for an open pull request it reports clean, as `gh api graphql` printed it. */
const cleanAnswer = (edit) => JSON.stringify(answerOf(SETTLED, 2, edit));
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
