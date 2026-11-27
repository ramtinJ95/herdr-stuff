import { byName } from "./github.js";
import { failureDelay, groups } from "./model.js";
import { firstLine, plural } from "./text.js";

/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").Check} Check */
/** @typedef {import("./model.js").Trouble} Trouble */
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
const FILES_SHOWN = 300;
/** What a file row's key starts with, before its path. */
const FILE_KEY = "file:";

function opensByDefault(group, all) {
  if (group.key === "skipping") return false;
  if (group.key !== "pass") return true;
  return group.checks.length <= PASSED_SHOWN && !all.some((g) => g.key === "fail" || g.key === "pending");
}

/** @returns {Row[]} */
function rowsOf(snapshot, folds) {
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
    ...listed.slice(0, FILES_SHOWN).map((file) => /** @type {Row} */ ({ kind: "file", key: FILE_KEY + file.path, file })),
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

/** Where the selected row is: the one with `key`, else the folded row that holds it, else the first check. */
export function rowIndex(rows, key) {
  const own = rows.findIndex((r) => r.key === key);
  if (own >= 0) return own;
  const folded = rows.findIndex((r) => (r.kind === "group" && r.group.checks.some((c) => c.id === key)) || (r.kind === "files" && String(key).startsWith(FILE_KEY)));
  if (folded >= 0) return folded;
  return Math.max(0, rows.findIndex((r) => r.kind === "check"));
}

/** @returns {Row | null} */
export const selectedRow = (rows, key) => rows[rowIndex(rows, key)] ?? null;

export function moveSelection(rows, key, by) {
  if (rows.length === 0) return null;
  return rows[Math.min(rows.length - 1, Math.max(0, rowIndex(rows, key) + by))].key;
}

/**
 * The selected file or check whose diff or steps are drawn: beside the list in a wide pane, in place of it or under its
 * row once opened in a narrow one. Null for any other row, and for one not opened in a narrow pane.
 * @param {Row[]} rows @returns {Extract<Row, { kind: "file" | "check" }> | null}
 */
export function detailOf(rows, key, wide, expanded) {
  const row = selectedRow(rows, key);
  return row !== null && (row.kind === "file" || row.kind === "check") && (wide || expanded) ? row : null;
}

const STAGE_WORDS = { open: "Open", draft: "Draft" };

export function headlineOf(summary) {
  const stage = STAGE_WORDS[summary.stage];
  return stage === undefined || summary.lead === summary.stage ? summary.headline : `${stage} · ${summary.headline}`;
}

export function blockerWords(summary) {
  const { merge, lead } = summary;
  if (merge.kind === "ready") return merge.note !== null && lead !== "checks" ? [merge.note] : [];
  if (merge.kind !== "blocked") return [];
  return merge.blockers.filter((b) => b.kind !== lead && b.kind !== summary.stage && !(b.checks && lead === "checks")).map((b) => b.label);
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

/**
 * What each kind of failure says in place of a pull request. `fix` is what to do about it, from the trouble and the
 * time; `pinned` is the headline of a pane that was given its pull request, in place of the words about "this branch".
 * @type {Record<import("./github.js").FailureKind, { headline: string, tone: import("./model.js").Tone,
 *   fix?: (trouble: Trouble, now: number) => string | null, pinned?: (pin: string) => string }>}
 */
const FAILURES = {
  "no-gh": { headline: "GitHub CLI (gh) not found", tone: "blocked", fix: () => "Install the GitHub CLI, then run `gh auth login` in a terminal." },
  "no-auth": { headline: "gh is not logged in", tone: "blocked", fix: () => "Run `gh auth login` in a terminal." },
  "no-repo": { headline: "Not a GitHub repository", tone: "idle", pinned: (pin) => `gh cannot see the repository of ${pin}` },
  "no-pr": { headline: "No pull request for this branch", tone: "idle", pinned: (pin) => `No pull request ${pin}` },
  offline: { headline: "Cannot reach GitHub", tone: "idle", fix: () => "The pane tries again by itself." },
  "rate-limited": { headline: "GitHub rate limit reached", tone: "idle",
    fix: (trouble, now) => (trouble.resetAt !== null && trouble.resetAt > now ? `It resets at ${clock(trouble.resetAt)}.` : `The pane tries again in ${failureDelay(trouble) / 60_000} minutes.`) },
  unknown: { headline: "gh failed", tone: "blocked", fix: ({ failure }) => firstLine(failure.text).trim() || null },
};

/**
 * `pin` names the pull request a pinned pane was given, null for a pane that follows its tab. `named` says the headline
 * names that pull request itself, so nothing else need say where the pane looked.
 * @param {Trouble} trouble @param {string | null} pin
 */
export function failureLines(trouble, now, pin) {
  const { headline, tone, fix, pinned } = FAILURES[trouble.failure.kind];
  const named = pin !== null && pinned !== undefined;
  return { headline: named ? pinned(pin) : headline, tone, named, fix: fix?.(trouble, now) ?? null };
}

/** "45s", "3m 29s", "1h 5m"; a check still running counts to `now` (ms). Empty when it has not started. */
export function duration(startedAt, completedAt, now) {
  if (startedAt === null) return "";
  const s = Math.max(0, Math.round(((completedAt === null ? now : Date.parse(completedAt)) - Date.parse(startedAt)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function ago(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${plural(Math.floor(s / 86400), "day")} ago`;
}

/** Who opened the PR and when, and how much is on it. @param {About} about */
export const aboutLine = (about, now) =>
  [`${byName(about.author)} opened it ${ago(Date.parse(about.createdAt), now)}`, plural(about.commits, "commit"), ...about.comments > 0 ? [plural(about.comments, "comment")] : []].join(" · ");

const REVIEW_WORDS = {
  APPROVED: ["approved", "done"], CHANGES_REQUESTED: ["asked for changes", "blocked"], DISMISSED: ["review dismissed", "idle"],
  COMMENTED: ["commented", "idle"], PENDING: ["is reviewing", "working"],
};

/** Who said something under the description, as what, and when. @param {import("./github.js").Said} said */
export const saidLine = (said, now) => `${byName(said.who)} ${said.state === null ? "commented" : REVIEW_WORDS[said.state][0]} ${ago(Date.parse(said.at), now)}`;

/** The tone of what was said: a review's verdict, none for a plain comment. @param {import("./github.js").Said} said */
export const saidTone = (said) => (said.state === null ? "idle" : REVIEW_WORDS[said.state][1]);

/** The threads on the diff in a line, or null when there are none. @param {About} about */
export function threadsLine(about) {
  const total = about.threads.length + about.threadsHidden;
  if (total === 0) return null;
  const open = about.threads.filter((thread) => !thread.resolved).length;
  const rest = about.threadsHidden === 0 ? "" : `; ${about.threadsHidden} of them only on GitHub`;
  const state = open > 0 ? `${open} not resolved` : about.threadsHidden === 0 ? "all resolved" : "those read here all resolved";
  return `${plural(total, "thread")} on the diff, ${state}${rest}. They stand among the lines under Files.`;
}

/** Each reviewer and where they stand, those who answered first. @param {About} about */
export function reviewerWords(about) {
  const who = (name) => name ?? "A reviewer GitHub does not name";
  return [
    ...about.reviews.map((r) => ({ text: `${who(r.who)} ${REVIEW_WORDS[r.state][0]}`, tone: REVIEW_WORDS[r.state][1] })),
    ...about.asked.map((name) => ({ text: `${who(name)} is asked to review`, tone: "idle" })),
  ];
}
