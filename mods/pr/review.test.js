import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAbout, parseFiles } from "./github.js";
import { diffOf } from "./diff.js";
import { readJson } from "./recorded.js";
import { EMPTY, activeNote, annotatedRows, askWords, countByPath, dropAnnotation, markAsked, saveDraft, sortAnnotations, spotOf, stops, threadStretch, threadWhere, threadsByPath, toSend } from "./review.js";
import { HEAD, on, reviewOf, rows, thread } from "./samples.js";

test("a stretch is named by its lines as the file is now, removed lines by where they were", () => {
  assert.equal(on(3, 3).where, "line 2");
  assert.equal(on(1, 4).where, "lines 1-3");
  assert.equal(on(2, 2).where, "line 2 before the change");
  assert.equal(on(0, 0).where, "hunk header");
  assert.equal(on(0, 1).where, "line 1");
});

test("a target quotes its rows as diff lines", () => {
  assert.deepEqual(on(1, 3), {
    path: "src/a.js", head: HEAD, start: 1, end: 3, where: "lines 1-2",
    quote: [" const a = 1;", "-const b = 2;", "+const b = 3;"],
  });
  assert.deepEqual(on(0, 0).quote, ["@@ -1,4 +1,5 @@"]);
  const unended = diffOf("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b").rows;
  assert.deepEqual(spotOf("a.txt", HEAD, unended, 1, 3).quote, ["-a", "\\ No newline at end of file", "+b"]);
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
  assert.deepEqual(saved, { id: "a1", kind: "question", target: on(1, 1), body: "Why not?" });
  assert.deepEqual(review.annotations, [saved, asked.annotations[1]]);
  assert.equal(review.nextId, 3);
});

