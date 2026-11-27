// Runs the helper as the pane does, with node on a file, and checks its answer against the pane's own reading of the same diffs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFiles } from "../github.js";
import { ROLES, diffOf } from "../diff.js";
import { colourFiles } from "./colours.js";
import { readJson } from "../recorded.js";

const here = new URL(".", import.meta.url).pathname;
const installed = existsSync(join(here, "node_modules/@pierre/diffs"));
const skip = installed ? false : "run `npm install` in mods/pr/pierre to test the helper";

/** A program run as Herdr's exec runs one: however it exits, that and what it printed. */
const exec = async (program, argv) => {
  const run = spawnSync(program, argv, { encoding: "utf8", maxBuffer: 64 << 20 });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
};

/** The helper's answer for these files, asked and read as the pane does both. */
async function colours(files) {
  const folder = mkdtempSync(join(tmpdir(), "pr-highlight-"));
  try {
    const answer = await colourFiles(files, { helper: join(here, "highlight.mjs"), folder, exec, fs: { mkdir, writeFile, unlink } });
    assert.equal(answer.note, null);
    return answer;
  } finally {
    rmSync(folder, { recursive: true });
  }
}
const file = (path, patch, extra = {}) => ({ path, previous: null, status: "modified", additions: 0, deletions: 0, patch, ...extra });
const roleOf = (spans, text) => ROLES[spans.find(([, part]) => part.trim() === text)?.[0]];

test("the helper's lines are the pane's rows for every file of a recorded pull request, so each diff is drawn coloured", { skip }, async () => {
  const files = parseFiles(readJson("files-first-game-146.json"));
  const { byPath } = await colours(files);
  for (const f of files) {
    const { rows, coloured } = diffOf(f.patch, byPath.get(f.path));
    assert.equal(coloured, true, f.path);
    for (const row of rows.filter((r) => r.kind !== "hunk" && r.kind !== "note")) assert.equal(row.spans.map(([, text]) => text).join(""), row.text, f.path);
  }
  const first = diffOf(files[0].patch, byPath.get(files[0].path)).rows;
  // Line 1 of the file: import { describe, expect, it } from 'vitest';
  assert.deepEqual([roleOf(first[1].spans, "import"), roleOf(first[1].spans, "'vitest'")], ["keyword", "string"]);
  // Line 3 was `import type { CityId, FactionId }` and became `import { allocateId, type CityId, type FactionId }`.
  const removed = first.find((row) => row.kind === "del"), added = first.find((row) => row.kind === "add");
  assert.deepEqual(removed.spans.filter(([, , changed]) => changed === 1).map(([, text]) => text).join(""), "type ");
  assert.match(added.spans.filter(([, , changed]) => changed === 1).map(([, text]) => text).join(""), /allocateId/);
});

test("synthetic: added, removed and renamed files, a line with tabs and a file without a newline at its end all line up", { skip }, async () => {
  const files = [
    file("new.ts", "@@ -0,0 +1,2 @@\n+export const a = 1;\n+\tconst b = \"x\";\t// tabbed", { status: "added" }),
    file("gone.py", "@@ -1,2 +0,0 @@\n-def f():\n-    return 1", { status: "removed" }),
    file("to.js", "@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;", { status: "renamed", previous: "from.js" }),
    file("a.json", "@@ -1,2 +1,2 @@\n {\"a\": 1,\n-\"b\": 2}\n\\ No newline at end of file\n+\"b\": 3}\n\\ No newline at end of file"),
    file("notes.unknown-kind", "@@ -1 +1 @@\n-plain words\n+plainer words"),
  ];
  const { byPath } = await colours(files);
  for (const f of files) assert.equal(diffOf(f.patch, byPath.get(f.path)).coloured, true, `${f.path}: ${JSON.stringify(byPath.get(f.path)).slice(0, 200)}`);
});

test("synthetic: a line longer than Pierre reads is drawn whole and plain, and the lines around it keep their colours", { skip }, async () => {
  const long = `const words = "${"lorem ".repeat(400)}";`;
  const f = file("long.js", `@@ -0,0 +1,2 @@\n+${long}\n+const after = 1;`, { status: "added" });
  const { rows, coloured } = diffOf(f.patch, (await colours([f])).byPath.get(f.path));
  assert.equal(coloured, true);
  assert.equal(rows[1].spans.map(([, text]) => text).join(""), long);
  assert.deepEqual([...new Set(rows[1].spans.map(([role]) => ROLES[role]))], ["plain"]);
  assert.equal(roleOf(rows[2].spans, "const"), "keyword");
});

test("synthetic: a file without a diff is not sent, and gets no answer", { skip }, async () => {
  const { byPath } = await colours([file("image.png", null), file("a.js", "@@ -1 +1 @@\n-a\n+b")]);
  assert.deepEqual([...byPath.keys()], ["a.js"]);
});
