/**
 * What a person notes on a pull request's diff while reading it. The notes and their words are those of the review-pane
 * mod for Claude Code, which keeps them on a response; here they are on a diff, and GitHub's own review threads stand
 * among the same lines.
 */
import { isLine } from "./diff.js";
import { plural } from "./text.js";

/** @typedef {import("./diff.js").DiffRow} DiffRow */
/** @typedef {import("./github.js").Thread} Thread */
/** @typedef {"issue" | "suggestion" | "question" | "comment"} Kind */
/**
 * Where an annotation points: a stretch of one file's diff rows as they were at commit `head`, with the words for the
 * stretch and the lines themselves, so it still reads after the pull request has moved on.
 * @typedef {{ path: string, head: string, start: number, end: number, where: string, quote: string[] }} Spot
 */
/**
 * `target` null is the pull request as a whole. `ask` says how sending a question went; a question without one was not sent.
 * @typedef {{ id: string, kind: Kind, target: Spot | null, body: string, ask?: "sent" | { failed: string } }} Annotation
 */
/** @typedef {{ annotations: Annotation[], nextId: number }} Review */
/** An annotation being typed: a new one, or `editingId`'s. @typedef {{ kind: Kind, target: Spot | null, editingId: string | null }} Draft */

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

/** What `y` would send: everything but the questions, which went as they were asked. @param {Annotation[]} annotations */
export const toSend = (annotations) => annotations.filter((one) => one.kind !== "question");

/**
 * What leaves the pane once a review has gone: what was sent, and the questions that were asked. A question not asked
 * yet, or whose asking failed, stays.
 * @param {Annotation[]} annotations
 */
export const goneWith = (annotations) => annotations.filter((one) => one.kind !== "question" || one.ask === "sent");

/**
 * Whether the rows an annotation was written on are these rows: it was written at this commit, and the diff still has
 * them. One that is not stands above the file's first line, is not under the cursor, and is posted with its lines quoted.
 * @param {Spot} target @param {DiffRow[]} rows the rows of the target's file at `head`
 */
export const placedOn = (target, head, rows) => target.head === head && target.end < rows.length;

const span = (first, last) => (first === last ? `line ${first}` : `lines ${first}-${last}`);
const numbers = (rows, side) => rows.map((row) => row[side]).filter((n) => typeof n === "number");

/** A stretch of rows in words: its lines in the file as it is now, or for removed lines alone where they were. @param {DiffRow[]} rows */
function whereOf(rows, start, end) {
  const picked = rows.slice(start, end + 1);
  const now = numbers(picked, "new");
  if (now.length > 0) return span(now[0], now.at(-1));
  const was = numbers(picked, "old");
  return was.length > 0 ? `${span(was[0], was.at(-1))} before the change` : "hunk header";
}

const PREFIX = { add: "+", del: "-", same: " ", hunk: "", note: "\\ " };
/** A stretch of rows as a diff writes them. @param {DiffRow[]} rows */
export const quoted = (rows, start, end) => rows.slice(start, end + 1).map((row) => PREFIX[row.kind] + row.text);

/** @param {DiffRow[]} rows @returns {Spot} */
export function spotOf(path, head, rows, start, end) {
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

/** How a thread stands, in words; none for one that is open on lines as they are. @param {Thread} thread */
export const threadState = (thread) => [...thread.resolved ? ["resolved"] : [], ...thread.outdated ? ["outdated"] : []];

/**
 * @typedef {{ type: "line", row: DiffRow, index: number, mark: Kind | "thread" | null }
 *   | { type: "annotation", annotation: Annotation, moved: boolean }
 *   | { type: "thread", thread: Thread, placed: boolean }} Item
 */

/** The id of the annotation or thread an item is. @param {Exclude<Item, { type: "line" }>} item */
export const itemId = (item) => (item.type === "thread" ? item.thread.id : item.annotation.id);

/**
 * A file's diff with what is noted on it among the lines: each annotation under the last line it covers, and each of
 * GitHub's `threads` under its line. Above them all stand the annotations written at another commit, whose rows these
 * may no longer be, and the threads whose line the diff does not have. `at[i]` is where row `i` stands in `items`.
 * @param {DiffRow[]} rows @param {Annotation[]} annotations @param {Thread[]} [threads]
 * @returns {{ items: Item[], at: number[] }}
 */
export function annotatedRows(rows, annotations, path, head, threads = []) {
  const mine = annotations.filter((one) => one.target?.path === path);
  const here = (one) => placedOn(one.target, head, rows);
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
function activeAnnotation(annotations, activeId, path, head, rows, cursor) {
  const under = (one) => one.target?.path === path && placedOn(one.target, head, rows) && one.target.start <= cursor && one.target.end >= cursor;
  return annotations.find((one) => one.id === activeId) ?? sortAnnotations(annotations.filter(under), [path])[0] ?? null;
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
  const annotation = activeAnnotation(annotations, activeId, path, head, rows, cursor);
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
  const noted = sortAnnotations(annotations, paths).map(({ id, target }) => ({ id, path: target?.path ?? null, row: target !== null && placedOn(target, head, rowsOf(target.path)) ? target.start : 0 }));
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