test("what is sent as a review is every annotation but the questions, which went as they were asked", () => {
  const { annotations } = reviewOf(["issue", on(2, 4), "Three is wrong."], ["question", on(1, 1), "Why?"], ["comment", null, "Good overall."], ["suggestion", on(5, 5), "Drop it."]);
  assert.deepEqual(toSend(annotations).map((one) => one.id), ["a1", "a3", "a4"]);
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

test("an annotation is drawn under the last line it covers, and its lines carry the mark of the gravest kind on them", () => {
  const review = reviewOf(["comment", on(2, 3), "both"], ["issue", on(3, 3), "the new one"], ["question", on(1, 1, "src/other.js"), "elsewhere"]);
  const { items, at } = annotatedRows(rows, review.annotations, "src/a.js", HEAD);
  assert.deepEqual(items.map((item) => (item.type === "line" ? `${item.index}${item.mark ?? ""}` : `^${item.annotation.body}`)),
    ["0", "1", "2comment", "3issue", "^both", "^the new one", "4", "5", "6"]);
  assert.deepEqual(at, [0, 1, 2, 3, 6, 7, 8]);
  assert.ok(items.every((item) => item.type === "line" || !item.moved));
  const later = reviewOf(["issue", on(3, 3), "written first"], ["comment", on(2, 3), "starts first"]);
  assert.deepEqual(annotatedRows(rows, later.annotations, "src/a.js", HEAD).items.filter((item) => item.type === "annotation").map((item) => item.annotation.body),
    ["starts first", "written first"], "two that end on one line stand in the order they start");
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
  assert.equal(activeNote(annotations, [], null, "src/a.js", HEAD, rows, 2).annotation.body, "wide");
  assert.equal(activeNote([...annotations].reverse(), [], null, "src/a.js", HEAD, rows, 2).annotation.body, "wide", "the first by where it starts, not by when it was written");
  assert.equal(activeNote(annotations, [], "a2", "src/a.js", HEAD, rows, 5).annotation.body, "narrow");
  assert.equal(activeNote(annotations, [], null, "src/a.js", HEAD, rows, 5).annotation, null);
  assert.equal(activeNote(annotations, [], null, "src/b.js", HEAD, rows, 2).annotation, null);
  assert.equal(activeNote(annotations, [], null, "src/a.js", HEAD, rows.slice(0, 3), 2).annotation.body, "narrow", "one that runs past a diff that got shorter is not on its rows");
});

test("files are counted by what is noted on them", () => {
  const { annotations } = reviewOf(["comment", on(1, 1), "1"], ["issue", on(2, 2), "2"], ["issue", on(2, 2, "src/b.js"), "3"], ["comment", null, "4"]);
  assert.deepEqual(Object.fromEntries(countByPath(annotations)), { "src/a.js": 2, "src/b.js": 1 });
});

test("a question says how asking it stands; other kinds say nothing", () => {
  const [question, comment] = reviewOf(["question", on(1, 1), "Why?"], ["comment", null, "Fine"]).annotations;
  assert.equal(askWords(comment, new Set()), null);
  assert.equal(askWords(question, new Set(["a1"])), "asking…");
  assert.equal(askWords(question, new Set()), "not asked");
  assert.equal(askWords({ ...question, ask: "sent" }, new Set()), "asked");
  assert.equal(askWords({ ...question, ask: { failed: "no terminal \"t9\"" } }, new Set()), "not asked: no terminal \"t9\"");
});

test("a real diff's lines are quoted as GitHub gave them", () => {
  const [file] = parseFiles(readJson("files-first-game-146.json"));
  const real = diffOf(file.patch).rows;
  const target = spotOf(file.path, HEAD, real, 0, real.length - 1);
  assert.equal(target.quote.join("\n"), file.patch.replaceAll("\t", "    "));
});

test("a recorded pull request's threads each stand under the line GitHub names, and a thread on several lines starts at its first", () => {
  const { threads } = parseAbout(readJson("about-cli-15081.json"));
  const files = parseFiles(readJson("files-cli-15081.json"));
  assert.equal(threads.length, 6);
  for (const one of threads) {
    const real = diffOf(files.find((file) => file.path === one.path).patch).rows;
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
  assert.equal(threadWhere(thread({ line: null, was: null, outdated: true }), false), "lines that have changed since");
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

test("synthetic: a thread on several lines is under the cursor on each of them, from its first to the one it stands under", () => {
  const wide = thread({ startLine: 1, startSide: "RIGHT", line: 3 });
  assert.deepEqual(threadStretch(rows, wide), { start: 1, end: 4 });
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((cursor) => activeNote([], [wide], null, "src/a.js", HEAD, rows, cursor).thread?.id ?? null), [null, "T1", "T1", "T1", "T1", null]);
  assert.deepEqual(stops([], [wide], ["src/a.js"], HEAD, () => rows), [{ id: "T1", path: "src/a.js", row: 4 }], "h and l stop on the line it stands under");
});

test("synthetic: h and l stop at annotations and threads alike, by file and row", () => {
  const { annotations } = reviewOf(["issue", on(4, 4), "a late"], ["comment", null, "overall"], ["comment", on(1, 1, "src/b.js"), "b"], ["issue", on(2, 2, "src/a.js", "0000000"), "a old"]);
  const threads = [thread(), thread({ id: "T2", path: "src/b.js", line: 5 }), thread({ id: "T3", line: null, outdated: true }), thread({ id: "T4", path: "bin.png" })];
  const rowsOf = (path) => (path === "bin.png" ? [] : rows);
  assert.deepEqual(stops(annotations, threads, ["src/b.js", "src/a.js", "bin.png"], HEAD, rowsOf).map((stop) => `${stop.id}@${stop.path}:${stop.row}`),
    ["a2@null:0", "a3@src/b.js:1", "T2@src/b.js:6", "a4@src/a.js:0", "T3@src/a.js:0", "T1@src/a.js:3", "a1@src/a.js:4", "T4@bin.png:0"]);
  const shorter = stops(annotations.slice(0, 1), [], ["src/a.js"], HEAD, () => rows.slice(0, 4));
  assert.deepEqual(shorter, [{ id: "a1", path: "src/a.js", row: 0 }], "one on rows the diff no longer has stands above its first line");
  assert.deepEqual(stops(reviewOf(["issue", on(2, 4), "wide"]).annotations, [], ["src/a.js"], HEAD, () => rows), [{ id: "a1", path: "src/a.js", row: 2 }], "one on several rows is stopped at on its first");
});

test("synthetic: a file says how many threads on it are still open, else how many are resolved", () => {
  const threads = [thread(), thread({ id: "T2", resolved: true }), thread({ id: "T3", path: "src/b.js", resolved: true }), thread({ id: "T4", path: "src/b.js", resolved: true })];
  assert.deepEqual(Object.fromEntries(threadsByPath(threads)), { "src/a.js": { text: "1 thread", open: true }, "src/b.js": { text: "2 resolved", open: false } });
  assert.deepEqual(Object.fromEntries(threadsByPath([thread(), thread({ id: "T2" }), thread({ id: "T3", resolved: true })])), { "src/a.js": { text: "2 threads", open: true } });
});

