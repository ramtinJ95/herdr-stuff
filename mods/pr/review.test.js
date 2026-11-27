import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbout, parseFiles } from "./github.js";
import { patchRows } from "./diff.js";
import { replyArgs, resolveArgs, reviewArgs } from "./query.js";
import { fixtures } from "./recorded.js";
import { EMPTY, REVIEW_KEYS, activeAnnotation, activeNote, agentOf, annotatedRows, askWords, countByPath, dropAnnotation, formatQuestion, formatReview, formatThread,
  githubLines, isMove, markAsked, moveCursor, postBlock, postingOf, saveDraft, sendResult, sortAnnotations, stepAnnotation, stops, stretch, targetOf, threadStretch,
  threadWhere, threadsByPath, toSend, whereOf } from "./review.js";

const PATCH = ["@@ -1,4 +1,5 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", "+const c = `tick`;", " export { a, b };", " // end"].join("\n");
const rows = patchRows(PATCH);
const HEAD = "1111111aaaaaaa";
const SUBJECT = { ref: "octo/site#7", title: "Count to three", url: "https://github.com/octo/site/pull/7", head: HEAD };
const on = (start, end, path = "src/a.js", head = HEAD) => targetOf(path, head, rows, start, end);
/** A review with one annotation per `[kind, target, body]`, in the order given. */
const reviewOf = (...notes) => notes.reduce((review, [kind, target, body]) => saveDraft(review, { kind, target, editingId: null }, body).review, EMPTY);

test("a move keeps the cursor among the rows, and a half page is at least a line", () => {
  assert.equal(moveCursor("down", 0, 7, 3), 1);
  assert.equal(moveCursor("up", 0, 7, 3), 0);
  assert.equal(moveCursor("half-down", 5, 7, 3), 6);
  assert.equal(moveCursor("half-up", 5, 7, 0), 4);
  assert.equal(moveCursor("first", 5, 7, 3), 0);
  assert.equal(moveCursor("last", 0, 7, 3), 6);
  assert.deepEqual(Object.values(REVIEW_KEYS).filter(isMove).sort(), ["down", "down", "first", "half-down", "half-up", "last", "last", "up", "up"]);
});

test("a range runs between its two ends whichever was set first", () => {
  assert.deepEqual(stretch(4, null), { start: 4, end: 4 });
  assert.deepEqual(stretch(2, 5), { start: 2, end: 5 });
  assert.deepEqual(stretch(5, 2), { start: 2, end: 5 });
});

test("a stretch is named by its lines as the file is now, removed lines by where they were", () => {
  assert.equal(whereOf(rows, 3, 3), "line 2");
  assert.equal(whereOf(rows, 1, 4), "lines 1-3");
  assert.equal(whereOf(rows, 2, 2), "line 2 before the change");
  assert.equal(whereOf(rows, 0, 0), "hunk header");
  assert.equal(whereOf(rows, 0, 1), "line 1");
});

test("a target quotes its rows as diff lines", () => {
  assert.deepEqual(on(1, 3), {
    path: "src/a.js", head: HEAD, start: 1, end: 3, where: "lines 1-2",
    quote: [" const a = 1;", "-const b = 2;", "+const b = 3;"],
  });
  assert.deepEqual(on(0, 0).quote, ["@@ -1,4 +1,5 @@"]);
});

test("a saved draft is a new annotation; an empty one saves nothing", () => {
  const { review, saved } = saveDraft(EMPTY, { kind: "issue", target: on(2, 3), editingId: null }, "  Why 3?  ");
  assert.deepEqual(saved, { id: "a1", kind: "issue", target: on(2, 3), body: "Why 3?" });
  assert.deepEqual(review, { annotations: [saved], nextId: 2 });
  assert.deepEqual(saveDraft(review, { kind: "comment", target: null, editingId: null }, "   "), { review, saved: null });
});

