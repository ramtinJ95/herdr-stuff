/**
 * The keyboard in a file's diff: where it is, what it is in the middle of, and what each key makes of that. Nothing
 * here touches the pane: a step answers with the reading after it and with what is to leave the pane, which the pane runs.
 */
import { KINDS, activeNote, dropAnnotation, itemId, saveDraft, spotOf, stops, toSend } from "./review.js";

/** @typedef {import("./diff.js").DiffRow} DiffRow */
/** @typedef {import("./github.js").Thread} Thread */
/** @typedef {import("./review.js").Review} Review */
/** @typedef {import("./review.js").Annotation} Annotation */
/** @typedef {import("./review.js").Item} Item */
/**
 * What Enter is asked to confirm: the review to the tab's agent, the review to GitHub with its verdict, or one of
 * GitHub's threads to the agent.
 * @typedef {{ what: "send" } | { what: "post", event: "COMMENT" | "APPROVE" } | { what: "forward", thread: string }} Asking
 */
/**
 * What the keyboard is in the middle of. A `draft` or a `reply` has the field open, which starts with `body`; `failed`
 * is why a reply's last try did not go.
 * @typedef {{ is: "browse" } | { is: "draft", draft: import("./review.js").Draft, body: string }
 *   | { is: "reply", thread: Thread, body: string, failed: string | null } | { is: "asking", asking: Asking }} Mode
 */
/**
 * `cursor` and `anchor` are rows of the diff of the file at `path`; `anchor` is the other end of a range. `activeId` is
 * the annotation or thread stepped to or clicked.
 * @typedef {{ path: string, cursor: number, anchor: number | null, activeId: string | null, mode: Mode }} Reading
 */
/**
 * What a step goes by. `rowsOf` gives a file's diff rows by its path; `paths`
 * are the files in GitHub's order and `readable` those of them the list shows that have a diff; `page` is half the
 * lines on screen. `blocked` says why a review cannot be posted on GitHub, or null. `sending` holds what is on its way.
 * `typed` is the field's text. `command` is whether the step was asked for from outside the pane.
 * @typedef {{ rowsOf: (path: string) => DiffRow[], head: string, review: Review, threads: Thread[], paths: string[],
 *   readable: string[], page: number, agent: { terminal: string | null, name: string, why?: string },
 *   blocked: (event: "COMMENT" | "APPROVE") => string | null, sending: Set<string>, typed: string, command: boolean }} Facts
 */
/**
 * What is to leave the pane after a step.
 * @typedef {{ do: "ask", question: Annotation } | { do: "send" } | { do: "post", event: "COMMENT" | "APPROVE" }
 *   | { do: "forward", thread: Thread } | { do: "resolve", thread: Thread, to: boolean } | { do: "reply", thread: Thread, body: string }} Effect
 */
/**
 * A step's answer. `reading` null is the keyboard back in the list. `notice` is the line under the diff: a string or
 * null sets it, undefined leaves it. `reveal` asks for the cursor's row on screen.
 * @typedef {{ reading: Reading | null, review: Review, notice?: string | null, reveal: boolean, effects: Effect[] }} Step
 */

/** What a key does while the keyboard is in a diff. */
export const READ_KEYS = {
  j: "down", down: "down", k: "up", up: "up", d: "half-down", u: "half-up", g: "first", b: "last", "shift-g": "last", v: "range",
  c: "comment", s: "suggestion", i: "issue", a: "question", o: "overall", h: "previous", l: "next", r: "edit", x: "delete", y: "finish",
  "shift-y": "post", "shift-a": "approve", z: "resolve", f: "forward",
  enter: "confirm", n: "next-file", p: "previous-file", w: "window", escape: "escape", q: "close",
};
const MOVES = { down: () => 1, up: () => -1, "half-down": (page) => page, "half-up": (page) => -page, first: () => -Infinity, last: () => Infinity };

export const isMove = (action) => action in MOVES;

/** @type {Mode} */
const BROWSE = { is: "browse" };

/** The keyboard as it enters the diff of the file at `path`. @returns {Reading} */
export const startReading = (path, cursor = 0, anchor = null) => ({ path, cursor, anchor, activeId: null, mode: BROWSE });

/** The rows a cursor and the other end of its range cover. */
export const stretch = (cursor, anchor) => ({ start: Math.min(cursor, anchor ?? cursor), end: Math.max(cursor, anchor ?? cursor) });

