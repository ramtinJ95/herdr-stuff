import { test } from "node:test";
import assert from "node:assert/strict";
import { READ_KEYS, isMove, readClick, readStep, retryReply, startReading, stretch, typing } from "./reading.js";
import { EMPTY } from "./review.js";
import { HEAD, on, reviewOf, rows, thread } from "./samples.js";

const AGENT = { terminal: "t2", name: "Claude Code" };
const NO_AGENT = { terminal: null, name: "the agent", why: "No agent in this tab to send it to." };
const facts = (extra = {}) => ({
  rowsOf: () => rows, head: HEAD, review: EMPTY, threads: [], paths: ["src/a.js", "src/b.js"], readable: ["src/a.js", "src/b.js"], page: 3,
  agent: AGENT, blocked: () => null, sending: new Set(), typed: "", command: false, ...extra,
});
/** The keyboard in src/a.js, on row `cursor`. */
const at = (cursor = 0, extra = {}) => ({ ...startReading("src/a.js", cursor), ...extra });
const step = (reading, action, extra) => readStep(reading, action, facts(extra));
/** The reading after each of `actions` in turn, with the same facts. */
const after = (reading, actions, extra) => actions.reduce((now, action) => step(now, action, extra).reading, reading);
const asking = (what) => ({ is: "asking", asking: what });

test("a move keeps the cursor among the rows, asks for it on screen, and lets go of what was stepped to", () => {
  const cursor = (from, action, page = 3) => step(at(from), action, { page }).reading.cursor;
  assert.deepEqual([cursor(0, "down"), cursor(0, "up"), cursor(5, "half-down"), cursor(5, "first"), cursor(0, "last")], [1, 0, 6, 0, 6]);
  assert.equal(cursor(5, "half-up", 0), 4, "half a page is at least a line");
  const moved = step(at(2, { activeId: "a1" }), "down");
  assert.deepEqual([moved.reading.activeId, moved.reveal, moved.notice, moved.effects], [null, true, null, []]);
  assert.deepEqual(Object.values(READ_KEYS).filter(isMove).sort(), ["down", "down", "first", "half-down", "half-up", "last", "last", "up", "up"]);
});

test("v starts a range at the cursor and v again gives it up; a range runs between its two ends whichever was set first", () => {
  assert.equal(after(at(4), ["range", "up", "up"]).anchor, 4);
  assert.equal(after(at(4), ["range", "up", "range"]).anchor, null);
  assert.deepEqual([stretch(4, null), stretch(2, 5), stretch(5, 2)], [{ start: 4, end: 4 }, { start: 2, end: 5 }, { start: 2, end: 5 }]);
});

test("c, s, i and a open the field on the cursor's line or its range, and o on the pull request as a whole", () => {
  for (const [key, kind] of [["c", "comment"], ["s", "suggestion"], ["i", "issue"], ["a", "question"]]) {
    const { reading } = step(at(3, { anchor: 2 }), READ_KEYS[key]);
    assert.deepEqual(reading.mode, { is: "draft", draft: { kind, target: on(2, 3), editingId: null }, body: "" }, key);
    assert.equal(typing(reading), true);
  }
  assert.deepEqual(step(at(3), "comment").reading.mode.draft.target, on(3, 3));
  assert.deepEqual(step(at(2, { anchor: 3 }), "comment").reading.mode.draft.target, on(2, 3), "a range made upwards is the same lines");
  assert.deepEqual(step(at(3), "overall").reading.mode, { is: "draft", draft: { kind: "comment", target: null, editingId: null }, body: "" });
});

test("Enter in the field keeps the annotation and closes it; a question goes to the agent at once; no words keep nothing", () => {
  const drafting = step(at(3, { anchor: 2 }), "issue").reading;
  const kept = step(drafting, "confirm", { typed: "  Why 3?  " });
  const [saved] = kept.review.annotations;
  assert.deepEqual(saved, { id: "a1", kind: "issue", target: on(2, 3), body: "Why 3?" });
  assert.deepEqual([kept.reading.mode, kept.reading.activeId, kept.reading.anchor, kept.effects], [{ is: "browse" }, "a1", null, []]);
  const asked = step(step(at(1), "question").reading, "confirm", { typed: "Why?" });
  assert.deepEqual(asked.effects, [{ do: "ask", question: asked.review.annotations[0] }]);
  const again = step(step(at(1), "edit", { review: asked.review }).reading, "confirm", { review: asked.review, typed: "Why not?" });
  assert.deepEqual(again.effects, [{ do: "ask", question: { id: "a1", kind: "question", target: on(1, 1), body: "Why not?" } }], "a question whose words change is asked again");
  const empty = step(drafting, "confirm", { typed: "   " });
  assert.deepEqual([empty.review, empty.reading.mode, empty.reading.anchor, empty.effects], [EMPTY, { is: "browse" }, 2, []]);
});

