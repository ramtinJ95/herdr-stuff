import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GhError, parseFiles } from "./github.js";
import { CUT_COLUMNS, coloursOf, cutSpans, diffOf, helperInput, noColours, paintRows, patchRows, plainNote, rowLines, rowNumber, untabSpans, wrapSpans } from "./diff.js";
import { fixtures } from "./recorded.js";

/** What `gh api repos/ramtinJ95/first-game/pulls/146/files --paginate --slurp` printed. */
const filesAnswer = () => JSON.parse(readFileSync(join(fixtures, "files-first-game-146.json"), "utf8"));
const count = (rows, kind) => rows.filter((row) => row.kind === kind).length;

test("a recorded files answer reads as each file's path, status, counts and diff", () => {
  const files = parseFiles(filesAnswer());
  assert.deepEqual(files.map(({ patch, ...rest }) => rest), [
    { path: "scripts/cautious-rome.test.ts", previous: null, status: "modified", additions: 178, deletions: 3 },
    { path: "scripts/cautious-rome.ts", previous: null, status: "modified", additions: 105, deletions: 3 },
    { path: "scripts/sim/slide.ts", previous: null, status: "modified", additions: 5, deletions: 1 },
  ]);
  assert.ok(files.every((file) => file.patch.startsWith("@@ ")));
});

test("the rows of each recorded diff add up to the additions and deletions GitHub counts for the file", () => {
  for (const file of parseFiles(filesAnswer())) {
    const rows = patchRows(file.patch);
    assert.deepEqual([count(rows, "add"), count(rows, "del")], [file.additions, file.deletions], file.path);
  }
});

test("each recorded hunk numbers its lines from its header, and holds as many old and new lines as the header says", () => {
  for (const file of parseFiles(filesAnswer())) {
    const rows = patchRows(file.patch);
    const starts = rows.flatMap((row, i) => (row.kind === "hunk" ? [i] : []));
    assert.ok(starts.length > 0 && starts[0] === 0, file.path);
    starts.forEach((start, n) => {
      const [, oldStart, oldCount = "1", newStart, newCount = "1"] = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rows[start].text);
      const body = rows.slice(start + 1, starts[n + 1] ?? rows.length).filter((row) => row.kind !== "note");
      const olds = body.filter((row) => row.old !== null).map((row) => row.old);
      const news = body.filter((row) => row.new !== null).map((row) => row.new);
      assert.deepEqual(olds, Array.from({ length: Number(oldCount) }, (_, i) => Number(oldStart) + i), `${file.path} ${rows[start].text}`);
      assert.deepEqual(news, Array.from({ length: Number(newCount) }, (_, i) => Number(newStart) + i), `${file.path} ${rows[start].text}`);
    });
  }
});

test("synthetic: a removed line shows where it was, an added one where it is, and git's own remark is a note", () => {
  const rows = patchRows("@@ -7,2 +7,2 @@ function f() {\n same\n-old\n\\ No newline at end of file\n+new");
  assert.deepEqual(rows, [
    { kind: "hunk", text: "@@ -7,2 +7,2 @@ function f() {" },
    { kind: "same", old: 7, new: 7, text: "same" },
    { kind: "del", old: 8, new: null, text: "old" },
    { kind: "note", text: "No newline at end of file" },
    { kind: "add", old: null, new: 8, text: "new" },
  ]);
  assert.deepEqual(rows.map(rowNumber), [null, 7, 8, null, 8]);
});

test("synthetic: a tab is padded to the next 4-column stop, since text draws it as nothing", () => {
  assert.deepEqual(patchRows("@@ -1 +1 @@\n+\tif (x) {\n+ab\tc").slice(1).map((row) => row.text), ["    if (x) {", "ab  c"]);
});

test("synthetic: a diff is laid out for its widest row and its largest line number", () => {
  const { rows, columns, digits } = diffOf("@@ -98,2 +98,3 @@\n a\n+a longer line\n b");
  assert.deepEqual([rows.length, columns, digits], [4, "@@ -98,2 +98,3 @@".length, 3]);
});

