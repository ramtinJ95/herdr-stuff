/**
 * What a person notes on a pull request's diff while reading it, and what the tab's agent is sent of it. The notes and
 * their words are those of the review-pane mod for Claude Code, which keeps them on a response; here they are on a diff.
 * GitHub's own review threads stand among the same lines, and the notes can be posted there as a review.
 */
import { isLine, lastLine } from "./diff.js";
import { byName, shortSha } from "./github.js";
import { plural } from "./model.js";

/** @typedef {import("./diff.js").DiffRow} DiffRow */
/** @typedef {import("./github.js").Thread} Thread */
/** @typedef {"issue" | "suggestion" | "question" | "comment"} Kind */
/**
 * Where an annotation points: a stretch of one file's diff rows as they were at commit `head`, with the words for the
 * stretch and the lines themselves, so it still reads after the pull request has moved on.
 * @typedef {{ path: string, head: string, start: number, end: number, where: string, quote: string[] }} Target
 */
/**
 * `target` null is the pull request as a whole. `ask` says how sending a question went; a question without one was not sent.
 * @typedef {{ id: string, kind: Kind, target: Target | null, body: string, ask?: "sent" | { failed: string } }} Annotation
 */
/** @typedef {{ annotations: Annotation[], nextId: number }} Review */
/** An annotation being typed: a new one, or `editingId`'s. @typedef {{ kind: Kind, target: Target | null, editingId: string | null }} Draft */
/** One line comment of a review, as GitHub takes it. @typedef {{ path: string, startLine?: number, startSide?: "LEFT" | "RIGHT", line: number, side: "LEFT" | "RIGHT", body: string }} LineComment */
/** A review as GitHub takes it. @typedef {{ commit: string, event: "COMMENT" | "APPROVE", body: string, comments: LineComment[] }} Posting */
/** The pull request, as the agent is told of it. @typedef {{ ref: string, title: string, url: string, head: string }} Subject */

/** How each kind is named and marked, in the order the gutter prefers one mark over another. */
export const KINDS = /** @type {const} */ ({
  issue: { label: "Issue", glyph: "!" },
  suggestion: { label: "Suggestion", glyph: "+" },
  question: { label: "Question", glyph: "?" },
  comment: { label: "Comment", glyph: "•" },
});
const ORDER = Object.keys(KINDS);

/** @type {Review} */
export const EMPTY = { annotations: [], nextId: 1 };

/** What a key does while the keyboard is in a diff. */
export const REVIEW_KEYS = {
  j: "down", down: "down", k: "up", up: "up", d: "half-down", u: "half-up", g: "first", b: "last", "shift-g": "last", v: "range",
  c: "comment", s: "suggestion", i: "issue", a: "question", o: "overall", h: "previous", l: "next", r: "edit", x: "delete", y: "finish",
  "shift-y": "post", "shift-a": "approve", z: "resolve", f: "forward",
  enter: "confirm", n: "next-file", p: "previous-file", w: "window", escape: "escape", q: "close",
};
const MOVES = { down: () => 1, up: () => -1, "half-down": (page) => page, "half-up": (page) => -page, first: () => -Infinity, last: () => Infinity };

export const isMove = (action) => action in MOVES;

/**
 * Whether an action is given with its key in the pane and never by a command from outside it: an approval, and the
 * Enter that confirms one. Like Merge, it is somebody looking at the pane who gives it.
 * @param {string} action @param {{ what: string, event?: string } | null} asking what Enter has been asked to confirm
 */
export const keyOnly = (action, asking) => action === "approve" || (action === "confirm" && asking?.what === "post" && asking.event === "APPROVE");

/** The row a move leaves the cursor on. `page` is half of what is on screen. */
export const moveCursor = (action, cursor, count, page) => Math.max(0, Math.min(count - 1, cursor + MOVES[action](Math.max(1, page))));