test("while the field is open only Enter and Esc act, and Esc gives up what is typed", () => {
  const drafting = step(at(3), "issue").reading;
  for (const action of new Set(Object.values(READ_KEYS))) {
    if (action === "confirm" || action === "escape") continue;
    const stayed = step(drafting, action, { typed: "half a thought" });
    assert.deepEqual([stayed.reading, stayed.review, stayed.effects, "notice" in stayed], [drafting, EMPTY, [], false], action);
  }
  const left = step(drafting, "escape", { typed: "half a thought" });
  assert.deepEqual([left.reading, left.review], [at(3), EMPTY]);
});

test("r changes the annotation at the cursor and x deletes it; a line with nothing on it says so", () => {
  const review = reviewOf(["issue", on(2, 3), "Why 3?"]);
  const editing = step(at(3), "edit", { review }).reading;
  assert.deepEqual(editing.mode, { is: "draft", draft: { kind: "issue", target: on(2, 3), editingId: "a1" }, body: "Why 3?" });
  assert.deepEqual(step(editing, "confirm", { review, typed: "Why not 2?" }).review.annotations.map((one) => [one.id, one.body]), [["a1", "Why not 2?"]]);
  assert.deepEqual(step(at(3, { activeId: "a1" }), "delete", { review }).review.annotations, []);
  assert.equal(step(at(5, { activeId: "a1" }), "delete", { review }).reading.activeId, null);
  for (const action of ["edit", "delete"]) {
    const none = step(at(5), action, { review });
    assert.deepEqual([none.notice, none.review, none.reading.mode], ["No annotation or thread on this line.", review, { is: "browse" }], action);
  }
});

test("r on one of GitHub's threads opens a reply, which Enter sends to GitHub; x does not delete a thread", () => {
  const said = thread();
  const replying = step(at(3), "edit", { threads: [said] }).reading;
  assert.deepEqual(replying.mode, { is: "reply", thread: said, body: "", failed: null });
  const sent = step(replying, "confirm", { threads: [said], typed: " Because. " });
  assert.deepEqual([sent.reading.mode, sent.effects, sent.review], [{ is: "browse" }, [{ do: "reply", thread: said, body: "Because." }], EMPTY]);
  assert.deepEqual(step(replying, "confirm", { threads: [said], typed: " " }).effects, []);
  assert.equal(step(at(3), "edit", { threads: [thread({ canReply: false })] }).notice, "GitHub does not let you reply to this thread.");
  assert.equal(step(at(3), "edit", { threads: [said], sending: new Set(["T1"]) }).notice, "Still writing to this thread.");
  assert.equal(step(at(3), "delete", { threads: [said] }).notice, "x deletes an annotation of yours; z resolves a thread.");
});

test("a reply GitHub did not take is back in the field with its words and why", () => {
  const said = thread();
  const again = retryReply(at(3), said, "Because.", "HTTP 502");
  assert.deepEqual(again.mode, { is: "reply", thread: said, body: "Because.", failed: "HTTP 502" });
  assert.equal(typing(again), true);
});

test("z resolves the thread at the cursor, or opens a resolved one again, where GitHub lets the person", () => {
  const open = thread(), settled = thread({ resolved: true, canUnresolve: true });
  assert.deepEqual(step(at(3), "resolve", { threads: [open] }).effects, [{ do: "resolve", thread: open, to: true }]);
  assert.deepEqual(step(at(3), "resolve", { threads: [settled] }).effects, [{ do: "resolve", thread: settled, to: false }]);
  assert.equal(step(at(3), "resolve", { threads: [thread({ canResolve: false })] }).notice, "GitHub does not let you resolve this thread.");
  assert.equal(step(at(3), "resolve", { threads: [thread({ resolved: true })] }).notice, "GitHub does not let you open this thread.");
  assert.equal(step(at(3), "resolve", { threads: [open], sending: new Set(["T1"]) }).notice, "Still writing to this thread.");
  assert.deepEqual([step(at(5), "resolve", { threads: [open] }).notice, step(at(5), "forward", { threads: [open] }).notice], ["No thread on this line.", "No thread on this line."]);
});