test("an edit replaces the annotation in place, and forgets how asking the old words went", () => {
  const asked = markAsked(reviewOf(["question", on(1, 1), "Why?"], ["comment", null, "Fine"]), "a1", "sent");
  assert.equal(asked.annotations[0].ask, "sent");
  const { review, saved } = saveDraft(asked, { kind: "question", target: on(1, 1), editingId: "a1" }, "Why not?");
  assert.deepEqual(review.annotations.map((one) => one.id), ["a1", "a2"]);
  assert.deepEqual(saved, { id: "a1", kind: "question", target: on(1, 1), body: "Why not?" });
  assert.equal(review.nextId, 3);
});

test("a deleted annotation is gone and its id is not given again", () => {
  const review = dropAnnotation(reviewOf(["issue", on(1, 1), "One"], ["issue", on(2, 2), "Two"]), "a2");
  assert.deepEqual(review.annotations.map((one) => one.id), ["a1"]);
  assert.equal(saveDraft(review, { kind: "comment", target: null, editingId: null }, "Three").saved.id, "a3");
});

test("annotations sort with the whole pull request first, then by file as GitHub lists them, then by place", () => {
  const review = reviewOf(["issue", on(4, 4, "src/b.js"), "b late"], ["comment", on(3, 3, "src/a.js"), "a"], ["comment", on(1, 2, "src/b.js"), "b early"],
    ["comment", on(1, 1, "gone.js"), "gone"], ["suggestion", null, "overall"], ["issue", on(1, 1, "src/b.js"), "b first"]);
  assert.deepEqual(sortAnnotations(review.annotations, ["src/b.js", "src/a.js"]).map((one) => one.body), ["overall", "b first", "b early", "b late", "a", "gone"]);
});

test("stepping goes around the ends, and starts at the first or the last", () => {
  const ordered = reviewOf(["issue", on(1, 1), "1"], ["issue", on(2, 2), "2"], ["issue", on(3, 3), "3"]).annotations;
  assert.equal(stepAnnotation(ordered, null, 1).id, "a1");
  assert.equal(stepAnnotation(ordered, null, -1).id, "a3");
  assert.equal(stepAnnotation(ordered, "a3", 1).id, "a1");
  assert.equal(stepAnnotation(ordered, "a2", -1).id, "a1");
});

test("an annotation is drawn under the last line it covers, and its lines carry the mark of the gravest kind on them", () => {
  const review = reviewOf(["comment", on(2, 3), "both"], ["issue", on(3, 3), "the new one"], ["question", on(1, 1, "src/other.js"), "elsewhere"]);
  const { items, at } = annotatedRows(rows, review.annotations, "src/a.js", HEAD);
  assert.deepEqual(items.map((item) => (item.type === "line" ? `${item.index}${item.mark ?? ""}` : `^${item.annotation.body}`)),
    ["0", "1", "2comment", "3issue", "^both", "^the new one", "4", "5", "6"]);
  assert.deepEqual(at, [0, 1, 2, 3, 6, 7, 8]);
  assert.ok(items.every((item) => item.type === "line" || !item.moved));
});

test("an annotation of another commit, or past the end of the diff, stands above the lines and marks none", () => {
  const review = reviewOf(["issue", on(1, 1, "src/a.js", "0000000"), "old"], ["comment", { ...on(1, 1), start: 40, end: 41 }, "far"]);
  const { items, at } = annotatedRows(rows, review.annotations, "src/a.js", HEAD);
  assert.deepEqual(items.slice(0, 2).map((item) => [item.type, item.annotation.body, item.moved]), [["annotation", "old", true], ["annotation", "far", true]]);
  assert.equal(at[0], 2);
  assert.ok(items.slice(2).every((item) => item.type === "line" && item.mark === null));
});

test("the annotation a key acts on is the one stepped to, else the first on the cursor's line of this commit", () => {
  const { annotations } = reviewOf(["comment", on(1, 3), "wide"], ["issue", on(2, 2), "narrow"], ["issue", on(2, 2, "src/a.js", "0000000"), "old"]);
  assert.equal(activeAnnotation(annotations, null, "src/a.js", HEAD, 2).body, "wide");
  assert.equal(activeAnnotation(annotations, "a2", "src/a.js", HEAD, 5).body, "narrow");
  assert.equal(activeAnnotation(annotations, null, "src/a.js", HEAD, 5), null);
  assert.equal(activeAnnotation(annotations, null, "src/b.js", HEAD, 2), null);
});