test("synthetic: a file GitHub gives no diff for has a null patch; a rename keeps its old path", () => {
  const raw = filesAnswer();
  delete raw[0][0].patch;
  Object.assign(raw[0][1], { status: "renamed", previous_filename: "scripts/old.ts" });
  const files = parseFiles(raw);
  assert.equal(files[0].patch, null);
  assert.deepEqual([files[1].status, files[1].previous], ["renamed", "scripts/old.ts"]);
});

test("synthetic: a file status this pane has not seen is refused, not drawn as something else", () => {
  const raw = filesAnswer();
  raw[0][0].status = "teleported";
  assert.throws(() => parseFiles(raw), GhError);
});

test("synthetic: pages of files read as one list, in order", () => {
  const [page] = filesAnswer();
  assert.deepEqual(parseFiles([page.slice(0, 2), page.slice(2)]).map((file) => file.path), parseFiles([page]).map((file) => file.path));
});

// The helper's lines for `@@ -7,2 +7,2 @@`, ` same`, `-old`, `+new`: [kind, number, [[role, text, changed]]].
const PATCH = "@@ -7,2 +7,2 @@\n same\n-old\n+new";
const lines = () => [["same", 7, [[4, "sa", 0], [0, "me", 0]]], ["del", 8, [[0, "old", 1]]], ["add", 8, [[0, "new", 1]]]];

test("synthetic: the helper's lines go onto the rows they are the lines of, past the hunk rows", () => {
  const { rows, coloured } = diffOf(PATCH, lines());
  assert.equal(coloured, true);
  assert.deepEqual(rows.map((row) => row.spans), [undefined, [[4, "sa", 0], [0, "me", 0]], [[0, "old", 1]], [[0, "new", 1]]]);
});

test("synthetic: one line off, in count, kind, number or text, leaves the whole file plain", () => {
  const off = [
    lines().slice(0, 2),
    [...lines(), ["add", 9, [[0, "more", 0]]]],
    lines().map((line, i) => (i === 1 ? ["add", line[1], line[2]] : line)),
    lines().map((line, i) => (i === 2 ? [line[0], 9, line[2]] : line)),
    lines().map((line, i) => (i === 0 ? [line[0], line[1], [[0, "other", 0]]] : line)),
  ];
  for (const wrong of off) {
    assert.equal(paintRows(patchRows(PATCH), wrong), null);
    const { rows, coloured } = diffOf(PATCH, wrong);
    assert.deepEqual([coloured, rows.some((row) => row.spans !== undefined)], [false, false]);
  }
});

test("synthetic: a line the helper cut short is the same line, and what it left out is drawn plain", () => {
  const cut = lines().map((line, i) => (i === 0 ? [line[0], line[1], [[4, "sa", 0]]] : line));
  assert.deepEqual(paintRows(patchRows(PATCH), cut)[1].spans, [[4, "sa", 0], [0, "me", 0]]);
});

test("synthetic: tabs are padded along the whole line, across its spans, as in the plain text", () => {
  const spans = [[4, "\tif", 0], [0, " (x)\t", 0], [1, "// why", 0]];
  assert.deepEqual(untabSpans(spans), [[4, "    if", 0], [0, " (x)  ", 0], [1, "// why", 0]]);
  const patch = "@@ -1 +1 @@\n+\tif (x)\t// why";
  assert.equal(diffOf(patch, [["add", 1, spans]]).coloured, true);
});

test("synthetic: spans are cut at the column a plain line is cut at", () => {
  assert.deepEqual(cutSpans([[0, "abc", 0], [1, "def", 1], [2, "ghi", 0]], 5), [[0, "abc", 0], [1, "de", 1]]);
  assert.deepEqual(cutSpans([[0, "abc", 0]], 3), [[0, "abc", 0]]);
});

test("synthetic: only files with a diff are sent to the helper, with what it reads of them", () => {
  const files = [{ path: "a.js", previous: null, status: "modified", additions: 1, deletions: 0, patch: "@@" }, { path: "b.png", previous: null, status: "added", additions: 0, deletions: 0, patch: null }];
  assert.deepEqual(helperInput(files), { files: [{ path: "a.js", previous: null, status: "modified", patch: "@@" }] });
});