/** The rows a cursor and the other end of its range cover. */
export const stretch = (cursor, anchor) => ({ start: Math.min(cursor, anchor ?? cursor), end: Math.max(cursor, anchor ?? cursor) });

const span = (first, last) => (first === last ? `line ${first}` : `lines ${first}-${last}`);
const numbers = (rows, side) => rows.map((row) => row[side]).filter((n) => typeof n === "number");

/** A stretch of rows in words: its lines in the file as it is now, or for removed lines alone where they were. @param {DiffRow[]} rows */
export function whereOf(rows, start, end) {
  const picked = rows.slice(start, end + 1);
  const now = numbers(picked, "new");
  if (now.length > 0) return span(now[0], now.at(-1));
  const was = numbers(picked, "old");
  return was.length > 0 ? `${span(was[0], was.at(-1))} before the change` : "hunk header";
}

const PREFIX = { add: "+", del: "-", same: " ", hunk: "", note: "\\ " };
/** A stretch of rows as a diff writes them. @param {DiffRow[]} rows */
const quoted = (rows, start, end) => rows.slice(start, end + 1).map((row) => PREFIX[row.kind] + row.text);

/** @param {DiffRow[]} rows @returns {Target} */
export function targetOf(path, head, rows, start, end) {
  return { path, head, start, end, where: whereOf(rows, start, end), quote: quoted(rows, start, end) };
}

/**
 * The review with the draft saved under `body`: an empty body saves nothing. An edit replaces the annotation and drops
 * how sending the earlier words went.
 * @param {Review} review @param {Draft} draft @returns {{ review: Review, saved: Annotation | null }}
 */
export function saveDraft(review, { kind, target, editingId }, body) {
  if (body.trim() === "") return { review, saved: null };
  const saved = { id: editingId ?? `a${review.nextId}`, kind, target, body: body.trim() };
  if (editingId !== null) return { review: { ...review, annotations: review.annotations.map((one) => (one.id === editingId ? saved : one)) }, saved };
  return { review: { annotations: [...review.annotations, saved], nextId: review.nextId + 1 }, saved };
}

/** @param {Review} review @returns {Review} */
export const dropAnnotation = (review, id) => ({ ...review, annotations: review.annotations.filter((one) => one.id !== id) });

/** @param {Review} review @param {Annotation["ask"]} ask @returns {Review} */
export const markAsked = (review, id, ask) => ({ ...review, annotations: review.annotations.map((one) => (one.id === id ? { ...one, ask } : one)) });

/** Where a file stands among `paths`: the whole pull request (a null path) before them all, a file not among them after. */
const fileRank = (paths, path) => (path === null ? -1 : paths.includes(path) ? paths.indexOf(path) : paths.length);

/**
 * The whole pull request's first, then by file in the order of `paths`, then by place. The sort is stable: ties keep
 * the order they were made in.
 * @param {Annotation[]} annotations @param {string[]} paths @returns {Annotation[]}
 */
export function sortAnnotations(annotations, paths) {
  const file = (one) => fileRank(paths, one.target?.path ?? null);
  return [...annotations].sort((left, right) => file(left) - file(right)
    || (left.target === null || right.target === null ? 0 : left.target.start - right.target.start || left.target.end - right.target.end));
}

/** The annotation after or before the active one, around the ends. `ordered` is not empty. @param {Annotation[]} ordered */
export function stepAnnotation(ordered, activeId, delta) {
  const index = ordered.findIndex((one) => one.id === activeId);
  const base = index < 0 ? (delta > 0 ? -1 : 0) : index;
  return ordered[(base + delta + ordered.length) % ordered.length];
}

const rowAt = (rows, side, line) => rows.findIndex((row) => isLine(row) && row[side === "LEFT" ? "old" : "new"] === line);