/** Whether the field is open. @param {Reading | null} reading */
export const typing = (reading) => reading !== null && (reading.mode.is === "draft" || reading.mode.is === "reply");

/**
 * Whether an action is given with its key in the pane and never by a command from outside it: an approval, and the
 * Enter that confirms one. Like Merge, it is somebody looking at the pane who gives it.
 * @param {Reading} reading
 */
const keyOnly = (action, reading) =>
  action === "approve" || (action === "confirm" && reading.mode.is === "asking" && reading.mode.asking.what === "post" && reading.mode.asking.event === "APPROVE");

const moveCursor = (action, cursor, count, page) => Math.max(0, Math.min(count - 1, cursor + MOVES[action](Math.max(1, page))));

/** The stop after or before the active one, around the ends. `ordered` is not empty. */
function around(ordered, activeId, delta) {
  const index = ordered.findIndex((one) => one.id === activeId);
  const base = index < 0 ? (delta > 0 ? -1 : 0) : index;
  return ordered[(base + delta + ordered.length) % ordered.length];
}

/** Enter in the field: an annotation is kept, and a question goes to the agent at once; a reply goes to GitHub at once. @returns {Step} */
function submit(reading, { review, typed }) {
  const { mode } = reading;
  const closed = { ...reading, mode: BROWSE };
  if (mode.is === "reply") {
    const body = typed.trim();
    return { reading: closed, review, reveal: false, effects: body === "" ? [] : [{ do: "reply", thread: mode.thread, body }] };
  }
  const { review: kept, saved } = saveDraft(review, mode.draft, typed);
  if (saved === null) return { reading: closed, review, reveal: false, effects: [] };
  return { reading: { ...closed, anchor: null, activeId: saved.id }, review: kept, reveal: false, effects: saved.kind === "question" ? [{ do: "ask", question: saved }] : [] };
}

/** `y`, `Y`, `A` and `f`: why Enter cannot be asked to send what they name, or null when it can. @param {Asking} asking @param {Facts} facts */
function refused(asking, { review, agent, blocked, sending }) {
  if (asking.what === "post") return blocked(asking.event);
  if (asking.what === "send" && toSend(review.annotations).length === 0) {
    return review.annotations.length === 0 ? "Nothing to send yet: c, s or i notes the line." : "Nothing to send: the questions went as they were asked.";
  }
  if (agent.terminal === null) return agent.why;
  return sending.has(asking.what) ? "It is on its way." : null;
}

/**
 * What an action makes of a reading. While the field is open only Enter and Esc act; any other action first gives up
 * what Enter was asked to confirm.
 * @param {Reading} reading @param {string} action one of READ_KEYS' @param {Facts} facts
 * @returns {Step}
 */