test("synthetic: a run of the helper reads as each file's lines, or as the reason there are none", () => {
  const ok = coloursOf({ code: 0, stdout: JSON.stringify({ files: [{ path: "a.js", lines: lines() }, { path: "b.js", lines: null, error: "odd" }] }), stderr: "" });
  assert.deepEqual([ok.note, ok.byPath.get("a.js"), ok.byPath.get("b.js")], [null, lines(), "odd"]);
  const missing = coloursOf({ code: 1, stdout: "", stderr: "node:internal\nError [ERR_MODULE_NOT_FOUND]: Cannot find package '@pierre/diffs'\n" });
  assert.equal(missing.note, "No syntax colours: run `npm install` in mods/pr/pierre.");
  assert.equal(coloursOf({ code: 1, stdout: "", stderr: "a\nTypeError: boom\n" }).note, "No syntax colours: the helper failed. TypeError: boom");
  assert.match(coloursOf({ code: 0, stdout: "not json", stderr: "" }).note, /^No syntax colours: the helper's answer did not read\. /);
  assert.equal(missing.byPath.size, 0);
});

test("synthetic: a plain diff says why, and says nothing while the helper has not answered or once colours are on", () => {
  const colours = coloursOf({ code: 0, stdout: JSON.stringify({ files: [{ path: "a.js", lines: lines() }, { path: "b.js", lines: null, error: "odd" }] }), stderr: "" });
  assert.equal(plainNote(undefined, "a.js", false), null);
  assert.equal(plainNote(colours, "a.js", true), null);
  assert.equal(plainNote(colours, "a.js", false), "No syntax colours for this file: the helper read other lines than these.");
  assert.equal(plainNote(colours, "b.js", false), "No syntax colours for this file: odd");
  assert.equal(plainNote(colours, "c.js", false), "No syntax colours for this file: the helper did not answer for it.");
  assert.equal(plainNote(noColours("No syntax colours: node did not run. x"), "a.js", false), "No syntax colours: node did not run. x");
});

test("synthetic: a long line folds at the pane's edge, wherever that falls, and each part keeps its colour and mark", () => {
  assert.deepEqual(wrapSpans([[4, "abc", 0], [0, "defgh", 1]], 4), [[[4, "abc", 0], [0, "d", 1]], [[0, "efgh", 1]]]);
  assert.deepEqual(wrapSpans([[0, "abcdefghij", 0]], 4), [[[0, "abcd", 0]], [[0, "efgh", 0]], [[0, "ij", 0]]]);
});

test("synthetic: a line with no text is still one line, and a line that ends at the edge has no empty line after it", () => {
  assert.deepEqual(wrapSpans([], 4), [[]]);
  assert.deepEqual(wrapSpans([[0, "", 0]], 4), [[]]);
  assert.deepEqual(wrapSpans([[0, "abcd", 0], [1, "efgh", 0]], 4), [[[0, "abcd", 0]], [[1, "efgh", 0]]]);
});

test("every recorded row takes as many lines as its cut text folds into, and a hunk header or a note takes one", () => {
  const rows = filesAnswer().flat().filter((file) => file.patch).flatMap((file) => patchRows(file.patch));
  assert.ok(rows.some((row) => row.text.length > 40), "the recording has lines that fold");
  for (const columns of [20, 40, 97, CUT_COLUMNS]) {
    for (const row of rows) {
      const folded = row.kind === "hunk" || row.kind === "note" ? 1 : wrapSpans(cutSpans([[0, row.text, 0]], CUT_COLUMNS), columns).length;
      assert.equal(rowLines(row, columns), folded, `${row.kind} row of ${row.text.length} characters at ${columns}`);
    }
  }
  assert.equal(rowLines({ kind: "add", old: null, new: 1, text: "x".repeat(CUT_COLUMNS * 3) }, 100), CUT_COLUMNS / 100);
});