test("f asks before a thread goes to the agent, and Enter sends the thread as GitHub has it then", () => {
  const said = thread();
  const asked = step(at(3), "forward", { threads: [said] }).reading;
  assert.deepEqual(asked.mode, asking({ what: "forward", thread: "T1" }));
  const longer = thread({ more: 1 });
  assert.deepEqual(step(asked, "confirm", { threads: [longer] }).effects, [{ do: "forward", thread: longer }]);
  const gone = step(asked, "confirm", { threads: [] });
  assert.deepEqual([gone.notice, gone.effects, gone.reading.mode], ["That thread is no longer on GitHub.", [], { is: "browse" }]);
  assert.equal(step(at(3), "forward", { threads: [said], agent: NO_AGENT }).notice, NO_AGENT.why);
  assert.equal(step(at(3), "forward", { threads: [said], sending: new Set(["forward"]) }).notice, "It is on its way.");
});

test("y asks before the review goes to the agent, when there is something to send and someone to send it to", () => {
  const review = reviewOf(["issue", on(2, 3), "Why 3?"]);
  const asked = step(at(0), "finish", { review }).reading;
  assert.deepEqual(asked.mode, asking({ what: "send" }));
  assert.deepEqual(step(asked, "confirm", { review }).effects, [{ do: "send" }]);
  assert.equal(step(at(0), "finish").notice, "Nothing to send yet: c, s or i notes the line.");
  assert.equal(step(at(0), "finish", { review: reviewOf(["question", on(1, 1), "Why?"]) }).notice, "Nothing to send: the questions went as they were asked.");
  assert.equal(step(at(0), "finish", { review, agent: NO_AGENT }).notice, NO_AGENT.why);
  assert.equal(step(at(0), "finish", { review, sending: new Set(["send"]) }).notice, "It is on its way.");
});

test("Y and A ask before the review goes to GitHub, and whether it may go is asked again at Enter", () => {
  for (const [action, event] of [["post", "COMMENT"], ["approve", "APPROVE"]]) {
    const asked = step(at(0), action).reading;
    assert.deepEqual(asked.mode, asking({ what: "post", event }));
    assert.deepEqual(step(asked, "confirm").effects, [{ do: "post", event }]);
    assert.deepEqual(step(at(0), action, { agent: NO_AGENT, sending: new Set(["post"]) }).reading.mode, asking({ what: "post", event }), "it goes to GitHub, whatever the tab's agent");
    const refuses = (e) => (e === event ? "Not until GitHub answers again." : null);
    assert.deepEqual([step(at(0), action, { blocked: refuses }).notice, step(at(0), action, { blocked: refuses }).reading.mode], ["Not until GitHub answers again.", { is: "browse" }]);
    const late = step(asked, "confirm", { blocked: refuses });
    assert.deepEqual([late.notice, late.effects, late.reading.mode], ["Not until GitHub answers again.", [], { is: "browse" }]);
  }
});

test("what Enter was asked to confirm is given up by any other key, and by Esc before anything else", () => {
  const asked = at(3, { anchor: 2, mode: asking({ what: "send" }) });
  assert.deepEqual(step(asked, "down").reading, at(4, { anchor: 2 }));
  assert.deepEqual(step(asked, "down").effects, []);
  assert.deepEqual(step(asked, "escape").reading, at(3, { anchor: 2 }));
  assert.deepEqual(after(asked, ["escape", "escape"]), at(3));
  assert.equal(after(asked, ["escape", "escape", "escape"]), null, "the third Esc leaves the diff");
  assert.deepEqual(step(at(3), "confirm").effects, [], "Enter with nothing asked does nothing");
  for (const action of ["window", "close"]) {
    const { reading, notice } = step(asked, action);
    assert.deepEqual([reading, notice], [at(3, { anchor: 2 }), null], `${action}, which the pane then runs`);
  }
});

test("an approval and the Enter that confirms one are given by key only; everything else may come as a command", () => {
  const refused = "An approval is given with its keys in the pane.";
  const approval = at(0, { mode: asking({ what: "post", event: "APPROVE" }) });
  const byCommand = step(at(0), "approve", { command: true });
  assert.deepEqual([byCommand.notice, byCommand.reading.mode, byCommand.effects], [refused, { is: "browse" }, []]);
  const confirmed = step(approval, "confirm", { command: true });
  assert.deepEqual([confirmed.notice, confirmed.reading.mode, confirmed.effects], [refused, { is: "browse" }, []]);
  assert.deepEqual(step(at(0, { mode: asking({ what: "post", event: "COMMENT" }) }), "confirm", { command: true }).effects, [{ do: "post", event: "COMMENT" }]);
  const drafting = step(at(3), "issue").reading;
  assert.deepEqual(step(drafting, "approve", { command: true }).reading, drafting, "the field stays open");
  for (const action of new Set(Object.values(READ_KEYS))) {
    if (action !== "approve") assert.notEqual(step(approval, action === "confirm" ? "down" : action, { command: true }).notice, refused, action);
  }
});

