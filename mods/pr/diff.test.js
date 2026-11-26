import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GhError, parseFiles } from "./github.js";
import { diffOf, patchRows, rowNumber } from "./diff.js";
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
