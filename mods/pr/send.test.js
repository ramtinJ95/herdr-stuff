import { test } from "node:test";
import assert from "node:assert/strict";
import { diffOf } from "./diff.js";
import { spotOf } from "./review.js";
import { HEAD, SUBJECT, on, reviewOf, rows, thread } from "./samples.js";
import { agentOf, formatQuestion, formatReview, formatThread, postBlock, postingOf, sendResult } from "./send.js";

test("the review sent to the agent numbers every annotation but the questions, each with its diff lines", () => {
  const { annotations } = reviewOf(["issue", on(2, 4), "Three is wrong.\n\nUse two."], ["question", on(1, 1), "Why?"], ["comment", null, "Good overall."],
    ["suggestion", on(5, 5, "src/a.js", "0000000aaaa"), "Drop it."]);
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
    "",
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
  const fenced = diffOf(["@@ -1 +1 @@", "+```js"].join("\n")).rows;
  const { annotations } = reviewOf(["issue", spotOf("README.md", HEAD, fenced, 1, 1), "Close it."]);
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

const pane = (pane, extra) => ({ pane, terminal: `t${pane}`, tab: "tab", name: null, status: null, focused: false, program: { name: "zsh", agent: false }, ...extra });
const CLAUDE = { status: "idle", program: { name: "Claude Code", agent: true } };

test("what is sent goes to the tab's agent: the terminal the pane follows when it runs one, never a shell", () => {
  const shell = pane("1"), claude = pane("2", CLAUDE), named = pane("3", { ...CLAUDE, name: "reviewer", focused: true });
  assert.deepEqual(agentOf([shell, claude, named], "2", null), { terminal: "t2", name: "Claude Code" });
  assert.deepEqual(agentOf([shell, claude, named], "1", null), { terminal: "t3", name: "reviewer" });
  assert.deepEqual(agentOf([shell, claude], null, "vps"), { terminal: "vps/t2", name: "Claude Code" });
  assert.deepEqual(agentOf([shell, pane("4", { status: "working" })], null, null), { terminal: "t4", name: "zsh" });
  assert.deepEqual(agentOf([shell, pane("5", { program: CLAUDE.program })], null, null), { terminal: "t5", name: "Claude Code" }, "an agent Herdr has no status for yet");
  assert.deepEqual(agentOf([shell, pane("6", { status: "idle", program: undefined })], null, null), { terminal: "t6", name: "t6" }, "one with no name is called by its terminal");
  assert.deepEqual(agentOf([shell, { pane: "9", terminal: null, mod: "pr", tab: "tab" }], "1", null), { terminal: null, name: "the agent", why: "No agent in this tab to send it to." });
});

test("a send that hc refuses says why in hc's words", () => {
  assert.equal(sendResult({ code: 0, stderr: "" }), "sent");
  assert.deepEqual(sendResult({ code: 3, stderr: "{\"error\":{\"hint\":\"see `hc ls --all`\",\"kind\":\"not_found\",\"message\":\"no terminal \\\"t9\\\"\"}}\n" }), { failed: "no terminal \"t9\"" });
  assert.deepEqual(sendResult({ code: 1, stderr: "warning\nhc: broken pipe\n" }), { failed: "hc: broken pipe" });
  assert.deepEqual(sendResult({ code: 2, stderr: "" }), { failed: "hc send exited with 2" });
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
  assert.match(formatThread(SUBJECT, thread({ comments: [], more: 3 }), rows), /\n```\n\nThe thread:\n\n3 more comments on GitHub\.$/);
});

const TWO_HUNKS = diffOf(["@@ -1,2 +1,3 @@", "+new top", " keep", "-gone", "@@ -10,2 +11,2 @@", " ctx", "-old", "+new"].join("\n")).rows;
/** Where a review posted on GitHub puts a note on rows `start` to `end`: its line comment without the path and the words, or null when it has none. */
function githubLines(rows, start, end) {
  const { annotations } = reviewOf(["comment", spotOf("src/a.js", HEAD, rows, start, end), "Fine."]);
  const { comments } = postingOf(annotations, ["src/a.js"], HEAD, () => rows, "COMMENT");
  if (comments.length === 0) return null;
  const [{ path, body, ...lines }] = comments;
  assert.deepEqual([comments.length, path, body], [1, "src/a.js", "Fine."]);
  return lines;
}

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
  const past = postingOf(reviewOf(["comment", on(5, 5), "Fine."]).annotations, ["src/a.js"], HEAD, () => rows.slice(0, 4), "COMMENT");
  assert.deepEqual([past.comments, past.body], [[], "**Comment** on `src/a.js` line 4:\n\n```diff\n export { a, b };\n```\n\nFine."], "rows the diff no longer has");
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