test("l and h step through the annotations and threads in order, around the ends, into other files that have a diff", () => {
  const review = reviewOf(["issue", on(4, 4), "late"], ["comment", null, "overall"], ["comment", on(1, 1, "src/b.js"), "b"], ["comment", on(1, 1, "bin.png"), "no diff"]);
  const threads = [thread()];
  const paths = ["src/a.js", "src/b.js", "bin.png"];
  const walk = (from, action) => step(from, action, { review, threads, paths });
  const first = walk(at(6, { anchor: 5 }), "next");
  assert.deepEqual([first.reading, first.reveal], [at(6, { anchor: 5, activeId: "a2" }), false], "the whole pull request's has no row: the cursor stays");
  const second = walk(first.reading, "next");
  assert.deepEqual([second.reading, second.reveal], [at(3, { activeId: "T1" }), true]);
  assert.deepEqual(walk(second.reading, "next").reading, at(4, { activeId: "a1" }));
  assert.deepEqual(walk(at(4, { activeId: "a1" }), "next").reading, { ...startReading("src/b.js", 1), activeId: "a3" });
  const shut = walk({ ...startReading("src/b.js", 1), activeId: "a3" }, "next");
  assert.deepEqual([shut.notice, shut.reading.activeId, shut.reading.path], ["bin.png has no diff here to show it in.", "a4", "src/b.js"]);
  assert.equal(walk(shut.reading, "next").reading.activeId, "a2", "past the last is the first");
  assert.equal(walk(at(0), "previous").reading.activeId, "a4", "before the first is the last");
  assert.equal(step(at(0), "next").notice, "No annotations or threads yet.");
});

test("n and p read the next and the previous file that has a diff, from its top, and stop at the ends", () => {
  const files = { paths: ["bin.png", "src/a.js", "pic.png", "src/b.js", "end.png"], readable: ["src/a.js", "src/b.js"] };
  assert.deepEqual(step(at(4, { anchor: 2, activeId: "a1" }), "next-file", files).reading, startReading("src/b.js"));
  assert.deepEqual(step(startReading("src/b.js", 2), "previous-file", files).reading, startReading("src/a.js"));
  const last = step({ ...startReading("src/b.js", 2), activeId: "a1" }, "next-file", files);
  assert.deepEqual([last.notice, last.reading], ["This is the last file.", startReading("src/b.js", 2)]);
  assert.equal(step(at(4), "previous-file", files).notice, "This is the first file.");
});

test("synthetic: a cursor and a range past the end of a diff that got shorter are brought back onto it", () => {
  assert.deepEqual(step(at(40, { anchor: 50 }), "comment").reading.mode.draft.target, on(6, 6));
  assert.equal(step(at(40), "up").reading.cursor, 5);
});

test("a click on a line puts the cursor there, with Shift as the end of a range; on an annotation or a thread it picks that", () => {
  const line = (index) => ({ type: "line", row: rows[index], index, mark: null });
  assert.deepEqual(readClick(null, "src/a.js", line(4), false), at(4));
  assert.deepEqual(readClick(null, "src/a.js", line(4), true), at(4), "Shift with no cursor before it starts no range");
  assert.deepEqual(readClick(at(2, { activeId: "a1" }), "src/a.js", line(4), false), at(4));
  assert.deepEqual(readClick(at(2), "src/a.js", line(4), true), at(4, { anchor: 2 }));
  assert.deepEqual(readClick(at(4, { anchor: 2 }), "src/a.js", line(6), true), at(6, { anchor: 2 }));
  const [annotation] = reviewOf(["issue", on(2, 3), "Why 3?"]).annotations;
  assert.deepEqual(readClick(at(5, { anchor: 4 }), "src/a.js", { type: "annotation", annotation, moved: false }, false), at(5, { anchor: 4, activeId: "a1" }));
  assert.deepEqual(readClick(null, "src/a.js", { type: "thread", thread: thread(), placed: true }, false), at(0, { activeId: "T1" }));
  const drafting = step(at(3), "issue").reading;
  assert.deepEqual(readClick(drafting, "src/a.js", line(5), false), { ...at(5), mode: drafting.mode }, "an open field stays open");
  assert.deepEqual(readClick(drafting, "src/a.js", { type: "annotation", annotation, moved: false }, false), { ...drafting, activeId: "a1" }, "on an annotation too");
  assert.deepEqual(readClick(at(3, { mode: asking({ what: "send" }) }), "src/a.js", { type: "annotation", annotation, moved: false }, false), at(3, { activeId: "a1" }));
  assert.deepEqual(readClick(at(3, { mode: asking({ what: "send" }) }), "src/a.js", line(5), false), at(5), "a click gives up what Enter was asked");
});
