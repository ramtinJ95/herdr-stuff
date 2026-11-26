import { firstLine } from "./github.js";
import { POLL, describeFailure, groups, plural } from "./model.js";

/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").Check} Check */
/** @typedef {import("./github.js").Failure} Failure */
/** @typedef {ReturnType<typeof import("./model.js").summarize>} Summary */
/** @typedef {ReturnType<typeof groups>[number]} Group */
/** @typedef {import("./github.js").File} File */
/**
 * @typedef {{ kind: "group", key: string, group: Group, open: boolean } | { kind: "check", key: string, check: Check } | { kind: "hidden", key: string, count: number }
 *   | { kind: "about", key: "about", open: boolean } | { kind: "files", key: "files", open: boolean, count: number }
 *   | { kind: "file", key: string, file: File } | { kind: "more-files", key: "more-files", count: number }} Row
 */
/** @typedef {import("./github.js").About} About */

const PASSED_SHOWN = 8;
/** The list is drawn whole, so a pull request with more files than this shows the first and counts the rest. */
export const FILES_SHOWN = 300;

function opensByDefault(group, all) {
  if (group.key === "skipping") return false;
  if (group.key !== "pass") return true;
  return group.checks.length <= PASSED_SHOWN && !all.some((g) => g.key === "fail" || g.key === "pending");
}

/** @returns {Row[]} */
export function rowsOf(snapshot, folds) {
  const all = groups(snapshot);
  const rows = all.flatMap((group) => {
    const open = folds.get(group.key) ?? opensByDefault(group, all);
    return [{ kind: "group", key: `group:${group.key}`, group, open },
      ...open ? group.checks.map((check) => ({ kind: "check", key: check.id, check })) : []];
  });
  return snapshot.hidden > 0 ? [...rows, { kind: "hidden", key: "hidden", count: snapshot.hidden }] : rows;
}

/**
 * The pane's rows: the description, the files, then the checks. `files` is null until GitHub has listed them.
 * @param {Snapshot} snapshot
 * @param {{ folds: Map<string, boolean>, aboutOpen: boolean, filesOpen: boolean, files: File[] | null }} open
 * @returns {Row[]}
 */
export function paneRows(snapshot, { folds, aboutOpen, filesOpen, files }) {
  const listed = filesOpen && files !== null ? files : [];
  return [
    { kind: "about", key: "about", open: aboutOpen },
    { kind: "files", key: "files", open: filesOpen, count: snapshot.pr.files },
    ...listed.slice(0, FILES_SHOWN).map((file) => /** @type {Row} */ ({ kind: "file", key: `file:${file.path}`, file })),
    .../** @type {Row[]} */ (listed.length > FILES_SHOWN ? [{ kind: "more-files", key: "more-files", count: listed.length - FILES_SHOWN }] : []),
    ...rowsOf(snapshot, folds),
  ];
}

const FILE_ROWS = ["files", "file", "more-files"];

/** Where `o` goes from a row: the check's own page, the pull request from its description, its files from a file, else its checks. */
export function rowUrl(row, snapshot) {
  if (row.kind === "check" && row.check.link !== null) return row.check.link;
  if (row.kind === "about") return snapshot.pr.url;
  return `${snapshot.pr.url}/${FILE_ROWS.includes(row.kind) ? "files" : "checks"}`;
}

function indexOf(rows, key) {
  const own = rows.findIndex((r) => r.key === key);
  if (own >= 0) return own;
  const folded = rows.findIndex((r) => (r.kind === "group" && r.group.checks.some((c) => c.id === key)) || (r.kind === "files" && String(key).startsWith("file:")));
  if (folded >= 0) return folded;
  return Math.max(0, rows.findIndex((r) => r.kind === "check"));
}

/** @returns {Row | null} */
export const selectedRow = (rows, key) => rows[indexOf(rows, key)] ?? null;

export function moveSelection(rows, key, by) {
  if (rows.length === 0) return null;
  return rows[Math.min(rows.length - 1, Math.max(0, indexOf(rows, key) + by))].key;
}