/**
 * The rows of a file's diff a GitHub thread is on, the last being the line it stands under; null when the diff does not
 * have that line: the thread is outdated, is on the file as a whole, or its line is outside what the diff shows.
 * @param {DiffRow[]} rows @param {Thread} thread @returns {{ start: number, end: number } | null}
 */
export function threadStretch(rows, thread) {
  const end = thread.line === null ? -1 : rowAt(rows, thread.side, thread.line);
  if (end < 0) return null;
  const first = thread.startLine === null ? -1 : rowAt(rows, thread.startSide ?? thread.side, thread.startLine);
  return { start: first >= 0 && first < end ? first : end, end };
}

/** Where a thread is, in words. `placed` is whether the diff has its line. @param {Thread} thread */
export function threadWhere(thread, placed) {
  if (thread.line === null) {
    if (!thread.outdated) return "the file as a whole";
    return thread.was === null ? "lines that have changed since" : `line ${thread.was} when it was written, changed since`;
  }
  return `${span(thread.startLine ?? thread.line, thread.line)}${thread.side === "LEFT" ? " before the change" : ""}${placed ? "" : ", outside the diff shown"}`;
}

/**
 * @typedef {{ type: "line", row: DiffRow, index: number, mark: Kind | "thread" | null }
 *   | { type: "annotation", annotation: Annotation, moved: boolean }
 *   | { type: "thread", thread: Thread, placed: boolean }} Item
 */

/**
 * A file's diff with what is noted on it among the lines: each annotation under the last line it covers, and each of
 * GitHub's `threads` under its line. Above them all stand the annotations written at another commit, whose rows these
 * may no longer be, and the threads whose line the diff does not have. `at[i]` is where row `i` stands in `items`.
 * @param {DiffRow[]} rows @param {Annotation[]} annotations @param {Thread[]} [threads]
 * @returns {{ items: Item[], at: number[] }}
 */
export function annotatedRows(rows, annotations, path, head, threads = []) {
  const mine = annotations.filter((one) => one.target?.path === path);
  const here = (one) => one.target.head === head && one.target.end < rows.length;
  const placed = sortAnnotations(mine.filter(here), [path]);
  const said = threads.filter((thread) => thread.path === path).map((thread) => ({ thread, on: threadStretch(rows, thread) }));
  /** @type {Item[]} */
  const items = [
    ...mine.filter((one) => !here(one)).map((annotation) => /** @type {Item} */ ({ type: "annotation", annotation, moved: true })),
    ...said.filter(({ on }) => on === null).map(({ thread }) => /** @type {Item} */ ({ type: "thread", thread, placed: false })),
  ];
  const at = [];
  rows.forEach((row, index) => {
    const over = placed.filter((one) => one.target.start <= index && one.target.end >= index).map((one) => one.kind);
    const talked = said.some(({ on }) => on !== null && on.start <= index && on.end >= index);
    at.push(items.length);
    items.push({ type: "line", row, index, mark: /** @type {Kind | undefined} */ (ORDER.find((kind) => over.includes(kind))) ?? (talked ? "thread" : null) });
    for (const annotation of placed) if (annotation.target.end === index) items.push({ type: "annotation", annotation, moved: false });
    for (const { thread, on } of said) if (on?.end === index) items.push({ type: "thread", thread, placed: true });
  });
  return { items, at };
}

/** The annotation a key acts on: the one stepped to, else the first on the cursor's row. @param {Annotation[]} annotations @returns {Annotation | null} */
function activeAnnotation(annotations, activeId, path, head, cursor) {
  return annotations.find((one) => one.id === activeId)
    ?? sortAnnotations(annotations.filter((one) => one.target?.path === path && one.target.head === head && one.target.start <= cursor && one.target.end >= cursor), [path])[0]
    ?? null;
}

/**
 * What a key acts on: the annotation or thread stepped to or clicked, else the first annotation on the cursor's row,
 * else the first thread on it. One of the two at most is set.
 * @param {Annotation[]} annotations @param {Thread[]} threads @param {DiffRow[]} rows the rows of the file at `path`
 * @returns {{ annotation: Annotation | null, thread: Thread | null }}
 */
