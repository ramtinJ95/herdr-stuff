// A small diff and what is noted on it, for the tests of the annotations, of what is sent of them, and of the keyboard in a diff.
import { diffOf } from "./diff.js";
import { EMPTY, saveDraft, spotOf } from "./review.js";

const PATCH = ["@@ -1,4 +1,5 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", "+const c = `tick`;", " export { a, b };", " // end"].join("\n");
export const rows = diffOf(PATCH).rows;
export const HEAD = "1111111aaaaaaa";
export const SUBJECT = { ref: "octo/site#7", title: "Count to three", url: "https://github.com/octo/site/pull/7", head: HEAD };

/** The spot of rows `start` to `end` of that diff. */
export const on = (start, end, path = "src/a.js", head = HEAD) => spotOf(path, head, rows, start, end);

/** A review with one annotation per `[kind, target, body]`, in the order given. */
export const reviewOf = (...notes) => notes.reduce((review, [kind, target, body]) => saveDraft(review, { kind, target, editingId: null }, body).review, EMPTY);

/** One of GitHub's threads, as `parseAbout` gives it: on the added `const b = 3;` unless said otherwise. */
export const thread = (extra = {}) => ({
  id: "T1", path: "src/a.js", line: 2, startLine: null, side: "RIGHT", startSide: null, was: 2, resolved: false, outdated: false,
  canReply: true, canResolve: true, canUnresolve: false, more: 0,
  comments: [{ who: "ada", body: "Why 3?", at: "2026-11-20T10:00:00Z", url: "https://github.com/octo/site/pull/7#discussion_r1", state: null }], ...extra,
});
