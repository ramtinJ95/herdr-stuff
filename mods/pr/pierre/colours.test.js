import { test } from "node:test";
import assert from "node:assert/strict";
import { colourFiles, colouredDiff } from "./colours.js";

/** The helper's lines for a file, as it prints them: [kind, number, [[role, text, changed]]]. */
const lines = () => [["same", 7, [[4, "sa", 0], [0, "me", 0]]], ["del", 8, [[0, "old", 1]]], ["add", 8, [[0, "new", 1]]]];
/** The diff those are the lines of. */
const PATCH = "@@ -7,2 +7,2 @@\n same\n-old\n+new";

const FILES = [{ path: "a.js", previous: null, status: "modified", additions: 1, deletions: 1, patch: PATCH }, { path: "b.png", previous: null, status: "added", additions: 0, deletions: 0, patch: null }];
/** A stand-in for the file system the helper's input is written to: keeps what is there by path. */
function fakeFs(broken = false) {
  const kept = new Map();
  return {
    kept,
    mkdir: async () => {},
    writeFile: async (path, text) => {
      if (broken) throw new Error("EACCES: permission denied\nmore");
      kept.set(path, text);
    },
    unlink: async (path) => void kept.delete(path),
  };
}
/** The colours of FILES when the helper's run ends as `result`. */
const answered = (result) => colourFiles(FILES, { helper: "h.mjs", folder: "/cache/pr", exec: async () => result, fs: fakeFs() });
const printed = (files) => ({ code: 0, stdout: JSON.stringify({ files }), stderr: "" });

test("synthetic: the helper is run with node on a file of the files that have a diff, which is gone again once it has answered", async () => {
  const fs = fakeFs();
  const runs = [];
  const exec = async (program, argv, options) => {
    runs.push([program, argv[0], JSON.parse(fs.kept.get(argv[1])), options.timeout > 0]);
    return printed([{ path: "a.js", lines: lines() }]);
  };
  const colours = await colourFiles(FILES, { helper: "/mods/pr/pierre/highlight.mjs", folder: "/cache/pr", exec, fs });
  assert.deepEqual(runs, [["node", "/mods/pr/pierre/highlight.mjs", { files: [{ path: "a.js", previous: null, status: "modified", patch: PATCH }] }, true]]);
  assert.deepEqual([colours.note, [...colours.byPath]], [null, [["a.js", lines()]]]);
  assert.equal(fs.kept.size, 0);
});

test("synthetic: a run of the helper reads as each file's lines, or as the reason there are none", async () => {
  const ok = await answered(printed([{ path: "a.js", lines: lines() }, { path: "b.js", lines: null, error: "odd" }]));
  assert.deepEqual([ok.note, ok.byPath.get("a.js"), ok.byPath.get("b.js")], [null, lines(), "odd"]);
  const missing = await answered({ code: 1, stdout: "", stderr: "node:internal\nError [ERR_MODULE_NOT_FOUND]: Cannot find package '@pierre/diffs'\n" });
  assert.deepEqual([missing.note, missing.byPath.size], ["No syntax colours: run `npm install` in mods/pr/pierre.", 0]);
  assert.equal((await answered({ code: 1, stdout: "", stderr: "a\nTypeError: boom\n" })).note, "No syntax colours: the helper failed. TypeError: boom");
  assert.match((await answered({ code: 0, stdout: "not json", stderr: "" })).note, /^No syntax colours: the helper's answer did not read\. /);
});

test("synthetic: a diff is drawn in the helper's colours where it gave these lines theirs; a plain one says why, and says nothing while the helper has not answered", async () => {
  const colours = await answered(printed([{ path: "a.js", lines: lines() }, { path: "b.js", lines: null, error: "odd" }]));
  const drawn = (colours, path, patch = PATCH) => {
    const { rows, coloured, why } = colouredDiff(patch, colours, path);
    assert.equal(rows.some((row) => row.spans !== undefined), coloured);
    return [coloured, why];
  };
  assert.deepEqual(colouredDiff(PATCH, colours, "a.js").rows.map((row) => row.spans), [undefined, [[4, "sa", 0], [0, "me", 0]], [[0, "old", 1]], [[0, "new", 1]]]);
  assert.deepEqual(drawn(colours, "a.js"), [true, null]);
  assert.deepEqual(drawn(undefined, "a.js"), [false, null]);
  assert.deepEqual(drawn(colours, "a.js", "@@ -7 +7 @@\n-old\n+newer"), [false, "No syntax colours for this file: the helper read other lines than these."]);
  assert.deepEqual(drawn(colours, "b.js"), [false, "No syntax colours for this file: odd"]);
  assert.deepEqual(drawn(colours, "c.js"), [false, "No syntax colours for this file: the helper did not answer for it."]);
  assert.deepEqual(drawn(await answered({ code: 1, stdout: "", stderr: "a\nTypeError: boom\n" }), "a.js"), [false, "No syntax colours: the helper failed. TypeError: boom"]);
});

test("synthetic: no colours is an answer with its reason, when node does not run and when the input cannot be written", async () => {
  const with_ = (exec, fs) => colourFiles(FILES, { helper: "h.mjs", folder: "/cache/pr", exec, fs });
  const fs = fakeFs();
  const gone = await with_(async () => { throw new Error("program not found: node\nmore"); }, fs);
  assert.deepEqual([gone.note, gone.byPath.size, fs.kept.size], ["No syntax colours: node did not run. program not found: node", 0, 0]);
  const denied = await with_(async () => assert.fail("the helper is not run without its input"), fakeFs(true));
  assert.equal(denied.note, "No syntax colours: the helper's input could not be written or removed. EACCES: permission denied");
});