test("files are counted by what is noted on them", () => {
  const { annotations } = reviewOf(["comment", on(1, 1), "1"], ["issue", on(2, 2), "2"], ["issue", on(2, 2, "src/b.js"), "3"], ["comment", null, "4"]);
  assert.deepEqual([...countByPath(annotations)], [["src/a.js", 2], ["src/b.js", 1]]);
});

test("a question says how asking it stands; other kinds say nothing", () => {
  const [question, comment] = reviewOf(["question", on(1, 1), "Why?"], ["comment", null, "Fine"]).annotations;
  assert.equal(askWords(comment, new Set()), null);
  assert.equal(askWords(question, new Set(["a1"])), "asking…");
  assert.equal(askWords(question, new Set()), "not asked");
  assert.equal(askWords({ ...question, ask: "sent" }, new Set()), "asked");
  assert.equal(askWords({ ...question, ask: { failed: "no terminal \"t9\"" } }, new Set()), "not asked: no terminal \"t9\"");
});

test("the review sent to the agent numbers every annotation but the questions, each with its diff lines", () => {
  const { annotations } = reviewOf(["issue", on(2, 4), "Three is wrong.\nUse two."], ["question", on(1, 1), "Why?"], ["comment", null, "Good overall."],
    ["suggestion", on(5, 5, "src/a.js", "0000000aaaa"), "Drop it."]);
  assert.deepEqual(toSend(annotations).map((one) => one.id), ["a1", "a3", "a4"]);
  assert.equal(formatReview(SUBJECT, annotations, ["src/a.js"]), [
    "I reviewed pull request octo/site#7, \"Count to three\" (https://github.com/octo/site/pull/7) at commit 1111111. Please address these annotations.",
    "",
    "1. **[COMMENT]** The pull request as a whole",
    "",
    "   Good overall.",
    "",
    "2. **[ISSUE]** `src/a.js` lines 2-3",
    "",
    "   ```diff",
    "   -const b = 2;",
    "   +const b = 3;",
    "   +const c = `tick`;",
    "   ```",
    "",
    "   Three is wrong.",
    "   Use two.",
    "",
    "3. **[SUGGESTION]** `src/a.js` line 4 (as of commit 0000000)",
    "",
    "   ```diff",
    "    export { a, b };",
    "   ```",
    "",
    "   Drop it.",
  ].join("\n"));
  assert.equal(formatReview(SUBJECT, annotations.filter((one) => one.kind === "question"), ["src/a.js"]), "");
});

test("a fence is longer than the longest run of backticks in what it holds", () => {
  const fenced = patchRows(["@@ -1 +1 @@", "+```js"].join("\n"));
  const { annotations } = reviewOf(["issue", targetOf("README.md", HEAD, fenced, 1, 1), "Close it."]);
  assert.match(formatReview(SUBJECT, annotations, []), /\n {3}````diff\n {3}\+```js\n {3}````\n/);
});

test("a question is sent with where it points and the lines it is about", () => {
  const [question] = reviewOf(["question", on(2, 3), "Why three?"]).annotations;
  assert.equal(formatQuestion(SUBJECT, question), [
    "I am reading pull request octo/site#7, \"Count to three\" (https://github.com/octo/site/pull/7) at commit 1111111 in a pane beside this terminal and have a question.",
    "",
    "Location: `src/a.js` line 2",
    "",
    "The lines the question is about:",
    "```diff",
    "-const b = 2;",
    "+const b = 3;",
    "```",
    "",
    "Question: Why three?",
  ].join("\n"));
});

test("a real diff's lines are quoted as GitHub gave them", () => {
  const [file] = parseFiles(JSON.parse(readFileSync(join(fixtures, "files-first-game-146.json"), "utf8")));
  const real = patchRows(file.patch);
  const target = targetOf(file.path, HEAD, real, 0, real.length - 1);
  assert.equal(target.quote.join("\n"), file.patch.replaceAll("\t", "    "));
});

