/**
 * What leaves the pane of a review, and where to: the words the tab's agent is sent, the review GitHub is posted, and
 * the terminal an agent runs in.
 */
import { isLine } from "./diff.js";
import { byName, shortSha } from "./github.js";
import { KINDS, placedOn, quoted, sortAnnotations, threadState, threadStretch, threadWhere, toSend } from "./review.js";
import { lastLine, plural } from "./text.js";

/** @typedef {import("./diff.js").DiffRow} DiffRow */
/** @typedef {import("./github.js").Thread} Thread */
/** @typedef {import("./review.js").Annotation} Annotation */
/** @typedef {import("./review.js").Spot} Spot */
/** One line comment of a review, as GitHub takes it. @typedef {{ path: string, startLine?: number, startSide?: "LEFT" | "RIGHT", line: number, side: "LEFT" | "RIGHT", body: string }} LineComment */
/** A review as GitHub takes it. @typedef {{ commit: string, event: "COMMENT" | "APPROVE", body: string, comments: LineComment[] }} Posting */
/** The pull request, as the agent is told of it. @typedef {{ ref: string, title: string, url: string, head: string }} Subject */

function fence(lines) {
  const longest = Math.max(2, ...lines.map((line) => Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length))));
  const ticks = "`".repeat(longest + 1);
  return [`${ticks}diff`, ...lines, ticks];
}

const named = ({ ref, title, url }) => `pull request ${ref}, "${title}" (${url})`;

/** Where an annotation points, for the agent. Lines of an earlier commit are said to be. @param {Spot | null} target */
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
  const state = threadState(thread);
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
function githubLines(rows, start, end) {
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
    const rows = target === null ? [] : rowsOf(target.path);
    const lines = target !== null && placedOn(target, head, rows) ? githubLines(rows, target.start, target.end) : null;
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
