import { plural } from "./text.js";

/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").Check} Check */
/** @typedef {import("./github.js").Failure} Failure */
/** @typedef {"working" | "blocked" | "done" | "idle"} Tone */
/** @typedef {{ pass: number, fail: number, pending: number, skipping: number, cancel: number }} Tally */
/** @typedef {{ kind: "none" | "fail" | "pending" | "cancel" | "pass", basis: "required" | "all", counts: Tally, all: Tally }} Ci */
/**
 * `streak` counts failures of one kind in a row, from 1. `resetAt` is when GitHub's rate limit starts over, in ms, as
 * last heard before the failure.
 * @typedef {{ failure: Failure, streak: number, resetAt: number | null }} Trouble
 */
/** `checks` says the blocker is about the checks. @typedef {{ kind: "draft" | "conflicts" | "behind" | "review-required" | "changes-requested" | "checks-failing" | "checks-running" | "rules", label: string, tone: Tone, checks: boolean }} Blocker */
/** @typedef {{ kind: "ready", clean: boolean, note: string | null } | { kind: "blocked", blockers: Blocker[] } | { kind: "unknown" } | { kind: "merged" } | { kind: "closed" }} Merge */

const tally = (checks) => {
  const t = { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 };
  for (const c of checks) t[c.bucket]++;
  return t;
};
const total = (t) => t.pass + t.fail + t.pending + t.skipping + t.cancel;
/** gh's summary order (printSummary): any failure names the set, then anything pending, then anything cancelled. */
const NOT_PASSING = ["fail", "pending", "cancel"];
const kindOf = (t) => NOT_PASSING.find((b) => t[b] > 0) ?? (total(t) > 0 ? "pass" : "none");
/** gh's sentence for each kind, used as the note on a PR GitHub calls mergeable while some checks are not passing. */
const GH_SUMMARY = { fail: "Some checks were not successful", pending: "Some checks are still pending", cancel: "Some checks were cancelled" };

const startTime = (c) => (c.startedAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(c.startedAt));
const oldestFirst = (a, b) => startTime(a) - startTime(b);

/** @returns {Ci} */
function ciOf(snapshot) {
  const required = snapshot.checks.filter((c) => c.required);
  const basis = required.length > 0 ? "required" : "all";
  const counts = tally(basis === "required" ? required : snapshot.checks);
  return { kind: kindOf(counts), basis, counts, all: tally(snapshot.checks) };
}

/** GitHub's mergeStateStatus values that mean it would merge. In any other, the blockers say why not. */
const READY = ["CLEAN", "HAS_HOOKS", "UNSTABLE"];