export function activeNote(annotations, threads, activeId, path, head, rows, cursor) {
  const stepped = threads.find((thread) => thread.id === activeId);
  if (stepped !== undefined) return { annotation: null, thread: stepped };
  const annotation = activeAnnotation(annotations, activeId, path, head, cursor);
  if (annotation !== null) return { annotation, thread: null };
  const under = threads.find((thread) => {
    const on = thread.path === path ? threadStretch(rows, thread) : null;
    return on !== null && on.start <= cursor && on.end >= cursor;
  });
  return { annotation: null, thread: under ?? null };
}

/**
 * Where `h` and `l` stop: every annotation and every thread, the whole pull request's first, then by file in the order
 * of `paths` and by row. `row` is the diff row to put the cursor on, 0 for what has no row of its own. `rowsOf` gives a
 * file's diff rows by path, none for a file without a diff.
 * @param {Annotation[]} annotations @param {Thread[]} threads @param {string[]} paths @param {(path: string) => DiffRow[]} rowsOf
 * @returns {{ id: string, path: string | null, row: number }[]}
 */
export function stops(annotations, threads, paths, head, rowsOf) {
  const file = (path) => fileRank(paths, path);
  const noted = sortAnnotations(annotations, paths).map(({ id, target }) => ({ id, path: target?.path ?? null, row: target === null || target.head !== head ? 0 : target.start }));
  const said = threads.map((thread) => ({ id: thread.id, path: thread.path, row: threadStretch(rowsOf(thread.path), thread)?.end ?? 0 }));
  return [...noted, ...said].sort((left, right) => file(left.path) - file(right.path) || left.row - right.row);
}

/** How many annotations are on each file, by path. @param {Annotation[]} annotations @returns {Map<string, number>} */
export function countByPath(annotations) {
  const counts = new Map();
  for (const { target } of annotations) if (target !== null) counts.set(target.path, (counts.get(target.path) ?? 0) + 1);
  return counts;
}

/** The threads on each file in words, by path: those still open, else how many are resolved. @param {Thread[]} threads @returns {Map<string, { text: string, open: boolean }>} */
export function threadsByPath(threads) {
  const counts = new Map();
  for (const { path, resolved } of threads) {
    const one = counts.get(path) ?? { open: 0, resolved: 0 };
    counts.set(path, resolved ? { ...one, resolved: one.resolved + 1 } : { ...one, open: one.open + 1 });
  }
  return new Map([...counts].map(([path, { open, resolved }]) => [path, open > 0 ? { text: plural(open, "thread"), open: true } : { text: `${resolved} resolved`, open: false }]));
}

/** How sending a question stands, in words; null for what is not a question. `sending` holds the ids on their way. @param {Annotation} one @param {Set<string>} sending */
export function askWords(one, sending) {
  if (one.kind !== "question") return null;
  if (sending.has(one.id)) return "asking…";
  if (one.ask === undefined) return "not asked";
  return one.ask === "sent" ? "asked" : `not asked: ${one.ask.failed}`;
}

/** What `y` would send: everything but the questions, which went as they were asked. @param {Annotation[]} annotations */
export const toSend = (annotations) => annotations.filter((one) => one.kind !== "question");

function fence(lines) {
  const longest = Math.max(2, ...lines.map((line) => Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length))));
  const ticks = "`".repeat(longest + 1);
  return [`${ticks}diff`, ...lines, ticks];
}

const named = ({ ref, title, url }) => `pull request ${ref}, "${title}" (${url})`;

/** Where an annotation points, for the agent. Lines of an earlier commit are said to be. @param {Target | null} target */
function place(target, head) {
  if (target === null) return "The pull request as a whole";
  return `\`${target.path}\` ${target.where}${target.head === head ? "" : ` (as of commit ${shortSha(target.head)})`}`;
}

