/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").Check} Check */
/** @typedef {import("./github.js").Failure} Failure */
/** @typedef {"working" | "blocked" | "done" | "idle"} Tone */
/** @typedef {{ pass: number, fail: number, pending: number, skipping: number, cancel: number }} Tally */
/** @typedef {{ kind: "none" | "fail" | "pending" | "cancel" | "pass", basis: "required" | "all", counts: Tally, all: Tally, running: Check[], hidden: number }} Ci */
/** @typedef {{ kind: "draft" | "conflicts" | "behind" | "review-required" | "changes-requested" | "checks-failing" | "checks-running" | "rules", label: string, tone: Tone }} Blocker */
/** @typedef {{ kind: "ready", clean: boolean, note: string | null } | { kind: "blocked", blockers: Blocker[] } | { kind: "unknown" } | { kind: "merged" } | { kind: "closed" }} Merge */

const tally = (checks) => {
  const t = { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 };
  for (const c of checks) t[c.bucket]++;
  return t;
};
const total = (t) => t.pass + t.fail + t.pending + t.skipping + t.cancel;
/** gh's summary order (printSummary): any failure names the set, then anything pending, then anything cancelled. */
const kindOf = (t) => ["fail", "pending", "cancel"].find((b) => t[b] > 0) ?? (total(t) > 0 ? "pass" : "none");
/** gh's sentence for each kind, used as the note on a PR GitHub calls mergeable while some checks are not passing. */
const GH_SUMMARY = { fail: "Some checks were not successful", pending: "Some checks are still pending", cancel: "Some checks were cancelled" };

const startTime = (c) => (c.startedAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(c.startedAt));
/** Ties keep the snapshot's display order, since the sort is stable. */
const oldestFirst = (a, b) => startTime(a) - startTime(b);

/** @returns {Ci} */
function ciOf(snapshot) {
  const required = snapshot.checks.filter((c) => c.required);
  const basis = required.length > 0 ? "required" : "all";
  const counts = tally(basis === "required" ? required : snapshot.checks);
  const running = snapshot.checks.filter((c) => c.bucket === "pending").sort(oldestFirst);
  return { kind: kindOf(counts), basis, counts, all: tally(snapshot.checks), running, hidden: snapshot.hidden };
}

/** How GitHub's mergeStateStatus reads before the blockers are looked at. */
const MERGE_STATES = { CLEAN: "ready", HAS_HOOKS: "ready", UNSTABLE: "ready", BLOCKED: "blocked", BEHIND: "blocked", DIRTY: "blocked", DRAFT: "blocked", UNKNOWN: "unknown" };

