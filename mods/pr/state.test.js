import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_ERRORS, liveShown, placeKey, sceneOf } from "./state.js";

const PLACE = { cwd: "/work/site", branch: "feat/x", machine: null, pin: null };
const TARGET = { host: "github.com", owner: "octo", name: "site", number: 7 };
const shown = (source) => ({ snapshot: {}, about: null, files: null, fetchedAt: 1, source });
const offline = { failure: { kind: "offline", text: "x" }, streak: 1, resetAt: null };

test("what is shown is live only as GitHub's latest answer: not a saved copy, not after a failed poll", () => {
  assert.equal(liveShown(shown("live"), null), true);
  assert.equal(liveShown(shown("cache"), null), false);
  assert.equal(liveShown(shown("live"), offline), false);
});

test("there is a pull request to draw in the phases that have one shown, and none in the others", () => {
  for (const state of [{ phase: "idle" }, { phase: "no-pr", place: PLACE }, { phase: "failed", place: PLACE, trouble: offline }, { phase: "bad-pin", text: "x" },
    { phase: "locating", place: PLACE, shown: null }, { phase: "replay", file: "f.json", shown: null, trouble: null },
    { phase: "showing", place: PLACE, target: TARGET, localHead: null, shown: null, trouble: offline, errors: NO_ERRORS }]) {
    assert.equal(sceneOf(state), null, state.phase);
  }
});

test("the pull request shown is drawn with its trouble, checkout and errors; a guess and a replay have none of their own", () => {
  const errors = { steps: null, about: "HTTP 502", files: null };
  const pinned = { ...PLACE, cwd: null, branch: null, pin: "octo/site#7" };
  assert.deepEqual(sceneOf({ phase: "showing", place: pinned, target: TARGET, localHead: "abc", shown: shown("live"), trouble: offline, errors }),
    { shown: shown("live"), trouble: offline, localHead: "abc", pin: "octo/site#7", target: TARGET, errors });
  const bare = { trouble: null, localHead: null, pin: null, target: null, errors: NO_ERRORS };
  assert.deepEqual(sceneOf({ phase: "locating", place: PLACE, shown: shown("cache") }), { shown: shown("cache"), ...bare });
  assert.deepEqual(sceneOf({ phase: "replay", file: "f.json", shown: shown("replay"), trouble: null }), { shown: shown("replay"), ...bare });
});

test("a place is another when its machine, folder or branch is; a pane without a place has no key", () => {
  assert.equal(placeKey(null), null);
  assert.equal(placeKey(PLACE), placeKey({ ...PLACE, pin: "octo/site#7" }));
  for (const moved of [{ machine: "vps" }, { cwd: "/work/other" }, { branch: "main" }]) assert.notEqual(placeKey({ ...PLACE, ...moved }), placeKey(PLACE));
});
