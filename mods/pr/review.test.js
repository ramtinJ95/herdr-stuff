import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFiles } from "./github.js";
import { patchRows } from "./diff.js";
import { fixtures } from "./recorded.js";
import { EMPTY, REVIEW_KEYS, activeAnnotation, agentOf, annotatedRows, askWords, countByPath, dropAnnotation, formatQuestion, formatReview, isMove, markAsked,
  moveCursor, saveDraft, sendResult, sortAnnotations, stepAnnotation, stretch, targetOf, toSend, whereOf } from "./review.js";

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