/** Every reason an open PR cannot merge, in the order shown. `rules` is what GitHub's BLOCKED means when nothing else explains it. */
const BLOCKERS = [
  { kind: "draft", label: "Draft", tone: "idle", holds: (pr) => pr.draft || pr.mergeState === "DRAFT" },
  { kind: "conflicts", label: "Conflicts with the base branch", tone: "blocked", holds: (pr) => pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY" },
  { kind: "behind", label: "Behind the base branch", tone: "blocked", holds: (pr) => pr.mergeState === "BEHIND" },
  { kind: "review-required", label: "Waiting for review", tone: "idle", holds: (pr) => pr.review === "REVIEW_REQUIRED" },
  { kind: "changes-requested", label: "Changes requested", tone: "blocked", holds: (pr) => pr.review === "CHANGES_REQUESTED" },
  { kind: "checks-failing", label: "Required checks not passing", tone: "blocked", checks: true, holds: (_, ci) => ci.basis === "required" && (ci.kind === "fail" || ci.kind === "cancel") },
  { kind: "checks-running", label: "Required checks running", tone: "working", checks: true, holds: (_, ci) => ci.basis === "required" && ci.kind === "pending" },
  { kind: "rules", label: "Blocked by a branch rule", tone: "blocked", holds: (pr, _, found) => pr.mergeState === "BLOCKED" && found.length === 0 },
];

/** @returns {Merge} */
function mergeOf(pr, ci) {
  if (pr.state === "MERGED") return { kind: "merged" };
  if (pr.state === "CLOSED") return { kind: "closed" };
  if (READY.includes(pr.mergeState)) return { kind: "ready", clean: pr.mergeState !== "UNSTABLE", note: pr.mergeState === "UNSTABLE" ? GH_SUMMARY[kindOf(ci.all)] ?? null : null };
  const blockers = BLOCKERS.reduce((found, b) => (b.holds(pr, ci, found) ? [...found, { kind: b.kind, label: b.label, tone: b.tone, checks: b.checks === true }] : found), []);
  return blockers.length > 0 ? { kind: "blocked", blockers } : { kind: "unknown" };
}

const checksWord = (ci, n) => plural(n, ci.basis === "required" ? "required check" : "check");

/**
 * The headline: the first row that holds, top to bottom. `lead` is what it is about: the stage, the checks, the first
 * blocker by its kind, or the merge.
 */
const HEADLINES = [
  { holds: (s) => s.stage === "merged", lead: () => "stage", tone: () => "done", text: () => "Merged" },
  { holds: (s) => s.stage === "closed", lead: () => "stage", tone: () => "idle", text: () => "Closed without merging" },
  { holds: (s) => s.ci.kind === "fail", lead: () => "checks", tone: () => "blocked", text: (s) => `${checksWord(s.ci, s.ci.counts.fail)} failing` },
  { holds: (s) => s.ci.kind === "pending", lead: () => "checks", tone: () => "working",
    text: (s) => `${s.ci.basis === "required" ? "Required checks" : "Checks"} running, ${total(s.ci.counts) - s.ci.counts.pending} of ${total(s.ci.counts)} done` },
  { holds: (s) => s.ci.kind === "cancel", lead: () => "checks", tone: () => "blocked", text: (s) => `${checksWord(s.ci, s.ci.counts.cancel)} cancelled` },
  { holds: (s) => s.merge.kind === "blocked", lead: (s) => s.merge.blockers[0].kind, tone: (s) => s.merge.blockers[0].tone, text: (s) => s.merge.blockers[0].label },
  { holds: (s) => s.merge.kind === "unknown" && s.ci.kind === "none", lead: () => "merge", tone: () => "working", text: () => "No checks yet" },
  { holds: (s) => s.merge.kind === "unknown", lead: () => "merge", tone: () => "idle", text: () => "Merge state not known yet" },
  { holds: (s) => s.merge.kind === "ready", lead: () => "merge", tone: () => "done", text: () => "Ready to merge" },
];

const STAGES = { MERGED: "merged", CLOSED: "closed" };

/**
 * What a snapshot means: the stage, the checks, what blocks the merge, and the headline with what it is about.
 * @param {Snapshot} snapshot
 */
export function summarize(snapshot) {
  const { pr } = snapshot;
  const stage = STAGES[pr.state] ?? (pr.draft ? "draft" : "open");
  const ci = ciOf(snapshot);
  const merge = mergeOf(pr, ci);
  const facts = { stage, ci, merge };
  const row = HEADLINES.find((r) => r.holds(facts));
  return { stage, ci, merge, lead: /** @type {string} */ (row.lead(facts)), headline: row.text(facts), tone: row.tone(facts) };
}

/** Whether the commit checked out where the pane is, `localHead`, is another than the one an open pull request's checks ran on. @param {Snapshot["pr"]} pr @param {string | null} localHead */
export const staleCheckout = (pr, localHead) => pr.state === "OPEN" && localHead !== null && localHead !== pr.head;

/** Whether the pane offers Merge. GitHub's UNSTABLE is mergeable with a check that is not passing, whether or not the pane can name it: that is shown, not offered. */
export const offersMerge = (summary) => summary.merge.kind === "ready" && summary.merge.clean;

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

/** Only a GitHub Actions job has steps GitHub keeps. */
export const hasSteps = (c) => c.kind === "run" && c.app === "github-actions";

/** Steps that will not change: the job has finished and so has every step read. */
const stepsFinal = (c) => c.completedAt !== null && c.steps !== null && c.steps.every((s) => s.bucket !== "pending");

/**
 * The checks to ask steps for: the selected one, then Actions jobs in progress, oldest first, at most `max`.
 * A check whose steps are final is left out. @returns {string[]}
 */
export function stepsWanted(snapshot, selectedId, max) {
  const selected = snapshot.checks.filter((c) => c.id === selectedId && hasSteps(c) && !stepsFinal(c));
  const running = snapshot.checks.filter((c) => c.id !== selectedId && hasSteps(c) && c.state === "IN_PROGRESS").sort(oldestFirst);
  return [...selected, ...running].slice(0, max).map((c) => c.id);
}

/** `next`, a snapshot fresh from GitHub and so without steps, with the final steps `prev` held, so they are not asked for again. @returns {Snapshot} */
export function keepSteps(next, prev) {
  const final = new Map(prev.checks.filter(stepsFinal).map((c) => [c.id, c.steps]));
  return final.size === 0 ? next : { ...next, checks: next.checks.map((c) => (c.steps === null && final.has(c.id) ? { ...c, steps: final.get(c.id) } : c)) };
}

/**
 * How long to wait before the next poll, in ms; null means "not until asked" (a key, the pane shown again).
 * A pane that is not on screen does not poll at all: the watch holds that, not these tables.
 */
const POLL = {
  merged: null,
  closed: null,
  running: 10_000,
  "no-checks": 30_000,
  settled: 60_000,
};

/**
 * The same after a failure, by its kind. An object is a backoff: `first`, doubled for each failure in a row, up to `max`.
 * @type {Record<import("./github.js").FailureKind, number | null | { first: number, max: number }>}
 */
const FAILURE_WAIT = {
  "no-pr": 30_000,
  "no-gh": null,
  "no-auth": null,
  "no-repo": null,
  "rate-limited": 300_000,
  offline: { first: 15_000, max: 300_000 },
  unknown: { first: 15_000, max: 300_000 },
};

/** The wait after a poll that answered. @param {Ci["kind"]} ciKind @param {"OPEN" | "CLOSED" | "MERGED"} prState @returns {number | null} */
export function nextPollDelay(ciKind, prState) {
  if (prState !== "OPEN") return POLL[prState === "MERGED" ? "merged" : "closed"];
  return POLL[ciKind === "pending" ? "running" : ciKind === "none" ? "no-checks" : "settled"];
}

/** The wait after a failure. @param {Trouble} trouble @returns {number | null} */
export function failureDelay({ failure, streak }) {
  const row = FAILURE_WAIT[failure.kind];
  return row === null || typeof row === "number" ? row : Math.min(row.first * 2 ** (streak - 1), row.max);
}

/** The trouble after one more failure. @param {Trouble | null} prev @param {Failure} failure @param {number | null} resetAt @returns {Trouble} */
export const troubleAfter = (prev, failure, resetAt) => ({ failure, streak: prev !== null && prev.failure.kind === failure.kind ? prev.streak + 1 : 1, resetAt });
