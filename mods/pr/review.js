/**
 * What a person notes on a pull request's diff while reading it, and what the tab's agent is sent of it. The notes and
 * their words are those of the review-pane mod for Claude Code, which keeps them on a response; here they are on a diff.
 */

/** @typedef {import("./diff.js").DiffRow} DiffRow */
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
  enter: "confirm", n: "next-file", p: "previous-file", w: "window", escape: "escape", q: "close",
};
const MOVES = { down: () => 1, up: () => -1, "half-down": (page) => page, "half-up": (page) => -page, first: () => -Infinity, last: () => Infinity };

export const isMove = (action) => action in MOVES;

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

/** @param {DiffRow[]} rows @returns {Target} */
export function targetOf(path, head, rows, start, end) {
  return { path, head, start, end, where: whereOf(rows, start, end), quote: rows.slice(start, end + 1).map((row) => PREFIX[row.kind] + row.text) };
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

/**
 * The whole pull request's first, then by file in the order of `paths`, then by place. The sort is stable: ties keep
 * the order they were made in.
 * @param {Annotation[]} annotations @param {string[]} paths @returns {Annotation[]}
 */
export function sortAnnotations(annotations, paths) {
  const file = (one) => (one.target === null ? -1 : paths.includes(one.target.path) ? paths.indexOf(one.target.path) : paths.length);
  return [...annotations].sort((left, right) => file(left) - file(right)
    || (left.target === null || right.target === null ? 0 : left.target.start - right.target.start || left.target.end - right.target.end));
}

/** The annotation after or before the active one, around the ends. `ordered` is not empty. @param {Annotation[]} ordered */
export function stepAnnotation(ordered, activeId, delta) {
  const index = ordered.findIndex((one) => one.id === activeId);
  const base = index < 0 ? (delta > 0 ? -1 : 0) : index;
  return ordered[(base + delta + ordered.length) % ordered.length];
}

/**
 * @typedef {{ type: "line", row: DiffRow, index: number, mark: Kind | null }
 *   | { type: "annotation", annotation: Annotation, moved: boolean }} Item
 */

/**
 * A file's diff with its annotations among the lines: each under the last line it covers, and above them all those
 * written at another commit, whose rows these may no longer be. `at[i]` is where row `i` stands in `items`.
 * @param {DiffRow[]} rows @param {Annotation[]} annotations
 * @returns {{ items: Item[], at: number[] }}
 */
export function annotatedRows(rows, annotations, path, head) {
  const mine = annotations.filter((one) => one.target?.path === path);
  const here = (one) => one.target.head === head && one.target.end < rows.length;
  const placed = sortAnnotations(mine.filter(here), [path]);
  /** @type {Item[]} */
  const items = mine.filter((one) => !here(one)).map((annotation) => ({ type: "annotation", annotation, moved: true }));
  const at = [];
  rows.forEach((row, index) => {
    const over = placed.filter((one) => one.target.start <= index && one.target.end >= index).map((one) => one.kind);
    at.push(items.length);
    items.push({ type: "line", row, index, mark: /** @type {Kind | undefined} */ (ORDER.find((kind) => over.includes(kind))) ?? null });
    for (const annotation of placed) if (annotation.target.end === index) items.push({ type: "annotation", annotation, moved: false });
  });
  return { items, at };
}

/** The annotation a key acts on: the one stepped to, else the first on the cursor's row. @param {Annotation[]} annotations @returns {Annotation | null} */
export function activeAnnotation(annotations, activeId, path, head, cursor) {
  return annotations.find((one) => one.id === activeId)
    ?? sortAnnotations(annotations.filter((one) => one.target?.path === path && one.target.head === head && one.target.start <= cursor && one.target.end >= cursor), [path])[0]
    ?? null;
}

/** How many annotations are on each file, by path. @param {Annotation[]} annotations @returns {Map<string, number>} */
export function countByPath(annotations) {
  const counts = new Map();
  for (const { target } of annotations) if (target !== null) counts.set(target.path, (counts.get(target.path) ?? 0) + 1);
  return counts;
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
const short = (sha) => sha.slice(0, 7);

/** Where an annotation points, for the agent. Lines of an earlier commit are said to be. @param {Target | null} target */
function place(target, head) {
  if (target === null) return "The pull request as a whole";
  return `\`${target.path}\` ${target.where}${target.head === head ? "" : ` (as of commit ${short(target.head)})`}`;
}

/**
 * The review the agent is sent: one numbered entry per annotation, each with the diff lines it is about. Empty when
 * there is nothing but questions.
 * @param {Subject} subject @param {Annotation[]} annotations @param {string[]} paths
 */
export function formatReview(subject, annotations, paths) {
  const ordered = sortAnnotations(toSend(annotations), paths);
  if (ordered.length === 0) return "";
  const output = [`I reviewed ${named(subject)} at commit ${short(subject.head)}. Please address these annotations.`, ""];
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
    `I am reading ${named(subject)} at commit ${short(subject.head)} in a pane beside this terminal and have a question.`,
    "",
    `Location: ${place(question.target, subject.head)}`,
    ...question.target === null ? [] : ["", "The lines the question is about:", ...fence(question.target.quote)],
    "",
    `Question: ${question.body}`,
  ].join("\n");
}

/**
 * The terminal the tab's agent runs in, as `hc send` names it, with a name for people; or why there is none to send to.
 * The pane's own terminal comes first when it runs an agent. A shell is never sent to: it would run the words.
 * @param {import("herdr").PaneInfo[]} mine the tab's terminal panes
 * @returns {{ terminal: string, name: string } | { terminal: null, why: string }}
 */
export function agentOf(mine, follow, machine) {
  const agents = mine.filter((p) => p.terminal !== null && (p.program?.agent === true || p.status !== null));
  const pane = agents.find((p) => p.pane === follow) ?? agents.find((p) => p.focused) ?? agents[0];
  if (pane === undefined) return { terminal: null, why: "No agent in this tab to send it to." };
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
    return { failed: stderr.trim().split("\n").at(-1) || `hc send exited with ${code}` };
  }
}