const pane = (pane, extra) => ({ pane, terminal: `t${pane}`, tab: "tab", name: null, status: null, focused: false, program: { name: "zsh", agent: false }, ...extra });
const CLAUDE = { status: "idle", program: { name: "Claude Code", agent: true } };

test("what is sent goes to the tab's agent: the terminal the pane follows when it runs one, never a shell", () => {
  const shell = pane("1"), claude = pane("2", CLAUDE), named = pane("3", { ...CLAUDE, name: "reviewer", focused: true });
  assert.deepEqual(agentOf([shell, claude, named], "2", null), { terminal: "t2", name: "Claude Code" });
  assert.deepEqual(agentOf([shell, claude, named], "1", null), { terminal: "t3", name: "reviewer" });
  assert.deepEqual(agentOf([shell, claude], null, "vps"), { terminal: "vps/t2", name: "Claude Code" });
  assert.deepEqual(agentOf([shell, pane("4", { status: "working" })], null, null), { terminal: "t4", name: "zsh" });
  assert.deepEqual(agentOf([shell, { pane: "9", terminal: null, mod: "pr", tab: "tab" }], "1", null), { terminal: null, why: "No agent in this tab to send it to." });
});

test("a send that hc refuses says why in hc's words", () => {
  assert.equal(sendResult({ code: 0, stderr: "" }), "sent");
  assert.deepEqual(sendResult({ code: 3, stderr: "{\"error\":{\"hint\":\"see `hc ls --all`\",\"kind\":\"not_found\",\"message\":\"no terminal \\\"t9\\\"\"}}\n" }), { failed: "no terminal \"t9\"" });
  assert.deepEqual(sendResult({ code: 1, stderr: "warning\nhc: broken pipe\n" }), { failed: "hc: broken pipe" });
  assert.deepEqual(sendResult({ code: 2, stderr: "" }), { failed: "hc send exited with 2" });
});

/** One of GitHub's threads, as `parseAbout` gives it: on the added `const b = 3;` unless said otherwise. */
const thread = (extra = {}) => ({
  id: "T1", path: "src/a.js", line: 2, startLine: null, side: "RIGHT", startSide: null, was: 2, resolved: false, outdated: false,
  canReply: true, canResolve: true, canUnresolve: false, more: 0,
  comments: [{ who: "ada", body: "Why 3?", at: "2026-11-20T10:00:00Z", url: "https://github.com/octo/site/pull/7#discussion_r1", state: null }], ...extra,
});
const readJson = (name) => JSON.parse(readFileSync(join(fixtures, name), "utf8"));

test("a recorded pull request's threads each stand under the line GitHub names, and a thread on several lines starts at its first", () => {
  const { threads } = parseAbout(readJson("about-cli-15081.json"));
  const files = parseFiles(readJson("files-cli-15081.json"));
  assert.equal(threads.length, 6);
  for (const one of threads) {
    const real = patchRows(files.find((file) => file.path === one.path).patch);
    const on = threadStretch(real, one);
    assert.equal(real[on.end].new, one.line, one.path);
    assert.equal(real[on.start].new, one.startLine ?? one.line, one.path);
    const { items, at } = annotatedRows(real, [], one.path, HEAD, threads);
    assert.deepEqual(items[at[on.end] + 1], { type: "thread", thread: one, placed: true });
    for (let row = on.start; row <= on.end; row++) assert.equal(items[at[row]].mark, "thread");
  }
  assert.deepEqual(threads.map((one) => one.startLine === null), [false, true, true, false, false, true]);
});