/**
 * The review the agent is sent: one numbered entry per annotation, each with the diff lines it is about. Empty when
 * there is nothing but questions.
 * @param {Subject} subject @param {Annotation[]} annotations @param {string[]} paths
 */
export function formatReview(subject, annotations, paths) {
  const ordered = sortAnnotations(toSend(annotations), paths);
  if (ordered.length === 0) return "";
  const output = [`I reviewed ${named(subject)} at commit ${shortSha(subject.head)}. Please address these annotations.`, ""];
  ordered.forEach((one, index) => {
    const marker = `${index + 1}. `;
    const indent = (line) => (line === "" ? "" : " ".repeat(marker.length) + line);
    output.push(`${marker}**[${KINDS[one.kind].label.toUpperCase()}]** ${place(one.target, subject.head)}`, "");
    if (one.target !== null) output.push(...fence(one.target.quote).map(indent), "");
    output.push(...one.body.split("\n").map(indent));
    if (index < ordered.length - 1) output.push("");
  });
  return output.join("\n");
}

/** A question as the agent is sent it, at once: where it points, the lines and the question. @param {Subject} subject @param {Annotation} question */
export function formatQuestion(subject, question) {
  return [
    `I am reading ${named(subject)} at commit ${shortSha(subject.head)} in a pane beside this terminal and have a question.`,
    "",
    `Location: ${place(question.target, subject.head)}`,
    ...question.target === null ? [] : ["", "The lines the question is about:", ...fence(question.target.quote)],
    "",
    `Question: ${question.body}`,
  ].join("\n");
}

/**
 * One of GitHub's threads as the agent is sent it: where it is, the lines it is on when the diff has them, and all that
 * was written in it.
 * @param {Subject} subject @param {Thread} thread @param {DiffRow[]} rows the rows of the thread's file
 */
export function formatThread(subject, thread, rows) {
  const on = threadStretch(rows, thread);
  const state = [thread.resolved ? "resolved" : null, thread.outdated ? "outdated" : null].filter((word) => word !== null);
  return [
    `I am reading ${named(subject)} at commit ${shortSha(subject.head)} in a pane beside this terminal. Please address this review thread on it.`,
    "",
    `Location: \`${thread.path}\` ${threadWhere(thread, on !== null)}${state.length === 0 ? "" : ` (${state.join(", ")})`}`,
    ...on === null ? [] : ["", "The lines it is on:", ...fence(quoted(rows, on.start, on.end))],
    "",
    `The thread${thread.comments.length === 0 ? "" : ` (${thread.comments[0].url})`}:`,
    ...thread.comments.flatMap((said) => ["", `${byName(said.who)} wrote:`, ...said.body.split("\n").map((text) => (text === "" ? ">" : `> ${text}`))]),
    ...thread.more === 0 ? [] : ["", `${plural(thread.more, "more comment")} on GitHub.`],
  ].join("\n");
}

/**
 * Where on GitHub a stretch of diff rows is: the line it ends on and the side that line is on, and for more lines than
 * one where it starts. GitHub takes a stretch within one hunk, so one that crosses hunks keeps the part in its last;
 * null when it covers no line at all, only a hunk's header.
 * @param {DiffRow[]} rows @returns {Omit<LineComment, "path" | "body"> | null}
 */
export function githubLines(rows, start, end) {
  const line = (row) => row !== undefined && isLine(row);
  let last = end;
  while (last >= start && !line(rows[last])) last--;
  if (last < start) return null;
  let first = last;
  while (first > start && line(rows[first - 1])) first--;
  const side = rows[last].kind === "del" ? "LEFT" : "RIGHT";
  // A stretch that ends on a removed line is on the old side throughout: an added line before it has no place there.
  if (side === "LEFT") while (rows[first].old === null) first++;
  const ends = side === "LEFT" ? rows[last].old : rows[last].new;
  if (first === last) return { line: ends, side };
  const startSide = side === "LEFT" || rows[first].kind === "del" ? "LEFT" : "RIGHT";
  return { startLine: startSide === "LEFT" ? rows[first].old : rows[first].new, startSide, line: ends, side };
}