export function readStep(reading, action, facts) {
  const { head, review, threads, sending } = facts;
  const rows = facts.rowsOf(reading.path);
  if (facts.command && keyOnly(action, reading)) {
    return { reading: { ...reading, mode: typing(reading) ? reading.mode : BROWSE }, review, notice: "An approval is given with its keys in the pane.", reveal: false, effects: [] };
  }
  if (typing(reading)) {
    if (action === "confirm") return submit(reading, facts);
    return { reading: action === "escape" ? { ...reading, mode: BROWSE } : reading, review, reveal: false, effects: [] };
  }
  const asked = reading.mode.is === "asking" ? reading.mode.asking : null;
  // The diff under the cursor may have got shorter: the pull request can move while it is read.
  const last = rows.length - 1;
  const at = { ...reading, cursor: Math.min(reading.cursor, last), anchor: reading.anchor === null ? null : Math.min(reading.anchor, last), mode: BROWSE };
  /** @returns {Step} */
  const to = (next, more = {}) => ({ reading: next, review, notice: null, reveal: false, effects: [], ...more });
  const say = (notice, next = at) => to(next, { notice });
  const ask = (asking) => {
    const why = refused(asking, facts);
    return why === null ? to({ ...at, mode: { is: "asking", asking } }) : say(why);
  };
  const noted = () => activeNote(review.annotations, threads, at.activeId, at.path, head, rows, at.cursor);
  const busy = (thread) => (sending.has(thread.id) ? "Still writing to this thread." : null);

  if (isMove(action)) return to({ ...at, cursor: moveCursor(action, at.cursor, rows.length, facts.page), activeId: null }, { reveal: true });
  if (action === "range") return to({ ...at, anchor: at.anchor === null ? at.cursor : null });
  if (action in KINDS) {
    const { start, end } = stretch(at.cursor, at.anchor);
    return to({ ...at, mode: { is: "draft", draft: { kind: action, target: spotOf(at.path, head, rows, start, end), editingId: null }, body: "" } });
  }
  if (action === "overall") return to({ ...at, mode: { is: "draft", draft: { kind: "comment", target: null, editingId: null }, body: "" } });
  if (action === "next" || action === "previous") {
    const ordered = stops(review.annotations, threads, facts.paths, head, facts.rowsOf);
    if (ordered.length === 0) return say("No annotations or threads yet.");
    const { id, path, row } = around(ordered, at.activeId, action === "next" ? 1 : -1);
    const stepped = { ...at, activeId: id };
    if (path === null) return to(stepped);
    if (path === at.path) return to({ ...stepped, cursor: Math.min(row, last), anchor: null }, { reveal: true });
    return facts.readable.includes(path) ? to({ ...startReading(path, row), activeId: id }) : say(`${path} has no diff here to show it in.`, stepped);
  }
  if (action === "edit" || action === "delete") {
    const { annotation: one, thread } = noted();
    if (thread !== null && action === "delete") return say("x deletes an annotation of yours; z resolves a thread.");
    if (thread !== null) {
      const why = thread.canReply ? busy(thread) : "GitHub does not let you reply to this thread.";
      return why === null ? to({ ...at, mode: { is: "reply", thread, body: "", failed: null } }) : say(why);
    }
    if (one === null) return say("No annotation or thread on this line.");
    if (action === "edit") return to({ ...at, mode: { is: "draft", draft: { kind: one.kind, target: one.target, editingId: one.id }, body: one.body } });
    return to({ ...at, activeId: null }, { review: dropAnnotation(review, one.id) });
  }
  if (action === "resolve" || action === "forward") {
    const { thread } = noted();
    if (thread === null) return say("No thread on this line.");
    if (action === "forward") return ask({ what: "forward", thread: thread.id });
    const resolved = !thread.resolved;
    const why = (resolved ? thread.canResolve : thread.canUnresolve) ? busy(thread) : `GitHub does not let you ${resolved ? "resolve" : "open"} this thread.`;
    return why === null ? to(at, { effects: [{ do: "resolve", thread, to: resolved }] }) : say(why);
  }
  if (action === "finish") return ask({ what: "send" });
  if (action === "post" || action === "approve") return ask({ what: "post", event: action === "post" ? "COMMENT" : "APPROVE" });
  if (action === "confirm" && asked !== null) {
    if (asked.what === "send") return to(at, { effects: [{ do: "send" }] });
    if (asked.what === "forward") {
      const thread = threads.find((one) => one.id === asked.thread);
      return thread === undefined ? say("That thread is no longer on GitHub.") : to(at, { effects: [{ do: "forward", thread }] });
    }
    // Whether it may go is asked again here: Enter can come long after the key.
    const why = facts.blocked(asked.event);
    return why === null ? to(at, { effects: [{ do: "post", event: asked.event }] }) : say(why);
  }
  if (action === "next-file" || action === "previous-file") {
    const next = facts.readable[facts.readable.indexOf(at.path) + (action === "next-file" ? 1 : -1)];
    return next === undefined ? say(action === "next-file" ? "This is the last file." : "This is the first file.", { ...at, activeId: null }) : to(startReading(next));
  }
  if (action === "escape" && asked === null) {
    return to(at.anchor === null ? null : { ...at, anchor: null });
  }
  return to(at);
}

/**
 * A click in a diff. On a line it puts the cursor there, and with Shift held makes it the end of a range from where
 * the cursor was; on an annotation or a thread it makes that the one the keys act on. An open field stays open.
 * @param {Reading | null} reading the keyboard's place in this file's diff, null when it is not in it
 * @param {Item} item what was clicked
 * @returns {Reading}
 */
export function readClick(reading, path, item, shift) {
  const mode = typing(reading) ? reading.mode : BROWSE;
  if (item.type !== "line") return { ...(reading ?? startReading(path)), activeId: itemId(item), mode };
  return { ...startReading(path, item.index, shift && reading !== null ? reading.anchor ?? reading.cursor : null), mode };
}

/** The field open again on a reply GitHub did not take, with the words and why. @param {Reading} reading @returns {Reading} */
export const retryReply = (reading, thread, body, failed) => ({ ...reading, mode: { is: "reply", thread, body, failed } });