test("synthetic: a thread on a removed line stands under it, and one whose line the diff does not have stands above the lines", () => {
  assert.deepEqual(threadStretch(rows, thread()), { start: 3, end: 3 });
  assert.deepEqual(threadStretch(rows, thread({ side: "LEFT" })), { start: 2, end: 2 });
  assert.deepEqual(threadStretch(rows, thread({ startLine: 1, startSide: "RIGHT", line: 3 })), { start: 1, end: 4 });
  assert.deepEqual(threadStretch(rows, thread({ startLine: 2, startSide: "LEFT", line: 3 })), { start: 2, end: 4 });
  // As GitHub answered for the outdated threads of cli/cli#15100: no line, and the line it was written on.
  const outdated = thread({ id: "T2", line: null, was: 175, outdated: true, resolved: true });
  const outside = thread({ id: "T3", line: 99 });
  const whole = thread({ id: "T4", line: null, was: null });
  assert.equal(threadStretch(rows, outdated), null);
  assert.equal(threadStretch(rows, outside), null);
  const { items, at } = annotatedRows(rows, [], "src/a.js", HEAD, [thread(), outdated, outside, whole, thread({ id: "T5", path: "src/other.js" })]);
  assert.deepEqual(items.map((item) => (item.type === "line" ? `${item.index}${item.mark ?? ""}` : `${item.thread.id}${item.placed ? "" : "^"}`)),
    ["T2^", "T3^", "T4^", "0", "1", "2", "3thread", "T1", "4", "5", "6"]);
  assert.equal(at[3], 6);
  assert.equal(threadWhere(thread(), true), "line 2");
  assert.equal(threadWhere(thread({ startLine: 1, line: 3, side: "LEFT" }), true), "lines 1-3 before the change");
  assert.equal(threadWhere(outdated, false), "line 175 when it was written, changed since");
  assert.equal(threadWhere(outside, false), "line 99, outside the diff shown");
  assert.equal(threadWhere(whole, false), "the file as a whole");
});

test("synthetic: an annotation's mark stands before a thread's on the same line, and the thread is drawn after it", () => {
  const { annotations } = reviewOf(["issue", on(3, 3), "mine"]);
  const { items } = annotatedRows(rows, annotations, "src/a.js", HEAD, [thread()]);
  assert.deepEqual(items.slice(3, 6).map((item) => (item.type === "line" ? item.mark : item.type)), ["issue", "annotation", "thread"]);
});

test("synthetic: a key acts on the thread stepped to, else on an annotation on the cursor's line before a thread on it", () => {
  const { annotations } = reviewOf(["issue", on(3, 3), "mine"]);
  const threads = [thread(), thread({ id: "T2", line: 4 })];
  assert.deepEqual(activeNote(annotations, threads, "T2", "src/a.js", HEAD, rows, 3), { annotation: null, thread: threads[1] });
  assert.equal(activeNote(annotations, threads, null, "src/a.js", HEAD, rows, 3).annotation.body, "mine");
  assert.equal(activeNote(annotations, threads, "a1", "src/a.js", HEAD, rows, 5).annotation.body, "mine");
  assert.deepEqual(activeNote(annotations, threads, null, "src/a.js", HEAD, rows, 5), { annotation: null, thread: threads[1] });
  assert.deepEqual(activeNote(annotations, threads, null, "src/a.js", HEAD, rows, 6), { annotation: null, thread: null });
  assert.deepEqual(activeNote(annotations, threads, null, "src/b.js", HEAD, rows, 5), { annotation: null, thread: null });
});

test("synthetic: h and l stop at annotations and threads alike, by file and row", () => {
  const { annotations } = reviewOf(["issue", on(4, 4), "a late"], ["comment", null, "overall"], ["comment", on(1, 1, "src/b.js"), "b"], ["issue", on(2, 2, "src/a.js", "0000000"), "a old"]);
  const threads = [thread(), thread({ id: "T2", path: "src/b.js", line: 5 }), thread({ id: "T3", line: null, outdated: true }), thread({ id: "T4", path: "bin.png" })];
  const rowsOf = (path) => (path === "bin.png" ? [] : rows);
  assert.deepEqual(stops(annotations, threads, ["src/b.js", "src/a.js", "bin.png"], HEAD, rowsOf).map((stop) => `${stop.id}@${stop.path}:${stop.row}`),
    ["a2@null:0", "a3@src/b.js:1", "T2@src/b.js:6", "a4@src/a.js:0", "T3@src/a.js:0", "T1@src/a.js:3", "a1@src/a.js:4", "T4@bin.png:0"]);
  const ordered = stops(annotations, threads, ["src/b.js", "src/a.js", "bin.png"], HEAD, rowsOf);
  assert.equal(stepAnnotation(ordered, "T4", 1).id, "a2");
  assert.equal(stepAnnotation(ordered, "T1", -1).id, "T3");
});