/**
 * The annotations as a review for GitHub: one line comment each, on the lines it was written on. What has no line there
 * goes in the review's own words, with the lines quoted: a note on the whole pull request, one written at an earlier
 * commit, one on a hunk's header. Questions are left out, as they are from the review the agent is sent.
 * @param {Annotation[]} annotations @param {string[]} paths @param {(path: string) => DiffRow[]} rowsOf a file's diff rows at `head`
 * @param {Posting["event"]} event @returns {Posting}
 */
export function postingOf(annotations, paths, head, rowsOf, event) {
  const comments = [], loose = [];
  for (const one of sortAnnotations(toSend(annotations), paths)) {
    const { target } = one;
    const lines = target === null || target.head !== head ? null : githubLines(rowsOf(target.path), target.start, target.end);
    const label = KINDS[one.kind].label;
    if (lines !== null) comments.push({ path: target.path, ...lines, body: one.kind === "comment" ? one.body : `**${label}:** ${one.body}` });
    else if (target === null) loose.push(one.body);
    else loose.push([`**${label}** on ${place(target, head)}:`, "", ...fence(target.quote), "", one.body].join("\n"));
  }
  return { commit: head, event, body: loose.join("\n\n"), comments };
}

/**
 * Why a review cannot be posted on GitHub right now, or null when it can. An approval needs no annotations, but is
 * not GitHub's to take from the person who opened the pull request, nor on one that is no longer open.
 * @param {{ event: Posting["event"], count: number, live: boolean, busy: boolean, mine: boolean | null, state: string }} at
 *   `mine` is null until GitHub has said who opened it, which comes with the pull request's id, a review's address
 */
export function postBlock({ event, count, live, busy, mine, state }) {
  if (busy) return "A review is on its way to GitHub.";
  if (!live) return "Not until GitHub answers again.";
  if (mine === null) return "Still reading what is on GitHub: try again in a moment.";
  if (event === "COMMENT") return count === 0 ? "Nothing to post yet: c, s or i notes the line." : null;
  if (state !== "OPEN") return "It is no longer open: there is nothing to approve.";
  return mine ? "GitHub does not take your approval of your own pull request." : null;
}

/**
 * The terminal the tab's agent runs in, as `hc send` names it, with a name for people; or why there is none to send to.
 * The pane's own terminal comes first when it runs an agent. A shell is never sent to: it would run the words.
 * @param {import("herdr").PaneInfo[]} mine the tab's terminal panes
 * @returns {{ terminal: string, name: string } | { terminal: null, name: "the agent", why: string }}
 */
export function agentOf(mine, follow, machine) {
  const agents = mine.filter((p) => p.terminal !== null && (p.program?.agent === true || p.status !== null));
  const pane = agents.find((p) => p.pane === follow) ?? agents.find((p) => p.focused) ?? agents[0];
  if (pane === undefined) return { terminal: null, name: "the agent", why: "No agent in this tab to send it to." };
  return { terminal: machine === null ? pane.terminal : `${machine}/${pane.terminal}`, name: pane.name ?? pane.program?.name ?? pane.terminal };
}

/**
 * How an `hc send` went. Piped, hc says what went wrong as JSON on stderr; anything else it wrote is given as it is.
 * @param {{ code: number, stderr: string }} result @returns {"sent" | { failed: string }}
 */
export function sendResult({ code, stderr }) {
  if (code === 0) return "sent";
  try {
    return { failed: String(JSON.parse(stderr).error.message) };
  } catch {
    return { failed: lastLine(stderr) || `hc send exited with ${code}` };
  }
}
