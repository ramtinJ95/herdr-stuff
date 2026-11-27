import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFiles } from "./github.js";
import { diffOf, isLine, rowLines, rowNumber, rowSpans } from "./diff.js";
import { readJson } from "./recorded.js";

/** What `gh api repos/ramtinJ95/first-game/pulls/146/files --paginate --slurp` printed. */
const filesAnswer = () => readJson("files-first-game-146.json");
const count = (rows, kind) => rows.filter((row) => row.kind === kind).length;

test("the rows of each recorded diff add up to the additions and deletions GitHub counts for the file", () => {
  for (const file of parseFiles(filesAnswer())) {
    const rows = diffOf(file.patch).rows;
    assert.deepEqual([count(rows, "add"), count(rows, "del")], [file.additions, file.deletions], file.path);
  }
});

test("each recorded hunk numbers its lines from its header, and holds as many old and new lines as the header says", () => {
  for (const file of parseFiles(filesAnswer())) {
    const rows = diffOf(file.patch).rows;
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
  const rows = diffOf("@@ -7,2 +7,2 @@ function f() {\n same\n-old\n\\ No newline at end of file\n+new").rows;
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
  assert.deepEqual(diffOf("@@ -1 +1 @@\n+\tif (x) {\n+ab\tc").rows.slice(1).map((row) => row.text), ["    if (x) {", "ab  c"]);
});

test("synthetic: a diff is laid out for its largest line number", () => {
  const { rows, digits } = diffOf("@@ -98,2 +98,3 @@\n a\n+a longer line\n b");
  assert.deepEqual([rows.length, digits], [4, 3]);
  assert.equal(diffOf("@@ -9,2 +9 @@\n a\n-b").digits, 2, "a removed line's number counts");
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
    const { rows, coloured } = diffOf(PATCH, wrong);
    assert.deepEqual([coloured, rows.some((row) => row.spans !== undefined)], [false, false]);
  }
});

test("synthetic: a line the helper cut short is the same line, and what it left out is drawn plain", () => {
  const cut = lines().map((line, i) => (i === 0 ? [line[0], line[1], [[4, "sa", 0]]] : line));
  const { rows, coloured } = diffOf(PATCH, cut);
  assert.deepEqual([coloured, rows[1].spans], [true, [[4, "sa", 0], [0, "me", 0]]]);
});

test("synthetic: tabs are padded along the whole line, across its spans, as in the plain text", () => {
  const { rows, coloured } = diffOf("@@ -1 +1 @@\n+\tif (x)\t// why", [["add", 1, [[4, "\tif", 0], [0, " (x)\t", 0], [1, "// why", 0]]]]);
  assert.deepEqual([coloured, rows[1].text, rows[1].spans], [true, "    if (x)  // why", [[4, "    if", 0], [0, " (x)  ", 0], [1, "// why", 0]]]);
});

/** A line of these spans as it is drawn in a pane `columns` wide. */
const drawn = (spans, columns) => rowSpans({ kind: "add", old: null, new: 1, text: spans.map(([, part]) => part).join(""), spans }, columns);

test("synthetic: a coloured line is cut at column 400, as a plain one is, and what is left of a span keeps its colour and mark", () => {
  const start = "a".repeat(398);
  assert.deepEqual(drawn([[0, start, 0], [1, "bcdef", 1], [2, "ghi", 0]], 400), [[[0, start, 0], [1, "bc", 1]]]);
  assert.deepEqual(drawn([[0, start, 0], [1, "bc", 1]], 400), [[[0, start, 0], [1, "bc", 1]]]);
  assert.deepEqual(drawn([[0, start, 0], [1, "bc", 1], [2, "ghi", 0]], 400), [[[0, start, 0], [1, "bc", 1]]], "a span that starts at the cut is left out");
});

test("synthetic: a long line folds at the pane's edge, wherever that falls, and each part keeps its colour and mark", () => {
  assert.deepEqual(drawn([[4, "abc", 0], [0, "defgh", 1]], 4), [[[4, "abc", 0], [0, "d", 1]], [[0, "efgh", 1]]]);
  assert.deepEqual(drawn([[0, "abcdefghij", 0]], 4), [[[0, "abcd", 0]], [[0, "efgh", 0]], [[0, "ij", 0]]]);
});

test("synthetic: a line with no text is still one line, and a line that ends at the edge has no empty line after it", () => {
  assert.deepEqual(rowSpans({ kind: "same", old: 1, new: 1, text: "" }, 10), [[[0, "", 0]]]);
  assert.deepEqual(drawn([[0, "abcd", 0], [1, "efgh", 0]], 4), [[[0, "abcd", 0]], [[1, "efgh", 0]]]);
  assert.deepEqual(drawn([[0, "abcd", 0], [1, "", 0], [1, "efgh", 0]], 4), [[[0, "abcd", 0]], [[1, "efgh", 0]]], "a span with no text draws nothing");
});

test("every recorded row takes as many lines as its cut text folds into, and a hunk header or a note takes one", () => {
  const rows = filesAnswer().flat().filter((file) => file.patch).flatMap((file) => diffOf(file.patch).rows);
  assert.ok(rows.some((row) => row.text.length > 40), "the recording has lines that fold");
  for (const columns of [20, 40, 97, 400]) {
    for (const row of rows) {
      const folded = isLine(row) ? rowSpans(row, columns).length : 1;
      assert.equal(rowLines(row, columns), folded, `${row.kind} row of ${row.text.length} characters at ${columns}`);
    }
  }
  assert.equal(rowLines({ kind: "add", old: null, new: 1, text: "x".repeat(1200) }, 100), 4, "a line is cut at column 400");
});

test("synthetic: a row's text is drawn as its own spans when it fits, and cut then folded when it does not", () => {
  const spans = [[4, "const", 0], [0, " a = 1;", 0]];
  const row = { kind: "add", old: null, new: 1, text: "const a = 1;", spans };
  assert.deepEqual(rowSpans(row, 80), [[[4, "const", 0], [0, " a = 1;", 0]]]);
  assert.deepEqual(rowSpans(row, 12), [[[4, "const", 0], [0, " a = 1;", 0]]]);
  assert.deepEqual(rowSpans(row, 5), [[[4, "const", 0]], [[0, " a = ", 0]], [[0, "1;", 0]]]);
  const long = { kind: "same", old: 1, new: 1, text: "x".repeat(450) };
  assert.deepEqual(rowSpans(long, 100), Array(4).fill([[0, "x".repeat(100), 0]]));
  assert.deepEqual(rowSpans(long, 500), [[[0, "x".repeat(400), 0]]]);
});

test("synthetic: a line of the file is any row but a hunk's header or a note", () => {
  assert.deepEqual(diffOf("@@ -1 +1,2 @@\n a\n+b\n\\ No newline at end of file").rows.map(isLine), [false, true, true, false]);
});