test("synthetic: a file says how many threads on it are still open, else how many are resolved", () => {
  const threads = [thread(), thread({ id: "T2", resolved: true }), thread({ id: "T3", path: "src/b.js", resolved: true }), thread({ id: "T4", path: "src/b.js", resolved: true })];
  assert.deepEqual([...threadsByPath(threads)], [["src/a.js", { text: "1 thread", open: true }], ["src/b.js", { text: "2 resolved", open: false }]]);
});

test("synthetic: a thread is sent to the agent with where it is, its lines and all that was written in it", () => {
  const said = thread({ startLine: 2, startSide: "LEFT", resolved: true, more: 2, comments: [
    { who: "ada", body: "Why 3?\n\nTwo was fine.", at: "2026-11-20T10:00:00Z", url: "https://github.com/octo/site/pull/7#discussion_r1", state: null },
    { who: null, body: "Agreed.", at: "2026-11-20T11:00:00Z", url: "https://github.com/octo/site/pull/7#discussion_r2", state: null },
  ] });
  assert.equal(formatThread(SUBJECT, said, rows), [
    "I am reading pull request octo/site#7, \"Count to three\" (https://github.com/octo/site/pull/7) at commit 1111111 in a pane beside this terminal. Please address this review thread on it.",
    "",
    "Location: `src/a.js` line 2 (resolved)",
    "",
    "The lines it is on:",
    "```diff",
    "-const b = 2;",
    "+const b = 3;",
    "```",
    "",
    "The thread (https://github.com/octo/site/pull/7#discussion_r1):",
    "",
    "ada wrote:",
    "> Why 3?",
    ">",
    "> Two was fine.",
    "",
    "A deleted account wrote:",
    "> Agreed.",
    "",
    "2 more comments on GitHub.",
  ].join("\n"));
  const gone = formatThread(SUBJECT, thread({ line: null, was: 40, outdated: true }), rows);
  assert.match(gone, /\nLocation: `src\/a\.js` line 40 when it was written, changed since \(outdated\)\n\nThe thread \(/);
  assert.doesNotMatch(gone, /The lines it is on/);
});

const TWO_HUNKS = patchRows(["@@ -1,2 +1,3 @@", "+new top", " keep", "-gone", "@@ -10,2 +11,2 @@", " ctx", "-old", "+new"].join("\n"));

test("a stretch of rows is named for GitHub by the line it ends on and that line's side", () => {
  assert.deepEqual(githubLines(rows, 3, 3), { line: 2, side: "RIGHT" });
  assert.deepEqual(githubLines(rows, 2, 2), { line: 2, side: "LEFT" });
  assert.deepEqual(githubLines(rows, 5, 6), { startLine: 4, startSide: "RIGHT", line: 5, side: "RIGHT" });
  assert.deepEqual(githubLines(rows, 2, 4), { startLine: 2, startSide: "LEFT", line: 3, side: "RIGHT" });
  assert.deepEqual(githubLines(rows, 1, 2), { startLine: 1, startSide: "LEFT", line: 2, side: "LEFT" });
});

test("a stretch keeps to one hunk and to lines GitHub has on its side; a hunk's header alone is no line", () => {
  assert.equal(githubLines(rows, 0, 0), null);
  assert.deepEqual(githubLines(rows, 0, 1), { line: 1, side: "RIGHT" });
  assert.deepEqual(githubLines(TWO_HUNKS, 2, 7), { startLine: 11, startSide: "RIGHT", line: 12, side: "RIGHT" });
  assert.deepEqual(githubLines(TWO_HUNKS, 1, 4), { startLine: 1, startSide: "LEFT", line: 2, side: "LEFT" });
  assert.deepEqual(githubLines(TWO_HUNKS, 1, 1), { line: 1, side: "RIGHT" });
});

test("the review posted on GitHub has a line comment per annotation, and in its own words what has no line there", () => {
  const { annotations } = reviewOf(["issue", on(2, 4), "Three is wrong."], ["question", on(1, 1), "Why?"], ["comment", null, "Good overall."],
    ["suggestion", on(5, 5, "src/a.js", "0000000aaaa"), "Drop it."], ["comment", on(3, 3), "Fine."], ["issue", on(0, 0), "Header?"]);
  assert.deepEqual(postingOf(annotations, ["src/a.js"], HEAD, () => rows, "COMMENT"), {
    commit: HEAD, event: "COMMENT",
    body: ["Good overall.", "**Issue** on `src/a.js` hunk header:\n\n```diff\n@@ -1,4 +1,5 @@\n```\n\nHeader?",
      "**Suggestion** on `src/a.js` line 4 (as of commit 0000000):\n\n```diff\n export { a, b };\n```\n\nDrop it."].join("\n\n"),
    comments: [
      { path: "src/a.js", startLine: 2, startSide: "LEFT", line: 3, side: "RIGHT", body: "**Issue:** Three is wrong." },
      { path: "src/a.js", line: 2, side: "RIGHT", body: "Fine." },
    ],
  });
  assert.deepEqual(postingOf([], [], HEAD, () => rows, "APPROVE"), { commit: HEAD, event: "APPROVE", body: "", comments: [] });
});

test("a review goes to GitHub as one mutation with its values written in: words as JSON writes them, lines as numbers", () => {
  const posting = { commit: HEAD, event: "COMMENT", body: "Say \"hi\"\n@all", comments: [
    { path: "src/a.js", startLine: 2, startSide: "LEFT", line: 3, side: "RIGHT", body: "12" }, { path: "b.js", line: 9, side: "RIGHT", body: "It is `x\\y`." }] };
  const args = reviewArgs("github.com", "PR_1", posting);
  assert.deepEqual([args.slice(0, 5), args.length], [["api", "graphql", "--hostname", "github.com", "-f"], 6]);
  assert.equal(args[5], [
    "query=mutation {",
    `  addPullRequestReview(input: { pullRequestId: "PR_1", commitOID: "${HEAD}", event: COMMENT, body: "Say \\"hi\\"\\n@all", threads: [`
      + "{ path: \"src/a.js\", startLine: 2, startSide: LEFT, line: 3, side: RIGHT, body: \"12\" }, "
      + "{ path: \"b.js\", line: 9, side: RIGHT, body: \"It is `x\\\\y`.\" }] }) {",
    "    pullRequestReview { url }",
    "  }",
    "}",
  ].join("\n"));
  assert.match(reviewArgs("github.com", "PR_1", { commit: HEAD, event: "APPROVE", body: "", comments: [] })[5], /event: APPROVE, body: "", threads: \[\] \}\)/);
  assert.deepEqual(replyArgs("github.com", "T1", "@you true").slice(-4), ["-f", "thread=T1", "-f", "body=@you true"]);
  assert.match(resolveArgs("github.com", "T1", true)[5], /resolveReviewThread/);
  assert.match(resolveArgs("github.com", "T1", false)[5], /unresolveReviewThread/);
});

test("a review is posted only on GitHub's latest answer; an approval only of an open pull request that is someone else's", () => {
  const at = { event: "COMMENT", count: 2, live: true, busy: false, mine: true, state: "MERGED" };
  assert.equal(postBlock(at), null);
  assert.equal(postBlock({ ...at, count: 0 }), "Nothing to post yet: c, s or i notes the line.");
  assert.equal(postBlock({ ...at, live: false }), "Not until GitHub answers again.");
  assert.equal(postBlock({ ...at, busy: true }), "A review is on its way to GitHub.");
  const approve = { ...at, event: "APPROVE", count: 0, mine: false, state: "OPEN" };
  assert.equal(postBlock(approve), null);
  assert.equal(postBlock({ ...approve, mine: true }), "GitHub does not take your approval of your own pull request.");
  assert.equal(postBlock({ ...approve, mine: null }), "Still reading what is on GitHub: try again in a moment.");
  assert.equal(postBlock({ ...at, mine: null }), "Still reading what is on GitHub: try again in a moment.");
  assert.equal(postBlock({ ...approve, state: "MERGED" }), "It is no longer open: there is nothing to approve.");
});