const STAGE_WORDS = { open: "Open", draft: "Draft" };
const CI_HEADLINE = ["fail", "pending", "cancel"];

export function headlineOf(summary) {
  const stage = STAGE_WORDS[summary.stage];
  return stage === undefined || summary.headline === stage ? summary.headline : `${stage} · ${summary.headline}`;
}

export function blockerWords(summary) {
  const { merge, ci } = summary;
  if (merge.kind === "ready") return merge.note !== null && !CI_HEADLINE.includes(ci.kind) ? [merge.note] : [];
  if (merge.kind !== "blocked") return [];
  return merge.blockers.filter((b) => b.label !== summary.headline
    && !(b.kind === "draft" && summary.stage === "draft")
    && !(b.kind.startsWith("checks-") && CI_HEADLINE.includes(ci.kind))).map((b) => b.label);
}

export function currentStep(check) {
  if (check.bucket !== "pending" || check.steps === null || check.steps.length === 0) return null;
  const at = check.steps.findIndex((s) => s.state === "IN_PROGRESS");
  const index = at >= 0 ? at : check.steps.findIndex((s) => s.bucket === "pending");
  return index < 0 ? null : `${index + 1}/${check.steps.length} ${check.steps[index].name}`;
}

export const stepLink = (check, step) => (check.link === null ? null : `${check.link}#step:${step.number}:1`);

const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

const FIXES = {
  "no-gh": "Install the GitHub CLI, then run `gh auth login` in a terminal.",
  "no-auth": "Run `gh auth login` in a terminal.",
  offline: "The pane tries again by itself.",
};

/** What a pinned pane says in place of the lines about "this branch". */
const PINNED = { "no-pr": (pin) => `No pull request ${pin}`, "no-repo": (pin) => `gh cannot see the repository of ${pin}` };

/** `pin` names the pull request a pinned pane was given, null for a pane that follows its tab. */
export function failureLines(failure, resetAt, now, pin = null) {
  const { tone } = describeFailure(failure);
  const headline = pin !== null && PINNED[failure.kind] !== undefined ? PINNED[failure.kind](pin) : describeFailure(failure).headline;
  if (failure.kind === "rate-limited") {
    return { headline, tone, fix: resetAt !== null && resetAt > now ? `It resets at ${clock(resetAt)}.` : `The pane tries again in ${POLL["rate-limited"] / 60_000} minutes.` };
  }
  return { headline, tone, fix: FIXES[failure.kind] ?? (failure.kind === "unknown" ? firstLine(failure.text).trim() || null : null) };
}

export function ago(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${plural(Math.floor(s / 86400), "day")} ago`;
}

/** Whether what is shown is GitHub's latest answer: not a saved copy, not the last good one after a failed poll. */
export const liveShown = (shown, trouble) => shown.source === "live" && trouble === null;

/** Who opened the PR and when, and how much is on it. @param {About} about */
export const aboutLine = (about, now) =>
  [`${about.author ?? "A deleted account"} opened it ${ago(Date.parse(about.createdAt), now)}`, plural(about.commits, "commit"), ...about.comments > 0 ? [plural(about.comments, "comment")] : []].join(" · ");

const REVIEW_WORDS = {
  APPROVED: ["approved", "done"], CHANGES_REQUESTED: ["asked for changes", "blocked"], DISMISSED: ["review dismissed", "idle"],
  COMMENTED: ["commented", "idle"], PENDING: ["is reviewing", "working"],
};

/** Each reviewer and where they stand, those who answered first. @param {About} about */
export function reviewerWords(about) {
  const who = (name) => name ?? "A reviewer GitHub does not name";
  return [
    ...about.reviews.map((r) => ({ text: `${who(r.who)} ${REVIEW_WORDS[r.state][0]}`, tone: REVIEW_WORDS[r.state][1] })),
    ...about.asked.map((name) => ({ text: `${who(name)} is asked to review`, tone: "idle" })),
  ];
}
