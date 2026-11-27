import { prArgs } from "./query.js";
import { parsePr, readAnswer, repoSlug, shortSha } from "./github.js";
import { offersMerge, summarize } from "./model.js";
import { firstLine } from "./text.js";

/** @typedef {import("./github.js").Target} Target */
/** @typedef {import("./github.js").Failure} Failure */
/** @typedef {import("./github.js").MergeMethod} MergeMethod */
/** @typedef {{ step: "idle" } | { step: "armed", head: string, at: number } | { step: "running", head: string } | { step: "done", ok: boolean, text: string }} MergeUi */
/**
 * What the Merge row is right now: nothing, the outcome of a merge, a note in place of the button, or the button, off or pressable.
 * @typedef {{ look: "none" } | { look: "done", ok: boolean, text: string } | { look: "note", note: string }
 *   | { look: "off", label: string, note: string | null } | { look: "rest", label: string }
 *   | { look: "armed", label: string, note: string, at: number }} Offer
 */

const mergeArgv = (target, method, head) =>
  ["pr", "merge", String(target.number), "-R", repoSlug(target), `--${method}`, "--match-head-commit", head];

/** A second press sooner than this after the first is the same press: a held key, a double-click. */
const MERGE_GAP_MS = 700;
/** A first press nobody follows up is taken back after this long. */
const MERGE_ARMED_MS = 10_000;

const VERBS = { merge: "merge", squash: "squash-merge", rebase: "rebase-merge" };

const armedLine = (method, head, base) => `Press again to ${VERBS[method]} ${shortSha(head)} into ${base}`;

/**
 * The one reading of Merge that the row is drawn from and a press goes by.
 * `offered` is the model's `offersMerge`; `live` says the view is GitHub's latest answer; `method`, `head` and `base` are
 * the snapshot's.
 * @param {MergeUi} ui
 * @param {{ offered: boolean, replay: boolean, live: boolean, method: MergeMethod | null, head: string, base: string, now: number }} facts
 * @returns {Offer}
 */
export function mergeOffer(ui, { offered, replay, live, method, head, base, now }) {
  if (ui.step === "done") return { look: "done", ok: ui.ok, text: ui.text };
  if (!offered) return { look: "none" };
  if (replay) return { look: "off", label: "Merge", note: "Off in a replay" };
  if (method === null) return { look: "note", note: "This repository allows no merge method." };
  const label = `Merge (${method})`;
  if (ui.step === "running") return { look: "off", label: "Merging…", note: null };
  if (!live) return { look: "off", label, note: "Off until GitHub answers again" };
  if (ui.step === "armed" && ui.head === head && now - ui.at < MERGE_ARMED_MS) return { look: "armed", label, note: armedLine(method, head, base), at: ui.at };
  return { look: "rest", label };
}

/**
 * What a press of Merge does to that offer.
 * @param {Offer} offer
 * @param {{ now: number, held: boolean }} press
 * @returns {"nothing" | "arm" | "confirm"}
 */
export function mergePress(offer, { now, held }) {
  if (held) return "nothing";
  if (offer.look === "rest") return "arm";
  if (offer.look === "armed") return now - offer.at < MERGE_GAP_MS ? "nothing" : "confirm";
  return "nothing";
}

/**
 * The second press: asks GitHub once more, then merges only what the press was looking at, still offered and on the same head commit.
 * `gh` runs the GitHub CLI and resolves to its stdout and a `failure`, null when it exited 0.
 * @param {(argv: string[]) => Promise<{ stdout: string, failure: Failure | null }>} gh
 * @param {Target} target
 * @param {MergeMethod} method
 * @param {string} head
 * @returns {Promise<Extract<MergeUi, { step: "done" }>>}
 */
export async function confirmMerge(gh, target, method, head) {
  const refused = (text) => ({ step: /** @type {const} */ ("done"), ok: false, text });
  const again = readAnswer(await gh(prArgs(target)), (stdout) => parsePr(JSON.parse(stdout)));
  if (again.failure !== null) return refused(`Not merged: GitHub could not be asked first. ${firstLine(again.failure.text)}`);
  const snapshot = again.value;
  if (!offersMerge(summarize(snapshot)) || snapshot.pr.head !== head) return refused("Not merged: the pull request changed after the first press.");
  const merged = await gh(mergeArgv(target, method, head));
  if (merged.failure !== null) return refused(`Merge failed: ${firstLine(merged.failure.text)}`);
  return { step: "done", ok: true, text: `Merged ${shortSha(head)} into ${snapshot.pr.baseRef} (${method}).` };
}