/** Every reason an open PR cannot merge, in the order shown. `rules` is what GitHub's BLOCKED means when nothing else explains it. */
const BLOCKERS = [
  { kind: "draft", label: "Draft", tone: "idle", holds: (pr) => pr.draft || pr.mergeState === "DRAFT" },
  { kind: "conflicts", label: "Conflicts with the base branch", tone: "blocked", holds: (pr) => pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY" },
  { kind: "behind", label: "Behind the base branch", tone: "blocked", holds: (pr) => pr.mergeState === "BEHIND" },
  { kind: "review-required", label: "Waiting for review", tone: "idle", holds: (pr) => pr.review === "REVIEW_REQUIRED" },
  { kind: "changes-requested", label: "Changes requested", tone: "blocked", holds: (pr) => pr.review === "CHANGES_REQUESTED" },
  { kind: "checks-failing", label: "Required checks not passing", tone: "blocked", holds: (_, ci) => ci.basis === "required" && (ci.kind === "fail" || ci.kind === "cancel") },
  { kind: "checks-running", label: "Required checks running", tone: "working", holds: (_, ci) => ci.basis === "required" && ci.kind === "pending" },
  { kind: "rules", label: "Blocked by a branch rule", tone: "blocked", holds: (pr, _, found) => pr.mergeState === "BLOCKED" && found.length === 0 },
];

/** @returns {Merge} */
function mergeOf(pr, ci) {
  if (pr.state === "MERGED") return { kind: "merged" };
  if (pr.state === "CLOSED") return { kind: "closed" };
  const reading = MERGE_STATES[pr.mergeState];
  if (reading === "ready") return { kind: "ready", clean: pr.mergeState !== "UNSTABLE", note: pr.mergeState === "UNSTABLE" ? GH_SUMMARY[kindOf(ci.all)] ?? null : null };
  const blockers = BLOCKERS.reduce((found, b) => (b.holds(pr, ci, found) ? [...found, { kind: b.kind, label: b.label, tone: b.tone }] : found), []);
  return blockers.length > 0 ? { kind: "blocked", blockers } : { kind: "unknown" };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const checksWord = (ci, n) => plural(n, ci.basis === "required" ? "required check" : "check");

/** The headline: the first row that holds, top to bottom. */
const HEADLINES = [
  { holds: (s) => s.stage === "merged", tone: () => "done", text: () => "Merged" },
  { holds: (s) => s.stage === "closed", tone: () => "idle", text: () => "Closed without merging" },
  { holds: (s) => s.ci.kind === "fail", tone: () => "blocked", text: (s) => `${checksWord(s.ci, s.ci.counts.fail)} failing` },
  { holds: (s) => s.ci.kind === "pending", tone: () => "working",
    text: (s) => `${s.ci.basis === "required" ? "Required checks" : "Checks"} running, ${total(s.ci.counts) - s.ci.counts.pending} of ${total(s.ci.counts)} done` },
  { holds: (s) => s.ci.kind === "cancel", tone: () => "blocked", text: (s) => `${checksWord(s.ci, s.ci.counts.cancel)} cancelled` },
  { holds: (s) => s.merge.kind === "blocked", tone: (s) => s.merge.blockers[0].tone, text: (s) => s.merge.blockers[0].label },
  { holds: (s) => s.merge.kind === "unknown" && s.ci.kind === "none", tone: () => "working", text: () => "No checks yet" },
  { holds: (s) => s.merge.kind === "unknown", tone: () => "idle", text: () => "Merge state not known yet" },
  { holds: (s) => s.merge.kind === "ready", tone: () => "done", text: () => "Ready to merge" },
];

const STAGES = { MERGED: "merged", CLOSED: "closed" };

/**
 * Everything the pane draws about a PR. `localHead` is the commit checked out here; `stale` says the PR's head is not it.
 * @param {Snapshot} snapshot
 * @param {{ localHead?: string | null }} [options]
 */
export function summarize(snapshot, { localHead = null } = {}) {
  const { pr } = snapshot;
  const stage = STAGES[pr.state] ?? (pr.draft ? "draft" : "open");
  const ci = ciOf(snapshot);
  const merge = mergeOf(pr, ci);
  const facts = { stage, ci, merge };
  const row = HEADLINES.find((r) => r.holds(facts));
  return { stage, ci, merge, stale: pr.state === "OPEN" && localHead !== null && localHead !== pr.head, headline: row.text(facts), tone: row.tone(facts) };
}

/** Whether the pane offers Merge. GitHub's UNSTABLE is mergeable with a check that is not passing, whether or not the pane can name it: that is shown, not offered. */
export const offersMerge = (summary) => summary.merge.kind === "ready" && summary.merge.clean;

/** The line for a failure in place of a PR. */
const FAILURE_LINES = {
  "no-gh": { headline: "GitHub CLI (gh) not found", tone: "blocked" },
  "no-auth": { headline: "gh is not logged in", tone: "blocked" },
  "no-repo": { headline: "Not a GitHub repository", tone: "idle" },
  "no-pr": { headline: "No pull request for this branch", tone: "idle" },
  offline: { headline: "Cannot reach GitHub", tone: "idle" },
  "rate-limited": { headline: "GitHub rate limit reached", tone: "idle" },
  unknown: { headline: "gh failed", tone: "blocked" },
};

/** @param {Failure} failure */
export function describeFailure(failure) {
  return { ...FAILURE_LINES[failure.kind], text: failure.text };
}

/** The check rows in display order. Within a group, checks keep the snapshot's order: by workflow, then name, digits as numbers. */
const GROUPS = [
  { key: "fail", title: "Failed" },
  { key: "pending", title: "Running" },
  { key: "cancel", title: "Cancelled" },
  { key: "pass", title: "Passed" },
  { key: "skipping", title: "Skipped" },
];

/** @param {Snapshot} snapshot @returns {{ key: string, title: string, checks: Check[] }[]} */
export function groups(snapshot) {
  return GROUPS.map((g) => ({ ...g, checks: snapshot.checks.filter((c) => c.bucket === g.key) })).filter((g) => g.checks.length > 0);
}

const hasSteps = (c) => c.kind === "run" && c.app === "github-actions";

/** The checks to ask steps for: the selected one, then Actions jobs in progress, oldest first, at most `max`. @returns {string[]} */
export function stepsWanted(snapshot, selectedId, max) {
  const selected = snapshot.checks.filter((c) => c.id === selectedId && hasSteps(c));
  const running = snapshot.checks.filter((c) => c.id !== selectedId && hasSteps(c) && c.state === "IN_PROGRESS").sort(oldestFirst);
  return [...selected, ...running].slice(0, max).map((c) => c.id);
}

/**
 * How long to wait before the next poll, per situation, in ms; null means "not until asked" (a key, the pane shown again).
 * An object is a backoff: `first`, doubled for each failure in a row, up to `max`.
 */
export const POLL = {
  hidden: null,
  merged: null,
  closed: null,
  running: 10_000,
  "no-checks": 30_000,
  settled: 60_000,
  "no-pr": 30_000,
  "no-gh": null,
  "no-auth": null,
  "no-repo": null,
  "rate-limited": 300_000,
  offline: { first: 15_000, max: 300_000 },
  unknown: { first: 15_000, max: 300_000 },
};

function situation({ ciKind, prState, visible, error }) {
  if (!visible) return "hidden";
  if (error !== null) return error.kind;
  if (prState !== "OPEN") return prState === "MERGED" ? "merged" : "closed";
  return ciKind === "pending" ? "running" : ciKind === "none" ? "no-checks" : "settled";
}

/**
 * @param {{ ciKind: Ci["kind"] | null, prState: "OPEN" | "CLOSED" | "MERGED" | null, visible: boolean,
 *   error: { kind: import("./github.js").FailureKind, streak: number } | null }} state  `streak` counts failures in a row, from 1.
 * @returns {number | null}
 */
export function nextPollDelay(state) {
  const row = POLL[situation(state)];
  if (row === null || typeof row === "number") return row;
  return Math.min(row.first * 2 ** (state.error.streak - 1), row.max);
}

/** "45s", "3m 29s", "1h 5m"; a check still running counts to `now` (ms). Empty when it has not started. */
export function duration(startedAt, completedAt, now) {
  if (startedAt === null) return "";
  const s = Math.max(0, Math.round(((completedAt === null ? now : Date.parse(completedAt)) - Date.parse(startedAt)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
