import { test } from "node:test";
import assert from "node:assert/strict";
import { byName, parsePin, prRef, shortSha } from "./github.js";
import { summarize } from "./model.js";
import { FILES_SHOWN, aboutLine, ago, blockerWords, currentStep, detailOf, failureLines, headlineOf, liveShown, moveSelection, paneRows, reviewerWords, rowIndex, rowUrl, rowsOf, saidLine, saidTone, selectedRow, stepLink, threadsLine } from "./view.js";

let ids = 0;
const check = (bucket, extra = {}) => ({
  id: `c${++ids}`, kind: "run", name: `job ${ids}`, workflow: "CI", event: "pull_request", app: "github-actions",
  state: { pass: "SUCCESS", fail: "FAILURE", pending: "IN_PROGRESS", skipping: "SKIPPED", cancel: "CANCELLED" }[bucket],
  bucket, required: false, startedAt: "2026-11-26T18:00:00Z", completedAt: null, link: `https://github.com/o/r/actions/runs/1/job/${ids}`,
  description: null, steps: null, ...extra,
});
const pr = (extra = {}) => ({
  number: 146, title: "t", url: "https://github.com/o/r/pull/146", state: "OPEN", draft: false, head: "a".repeat(40),
  headRef: "feat/x", baseRef: "main", mergeable: "MERGEABLE", mergeState: "CLEAN", review: null,
  additions: 1, deletions: 1, files: 1, ...extra,
});
const snapshot = (checks, extra = {}) => ({ pr: pr(extra.pr), checks, hidden: extra.hidden ?? 0, resetAt: null });
/** What is open in the pane, with the files folded as they start. */
const shut = (extra = {}) => ({ folds: new Map(), aboutOpen: true, filesOpen: false, files: null, ...extra });
const file = (path, extra = {}) => ({ path, previous: null, status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1,2 @@\n a\n+b", ...extra });
const keys = (rows) => rows.map((r) => (r.kind === "group" ? `${r.group.key}${r.open ? "+" : "-"}` : r.kind === "hidden" ? `hidden ${r.count}` : r.check.bucket));

test("failed, running and cancelled show their checks; passed folds when anything failed; skipped always folds", () => {
  const rows = rowsOf(snapshot([check("fail"), check("pending"), check("cancel"), check("pass"), check("skipping")]), new Map());
  assert.deepEqual(keys(rows), ["fail+", "fail", "pending+", "pending", "cancel+", "cancel", "pass-", "skipping-"]);
});

test("passed shows its checks when it is all there is and there are 8 or fewer, and folds at 9", () => {
  assert.deepEqual(keys(rowsOf(snapshot(Array.from({ length: 8 }, () => check("pass"))), new Map())), ["pass+", ...Array(8).fill("pass")]);
  assert.deepEqual(keys(rowsOf(snapshot(Array.from({ length: 9 }, () => check("pass"))), new Map())), ["pass-"]);
});

test("passed folds while checks run, even when cancelled ones are all that is wrong otherwise", () => {
  assert.deepEqual(keys(rowsOf(snapshot([check("pending"), check("pass")]), new Map())), ["pending+", "pending", "pass-"]);
  assert.deepEqual(keys(rowsOf(snapshot([check("cancel"), check("pass")]), new Map())), ["cancel+", "cancel", "pass+", "pass"]);
});

test("a group the person opened or closed stays that way", () => {
  const rows = rowsOf(snapshot([check("fail"), check("skipping")]), new Map([["fail", false], ["skipping", true]]));
  assert.deepEqual(keys(rows), ["fail-", "skipping+", "skipping"]);
});

test("checks GitHub did not return get a row of their own at the end", () => {
  assert.deepEqual(keys(rowsOf(snapshot([check("pass")], { hidden: 12 }), new Map())), ["pass+", "pass", "hidden 12"]);
});

test("the selection starts on the first check, moves by rows and stops at either end", () => {
  const rows = rowsOf(snapshot([check("fail"), check("fail"), check("pass")]), new Map());
  assert.equal(selectedRow(rows, null), rows[1]);
  assert.equal(moveSelection(rows, null, 1), rows[2].key);
  assert.equal(moveSelection(rows, rows[2].key, 5), rows.at(-1).key);
  assert.equal(moveSelection(rows, rows[1].key, -5), rows[0].key);
  assert.equal(moveSelection([], null, 1), null);
});

test("a selected check that folds away leaves the selection on its group's row", () => {
  const passed = check("pass");
  const rows = rowsOf(snapshot([check("pending"), passed]), new Map());
  assert.equal(selectedRow(rows, passed.id).key, "group:pass");
});

test("the headline names the stage first, and blockers leave out what it already says", () => {
  const draft = summarize(snapshot([check("pending")], { pr: { draft: true, mergeState: "DRAFT" } }));
  assert.equal(headlineOf(draft), "Draft · Checks running, 0 of 1 done");
  assert.deepEqual(blockerWords(draft), []);
  const review = summarize(snapshot([check("pass")], { pr: { mergeState: "BLOCKED", review: "REVIEW_REQUIRED", mergeable: "CONFLICTING" } }));
  assert.equal(headlineOf(review), "Open · Conflicts with the base branch");
  assert.deepEqual(blockerWords(review), ["Waiting for review"]);
  assert.equal(headlineOf(summarize(snapshot([], { pr: { state: "MERGED" } }))), "Merged");
});

test("a mergeable PR whose optional checks failed says so beside Ready to merge", () => {
  const s = summarize(snapshot([check("pass", { required: true }), check("fail")], { pr: { mergeState: "UNSTABLE" } }));
  assert.equal(s.merge.kind, "ready");
  assert.equal(headlineOf(s), "Open · Ready to merge");
  assert.deepEqual(blockerWords(s), ["Some checks were not successful"]);
});

test("a running job shows the step it is on, counted among its steps", () => {
  const steps = [["Set up job", "SUCCESS", "pass"], ["Build", "IN_PROGRESS", "pending"], ["Test", "QUEUED", "pending"]]
    .map(([name, state, bucket], i) => ({ number: i + 1, name, state, bucket, startedAt: null, completedAt: null }));
  assert.equal(currentStep(check("pending", { steps })), "2/3 Build");
  assert.equal(currentStep(check("pending")), null);
  assert.equal(currentStep(check("pass", { steps })), null);
  assert.equal(stepLink(check("pass", { link: "https://github.com/o/r/actions/runs/1/job/9" }), steps[1]), "https://github.com/o/r/actions/runs/1/job/9#step:2:1");
});

test("each failure says what went wrong and, where there is one, the fix", () => {
  const now = new Date(2026, 10, 26, 19, 0).getTime();
  assert.equal(failureLines({ kind: "no-auth", text: "x" }, null, now).fix, "Run `gh auth login` in a terminal.");
  assert.equal(failureLines({ kind: "rate-limited", text: "x" }, new Date(2026, 10, 26, 19, 42).getTime(), now).fix, "It resets at 19:42.");
  assert.equal(failureLines({ kind: "rate-limited", text: "x" }, now - 1000, now).fix, "The pane tries again in 5 minutes.");
  assert.equal(failureLines({ kind: "unknown", text: "HTTP 502: Bad Gateway\nmore" }, null, now).fix, "HTTP 502: Bad Gateway");
  assert.equal(failureLines({ kind: "no-repo", text: "failed to run git: fatal: not a git repository" }, null, now).fix, null);
});

test("a pinned pane names its pull request where a following pane says this branch", () => {
  assert.equal(failureLines({ kind: "no-pr", text: "x" }, null, 0).headline, "No pull request for this branch");
  assert.equal(failureLines({ kind: "no-pr", text: "x" }, null, 0, "cli/cli#999999").headline, "No pull request cli/cli#999999");
  assert.equal(failureLines({ kind: "no-repo", text: "x" }, null, 0, "o/gone#1").headline, "gh cannot see the repository of o/gone#1");
  assert.equal(failureLines({ kind: "offline", text: "x" }, null, 0, "cli/cli#1").headline, "Cannot reach GitHub");
});

test("o opens the selected check's page, the pull request from its description, else the pull request's checks", () => {
  const linked = check("fail"), bare = check("fail", { link: null });
  const s = snapshot([linked, bare], { hidden: 3 });
  const rows = paneRows(s, shut());
  assert.deepEqual(rows.map((row) => row.kind), ["about", "files", "group", "check", "check", "hidden"]);
  assert.deepEqual(rows.map((row) => rowUrl(row, s)), [s.pr.url, `${s.pr.url}/files`, `${s.pr.url}/checks`, linked.link, `${s.pr.url}/checks`, `${s.pr.url}/checks`]);
});

test("the files are listed under their row once it is open and GitHub has listed them, and o on one opens the pull request's files", () => {
  const s = snapshot([check("pass")], { pr: { files: 2 } });
  const list = [file("src/a.ts"), file("b.md")];
  assert.deepEqual(paneRows(s, shut({ files: list })).map((row) => row.kind), ["about", "files", "group", "check"]);
  assert.deepEqual(paneRows(s, shut({ filesOpen: true })).map((row) => row.kind), ["about", "files", "group", "check"]);
  const rows = paneRows(s, shut({ filesOpen: true, files: list }));
  assert.deepEqual(rows.slice(1, 4), [{ kind: "files", key: "files", open: true, count: 2 },
    { kind: "file", key: "file:src/a.ts", file: list[0] }, { kind: "file", key: "file:b.md", file: list[1] }]);
  assert.equal(rowUrl(rows[2], s), `${s.pr.url}/files`);
});

test("a selected file is still the selection's place after the files fold: their row stands in for it", () => {
  const s = snapshot([check("pass")]);
  const list = [file("a.ts")];
  const folded = paneRows(s, shut({ files: list }));
  assert.equal(selectedRow(folded, "file:a.ts").kind, "files");
  assert.equal(moveSelection(folded, "file:a.ts", 1), folded[2].key);
});

test(`past ${FILES_SHOWN} files the list stops and one row counts the rest`, () => {
  const list = Array.from({ length: FILES_SHOWN + 2 }, (_, i) => file(`f${i}.ts`));
  const rows = paneRows(snapshot([]), shut({ filesOpen: true, files: list }));
  assert.equal(rows.filter((row) => row.kind === "file").length, FILES_SHOWN);
  assert.deepEqual(rows.at(-1), { kind: "more-files", key: "more-files", count: 2 });
  assert.equal(rowUrl(rows.at(-1), snapshot([])), "https://github.com/o/r/pull/146/files");
});

test("ages read in the largest whole unit", () => {
  const now = 10_000_000;
  assert.deepEqual([0, 40, 180, 7200, 3 * 86400].map((s) => ago(now - s * 1000, now)), ["just now", "40 s ago", "3 min ago", "2 h ago", "3 days ago"]);
});

test("what is shown is live only as GitHub's latest answer: not a saved copy, not after a failed poll", () => {
  assert.equal(liveShown({ source: "live" }, null), true);
  assert.equal(liveShown({ source: "cache" }, null), false);
  assert.equal(liveShown({ source: "live" }, { failure: { kind: "offline", text: "x" }, streak: 1 }), false);
});

test("the description is the pane's first row, and the selection still starts on the first check", () => {
  const rows = paneRows(snapshot([check("fail"), check("pass")]), shut());
  assert.deepEqual(rows.slice(0, 2), [{ kind: "about", key: "about", open: true }, { kind: "files", key: "files", open: false, count: 1 }]);
  assert.equal(selectedRow(rows, null), rows[3]);
  assert.equal(moveSelection(rows, rows[3].key, -5), "about");
  const alone = paneRows(snapshot([]), shut({ aboutOpen: false }));
  assert.deepEqual(alone, [{ kind: "about", key: "about", open: false }, { kind: "files", key: "files", open: false, count: 1 }]);
  assert.equal(selectedRow(alone, null), alone[0]);
});

const about = (extra = {}) => ({
  body: "", author: "ramtinJ95", createdAt: "2026-11-26T16:00:00Z", updatedAt: "2026-11-26T18:00:00Z", mine: true, labels: [], reviews: [], asked: [], comments: 0, commits: 1,
  talk: [], earlier: 0, threads: [], threadsHidden: 0, ...extra,
});

test("what was said under the description reads as who, as what, and when", () => {
  const now = Date.parse("2026-11-26T19:00:00Z");
  const said = (who, state) => ({ who, state, body: "", at: "2026-11-26T17:00:00Z", url: "https://github.com/o/n/pull/1#r" });
  assert.deepEqual([said("ada", null), said("bo", "APPROVED"), said(null, "CHANGES_REQUESTED"), said("cy", "COMMENTED")].map((one) => saidLine(one, now)),
    ["ada commented 2 h ago", "bo approved 2 h ago", "A deleted account asked for changes 2 h ago", "cy commented 2 h ago"]);
});

test("the threads on the diff are counted in a line, with how many are still open", () => {
  const threads = [{ resolved: true }, { resolved: false }, { resolved: true }];
  assert.equal(threadsLine(about()), null);
  assert.equal(threadsLine(about({ threads })), "3 threads on the diff, 1 not resolved. They stand among the lines under Files.");
  assert.equal(threadsLine(about({ threads: [threads[0]] })), "1 thread on the diff, all resolved. They stand among the lines under Files.");
  assert.equal(threadsLine(about({ threads: [threads[0]], threadsHidden: 4 })), "5 threads on the diff, those read here all resolved; 4 of them only on GitHub. They stand among the lines under Files.");
});

test("the description's first line says who opened it, when, and how much is on it", () => {
  const now = Date.parse("2026-11-26T19:00:00Z");
  assert.equal(aboutLine(about(), now), "ramtinJ95 opened it 3 h ago · 1 commit");
  assert.equal(aboutLine(about({ author: null, commits: 4, comments: 2 }), now), "A deleted account opened it 3 h ago · 4 commits · 2 comments");
});

test("reviewers who answered come first with where they stand, then those still asked", () => {
  const words = reviewerWords(about({ reviews: [{ who: "ada", state: "APPROVED" }, { who: "bo", state: "CHANGES_REQUESTED" }], asked: ["cy", null] }));
  assert.deepEqual(words, [
    { text: "ada approved", tone: "done" }, { text: "bo asked for changes", tone: "blocked" },
    { text: "cy is asked to review", tone: "idle" }, { text: "A reviewer GitHub does not name is asked to review", tone: "idle" },
  ]);
  assert.deepEqual(reviewerWords(about()), []);
});

test("synthetic: the detail drawn is the selected file or check, once opened in a narrow pane and always in a wide one", () => {
  const file = { kind: "file", key: "file:a.ts", file: { path: "a.ts" } };
  const check = { kind: "check", key: "c1", check: { id: "c1" } };
  const rows = [{ kind: "about", key: "about", open: true }, { kind: "files", key: "files", open: true, count: 1 }, file, check];
  assert.equal(detailOf(rows, "file:a.ts", true, false), file);
  assert.equal(detailOf(rows, "file:a.ts", false, false), null);
  assert.equal(detailOf(rows, "c1", false, true), check);
  assert.equal(detailOf(rows, "about", true, true), null);
  assert.equal(rowIndex(rows, "c1"), 3);
  assert.equal(rowIndex(rows, "gone"), 3, "a key no row has falls back to the first check");
});

test("synthetic: a failure's headline says whether it names the pinned pull request itself", () => {
  assert.equal(failureLines({ kind: "no-pr", text: "x" }, null, 0, "cli/cli#9").named, true);
  assert.equal(failureLines({ kind: "offline", text: "x" }, null, 0, "cli/cli#9").named, false);
  assert.equal(failureLines({ kind: "no-pr", text: "x" }, null, 0).named, false);
});

test("synthetic: what was said has its review's tone, and a plain comment none", () => {
  const said = (state) => ({ who: "ada", body: "", at: "2026-11-26T00:00:00Z", url: "u", state });
  assert.deepEqual([null, "APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"].map((state) => saidTone(said(state))), ["idle", "done", "blocked", "idle", "idle"]);
});

test("synthetic: a pull request, a commit and an author are written one way", () => {
  assert.equal(prRef(parsePin("cli/cli#15081")), "cli/cli#15081");
  assert.equal(prRef(parsePin("https://ghe.example.com/team/app/pull/7/files")), "team/app#7");
  assert.equal(shortSha("94e5a03ca65b12a53bc7850e4d1835a7743f60f0"), "94e5a03");
  assert.equal(byName(null), "A deleted account");
  assert.equal(byName("ada"), "ada");
});
