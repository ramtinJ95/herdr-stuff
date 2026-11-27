/** @typedef {import("./github.js").Snapshot} Snapshot */
/** @typedef {import("./github.js").About} About */
/** @typedef {import("./github.js").File} File */
/** @typedef {import("./github.js").Target} Target */
/** @typedef {import("./model.js").Trouble} Trouble */
/** Where gh runs. A pinned pane has no folder or branch: `pin` names the pull request it was given. @typedef {{ cwd: string | null, branch: string | null, machine: string | null, pin: string | null }} Place */
/**
 * What is drawn of a pull request: the poll's snapshot, and the description and the files read apart from it.
 * `files` are those of the head commit named beside them; their `colours` are missing until the helper has answered.
 * @typedef {{ snapshot: Snapshot, about: About | null, files: { head: string, list: File[], colours?: import("./pierre/colours.js").Colours } | null,
 *   fetchedAt: number, source: "cache" | "live" | "replay" }} Shown
 */
/** Why the last try at each part read beside the snapshot did not go; null where it did, or was not made. @typedef {{ steps: string | null, about: string | null, files: string | null }} Errors */
/** @typedef {{ phase: "showing", place: Place, target: Target, localHead: string | null, shown: Shown | null, trouble: Trouble | null, errors: Errors }} Showing */
/**
 * @typedef {{ phase: "idle" }
 *   | { phase: "locating", place: Place, shown: Shown | null }
 *   | { phase: "failed", place: Place, trouble: Trouble }
 *   | { phase: "no-pr", place: Place }
 *   | Showing
 *   | { phase: "replay", file: string, shown: Shown | null, trouble: Trouble | null }
 *   | { phase: "bad-pin", text: string }} State
 */
/**
 * A pull request as it is drawn, whichever phase has one to draw: a guess while its branch is looked up, the one
 * shown, a replay's. `localHead`, `pin` and `target` are set only for the one shown.
 * @typedef {{ shown: Shown, trouble: Trouble | null, localHead: string | null, pin: string | null, target: Target | null, errors: Errors }} Scene
 */

/** @type {Errors} */
export const NO_ERRORS = { steps: null, about: null, files: null };

/** @param {Place | null} place */
export const placeKey = (place) => (place === null ? null : JSON.stringify([place.machine, place.cwd, place.branch]));

/** Whether what is shown is GitHub's latest answer: not a saved copy, not the last good one after a failed poll. @param {Shown} shown @param {Trouble | null} trouble */
export const liveShown = (shown, trouble) => shown.source === "live" && trouble === null;

/** @param {State} state @returns {Scene | null} */
export function sceneOf(state) {
  if (!("shown" in state) || state.shown === null) return null;
  const { shown } = state;
  if (state.phase === "showing") return { shown, trouble: state.trouble, localHead: state.localHead, pin: state.place.pin, target: state.target, errors: state.errors };
  return { shown, trouble: null, localHead: null, pin: null, target: null, errors: NO_ERRORS };
}
