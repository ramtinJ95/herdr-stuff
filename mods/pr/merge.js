import { prArgs } from "./query.js";
import { parsePr } from "./github.js";
import { offersMerge, summarize } from "./model.js";

/** @typedef {import("./view.js").Target} Target */
/** @typedef {"merge" | "squash" | "rebase"} MergeMethod */
/** @typedef {{ step: "idle" } | { step: "armed", head: string, at: number } | { step: "running", head: string } | { step: "done", ok: boolean, text: string }} MergeUi */

const METHODS = /** @type {const} */ ([["merge", "mergeCommitAllowed"], ["squash", "squashMergeAllowed"], ["rebase", "rebaseMergeAllowed"]]);

const repoFlag = (target) => `${target.host}/${target.owner}/${target.name}`;

export const repoViewArgs = (target) => ["repo", "view", repoFlag(target), "--json", "viewerDefaultMergeMethod,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"];

/** @returns {MergeMethod | null} */
export function mergeMethod(repo) {
  const allowed = METHODS.filter(([, flag]) => repo?.[flag] === true).map(([method]) => method);
  const preferred = String(repo?.viewerDefaultMergeMethod ?? "").toLowerCase();
  return allowed.find((method) => method === preferred) ?? allowed[0] ?? null;
}

export const mergeArgv = (target, method, head) =>
  ["pr", "merge", String(target.number), "-R", repoFlag(target), `--${method}`, "--match-head-commit", head];

/** A second press sooner than this after the first is the same press: a held key, a double-click. */
export const MERGE_GAP_MS = 700;
/** A first press nobody follows up is taken back after this long. */
export const MERGE_ARMED_MS = 10_000;

/**
 * Whether a first press still stands: Merge is still offered on GitHub's latest answer, for the same commit, and the press is recent.
 * @param {MergeUi} merge
 * @param {{ offered: boolean, fresh: boolean, head: string, now: number }} facts
 */
export const armedHolds = (merge, { offered, fresh, head, now }) =>
  merge.step === "armed" && offered && fresh && merge.head === head && now - merge.at < MERGE_ARMED_MS;

/**
 * What a press of Merge does.
 * @param {MergeUi} merge
 * @param {{ offered: boolean, fresh: boolean, head: string, now: number, held: boolean }} facts
 * @returns {"nothing" | "arm" | "confirm"}
 */
export function mergePress(merge, facts) {
  if (facts.held || merge.step === "running" || !facts.offered || !facts.fresh) return "nothing";
  if (!armedHolds(merge, facts)) return "arm";
  return facts.now - merge.at < MERGE_GAP_MS ? "nothing" : "confirm";
}

const VERBS = { merge: "merge", squash: "squash-merge", rebase: "rebase-merge" };

export const armedLine = (method, head, base) => `Press again to ${VERBS[method]} ${head.slice(0, 7)} into ${base}`;

/**
 * The second press: asks GitHub once more, then merges only what the press was looking at, still offered and on the same head commit.
 * `gh` runs the GitHub CLI and resolves to its stdout and a `failure`, null when it exited 0.
 * @param {(argv: string[]) => Promise<{ stdout: string, failure: { text: string } | null }>} gh
 * @param {Target} target
 * @param {MergeMethod} method
 * @param {string} head
 * @returns {Promise<Extract<MergeUi, { step: "done" }>>}
 */
export async function confirmMerge(gh, target, method, head) {
  const refused = (text) => ({ step: /** @type {const} */ ("done"), ok: false, text });
  const again = await gh(prArgs(target.owner, target.name, target.number, false, target.host));
  let snapshot;
  try {
    if (again.failure !== null) throw new Error(again.failure.text);
    snapshot = parsePr(JSON.parse(again.stdout));
  } catch (e) {
    return refused(`Not merged: GitHub could not be asked first. ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
  if (!offersMerge(summarize(snapshot)) || snapshot.pr.head !== head) return refused("Not merged: the pull request changed after the first press.");
  const merged = await gh(mergeArgv(target, method, head));
  if (merged.failure !== null) return refused(`Merge failed: ${merged.failure.text.split("\n")[0]}`);
  return { step: "done", ok: true, text: `Merged ${head.slice(0, 7)} into ${snapshot.pr.baseRef} (${method}).` };
}
